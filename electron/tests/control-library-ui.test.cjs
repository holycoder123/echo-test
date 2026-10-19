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
