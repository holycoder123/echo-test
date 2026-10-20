const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');

const DEFAULTS={
  shortcuts:{run:'F6',record:'F7',screenshot:'F8',pick:'Ctrl+Alt+W',show:'Ctrl+Alt+E',stop:'F12'},
  mcp:{enabled:true,explorationTimeout:15},
  startup:{admin:true,rememberBounds:true,closeAction:'exit'},
  target:{refreshSeconds:3,defaultMode:'pick',autoToolbar:true,linkToolbar:true,filter:''},
  history:{retentionDays:30},
};
const clone=value=>JSON.parse(JSON.stringify(value));
function shortcut(value){
  if(typeof value!=='string'||value.length>80)throw new Error('无效的快捷键');
  if(!value)return '';
  const parts=value.split('+'),key=parts.pop().toUpperCase();
  const aliases={CONTROL:'Ctrl',CTRL:'Ctrl',COMMANDORCONTROL:'Ctrl',CMDORCTRL:'Ctrl',ALT:'Alt',SHIFT:'Shift',SUPER:'Super',META:'Super'};
  const modifiers=parts.map(part=>aliases[part.toUpperCase()]);
  if(modifiers.some(item=>!item)||new Set(modifiers).size!==modifiers.length||!/^(F([1-9]|1[0-9]|2[0-4])|[A-Z0-9]|SPACE|HOME|END|INSERT|DELETE|PAGEUP|PAGEDOWN)$/.test(key))throw new Error('快捷键格式示例：F6 或 Ctrl+Alt+W');
  if(!/^F\d+$/.test(key)&&!modifiers.some(item=>['Ctrl','Alt','Super'].includes(item)))throw new Error('字母或数字快捷键需要 Ctrl、Alt 或 Super 修饰键');
  return [...['Ctrl','Alt','Shift','Super'].filter(item=>modifiers.includes(item)),key].join('+');
}
function validateSettings(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('设置格式无效');
  const result=clone(DEFAULTS);
  for(const [section,fields] of Object.entries(value)){
    if(!Object.hasOwn(DEFAULTS,section)||!fields||typeof fields!=='object'||Array.isArray(fields))throw new Error('未知的设置分组');
    for(const [key,item] of Object.entries(fields)){
      if(!Object.hasOwn(DEFAULTS[section],key))throw new Error('未知的设置项');
      const expected=DEFAULTS[section][key];
      if(typeof item!==typeof expected)throw new Error('设置值类型无效');
      result[section][key]=section==='shortcuts'?shortcut(item):item;
    }
  }
  const unique=new Set();
  for(const [action,key] of Object.entries(result.shortcuts)){
    if(!key)continue;
    if((key==='F12'&&action!=='stop')||['F1','Ctrl+S','Ctrl+Shift+S'].includes(key)||unique.has(key))throw new Error('快捷键重复或与 F12、F1、保存快捷键冲突');
    unique.add(key);
  }
  if(!result.shortcuts.stop)throw new Error('停止快捷键不能为空，F12 始终可用');
  if(!Number.isInteger(result.mcp.explorationTimeout)||result.mcp.explorationTimeout<1||result.mcp.explorationTimeout>30)throw new Error('探索超时需为 1 ~ 30 秒');
  if(!['exit','tray'].includes(result.startup.closeAction))throw new Error('无效的关闭行为');
  if(![0,3,5,10,30].includes(result.target.refreshSeconds))throw new Error('无效的窗口刷新间隔');
  if(!['pick','search'].includes(result.target.defaultMode))throw new Error('无效的窗口选择模式');
  if(result.target.filter.length>200)throw new Error('窗口搜索条件最多 200 个字符');
  if(![7,30,90,180,365].includes(result.history.retentionDays))throw new Error('无效的历史保留天数');
  return result;
}
class SettingsStore{
  constructor(directory){this.file=path.join(directory,'settings.json');this.value=clone(DEFAULTS);this.warning='';
    try{this.value=validateSettings(JSON.parse(fs.readFileSync(this.file,'utf8')));}catch(error){if(error.code!=='ENOENT')this.warning='设置文件读取失败，已使用默认值：'+error.message;}
  }
  save(value){const next=validateSettings(value);fs.mkdirSync(path.dirname(this.file),{recursive:true});const temporary=this.file+'.'+randomUUID()+'.tmp';
    try{fs.writeFileSync(temporary,JSON.stringify(next,null,2)+'\n',{encoding:'utf8',flag:'wx'});fs.renameSync(temporary,this.file);this.value=next;this.warning='';}
    finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}return clone(this.value);
  }
}
// Registration is transactional: restore previous bindings if any key is occupied.
class ShortcutRegistry{
  constructor(api,callback){this.api=api;this.callback=callback;this.bindings=new Map();}
  replace(settings){
    const previous=this.bindings,next=new Map();
    for(const key of previous.keys())this.api.unregister(key);
    try{
      for(const [action,key] of Object.entries(settings))if(key&&key!=='F12'){
        if(!this.api.register(key,()=>this.callback(action)))throw new Error('快捷键已被其他程序占用：'+key);
        next.set(key,action);
      }
      this.bindings=next;
    }catch(error){for(const key of next.keys())this.api.unregister(key);this.bindings=new Map();
      for(const [key,action] of previous)if(this.api.register(key,()=>this.callback(action)))this.bindings.set(key,action);
      throw error;
    }
  }
}
module.exports={DEFAULTS,validateSettings,SettingsStore,ShortcutRegistry};
