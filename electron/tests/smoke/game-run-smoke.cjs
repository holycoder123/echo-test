// UI-only verification: intercepts run IPC; never sends input to a game.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {artifactFile}=require('../../paths.cjs');
const {RunState}=require('../../run-state.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function verify(main){
  const js=code=>main.webContents.executeJavaScript(code);
  const result={};
  try{
    result.selection=await js(`(async()=>{
      S.dirty=false;await api('dirty',{value:false});S.view='game';S.handle=-1;
      S.connection={handle:-1,width:1024,height:700,title:'验证目标窗口'};render();
      const file=S.library.find(item=>!item.error&&item.path!==S.path).path;
      const select=document.querySelector('#game-case');select.value=file;select.dispatchEvent(new Event('change',{bubbles:true}));
      const selected=S.gameCasePath===file;
      const original=api;let captured;api=(method,args)=>method==='run'?(captured=args,Promise.resolve({started:true})):original(method,args);
      try{await handleAction('game-run',{dataset:{}});}finally{api=original;}
      window.__gameRunProject=captured.project;
      return {selected,loaded:S.path===file,staysOnGame:S.view==='game',project:captured.project,handle:captured.handle};
    })()`);
    assert.equal(result.selection.selected,true);assert.equal(result.selection.loaded,true);assert.equal(result.selection.staysOnGame,true);
    assert.equal(result.selection.handle,-1);
    const state=new RunState();state.start(result.selection.project);
    const index=result.selection.project.steps.findIndex(step=>step.enabled!==false);
    const event={kind:'step',index,name:result.selection.project.steps[index].name,iteration:1,repeat:1,status:'running'};
    await js("window.__stableGameResults=document.querySelector('#game-run-results')");
    state.step(event);main.webContents.send('studio:event',{kind:'run_state',run:state.snapshot()});main.webContents.send('studio:event',event);
    const runningSnapshot=state.snapshot();
    await pause(100);
    result.running=await js("({visible:document.querySelector('#game-run-results').textContent.includes(S.runState.current.name)&&document.querySelector('.run-badge.running').textContent==='执行中',locked:document.querySelector('#game-case').disabled,stop:!!document.querySelector('#game-case-controls [data-act=stop]'),stable:window.__stableGameResults===document.querySelector('#game-run-results')})");
    for(const value of Object.values(result.running))assert.equal(value,true);
    const failed={...event,status:'failed',elapsed:1.25,error:'验证用图片未找到'};state.step(failed);state.finish({status:'failed',error:failed.error},'/reports/ui-smoke');
    main.webContents.send('studio:event',{kind:'run_state',run:state.snapshot()});main.webContents.send('studio:event',failed);
    main.webContents.send('studio:event',{kind:'finished',result:{case:state.value.case,status:'failed',steps:[failed]},directory:'/reports/ui-smoke'});
    await pause(150);
    result.finished=await js("({error:document.querySelector('.run-error').textContent==='验证用图片未找到',unlocked:!document.querySelector('#game-case').disabled,result:document.querySelector('.run-heading .run-badge').textContent==='失败',workspaceActions:!!document.querySelector('.game-toolbar [data-act=game-pick-image]'),captureReady:!document.querySelector('.game-toolbar [data-act=game-pick-image]').disabled})");
    for(const value of Object.values(result.finished))assert.equal(value,true);
    await js("document.querySelector('.run-details').open=true");
    await pause(60);
    result.steps=await js("document.querySelectorAll('[data-run-step]').length===S.runState.steps.length");assert.equal(result.steps,true);
    fs.writeFileSync(artifactFile('smoke','game-run-preview.png'),(await main.webContents.capturePage()).toPNG());
    result.unsavedGuard=await js(`(async()=>{
      const file=S.library.find(item=>!item.error&&item.path!==S.path).path;
      S.dirty=true;const name=S.project.name,original=canReplace;canReplace=async()=>false;
      try{await runGameCase(file);}finally{canReplace=original;}
      return S.project.name===name&&S.busy===''&&!S.gameRunStarting;
    })()`);assert.equal(result.unsavedGuard,true);
    result.errors=await js('window.__studioErrors');assert.deepEqual(result.errors,[]);
    result.passed=true;return result;
  }catch(error){result.error=error.stack;throw error;}
  finally{
    fs.writeFileSync(artifactFile('smoke','game-run-smoke.json'),JSON.stringify(result,null,2));
    await js("S.connection=null;S.busy='';S.dirty=false");
  }
}
module.exports={verify};
