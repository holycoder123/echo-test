'use strict';
const paths = {
  help:'M4 4h6l2 2 2-2h6v16h-6l-2 2-2-2H4z M12 6v16 M7 9h2 M15 9h2 M7 13h2 M15 13h2',
  python:'M8 6L2 12l6 6 M16 6l6 6-6 6 M14 3l-4 18',
  diagnostics:'M5 3h14v18H5z M8 7h8 M8 11h8 M8 15h5',
  game:'M3 5h18v12H3z M8 21h8 M12 17v4',
  cases:'M4 4h6l2 2h8v14H4z M8 10h8 M8 14h5', targets:'M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5 M9 9h6v6H9z',
  record:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M9 9h6v6H9z', history:'M4 5v5h5 M4 10a8 8 0 1 1 1 8 M12 7v5l3 2',
  click:'M7 3l11 10-6 1-3 6z M12 14l4 6', double_click:'M7 5l11 10-6 1-3 6z M12 14l4 6 M3 3l1 2 M9 1v2 M2 9h2',
  right_click:'M8 3h8l2 4v12H6V7z M12 3v7 M12 10h6', long_press:'M8 3h8l2 4v12H6V7z M12 3v7 M6 10h12 M9 14h6',
  drag:'M4 7h9 M9 3l4 4-4 4 M20 17h-9 M15 13l-4 4 4 4', scroll:'M12 3v18 M8 7l4-4 4 4 M8 17l4 4 4-4',
  assert_image:'M4 5h16v14H4z M7 15l3-4 3 3 2-2 3 4 M14 8h.01', wait_image:'M4 5h16v14H4z M8 9h8 M12 9v6 M9 15h6', assert_absent:'M4 5h16v14H4z M8 9l8 7 M16 9l-8 7',
  key:'M3 6h18v12H3z M7 10h.01 M11 10h.01 M15 10h.01 M7 14h10', key_down:'M3 6h18v12H3z M9 10l3 3 3-3', key_up:'M3 6h18v12H3z M9 13l3-3 3 3',
  text:'M4 5h16 M12 5v14 M8 19h8', sleep:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l4 2', screenshot:'M4 6h4l2-3h4l2 3h4v14H4z M12 9a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
  plus:'M12 5v14 M5 12h14', play:'M8 4l12 8-12 8z', stop:'M6 6h12v12H6z', copy:'M8 8h12v12H8z M4 16V4h12', trash:'M4 6h16 M9 6V3h6v3 M6 6l1 14h10l1-14 M10 10v6 M14 10v6',
  save:'M5 3h12l3 3v15H4V3z M8 3v6h8V3 M8 14h8v7', folder:'M3 6h7l2 2h9l-3 12H3z', close:'M6 6l12 12 M18 6L6 18', more:'M5 12h.01 M12 12h.01 M19 12h.01', refresh:'M20 7v5h-5 M4 17v-5h5 M5 8a8 8 0 0 1 14-2 M19 16a8 8 0 0 1-14 2',
  coordinate:'M12 2v4 M12 18v4 M2 12h4 M18 12h4 M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12 M12 10v4 M10 12h4', image:'M4 4h16v16H4z M7 15l4-5 5 7 M15 8h.01', chevron:'M9 5l7 7-7 7', down:'M6 9l6 6 6-6', settings:'M12 3v2 M12 19v2 M3 12h2 M19 12h2 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2 M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
  check:'M5 12l4 4 10-10', search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6', arrow:'M4 12h16 M14 6l6 6-6 6', upload:'M12 16V3 M7 8l5-5 5 5 M4 16v5h16v-5',
  shield:'M12 3l8 4v6c0 5-8 9-8 9S4 18 4 13V7z M8 12l3 3 5-6', spark:'M12 3l2 6 6 3-6 2-2 6-2-6-6-2 6-3z'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.click}"/></svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const clone = value => JSON.parse(JSON.stringify(value));
const A = {click:'单击',double_click:'双击',right_click:'右键',long_press:'长按',drag:'拖动',scroll:'滚动',wait_image:'等待图片',assert_image:'图片存在',assert_absent:'图片不存在',key:'按键组合',text:'输入文本',sleep:'等待',screenshot:'保存截图',key_down:'按下按键',key_up:'松开按键',python:'Python 脚本'};
const DEFAULTS = {double_click:{interval:.12},long_press:{duration:1},drag:{duration:1},scroll:{amount:-3,axis:'vertical'},key:{keys:'ENTER'},text:{text:''},sleep:{duration:1},key_down:{keys:'W'},key_up:{keys:'W'},python:{code:'# 可调用 game 操作当前目标应用，print 输出会进入报告\nprint("目标应用分辨率:", game.size())\n# game.click("控件名称")\n# game.key("ENTER")\n'}};
const TARGETS = new Set(['click','double_click','right_click','long_press','drag','scroll','wait_image','assert_image','assert_absent']);
const IMAGES = new Set(['wait_image','assert_image','assert_absent']);
const LABELS = {running:'执行中',passed:'通过',failed:'失败',stopped:'已停止'};
const S = {view:'cases',project:{name:'未命名用例',schema_version:1,steps:[],selectors:[]},selected:0,windows:[],handle:null,path:null,dirty:false,busy:'',admin:false,recent:[],reports:[],logs:[],stepStatus:{},modal:null,recordPending:null,recordCount:0,recordStart:0,recordEvents:[],targetSearch:'',thumbnails:{},lastResult:null};
S.library=[];S.caseDirectory='';S.caseSearch='';S.libraryOpen=true;
S.helpSearch='';
S.gameCasePath='';S.gameRunStarting=false;S.runState=null;
S.iterations = 1;S.recordStarting=false;S.auditEntries=[];S.auditLevel='';S.auditSearch='';S.auditDirectory='';S.auditSelected=null;
S.mcpOperation='';
S.recordReplaying=false;S.recordReplayRun=null;
S.connection=null;S.connecting=false;
S.controls={entries:[],categories:[],total:0,uncategorized:0,warnings:[]};S.targetCategory='all';
const root = document.querySelector('#app');
const modal = document.querySelector('#modal');
window.__studioErrors = [];
let confirmation, dragIndex=null, pickStart=null;

function toast(text, type='') {
  if(type==='error'){window.reportStudioError(text,'toast');window.__studioErrors.push(String(text));window.__studioErrors=window.__studioErrors.slice(-20);}
  const node=document.createElement('div'); node.className=`toast ${type}`; node.textContent=text;
  document.querySelector('#toasts').append(node); setTimeout(()=>node.remove(), type==='error'?7000:3500);
}
async function api(method,args={}) { return window.studio.call(method,args); }
function dirty() {
  S.dirty=true; api('dirty',{value:true,caseName:S.project.name}).catch(()=>{});
  document.querySelectorAll('[data-save-dot]').forEach(node=>node.style.display='inline-block');
  document.title=`${S.project.name} · echo test`;
}
function lock() { if(S.busy||S.gameRunStarting||S.mcpOperation) {toast(S.mcpOperation?'MCP 正在操作工作台，请稍候':S.gameRunStarting?'正在准备用例，请稍候':'请先停止录制或执行');return true;} return false; }
const disabled = () => S.busy||S.gameRunStarting||S.mcpOperation ? 'disabled' : '';
function button(label,action,kind='',symbol='',extra='') {return `<button class="btn ${kind}" data-act="${action}" ${extra}>${symbol?icon(symbol):''}${label}</button>`;}
function field(label,body,help='') {return `<label class="field"><span>${label}</span>${body}${help?`<div class="field-help">${help}</div>`:''}</label>`;}
function input(value,attribute,type='text',extra='') {return `<input type="${type}" value="${esc(value)}" ${attribute} ${extra} ${disabled()}>`;}
function options(values,selected) {return values.map(([value,label])=>`<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(label)}</option>`).join('');}
function serverTitle(window) { return window?.title || '未连接目标应用'; }
function currentWindow() {return S.windows.find(window=>window.handle===Number(S.handle));}
function shortFile(path) {return path.split(/[\\/]/).at(-1).replace(/\.echo\.json$|\.json$/,'');}
function dateLabel(value) {try{return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));}catch{return value;}}
function paramsSummary(step) {
  if(TARGETS.has(step.action)) return step.target ? step.target+(step.action==='drag'?` → ${step.end_target||'选择终点'}`:'') : '选择目标控件';
  if(step.action.startsWith('key')) return step.params?.keys||'设置按键';
  if(step.action==='text') return step.params?.text||'设置输入内容';
    if(step.action==='sleep') return `${step.params?.duration??1} 秒`;
  if(step.action==='python')return `${(step.params?.code||'').split('\n').length} 行代码 · 超时 ${step.timeout??30} 秒`;
  return '保存当前目标应用画面';
}

