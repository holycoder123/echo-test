const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {McpAutomation,confinedFile}=require('../automation.cjs');
const {projectSchema,selectorSchema}=require('../mcp-server.cjs');

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'echo-test-automation-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  let state={connection:null,busy:'',dirty:false,recordPending:false};
  let windows=[{handle:50,pid:100,title:'目标应用'}];
  const calls=[];
  const router=new McpAutomation({root,state:()=>state,
    validateProject:value=>projectSchema.parse(value),validateSelector:value=>selectorSchema.parse(value),
    backend:async(method,args)=>{
      calls.push({method,args});
      if(method==='windows')return {windows,admin:true};
      if(method==='load_project')return {project:JSON.parse(fs.readFileSync(args.path)),path:args.path};
      if(method==='automation_save_case'){
        const file=path.join(root,'test_cases',args.name);fs.writeFileSync(file,JSON.stringify(args.project));return {project:args.project,path:file};
      }
      return {method,...args};
    },dispatch:async(method,args)=>{calls.push({method,args});if(method==='run')state.busy='running';return {started:true};},
    connect:async handle=>{state.connection={handle};return {connection:state.connection};},
    onProject:async data=>{state.path=data.path;state.case=data.project.name;},
  });
  return {root,router,calls,state,setWindows:value=>{windows=value;}};
}
const project={name:'测试新手任务',selectors:[{name:'NPC',x:.5,y:.5}],steps:[{name:'访问NPC',action:'click',target:'NPC'}]};

test('MCP binds only a listed game and rejects PID reuse',async t=>{
  const f=fixture(t);
  await assert.rejects(f.router.invoke('echo_test_connect',{handle:50}),/先列出/);
  await f.router.invoke('echo_test_windows');await f.router.invoke('echo_test_connect',{handle:50});
  await f.router.invoke('echo_test_capture');
  f.setWindows([{handle:50,pid:101,title:'目标应用'}]);
  await assert.rejects(f.router.invoke('echo_test_capture'),/身份已变化/);
  assert.equal(f.router.bound,null);
});

test('MCP run uses validated file and the shared execution scheduler',async t=>{
  const f=fixture(t);
  await f.router.invoke('echo_test_windows');await f.router.invoke('echo_test_connect',{handle:50});
  await f.router.invoke('echo_test_save_case',{name:'新手任务',project});
  await f.router.invoke('echo_test_run_case',{name:'新手任务',iterations:1});
  const run=f.calls.find(row=>row.method==='run');
  assert.equal(run.args.handle,50);assert.equal(run.args.source,'case');assert.equal(run.args.project.steps[0].target,'NPC');
  assert.equal(f.state.busy,'running');
  await assert.rejects(f.router.invoke('echo_test_run_case',{name:'新手任务'}),/先停止/);
  await f.router.invoke('echo_test_stop');assert.equal(f.calls.at(-1).method,'stop');
});

test('MCP keeps editor changes and pending recordings',async t=>{
  const f=fixture(t);f.state.dirty=true;
  await assert.rejects(f.router.invoke('echo_test_save_case',{name:'新手任务',project}),/未保存/);
  f.state.dirty=false;f.state.recordPending=true;
  await assert.rejects(f.router.invoke('echo_test_save_case',{name:'新手任务',project}),/录制结果/);
  assert.equal(f.calls.length,0);
});

test('MCP revalidates disk cases and confines names and assets',async t=>{
  const f=fixture(t);
  for(const name of ['../escape','C:\\escape','CON','unsafe.json'])await assert.rejects(f.router.invoke('echo_test_save_case',{name,project}));
  await f.router.invoke('echo_test_save_case',{name:'valid',project});
  const malicious={...project,steps:[{action:'key',params:{keys:'WIN+R'}}]};
  fs.writeFileSync(path.join(f.root,'test_cases','valid.echo.json'),JSON.stringify(malicious));
  await assert.rejects(f.router.invoke('echo_test_load_case',{name:'valid'}));
  await assert.rejects(f.router.invoke('echo_test_save_case',{name:'image',project:{...project,selectors:[{name:'NPC',kind:'image',image:'../../secret.png'}]}}));
});

test('MCP template save accepts a stem or PNG name and forwards one PNG suffix to backend',async t=>{
  const f=fixture(t);
  await f.router.invoke('echo_test_windows');await f.router.invoke('echo_test_connect',{handle:50});
  for(const name of ['接待员','接待员.png']) {
    const result=await f.router.invoke('echo_test_save_template',{name,capture_id:'observed_capture',rect:{x:10,y:20,w:40,h:30}});
    assert.equal(result.method,'automation_save_template');
    const saved=f.calls.at(-1);
    assert.equal(saved.method,'automation_save_template');
    assert.deepEqual(saved.args,{name:'接待员.png',capture_id:'observed_capture',rect:{x:10,y:20,w:40,h:30},handle:50,expected_pid:100});
  }
  assert.equal(fs.existsSync(path.join(f.root,'test_cases','assets')),true);
  await assert.rejects(f.router.invoke('echo_test_save_template',{name:'../outside.png',capture_id:'observed_capture',rect:{x:0,y:0,w:4,h:4}}),/名称只能/);
});

