'use strict';

function avcCodec(data){
  for(let i=0;i+6<data.length;i++){
    let prefix=0;
    if(data[i]===0&&data[i+1]===0&&data[i+2]===1)prefix=3;
    else if(data[i]===0&&data[i+1]===0&&data[i+2]===0&&data[i+3]===1)prefix=4;
    if(prefix&&(data[i+prefix]&31)===7)return 'avc1.'+[...data.slice(i+prefix+1,i+prefix+4)].map(value=>value.toString(16).padStart(2,'0')).join('');
  }
  throw new Error('视频配置中缺少 H.264 SPS');
}

const AndroidVideo={
  token:'',id:null,serial:null,starting:false,decoder:null,config:null,needKey:true,hasFrame:false,
  backing:null,frames:0,decodedTotal:0,at:0,fps:0,maxFps:30,
  controlReady:false,geometryReady:false,geometry:null,geometryKey:'',epoch:0,firstFrameMs:null,
  wanted(){const a=S.android;return S.view==='android'&&a.connection&&!S.modal&&!document.hidden&&!S.mcpOperation;},
  usable(){return !!(this.token&&this.id&&this.controlReady&&this.geometryReady&&this.hasFrame&&!S.android.videoFailed);},
  control(event,extra={}){
    if(event!=='cancel'&&!this.usable())return Promise.reject(new Error('实时控制正在准备，请稍候'));
    return api('android_control',{...targetArgs(),id:this.id,request_id:this.token,event,size:this.geometry,epoch:this.epoch,...extra});
  },
  async start(){
    if(this.starting||this.token||!this.wanted()||S.android.videoFailed)return;
    const a=S.android,token=crypto.randomUUID();this.token=token;this.serial=a.connection.serial;this.starting=true;this.id=null;this.controlReady=false;this.geometryReady=false;
    a.videoStatus='starting';a.videoMessage='';this.frames=0;this.decodedTotal=0;this.at=performance.now();this.startedAt=this.at;this.firstFrameMs=null;this.fps=0;this.update();
    try{
      if(typeof VideoDecoder==='undefined')throw new Error('当前运行环境不支持视频解码');
      const result=await api('android_stream_start',{...targetArgs(),request_id:token});
      if(this.token===token)this.id=result.id;
    }catch(error){if(this.token===token)this.fail(error.message);}
    finally{if(this.token===token)this.starting=false;}
  },
  stop(clear=false){
    if(typeof cancelAndroidGesture==='function')cancelAndroidGesture();
    const token=this.token,id=this.id;this.token='';this.id=null;this.serial=null;this.starting=false;
    this.controlReady=false;this.geometryReady=false;this.geometry=null;this.geometryKey='';
    if(this.decoder&&this.decoder.state!=='closed')this.decoder.close();this.decoder=null;this.config=null;this.needKey=true;
    if(clear){this.hasFrame=false;this.backing=null;}
    if(token)api('android_stream_stop',{id,request_id:token}).catch(()=>{});
  },
  fail(message){
    this.stop();const a=S.android;a.videoFailed=true;a.videoStatus='error';a.videoMessage=String(message).slice(-500);this.hasFrame=false;this.update();
  },
  handle(event){
    if(!this.token||event.request_id!==this.token||event.serial!==S.android.connection?.serial)return;
    this.id||=event.id;
    if(event.kind==='android_video_state'){
      if(event.max_fps)this.maxFps=event.max_fps;
      if(event.status==='error')this.fail(event.message||'视频连接已断开');
      if(event.status==='control_ready')this.controlReady=true;
      if(event.status==='touch_released'&&S.android.pointer?.id===event.gesture_id&&typeof cancelAndroidGesture==='function')cancelAndroidGesture(false);
      return;
    }
    const token=this.token;
    try{
      const data=new Uint8Array(event.data);
      if(event.config){
        if(typeof cancelAndroidGesture==='function')cancelAndroidGesture();
        this.geometryReady=false;const epoch=++this.epoch;
        if(this.decoder&&this.decoder.state!=='closed')this.decoder.close();this.config=data;this.needKey=true;
        this.decoder=new VideoDecoder({output:frame=>{
          try{
            if(this.token!==token||this.epoch!==epoch)return;
            const a=S.android,width=frame.displayWidth,height=frame.displayHeight;
            this.backing||=document.createElement('canvas');
            if(this.backing.width!==width||this.backing.height!==height){this.backing.width=width;this.backing.height=height;}
            this.backing.getContext('2d',{alpha:false}).drawImage(frame,0,0,width,height);
            if(!a.frame){const c=a.connection;a.frame={width:c.width||width,height:c.height||height,image:''};}
            if((width>height)!==(a.frame.width>a.frame.height)){[a.frame.width,a.frame.height]=[a.frame.height,a.frame.width];a.pointer=null;}
            if(!this.geometryReady&&this.geometryKey!==`${epoch}:${width},${height}`){
              this.geometryKey=`${epoch}:${width},${height}`;
              api('android_control',{...targetArgs(),id:this.id,request_id:token,event:'geometry',size:[width,height],epoch}).then(()=>{
                if(this.token===token&&this.epoch===epoch){this.geometry=[width,height];this.geometryReady=true;this.update();}
              }).catch(error=>{if(this.token===token)this.fail(error.message);});
            }
            this.hasFrame=true;a.videoStatus='streaming';this.frames++;this.decodedTotal++;
            if(this.firstFrameMs===null)this.firstFrameMs=Math.round(performance.now()-this.startedAt);
            const now=performance.now();if(now-this.at>=1000){this.fps=Math.round(this.frames*1000/(now-this.at));this.frames=0;this.at=now;}
            this.paint();this.update();
          }finally{frame.close();}
        },error:error=>{if(this.token===token)this.fail(error.message);}});
        this.decoder.configure({codec:avcCodec(data),optimizeForLatency:true});return;
      }
      if(!this.decoder)return;
      if(this.decoder.decodeQueueSize>4){this.needKey=true;return;}
      if(this.needKey&&!event.keyframe)return;
      this.needKey=false;
      let bytes=data;
      if(event.keyframe&&this.config){bytes=new Uint8Array(this.config.length+data.length);bytes.set(this.config);bytes.set(data,this.config.length);}
      this.decoder.decode(new EncodedVideoChunk({type:event.keyframe?'key':'delta',timestamp:event.timestamp,data:bytes}));
    }catch(error){this.fail(error.message);}
    finally{if(event.sequence)api('android_stream_ack',{id:event.id,sequence:event.sequence}).catch(()=>{});}
  },
  paint(){
    const canvas=document.querySelector('#android-stream-screen');if(!canvas||!this.backing||!this.hasFrame)return;
    if(canvas.width!==this.backing.width||canvas.height!==this.backing.height){canvas.width=this.backing.width;canvas.height=this.backing.height;}
    canvas.getContext('2d',{alpha:false}).drawImage(this.backing,0,0);canvas.hidden=false;
  },
  update(){
    if(typeof updateAndroidInteraction==='function')updateAndroidInteraction();
    const a=S.android,show=this.hasFrame&&!a.videoFailed;
    const canvas=document.querySelector('#android-stream-screen'),label=document.querySelector('#android-video-status');
    if(canvas)canvas.hidden=!show;
    if(label)label.textContent=a.videoFailed?'视频连接失败：'+a.videoMessage+'；请点击「重连画面」重试。':a.videoStatus==='streaming'?`实时视频 · ${this.fps||'—'} FPS（上限 ${this.maxFps}） · ${this.usable()?'实时触控':'控制连接中…'}`:'正在连接视频流…';
    const placeholder=document.querySelector('#android-frame-placeholder');if(placeholder){placeholder.hidden=show;placeholder.textContent=a.videoFailed?'视频画面不可用，请重连画面':'正在获取手机画面…';}
    const resolution=document.querySelector('#android-resolution');if(resolution&&a.frame)resolution.textContent=`${a.frame.width} × ${a.frame.height}`;
  },
};
function syncAndroidPreview(){
  const a=S.android;
  if(AndroidVideo.token&&(!AndroidVideo.wanted()||AndroidVideo.serial!==a.connection?.serial))AndroidVideo.stop(!a.connection||AndroidVideo.serial!==a.connection?.serial);
  if(AndroidVideo.wanted()&&!a.videoFailed&&!AndroidVideo.token)AndroidVideo.start();
  AndroidVideo.paint();AndroidVideo.update();
}
document.addEventListener('visibilitychange',()=>{if(window.__studioReady)syncAndroidPreview();});
setInterval(()=>{if(window.__studioReady)syncAndroidPreview();},500);
