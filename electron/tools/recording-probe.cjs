// Own-app diagnostic: stop on a complete click, with a five-minute timeout.
// Never sends mouse or keyboard input to the game.
const fs=require('node:fs');
const {runtimeFile}=require('../paths.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function probe(window,diagnostics){
  const js=code=>window.webContents.executeJavaScript(code);
  const result={startedAt:new Date().toISOString(),status:'starting',samples:[]};
  const save=()=>fs.writeFileSync(runtimeFile('recording-probe.json'),JSON.stringify(result,null,2));
  let armed=false,recordStart;
  save();
  try{
    const deadline=Date.now()+20000;
    while(!await js('!!window.__studioReady')){
      if(Date.now()>deadline)throw new Error('诊断工作台初始化超时');
      await pause(100);
    }
    await js("(async()=>{if(!S.connection||!S.handle)throw new Error('请先连接目标应用');if(S.busy||S.recordPending)throw new Error('已有录制或未处理结果，诊断取消');await startRecord();})()");
    const state=await js("api('game_state')");recordStart=state.recordStart;
    if(state.busy!=='recording'||!recordStart)throw new Error('录制未成功启动');
    armed=true;result.status='recording';save();
    const until=Date.now()+300000;
    while(Date.now()<until){
      await pause(3000);
      const state=await js("api('game_state')");
      if(state.busy!=='recording'||state.recordStart!==recordStart)break;
      const sample=await diagnostics();result.samples.push(sample);save();
      if(sample.mouse_recorded>=2&&!sample.pressed_buttons)break;
    }
    const endState=await js("api('game_state')");
    if(endState.busy==='recording'&&endState.recordStart===recordStart)await js("api('stop')");
    const stopped=await js('S.recordPending');
    result.status='complete';result.rawCount=stopped?.raw_count;
    result.steps=stopped?.project?.steps?.length;result.diagnostics=stopped?.diagnostics;
    result.hint=stopped?.hint;result.recordingPath=stopped?.path;
  }catch(error){result.status='error';result.error=error.message;}
  finally{
    if(armed){const state=await js("api('game_state')").catch(()=>null);if(state?.busy==='recording'&&state.recordStart===recordStart)await js("api('stop')").catch(()=>{});}
    result.finishedAt=new Date().toISOString();save();
  }
  return result;
}
module.exports={probe};
