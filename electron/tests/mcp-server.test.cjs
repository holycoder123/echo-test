const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {Client} = require('@modelcontextprotocol/sdk/client/index.js');
const {StreamableHTTPClientTransport} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const {startMcpServer,projectSchema,selectorSchema,MAX_BODY_BYTES} = require('../mcp-server.cjs');

const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZuoAAAAASUVORK5CYII=';
const simpleProject = () => ({name:'新手验证',selectors:[{name:'NPC',x:.3,y:.4}],steps:[{name:'接待员',action:'click',target:'NPC'}]});
async function fixture(t, options={}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'echo-test-mcp-test-'));
  const calls = [], logs = [];
  const server = await startMcpServer({root,invoke:async (name,args) => {
    calls.push({name,args});
    return name === 'echo_test_capture' || name === 'echo_test_preview_target' || name === 'echo_test_explore'
      ? {image:`data:image/png;base64,${pixel}`,id:'observed_capture',width:1,height:1}
      : {tool:name,args};
  },status:async()=>({admin:true,busy:'',connection:{handle:123}}),audit:(...args)=>logs.push(args),...options});
  const descriptor = JSON.parse(await fs.readFile(server.runtimePath,'utf8'));
  t.after(async()=>{await server.close();await fs.rm(root,{recursive:true,force:true});});
  return {root,server,descriptor,calls,logs};
}
async function clientFor(t, fixture) {
  const client = new Client({name:'echo-test-workbench-integration-test',version:'1.0.0'});
  const transport = new StreamableHTTPClientTransport(new URL(fixture.server.url),{requestInit:{headers:{Authorization:`Bearer ${fixture.descriptor.token}`}}});
  await client.connect(transport);
  t.after(()=>client.close());
  return client;
}
function raw(fixture, {method='POST',headers={},body={jsonrpc:'2.0',id:1,method:'tools/list'}}={}) {
  const bytes = typeof body === 'string' ? body : JSON.stringify(body);
  return new Promise((resolve,reject)=>{
    const request = http.request(fixture.server.url,{method,headers:{Authorization:`Bearer ${fixture.descriptor.token}`,
      'Content-Type':'application/json',Accept:'application/json, text/event-stream',...headers}},response=>{
      const chunks=[];response.on('data',chunk=>chunks.push(chunk));
      response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks).toString('utf8')}));
    });
    request.on('error',reject);request.end(bytes);
  });
}

test('real SDK client initializes, lists the allowlist and dispatches validated workbench tools',async t=>{
  const f = await fixture(t);
  const client = await clientFor(t,f);
  const listing = await client.listTools();
  assert.equal(listing.tools.length,15);
  assert.ok(listing.tools.some(tool=>tool.name === 'echo_test_run_case'));
  const exploration=listing.tools.find(tool=>tool.name==='echo_test_explore');
  assert.equal(exploration.inputSchema.properties.project.properties.steps.maxItems,10);
  assert.equal(exploration.inputSchema.properties.timeout.maximum,30);
  assert.ok(!exploration.inputSchema.properties.project.properties.steps.items.properties.action.enum.includes('python'));
  assert.ok(listing.tools.every(tool=>tool.name.startsWith('echo_test_')));
  const status = await client.callTool({name:'echo_test_status',arguments:{}});
  assert.equal(status.structuredContent.admin,true);
  assert.deepEqual(f.calls,[]);
  const saved = await client.callTool({name:'echo_test_save_case',arguments:{name:'新手验证.echo.json',project:simpleProject()}});
  assert.equal(saved.structuredContent.tool,'echo_test_save_case');
  assert.equal(f.calls[0].args.project.schema_version,1);
  assert.equal(f.calls[0].args.project.selectors[0].normalized,true);
  assert.equal(f.calls[0].args.project.steps[0].timeout,5);
  const run = await client.callTool({name:'echo_test_run_case',arguments:{name:'新手验证'}});
  assert.equal(run.structuredContent.args.iterations,1);
  const stopped = await client.callTool({name:'echo_test_stop',arguments:{}});
  assert.equal(stopped.structuredContent.tool,'echo_test_stop');
  assert.ok(!JSON.stringify(f.logs).includes(f.descriptor.token));
  assert.ok(!JSON.stringify(f.logs).includes('新手验证'));
});

test('capture and selector previews expose MCP image pixels with separate structured metadata',async t=>{
  const f = await fixture(t),client = await clientFor(t,f);
  for (const [name,args] of [['echo_test_capture',{}],['echo_test_explore',{project:simpleProject()}],['echo_test_preview_target',{selector:{name:'NPC',x:.2,y:.3}}]]) {
    const result = await client.callTool({name,arguments:args});
    assert.equal(result.content[0].type,'image');assert.equal(result.content[0].mimeType,'image/png');
    assert.equal(result.content[0].data,pixel);assert.equal(result.structuredContent.id,'observed_capture');
    assert.equal(result.structuredContent.image,undefined);
  }
  const template = await client.callTool({name:'echo_test_save_template',arguments:{name:'接待员',capture_id:'observed_capture',rect:{x:1,y:2,w:24,h:18}}});
  assert.equal(template.structuredContent.args.capture_id,'observed_capture');
});

