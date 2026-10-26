// Passive, opt-in real-device video verification. Never sends input events.
const {app,BrowserWindow,ipcMain,protocol}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {ROOT,artifactFile}=require('../paths.cjs');
const {AndroidStream}=require('../android-stream.cjs');
const serial=process.argv.find(value=>value.startsWith('--serial='))?.slice(9);
if(!serial)throw new Error('Pass the explicitly authorized device with --serial=SERIAL');
app.setPath('userData',path.join(app.getPath('temp'),'echo-android-video-probe-'+process.pid));
protocol.registerSchemesAsPrivileged([{scheme:'echo-video-test',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
let window,stream;
app.whenReady().then(async()=>{
  const adb=path.join(ROOT,'runtime/android/platform-tools/adb.exe');
  const result={passed:false,packets:0,errors:[]};
  try{
    protocol.handle('echo-video-test',()=>new Response('<!doctype html><canvas id="android-stream-screen"></canvas><img id="android-screen" hidden><span id="android-frame-placeholder"></span><span id="android-video-status"></span><span id="android-resolution"></span>',{headers:{'content-type':'text/html'}}));
    window=new BrowserWindow({show:false,width:700,height:900,webPreferences:{preload:path.join(ROOT,'electron/preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
    stream=new AndroidStream({root:ROOT,onPacket:packet=>{result.packets++;window.webContents.send('studio:event',{kind:'android_video',...packet});},onState:state=>{if(state.status==='error')result.errors.push(state.message);window.webContents.send('studio:event',{kind:'android_video_state',...state});}});
    ipcMain.handle('studio:call',async(event,method,args)=>{
      if(!window||window.isDestroyed())return {};
      if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)throw new Error('Invalid probe sender');
      if(method==='android_stream_start'){if(args.target?.serial!==serial)throw new Error('Wrong device');return stream.start({serial,adb_path:adb,request_id:args.request_id});}
      if(method==='android_stream_ack'){stream.ack(args.id,args.sequence);return {};}
      if(method==='android_stream_stop'){if(!args.request_id||stream.session?.request_id===args.request_id)await stream.stop(args.id);return {};}
      if(method==='android_control'&&args.event==='geometry')return stream.control(args);
      throw new Error('Probe blocks non-video operation: '+method);
    });
    await window.loadURL('echo-video-test://screen/');
    await window.webContents.executeJavaScript(`const S={view:'android',modal:null,mcpOperation:'',android:{connection:{serial:${JSON.stringify(serial)}},frame:null,videoFailed:false}};const api=(method,args)=>window.studio.call(method,args);function targetArgs(){return {target:{platform:'android',serial:S.android.connection.serial}};}`);
    await window.webContents.executeJavaScript(fs.readFileSync(path.join(ROOT,'electron/renderer/android-video.js'),'utf8'));
    await window.webContents.executeJavaScript("window.studio.onEvent(event=>AndroidVideo.handle(event));window.__studioReady=true;syncAndroidPreview();");
    for(let i=0;i<60;i++){
      await new Promise(resolve=>setTimeout(resolve,250));
      const state=await window.webContents.executeJavaScript('({decoded:AndroidVideo.decodedTotal,controlReady:AndroidVideo.usable(),firstDecodedMs:AndroidVideo.firstFrameMs,failed:S.android.videoFailed,error:S.android.videoMessage,secure:isSecureContext,codec:!!window.VideoDecoder,width:AndroidVideo.backing?.width,height:AndroidVideo.backing?.height})');
      Object.assign(result,state);
      if(state.failed)throw new Error(state.error);
      if(state.decoded>=5&&state.controlReady){result.passed=true;break;}
    }
    if(!result.passed)throw new Error('No decoded Android video frames');
    await window.webContents.executeJavaScript('AndroidVideo.stop(true)');
  }catch(error){result.errors.push(error.stack);}
  finally{
    await stream?.stop();
    fs.writeFileSync(artifactFile('smoke','android-live-video.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result));window?.destroy();app.exit(result.passed?0:1);
  }
}).catch(error=>{console.error(error);app.exit(1);});
