'use strict';

function initializeAndroid(){
  S.android={devices:[],connection:null,adbPath:'',adbSource:'',error:'',previewError:'',notice:'',loading:false,acting:false,frame:null,
    videoStatus:'idle',videoFailed:false,videoMessage:'',
    endpoint:'',pairEndpoint:'',pairCode:'',text:'',package:''};
}
function hasTarget(){return !!(S.android.connection||S.handle);}
function targetArgs(){return S.android.connection?{target:{platform:'android',serial:S.android.connection.serial}}:{handle:S.handle};}
function androidInteractionLocked(){
  const a=S.android;
  return !a.connection||!a.frame||a.acting||!!a.previewError||!!S.mcpOperation||!!S.gameRunStarting||!!(S.busy&&S.busy!=='recording')||!AndroidVideo.usable();
}
function updateAndroidInteraction(){
  const locked=androidInteractionLocked();
  for(const node of document.querySelectorAll('.android-navigation [data-act="android-key"],.android-text-input input,.android-text-input [data-act="android-text"]'))if(node.disabled!==locked)node.disabled=locked;
}
function androidView(){
  const a=S.android,connected=a.connection,locked=disabled()||a.acting||a.loading||S.connecting;
  const interactionLocked=androidInteractionLocked();
  return `<div class="android-page">
  <div class="android-layout"><aside class="android-device-panel"><section class="android-card"><div class="android-section-heading"><h2>设备连接</h2>${button(a.loading?'刷新中…':'刷新设备','android-refresh','ghost','refresh',locked?'disabled':'')}</div><p class="field-help">手机开启 USB 调试，连接电脑后允许调试授权。也支持 ADB 已启动的模拟器。</p>${a.error?`<p class="android-error" role="alert">${esc(a.error)}</p>`:''}
  <div class="android-device-list">${a.devices.map(device=>`<div class="android-device"><div><strong>${esc(device.model)}</strong><small>${esc(device.serial)} · ${{usb:'USB',wifi:'无线',emulator:'模拟器'}[device.transport]||'ADB'}</small><small>${esc({device:'可连接',unauthorized:'等待手机授权',offline:'设备离线'}[device.state]||device.state)}</small></div>${button(connected?.serial===device.serial?'已连接':'连接','android-connect',connected?.serial===device.serial?'quiet':'','',`data-serial="${esc(device.serial)}" ${locked||device.state!=='device'||connected?.serial===device.serial?'disabled':''}`)}</div>`).join('')||'<div class="empty compact"><strong>暂无安卓设备</strong><p>连接手机后点击刷新设备。</p></div>'}</div>${connected?button('断开设备','android-disconnect','danger android-disconnect-button','',locked?'disabled':''):''}</section>
  <details class="android-card"><summary>无线调试</summary><p class="field-help">Android 11 及以上可在「无线调试 → 使用配对码配对设备」中获取地址和配对码。配对端口与连接端口通常不同。</p>${field('配对地址',input(a.pairEndpoint,'data-android-field="pairEndpoint"','text','placeholder="192.168.1.10:配对端口"'))}${field('配对码',input(a.pairCode,'data-android-field="pairCode"','password','maxlength="6" autocomplete="off"'))}${button('配对设备','android-pair','quiet','',locked?'disabled':'')}${field('连接地址',input(a.endpoint,'data-android-field="endpoint"','text','placeholder="192.168.1.10:连接端口"'))}${button('连接无线设备','android-network','quiet','',locked?'disabled':'')}<p class="field-help">旧版安卓需先通过 USB 启用 ADB TCP/IP，再填写地址连接。</p></details>
  ${connected?`<section class="android-card"><h2>启动应用</h2>${field('应用包名',input(a.package,'data-android-field="package"','text','placeholder="com.example.app"'))}${button('启动应用','android-launch','quiet','play',locked||S.busy?'disabled':'')}</section>`:''}${a.notice?`<p class="field-help" role="status">${esc(a.notice)}</p>`:''}</aside>
  <section class="android-preview-panel android-card"><div class="android-section-heading"><div><h2>${esc(connected?.model||'手机画面')}</h2><p class="field-help">${connected?`${esc(connected.serial)} · <span id="android-resolution">${a.frame?`${a.frame.width} × ${a.frame.height}`:''}</span>`:'连接设备后显示画面'}</p></div>${connected?`<div class="android-preview-actions">${button('重连画面','android-frame','ghost','refresh',a.loading||a.acting||(S.busy&&S.busy!=='recording')?'disabled':'')}</div>`:''}</div>
  ${connected?`<div class="android-preview-toolbar">${button(S.busy==='recording'?'停止录制 · F12':'开始录制',S.busy==='recording'?'stop':'record-start',S.busy==='recording'?'record':'quiet','record',S.busy==='running'||a.acting||S.recordPending?'disabled':'')}${button(S.busy==='running'?'停止执行 · F12':'运行当前用例',S.busy==='running'?'stop':'android-run','primary',S.busy==='running'?'stop':'play',S.busy==='recording'||a.acting||!S.project.steps.length&&S.project.mode!=='python'?'disabled':'')}</div><p class="android-record-status">${S.busy==='recording'?`正在录制预览中的操作 · ${S.recordCount} 个操作 · 仅录制通过本工作台发出的操作`:S.busy==='running'?'用例执行中 · F12 停止':'单击为点击，按住为长按，拖动为滑动。视频模式自动调整画面帧率，静止画面会减少传输。'}</p><p id="android-preview-error" class="android-error" role="status" ${a.previewError?'':'hidden'}>${esc(a.previewError)}</p><p id="android-video-status" class="field-help" role="status"></p><div class="android-screen-wrap"><canvas id="android-stream-screen" class="android-screen" aria-label="安卓实时视频画面，可点击或拖动操作" hidden></canvas><span id="android-frame-placeholder" ${AndroidVideo.hasFrame&&!a.videoFailed?'hidden':''}>正在获取手机画面…</span></div><nav class="android-navigation" aria-label="安卓系统导航">${[['BACK','返回','android_back'],['HOME','主界面','android_home'],['APP_SWITCH','多任务','android_tasks']].map(([key,label,glyph])=>button('','android-key','android-nav-button',glyph,`data-key="${key}" title="${label}" aria-label="${label}" ${interactionLocked?'disabled':''}`)).join('')}</nav><div class="android-text-input"><input data-android-field="text" value="${esc(a.text)}" placeholder="输入文本（首版支持 ASCII）" aria-label="安卓输入文本" ${interactionLocked?'disabled':''}>${button('发送文本','android-text','quiet','',interactionLocked?'disabled':'')}</div><div class="android-preview-tools">${button('采集 UI 控件','android-ui-open','ghost','targets',disabled()||a.acting?'disabled':'')}${button('采集图片控件','android-pick-image','ghost','image',disabled()||a.acting?'disabled':'')}${button('采集坐标控件','android-pick-coordinate','ghost','coordinate',disabled()||a.acting?'disabled':'')}${button('整理录制结果','view-record','ghost','',S.recordPending?'':'disabled')}</div><section id="android-run-results" class="game-run-results" aria-label="安卓用例运行状态">${RunPanel.html(S.runState)}</section>`:'<div class="android-preview-empty">'+icon('android')+'<strong>连接一台安卓设备</strong><p>支持 USB 与无线调试，图片和 OCR 定位沿用现有控件库。</p></div>'}</section></div></div>`;
}
async function refreshAndroidDevices(){
  const a=S.android;if(a.loading||a.acting)return;
  a.loading=true;a.error='';render();
  try{const data=await api('android_devices');a.devices=data.devices;a.adbPath=data.adb_path;a.adbSource=data.adb_source||'external';}
  catch(error){a.error=error.message;}
  finally{a.loading=false;if(S.view==='android')render();}
}
async function sendAndroidAction(action,params){
  if(androidInteractionLocked())return;
  if(!['key','text'].includes(action))throw new Error('预览触控请通过实时视频画面操作');
  await AndroidVideo.control(action,params);
}
async function androidAction(action,node){
  if(action.startsWith('android-ui-'))return androidUiAction(action,node);
  const a=S.android;
  if(action==='view-android'){S.view='android';render();if(!S.busy)await refreshAndroidDevices();return;}
  if(action==='android-frame'){AndroidVideo.stop(true);a.frame=null;a.videoFailed=false;a.previewError='';syncAndroidPreview();return;}
  if(action==='android-key'){await sendAndroidAction('key',{keys:node.dataset.key});return;}
  if(action==='android-text'){await sendAndroidAction('text',{text:a.text});return;}
  if(action==='android-run'){await run({stayOnGame:true});return;}
  if(action==='android-pick-image'||action==='android-pick-coordinate'){await pickGameControl(action==='android-pick-image'?'image':'coordinate');return;}
  if(action==='android-refresh'){if(lock())return;await refreshAndroidDevices();return;}
  if(a.acting||a.loading||lock()||S.connecting)return;
  a.acting=true;
  try{
    if(action==='android-connect'){
      const data=await api('android_connect',{serial:node.dataset.serial});a.connection=data.connection;a.frame=null;a.previewError='';a.videoFailed=false;S.connection=null;S.handle=null;
    }
    if(action==='android-disconnect'){await api('android_disconnect');a.connection=null;a.frame=null;a.previewError='';}
    if(action==='android-pair'){const result=await api('android_pair',{endpoint:a.pairEndpoint.trim(),code:a.pairCode.trim()});a.pairCode='';a.notice=result.message;}
    if(action==='android-network'){const result=await api('android_network_connect',{endpoint:a.endpoint.trim()});a.notice=result.message;}
    if(action==='android-launch'){a.frame=await api('android_launch',{...targetArgs(),package:a.package.trim()});a.previewError='';}
    a.error='';
  }catch(error){a.error=error.message;}
  finally{a.acting=false;render();}
  if(['android-network','android-pair'].includes(action))await refreshAndroidDevices();
}
function androidPoint(event,image,frame,clamp=false){
  const rectangle=image.getBoundingClientRect();
  if(!clamp&&(event.clientX<rectangle.left||event.clientX>rectangle.right||event.clientY<rectangle.top||event.clientY>rectangle.bottom))return null;
  return [Math.max(0,Math.min(frame.width-1,Math.round((event.clientX-rectangle.left)/rectangle.width*(frame.width-1)))),Math.max(0,Math.min(frame.height-1,Math.round((event.clientY-rectangle.top)/rectangle.height*(frame.height-1))))];
}
document.addEventListener('input',event=>{if(event.target.dataset.androidField&&typeof S!=='undefined')S.android[event.target.dataset.androidField]=event.target.value;});
document.addEventListener('pointerdown',event=>{
  if(event.target.id!=='android-stream-screen'||event.button!==0)return;
  const a=S.android;if(a.acting||a.previewError||!a.frame||(S.busy&&S.busy!=='recording')||S.modal||S.mcpOperation)return;
  if(!AndroidVideo.usable())return;
  const live=true,frame={width:AndroidVideo.geometry[0],height:AndroidVideo.geometry[1]};
  const point=androidPoint(event,event.target,frame);if(!point)return;
  event.preventDefault();const gesture={point,started:performance.now(),frame,pointerId:event.pointerId,live,id:crypto.randomUUID(),element:event.target};a.pointer=gesture;event.target.setPointerCapture(event.pointerId);
  if(live)AndroidVideo.control('down',{point,gesture_id:gesture.id}).catch(error=>androidGestureError(gesture,error));
});
function androidGestureError(gesture,error){
  if(S.android.pointer===gesture)cancelAndroidGesture();
  S.android.previewError=error.message;
  const node=document.querySelector('#android-preview-error');if(node){node.textContent=error.message;node.hidden=false;}
}
function cancelAndroidGesture(notify=true){
  const a=S.android,gesture=a.pointer;if(!gesture)return;a.pointer=null;
  if(gesture.raf)cancelAnimationFrame(gesture.raf);
  if(notify&&gesture.live)AndroidVideo.control('cancel',{gesture_id:gesture.id}).catch(()=>{});
  if(gesture.element?.hasPointerCapture?.(gesture.pointerId))gesture.element.releasePointerCapture(gesture.pointerId);
}
document.addEventListener('pointermove',event=>{
  const gesture=S.android.pointer;if(!gesture?.live||gesture.pointerId!==event.pointerId)return;
  gesture.latest=androidPoint(event,gesture.element,gesture.frame,true);
  if(!gesture.raf)gesture.raf=requestAnimationFrame(()=>{
    gesture.raf=null;if(S.android.pointer===gesture){gesture.sentPoint=gesture.latest;AndroidVideo.control('move',{point:gesture.latest,gesture_id:gesture.id}).catch(error=>androidGestureError(gesture,error));}
  });
});
document.addEventListener('pointerup',event=>{
  const a=S.android,gesture=a.pointer;if(!gesture||gesture.pointerId!==event.pointerId)return;a.pointer=null;
  if(gesture.raf)cancelAnimationFrame(gesture.raf);
  if(gesture.live){
    const end=androidPoint(event,gesture.element,gesture.frame,true);
    if(String(end)!==String(gesture.sentPoint||gesture.point))AndroidVideo.control('move',{point:end,gesture_id:gesture.id}).catch(error=>androidGestureError(gesture,error));
    AndroidVideo.control('up',{point:end,gesture_id:gesture.id}).catch(error=>androidGestureError(gesture,error));return;
  }

});
document.addEventListener('pointercancel',()=>{if(typeof S!=='undefined')cancelAndroidGesture();});
document.addEventListener('lostpointercapture',event=>{if(S.android.pointer?.pointerId===event.pointerId)cancelAndroidGesture();});
window.addEventListener('blur',()=>cancelAndroidGesture());
document.addEventListener('keydown',event=>{if(event.key==='Escape')cancelAndroidGesture();});
