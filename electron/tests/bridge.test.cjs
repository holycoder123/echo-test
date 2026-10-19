const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {PythonBridge} = require('../bridge.cjs');
function create() {return new PythonBridge(process.execPath,[path.join(__dirname,'mock-service.cjs')]);}
test('matches out-of-order responses to their requests', async () => {
  const bridge=create();
  try {
    const result=await Promise.all([bridge.call('echo',{text:'第一条',delay:40}),bridge.call('echo',{text:'第二条',delay:1})]);
    assert.equal(result[0].text,'第一条');assert.equal(result[1].text,'第二条');
  } finally {await bridge.shutdown();}
});
test('separates execution events from command responses', async () => {
  const bridge=create();const events=[];bridge.on('event',event=>events.push(event));
  try {await bridge.call('event',{value:1});assert.equal(events[0].name,'测试');}finally{await bridge.shutdown();}
});
test('rejects backend errors and times out missing responses', async () => {
  const bridge=create();
  try {await assert.rejects(bridge.call('fail'),/测试错误/);await assert.rejects(bridge.call('hang',{},30),/超时/);}finally{await bridge.shutdown();}
});

test('audit observer receives request timings and complete backend traceback, without arguments',async()=>{
 const bridge=create(),events=[];bridge.audit=(stage,method,details,error)=>events.push({stage,method,details,error});
 try{await assert.rejects(bridge.call('fail',{password:'private'}),error=>error.backendTrace.includes('hook failed'));
 assert.equal(events[0].stage,'start');assert.equal(events[1].stage,'error');assert.ok(events[1].details.elapsedMs>=0);assert.equal(JSON.stringify(events).includes('private'),false);
 }finally{await bridge.shutdown();}
});
