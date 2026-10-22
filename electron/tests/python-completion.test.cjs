const test=require('node:test');
const assert=require('node:assert/strict');
const Completion=require('../renderer/python-completion.js');
test('completion catalog contains every supported public window function',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const worker=fs.readFileSync(path.join(__dirname,'../../echo_test/script_worker.py'),'utf8');
  const body=worker.split('class Window:')[1].split('\ndef ')[0];
  const runtime=[...body.matchAll(/^    def (\w+)\(self/gm)].map(match=>match[1]).filter(name=>!name.startsWith('_')).sort();
  assert.deepEqual(Completion.methods.map(item=>item.name).sort(),runtime);
});
test('window dot lists public methods and filters a partial name',()=>{
  assert.equal(Completion.context('window.',7).prefix,'');
  const names=Completion.suggestions('cl').map(item=>item.name);
  assert.deepEqual(names,['click']);
  for(const name of ['size','locate','drag','scroll','key_down','assert_image','capture'])assert.ok(Completion.suggestions('').some(item=>item.name===name));
});
test('completion replaces a full method identifier and preserves existing call arguments',()=>{
  const code='window.click("button")',cursor=9;
  const context=Completion.context(code,cursor);
  const item=Completion.suggestions('cl')[0];
  const edit=Completion.edit(code,context,item);
  assert.equal(edit.value,code);assert.equal(edit.selectionStart,12);
  const empty=Completion.edit('window.cl',Completion.context('window.cl',9),item);
  assert.equal(empty.value,'window.click()');assert.equal(empty.selectionStart,13);
  const size=Completion.edit('window.si',Completion.context('window.si',9),Completion.suggestions('si')[0]);
  assert.equal(size.value,'window.size()');assert.equal(size.selectionStart,13);
});
test('Python strings, comments, unrelated objects and selections do not trigger completion',()=>{
  for(const code of ['"window.','\'window.','"""window.','# window.','x = "a\\\"window.','other.window.','mywindow.','window..','window .'])assert.equal(Completion.context(code,code.length),null,code);
  const text='"closed"\nwindow.cl';assert.equal(Completion.context(text,text.length).prefix,'cl');
  assert.equal(Completion.context('window.cl',9,8),null);
});
test('completion supports multiline Unicode source and does not confuse browser APIs',()=>{
  const source='名称 = "按钮"\n    window.assert_';
  assert.equal(Completion.context(source,source.length).prefix,'assert_');
  assert.deepEqual(Completion.suggestions('assert_').map(item=>item.name),['assert_image','assert_absent']);
  assert.equal(Completion.suggestions('not_a_function').length,0);
});
