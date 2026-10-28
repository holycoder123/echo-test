// Mocked recording IPC verifies the workbench flow without application input.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {artifactFile}=require('../../paths.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function verify(main){
  const js=code=>main.webContents.executeJavaScript(code);
  const result={};
  try{
    result.starting=await js(`(async()=>{
      window.__recordSmokeOriginal=api;
      window.__recordSmokeSaved={connection:S.connection,handle:S.handle,view:S.view,pending:S.recordPending};
      window.__recordSmokeErrors=window.__studioErrors.slice();
      api=(method,args)=>method==='record_start'?new Promise(resolve=>window.__recordSmokeResolve=resolve):window.__recordSmokeOriginal(method,args);
      S.recordPending=null;S.busy='';S.view='game';S.handle=-1;
      S.connection={handle:-1,width:1280,height:720,title:'录制回归目标应用'};render();
      window.__recordSmokePromise=startRecord();
      for(let i=0;i<100&&!S.recordStarting;i++)await new Promise(resolve=>setTimeout(resolve,10));
      return {recordView:S.view==='record',starting:S.recordStarting,
        disabled:document.querySelector('.record-card [data-act="stop"]').disabled,
        message:document.querySelector('.record-live').textContent.includes('正在启动录制监听')};
    })()`);
    for(const value of Object.values(result.starting))assert.equal(value,true);
    main.webContents.send('studio:event',{kind:'notice',level:'warning',message:'录制诊断测试'});
    main.webContents.send('studio:event',{kind:'record_started'});
    await pause(80);
    await js('window.__recordSmokeResolve({started:true});window.__recordSmokePromise');
    main.webContents.send('studio:event',{kind:'record_event',count:2,event:{kind:'mouse',event:'up',button:'left',x:.5,y:.5,t:.5}});
    await pause(80);
    result.listening=await js(`({stop:!!document.querySelector('.record-card [data-act="stop"]'),
      count:S.recordCount===2&&document.querySelector('#live-events').textContent.includes('鼠标松开'),
      ready:!S.recordStarting&&!document.querySelector('.record-card [data-act="stop"]').disabled})`);
    for(const value of Object.values(result.listening))assert.equal(value,true);
    main.webContents.send('studio:event',{kind:'record_error',message:'测试监听失败'});
    await pause(60);
    result.failed=await js(`({retry:!!document.querySelector('.record-card [data-act="record-start"]')&&!S.busy,
      ready:!S.recordStarting&&!document.querySelector('.record-card [data-act="record-start"]').disabled})`);
    for(const value of Object.values(result.failed))assert.equal(value,true);
    assert.deepEqual(await js('window.__studioErrors.slice(window.__recordSmokeErrors.length)'),['测试监听失败']);
    await js('window.__studioErrors=window.__recordSmokeErrors');
    result.emptyRetry=await js(`(async()=>{
      let reviewed=0,started=0;
      api=(method,args)=>method==='record_reviewed'?(reviewed++,Promise.resolve({})):method==='record_start'?(started++,Promise.resolve({})):window.__recordSmokeOriginal(method,args);
      S.recordPending={raw_count:0,duration:2,project:{steps:[],selectors:[]},path:'preserved-raw-recording.json'};
      S.view='record';render();
      const retryVisible=!!document.querySelector('[data-act="record-retry"]');
      await retryEmptyRecording();
      const retried=retryVisible&&reviewed===1&&started===1&&S.view==='record'&&S.busy==='recording'&&!S.recordPending;
      S.busy='';S.recordPending={raw_count:1,project:{steps:[],selectors:[]}};
      const pending=S.recordPending;
      await retryEmptyRecording();
      return {retried,preserved:S.recordPending===pending&&reviewed===1&&started===1};
    })()`);
    for(const value of Object.values(result.emptyRetry))assert.equal(value,true);
    result.passed=true;
  }catch(error){result.error=error.stack;throw error;}finally{
    await js("if(window.__recordSmokeOriginal)api=window.__recordSmokeOriginal;S.busy='';S.recordStarting=false;const saved=window.__recordSmokeSaved;Object.assign(S,{connection:saved.connection,handle:saved.handle,view:saved.view,recordPending:saved.pending});render();");
    fs.writeFileSync(artifactFile('smoke','recording-smoke.json'),JSON.stringify(result,null,2));
  }
  return result;
}
module.exports={verify};
