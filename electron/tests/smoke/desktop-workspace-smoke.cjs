// UI fixtures only: capture/record IPC is intercepted, no target input is sent.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {artifactFile}=require('../../paths.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function verify(main,windowCount){
  const js=code=>main.webContents.executeJavaScript(code),result={},size=main.getSize();
  try{
    await js(`window.__desktopDiscovery=windowDiscovery.enabled;window.__desktopSaved={api,view:S.view,connection:S.connection,handle:S.handle,busy:S.busy,recordStarting:S.recordStarting,recordPending:S.recordPending,settingsData:S.settingsData,settingsDraft:S.settingsDraft,settingsTab:S.settingsTab,windowSearch:S.windowSearch,targetWindowMode:S.targetWindowMode};
      S.connection={handle:-42,pid:123,title:'桌面测试目标 · 自动化工作区',width:1024,height:700};S.handle=-42;S.busy='';S.recordPending=null;S.view='select-window';render();
      window.__desktopCalls=[];api=async(method,args)=>{
        window.__desktopCalls.push({method,args});
        if(method==='capture'){const canvas=document.createElement('canvas');canvas.width=200;canvas.height=120;return {id:'desktop-fixture',image:canvas.toDataURL(),width:200,height:120};}
        if(['record_start','stop'].includes(method))return {};
        return window.__desktopSaved.api(method,args);
      };void 0;`);
    assert.equal(await js(`document.querySelector('.target-current').textContent.includes('操作目标窗口')&&!document.querySelector('.target-current').textContent.includes('工具栏')`),true);result.connectionEntry=true;
    await js(`handleAction('view-game',{dataset:{}})`);
    assert.equal(await js(`S.view==='game'&&['record-start','game-pick-image','game-pick-coordinate','view-cases'].every(action=>!!document.querySelector('[data-act="'+action+'"]'))&&!window.__desktopCalls.some(c=>c.method==='game_open')`),true);result.mainActions=true;
    for(const kind of ['image','coordinate']){
      await js(`handleAction('game-pick-${kind}',{dataset:{}})`);
      assert.equal(await js(`S.modal.kind==='picker'&&S.modal.returnModal.draft.kind==='${kind}'`),true);
      await js('closeModal()');
    }result.captureEntries=true;
    await js(`startRecord()`);
    assert.equal(await js(`S.view==='record'&&S.busy==='recording'&&!!document.querySelector('[data-act="stop"]')&&window.__desktopCalls.some(c=>c.method==='record_start'&&c.args.handle===-42)`),true);result.recordEntry=true;
    await js(`S.busy='';S.recordStarting=false;S.view='game';render()`);
    result.sizes=[];
    for(const [width,height] of [[1120,740],[1440,900]]){
      main.setSize(width,height);await pause(80);
      const layout=await js(`({noOverflow:document.body.scrollWidth<=innerWidth,buttons:['record-start','game-pick-image','game-pick-coordinate','view-cases'].every(action=>{const r=document.querySelector('.game-toolbar [data-act="'+action+'"]').getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})})`);
      assert.equal(layout.noOverflow,true);assert.equal(layout.buttons,true);result.sizes.push({width,height,...layout});
      if(width===1120)fs.writeFileSync(artifactFile('smoke','desktop-workspace-preview.png'),(await main.webContents.capturePage()).toPNG());
    }
    await js(`handleAction('view-settings',{dataset:{}});S.settingsTab='target';render()`);
    assert.equal(await js(`!document.querySelector('[data-setting="target.autoToolbar"],[data-setting="target.linkToolbar"]')&&!document.querySelector('#content').textContent.includes('捆绑工具栏')`),true);result.removedSettings=true;
    assert.equal(windowCount(),1);result.noExtraWindow=true;
    result.errors=await js('window.__studioErrors');assert.deepEqual(result.errors,[]);result.passed=true;
  }catch(error){result.error=error.stack;throw error;}
  finally{await js(`(async()=>{windowDiscovery.stop();if(windowRefreshPromise)await windowRefreshPromise;api=window.__desktopSaved.api;const data={...window.__desktopSaved};delete data.api;Object.assign(S,data);delete window.__desktopSaved;render();if(window.__desktopDiscovery)windowDiscovery.start();delete window.__desktopDiscovery;})()`);main.setSize(...size);fs.writeFileSync(artifactFile('smoke','desktop-workspace-smoke.json'),JSON.stringify(result,null,2));}
}
module.exports={verify};