test('authentication, origin and Host validation reject browser access and DNS rebinding',async t=>{
  const f = await fixture(t);
  for (const [headers,status] of [
    [{Authorization:''},401], [{Authorization:'Bearer wrong'},401],
    [{Origin:'https://attacker.example'},403], [{Origin:'null'},403],
    [{Host:`attacker.example:${f.server.port}`},403], [{Host:`127.0.0.1.attacker.example:${f.server.port}`},403],
    [{Host:`127.0.0.1:${f.server.port+1}`},403],
  ]) assert.equal((await raw(f,{headers})).status,status);
  assert.deepEqual(f.calls,[]);
  assert.equal((await raw(f,{headers:{Host:`localhost:${f.server.port}`}})).status,200);
  assert.equal((await raw(f,{method:'GET'})).status,405);
  assert.equal((await raw(f,{method:'DELETE'})).status,405);
});

test('Python steps retain source through MCP and reject missing or oversized code',async t=>{
  const f=await fixture(t);const client=await clientFor(t,f);
  const code='print("脚本检查", game.size())\nvariables["count"] = 1\n';
  const result=await client.callTool({name:'echo_test_save_case',arguments:{name:'python-case',project:{name:'脚本用例',steps:[{name:'Python 检查',action:'python',timeout:30,params:{code}}]}}});
  assert.equal(result.isError,undefined);
  assert.equal(f.calls.at(-1).args.project.steps[0].params.code,code);
  assert.equal(projectSchema.safeParse({steps:[{action:'python',params:{code:'   '}}]}).success,false);
  assert.equal(projectSchema.safeParse({steps:[{action:'python',params:{code:'中'.repeat(90000)}}]}).success,false);
  assert.equal(projectSchema.safeParse({steps:[{action:'python',enabled:false,params:{code:''}}]}).success,true);
});

test('raw tool input is strict and invalid names, arguments and methods never reach backend',async t=>{
  const f = await fixture(t);
  const badCalls = [
    ['echo_test_connect',{handle:0}], ['echo_test_connect',{handle:123,method:'shutdown'}],
    ['echo_test_run_case',{name:'../outside',iterations:1}], ['echo_test_run_case',{name:'CON.json'}],
    ['echo_test_run_case',{name:'valid',iterations:11}], ['echo_test_load_case',{name:'C:\\private.json'}],
    ['echo_test_report',{id:'..'}], ['echo_test_events',{after:-1}], ['echo_test_capture',{handle:123}],
    ['echo_test_save_template',{name:'template',rect:{x:0,y:0,w:20,h:20}}],
    ['echo_test_save_template',{name:'template',capture_id:'seen',rect:{x:0,y:0,w:3,h:20}}],
    ['echo_test_preview_target',{selector:{name:'target',kind:'image',image:'../private.png'}}],
    ['echo_test_save_case',{name:'safe',project:{...simpleProject(),command:'powershell'}}],
    ['echo_test_save_case',{name:'safe',project:{name:'unsafe',steps:[{action:'shell',params:{command:'whoami'}}]}}],
  ];
  for (const [name,args] of badCalls) {
    const response = await raw(f,{body:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}});
    assert.equal(response.status,400,`${name} ${JSON.stringify(args)}`);
  }
  const unknown = await raw(f,{body:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'execute_backend_method',arguments:{method:'shutdown'}}}});
  assert.equal(unknown.status,200);assert.match(unknown.body,/error|isError/);
  const unknownMethod = await raw(f,{body:{jsonrpc:'2.0',id:2,method:'backend/shutdown'}});
  assert.equal(unknownMethod.status,200);assert.match(unknownMethod.body,/error/);
  assert.deepEqual(f.calls,[]);
});

test('project schemas reject unsafe assets, system keyboard shortcuts and invalid target relations',()=>{
  assert.equal(projectSchema.parse(simpleProject()).steps[0].delay,.5);
  assert.equal(projectSchema.parse({selectors:[{name:' NPC '}],steps:[{target:' NPC '}]}).selectors[0].name,' NPC ');
  for (const image of ['C:/secret.png','../secret.png','assets/../secret.png','assets/CON.png','assets/private.jpg'])
    assert.equal(selectorSchema.safeParse({name:'image',kind:'image',image}).success,false,image);
  for (const chord of ['WIN+R','META+R','VK_91','VK_92','F12','ALT+TAB','ALT+F4','CTRL+ESC','LCTRL+LSHIFT+ESC'])
    assert.equal(projectSchema.safeParse({steps:[{action:'key',params:{keys:chord}}]}).success,false,chord);
  assert.equal(projectSchema.safeParse({steps:[{action:'key',params:{keys:'CTRL+A'}}]}).success,true);
  assert.equal(projectSchema.safeParse({steps:[{action:'click',target:'missing'}]}).success,false);
  assert.equal(projectSchema.safeParse({selectors:[{name:'same'},{name:'same'}]}).success,false);
  assert.equal(projectSchema.safeParse({selectors:[{name:'coordinate'}],steps:[{action:'assert_image',target:'coordinate'}]}).success,false);
});

