const {test}=require('node:test');
const assert=require('node:assert/strict');
const {projectSchema,selectorSchema}=require('../mcp-server.cjs');
const {resolvePython}=require('../python-runtime.cjs');

test('OCR selectors need text while template selectors need at least one image',()=>{
  assert.equal(selectorSchema.parse({name:'文字',kind:'image',recognition:'ocr',text:'完成任务'}).image,'');
  assert.throws(()=>selectorSchema.parse({name:'文字',kind:'image',recognition:'ocr'}));
  assert.throws(()=>selectorSchema.parse({name:'图片',kind:'image'}));
  const parsed=selectorSchema.parse({name:'悬停',kind:'image',templates:[{image:'assets/hover.png',mask:'assets/mask.png'}],color_tolerance:30});
  assert.equal(parsed.templates[0].mask,'assets/mask.png');
  assert.equal(parsed.color_tolerance,30);
  assert.throws(()=>selectorSchema.parse({name:'越界',kind:'image',image:'assets/a.png',templates:[{image:'../outside.png'}]}));
  assert.throws(()=>selectorSchema.parse({name:'越界',kind:'image',image:'assets/a.png',mask:'../outside.png'}));
});

test('relative ROI needs a valid visual anchor and rejects cycles',()=>{
  const a={name:'标题',kind:'image',image:'assets/title.png'};
  const b={name:'按钮',kind:'image',image:'assets/button.png',anchor:'标题',roi:[-10,20,100,50]};
  assert.equal(projectSchema.parse({selectors:[a,b]}).selectors[1].roi[0],-10);
  assert.throws(()=>projectSchema.parse({selectors:[b]}));
  assert.throws(()=>projectSchema.parse({selectors:[{...a,anchor:'按钮',roi:[0,0,10,10]},b]}));
  assert.throws(()=>projectSchema.parse({selectors:[{name:'标题'},b]}));
  assert.throws(()=>selectorSchema.parse({...b,anchor:''}));
});

test('desktop and installer prefer a supported 64-bit interpreter and honor overrides',()=>{
  assert.equal(resolvePython({NYCS_PYTHON:'custom-python'},()=>false),'custom-python');
  const selected=resolvePython({LOCALAPPDATA:'C:/Local'},name=>name.includes('Python311'));
  assert.ok(selected.includes('Python311'));
  assert.equal(resolvePython({LOCALAPPDATA:'C:/Local'},name=>name.includes('Python313-32')),'python');
});

test('project-local Python takes precedence over system installations and relocates with the project',()=>{
  const path=require('node:path');
  const root=path.resolve('portable-copy');
  const bundled=path.join(root,'runtime','python','python.exe');
  assert.equal(resolvePython({LOCALAPPDATA:'C:/Local'},file=>file===bundled||file.includes('Python311'),root),bundled);
  assert.equal(resolvePython({NYCS_PYTHON:'custom-python'},()=>true,root),'custom-python');
});

test('shared control IDs survive project validation and malformed references are rejected',()=>{
  const id='a'.repeat(32);
  assert.equal(projectSchema.parse({selectors:[{name:'共享',library_id:id}],steps:[{action:'click',target:'共享'}]}).selectors[0].library_id,id);
  assert.throws(()=>selectorSchema.parse({name:'共享',library_id:'../bad'}));
});
