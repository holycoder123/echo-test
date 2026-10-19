// Explain a zero-event recording from counters; never inspect input payloads.
function recordingHint(d={}){
  if(d.listener_alive===false&&d.event_count===undefined)return '录制监听已停止，请重新开始录制。';
  const reasons=[
    [(d.mouse_self_input_actions||0)+(d.key_self_input||0),'已忽略本工具生成的模拟输入。请直接操作游戏后再停止录制。'],
    [(d.mouse_inactive_actions||0)+(d.key_inactive||0),'操作时游戏失去焦点。请切回所选游戏画面后操作。'],
    [d.mouse_obscured_actions||0,'点击位置被其他窗口遮挡，或游戏窗口未接收输入。请切回游戏画面；仍无响应时切换独立窗口重试。'],
    [d.mouse_outside_actions||0,'点击发生在游戏客户区之外。请在游戏画面内操作。'],
  ].sort((a,b)=>b[0]-a[0]);
  if(reasons[0][0])return reasons[0][1];
  if(d.mouse_observed!==undefined&&!d.mouse_buttons_observed&&!d.mouse_wheel_observed&&!d.key_observed&&!d.raw_key_observed)return '尚未收到点击、滚轮或按键。移动鼠标不会生成步骤，请在游戏中完成一次点击。';
  return '未采集到游戏操作，请检查所选窗口、焦点和运行权限；详情见错误日志。';
}
module.exports={recordingHint};
