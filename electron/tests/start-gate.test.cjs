const test=require('node:test');
const assert=require('node:assert/strict');
const {StartGate}=require('../start-gate.cjs');
test('stop during foreground handoff prevents submitting any input worker',async()=>{
  const gate=new StartGate();const generation=gate.begin();let release,submitted=0;
  const handoff=new Promise(resolve=>{release=resolve;});
  const pending=(async()=>{await handoff;return gate.submit(generation,()=>{submitted++;});})();
  gate.cancel();release();await assert.rejects(pending,error=>error.cancelled===true);
  gate.finish();assert.equal(submitted,0);assert.equal(gate.pending,false);
});
test('a cancelled start does not cancel a subsequent explicit run',()=>{
  const gate=new StartGate();const first=gate.begin();gate.cancel();gate.finish();
  const second=gate.begin();assert.throws(()=>gate.submit(first,()=>{}));
  assert.equal(gate.submit(second,()=>42),42);gate.finish();
});
test('submit writes synchronously after validation so a later stop follows the start',()=>{
  const gate=new StartGate();const generation=gate.begin();const operations=[];
  gate.submit(generation,()=>{operations.push('start');return Promise.resolve();});
  gate.cancel();operations.push('stop');assert.deepEqual(operations,['start','stop']);
});
