const {test}=require('node:test');
const assert=require('node:assert/strict');
const {RunState}=require('../run-state.cjs');
const project={name:'邮件测试',steps:[{name:'打开邮件',action:'click',repeat:2},{name:'禁用步骤',action:'click',enabled:false},{name:'图片断言',action:'assert_image'}]};

test('Python cases expose a runnable synthetic script and loop plans count source occurrences',()=>{
  const state=new RunState();state.start({name:'脚本',mode:'python',code:'print(1)',steps:[]});
  assert.equal(state.snapshot().steps.length,1);assert.equal(state.snapshot().total,1);
  state.start({name:'循环',steps:[{name:'循环',action:'loop'},{name:'输入',action:'text'},{name:'结束',action:'end_loop'}]},2);
  state.plan({counts:{1:63},total:126});
  assert.equal(state.snapshot().total,126);assert.equal(state.snapshot().steps[1].repeatTotal,63);
  assert.equal(state.snapshot().steps[0].status,'skipped');
  for(let repeat=1;repeat<=63;repeat++)state.step({index:1,repeat,iteration:1,status:'passed'});
  assert.equal(state.snapshot().completed,63);
});

test('recording replay retains its origin and report without an editor file path',()=>{
  const state=new RunState();state.start(project,1,null,'recording');
  state.finish({status:'stopped'},'/reports/replay-123');
  assert.equal(state.snapshot().source,'recording');assert.equal(state.snapshot().path,null);
  assert.equal(state.snapshot().reportId,'replay-123');
  state.start(project,1,'editor.echo.json');
  assert.equal(state.snapshot().source,'case');assert.equal(state.snapshot().path,'editor.echo.json');
});

test('counts repeated enabled executions, preserves planned repeats and ignores duplicate completion',()=>{
  const state=new RunState();state.start(project,2,'case.echo.json');
  assert.equal(state.snapshot().total,6);assert.equal(state.snapshot().steps[1].status,'skipped');
  for(let iteration=1;iteration<=2;iteration++)for(const [index,repeat] of [[0,1],[0,2],[2,1]]){
    const record={index,repeat,iteration,name:project.steps[index].name};
    state.step({...record,status:'running'});
    state.step({...record,status:'passed',elapsed:.1});state.step({...record,status:'passed',elapsed:.1});
  }
  state.finish({status:'passed'},'C:\\reports\\run-123');
  const result=state.snapshot();assert.equal(result.passed,6);assert.equal(result.completed,6);
  assert.equal(result.steps[0].repeatTotal,2);assert.equal(result.current.index,2);
  assert.equal(result.status,'passed');assert.equal(result.reportId,'run-123');
});

test('a failed start remains visible without falsely completing pending steps',()=>{
  const state=new RunState();state.start(project);state.fail('窗口被遮挡');
  assert.equal(state.snapshot().status,'failed');assert.equal(state.snapshot().error,'窗口被遮挡');
  assert.equal(state.snapshot().completed,0);assert.equal(state.snapshot().steps[0].status,'pending');
});

test('retains failing step and error, restores report results, and resets on the next run',()=>{
  const state=new RunState();state.start(project);
  const first={index:0,name:'打开邮件',repeat:1,iteration:1,status:'passed',elapsed:.2};
  const failed={index:2,name:'图片断言',repeat:1,iteration:1,status:'failed',error:'未找到图片',elapsed:5};
  state.step(first);state.step({...failed,status:'running'});
  state.finish({status:'failed',error:failed.error,steps:[first,failed]},'/reports/failure');
  assert.equal(state.snapshot().failed,1);assert.equal(state.snapshot().passed,1);
  assert.equal(state.snapshot().current.error,'未找到图片');assert.equal(state.snapshot().current.elapsed,5);
  const copy=state.snapshot();copy.steps[0].name='外部修改';assert.equal(state.snapshot().steps[0].name,'打开邮件');
  state.start({name:'新用例',steps:[{name:'等待'}]});assert.equal(state.snapshot().completed,0);
  assert.equal(state.snapshot().current,null);assert.equal(state.snapshot().error,'');
});

test('stopping and service errors leave pending steps untouched and retain terminal status',()=>{
  const state=new RunState();state.start(project);
  state.step({index:0,name:'打开邮件',repeat:1,iteration:1,status:'running'});
  state.fail('服务断开');assert.equal(state.snapshot().steps[0].status,'failed');
  assert.equal(state.snapshot().failed,1);assert.equal(state.snapshot().steps[2].status,'pending');
  state.start(project);state.step({index:0,name:'打开邮件',repeat:1,iteration:1,status:'stopped'});
  state.finish({status:'stopped'});assert.equal(state.snapshot().stopped,1);
  state.step({index:2,name:'延迟事件',repeat:1,iteration:1,status:'passed'});
  assert.equal(state.snapshot().completed,1);
});
