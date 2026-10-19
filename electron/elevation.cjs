// Request Windows UAC before creating windows or starting the backend.
let nativeApi;
function loadNativeApi(){
  if(!nativeApi){
    const koffi=require('koffi');
    const shell32=koffi.load('shell32.dll'),kernel32=koffi.load('kernel32.dll');
    nativeApi={
      libraries:[shell32,kernel32],
      isAdmin:shell32.func('int __stdcall IsUserAnAdmin()'),
      launch:shell32.func('intptr_t __stdcall ShellExecuteW(void *hwnd, str16 operation, str16 file, str16 parameters, str16 directory, int show)'),
      lastError:kernel32.func('uint32_t __stdcall GetLastError()'),
    };
  }
  return nativeApi;
}
function quoteWindowsArgument(value){
  value=String(value);
  if(value&&!/[\s"]/.test(value))return value;
  return '"'+value.replace(/(\\*)"/g,'$1$1\\"').replace(/(\\+)$/,'$1$1')+'"';
}
class ElevationError extends Error{
  constructor(status,cancelled){
    super(cancelled?'已取消管理员权限确认，工作台未启动。':`无法以管理员权限启动工作台（系统返回 ${status}）。请确认 Windows 权限提示后重试。`);
    this.name='ElevationError';this.status=status;this.cancelled=cancelled;
  }
}
function ensureAdministrator({executable,argv=[],cwd,releaseLock=()=>{},platform=process.platform,env=process.env,native}={}){
  if(platform!=='win32'||env.ECHO_TEST_SMOKE_TEST==='1'||argv.includes('--no-admin'))return 'continue';
  const api=native||loadNativeApi();
  if(api.isAdmin())return 'continue';
  // The elevated replacement must be able to acquire the same instance lock.
  releaseLock();
  const result=Number(api.launch(null,'runas',executable,argv.map(quoteWindowsArgument).join(' '),cwd,1));
  if(!Number.isFinite(result)||result<=32)throw new ElevationError(result,api.lastError?.()===1223);
  return 'relaunched';
}
module.exports={ensureAdministrator,quoteWindowsArgument,loadNativeApi,ElevationError};