// Replay UI uses mocked execution; this test sends no game input.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {artifactFile}=require('../../paths.cjs');
const {RunState}=require('../../run-state.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function verify(main){
  const js=code=>main.webContents.executeJavaScript(code),result={};
  try{
    result.start=await js(`(async()=>{
      window.__replaySaved={api,project:S.project,path:S.path,dirty:S.dirty,view:S.view,handle:S.handle,connection:S.connection,iterations:S.iterations,pending:S.recordPending,run:S.runState,replay:S.recordReplayRun,stepStatus:S.stepStatus};
      window.__replayCalls=[];
      api=(method,args)=>{
        window.__replayCalls.push({method,args});
        if(method==='run'){window.__replayArgs=args;return new Promise(resolve=>window.__replayResolve=resolve);}
        if(['stop','workbench_show'].includes(method))return Promise.resolve({});
        return window.__replaySaved.api(method,args);
      };
      S.handle=-1;S.connection=null;S.busy='';S.view='record';S.dirty=true;S.iterations=7;
      S.stepStatus={0:'passed'};
      S.recordPending={raw_count:2,duration:1,project:{name:'测试录制',schema_version:1,
        selectors:[{name:'录制位置',kind:'coordinate',x:.5,y:.5,normalized:true}],
        steps:[{name:'点击控件',action:'click',target:'录制位置',enabled:true,timeout:5,delay:.2,repeat:1,params:{}}]}};
      window.__replayPending=S.recordPending;window.__replayOriginal=JSON.stringify(S.recordPending);
      render();const visible=!!document.querySelector('[data-act="record-replay"]')&&!document.querySelector('[data-act="record-replay"]').disabled;
      window.__replayPromise=handleAction('record-replay',{dataset:{}});
      await handleAction('record-replay',{dataset:{}});
      await handleAction('record-append',{dataset:{}});await handleAction('record-discard',{dataset:{}});
      return {visible,recordedOnly:window.__replayArgs.project.steps.length===1&&window.__replayArgs.project.steps[0].target==='录制位置',
        once:window.__replayArgs.iterations===1&&window.__replayArgs.source==='recording',
        single:window.__replayCalls.filter(row=>row.method==='run').length===1,
        editorPreserved:S.project===window.__replaySaved.project&&S.path===window.__replaySaved.path&&S.dirty,
        recordingPreserved:S.recordPending===window.__replayPending&&JSON.stringify(S.recordPending)===window.__replayOriginal,
        locked:document.querySelector('[data-act="record-append"]').disabled&&document.querySelector('[data-act="record-discard"]').disabled,
        stop:!!document.querySelector('.record-choice [data-act="stop"]')};
    })()`);
    for(const value of Object.values(result.start))assert.equal(value,true);
    const project=await js('window.__replayArgs.project'),state=new RunState();state.start(project,1,null,'recording');
    main.webContents.send('studio:event',{kind:'run_state',run:state.snapshot()});await pause(80);
    result.progress=await js("!!document.querySelector('#record-replay-results .run-badge.running')");assert.equal(result.progress,true);
    await js("handleAction('stop',{dataset:{}})");
    const step={index:0,name:'点击控件',iteration:1,repeat:1,status:'stopped'};
    state.step(step);state.finish({status:'stopped',steps:[step]},'/reports/replay-ui-smoke');
    await js('window.__replayResolve({started:true});window.__replayPromise');
    await js("S.view='game';render()");
    main.webContents.send('studio:event',{kind:'run_state',run:state.snapshot()});main.webContents.send('studio:event',{kind:'step',...step});
    main.webContents.send('studio:event',{kind:'finished',result:{status:'stopped',case:project.name,steps:[step]},directory:'/reports/replay-ui-smoke'});
    await pause(100);
    result.finished=await js(`({returned:S.view==='record'&&!S.busy&&!S.recordReplaying,
      retained:S.recordPending===window.__replayPending&&JSON.stringify(S.recordPending)===window.__replayOriginal,
      editorPreserved:S.project===window.__replaySaved.project&&S.path===window.__replaySaved.path&&S.dirty&&S.stepStatus[0]==='passed',
      report:document.querySelector('#record-replay-results .run-badge').textContent==='已停止'&&!!document.querySelector('[data-act="open-report"][data-id="replay-ui-smoke"]'),
      canReplayAgain:!document.querySelector('[data-act="record-replay"]').disabled,
      stopSent:window.__replayCalls.some(row=>row.method==='stop'),notConsumed:!window.__replayCalls.some(row=>row.method==='record_reviewed')})`);
    for(const value of Object.values(result.finished))assert.equal(value,true);
    await js("document.querySelector('#toasts').replaceChildren()");
    fs.writeFileSync(artifactFile('smoke','record-replay-preview.png'),(await main.webContents.capturePage()).toPNG());
    result.guards=await js(`(async()=>{
      api=async(method,args)=>{if(method==='run')throw new Error('测试启动失败');if(method==='workbench_show')return {};return window.__replaySaved.api(method,args);};
      let failed=false;try{await replayRecording();}catch(error){failed=error.message==='测试启动失败';}
      const retry=failed&&!S.busy&&!S.recordReplaying&&S.recordPending===window.__replayPending;
      S.handle=null;let disconnected=false;try{await replayRecording();}catch(error){disconnected=error.message==='请先连接游戏窗口';}
      S.handle=-1;S.recordPending={raw_count:0,duration:1,project:{steps:[],selectors:[]}};render();
      const empty=document.querySelector('[data-act="record-replay"]').disabled;await replayRecording();
      return {retry,disconnected,empty:empty&&!S.busy};
    })()`);
    for(const value of Object.values(result.guards))assert.equal(value,true);
    result.errors=await js('window.__studioErrors');assert.deepEqual(result.errors,[]);
    result.passed=true;return result;
  }catch(error){result.error=error.stack;throw error;}
  finally{
    await js(`if(window.__replaySaved){const saved=window.__replaySaved;api=saved.api;Object.assign(S,{project:saved.project,path:saved.path,dirty:saved.dirty,view:saved.view,handle:saved.handle,connection:saved.connection,iterations:saved.iterations,recordPending:saved.pending,runState:saved.run,recordReplayRun:saved.replay,stepStatus:saved.stepStatus,busy:'',recordReplaying:false});render();}`);
    fs.writeFileSync(artifactFile('smoke','replay-smoke.json'),JSON.stringify(result,null,2));
  }
}
module.exports={verify};
