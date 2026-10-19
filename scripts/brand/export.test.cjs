// Real regression: the former console.log left an uncaught EPIPE dialog here.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');

test('background brand export completes after its parent closes both output pipes', {timeout:40000}, async()=>{
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(require('electron'),[path.join(__dirname,'export.cjs')],{
    cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe'],
  });
  child.stdout.destroy();child.stderr.destroy();
  const status=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{
      // Confine emergency cleanup to the child created by this regression.
      if(child.pid){
        if(process.platform==='win32')spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
        else child.kill('SIGKILL');
      }
      reject(new Error('Brand exporter did not exit with its output pipes closed'));
    },30000);
    child.once('error',error=>{clearTimeout(timeout);reject(error);});
    child.once('exit',(code,signal)=>{clearTimeout(timeout);resolve({code,signal});});
  });
  assert.deepEqual(status,{code:0,signal:null});
  const report=JSON.parse(fs.readFileSync(path.join(root,'.runtime/brand-render/export-result.json'),'utf8'));
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'docs/brand/exports.json'),'utf8'));
  assert.equal(report.status,'complete');
  assert.deepEqual(report.outputs,manifest.map(item=>item.output));
  for(const item of manifest){
    const png=fs.readFileSync(path.join(root,item.output));
    assert.equal(png.subarray(1,4).toString(),'PNG');
    assert.equal(png.readUInt32BE(16),item.width);
    assert.equal(png.readUInt32BE(20),item.height);
  }
});
