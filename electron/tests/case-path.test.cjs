const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {defaultCasePath}=require('../case-path.cjs');
test('new case default stays inside the case library for Windows filenames',()=>{
 const directory=path.resolve('test_cases');
 for(const name of ['提取邮件','../逃逸','C:\\外部路径','CON','LPT1','  .','A:*?']){
   const result=defaultCasePath(directory,name);
   assert.equal(path.dirname(result),directory);assert.ok(result.endsWith('.nycs.json'));
   assert.ok(!/^(con|lpt1)\./i.test(path.basename(result)));
 }
});