function render() {
  const titles={game:'目标窗口 ↗',cases:'测试用例',targets:'通用控件库',record:'录制',runs:'运行记录',diagnostics:'错误日志',help:'使用说明'};
  root.innerHTML=`<div class="shell"><aside class="sidebar">
    <div class="brand"><div class="brand-icon">${icon('spark')}</div><div><strong>echo test</strong><span>桌面自动化测试工作台</span></div></div>
    ${Object.entries(titles).map(([view,title])=>`<button class="nav-button ${S.view===view?'active':''}" data-act="view-${view}">${icon(view==='runs'?'history':view)}<span>${title}</span>${view==='record'&&S.busy==='recording'?'<span class="count"><i class="status-dot red"></i></span>':''}</button>`).join('')}
    <div class="nav-label">工作区</div><button class="recent-case" data-act="new">＋ 新建用例</button><button class="recent-case" data-act="open">打开本地用例</button>
    ${S.recent.length?'<div class="nav-label">最近使用</div>'+S.recent.slice(0,5).map((path,index)=>`<button class="recent-case" data-act="recent" data-i="${index}" title="${esc(path)}">${esc(shortFile(path))}</button>`).join(''):''}
    <div class="sidebar-bottom"><i class="status-dot ${S.admin?'green':''}"></i><span>${S.admin?'管理员权限':'普通权限'}</span><button data-act="environment" title="运行环境">${icon('settings')}</button></div>
  </aside><main class="workspace"><header class="topbar"><div class="breadcrumb"><span>工作区</span><span>/</span><strong>${esc(titles[S.view])}</strong></div><div class="topbar-right"><i class="status-dot ${S.connection?'green':''}"></i><select class="connection-select" id="connection" aria-label="选择目标窗口" ${S.connecting?'disabled':disabled()}><option value="">连接目标窗口</option>${S.windows.map(w=>`<option value="${w.handle}" ${w.handle===Number(S.connection?.handle)?'selected':''}>${esc(serverTitle(w))} · ${w.pid}</option>`).join('')}</select>${button(S.connecting?'连接中…':S.connection?'重新连接':'连接','game-connect','','',S.connecting||S.busy||S.gameRunStarting||!S.windows.length?'disabled':'')}<button class="icon-button" data-act="refresh" title="刷新目标窗口">${icon('refresh')}</button></div></header>
    <section class="content ${S.view==='game'?'game-content':''}" id="content">${S.view==='game'?gameView():S.view==='cases'?caseView():S.view==='targets'?targetView():S.view==='record'?recordView():S.view==='diagnostics'?diagnosticsView():S.view==='help'?StudioHelp.render(S.helpSearch):runView()}</section>
    <footer class="subtle-footer"><i class="status-dot ${S.busy?'green':''}"></i><span>${S.busy==='recording'?'正在录制目标应用操作':S.busy==='running'?'用例执行中 · F12 停止':'就绪'}</span><span class="right file-location" title="${esc(S.path||'')}" >${S.path?esc(shortFile(S.path)):'尚未保存'}${S.dirty?' · 未保存':''}</span></footer>
  </main></div>`;
  if(S.view==='runs') document.querySelector('.log-lines')?.scrollTo(0,1e8);
}

function gameCaseControls(){
  const locked=!!S.busy||S.gameRunStarting;
  return `<div class="game-case-controls"><label class="case-choice">运行用例<select id="game-case" aria-label="选择运行用例" ${locked?'disabled':''}><option value="">当前编辑 · ${esc(S.project.name)}${S.dirty?'（未保存）':''}</option>${S.library.map(item=>`<option value="${esc(item.path)}" ${item.path===S.gameCasePath?'selected':''} ${item.error?'disabled':''}>${esc(item.name)}${item.error?'（读取失败）':''} · ${esc(item.location)}</option>`).join('')}</select></label>${button('刷新','case-refresh','ghost','refresh',locked?'disabled':'')}<label>循环<input id="game-iterations" type="number" min="1" max="1000" value="${S.iterations}" aria-label="用例循环次数" ${locked?'disabled':''}></label>${button(S.busy==='running'?'停止执行':S.gameRunStarting?'正在准备…':'运行用例',S.busy==='running'?'stop':'game-run','primary',S.busy==='running'?'stop':'play',S.busy==='recording'||S.gameRunStarting?'disabled':'')}</div>`;
}
function gameView(){
  if(!S.connection)return `<div class="empty"><div class="empty-icon">${icon('game')}</div><strong>尚未连接目标应用</strong><p>点击右上角刷新，选择目标窗口后连接。只有一个客户端时也可直接点击「连接」。</p>${button(S.connecting?'连接中…':'连接目标应用','game-connect','primary','game',S.connecting||!S.windows.length?'disabled':'')}</div>`;
  const info=S.connection;
  return `<div class="game-shell"><div class="game-toolbar"><div class="game-title"><strong>${esc(serverTitle(info))}</strong><span>${info.width} × ${info.height}</span></div><div class="right">${button('打开窗口工具栏','view-game','primary','game')}</div></div><div class="empty compact"><strong>目标应用在独立窗口运行</strong><p>通过窗口工具栏录制操作、采集坐标和图片。</p></div><div id="game-case-controls">${gameCaseControls()}</div><div class="game-status"><i class="status-dot ${S.busy?'red':''}"></i><span>${S.recordStarting?'正在启动录制监听…':S.busy==='recording'?`正在录制 · ${S.recordCount} 个事件 · F12 停止`:S.busy==='running'?'用例执行中 · F12 停止':'就绪'}</span></div><section id="game-run-results" class="game-run-results" aria-label="用例运行状态">${RunPanel.html(S.runState)}</section></div>`;
}
function updateGameControls(){
  const node=document.querySelector('#game-case-controls');if(node)node.innerHTML=gameCaseControls();
  const text=S.recordStarting?'正在启动录制监听…':S.busy==='running'?'用例执行中 · F12 停止':S.busy==='recording'?`正在录制 · ${S.recordCount} 个事件 · F12 停止`:'就绪';
  const status=document.querySelector('.game-status span');if(status)status.textContent=text;
  const footer=document.querySelector('.subtle-footer>span');if(footer)footer.textContent=S.busy?text:'就绪';
}
function receiveRunState(run){
  S.runState=run;
  if(run?.source==='recording'&&S.recordPending){
    S.recordReplayRun=run;
    if(S.view==='record'&&!document.querySelector('#record-replay-results'))render();
    else RunPanel.update(document.querySelector('#record-replay-results'),run);
  }
  RunPanel.update(document.querySelector('#game-run-results'),run);
}
async function runGameCase(file=S.gameCasePath,iterations=S.iterations){
  if(lock()||S.gameRunStarting)return;
  if(!Number.isInteger(Number(iterations))||Number(iterations)<1||Number(iterations)>1000)throw new Error('循环次数需在 1 ~ 1000 之间');
  S.gameRunStarting=true;updateGameControls();
  try{
    if(file&&(file!==S.path||S.dirty)){
      if(S.dirty)await api('workbench_show');
      if(!await canReplace())return;
      setProject(await api('open_case',{path:file}));
    }
    S.iterations=Number(iterations);S.gameRunStarting=false;
    await run({stayOnGame:S.view==='game'});
  }finally{S.gameRunStarting=false;updateGameControls();}
}
async function connectGame(handle){
  if(lock()||S.connecting)return;
  const requested=Number(handle)||null;
  S.connecting=true;render();
  try{
    if(!requested){await api('game_disconnect');S.handle=null;S.connection=null;return;}
    const data=await api('game_connect',{handle:requested});
    S.connection=data.connection;S.handle=data.connection?.handle||null;
    await api('game_focus',{handle:requested});
  }catch(error){S.handle=S.connection?.handle||null;throw error;}
  finally{S.connecting=false;render();}
}
async function refreshGameWindows(){
  if(lock()||S.connecting)return;
  const data=await api('windows');S.windows=data.windows;S.admin=data.admin;
  if(S.connection&&!S.windows.some(w=>w.handle===S.connection.handle))await connectGame(null);
  S.handle=S.connection?.handle||null;
  render();
  if(!S.windows.length)toast('没有发现目标窗口，请先启动目标应用后刷新');
}
async function reconnectGame(){
  const handle=S.connection?.handle||(S.windows.length===1?S.windows[0].handle:null);
  if(!handle){toast('请先从右上角选择要连接的目标窗口');return;}
  await connectGame(handle);
}
async function pickGameControl(kind){
  if(lock())return;
  const draft=defaultSelector();draft.kind=kind;draft.name=kind==='image'?'新图片控件':'新坐标控件';
  const shot=await api('capture',{handle:S.handle});
  showModal({kind:'picker',shot,returnModal:{kind:'selector',index:null,draft},selection:null});
}


