// Real SDK -> HTTP server -> automation router -> JSON-line Python service -> Runner.
// The service fixture substitutes only desktop APIs; it never controls a real window.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {StreamableHTTPClientTransport}=require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const {PythonBridge}=require('../bridge.cjs');
const {McpAutomation}=require('../automation.cjs');
const {startMcpServer,projectSchema,selectorSchema}=require('../mcp-server.cjs');
const source=path.resolve(__dirname,'../..');
const python=process.env.ECHO_TEST_PYTHON||path.join(source,'runtime','python','python.exe');

test('inline exploration executes through real MCP and Python, returns PNG, stops concurrently and saves nothing',{timeout:15000},async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'echo-test-explore-'));
  const bridge=new PythonBridge(python,['-X','utf8','-u',path.join(source,'tests','fixtures','exploration-service.py'),root],{cwd:source});
  const state={connection:null,busy:'',dirty:true,recordPending:{preserved:true},path:'editor-draft.echo.json'};
  const router=new McpAutomation({root,state:()=>state,backend:(method,args)=>bridge.call(method,args),
    dispatch:async(method,args)=>{
      if(method==='automation_explore')state.busy='running';
      return bridge.call(method,args);
    },connect:async handle=>{state.connection={handle};return {connection:state.connection};},
    onProject:()=>assert.fail('exploration must not replace the editor'),validateProject:value=>projectSchema.parse(value),validateSelector:value=>selectorSchema.parse(value)});
  const events=[];let observed;
  bridge.on('event',event=>{events.push(event);router.receive(event);if(event.kind==='step'&&event.status==='running')observed?.();if(event.kind==='finished')state.busy='';});
  let server,client;
  t.after(async()=>{await client?.close();await server?.close();await bridge.shutdown();await fs.rm(root,{recursive:true,force:true});});
  server=await startMcpServer({root,invoke:(tool,args)=>router.invoke(tool,args)});
  const descriptor=JSON.parse(await fs.readFile(server.runtimePath,'utf8'));
  client=new Client({name:'echo-test-exploration-integration',version:'1.0.0'});
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url),{requestInit:{headers:{Authorization:`Bearer ${descriptor.token}`}}}));
  await client.callTool({name:'echo_test_windows',arguments:{}});
  await client.callTool({name:'echo_test_connect',arguments:{handle:1234}});
  const before=structuredClone(state);
  const result=await client.callTool({name:'echo_test_explore',arguments:{project:{name:'探索点击',selectors:[{name:'按钮',x:.5,y:.5}],steps:[{name:'点击',action:'click',target:'按钮',delay:0}]}}});
  assert.equal(result.content[0].type,'image');
  assert.equal(result.content[0].mimeType,'image/png');
  assert.equal(Buffer.from(result.content[0].data,'base64').subarray(1,4).toString(),'PNG');
  assert.equal(result.structuredContent.result.status,'passed');
  assert.equal(result.structuredContent.result.steps[0].status,'passed');
  assert.equal(result.structuredContent.saved,false);assert.ok(result.structuredContent.capture_id);
  assert.equal(result.structuredContent.width,80);assert.deepEqual(state,before);
  assert.equal(events.at(-1).directory,null);assert.equal(router.active,'');
  assert.deepEqual((await fs.readdir(root)).sort(),['.runtime']);
  const started=new Promise(resolve=>{observed=resolve;});
  const pending=client.callTool({name:'echo_test_explore',arguments:{project:{name:'等待停止',steps:[{name:'等待',action:'sleep',params:{duration:10},delay:0}]}}});
  await started;
  const status=await client.callTool({name:'echo_test_status',arguments:{}});
  assert.equal(status.structuredContent.mcp.operation,'echo_test_explore');
  assert.equal(status.structuredContent.busy,'running');
  await client.callTool({name:'echo_test_stop',arguments:{}});
  const stopped=await pending;
  assert.equal(stopped.structuredContent.result.status,'stopped');
  assert.equal(stopped.structuredContent.result.stop_reason,'user');
  assert.equal(stopped.content[0].type,'image');
  assert.deepEqual(state,before);assert.equal(router.active,'');
  assert.deepEqual((await fs.readdir(root)).sort(),['.runtime']);
});
