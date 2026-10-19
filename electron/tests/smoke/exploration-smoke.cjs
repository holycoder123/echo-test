// Renderer events only: never sends application input or saves an exploration.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {artifactFile}=require('../../paths.cjs');
const {RunState}=require('../../run-state.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function verify(main){
  const js=code=>main.webContents.executeJavaScript(code),result={};
  try{
    await js(`window.__exploreSaved={api,project:S.project,path:S.path,dirty:S.dirty,pending:S.recordPending,stepStatus:S.stepStatus,view:S.view,connection:S.connection,handle:S.handle,run:S.runState,last:S.lastResult};
      window.__exploreOriginal=JSON.stringify(S.project);window.__exploreReports=0;
      api=(method,args)=>{if(method==='reports')window.__exploreReports++;return window.__exploreSaved.api(method,args);};
      S.view='game';S.dirty=true;S.recordPending={preserved:true};S.stepStatus={0:'failed'};S.busy='running';S.handle=-1;
      S.connection={handle:-1,width:1024,height:700,title:'探索验证'};render();`);
    const state=new RunState();
    state.start({name:'MCP 临时探索',steps:[{name:'检查按钮',action:'click',enabled:true,repeat:1}]},1,null,'exploration');
    main.webContents.send('studio:event',{kind:'run_state',run:state.snapshot()});
    const event={kind:'step',index:0,name:'检查按钮',iteration:1,repeat:1,status:'passed',elapsed:.2};
    state.step(event);state.finish({status:'passed',steps:[event]},null);
    main.webContents.send('studio:event',event);
    main.webContents.send('studio:event',{kind:'run_state',run:state.snapshot()});
    main.webContents.send('studio:event',{kind:'finished',source:'exploration',directory:null,result:{case:'MCP 临时探索',status:'passed',steps:[event]}});
    await pause(120);
    Object.assign(result,await js(`({editor:JSON.stringify(S.project)===window.__exploreOriginal&&S.path===window.__exploreSaved.path&&S.dirty,
      recording:S.recordPending.preserved,stepStatus:S.stepStatus[0]==='failed',finished:S.busy===''&&S.lastResult.status==='passed',
      noReport:!S.lastResult.id&&!S.runState.reportId&&window.__exploreReports===0,
      visible:document.querySelector('#game-run-results').textContent.includes('MCP 临时探索'),errors:window.__studioErrors})`));
    for(const [name,value] of Object.entries(result))if(name!=='errors')assert.equal(value,true,name);
    assert.deepEqual(result.errors,[]);result.passed=true;
  }catch(error){result.error=error.stack;throw error;}
  finally{
    fs.writeFileSync(artifactFile('smoke','exploration-smoke.json'),JSON.stringify(result,null,2));
    await js(`if(window.__exploreSaved){const saved=window.__exploreSaved;api=saved.api;Object.assign(S,{project:saved.project,path:saved.path,dirty:saved.dirty,recordPending:saved.pending,stepStatus:saved.stepStatus,view:saved.view,connection:saved.connection,handle:saved.handle,runState:saved.run,lastResult:saved.last,busy:''});render();}`);
  }
}
module.exports={verify};