test('MCP stop and status remain available during another operation',async t=>{
  const f=fixture(t);f.router.active='echo_test_capture';
  await assert.rejects(f.router.invoke('echo_test_save_case',{name:'valid',project}),/另一个/);
  await f.router.invoke('echo_test_stop');assert.equal(f.calls.at(-1).method,'stop');
  assert.equal(f.router.status().mcp.operation,'echo_test_capture');
});

test('MCP event cursor retains ordering and limits history',t=>{
  const f=fixture(t);for(let i=0;i<520;i++)f.router.receive({kind:'step',index:i});
  assert.equal(f.router.events.length,500);assert.equal(f.router.sequence,520);
});

test('MCP rejects symlink files and reports outside the project',async t=>{
  const f=fixture(t);const target=path.join(f.root,'test_cases');fs.mkdirSync(target);
  const outside=fs.mkdtempSync(path.join(os.tmpdir(),'echo-test-outside-'));t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));
  fs.mkdirSync(path.join(f.root,'reports'));
  fs.symlinkSync(outside,path.join(f.root,'reports','escaped'),'junction');
  assert.throws(()=>confinedFile(f.root,'reports/escaped','result','.json',true),/超出/);
});
test('MCP stop while loading a case cancels the later start',async t=>{
  const f=fixture(t);await f.router.invoke('echo_test_save_case',{name:'valid',project});
  await f.router.invoke('echo_test_windows');await f.router.invoke('echo_test_connect',{handle:50});
  let release,loaded;const reached=new Promise(resolve=>{loaded=resolve;});
  f.router.onProject=async()=>{loaded();await new Promise(resolve=>{release=resolve;});};
  const run=f.router.invoke('echo_test_run_case',{name:'valid'});
  await reached;await f.router.invoke('echo_test_stop');release();
  await assert.rejects(run,/已取消/);
  assert.equal(f.calls.some(row=>row.method==='run'),false);assert.equal(f.router.active,'');
});


test('exploration dispatches an inline snapshot and preserves dirty editor and pending recording',async t=>{
  const f=fixture(t);
  await f.router.invoke('echo_test_windows');await f.router.invoke('echo_test_connect',{handle:50});
  Object.assign(f.state,{dirty:true,recordPending:{raw_count:4},path:'editor/draft.echo.json',case:'未保存内容'});
  const before=structuredClone(f.state);f.calls.length=0;
  await f.router.invoke('echo_test_explore',{project});
  assert.deepEqual(f.state,before);
  assert.deepEqual(f.calls.map(call=>call.method),['windows','automation_explore']);
  assert.equal(f.calls[1].args.timeout,15);assert.equal(f.calls[1].args.expected_pid,100);
  assert.equal(f.calls[1].args.project.steps[0].target,'NPC');
  assert.deepEqual(fs.readdirSync(f.root),[]);
});

test('stop during exploration binding cancels its start without sending input',async t=>{
  const f=fixture(t);
  await f.router.invoke('echo_test_windows');await f.router.invoke('echo_test_connect',{handle:50});
  const backend=f.router.backend;
  f.router.backend=async(method,args)=>{const result=await backend(method,args);if(method==='windows')await f.router.invoke('echo_test_stop');return result;};
  f.calls.length=0;
  await assert.rejects(f.router.invoke('echo_test_explore',{project}),/已取消/);
  assert.deepEqual(f.calls.map(call=>call.method),['windows','stop']);
});

test('exploration keeps stop/status/events available while awaiting the final screenshot',async t=>{
  const f=fixture(t);
  await f.router.invoke('echo_test_windows');await f.router.invoke('echo_test_connect',{handle:50});
  let finish,started;const ready=new Promise(resolve=>{started=resolve;});
  f.router.dispatch=async(method)=>{if(method==='automation_explore'){started();return new Promise(resolve=>{finish=resolve;});}return {stopping:true};};
  const pending=f.router.invoke('echo_test_explore',{project});await ready;
  assert.equal((await f.router.invoke('echo_test_status')).mcp.operation,'echo_test_explore');
  await assert.rejects(f.router.invoke('echo_test_explore',{project}),/另一个/);
  assert.deepEqual(await f.router.invoke('echo_test_stop'),{stopping:true});
  f.router.receive({kind:'step',index:0,status:'stopped'});
  assert.equal((await f.router.invoke('echo_test_events')).entries.length,1);
  finish({saved:false,result:{status:'stopped'},image:'final pixels'});
  assert.equal((await pending).saved,false);assert.equal(f.router.active,'');
});
