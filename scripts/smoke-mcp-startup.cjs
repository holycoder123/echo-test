// Starts only this installation's workbench in a separate profile; sends no application input.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {StreamableHTTPClientTransport}=require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const root=path.resolve(__dirname,'..');
const electron=path.join(root,'node_modules','electron','dist','electron.exe');
const python=path.join(root,'runtime','python','python.exe');
const descriptor=path.join(root,'.runtime','mcp-connection.json');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(check,label){
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){const result=check();if(result)return result;await pause(100);}
  throw new Error(label+' timed out');
}
async function mode(disabled){
  if(fs.existsSync(descriptor))throw new Error('A descriptor already exists; refusing to interrupt an existing workbench.');
  if(fs.existsSync(path.join(root,'.runtime','workbench-state.json')))throw new Error('A workbench snapshot already exists; run this check in an isolated installation.');
  const child=spawn(electron,[root,'--no-admin','--mcp-startup-smoke',...(disabled?['--disable-mcp']:[])],{cwd:root,windowsHide:true,stdio:'ignore'});
  const exited=new Promise(resolve=>child.once('exit',code=>resolve(code)));
  let client;
  try {
    await waitFor(()=>fs.existsSync(path.join(root,'.runtime','workbench-state.json')),'Workbench state');
    if(disabled){
      await pause(1500);
      assert.equal(fs.existsSync(descriptor),false);
    }else{
      const connection=await waitFor(()=>{
        try{const data=JSON.parse(fs.readFileSync(descriptor,'utf8'));return data.pid===child.pid&&path.resolve(data.root)===root?data:null;}catch{return null;}
      },'Default MCP startup');
      assert.ok(connection.url.startsWith('http://127.0.0.1:'));
      client=new Client({name:'echo-test-default-mcp-smoke',version:'1.0.0'});
      await client.connect(new StreamableHTTPClientTransport(new URL(connection.url),{requestInit:{headers:{Authorization:`Bearer ${connection.token}`}}}));
      const status=await client.callTool({name:'echo_test_status',arguments:{}});
      assert.equal(status.structuredContent.mcp.enabled,true);
      const tools=await client.listTools();assert.equal(tools.tools.length,15);
    }
  }finally{
    if(client)await client.close();
    const result=spawnSync(python,['-X','utf8','-m','echo_test.maintenance'],{cwd:root,windowsHide:true,encoding:'utf8',timeout:15000});
    if(result.error||result.status!==0)throw new Error('Fixture close request failed.');
    const close=JSON.parse(fs.readFileSync(path.join(root,'.runtime','workbench-close.json'),'utf8'));
    if(!close.closed)throw new Error('Fixture did not close normally; no process was terminated.');
    let exitTimer;
    const exitCode=await Promise.race([exited,new Promise((_,reject)=>{exitTimer=setTimeout(()=>reject(new Error('Fixture exit timed out')),15000);})]).finally(()=>clearTimeout(exitTimer));
    assert.equal(exitCode,0);
    assert.equal(fs.existsSync(descriptor),false);
  }
}
(async()=>{
  await mode(false);await mode(true);
  fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
  fs.writeFileSync(path.join(root,'artifacts','mcp-startup-smoke.json'),JSON.stringify({passed:true,defaultEnabled:true,explicitDisable:true,normalCloseRemovesDescriptor:true},null,2));
  console.log('Default MCP startup, authenticated SDK handshake, explicit disable and normal cleanup passed.');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
