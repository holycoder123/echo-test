// Disposable native target verification, with no recording or replay input.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {artifactFile}=require('../../paths.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function verify({main,bridge,connect,windowCount}){
  const js=code=>main.webContents.executeJavaScript(code),result={};
  try{
    for(let n=0;n<100&&!await js('!!window.__studioReady');n++)await pause(100);
    const at=process.argv.indexOf('--game'),handle=Number(process.argv[at+1]);if(at<0||!handle)throw new Error('需要测试窗口句柄');
    result.before=await bridge.call('game_status',{handle});await connect(handle);
    await pause(100);assert.equal(windowCount(),1);result.noSidebarOnConnect=true;
    await js(`handleAction('view-game',{dataset:{}})`);
    assert.equal(await js(`S.view==='game'&&!!document.querySelector('[data-act=game-pick-image]')&&!!document.querySelector('[data-act=record-start]')`),true);
    assert.equal(windowCount(),1);result.mainWorkspace=true;
    await connect(handle);assert.equal(windowCount(),1);result.noSidebarOnReconnect=true;
    result.after=await bridge.call('game_status',{handle});
    for(const key of ['owner','style','exstyle','rect'])assert.deepEqual(result.after[key],result.before[key]);result.targetUnchanged=true;
    result.errors=await js('window.__studioErrors');assert.deepEqual(result.errors,[]);result.passed=true;return result;
  }catch(error){result.error=error.stack;error.results=result;throw error;}
  finally{fs.writeFileSync(artifactFile('smoke','native-game-smoke.json'),JSON.stringify(result,null,2));}
}
module.exports={verify};
