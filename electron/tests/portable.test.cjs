const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {connectionInfo}=require('../../scripts/mcp-connect-info.cjs');

test('MCP instructions use the bundled Node path when the project is moved',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nycs portable '));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'runtime','node'),{recursive:true});
  const exe=path.join(root,'runtime','node','node.exe');
  fs.writeFileSync(exe,'fixture');
  const text=connectionInfo(root);
  assert.ok(text.includes(exe));
  assert.ok(text.includes(path.join(root,'scripts','mcp-proxy.cjs')));
  assert.ok(!text.includes('command = "node"'));
});
