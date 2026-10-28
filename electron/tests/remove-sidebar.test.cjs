const test=require('node:test'),assert=require('node:assert/strict');
const {validateSettings}=require('../settings.cjs');
const {authorize}=require('../window-access.cjs');
test('legacy toolbar preferences migrate without restoring retired settings',()=>{
  const settings=validateSettings({target:{autoToolbar:true,linkToolbar:true,filter:'example'}});
  assert.equal(settings.target.filter,'example');
  assert.equal(Object.hasOwn(settings.target,'autoToolbar'),false);
  assert.equal(Object.hasOwn(settings.target,'linkToolbar'),false);
});
test('retired toolbar IPC cannot be called from the workbench',()=>{
  const frame={url:'echo-test://studio/index.html'},main={isDestroyed:()=>false,webContents:{mainFrame:frame}},event={sender:null,senderFrame:frame};event.sender=main.webContents;
  for(const method of ['game_open','game_bundle','game_action','sidebar_publish','sidebar_reply','sidebar_flush'])assert.throws(()=>authorize(event,main,null,method,{}),/不允许/);
});