function caseView() {
  return `${caseLibraryView()}<div class="page-heading"><div><h1>${input(S.project.name,'data-project-name','text','class="project-title" aria-label="用例名称"')}<i class="save-dot" data-save-dot style="display:${S.dirty?'inline-block':'none'}"></i></h1><p class="sub">把目标应用操作整理成步骤，用图片断言验证结果。</p></div><div class="heading-actions">${button('','case-menu','ghost','more',`title="更多用例操作" ${disabled()}`)}${button('保存','save','','save',disabled())}${button(S.busy==='running'?'停止':'运行用例',S.busy==='running'?'stop':'run','primary',S.busy==='running'?'stop':'play',S.busy==='recording'?'disabled':'')}</div></div>
  <div class="case-layout"><div><div class="section-toolbar"><span>${S.project.steps.length} 个步骤</span><div class="right"><span>循环</span>${input(S.iterations,'id="iterations"','number','class="tiny-number" min="1" max="1000" aria-label="用例循环次数"')}${button('添加步骤','step-menu','ghost','plus',disabled())}</div></div><div class="step-list">${S.project.steps.length?S.project.steps.map((step,index)=>stepRow(step,index)).join(''):`<div class="empty"><div class="empty-icon">${icon('cases')}</div><strong>从第一个步骤开始</strong><p>添加一个操作，或录制你在目标应用中的动作。</p>${button('添加步骤','step-menu','quiet','plus')}${button('去录制','view-record','ghost','record')}</div>`}</div>${S.project.steps.length?`<button class="insert-step" data-act="step-menu" ${disabled()}>${icon('plus')}添加下一步</button>`:''}</div><aside class="inspector">${inspectorView()}</aside></div>`;
}
function caseLibraryView(){
  const query=S.caseSearch.toLowerCase(),items=S.library.filter(item=>(item.name+' '+item.location).toLowerCase().includes(query));
  return `<details class="case-library" ${S.libraryOpen?'open':''}><summary><span>${icon('folder')}本地用例 <span class="count">${S.library.length}</span></span><span class="small">点击展开或收起</span></summary><div class="library-tools"><div class="search">${icon('search')}<input id="case-search" placeholder="搜索名称或文件路径" value="${esc(S.caseSearch)}" aria-label="搜索本地用例"></div>${button('刷新','case-refresh','','refresh')}${button('打开用例目录','case-folder','','folder')}${button('新建用例','new','quiet','plus',disabled())}</div><div class="library-list">${items.length?`<table class="report-table"><thead><tr><th>用例</th><th>步骤 / 控件</th><th>修改时间</th><th></th></tr></thead><tbody>${items.map(item=>`<tr class="${S.path?.toLowerCase()===item.path.toLowerCase()?'current':''}"><td><strong>${esc(item.name)}</strong>${S.path?.toLowerCase()===item.path.toLowerCase()?'<span class="badge">当前</span>':''}<small title="${esc(item.path)}">${esc(item.location)}</small>${item.error?`<small class="library-error">${esc(item.error)}</small>`:''}</td><td>${item.steps} / ${item.selectors}</td><td>${esc(new Date(item.modified).toLocaleString('zh-CN',{hour12:false}))}</td><td>${button('打开','case-open','ghost','',`data-path="${esc(item.path)}" ${item.error||S.busy?'disabled':''}`)}</td></tr>`).join('')}</tbody></table>`:`<div class="empty compact">${query?'没有匹配的用例':'还没有已保存的用例。新建后点击保存，即可出现在这里。'}</div>`}</div><div class="library-directory small" title="${esc(S.caseDirectory)}">默认保存目录：${esc(S.caseDirectory)}</div></details>`;
}
function setLibrary(data){if(data){S.library=data.entries;S.caseDirectory=data.directory;if(S.gameCasePath&&!S.library.some(item=>item.path===S.gameCasePath&&!item.error))S.gameCasePath='';}}
async function refreshCases(){setLibrary(await api('case_list'));if(S.view==='cases')render();else if(S.view==='game')updateGameControls();}
function stepRow(step,index) {
  const status=S.stepStatus[index];
  return `<div class="step-row ${S.selected===index?'selected':''} ${step.enabled===false?'disabled':''}" data-step="${index}" draggable="${!S.busy}"><span class="drag-handle">⠿</span><span class="step-number">${String(index+1).padStart(2,'0')}</span><div class="step-icon">${icon(step.action)}</div><div class="step-copy"><strong>${esc(step.name)}</strong><div class="step-meta"><span>${A[step.action]}</span><span>·</span><span>${esc(paramsSummary(step))}</span>${step.repeat>1?`<span>×${step.repeat}</span>`:''}</div></div>${status?`<span class="step-state ${status}">${LABELS[status]}</span>`:''}<div class="row-tools"><button class="icon-button" data-act="copy-step" data-i="${index}" title="复制步骤" ${disabled()}>${icon('copy')}</button><button class="icon-button" data-act="delete-step" data-i="${index}" title="删除步骤" ${disabled()}>${icon('trash')}</button></div></div>`;
}
function inspectorView() {
  const step=S.project.steps[S.selected];
  if(!step) return '<div class="empty compact"><p>选择步骤后，在这里配置。</p></div>';
  const action=step.action;
  return `<div class="inspector-head"><span>步骤设置</span><label class="check-line"><input type="checkbox" data-sfield="enabled" ${step.enabled!==false?'checked':''} ${disabled()}>启用</label></div>
  ${field('步骤名称',input(step.name,'data-sfield="name"'))}
  ${field('操作',`<select data-sfield="action" ${disabled()}>${options(Object.entries(A),action)}</select>`)}
  ${TARGETS.has(action)?field('目标控件',controlChoice(step,'target')):''}
  ${action==='drag'?field('拖动终点',controlChoice(step,'end_target')):''}
  ${paramFields(step)}
  <div class="divider"></div><div class="field-grid">${field('操作后等待 · 秒',input(step.delay??.5,'data-sfield="delay"','number','min="0" max="600" step="0.1"'))}${field('重复次数',input(step.repeat??1,'data-sfield="repeat"','number','min="1" max="1000"'))}</div>
  <details class="details" ${action==='python'?'open':''}><summary>更多设置</summary>${field(action==='python'?'脚本执行超时 · 秒':'寻找控件超时 · 秒',input(step.timeout??5,'data-sfield="timeout"','number','min="0.1" max="600" step="0.5"'))}${step.params?.path?'<div class="field-help">已保留录制的拖动轨迹。</div>':''}</details>
  ${['click','double_click','right_click','long_press'].includes(action)?'<div class="inspector-tip">操作之后添加「图片存在」步骤，可以验证目标应用界面是否发生变化。</div>':''}`;
}
function paramFields(step) {
  const p=step.params||{}, action=step.action;
  let result='';
  if(['long_press','drag','sleep'].includes(action)) result+=field(action==='sleep'?'等待时间 · 秒':action==='drag'?'拖动时间 · 秒':'按住时间 · 秒',input(p.duration??1,'data-param="duration"','number','min="0.01" max="600" step="0.1"'));
  if(action==='double_click') result+=field('双击间隔 · 秒',input(p.interval??.12,'data-param="interval"','number','min="0.01" step="0.01"'));
  if(action==='scroll') result+=`<div class="field-grid">${field('滚动方向',`<select data-param="axis" ${disabled()}>${options([['vertical','垂直'],['horizontal','水平']],p.axis||'vertical')}</select>`)}${field('滚动格数',input(p.amount??-3,'data-param="amount"','number','min="-100" max="100"'))}</div><div class="field-help">正数向上 / 向右，负数向下 / 向左。</div>`;
  if(action.startsWith('key')) result+=field('按键',input(p.keys??(action==='key'?'ENTER':'W'),'data-param="keys"'),'例如 CTRL+A、ENTER、W。F12 用于停止。');
  if(action==='text') result+=field('文本内容',`<textarea data-param="text" ${disabled()}>${esc(p.text||'')}</textarea>`,'先点击目标应用中的输入框，再输入文本。');
  if(action==='python')result+=field('Python 代码',`<textarea class="python-editor" data-param="code" spellcheck="false" aria-label="Python 代码" ${disabled()}>${esc(p.code||'')}</textarea>`,'使用工作台的 Python 环境与权限，代码随用例保存。')+`<div class="script-actions">${button('展开编辑','script-edit','ghost','',disabled())}${button('导入 .py','script-import','ghost','upload',disabled())}</div><div class="field-help">game.click("控件名") · game.key("ENTER") · game.sleep(1)<br>print 输出与异常保存在运行报告。</div>`;
  if(['long_press','drag'].includes(action)) result+=field('鼠标按钮',`<select data-param="button" ${disabled()}>${options([['left','左键'],['right','右键'],['middle','中键']],p.button||'left')}</select>`);
  return result;
}
function targetView(){return controlView();}
function recordChoices(pending){
  const blocked=!!S.busy||S.gameRunStarting;
  const replaying=S.recordReplaying&&S.busy==='running';
  const playable=pending.project.steps.some(step=>step.enabled!==false);
  const locked=blocked?'disabled':'';
  return `<div class="record-choice">${button(replaying?'停止重放 · F12':'重放录制',replaying?'stop':'record-replay','',replaying?'stop':'play',replaying?'':blocked||!S.handle||!playable?'disabled':'')}${pending.raw_count===0?button('重新录制','record-retry','primary','record',locked):''}${button('追加到当前用例','record-append','primary','plus',blocked||!pending.project.steps.length?'disabled':'')}${button('创建新用例','record-new','','cases',blocked||!pending.project.steps.length?'disabled':'')}${button('丢弃','record-discard','ghost','',locked)}</div>${S.recordReplayRun?`<section id="record-replay-results" class="game-run-results" aria-label="录制重放结果">${RunPanel.html(S.recordReplayRun)}</section>${S.recordReplayRun.reportId?button('查看重放报告','open-report','ghost','',`data-id="${esc(S.recordReplayRun.reportId)}"`):''}`:''}`;
}
function recordView() {
  const pending=S.recordPending;
  const recording=S.busy==='recording';
  return `<div class="page-heading"><div><h1>录制</h1><p class="sub">手动操作目标应用，自动整理为可编辑的测试步骤。</p></div><div class="heading-actions">${recording?button('停止录制','stop','record','stop'):button('开始录制','record-start','record','record',S.busy||pending?'disabled':'')}</div></div>
  <div class="record-flow"><div class="flow-stage"><span class="flow-number">1</span>连接目标应用</div>${icon('chevron')}<div class="flow-stage"><span class="flow-number">2</span>手动操作</div>${icon('chevron')}<div class="flow-stage"><span class="flow-number">3</span>编辑测试用例</div></div>
  <div class="record-layout"><div class="record-card">${recording?`<div class="record-live"><i class="status-dot red"></i>${S.recordStarting?'正在启动录制监听…':'正在记录目标应用操作'}</div><div class="record-time" id="record-clock">${elapsed()}</div><p>在目标应用中完成要测试的操作，按 F12 结束录制。</p><div class="record-preview" id="live-events">${liveEvents()}</div>${button('停止录制 · F12','stop','record','stop',S.recordStarting?'disabled':'style="margin-top:24px"')}`:pending?`<div class="record-symbol">${icon('check')}</div><h2>${pending.project.steps.length?'录制已完成':'未录到操作'}</h2><p>可先重放本次录制，再加入用例。你可以继续修改位置、等待时间和验证条件。</p><div class="stats-row"><div class="stat"><strong>${pending.project.steps.length}</strong><span>个测试步骤</span></div><div class="stat"><strong>${pending.project.selectors.length}</strong><span>个定位控件</span></div><div class="stat"><strong>${pending.duration}</strong><span>秒录制时长</span></div></div><div class="record-preview">${pending.project.steps.map(step=>`<div class="record-preview-row">${icon(step.action)}<span>${esc(step.name)}</span><small>${esc(paramsSummary(step))}</small></div>`).join('')||`<div class="empty compact">${esc(pending.hint||'没有采集到目标应用操作。请在所选目标应用画面内完成点击或按键，详情见错误日志。')}</div>`}</div>${recordChoices(pending)}`:`<div class="record-symbol">${icon('record')}</div><h2>像平常一样操作目标应用</h2><p>在目标应用画面上方的工具栏点击开始录制，再像平常一样操作目标应用。点击、拖动、滚轮和键盘操作会被转换成测试步骤。</p><div class="record-connection"><i class="status-dot ${S.handle?'green':''}"></i>${esc(serverTitle(currentWindow()))}</div>${button('开始录制','record-start','record','record',S.busy?'disabled':'')}<div class="tag-line"><span>仅录制所选目标窗口</span><span>F12 停止</span></div>`}</div>
  <aside class="record-note"><h3>录制后可以做什么</h3><div class="item">${icon('cases')}<span>为步骤和控件改名，整理操作顺序。</span></div><div class="item">${icon('image')}<span>把录制的位置切换为图片定位，提高定位稳定性。</span></div><div class="item">${icon('check')}<span>添加图片断言，验证界面变化和操作结果。</span></div><div class="divider"></div><span class="small">中文输入建议录制后添加「输入文本」步骤。复杂同时操作可在用例中调整。</span></aside></div>`;
}
function elapsed(){const seconds=S.recordStart?Math.floor((Date.now()-S.recordStart)/1000):0;return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
function rawLabel(event){if(event.kind==='key'){const name={13:'ENTER',16:'SHIFT',17:'CTRL',18:'ALT',27:'ESC',32:'SPACE',160:'左 SHIFT',161:'右 SHIFT',162:'左 CTRL',163:'右 CTRL'}[event.vk]||(event.vk>=48&&event.vk<=90?String.fromCharCode(event.vk):`按键 ${event.vk}`);return `${event.event==='down'?'按下':'松开'} ${name}`;}return {down:'鼠标按下',up:'鼠标松开',move:'拖动',wheel:'滚轮'}[event.event]||'操作';}
function liveEvents(){return S.recordEvents.slice(-8).map(event=>`<div class="record-preview-row">${icon(event.kind==='key'?'key':event.event==='wheel'?'scroll':'click')}<span>${rawLabel(event)}</span><small>${event.t.toFixed(1)}s</small></div>`).join('')||'<div class="empty compact">等待目标应用操作…</div>';}
function runView() {
  return `<div class="page-heading"><div><h1>运行记录</h1><p class="sub">查看步骤结果、失败原因和截图报告。</p></div><div class="heading-actions">${S.busy==='running'?button('停止执行','stop','primary','stop'):button('刷新记录','refresh-reports','','refresh')}</div></div>
  ${S.logs.length?`<section class="run-current"><div class="run-current-header"><strong>${S.busy==='running'?'正在执行':S.lastResult?`本次执行 · ${LABELS[S.lastResult.status]||'结束'}`:'执行日志'}</strong>${S.lastResult?`<span class="badge ${S.lastResult.status}">${LABELS[S.lastResult.status]}</span>`:''}<div class="right">${S.lastResult?.id?button('查看报告','open-report','ghost','',`data-id="${esc(S.lastResult.id)}"`):''}</div></div><div class="log-lines">${S.logs.map(log=>`<div class="log-line ${log.type||''}"><span class="log-time">${log.time}</span><span>${esc(log.message)}</span></div>`).join('')}</div></section>`:''}
  <div class="section-toolbar"><span>历史运行 · ${S.reports.length}</span></div>${S.reports.length?`<table class="report-table"><thead><tr><th>测试用例</th><th>运行时间</th><th>结果</th><th>步骤数</th><th></th></tr></thead><tbody>${S.reports.map(report=>`<tr><td>${esc(report.case)}</td><td>${esc(dateLabel(report.started))}</td><td><span class="badge ${report.status}">${LABELS[report.status]||report.status}</span></td><td>${report.steps.length}</td><td>${button('查看报告','open-report','ghost','',`data-id="${esc(report.id)}"`)}</td></tr>`).join('')}</tbody></table>`:`<div class="empty"><div class="empty-icon">${icon('history')}</div><strong>还没有运行记录</strong><p>运行一个用例，结果会显示在这里。</p>${button('返回用例','view-cases','quiet','cases')}</div>`}`;
}

function menu(anchor) {
  if(lock()) return;
  const rect=anchor.getBoundingClientRect();
  const sections=[['鼠标操作',['click','double_click','right_click','long_press','drag','scroll']],['验证界面',['wait_image','assert_image','assert_absent']],['其他',['key','text','sleep','screenshot','python']]];
  document.querySelector('#menu-root').innerHTML=`<div class="menu" style="left:${Math.min(rect.left,innerWidth-270)}px;top:${Math.min(rect.bottom+5,innerHeight-600)}px">${sections.map(([name,actions])=>`<div class="menu-label">${name}</div>${actions.map(action=>`<button class="menu-item" data-act="add-step" data-action="${action}">${icon(action)}${A[action]}</button>`).join('')}`).join('')}</div>`;
}
function addStep(action) {
  if(lock()) return;
  const target=controlSelectors().find(item=>!IMAGES.has(action)||item.kind==='image')?.name||'';if(target&&TARGETS.has(action))useControl(target);
  const step={name:A[action],action,target,end_target:'',enabled:true,timeout:action==='python'?30:5,delay:.5,repeat:1,params:clone(DEFAULTS[action]||{})};
  const index=S.project.steps.length?S.selected+1:0;
  S.project.steps.splice(index,0,step);S.selected=index;S.stepStatus={};dirty();render();
}
function showModal(data) {S.modal=data;renderModal();if(!modal.open)modal.showModal();}
function closeModal() {modal.close();S.modal=null;if(confirmation){confirmation(false);confirmation=null;}}
function confirm(message,detail='') {return new Promise(resolve=>{confirmation=resolve;showModal({kind:'confirm',message,detail});});}
async function canReplace(){return !S.dirty || await confirm('当前用例有未保存的修改。','继续会替换编辑器中的内容。你也可以先保存用例。');}
function header(title){return `<div class="modal-header"><h2>${title}</h2><button class="icon-button" data-act="close-modal" title="关闭">${icon('close')}</button></div>`;}
function recognitionFields(t) {
  const ocr=t.recognition==='ocr';
  const anchors=controlSelectors().filter(item=>item.kind==='image'&&item.name!==t.name);
  const variants=t.templates||[];
  return `${field('识别方式',`<select data-dfield="recognition"><option value="template" ${ocr?'':'selected'}>图片模板</option><option value="ocr" ${ocr?'selected':''}>OCR 文字</option></select>`)}
  ${ocr?`${field('目标文字',input(t.text||'','data-dfield="text"'),'识别中英文；忽略大小写和空白。')}${field('文字匹配',`<select data-dfield="text_match"><option value="exact" ${t.text_match!=='contains'?'selected':''}>整行一致</option><option value="contains" ${t.text_match==='contains'?'selected':''}>包含目标文字</option></select>`,'点击识别到的整行中心；可通过点击偏移校准。')}`:`<div class="template-placeholder">${t.image&&S.thumbnails[t.image]?`<img src="${S.thumbnails[t.image]}" alt="控件模板">`:esc(t.image||'框选控件截图作为模板')}</div><div class="modal-actions">${button('从目标应用截图框选','pick-target','','screenshot')}${button('导入图片','import-image','ghost','upload')}</div>
  <div class="template-variants">${t.image?`<div>主模板 ${button('导入遮罩','import-mask','ghost','', 'data-variant="-1"')}${t.mask?`${esc(t.mask)} ${button('清除遮罩','clear-mask','ghost','','data-variant="-1"')}`:''}</div>`:''}${variants.map((item,index)=>`<div class="template-variant"><span>${esc(item.image)}</span>${button('导入遮罩','import-mask','ghost','',`data-variant="${index}"`)}${item.mask?`${esc(item.mask)} ${button('清除遮罩','clear-mask','ghost','',`data-variant="${index}"`)}`:''}${button('移除','remove-variant','ghost','',`data-variant="${index}"`)}</div>`).join('')}</div><div class="modal-actions">${button('框选附加模板','pick-variant','quiet')}${button('导入附加模板','import-variant','ghost')}</div><div class="field-help">附加模板最多 10 张，可保存悬停、选中等状态。遮罩与对应模板尺寸一致：白色参与匹配，黑色忽略。</div>
  ${field('颜色容差',input(t.color_tolerance??'','data-dfield="color_tolerance"','number','min="0" max="255" step="1"'),'留空关闭；0 最严格，255 最宽松。可从 40 开始校准。')}
  ${field('缩放倍率',input((t.scales||[1]).join(', '),'data-dfield="scales"'),'多个倍率用逗号分隔，例如 0.9, 1, 1.1')}`}
  ${field(ocr?'OCR 置信度阈值':'匹配阈值',input(t.threshold??.86,'data-dfield="threshold"','number','min="0.5" max="1" step="0.01"'),'越高越严格。默认 0.86；分数不代表定位正确的概率。')}
  ${field('定位锚点',`<select data-dfield="anchor"><option value="">无锚点 · 客户区定位</option>${anchors.map(item=>`<option value="${esc(item.name)}" ${t.anchor===item.name?'selected':''}>${esc(item.name)}</option>`).join('')}</select>`,'先识别锚点，再在相对区域寻找当前控件。')}
  ${field('搜索区域',input((t.roi||[]).join(', '),'data-dfield="roi"'),t.anchor?'相对锚点匹配框左上角：X, Y, 宽, 高。X/Y 可为负数，单位为客户区像素。':'客户区坐标：X, Y, 宽, 高。留空搜索整个客户区。')}`;
}
function previewOverlay(shot) {
  const box=shot.box;
  return `${box?`<div class="pick-rect ${shot.matched===false?'recognition-miss':''}" style="left:${box[0]/shot.width*100}%;top:${box[1]/shot.height*100}%;width:${box[2]/shot.width*100}%;height:${box[3]/shot.height*100}%"></div>`:''}${shot.point?`<i class="pick-point" style="left:${shot.point[0]/shot.width*100}%;top:${shot.point[1]/shot.height*100}%"></i>`:''}`;
}
function previewHint(shot) {
  const d=shot.diagnostic,c=d?.candidate;
  if(!d)return `坐标 (${shot.point?.join(', ')})`;
  return `${d.matched?'已匹配':'未命中'} · ${d.reason}${c?` · 分数 ${c.score.toFixed(3)} · 倍率 ${c.scale} · ${c.text||c.image}${c.color_difference==null?'':` · 颜色差异 ${c.color_difference.toFixed(1)}`}`:''}`;
}
function previewDetails(shot) {
  const d=shot.diagnostic;if(!d)return '';
  const anchor=d.anchor;
  return `<div class="field-help">${d.roi?`搜索区域 ${esc(d.roi.join(', '))}`:''}${anchor?`<br>锚点 ${esc(anchor.target)}：${esc(anchor.reason)}${anchor.candidate?` · 分数 ${anchor.candidate.score.toFixed(3)}`:''}`:''}${d.recognized?.length?`<br>识别到的文字：${d.recognized.map(item=>`${esc(item.text)} (${item.score.toFixed(3)})`).join('；')}`:''}</div>`;
}
function renderModal() {
  const m=S.modal;if(!m)return;
  modal.className=m.kind==='control-picker'?'control-picker-modal':['picker','preview'].includes(m.kind)?'picker-modal':m.kind==='script'?'script-modal':'';
  const sharedModal=sharedControlModals(m);if(sharedModal!==null){modal.innerHTML=sharedModal;return;}
  if(m.kind==='script')modal.innerHTML=header('编辑 Python 脚本')+`<div class="modal-body">${field('Python 代码',`<textarea id="script-code" class="python-editor" spellcheck="false" aria-label="Python 脚本编辑器" ${disabled()}>${esc(m.code)}</textarea>`)}<div class="field-help">可使用 game、case_dir、report_dir、step_name 和 variables。Tab 插入四个空格，F12 停止执行。</div></div><footer class="modal-footer">${button('取消','close-modal')}${button('应用到步骤','script-apply','primary', '',disabled())}</footer>`;
  if(m.kind==='confirm') modal.innerHTML=header('确认操作')+`<div class="modal-body"><p>${esc(m.message)}</p><p class="modal-message" style="margin-top:10px">${esc(m.detail)}</p></div><footer class="modal-footer">${button('取消','confirm-no')}${button('继续','confirm-yes','primary')}</footer>`;
  if(m.kind==='environment') modal.innerHTML=header('运行环境')+`<div class="modal-body"><div class="env-row"><span>测试服务权限</span><strong>${S.admin?'管理员':'普通权限'}</strong></div><div class="env-row"><span>已发现目标窗口</span><strong>${S.windows.length} 个</strong></div><div class="env-row"><span>停止快捷键</span><strong>F12</strong></div><p class="modal-message" style="margin-top:20px">软件默认请求管理员权限。若当前仍显示普通权限，请保存并关闭工作台，重新启动并确认 Windows 权限提示。</p></div><footer class="modal-footer">${button('知道了','close-modal','primary')}</footer>`;
  if(m.kind==='selector') {
    const t=m.draft, image=t.kind==='image';
    modal.innerHTML=header(m.index===null?'新增控件':'编辑控件')+`<div class="modal-body">${field('控件名称',input(t.name,'data-dfield="name"'))}${field('分类',`<select id="control-category-choice"><option value="">未分类</option>${options(S.controls.categories.map(category=>[category.id,category.name]),m.categoryId||'')}</select>`)}<p class="field-help">保存到通用控件库，所有引用此控件的用例都会使用新配置。</p><div class="segmented"><button data-act="target-mode" data-mode="coordinate" class="${image?'':'active'}">${icon('coordinate')} 坐标定位</button><button data-act="target-mode" data-mode="image" class="${image?'active':''}">${icon('image')} 图片定位</button></div>
    ${image?recognitionFields(t):`<div class="field-grid">${field('X 坐标',input(t.x??.5,'data-dfield="x"','number','step="0.001"'))}${field('Y 坐标',input(t.y??.5,'data-dfield="y"','number','step="0.001"'))}</div><label class="check-line"><input type="checkbox" data-dfield="normalized" ${t.normalized!==false?'checked':''}>使用比例坐标 · 0 到 1</label><div class="field-help" style="margin:10px 0 17px">以目标应用客户区左上角为原点，不包含标题栏。</div>${button('从目标应用截图取点','pick-target','quiet wide','coordinate')}`}
    <details class="details"><summary>点击偏移</summary><div class="field-grid">${field('X 偏移 · 像素',input(t.offset_x||0,'data-dfield="offset_x"','number'))}${field('Y 偏移 · 像素',input(t.offset_y||0,'data-dfield="offset_y"','number'))}</div></details></div><footer class="modal-footer">${button('取消','close-modal')}${button('保存控件','save-target','primary')}</footer>`;
  }
  if(['picker','preview'].includes(m.kind)) {
    const preview=m.kind==='preview', shot=m.shot;
    modal.innerHTML=header(preview?'定位预览':'从目标应用截图选取')+`<div class="modal-body"><div class="image-stage-wrap"><div class="image-stage" id="image-stage"><img src="${shot.image}" alt="目标应用客户区截图"><div id="selection-overlay">${preview?previewOverlay(shot):''}</div></div></div><div class="capture-hint"><span id="pick-hint">${preview?esc(previewHint(shot)):m.returnModal.draft.kind==='image'?'拖动框选控件模板':'点击目标位置'}</span><span>${shot.width} × ${shot.height}</span></div>${preview?previewDetails(shot):''}</div><footer class="modal-footer">${button(preview?'关闭':'取消',preview?'close-modal':'cancel-pick')}${preview?'':button('使用此位置 / 区域','accept-pick','primary')}</footer>`;
  }
}
function defaultSelector(){return {name:'新控件',kind:'coordinate',x:.5,y:.5,normalized:true,image:'',threshold:.86,scales:[1],roi:null,offset_x:0,offset_y:0,recognition:'template',templates:[],mask:'',anchor:'',text:'',text_match:'exact',color_tolerance:null,library_id:''};}
async function editTarget(index=null){return editSharedControl(index);}
const thumbnailRequests=new Map(),thumbnailFailures=new Set(),thumbnailQueue=[];
let thumbnailActive=0;
function pumpThumbnails(){
  while(thumbnailActive<4&&thumbnailQueue.length){
    const {image,refresh,resolve}=thumbnailQueue.shift();thumbnailActive++;
    (async()=>{
      try{
        S.thumbnails[image]=(await api('template_preview',{image})).image;
        thumbnailFailures.delete(image);updateControlImages(image);
        if(refresh&&S.modal?.kind==='selector')renderModal();
      }catch{thumbnailFailures.add(image);updateControlImages(image,true);}
      finally{thumbnailActive--;thumbnailRequests.delete(image);resolve();pumpThumbnails();}
    })();
  }
}
async function thumbnail(image,refresh=false){
  if(!image||S.thumbnails[image]||(!refresh&&thumbnailFailures.has(image)))return;
  if(thumbnailRequests.has(image))return thumbnailRequests.get(image);
  const request=new Promise(resolve=>thumbnailQueue.push({image,refresh,resolve}));
  thumbnailRequests.set(image,request);pumpThumbnails();return request;
}
async function captureTarget(){
  if(!S.handle){toast('先连接目标窗口');return;}
  const previous=clone(S.modal);delete S.modal.addVariant;
  toast('正在截取目标应用画面…');
  try{
    const shot=await api('capture',{handle:S.handle});
    showModal({kind:'picker',shot,returnModal:previous,selection:null});
  }catch(error){showModal(previous);throw error;}
}
function pickPoint(event){const rectangle=document.querySelector('#image-stage').getBoundingClientRect();const shot=S.modal.shot;return [Math.max(0,Math.min(shot.width-1,Math.round((event.clientX-rectangle.left)/rectangle.width*shot.width))),Math.max(0,Math.min(shot.height-1,Math.round((event.clientY-rectangle.top)/rectangle.height*shot.height)))];}
function drawPick(point){const m=S.modal,shot=m.shot,image=m.returnModal.draft.kind==='image';m.selection=image?[Math.min(pickStart[0],point[0]),Math.min(pickStart[1],point[1]),Math.max(pickStart[0],point[0]),Math.max(pickStart[1],point[1])]:point;document.querySelector('#selection-overlay').innerHTML=image?`<div class="pick-rect" style="left:${m.selection[0]/shot.width*100}%;top:${m.selection[1]/shot.height*100}%;width:${(m.selection[2]-m.selection[0])/shot.width*100}%;height:${(m.selection[3]-m.selection[1])/shot.height*100}%"></div>`:`<i class="pick-point" style="left:${point[0]/shot.width*100}%;top:${point[1]/shot.height*100}%"></i>`;document.querySelector('#pick-hint').textContent=image?`区域 ${m.selection.join(', ')}`:`坐标 ${point.join(', ')}`;}
async function acceptPick(){const m=S.modal;if(!m.selection){toast('请先选取位置或区域');return;}const previous=m.returnModal;const t=previous.draft;if(t.kind==='image'){const image=(await api('save_template',{capture_id:m.shot.id,box:m.selection})).image;if(previous.addVariant){(t.templates||=[]).push({image,mask:''});delete previous.addVariant;}else{t.image=image;t.mask='';}await thumbnail(image);}else{t.x=t.normalized!==false?Number((m.selection[0]/(m.shot.width-1)).toFixed(6)):m.selection[0];t.y=t.normalized!==false?Number((m.selection[1]/(m.shot.height-1)).toFixed(6)):m.selection[1];}showModal(previous);}
async function saveTarget(){return saveSharedControl();}

function setProject(data){S.gameCasePath='';setLibrary(data.library);S.project=data.project;setControls(data.controls);S.path=data.path;S.recent=data.recent||S.recent;S.selected=0;S.dirty=false;S.stepStatus={};S.thumbnails={};api('dirty',{value:false,caseName:S.project.name}).catch(()=>{});render();}
async function save(asNew=false){if(lock())return;const data=await api('save_project',{project:S.project,as_new:asNew});if(data){setProject(data);toast('用例已保存','success');}}
async function run({stayOnGame=false}={}){
  if(lock())return;if(!S.handle)throw new Error('请先连接目标窗口');
  const iterations=S.iterations;
  if(!Number.isInteger(iterations)||iterations<1||iterations>1000)throw new Error('循环次数需在 1 ~ 1000 之间');
  S.busy='running';S.logs=[];S.lastResult=null;S.stepStatus={};if(!stayOnGame)S.view='runs';render();
  try{await api('run',{project:S.project,handle:S.handle,iterations});log('开始执行 '+S.project.name);}catch(error){S.busy='';render();throw error;}
}
async function replayRecording(){
  if(lock())return;
  const pending=S.recordPending;
  if(!pending||!pending.project.steps.some(step=>step.enabled!==false))return;
  if(!S.handle)throw new Error('请先连接目标窗口');
  const project=clone(pending.project);project.name='录制重放 · '+project.name;
  S.recordReplaying=true;S.recordReplayRun=null;S.busy='running';S.logs=[];S.lastResult=null;render();
  try{
    await api('run',{project,handle:S.handle,iterations:1,source:'recording'});
    log('开始重放本次录制');
  }catch(error){
    S.recordReplaying=false;S.busy='';S.view='record';render();
    await api('workbench_show').catch(()=>{});throw error;
  }
}
function log(message,type=''){S.logs.push({message,type,time:new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date())});if(S.logs.length>1000)S.logs.shift();}
async function reports(){S.reports=await api('reports');if(S.view==='runs')render();}
async function startRecord(){
  if(S.recordPending){S.view='record';render();toast('请先将上一段录制加入用例，或丢弃后重新录制');return;}
  if(lock())return;if(!S.handle)throw new Error('请先连接目标窗口');
  S.recordReplayRun=null;S.recordReplaying=false;
  S.recordStart=0;S.recordCount=0;S.recordEvents=[];S.recordStarting=true;S.busy='recording';S.view='record';
  if(S.view==='game')updateGameControls();else render();
  try{await api('record_start',{handle:S.handle});}catch(error){S.busy='';throw error;}finally{S.recordStarting=false;if(S.view==='game')updateGameControls();else render();}
}
async function retryEmptyRecording(){
  if(lock()||!S.recordPending||S.recordPending.raw_count!==0)return;
  await api('record_reviewed');
  S.recordPending=null;
  await startRecord();
}
async function acceptRecording(asNew){
  if(lock())return;
  const pending=S.recordPending;if(!pending)return;
  if(asNew){if(!await canReplace())return;const data=await api('new_project');setProject(data);S.project.name='录制用例 · '+new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());}
  const imported=await api('control_import',{project:pending.project,category_id:S.targetCategory==='all'?'':S.targetCategory});
  setControls(imported.controls);const generated=imported.project;
  for(const target of generated.selectors)useControl(target.name);
  S.project.steps.push(...generated.steps);
  S.selected=Math.max(0,S.project.steps.length-generated.steps.length);S.recordPending=null;await api('record_reviewed');S.view='cases';S.stepStatus={};dirty();render();toast('录制已转换为测试步骤','success');
}

