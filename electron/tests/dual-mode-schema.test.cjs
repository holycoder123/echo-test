const test=require('node:test');
const assert=require('node:assert/strict');
const {projectSchema,explorationSchema}=require('../mcp-server.cjs');
test('MCP preserves Python case code and execution timeout',()=>{
  const parsed=projectSchema.parse({name:'Python 用例',mode:'python',code:'print(1)',script_timeout:300});
  assert.equal(parsed.mode,'python');assert.equal(parsed.code,'print(1)');assert.equal(parsed.script_timeout,300);
  assert.equal(projectSchema.safeParse({mode:'python',code:' '}).success,false);
});
test('MCP validates loop pairing, bounded range, assignments and exploration exclusions',()=>{
  const loop={action:'loop',params:{variable:'i',start:2,end:64,step:1}};
  const steps=[loop,{action:'text',params:{text:'thread ${i}'}},{action:'end_loop'}];
  assert.equal(projectSchema.safeParse({steps}).success,true);
  assert.equal(projectSchema.safeParse({steps:steps.slice(0,2)}).success,false);
  assert.equal(projectSchema.safeParse({steps:[{...loop,params:{...loop.params,step:0}},steps[2]]}).success,false);
  assert.equal(projectSchema.safeParse({steps:[{action:'set_variable',params:{variable:'count',value:'2'}}]}).success,true);
  assert.equal(explorationSchema.safeParse({project:{mode:'python',code:'print(1)',steps:[{action:'sleep'}]}}).success,false);
  assert.equal(explorationSchema.safeParse({project:{steps}}).success,false);
});
