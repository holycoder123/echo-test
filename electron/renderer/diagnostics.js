'use strict';
// IPC failures have already been audited in the main process.
const recentlyReported=new Map();
window.reportStudioError=(error,action='')=>{
  const key=String(error?.message||error),now=Date.now();if(now-(recentlyReported.get(key)||0)<2000)return Promise.resolve();if(recentlyReported.size>100)recentlyReported.clear();recentlyReported.set(key,now);
  if(String(error?.message||error).includes('[日志 #'))return Promise.resolve();
  return window.studio.call('renderer_error',{message:String(error?.message||error),stack:error?.stack||'',action}).catch(()=>{});
};
window.addEventListener('error',event=>window.reportStudioError(event.error||event.message,'window.error'));
window.addEventListener('unhandledrejection',event=>window.reportStudioError(event.reason,'unhandledrejection'));
