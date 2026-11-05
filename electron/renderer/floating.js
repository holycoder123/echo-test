'use strict';
let state={},pending=false;
const status=document.querySelector('#status');
function update(){
  const recording=state.busy==='recording',blocked=!!state.mcpOperation||state.settingsChanging;
  document.querySelector('#target').textContent=state.connection?.title||'目标窗口';
  document.querySelector('#record').disabled=pending||blocked||!!state.busy||state.recordPending;
  document.querySelector('#stop').disabled=pending||!recording;
  document.querySelector('#screenshot').disabled=pending||blocked||state.recordStarting||!!state.busy&&!recording||state.recordPending;
}
window.floating.onState(value=>{state=value;update();status.textContent=state.recordStarting?'正在启动录制…':state.busy==='recording'?`正在录制 · ${state.recordCount} 个事件 · F12 停止`:state.recordPending?'请在工作台处理录制结果':state.busy?'执行中': '拖动顶部可移动 · 截屏加入截图步骤';});
window.floating.onFeedback(message=>{status.textContent=message;status.title=message;});
document.addEventListener('click',async event=>{
  const action=event.target.closest('[data-action]')?.dataset.action;if(!action||pending)return;
  pending=true;update();
  try{await window.floating.action(action);}catch(error){status.textContent=error.message;status.title=error.message;}
  finally{pending=false;update();}
});