async function handleAction(action,node){
  if(action==='close-modal'||action==='confirm-no'){closeModal();return;}
  if(action==='confirm-yes'){
    if(S.modal?.kind!=='confirm'||!confirmation||lock())return;
    const resolve=confirmation;confirmation=null;closeModal();resolve(true);return;
  }
  const index=Number(node.dataset.i);
  if(SHARED_CONTROL_ACTIONS.has(action)){await sharedControlAction(action,node);return;}
  if(action==='help-section'){document.getElementById('guide-'+node.dataset.section)?.scrollIntoView({block:'start',behavior:'smooth'});return;}
  if(action==='record-replay')return replayRecording();
  if(action==='case-refresh')return refreshCases();
  if(action==='case-folder')return api('case_folder');
  if(action==='case-open'){
    if(lock()||!await canReplace())return;
    const data=await api('open_case',{path:node.dataset.path});setProject(data);S.view='cases';render();return;
  }
  if(action==='audit-refresh')return refreshAudit();
  if(action==='audit-folder')return api('audit_folder');
  if(action==='audit-export'){const result=await api('audit_export');if(result)toast('日志已导出','success');return;}
  if(action==='audit-detail'){S.auditSelected=S.auditEntries.find(entry=>entry.id===node.dataset.id);render();return;}
  if(action==='view-game')return api('game_open');
  if(action.startsWith('view-')){S.view=action.slice(5);render();if(S.view==='cases')await refreshCases();if(S.view==='runs')await reports();if(S.view==='diagnostics')await refreshAudit();if(S.view==='targets')await refreshControls();return;}
  if(action==='game-pick-coordinate')return pickGameControl('coordinate');
  if(action==='game-pick-image')return pickGameControl('image');
  if(action==='step-menu')return menu(node);
  if(action==='case-menu'){const rect=node.getBoundingClientRect();document.querySelector('#menu-root').innerHTML=`<div class="menu" style="left:${Math.min(rect.left,innerWidth-270)}px;top:${rect.bottom+6}px"><button class="menu-item" data-act="save-as">${icon('save')}另存为</button><button class="menu-item" data-act="new">${icon('plus')}新建用例</button><button class="menu-item" data-act="open">${icon('folder')}打开用例</button></div>`;return;}
  document.querySelector('#menu-root').innerHTML='';
  if(action==='add-step')return addStep(node.dataset.action);
  if(action==='script-edit'){
    if(lock())return;const step=S.project.steps[S.selected];if(step?.action!=='python')return;
    showModal({kind:'script',index:S.selected,code:step.params.code||''});return;
  }
  if(action==='script-apply'){
    if(lock()||S.modal?.kind!=='script')return;
    const step=S.project.steps[S.modal.index];if(step?.action!=='python')throw new Error('脚本步骤已变化');
    step.params.code=document.querySelector('#script-code').value;closeModal();dirty();render();return;
  }
  if(action==='script-import'){
    if(lock())return;const step=S.project.steps[S.selected];if(step?.action!=='python')return;
    const data=await api('script_import');if(!data)return;
    if(lock()||!S.project.steps.includes(step))return;
    step.params.code=data.code;step.name=data.name;dirty();render();toast('脚本已导入，代码随用例保存','success');return;
  }
  if(action==='save')return save();
  if(action==='save-as')return save(true);
  if(action==='new'||action==='open'||action==='recent'){
    if(lock()||!await canReplace())return;
    const data=await api(action==='new'?'new_project':action==='recent'?'open_recent':'open_project',action==='recent'?{index}:{});
    if(data){setProject(data);S.view='cases';render();}return;
  }
  if(action==='refresh')return refreshGameWindows();
  if(action==='game-connect')return reconnectGame();
  if(action==='copy-step'){if(lock())return;S.project.steps.splice(index+1,0,clone(S.project.steps[index]));S.selected=index+1;S.project.steps[S.selected].name+=' · 副本';dirty();render();return;}
  if(action==='delete-step'){if(lock())return;S.project.steps.splice(index,1);S.selected=Math.min(index,S.project.steps.length-1);S.stepStatus={};dirty();render();return;}
  if(action==='new-target')return editTarget();
  if(action==='edit-target')return editTarget(index);
  if(action==='target-mode'){S.modal.draft.kind=node.dataset.mode;renderModal();return;}
  if(action==='pick-target')return captureTarget();
  if(action==='pick-variant'){if((S.modal.draft.templates||[]).length>=10)throw new Error('附加模板最多 10 张');S.modal.addVariant=true;return captureTarget();}
  if(action==='import-variant'){const t=S.modal.draft;if((t.templates||[]).length>=10)throw new Error('附加模板最多 10 张');const result=await api('import_template');if(result){(t.templates||=[]).push({image:result.image,mask:''});renderModal();}return;}
  if(action==='remove-variant'){S.modal.draft.templates.splice(Number(node.dataset.variant),1);renderModal();return;}
  if(action==='import-mask'||action==='clear-mask'){const index=Number(node.dataset.variant),t=S.modal.draft,owner=index<0?t:t.templates[index];if(action==='clear-mask')owner.mask='';else{const result=await api('import_template');if(result)owner.mask=result.image;}renderModal();return;}
  if(action==='cancel-pick'){showModal(S.modal.returnModal);return;}
  if(action==='accept-pick')return acceptPick();
  if(action==='save-target')return saveTarget();
  if(action==='import-image'){const result=await api('import_template');if(result){S.modal.draft.image=result.image;S.modal.draft.mask='';await thumbnail(result.image);renderModal();}return;}
  if(action==='run')return run();
  if(action==='game-run')return runGameCase();
  if(action==='stop')return api('stop');
  if(action==='record-start')return startRecord();
  if(action==='record-retry')return retryEmptyRecording();
  if(action==='record-append')return acceptRecording(false);
  if(action==='record-new')return acceptRecording(true);
  if(action==='record-discard'){if(lock())return;if(await confirm('丢弃本次录制？','已转换的原始录制文件仍保存在本机 recordings 目录。')){S.recordPending=null;await api('record_reviewed');render();}return;}
  if(action==='refresh-reports')return reports();
  if(action==='open-report')return api('open_report',{id:node.dataset.id});
}

