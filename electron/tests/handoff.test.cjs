const {test} = require('node:test');
const assert = require('node:assert/strict');
const {GameHandoff} = require('../handoff.cjs');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the actual main-process completion handler without creating Electron
// windows or activating real desktop clients.
const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
const receiveSource = mainSource.slice(mainSource.indexOf('function receive(event) {'), mainSource.indexOf('\nfunction createBridge()'));
function complete(role, event) {
  let minimized = true, restores = 0, shown = 0;
  const context = {
    event, continuousRole:role, busy:'running', recordStarting:true, recordPending:false,
    gameWindow:null,sidebarLayout:null,
    recordStart:0, recordCount:0, motionEvents:[],
    automation:{receive(){}}, runState:{step(){},finish(){},fail(){}},
    publishRun(){}, auditError(){}, auditWrite(){}, errorMessage:error=>error.message,
    registerStop(){}, send(){}, sendGameState(){},
    showWorkbench(){shown++;},
    window:{isMinimized:()=>minimized,restore(){minimized=false;restores++;}},
  };
  vm.runInNewContext(receiveSource + '\nreceive(event);', context);
  return {context,minimized,restores,shown};
}

function fixture(granted = true) {
  const events = [];
  let minimized = false;
  const window = {isDestroyed: () => false, isMinimized: () => minimized,
    minimize: () => {minimized = true; events.push('minimize');},
    restore: () => {minimized = false; events.push('restore');},
    show: () => events.push('show'), focus: () => events.push('focus')};
  const handoff = new GameHandoff(window, async () => {events.push('grant'); return {granted};},
    async () => events.push('settle'));
  return {handoff, events, window};
}
test('grants permission and clears the workbench before screenshot; restores afterwards', async () => {
  const {handoff, events} = fixture();
  const result = await handoff.call(async () => {events.push('capture'); return {image:'png'};});
  assert.deepEqual(events, ['grant','minimize','settle','capture','restore','show','focus']);
  assert.equal(result.image, 'png');
});
test('keeps workbench minimized after starting recording or execution', async () => {
  const {handoff, window} = fixture();
  await handoff.call(async () => ({started: true}), true);
  assert.equal(window.isMinimized(), true);
});

test('successful MCP capture and preview keep the game foreground across observations', async () => {
  const {handoff, events, window} = fixture();
  const frame = await handoff.call(async () => {events.push('capture');return {id:'capture-1',image:'png'};}, true);
  assert.equal(frame.id, 'capture-1');
  assert.equal(window.isMinimized(), true);
  const preview = await handoff.call(async () => {events.push('preview');return {point:[10,20],image:'png'};}, true);
  assert.deepEqual(preview.point, [10,20]);
  assert.equal(window.isMinimized(), true);
  assert.equal(handoff.pending, false);
  assert.deepEqual(events, ['grant','minimize','settle','capture','grant','minimize','settle','preview']);
});

test('failed MCP observation restores the workbench and manual capture still returns to it', async () => {
  const {handoff, events, window} = fixture();
  await assert.rejects(handoff.call(async () => {throw new Error('目标应用未在前台');}, true), /目标应用未在前台/);
  assert.equal(window.isMinimized(), false);
  assert.equal(handoff.pending, false);
  events.length = 0;
  await handoff.call(async () => {events.push('manual capture');return {image:'png'};});
  assert.equal(window.isMinimized(), false);
  assert.deepEqual(events, ['grant','minimize','settle','manual capture','restore','show','focus']);
});
test('restores workbench after activation failure, then allows retry', async () => {
  const {handoff, window} = fixture();
  await assert.rejects(handoff.call(async () => {throw new Error('无法激活');}, true), /无法激活/);
  assert.equal(window.isMinimized(), false);
  await handoff.call(async () => ({}));
});
test('denied grant still relies on backend verification; overlapping handoffs are rejected', async () => {
  const {handoff} = fixture(false);
  let release;
  const first = handoff.call(() => new Promise(resolve => {release=resolve;}));
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(handoff.call(async () => ({})), /正在切换/);
  release({verified:true});
  assert.deepEqual(await first, {verified:true});
});

test('a completed MCP run keeps the game foreground and clears its persistent role', () => {
  const result = complete('mcp', {kind:'finished',result:{status:'passed'},directory:'report'});
  assert.equal(result.minimized, true);
  assert.equal(result.restores, 0);
  assert.equal(result.context.continuousRole, '');
  assert.equal(result.context.busy, '');
  assert.equal(result.context.recordStarting, false);
});

test('manual runs and unsuccessful MCP runs restore the workbench for review', () => {
  for(const [role,event] of [
    ['main',{kind:'finished',result:{status:'passed'},directory:'report'}],
    ['game',{kind:'finished',result:{status:'passed'},directory:'report'}],
    ['mcp',{kind:'finished',result:{status:'failed'},directory:'report'}],
    ['mcp',{kind:'finished',result:{status:'stopped'},directory:'report'}],
    ['mcp',{kind:'run_error',message:'执行失败'}],
  ]){
    const result=complete(role,event);
    assert.equal(result.minimized,false);
    assert.equal(result.restores,1);
    assert.equal(result.context.continuousRole,'');
    assert.equal(result.context.busy,'');
  }
});

test('MCP recording completion still presents the pending recording in the workbench', () => {
  const result=complete('mcp',{kind:'record_stopped',raw_count:2,duration:1,project:{steps:[]}});
  assert.equal(result.minimized,false);
  assert.equal(result.restores,1);
  assert.equal(result.shown,1);
  assert.equal(result.context.recordPending,true);
  assert.equal(result.context.continuousRole,'');
});
