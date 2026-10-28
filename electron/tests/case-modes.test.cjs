const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../renderer/case-modes.js'),'utf8');
function context(steps=[]){
  return vm.createContext({S:{project:{name:'原用例',steps,selectors:[]},selected:0,busy:'',controls:{entries:[]}},clone:structuredClone});
}
const loop=()=>({action:'loop',params:{variable:'i',start:2,end:3,step:1}});
const end=()=>({action:'end_loop'});
test('loop selection identifies whole nested groups from either marker',()=>{
  const c=context([loop(),{action:'text'},loop(),{action:'click'},end(),end()]);vm.runInContext(source,c);
  assert.equal(vm.runInContext('JSON.stringify(caseGroupBounds(S.project.steps,0))',c),'[0,5]');
  assert.equal(vm.runInContext('JSON.stringify(caseGroupBounds(S.project.steps,4))',c),'[2,4]');
});
test('moving a loop keeps its body paired and refuses moving into itself',()=>{
  const c=context([loop(),{action:'text'},end(),{action:'click'}]);vm.runInContext(source,c);
  assert.equal(vm.runInContext('moveCaseGroup(0,1)',c),false);
  assert.equal(vm.runInContext('moveCaseGroup(0,3)',c),true);
  assert.equal(c.S.project.steps.map(s=>s.action).join(','),'click,loop,text,end_loop');
});
test('Python control insertion uses stable ID and escapes control names',()=>{
  const c=context();vm.runInContext(source,c);
  c.target={name:'按钮"\n',library_id:'a'.repeat(32)};
  assert.equal(vm.runInContext('pythonControlReference(target)',c),`controls.by_id("${'a'.repeat(32)}")`);
  c.target.library_id='';
  assert.equal(vm.runInContext('pythonControlReference(target)',c),'controls["按钮\\"\\n"]');
});
test('Python copies preserve the current low-code draft and reset save identity',async()=>{
  const c=context([{action:'text',params:{text:'original'}}]);const calls=[];
  Object.assign(c,{lock:()=>false,dirty:()=>{c.S.dirty=true;},render:()=>{},toast:()=>{},api:async(method,args)=>{
    calls.push({method,args});
    if(method==='python_copy')return {project:{name:'原用例 · Python',mode:'python',code:'print(1)',steps:[],selectors:[]}};
    return {};
  }});c.S.path='C:/cases/source.echo.json';c.S.dirty=true;vm.runInContext(source,c);
  await vm.runInContext('createPythonCopy()',c);
  assert.equal(c.S.project.mode,'python');assert.equal(c.S.path,null);
  assert.equal(c.S.modeSource.project.steps[0].params.text,'original');
  assert.equal(calls.find(call=>call.method==='python_copy').args.project.steps[0].params.text,'original');
  c.S.project.code='changed';assert.equal(c.S.modeSource.project.mode,undefined);
  assert.equal(calls.some(call=>call.method==='save_project'),false);
  assert.equal(calls.some(call=>call.method==='case_context'&&call.args.path===null),true);
});
