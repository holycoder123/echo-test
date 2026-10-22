const test=require('node:test');
const assert=require('node:assert/strict');
const {authorize}=require('../window-access.cjs');
function surface(page){const frame={url:`echo-test://studio/${page}`};return {isDestroyed:()=>false,webContents:{mainFrame:frame}};}
function event(win){return {sender:win.webContents,senderFrame:win.webContents.mainFrame};}
test('only workbench can generate or copy Python cases and change draft context',()=>{
  const main=surface('index.html'),game=surface('game.html');
  for(const method of ['generate_python','python_copy','case_context']){
    assert.equal(authorize(event(main),main,game,method,{}),'main');
    assert.throws(()=>authorize(event(game),main,game,method,{}));
  }
});
test('window connections are limited to the workbench and removed embedding methods are rejected',()=>{
  const main=surface('index.html'),game=surface('game.html');
  assert.equal(authorize(event(main),main,game,'game_connect',{}),'main');
  assert.throws(()=>authorize(event(game),main,game,'game_connect',{}));
  for(const method of ['game_mode','embed_attach','embed_detach','embed_focus','embed_layout','embed_present','embed_visibility','embed_sync','embed_frame']){
    assert.throws(()=>authorize(event(main),main,game,method,{}));
    assert.throws(()=>authorize(event(game),main,game,method,{}));
  }
});
test('application window can record and stop, but cannot replace or save the project',()=>{
  const main=surface('index.html'),game=surface('game.html');
  for(const method of ['case_list','record_start','stop','workbench_show','game_action','game_bundle'])assert.equal(authorize(event(game),main,game,method,{}),'game');
  for(const method of ['save_project','new_project','run','capture','record_reviewed','toolbar_pair_attach','toolbar_pair_detach','script_import'])assert.throws(()=>authorize(event(game),main,game,method,{}));
  assert.equal(authorize(event(main),main,game,'script_import',{}),'main');
  for(const method of ['control_list','control_save','control_delete','control_import','control_category_save','control_category_delete']){assert.equal(authorize(event(main),main,game,method,{}),'main');assert.throws(()=>authorize(event(game),main,game,method,{}));}
});
test('subframes, foreign pages and destroyed windows cannot call studio',()=>{
  const main=surface('index.html'),game=surface('game.html');
  assert.throws(()=>authorize({...event(game),senderFrame:{url:'echo-test://studio/game.html'}},main,game,'stop',{}));
  game.webContents.mainFrame.url='https://example.com/game.html';
  assert.throws(()=>authorize(event(game),main,game,'stop',{}));
  main.isDestroyed=()=>true;
  assert.throws(()=>authorize(event(main),main,game,'bootstrap',{}));
});

test('only the main workbench can delete logs and execution reports',()=>{
 const main=surface('index.html'),game=surface('game.html');
 for(const method of ['audit_delete','reports_delete']){
  assert.equal(authorize(event(main),main,game,method,{ids:['example']}),'main');
  assert.throws(()=>authorize(event(game),main,game,method,{ids:['example']}));
 }
});


test('only the workbench can start or cancel native window selection',()=>{
 const main=surface('index.html'),game=surface('game.html');
 for(const method of ['window_pick_start','window_pick_cancel']){
   assert.equal(authorize(event(main),main,game,method,{}),'main');
   assert.throws(()=>authorize(event(game),main,game,method,{}));
 }
});

test('only the workbench can manage settings and reset MCP or clean history',()=>{
 const main=surface('index.html'),game=surface('game.html');
 for(const method of ['settings_get','settings_save','settings_shortcut_capture','settings_mcp_copy','settings_mcp_reset','settings_import','settings_export','settings_cleanup_preview','settings_cleanup_delete']){
  assert.equal(authorize(event(main),main,game,method,{}),'main');
  assert.throws(()=>authorize(event(game),main,game,method,{}));
 }
});
