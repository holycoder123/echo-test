// Exercise real Electron minimization/highlight/restore; native hooks and targets are mocked.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {artifactFile}=require('../../paths.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function verify(main,hooks){
  const original=hooks.bridge.call,result={};let complete,ready,mode='cancel';
  const target={handle:94501,pid:95501,title:'窗口选择集成验证',process_name:'OwnedFixture.exe',width:640,height:480,bounds:[100,100,640,480]};
  hooks.bridge.call=async function(method,args){
    if(method==='window_pick_start'){
      assert.ok(args.overlay_handle>0);ready?.();
      if(mode==='failure')throw new Error('模拟监听启动失败');
      return new Promise(resolve=>{complete=resolve;});
    }
    if(method==='window_pick_cancel')return {cancelled:true};
    if(method==='game_info'){assert.equal(args.expected_pid,target.pid);return target;}
    if(['toolbar_pair_detach','toolbar_pair_attach','toolbar_pair_show'].includes(method))return {linked:false,fits:true};
    return original.call(this,method,args);
  };
  try{
    assert.equal(hooks.state().connection,null);
    let started=new Promise(resolve=>{ready=resolve;});const pending=hooks.pick();await started;await pause(60);
    result.minimized=main.isMinimized();
    const overlay=hooks.overlay();
    hooks.hover({kind:'window_pick_hover',window:{...target,bounds:[100,100,640,480]}});await pause(80);
    result.highlight=overlay.isVisible()&&!overlay.isFocusable()&&await overlay.webContents.executeJavaScript("document.querySelector('#pick-title').textContent==='窗口选择集成验证'");
    fs.writeFileSync(artifactFile('smoke','window-pick-overlay-preview.png'),(await overlay.webContents.capturePage()).toPNG());
    complete({selected:null,cancelled:true});await pending;
    result.cancelRestores=!main.isMinimized()&&hooks.overlay()===null&&hooks.state().busy==='';
    const cancelledStart=hooks.pick();await hooks.cancel();const cancelledData=await cancelledStart;
    result.cancelBeforeListening=cancelledData.cancelled&&!main.isMinimized()&&hooks.overlay()===null;
    mode='failure';await assert.rejects(hooks.pick(),/模拟监听启动失败/);
    result.failureRestores=!main.isMinimized()&&hooks.overlay()===null&&hooks.state().busy==='';
    mode='select';started=new Promise(resolve=>{ready=resolve;});const selected=hooks.pick();await started;
    complete({selected:target,cancelled:false});const data=await selected;
    result.confirmConnects=data.connection.handle===target.handle&&hooks.state().connection.pid===target.pid&&!main.isMinimized();
    await hooks.disconnect();
    for(const [name,value] of Object.entries(result))assert.equal(value,true,name);
    result.errors=await main.webContents.executeJavaScript('window.__studioErrors');
    assert.deepEqual(result.errors,[]);result.passed=true;
  }catch(error){result.error=error.stack;throw error;}
  finally{
    if(hooks.state().connection)await hooks.disconnect();
    hooks.bridge.call=original;
    fs.writeFileSync(artifactFile('smoke','window-pick-session-smoke.json'),JSON.stringify(result,null,2));
  }
}
module.exports={verify};
