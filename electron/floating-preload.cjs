const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('floating',{
  action:action=>ipcRenderer.invoke('floating:action',action),
  onState:callback=>ipcRenderer.on('floating:state',(_event,state)=>callback(state)),
  onFeedback:callback=>ipcRenderer.on('floating:feedback',(_event,message)=>callback(message))
});
