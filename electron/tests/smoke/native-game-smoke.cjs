// Optional native-window smoke: move, focus, capture and listen; no replay input.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {artifactFile}=require('../../paths.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(check,label,timeout=6000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){if(await check())return;await pause(100);}
  throw new Error(label+'超时');
}
async function verify({root,main,toolbar,bridge,connect,open}){
  const result={},js=code=>main.webContents.executeJavaScript(code);
  const nativeProperties=state=>({owner:state.owner,style:state.style,exstyle:state.exstyle,
    width:state.rect[2]-state.rect[0],height:state.rect[3]-state.rect[1]});
  try{
    await waitFor(()=>js('!!window.__studioReady'),'工作台加载',20000);
    const handle=await js('S.handle');
    if(!handle)throw new Error('请通过 --game 指定当前游戏窗口句柄');
    await connect(handle);await open();
    result.before=await bridge.call('game_status',{handle});
    const bar=toolbar();
    result.toolbar={parent:bar.getParentWindow(),alwaysOnTop:bar.isAlwaysOnTop()};
    assert.equal(result.toolbar.parent,null);assert.equal(result.toolbar.alwaysOnTop,false);
    await waitFor(()=>bar.webContents.executeJavaScript('G.connection?.handle=== '+handle),'工具栏连接状态');
    assert.equal(await bar.webContents.executeJavaScript('G.toolbarLinked'),true);
    const [x,y]=bar.getPosition();bar.setPosition(x+40,y+25);await pause(300);
    result.afterToolbarMove=await bridge.call('game_status',{handle});
    assert.notDeepEqual(result.afterToolbarMove.rect,result.before.rect,'移动工具栏应带动游戏');
    assert.deepEqual(nativeProperties(result.afterToolbarMove),nativeProperties(result.before),'联动应保留游戏尺寸和样式');

    await bar.webContents.executeJavaScript("document.querySelector('#bundle').click()");
    await waitFor(()=>bar.webContents.executeJavaScript('!G.toolbarLinked'),'解绑');
    const unlinked=await bridge.call('game_status',{handle});
    const [freeX,freeY]=bar.getPosition();bar.setPosition(freeX+25,freeY+15);await pause(300);
    assert.deepEqual((await bridge.call('game_status',{handle})).rect,unlinked.rect,'解绑后工具栏独立移动');
    await bar.webContents.executeJavaScript("document.querySelector('#bundle').click()");
    await waitFor(()=>bar.webContents.executeJavaScript('G.toolbarLinked'),'重新捆绑');
    result.bundleRestored=true;

    await bar.webContents.executeJavaScript("document.querySelector('#record').click()");
    await waitFor(()=>bar.webContents.executeJavaScript("G.busy==='recording'&&G.recordStart>0"),'录制启动');
    result.recordingDiagnostics=await bridge.call('record_status');
    assert.equal(result.recordingDiagnostics.listener_alive,true);
    assert.equal(result.recordingDiagnostics.game_enabled,true);
    assert.equal(result.recordingDiagnostics.game_hit_test,true);
    assert.equal(await bar.webContents.executeJavaScript("document.querySelector('#bundle').disabled"),true);
    await pause(250);
    await bar.webContents.executeJavaScript("document.querySelector('#record').click()");
    await waitFor(()=>js('!!S.recordPending&&!S.busy'),'录制结果');
    await bar.webContents.executeJavaScript("document.querySelector('#record').click()");
    await waitFor(()=>js("S.view==='record'&&!!S.recordPending"),'查看录制结果');
    result.recording=true;
    await js("S.recordPending=null;api('record_reviewed')");

    await bar.webContents.executeJavaScript("document.querySelector('#coordinate').click()");
    await waitFor(()=>js("modal.open&&S.modal?.kind==='picker'"),'截图采集对话框');
    result.capture=await js('({width:S.modal.shot.width,height:S.modal.shot.height})');
    assert.ok(result.capture.width>0&&result.capture.height>0);
    await js('closeModal()');
    result.after=await bridge.call('game_status',{handle});
    assert.deepEqual(nativeProperties(result.after),nativeProperties(result.before));
    result.errors=await js('window.__studioErrors');assert.deepEqual(result.errors,[]);
    result.passed=true;
    return result;
  }catch(error){result.error=error.stack;error.results=result;throw error;}
  finally{
    fs.writeFileSync(artifactFile('smoke','native-game-smoke.json',root),JSON.stringify(result,null,2));
  }
}
module.exports={verify};