document.addEventListener('click',event=>{
  const node=event.target.closest('[data-act]');
  if(node&&S.mcpOperation&&node.dataset.act!=='stop'&&!node.dataset.act.startsWith('view-')&&!['close-modal','confirm-no','audit-refresh','audit-detail','refresh-reports','open-report','help-section','control-filter','control-refresh','control-clear-search'].includes(node.dataset.act)){toast('MCP 正在操作工作台，请稍候');return;}
  if(node&&!node.disabled){handleAction(node.dataset.act,node).catch(error=>{window.reportStudioError(error,node.dataset.act);toast(error.message,'error');});return;}
  if(!event.target.closest('.menu'))document.querySelector('#menu-root').innerHTML='';
  const row=event.target.closest('[data-step]');if(row){S.selected=Number(row.dataset.step);render();}
});
document.addEventListener('input',event=>{
  if(event.target.id==='help-search'){S.helpSearch=event.target.value;document.querySelector('.help-results').innerHTML=StudioHelp.contents(S.helpSearch);return;}
  const node=event.target;
  if(node.id==='control-picker-search'&&S.modal?.kind==='control-picker'){S.modal.search=node.value;renderControlPickerResults();return;}
  if(node.id==='target-search'){S.targetSearch=node.value;const start=node.selectionStart;render();const field=document.querySelector('#target-search');field.focus();field.setSelectionRange(start,start);return;}
  if(node.hasAttribute('data-category-name')&&S.modal?.kind==='category-editor'){S.modal.name=node.value;return;}
  if((S.busy||S.gameRunStarting||S.mcpOperation)&&node.closest('#app'))return;
  if(node.id==='game-iterations'){S.iterations=Number(node.value);return;}
  if(node.id==='iterations'){S.iterations=Number(node.value);return;}
  if(node.hasAttribute('data-project-name')){S.project.name=node.value;dirty();return;}
  if(node.dataset.sfield&&node.dataset.sfield!=='action'){
    const step=S.project.steps[S.selected];if(!step)return;const key=node.dataset.sfield;if(['target','end_target'].includes(key)&&node.value)useControl(node.value);step[key]=node.type==='checkbox'?node.checked:node.type==='number'?Number(node.value):node.value;dirty();
    const row=document.querySelector(`[data-step="${S.selected}"] .step-copy strong`);if(key==='name'&&row)row.textContent=node.value;
  }
  if(node.dataset.param){const step=S.project.steps[S.selected];step.params||={};step.params[node.dataset.param]=node.type==='number'?Number(node.value):node.value;dirty();}
  if(node.dataset.dfield&&S.modal?.kind==='selector'){
    const key=node.dataset.dfield,t=S.modal.draft;
    if(['scales','roi'].includes(key))t[key]=node.value.trim()?node.value.split(',').map(value=>Number(value.trim())):key==='roi'?null:[];
    else t[key]=key==='color_tolerance'&&node.value.trim()===''?null:node.type==='checkbox'?node.checked:node.type==='number'?Number(node.value):node.value;if(['recognition','anchor'].includes(key))renderModal();
  }
});
document.addEventListener('change',event=>{
  const node=event.target;
  if((S.busy||S.gameRunStarting||S.mcpOperation)&&node.closest('#app'))return;
  if(node.id==='control-category-choice'&&S.modal?.kind==='selector'){S.modal.categoryId=node.value;return;}
  if(node.id==='game-case'){if(!S.busy)S.gameCasePath=node.value;return;}
  if(node.id==='connection'){connectGame(node.value).catch(error=>toast(error.message,'error'));return;}
  if(node.dataset.sfield==='action'){
    const step=S.project.steps[S.selected];step.action=node.value;step.name=A[node.value];step.params=clone(DEFAULTS[node.value]||{});
    if(step.action==='python')step.timeout=30;
    if(IMAGES.has(step.action)&&!controlSelectors().some(t=>t.name===step.target&&t.kind==='image'))step.target=controlSelectors().find(t=>t.kind==='image')?.name||'';
    if(TARGETS.has(step.action)&&step.target)useControl(step.target);
    dirty();render();
  }
});
document.addEventListener('dragstart',event=>{const row=event.target.closest('[data-step]');if(row&&!S.busy&&!S.mcpOperation){dragIndex=Number(row.dataset.step);event.dataTransfer.effectAllowed='move';}});
document.addEventListener('dragover',event=>{const row=event.target.closest('[data-step]');if(row&&dragIndex!==null){event.preventDefault();document.querySelectorAll('.drop-target').forEach(node=>node.classList.remove('drop-target'));row.classList.add('drop-target');}});
document.addEventListener('drop',event=>{const row=event.target.closest('[data-step]');if(row&&dragIndex!==null&&!S.busy&&!S.mcpOperation){event.preventDefault();const destination=Number(row.dataset.step);const [step]=S.project.steps.splice(dragIndex,1);S.project.steps.splice(destination,0,step);S.selected=destination;dragIndex=null;S.stepStatus={};dirty();render();}});
document.addEventListener('dragend',()=>{dragIndex=null;document.querySelectorAll('.drop-target').forEach(node=>node.classList.remove('drop-target'));});
document.addEventListener('pointerdown',event=>{if(S.modal?.kind==='picker'&&event.target.closest('#image-stage')){pickStart=pickPoint(event);drawPick(pickStart);event.target.closest('#image-stage').setPointerCapture(event.pointerId);}});
document.addEventListener('pointermove',event=>{if(pickStart&&S.modal?.kind==='picker'&&event.buttons)drawPick(pickPoint(event));});
document.addEventListener('pointerup',()=>{pickStart=null;});
modal.addEventListener('cancel',event=>{event.preventDefault();closeModal();});
document.addEventListener('keydown',event=>{
  if(event.key==='F1'&&!modal.open){event.preventDefault();handleAction('view-help',{dataset:{}}).catch(error=>toast(error.message,'error'));return;}
  if(event.key==='Tab'&&event.target.matches?.('textarea.python-editor')&&!event.target.disabled){
    event.preventDefault();const node=event.target;node.setRangeText('    ',node.selectionStart,node.selectionEnd,'end');node.dispatchEvent(new Event('input',{bubbles:true}));return;
  }
  if(event.ctrlKey&&event.key.toLowerCase()==='s'){
    event.preventDefault();if(S.modal?.kind==='script'){handleAction('script-apply',{dataset:{}}).catch(error=>toast(error.message,'error'));return;}
    save(event.shiftKey).catch(error=>toast(error.message,'error'));
  }
  if(event.key==='F12'&&S.busy){event.preventDefault();api('stop').catch(error=>toast(error.message,'error'));}
});

