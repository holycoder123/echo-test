const test=require('node:test'),assert=require('node:assert/strict');
const {range,parseDraft}=require('../renderer/workbench-model.js');
const step=(action='click',enabled=true)=>({name:action,action,enabled});
test('partial runs retain original indices and never mutate the editor project',()=>{
  const project={steps:[step(),step(),step('key'),step()]},before=JSON.stringify(project);
  const r=range(project,'selection',0,[1,2]);
  assert.deepEqual([r.start,r.end],[1,2]);assert.deepEqual(r.project.steps.map(s=>s.enabled),[false,true,true,false]);
  assert.equal(JSON.stringify(project),before);assert.equal(r.project.steps.length,4);
});
test('selected inner steps expand to complete nested loops including disabled parents',()=>{
  const project={steps:[step(),step('loop'),step(),step('loop'),step(),step('end_loop'),step(),step('end_loop'),step()]};
  const r=range(project,'step',4);assert.deepEqual([r.start,r.end,r.expanded],[1,7,true]);
  assert.equal(r.project.steps[0].enabled,false);assert.equal(r.project.steps[8].enabled,false);
  const disabled={steps:[step('loop',false),step(),step('end_loop')]};
  // A disabled loop is retained as disabled, so it cannot accidentally execute its children.
  assert.throws(()=>range(disabled,'step',1),/所属循环/);
});
test('range modes reject invalid indices, empty selections, Python and malformed loops',()=>{
  const project={steps:[step(),step(),step()]};
  assert.deepEqual([range(project,'to',1).start,range(project,'to',1).end],[0,1]);
  assert.deepEqual([range(project,'from',1).start,range(project,'from',1).end],[1,2]);
  for(const i of [-1,3,NaN])assert.throws(()=>range(project,'step',i));
  assert.throws(()=>range(project,'selection',0,[]));assert.throws(()=>range({...project,mode:'python'},'step',0));
  assert.throws(()=>range({steps:[step('end_loop')]},'step',0));assert.throws(()=>range({steps:[step('loop')]},'step',0));
  assert.throws(()=>range({steps:[step('click',false)]},'step',0));
});
test('draft parsing rejects malformed or oversized data and preserves Python source',()=>{
  assert.equal(parseDraft('{'),null);assert.equal(parseDraft('x'.repeat(4*1024*1024+1)),null);
  assert.equal(parseDraft(JSON.stringify({version:1,project:{name:'bad',steps:[]},baseDir:''})),null);
  const draft={version:1,project:{name:'草稿',steps:[],selectors:[],mode:'python',code:'print("<draft>")'},baseDir:'C:/cases',path:null};
  assert.deepEqual(parseDraft(JSON.stringify(draft)),draft);
  assert.equal(parseDraft(JSON.stringify({...draft,project:{...draft.project,steps:[null]}})),null);
  assert.equal(parseDraft(JSON.stringify({...draft,path:{unexpected:true}})),null);
});
