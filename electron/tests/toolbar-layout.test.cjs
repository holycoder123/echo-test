const {test}=require('node:test');
const assert=require('node:assert/strict');
const {toolbarBounds}=require('../toolbar-layout.cjs');

test('sidebar prefers 380 pixels and aligns with the entire game window',()=>{
  const result=toolbarBounds({x:100,y:100,width:1040,height:730},{x:0,y:0,width:1920,height:1040});
  assert.deepEqual(result,{x:1148,y:100,width:380,height:730});
});
test('sidebar narrows to available space and respects negative monitor origins',()=>{
  const result=toolbarBounds({x:-1920,y:30,width:1040,height:730},{x:-1920,y:0,width:1366,height:768});
  assert.equal(result.width,318);
  assert.equal(result.height,730);
  assert.ok(result.x>=-1920&&result.x+result.width<=-554);
  assert.ok(result.y>=0&&result.y+result.height<=768);
});
test('sidebar caps height at the work area on a scaled or short monitor',()=>{
  const result=toolbarBounds({x:0,y:0,width:820,height:560},{x:0,y:0,width:1100,height:550});
  assert.equal(result.width,300);
  assert.equal(result.height,550);
  assert.equal(result.y,0);
});