window.studio.onEvent(event=>{
  if(event.kind==='workbench_state'){
    const changed=S.busy!==event.busy||S.recordStarting!==event.recordStarting||S.mcpOperation!==event.mcpOperation;
    S.busy=event.busy;S.recordStarting=event.recordStarting;S.mcpOperation=event.mcpOperation;
    if(changed)render();return;
  }
  if(event.kind==='project_loaded'){setProject(event);S.view='cases';render();return;}
  if(event.kind==='audit_entry'){
    if(S.view==='diagnostics'){clearTimeout(auditTimer);auditTimer=setTimeout(()=>refreshAudit().catch(()=>{}),200);}
    return;
  }
  if(event.kind==='game_connection'){S.connection=event.connection;S.handle=S.connection?.handle||null;render();return;}
  if(event.kind==='run_state'){receiveRunState(event.run);return;}
  if(event.kind==='game_action'){(event.action==='run'?runGameCase(event.casePath,event.iterations??S.iterations):handleAction(event.action,{dataset:{}})).catch(error=>{toast(error.message,'error');api('renderer_error',{message:error.message,stack:error.stack,action:event.action}).catch(()=>{});});return;}
  if(event.kind==='step'){if(S.runState?.source!=='recording')S.stepStatus[event.index]=event.status;log(`${event.status==='running'?'执行':'完成'}步骤 ${event.index+1} · ${event.name}${event.error?' · '+event.error:''}`,event.status==='failed'?'error':event.status==='passed'?'success':'');}
  if(event.kind==='notice')toast(event.message,event.level==='error'?'error':'');
  if(['log','match','notice'].includes(event.kind))log(event.message,event.kind==='log'?'error':'');
  if(event.kind==='finished'){S.busy='';if(S.recordReplaying){S.recordReplaying=false;S.view='record';api('workbench_show').catch(()=>{});}S.lastResult={...event.result,id:event.directory.split(/[\\/]/).at(-1)};log(`执行结束 · ${LABELS[event.result.status]}`,event.result.status==='failed'?'error':'success');reports().catch(()=>{});}
  if(['run_error','service_error'].includes(event.kind)){S.recordStarting=false;S.busy='';if(S.recordReplaying){S.recordReplaying=false;S.view='record';api('workbench_show').catch(()=>{});}log(event.message,'error');toast(event.message,'error');}
  if(event.kind==='record_started'){S.recordStarting=false;S.busy='recording';S.recordStart=Date.now();S.recordCount=0;S.recordEvents=[];}
  if(event.kind==='record_event'){S.recordCount=event.count;S.recordEvents.push(event.event);if(S.recordEvents.length>50)S.recordEvents.shift();if(S.view==='record'&&document.querySelector('#live-events'))document.querySelector('#live-events').innerHTML=liveEvents();const status=document.querySelector('.game-status span');if(status)status.textContent=`正在录制 · ${S.recordCount} 个事件`;return;}
  if(event.kind==='record_stopped'){S.busy='';S.recordReplaying=false;S.recordReplayRun=null;S.recordPending=event;S.view='record';}
  if(event.kind==='record_error'){S.recordStarting=false;S.busy='';toast(event.message,'error');}
  if(S.view==='game'&&['step','finished','log','match','notice','run_error','service_error','record_started','record_error'].includes(event.kind)){updateGameControls();return;}
  render();
});
setInterval(()=>{RunPanel.tick(document.querySelector('#game-run-results'),S.runState);RunPanel.tick(document.querySelector('#record-replay-results'),S.recordReplayRun);const clock=document.querySelector('#record-clock');if(clock&&S.busy==='recording')clock.textContent=elapsed();},500);
async function bootstrap(){
  try{const data=await api('bootstrap');S.windows=data.windows;S.admin=data.admin;const candidate=data.windows.find(w=>w.handle===data.preferredHandle);S.handle=null;setProject(data);await reports();if(data.autoConnect&&candidate){try{await connectGame(candidate.handle);}catch(error){toast(error.message,'error');}}window.__studioReady=true;}
  catch(error){window.__studioErrors.push(error.message);root.innerHTML=`<div class="loading"><div class="empty"><strong>测试服务未能启动</strong><p>${esc(error.message)}</p><p>请确认 Python 和依赖已安装，再重新打开工作台。</p></div></div>`;toast(error.message,'error');}
}
bootstrap();

