const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('studio', {
  call: async (method, args) => {
    try {return await ipcRenderer.invoke('studio:call', method, args);}
    catch (error) {throw new Error(error.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, ''));}
  },
  onEvent: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('studio:event', listener);
    return () => ipcRenderer.removeListener('studio:event', listener);
  }
});
