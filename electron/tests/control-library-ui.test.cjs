const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../renderer/controls.js'),'utf8');
function referenced(project){
  const context=vm.createContext({S:{project}});vm.runInContext(source,context);
  // A broken synchronous traversal must fail promptly instead of hanging the test process.
  return JSON.parse(vm.runInContext('JSON.stringify(projectControlIds())',context,{timeout:500}));
}
test('opening the control library terminates when steps reference absent selector definitions',()=>{
  assert.deepEqual(referenced({steps:[{target:'缺失控件'},{target:'另一个控件',end_target:'终点'}],selectors:[]}),[]);
});
test('reference traversal examines every selector without consuming another queued target',()=>{
  assert.deepEqual(referenced({steps:[{target:'按钮'}],selectors:[
    {name:'无关控件',kind:'coordinate',library_id:'unused'},
    {name:'按钮',kind:'image',anchor:'标题',library_id:'button'},
    {name:'标题',kind:'image',anchor:'上级标题',library_id:'title'},
    {name:'上级标题',kind:'image',library_id:'parent'},
  ]}),['button','title','parent']);
});
test('missing anchors and cyclic snapshots cannot hang library reference traversal',()=>{
  assert.deepEqual(referenced({steps:[{target:'按钮'}],selectors:[
    {name:'按钮',kind:'image',anchor:'标题',library_id:'button'},
    {name:'标题',kind:'image',anchor:'按钮',library_id:'title'},
  ]}),['button','title']);
  assert.deepEqual(referenced({steps:[{target:'按钮'}],selectors:[{name:'按钮',kind:'image',anchor:'已删除',library_id:'button'}]}),['button']);
});

function deletionHarness({steps=[],accept=true,entries}={}){
  const selector={name:'按钮',kind:'image',image:'assets/button.png',library_id:'button'};
  const state={project:{steps,selectors:[selector]},controls:{
    entries:entries||[{id:'button',selector}],categories:[],
  }};
  const calls=[];
  const context=vm.createContext({
    S:state,clone:structuredClone,lock:()=>false,
    confirm:async()=>{calls.push('confirm');return accept;},
    api:async(method,args)=>{
      calls.push({method,args:JSON.parse(JSON.stringify(args))});
      return {...state.controls,entries:state.controls.entries.filter(entry=>entry.id!==args.id)};
    },
    render:()=>calls.push('render'),
  });
  vm.runInContext(source,context);
  return {state,calls,remove:()=>vm.runInContext("sharedControlAction('delete-target',{dataset:{i:'0'}})",context)};
}
test('deleting an unused image control confirms, deletes and refreshes the library',async()=>{
  const h=deletionHarness();
  assert.equal(await h.remove(),true);
  assert.deepEqual(h.calls,['confirm',{method:'control_delete',args:{id:'button',current_ids:[]}},'render']);
  assert.equal(h.state.controls.entries.length,0);
  assert.equal(h.state.project.selectors.length,0);
});
test('cancelling control deletion leaves the library and project intact',async()=>{
  const h=deletionHarness({accept:false});
  await h.remove();
  assert.deepEqual(h.calls,['confirm']);
  assert.equal(h.state.controls.entries.length,1);
  assert.equal(h.state.project.selectors.length,1);
});
test('deletion checks current step references even when they change after rendering',async()=>{
  for(const step of [{target:'按钮'},{action:'drag',end_target:'按钮'},{action:'python',enabled:true}]){
    const h=deletionHarness();
    h.state.project.steps.push(step);
    await assert.rejects(h.remove(),/当前用例/);
    assert.deepEqual(h.calls,[]);
    assert.equal(h.state.controls.entries.length,1);
  }
});
test('deletion rejects controls used as positioning anchors',async()=>{
  const h=deletionHarness({entries:[
    {id:'button',selector:{name:'按钮',kind:'image'}},
    {id:'child',selector:{name:'子控件',kind:'image',anchor:'按钮'}},
  ]});
  await assert.rejects(h.remove(),/定位锚点/);
  assert.deepEqual(h.calls,[]);
});
