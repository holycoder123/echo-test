const path=require('node:path');
class FloatingToolbar {
  constructor({BrowserWindow,screen,ipcMain,onAction,onError}){
    Object.assign(this,{BrowserWindow,screen,onAction,onError});this.window=null;this.state=null;
    ipcMain.handle('floating:action',async(event,action)=>{
      const win=this.window;
      if(!win||win.isDestroyed()||event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||event.senderFrame.url!=='echo-test://studio/floating.html')throw new Error('悬浮窗请求无效');
      if(!['record','stop','screenshot','workbench'].includes(action))throw new Error('不支持的悬浮窗操作');
      return this.onAction(action);
    });
  }
  update(state){
    this.state=state;
    if(!state.connection){this.window?.destroy();this.window=null;return;}
    if(!this.window){
      const area=this.screen.getDisplayNearestPoint(this.screen.getCursorScreenPoint()).workArea;
      const win=this.window=new this.BrowserWindow({width:340,height:112,x:Math.max(area.x,area.x+area.width-360),y:area.y+60,
        frame:false,resizable:false,maximizable:false,minimizable:false,alwaysOnTop:true,skipTaskbar:true,focusable:false,show:false,
        backgroundColor:'#ffffff',webPreferences:{preload:path.join(__dirname,'floating-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
      win.setContentProtection(true);
      win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      win.webContents.on('will-navigate',event=>event.preventDefault());
      win.webContents.on('did-fail-load',(_event,code,message)=>{if(code!==-3)this.onError?.(new Error(message));});
      win.webContents.once('did-finish-load',()=>{if(this.window===win&&!win.isDestroyed()){win.webContents.send('floating:state',this.state);win.showInactive();}});
      win.on('closed',()=>{if(this.window===win)this.window=null;});
      win.loadURL('echo-test://studio/floating.html');
    }else this.window.webContents.send('floating:state',state);
  }
  feedback(message){if(this.window&&!this.window.isDestroyed())this.window.webContents.send('floating:feedback',String(message).slice(0,300));}
}
module.exports={FloatingToolbar};
