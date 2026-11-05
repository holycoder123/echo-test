const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {FloatingToolbar}=require('../floating-toolbar.cjs');
function fixture(){
  let handler;const windows=[],actions=[];
  class FakeWindow extends EventEmitter{
    constructor(options){super();this.options=options;this.destroyed=false;this.sent=[];this.webContents=new EventEmitter();this.webContents.mainFrame={url:'echo-test://studio/floating.html'};this.webContents.send=(...args)=>this.sent.push(args);this.webContents.setWindowOpenHandler=()=>{};windows.push(this);}
    setContentProtection(value){this.protected=value;}loadURL(url){this.url=url;}showInactive(){this.shown=true;}isDestroyed(){return this.destroyed;}destroy(){this.destroyed=true;this.emit('closed');}
  }
  const toolbar=new FloatingToolbar({BrowserWindow:FakeWindow,screen:{getCursorScreenPoint:()=>({x:0,y:0}),getDisplayNearestPoint:()=>({workArea:{x:0,y:0,width:1920,height:1080}})},ipcMain:{handle:(_name,callback)=>handler=callback},onAction:async action=>actions.push(action)});
  return {toolbar,windows,actions,call:(event,action)=>handler(event,action)};
}
test('toolbar follows binding lifecycle and updates state without taking focus',()=>{
  const f=fixture();f.toolbar.update({connection:null});assert.equal(f.windows.length,0);
  f.toolbar.update({connection:{handle:1},busy:''});const win=f.windows[0];win.webContents.emit('did-finish-load');assert.equal(win.shown,true);assert.equal(win.options.focusable,false);assert.equal(win.options.alwaysOnTop,true);assert.equal(win.protected,true);
  f.toolbar.update({connection:{handle:2},busy:'recording'});assert.equal(f.windows.length,1);assert.equal(win.sent.at(-1)[1].busy,'recording');
  f.toolbar.update({connection:null});assert.equal(win.destroyed,true);assert.equal(f.toolbar.window,null);
});
test('only toolbar main frame may send the four supported actions',async()=>{
  const f=fixture();f.toolbar.update({connection:{handle:1}});const win=f.windows[0],event={sender:win.webContents,senderFrame:win.webContents.mainFrame};
  for(const action of ['record','stop','screenshot','workbench'])await f.call(event,action);
  assert.equal(f.actions.length,4);await assert.rejects(f.call(event,'run'));await assert.rejects(f.call({...event,senderFrame:{url:win.url}},'record'));await assert.rejects(f.call({...event,sender:{}},'record'));
});

function editorFixture(recorded=false){
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
  const calls=[],original={name:'原步骤',action:'click'};
  const context={S:{connection:{handle:123},project:{steps:[original],mode:'lowcode'},selected:0,wb:{selection:[]},busy:recorded?'recording':''},window:{__studioReady:true,addEventListener(){}},document:{addEventListener(){}},api:async(method,args)=>{calls.push({method,args});return method==='floating_screenshot'?{path:'screen.png',recorded}:{};},dirty(){context.S.dirty=true;},render(){},log(){},toast(){}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../renderer/workbench.js'),'utf8'),context);
  return {context,calls,original};
}
test('idle screenshot inserts after selection and marks draft dirty',async()=>{
  const {context,calls,original}=editorFixture();await context.workbenchFloatingAction({id:'a',handle:123,action:'screenshot'});
  assert.equal(context.S.project.steps.length,2);assert.equal(context.S.project.steps[0],original);assert.equal(context.S.project.steps[1].action,'screenshot');assert.equal(context.S.selected,1);assert.equal(context.S.dirty,true);assert.equal(calls.at(-1).args.error,'');
});
test('recording screenshot stays in recording stream without duplicate draft insertion',async()=>{
  const {context,calls}=editorFixture(true);await context.workbenchFloatingAction({id:'b',handle:123,action:'screenshot'});
  assert.equal(context.S.project.steps.length,1);assert.equal(calls.at(-1).args.error,'');
});
test('Python cases and stale connections reject screenshot without changing project',async()=>{
  const {context,calls}=editorFixture();context.S.project.mode='python';await context.workbenchFloatingAction({id:'c',handle:123,action:'screenshot'});
  assert.equal(calls.some(c=>c.method==='floating_screenshot'),false);assert.match(calls.at(-1).args.error,/Python/);assert.equal(context.S.project.steps.length,1);
  await context.workbenchFloatingAction({id:'d',handle:456,action:'screenshot'});assert.match(calls.at(-1).args.error,/目标窗口已变化/);
});
