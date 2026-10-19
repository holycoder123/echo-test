const test=require('node:test');
const assert=require('node:assert/strict');
const {ensureAdministrator,quoteWindowsArgument,loadNativeApi,ElevationError}=require('../elevation.cjs');
function fixture({admin=false,status=42,lastError=0}={}){
  const events=[],launches=[];
  const native={isAdmin:()=>{events.push('check');return admin;},launch:(...args)=>{events.push('launch');launches.push(args);return status;},lastError:()=>lastError};
  const options={platform:'win32',env:{},native,executable:'C:\\工作台\\electron.exe',cwd:'C:\\工作台\\New project',argv:['C:\\工作台\\New project','--case','C:\\用例\\example test.nycs.json','--disable-mcp'],releaseLock:()=>events.push('release')};
  return {options,events,launches};
}
test('default desktop startup requests UAC once and releases the lock before relaunch',()=>{
  const f=fixture();assert.equal(ensureAdministrator(f.options),'relaunched');
  assert.deepEqual(f.events,['check','release','launch']);
  assert.deepEqual(f.launches[0],[null,'runas',f.options.executable,f.options.argv.map(quoteWindowsArgument).join(' '),f.options.cwd,1]);
});
test('an already elevated desktop starts directly without another permission request',()=>{
  const f=fixture({admin:true});assert.equal(ensureAdministrator(f.options),'continue');
  assert.deepEqual(f.events,['check']);assert.equal(f.launches.length,0);
});
test('cancelled UAC stops startup and does not retry with ordinary permissions',()=>{
  const f=fixture({status:5,lastError:1223});
  assert.throws(()=>ensureAdministrator(f.options),error=>error instanceof ElevationError&&error.cancelled&&error.message.includes('未启动'));
  assert.equal(f.launches.length,1);
});
test('system elevation failure returns its status without a fallback launch',()=>{
  const f=fixture({status:2});assert.throws(()=>ensureAdministrator(f.options),error=>error instanceof ElevationError&&error.status===2&&!error.cancelled);
  assert.equal(f.launches.length,1);
});
test('explicit ordinary startup and isolated UI smoke never request UAC',()=>{
  const f=fixture();assert.equal(ensureAdministrator({...f.options,argv:['.','--no-admin']}),'continue');
  assert.equal(ensureAdministrator({...f.options,env:{NYCS_SMOKE_TEST:'1'}}),'continue');
  assert.equal(ensureAdministrator({...f.options,platform:'linux'}),'continue');assert.deepEqual(f.events,[]);
});
test('Windows arguments preserve spaces, quotes, empty values and trailing backslashes',()=>{
  assert.equal(quoteWindowsArgument('plain'),'plain');assert.equal(quoteWindowsArgument(''),'""');
  assert.equal(quoteWindowsArgument('hello world'),'"hello world"');
  assert.equal(quoteWindowsArgument('x"y'),'"x\\"y"');
  assert.equal(quoteWindowsArgument('C:\\New project\\'),'"C:\\New project\\\\"');
  assert.equal(quoteWindowsArgument('case&$name'),'case&$name');
});
test('the installed Win32 adapter loads and queries its token without requesting UAC',{skip:process.platform!=='win32'},()=>{
  const native=loadNativeApi();assert.equal(typeof native.launch,'function');assert.ok([0,1].includes(native.isAdmin()));
});