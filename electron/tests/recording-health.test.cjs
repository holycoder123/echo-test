const {test}=require('node:test');
const assert=require('node:assert/strict');
const {recordingHint}=require('../recording-health.cjs');
test('idle movements are not diagnosed as a lost recording listener',()=>{
  assert.match(recordingHint({listener_alive:true,mouse_observed:135,mouse_buttons_observed:0,key_observed:0}),/移动鼠标不会生成步骤/);
});
test('diagnoses rejected actions without allowing cursor movement to hide the cause',()=>{
  assert.match(recordingHint({mouse_idle_moves:1000,mouse_outside_actions:2}),/客户区之外/);
  assert.match(recordingHint({mouse_obscured_actions:2}),/遮挡/);
  assert.match(recordingHint({mouse_inactive_actions:2}),/失去焦点/);
  assert.match(recordingHint({mouse_self_input_actions:2}),/模拟输入/);
  assert.match(recordingHint({key_inactive:2}),/失去焦点/);
});
test('older recordings retain a useful generic message',()=>assert.match(recordingHint({}),/运行权限/));
