// Application operations exposed to MCP. The renderer and MCP share run/stop scheduling.
const fs = require('node:fs');
const path = require('node:path');

function safeName(name, suffix = '') {
  if (typeof name !== 'string') throw new Error('名称必须为文本');
  const stem = suffix && name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
  if (!/^[\p{L}\p{N}_-]{1,64}$/u.test(stem) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) throw new Error('名称只能包含文字、数字、下划线和连字符');
  return stem + suffix;
}

function confinedFile(root, directory, name, suffix = '', required = false) {
  const base = path.resolve(root, directory);
  fs.mkdirSync(base, {recursive:true});
  // Check real paths as well as lexical paths: Windows junctions must not escape.
  const actualRoot = fs.realpathSync(root);
  const actualBase = fs.realpathSync(base);
  if (!actualBase.startsWith(actualRoot + path.sep)) throw new Error('目录超出项目范围');
  const file = path.join(base, safeName(name, suffix));
  if (fs.existsSync(file)) {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile() || path.dirname(fs.realpathSync(file)) !== actualBase) throw new Error('文件不是项目内的普通文件');
    if (stat.size > 4 * 1024 * 1024) throw new Error('文件超过 4 MB');
  } else if (required) throw new Error('文件不存在');
  return file;
}

class McpAutomation {
  constructor({root, state, backend, dispatch, connect, onProject, onOperation, validateProject, validateSelector, audit}) {
    Object.assign(this, {root, state, backend, dispatch, connect, onProject, onOperation, validateProject, validateSelector, audit});
    this.bound = null; this.seen = new Map(); this.active = ''; this.events = []; this.sequence = 0;
  }
  receive(event) {
    const row = {sequence:++this.sequence,time:Date.now(),...event};
    delete row.traceback;
    this.events.push(row);
    if (this.events.length > 500) this.events.shift();
  }
  status() {
    return {...this.state(),mcp:{enabled:true,bound:this.bound,operation:this.active,eventSequence:this.sequence}};
  }
  cancelStart(){if(['nycs_run_case','nycs_record_start'].includes(this.active))this.startCancelled=true;}
  checkStart(){if(this.startCancelled)throw new Error('已取消尚未开始的执行或录制');}
  idle(replace = false) {
    const current = this.state();
    if (current.closing) throw new Error('工作台正在关闭');
    if (current.busy || current.recordStarting) throw new Error('请先停止录制或执行');
    if (replace && current.dirty) throw new Error('工作台有未保存修改，请先保存');
    if (replace && current.recordPending) throw new Error('请先处理工作台的录制结果');
  }
  async windows() {
    const data = await this.backend('windows');
    this.seen = new Map(data.windows.map(win => [win.handle,win]));
    return data;
  }
  async binding() {
    const current = this.state();
    if (!this.bound || current.connection?.handle !== this.bound.handle) throw new Error('请先用 nycs_windows 和 nycs_connect 连接游戏');
    const data = await this.backend('windows');
    const actual = data.windows.find(win => win.handle === this.bound.handle);
    if (!actual || actual.pid !== this.bound.pid) {this.bound = null; throw new Error('游戏窗口身份已变化，请重新连接');}
    return actual.handle;
  }
  checkAssets(project) {
    for (const selector of project.selectors) {
      if (selector.kind === 'image') {
        const images = [selector.image,selector.mask,...(selector.templates||[]).flatMap(item=>[item.image,item.mask])].filter(Boolean);
        for (const image of images) {
        if (typeof image !== 'string' || !image.startsWith('assets/')) throw new Error('模板必须位于用例 assets 目录');
        confinedFile(this.root, 'test_cases/assets', image.slice(7), '.png', true);
        }
      }
    }
  }
  async load(name) {
    this.idle(true);
    const file = confinedFile(this.root,'test_cases',name,'.nycs.json',true);
    const project = this.validateProject(JSON.parse(fs.readFileSync(file,'utf8')));
    this.checkAssets(project);
    const data = await this.backend('load_project',{path:file});
    await this.onProject(data,this.editRevision);
    return data;
  }
  async invoke(tool, args = {}) {
    if (tool === 'nycs_status') return this.status();
    if (tool === 'nycs_stop') {this.cancelStart();return this.dispatch('stop',{});}
    if (tool === 'nycs_windows') return this.windows();
    if (tool === 'nycs_events') {
      const after = args.after ?? 0, limit = args.limit ?? 100;
      if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('无效的事件范围');
      const entries = this.events.filter(row => row.sequence > after).slice(0,limit);
      return {entries,next:entries.at(-1)?.sequence ?? after,latest:this.sequence,truncated:after > 0 && (this.events[0]?.sequence ?? 0) > after + 1};
    }
    if (tool === 'nycs_report') {
      const file = confinedFile(this.root,`reports/${safeName(args.id)}`,'result','.json',true);
      return {id:args.id,result:JSON.parse(fs.readFileSync(file,'utf8')),path:file,html:path.join(path.dirname(file),'report.html')};
    }
    if (this.active) throw new Error('另一个 MCP 操作正在进行，请稍候');
    this.active = tool;
    this.startCancelled=false;
    this.editRevision = this.state().editRevision;
    try {
      await this.onOperation?.(tool);
      if (tool === 'nycs_connect') {
        this.idle();
        if (!Number.isSafeInteger(args.handle) || !this.seen.has(args.handle)) throw new Error('请先列出窗口，再使用返回的游戏句柄');
        const previous = this.seen.get(args.handle);
        const found = (await this.backend('windows')).windows.find(win => win.handle === args.handle && win.pid === previous.pid);
        if (!found) throw new Error('游戏窗口已变化，请重新列出窗口');
        const result = await this.connect(args.handle);
        this.bound = {handle:found.handle,pid:found.pid,title:found.title};
        return result;
      }
      if (tool === 'nycs_save_case') {
        this.idle(true);
        const name = safeName(args.name,'.nycs.json');
        confinedFile(this.root,'test_cases',name,'.nycs.json');
        const project = this.validateProject(args.project); this.checkAssets(project);
        const data = await this.backend('automation_save_case',{name,project});
        await this.onProject(data,this.editRevision); return data;
      }
      if (tool === 'nycs_load_case') return this.load(args.name);
      if (tool === 'nycs_run_case') {
        this.idle(true);
        const iterations = args.iterations ?? 1;
        if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10) throw new Error('MCP 循环次数必须为 1 ~ 10');
        const handle = await this.binding();
        const data = await this.load(args.name);
        this.checkStart();
        return {...await this.dispatch('run',{handle,expected_pid:this.bound.pid,project:data.project,iterations,source:'case'}),path:data.path};
      }
      if (tool === 'nycs_capture') {
        const handle = await this.binding();
        return this.dispatch('automation_capture',{handle,expected_pid:this.bound.pid});
      }
      if (tool === 'nycs_save_template') {
        this.idle(); const handle = await this.binding();
        const name = safeName(args.name,'.png');
        confinedFile(this.root,'test_cases/assets',name,'.png');
        return this.backend('automation_save_template',{...args,name,handle,expected_pid:this.bound.pid});
      }
      if (tool === 'nycs_preview_target') {
        this.idle(); const handle = await this.binding();
        const selector = this.validateSelector(args.selector);
        const selectors = (args.selectors||[]).filter(item=>item.name!==selector.name).map(item=>this.validateSelector(item));
        this.validateProject({selectors:[...selectors,selector],steps:[]});
        this.checkAssets({selectors:[...selectors,selector]});
        return this.dispatch('automation_preview',{handle,expected_pid:this.bound.pid,selector,...(args.selectors?{selectors}:{})});
      }
      if (tool === 'nycs_record_start') {
        this.idle(true); const handle = await this.binding();
        this.checkStart();
        return this.dispatch('record_start',{handle,expected_pid:this.bound.pid});
      }
      if (tool === 'nycs_record_stop') return this.dispatch('record_stop',{});
      throw new Error('不支持的 MCP 工具');
    } finally {this.active = '';await this.onOperation?.('');}
  }
}
module.exports = {McpAutomation,safeName,confinedFile};