test('HTTP body limit and JSON content checks fail before tool dispatch',async t=>{
  const f = await fixture(t);
  assert.equal((await raw(f,{body:'{broken'})).status,400);
  assert.equal((await raw(f,{body:'[]'})).status,400);
  assert.equal((await raw(f,{headers:{'Content-Type':'text/plain'}})).status,415);
  assert.equal((await raw(f,{headers:{'Content-Encoding':'gzip'}})).status,415);
  assert.equal((await raw(f,{headers:{'Content-Length':String(MAX_BODY_BYTES+1)},body:'{}'})).status,413);
  assert.equal((await raw(f,{body:' '.repeat(MAX_BODY_BYTES+1)})).status,413);
  assert.deepEqual(f.calls,[]);
});

test('tool failures are MCP error results and audit logs never include inputs or bearer secrets',async t=>{
  const marker = 'sensitive-input'; let token;
  const f = await fixture(t,{invoke:async()=>{throw new Error(`${marker} ${token}`);}});
  token = f.descriptor.token;
  const client = await clientFor(t,f);
  const result = await client.callTool({name:'echo_test_load_case',arguments:{name:marker}});
  assert.equal(result.isError,true);assert.ok(result.content[0].text.includes('[redacted]'));
  assert.ok(!JSON.stringify(f.logs).includes(marker));assert.ok(!JSON.stringify(f.logs).includes(token));
});

test('runtime token lives only in its descriptor and shutdown removes only the owned descriptor',async t=>{
  const f = await fixture(t);
  assert.equal(f.server.token,undefined);
  assert.match(f.descriptor.token,/^[a-f0-9]{64}$/);
  assert.equal(f.descriptor.url,f.server.url);assert.equal(f.descriptor.pid,process.pid);
  await assert.rejects(startMcpServer({root:f.root,runtimePath:f.server.runtimePath,invoke:async()=>({})}),{code:'EEXIST'});
  await f.server.close();await f.server.close();
  await assert.rejects(fs.stat(f.server.runtimePath),{code:'ENOENT'});
  await assert.rejects(fetch(f.server.url),/fetch failed/);
  const replaced = await fixture(t);
  await fs.writeFile(replaced.server.runtimePath,JSON.stringify({pid:process.pid,token:'another-owner'}),'utf8');
  await replaced.server.close();
  assert.equal(JSON.parse(await fs.readFile(replaced.server.runtimePath,'utf8')).token,'another-owner');
});

test('shutdown closes a pending tool transport and returns promptly',async t=>{
  let entered,release;
  const started = new Promise(resolve=>entered=resolve),blocked = new Promise(resolve=>release=resolve);
  const f = await fixture(t,{invoke:async()=>{entered();await blocked;return {complete:true};}});
  const client = await clientFor(t,f);
  const call = client.callTool({name:'echo_test_windows',arguments:{}}).catch(error=>({failed:error.message}));
  await started;
  await f.server.close();
  release();
  const result = await call;
  assert.ok(result.failed);
  await assert.rejects(fs.stat(f.server.runtimePath),{code:'ENOENT'});
});


test('exploration rejects oversized, empty, scripted or invalid fragments before invocation',async t=>{
  const f=await fixture(t),client=await clientFor(t,f);
  const base=simpleProject();
  const invalid=[
    {project:{...base,steps:[]}},
    {project:{...base,steps:Array.from({length:11},()=>base.steps[0])}},
    {project:{...base,steps:[{...base.steps[0],repeat:11}]}},
    {project:{...base,steps:[{action:'python',params:{code:'print(1)'}}]}},
    {project:{...base,steps:[{...base.steps[0],enabled:false}]}},
    {project:{...base,steps:[{...base.steps[0],target:'missing'}]}},
    ...[0,31,'15',null].map(timeout=>({project:base,timeout})),
    {project:base,name:'temporary-case'},
  ];
  for(const args of invalid){const response=await raw(f,{body:{jsonrpc:'2.0',id:23,method:'tools/call',params:{name:'echo_test_explore',arguments:args}}});assert.equal(response.status,400,JSON.stringify(args));}
  assert.deepEqual(f.calls,[]);
  const valid=await client.callTool({name:'echo_test_explore',arguments:{project:{...base,steps:[{...base.steps[0],repeat:10}]},timeout:30}});
  assert.equal(valid.content[0].type,'image');assert.equal(f.calls[0].args.timeout,30);
});

test('exploration returns failure details even when a final screenshot is unavailable',async t=>{
  const f=await fixture(t,{invoke:async()=>({saved:false,result:{status:'failed',steps:[],error:'失焦'},capture_id:null,capture_error:'窗口关闭'})});
  const client=await clientFor(t,f);
  const result=await client.callTool({name:'echo_test_explore',arguments:{project:simpleProject()}});
  assert.equal(result.structuredContent.result.status,'failed');
  assert.equal(result.structuredContent.capture_id,null);assert.equal(result.content.length,1);
  assert.equal(result.isError,undefined);
});
