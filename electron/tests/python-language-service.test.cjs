const test=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path');
const {PythonLanguageService}=require('../python-language-service.cjs');
test('Python language service provides semantic completion, signatures, definitions and diagnostics without running code',async t=>{
  const notices=[];const service=new PythonLanguageService({root:path.resolve(__dirname,'../..'),onDiagnostics:event=>notices.push(event)});
  t.after(()=>service.close());
  await service.sync({id:'language-test',version:1,code:'import math\nmath.'});
  const completions=await service.query('completion',{id:'language-test',version:1,line:1,character:5});
  assert.ok((completions.items||completions).some(item=>item.label==='sqrt'));
  await service.sync({id:'language-test',version:2,code:'window.click('});
  const signature=await service.query('signature',{id:'language-test',version:2,line:0,character:13});
  assert.ok(signature.signatures.some(item=>item.label.includes('target')));
  await service.sync({id:'language-test',version:3,code:'def greet(name: str):\n    return name.upper()\ngreet("中文")\n'});
  const definitions=await service.query('definition',{id:'language-test',version:3,line:2,character:2});
  assert.equal(definitions[0].range.start.line,0);
  const hover=await service.query('hover',{id:'language-test',version:3,line:2,character:2});
  assert.ok(JSON.stringify(hover).includes('greet'));
  const references=await service.query('references',{id:'language-test',version:3,line:0,character:5});
  assert.ok(references.some(item=>item.range.start.line===2));
  await service.sync({id:'language-test',version:4,code:'unknown_symbol + 1\n'});
  const deadline=Date.now()+10000;
  while(Date.now()<deadline&&!notices.some(n=>n.id==='language-test'&&n.version===4&&n.diagnostics.some(d=>d.range.start.line===0)))await new Promise(resolve=>setTimeout(resolve,50));
  assert.ok(notices.some(n=>n.version===4&&n.diagnostics.some(d=>d.message.includes('unknown_symbol'))));
  await assert.rejects(service.sync({id:'../escape',version:1,code:'pass'}));
  await assert.rejects(service.query('execute',{id:'language-test',version:4,line:0,character:0}));
});
test('analysis preserves future imports and reports positions in the original document',async t=>{
  const notices=[],service=new PythonLanguageService({onDiagnostics:event=>notices.push(event)});t.after(()=>service.close());
  await service.sync({id:'future',version:1,code:'from __future__ import annotations\n\ndef square(value: int) -> int:\n    return value * value\nsquare(2)\n'});
  const definition=await service.query('definition',{id:'future',version:1,line:4,character:2});
  assert.equal(definition[0].range.start.line,2);
  assert.equal(await service.query('hover',{id:'future',version:2,line:4,character:2}),null);
  service.closeDocument('future');assert.equal(service.documents.size,0);
});
test('formatting returns code without executing it or changing string contents',async t=>{
  const service=new PythonLanguageService({root:path.resolve(__dirname,'../..')});t.after(()=>service.close());
  const code='name="中文"\nitems=[1,2,3]\n';
  const formatted=await service.format(code);
  assert.ok(formatted.includes('items = [1, 2, 3]'));
  assert.ok(formatted.includes('中文'));
  assert.equal(await service.format(formatted),formatted);
  await assert.rejects(service.format('def broken('));
});

test('generated low-code helper calls have the same parameters as the runtime',async t=>{
  const notices=[],service=new PythonLanguageService({onDiagnostics:event=>notices.push(event)});t.after(()=>service.close());
  await service.sync({id:'generated',version:1,code:'run_script("print(1)", timeout=5, step_name="示例")\n'});
  const deadline=Date.now()+10000;
  while(Date.now()<deadline&&!notices.some(n=>n.id==='generated'&&n.version===1))await new Promise(resolve=>setTimeout(resolve,50));
  const notice=notices.find(n=>n.id==='generated'&&n.version===1);assert.ok(notice,'generated preview receives diagnostics');
  assert.deepEqual(notice.diagnostics.filter(d=>d.severity===1),[]);
});