let auditTimer;
async function refreshAudit(){const focused=document.activeElement?.id,caret=document.activeElement?.selectionStart;const data=await api('audit_list',{level:S.auditLevel,search:S.auditSearch});S.auditEntries=data.entries;S.auditDirectory=data.directory;if(S.view==='diagnostics'){render();if(focused==='audit-search'){const input=document.querySelector('#audit-search');input?.focus();input?.setSelectionRange(caret,caret);}}}
function diagnosticsView(){
 const selected=S.auditSelected;
 return `<div class="page-heading"><div><h1>错误日志</h1><p class="sub">连接、录制、采集、执行和窗口切换的诊断记录，重启后仍保留。</p></div><div class="heading-actions">${button('刷新','audit-refresh','','refresh')}${button('打开日志目录','audit-folder','','folder')}${button('导出日志','audit-export','primary','upload')}</div></div>
 <div class="audit-filters"><select id="audit-level" aria-label="日志等级">${options([['','全部等级'],['error','错误'],['warning','提醒'],['info','操作记录']],S.auditLevel)}</select><input id="audit-search" placeholder="搜索功能、错误原因或日志编号" value="${esc(S.auditSearch)}"><span class="small">最近 ${S.auditEntries.length} 条 · 导出最多 1000 条</span></div>
 <div class="audit-layout"><div><table class="report-table"><thead><tr><th>时间</th><th>等级</th><th>功能 / 阶段</th><th>原因</th><th></th></tr></thead><tbody>${S.auditEntries.map(entry=>`<tr><td>${esc(new Date(entry.time).toLocaleString('zh-CN',{hour12:false}))}</td><td><span class="badge ${entry.level==='error'?'failed':entry.level==='warning'?'stopped':'passed'}">${{error:'错误',warning:'提醒',info:'记录'}[entry.level]}</span></td><td>${esc(entry.operation)}<br><span class="small">${esc(entry.stage)}</span></td><td>${esc(entry.message||'—')}</td><td>${button('详情','audit-detail','ghost','',`data-id="${esc(entry.id)}"`)}</td></tr>`).join('')}</tbody></table>${!S.auditEntries.length?'<div class="empty compact">没有匹配的日志</div>':''}</div>${selected?`<aside class="audit-detail"><strong>日志 #${esc(selected.id)}</strong><pre>${esc(JSON.stringify(selected,null,2))}</pre></aside>`:''}</div><p class="small audit-path">${esc(S.auditDirectory)}</p>`;
}
document.addEventListener('change',event=>{if(event.target.id==='audit-level'){S.auditLevel=event.target.value;refreshAudit().catch(error=>toast(error.message,'error'));}});
document.addEventListener('input',event=>{
  if(event.target.id==='help-search'){S.helpSearch=event.target.value;document.querySelector('.help-results').innerHTML=StudioHelp.contents(S.helpSearch);return;}if(event.target.id==='audit-search'){S.auditSearch=event.target.value;clearTimeout(auditTimer);auditTimer=setTimeout(()=>refreshAudit().catch(error=>toast(error.message,'error')),350);}});

document.addEventListener('toggle',event=>{if(event.target.matches?.('.case-library'))S.libraryOpen=event.target.open;},true);
document.addEventListener('input',event=>{
  if(event.target.id==='help-search'){S.helpSearch=event.target.value;document.querySelector('.help-results').innerHTML=StudioHelp.contents(S.helpSearch);return;}if(event.target.id==='case-search'){S.caseSearch=event.target.value;const position=event.target.selectionStart;render();const input=document.querySelector('#case-search');input?.focus();input?.setSelectionRange(position,position);}});
window.addEventListener('focus',()=>{if(window.__studioReady&&['cases','game'].includes(S.view))refreshCases().catch(error=>toast(error.message,'error'));});

