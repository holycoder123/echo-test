'use strict';
const G={connection:null,toolbarLinked:false,busy:'',recordStart:0,recordCount:0,recordPending:false,recordStarting:false};
G.run=null;G.library=[];G.caseChoice='';G.caseName='当前编辑用例';
const call=(method,args={})=>window.studio.call(method,args);
let noticeTimer,recordRequest=false,bundleRequest=false;
window.__gameErrors=[];
function notice(error,level='error'){if(level==='error')window.reportStudioError(error,'toolbar');const text=String(error.message||error);if(level==='error')window.__gameErrors.push(text);window.__gameErrors=window.__gameErrors.slice(-30);const node=document.querySelector('#notice');node.textContent=text;node.hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{node.hidden=true;},7000);}
function renderState(){
  renderCases();RunPanel.update(document.querySelector('#game-run-results'),G.run,{expanded:true});
  const info=G.connection,server=document.querySelector('#server');
  server.textContent=info?.title||'未连接目标应用';
  server.title=info?.title||'';
  document.querySelector('#resolution').textContent=info?`${info.width} × ${info.height}`:'在工作台选择客户端';
  const bundle=document.querySelector('#bundle');bundle.disabled=!info||!!G.busy||G.recordStarting||bundleRequest;
  bundle.textContent=G.toolbarLinked?'解绑':'捆绑目标应用';bundle.setAttribute('aria-pressed',String(!!G.toolbarLinked));
  document.querySelector('#pair-status').textContent=G.toolbarLinked?'窗口已捆绑':'独立模式';
  for(const id of ['coordinate','image','run'])document.querySelector('#'+id).disabled=!info||!!G.busy;
  document.querySelector('#record').disabled=!info||G.busy==='running'||G.recordStarting||recordRequest;
  for(const id of ['game-case','game-iterations','case-refresh'])document.querySelector('#'+id).disabled=!!G.busy;
  document.querySelector('#run').disabled=!info||G.busy==='recording';
  document.querySelector('#run').textContent=G.busy==='running'?'停止执行':'运行用例';
  document.querySelector('#run').classList.toggle('running',G.busy==='running');
  document.querySelector('#record').classList.toggle('active',G.busy==='recording');
  document.querySelector('#record-label').textContent=G.recordStarting?'正在启动…':G.busy==='recording'?'停止录制':G.busy==='running'?'执行期间暂停录制':G.recordPending?'查看录制结果':'开始录制';
  document.querySelector('#indicator').classList.toggle('active',G.busy==='recording');
  document.querySelector('#status').textContent=G.recordStarting?'正在启动录制监听…':G.busy==='recording'?`正在录制 · ${G.recordCount} 个事件`:G.busy==='running'?'用例执行中':G.recordPending?'录制已结束，可在工作台转换为用例':info?'直接操作目标应用，点击开始录制即可记录':'就绪';
  updateClock();
}
function updateClock(){
  const seconds=G.recordStart?Math.floor((Date.now()-G.recordStart)/1000):0;
  document.querySelector('#clock').textContent=G.busy==='recording'?`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')} · F12 停止`:G.toolbarLinked?'窗口已捆绑 · 拖动任一窗口一起移动':'原生窗口 · 工具栏可自由移动';
}
document.querySelector('#record').addEventListener('click',()=>{
  if(recordRequest||G.recordStarting)return;
  recordRequest=true;renderState();
  const request=G.busy?call('stop'):G.recordPending?call('game_action',{action:'view-record'}):call('record_start',{handle:G.connection?.handle});
  request.catch(notice).finally(()=>{recordRequest=false;renderState();});
});
for(const [id,action] of [['coordinate','game-pick-coordinate'],['image','game-pick-image']])document.querySelector('#'+id).addEventListener('click',()=>call('game_action',{action}).catch(notice));
document.querySelector('#run').addEventListener('click',()=>{
  if(G.busy==='running'){call('stop').catch(notice);return;}
  const iterations=Number(document.querySelector('#game-iterations').value);
  if(!Number.isInteger(iterations)||iterations<1||iterations>1000){notice('循环次数需在 1 ~ 1000 之间');return;}
  call('game_action',{action:'run',casePath:G.caseChoice,iterations}).catch(notice);
});
function renderCases(){
  const select=document.querySelector('#game-case');select.replaceChildren();
  select.add(new Option('当前编辑 · '+G.caseName,''));
  for(const item of G.library){const option=new Option(item.name+' · '+item.location,item.path);option.disabled=!!item.error;select.add(option);}
  if(G.library.some(item=>item.path===G.caseChoice&&!item.error))select.value=G.caseChoice;else G.caseChoice='';
}
function refreshCases(){return call('case_list').then(data=>{G.library=data.entries;renderCases();});}
document.querySelector('#game-case').addEventListener('change',event=>G.caseChoice=event.target.value);
document.querySelector('#case-refresh').addEventListener('click',()=>refreshCases().catch(notice));
window.addEventListener('focus',()=>refreshCases().catch(notice));
refreshCases().catch(notice);
document.querySelector('#logs').addEventListener('click',()=>call('game_action',{action:'view-diagnostics'}).catch(notice));
document.querySelector('#help').addEventListener('click',()=>call('game_action',{action:'view-help'}).catch(notice));
document.querySelector('#workbench').addEventListener('click',()=>call('workbench_show').catch(notice));
document.addEventListener('keydown',event=>{if(event.key==='F12'&&G.busy){event.preventDefault();call('stop').catch(notice);}if(event.key==='F1'){event.preventDefault();call('game_action',{action:'view-help'}).catch(notice);}});
window.studio.onEvent(event=>{
  if(event.kind==='game_state'){
    Object.assign(G,event);renderState();

  }
  if(['notice','service_error','record_error','run_error'].includes(event.kind))notice(event.message,event.level||'error');
});
setInterval(()=>{updateClock();RunPanel.tick(document.querySelector('#game-run-results'),G.run);},500);
call('game_state').then(state=>{Object.assign(G,state);renderState();window.__gameReady=true;}).catch(notice);

document.querySelector('#bundle').addEventListener('click',()=>{
  if(bundleRequest||G.busy||G.recordStarting||!G.connection)return;
  bundleRequest=true;renderState();
  call('game_bundle',{linked:!G.toolbarLinked}).then(state=>{Object.assign(G,state);renderState();}).catch(notice).finally(()=>{bundleRequest=false;renderState();});
});
