// Pinned scrcpy video protocol. Only the explicitly selected device is exposed.
const fs=require('node:fs');
const path=require('node:path');
const net=require('node:net');
const {randomBytes,createHash}=require('node:crypto');
const {execFile,spawn}=require('node:child_process');
const VERSION='3.3.4';
const SERVER_SHA256='8588238c9a5a00aa542906b6ec7e6d5541d9ffb9b5d0f6e1bc0e365e2303079e';
const MAX_PACKET=4*1024*1024;
const KEYS={BACK:4,HOME:3,APP_SWITCH:187,ENTER:66,TAB:61,SPACE:62,BACKSPACE:67};
function touchPacket(action,point,size){
  const bytes=Buffer.alloc(32);bytes[0]=2;bytes[1]=action;bytes.writeBigInt64BE(-2n,2);
  bytes.writeUInt32BE(point[0],10);bytes.writeUInt32BE(point[1],14);bytes.writeUInt16BE(size[0],18);bytes.writeUInt16BE(size[1],20);
  bytes.writeUInt16BE(action===1?0:0xffff,22);return bytes;
}
function keyPacket(action,code){const bytes=Buffer.alloc(14);bytes[1]=action;bytes.writeUInt32BE(code,2);return bytes;}
// CANCEL prevents a click on blur/Esc; UP also clears scrcpy's internal pointer slot.
function releasePacket(touch){return Buffer.concat([touchPacket(3,touch.point,touch.size),touchPacket(1,touch.point,touch.size)]);}

class VideoPackets{
  constructor(onHeader,onPacket){this.onHeader=onHeader;this.onPacket=onPacket;this.buffer=Buffer.alloc(0);this.header=false;}
  feed(data){
    if(data.length+this.buffer.length>MAX_PACKET*3)throw new Error('安卓视频缓冲超出限制');
    this.buffer=Buffer.concat([this.buffer,data]);
    if(!this.header){
      if(this.buffer.length<13)return;
      if(this.buffer[0]!==0||this.buffer.readUInt32BE(1)!==0x68323634)throw new Error('不支持的安卓视频协议');
      const width=this.buffer.readUInt32BE(5),height=this.buffer.readUInt32BE(9);
      if(!width||!height||width>8192||height>8192)throw new Error('无效的安卓视频尺寸');
      this.header=true;this.buffer=this.buffer.subarray(13);this.onHeader({width,height});
    }
    while(this.buffer.length>=12){
      const flags=this.buffer.readBigUInt64BE(0),length=this.buffer.readUInt32BE(8);
      if(!length||length>MAX_PACKET)throw new Error('安卓视频帧超出限制');
      if(this.buffer.length<12+length)return;
      const timestamp=Number(flags&((1n<<62n)-1n));
      if(!Number.isSafeInteger(timestamp))throw new Error('无效的安卓视频时间戳');
      const data=Buffer.from(this.buffer.subarray(12,12+length));this.buffer=this.buffer.subarray(12+length);
      this.onPacket({timestamp,config:!!(flags&(1n<<63n)),keyframe:!!(flags&(1n<<62n)),data});
    }
  }
}

class AndroidStream{
  constructor({root,onPacket=()=>{},onState=()=>{},onAction=()=>{},execute=execFile,launch=spawn,connect=net.createConnection,validateServer=null}){
    Object.assign(this,{root,onPacket,onState,onAction,execute,launch,connect,validateServer});this.session=null;this.sequence=0;this.generation=0;
  }
  command(session,args,signal=true){return new Promise((resolve,reject)=>{
    this.execute(session.adb,['-s',session.serial,...args],{windowsHide:true,timeout:12000,maxBuffer:1024*1024,...(signal?{signal:session.abort.signal}:{})},(error,stdout,stderr)=>error?reject(new Error(String(stderr||error.message).slice(-1500))):resolve(String(stdout).trim()));
  });}
  state(s,status,extra={}){this.onState({id:s.id,request_id:s.request_id,serial:s.serial,status,max_fps:s.max_fps,...extra});}
  async start({serial,adb_path,request_id,max_fps=30,max_size=1280,bit_rate=4000000}){
    if(!/^[A-Za-z0-9\[][A-Za-z0-9_.:\[\]-]{0,199}$/.test(serial)||!/^[A-Za-z0-9-]{8,80}$/.test(request_id))throw new Error('无效的安卓视频目标');
    if(![15,30,60].includes(max_fps)||![720,1080,1280,1920].includes(max_size)||![2000000,4000000,8000000,12000000].includes(bit_rate))throw new Error('无效的安卓视频环境参数');
    if(this.session?.serial===serial&&this.session.request_id===request_id)return {id:this.session.id};
    const generation=++this.generation;await this.stop(undefined,true);
    if(generation!==this.generation)throw new Error('视频预览已取消');
    const server=path.join(this.root,'runtime','android','scrcpy','scrcpy-server.jar');
    if(this.validateServer)this.validateServer(server);
    else if(!fs.existsSync(server)||createHash('sha256').update(fs.readFileSync(server)).digest('hex')!==SERVER_SHA256)throw new Error('内置视频组件缺失或损坏，请重新安装完整 EchoTest');
    const id=(randomBytes(4).readUInt32BE()&0x7fffffff).toString(16).padStart(8,'0');
    const s={id,serial,adb:adb_path,request_id,max_fps,abort:new AbortController(),pending:new Set(),needsKey:true,logs:'',port:null,remote:`/data/local/tmp/echotest-scrcpy-${id}.jar`};
    this.session=s;this.state(s,'starting');
    const live=()=>{if(this.session!==s||s.abort.signal.aborted)throw new Error('视频预览已取消');};
    try{
      await this.command(s,['push',server,s.remote]);live();
      const port=await this.command(s,['forward','tcp:0',`localabstract:scrcpy_${id}`]);
      if(!/^\d+$/.test(port)||Number(port)<1||Number(port)>65535)throw new Error('无法创建安卓视频连接');
      s.port=Number(port);live();
      s.child=this.launch(s.adb,['-s',serial,'shell',`CLASSPATH=${s.remote}`,'app_process','/','com.genymobile.scrcpy.Server',VERSION,
        `scid=${id}`,'log_level=warn','audio=false','control=true','clipboard_autosync=false','power_on=false','tunnel_forward=true','send_device_meta=false','send_codec_meta=true',
        'send_frame_meta=true','send_dummy_byte=true','video_codec=h264',`max_size=${max_size}`,`max_fps=${max_fps}`,`video_bit_rate=${bit_rate}`,'video_codec_options=i-frame-interval=1'],
        {windowsHide:true,stdio:['ignore','pipe','pipe']});
      const log=data=>{s.logs=(s.logs+data.toString()).slice(-3000);};
      s.child.stdout.on('data',log);s.child.stderr.on('data',log);
      s.child.on('error',error=>this.fail(s,error));
      s.child.on('exit',()=>{if(this.session===s)this.fail(s,new Error(s.logs||'手机视频服务已退出'));});
      s.deadline=Date.now()+12000;s.timer=setTimeout(()=>this.fail(s,new Error('视频连接超时，请检查手机调试授权')),12000);
      this.attach(s);
      return {id:s.id};
    }catch(error){if(this.session===s)await this.stop();throw error;}
  }
  attach(s){
    if(this.session!==s)return;
    const parser=new VideoPackets(size=>{if(this.session!==s)return;s.ready=true;this.state(s,'streaming',size);},packet=>{
      if(this.session!==s)return;
      if(packet.config){s.needsKey=true;this.onPacket({id:s.id,request_id:s.request_id,serial:s.serial,...packet});return;}
      if(s.pending.size>=6){s.needsKey=true;return;}
      if(s.needsKey&&!packet.keyframe)return;
      s.needsKey=false;clearTimeout(s.timer);
      const sequence=++this.sequence;s.pending.add(sequence);
      this.onPacket({id:s.id,request_id:s.request_id,serial:s.serial,sequence,...packet});
    });
    const socket=this.connect({host:'127.0.0.1',port:s.port});s.socket=socket;socket.setNoDelay(true);
    // The server sends its dummy byte after accepting video, before accepting control.
    // Connecting control only after this byte preserves scrcpy's socket ordering.
    socket.on('data',data=>{try{if(!s.controlSocket&&data.length&&data[0]===0)this.attachControl(s);parser.feed(data);}catch(error){this.fail(s,error);}});
    socket.on('error',error=>{s.socketError=error.message;});
    socket.on('close',()=>{
      if(this.session!==s)return;
      if(!s.ready&&Date.now()<s.deadline){s.retry=setTimeout(()=>this.attach(s),100);}
      else this.fail(s,new Error(s.logs||s.socketError||'安卓视频连接已断开'));
    });
  }
  attachControl(s){
    if(this.session!==s)return;
    const socket=this.connect({host:'127.0.0.1',port:s.port});s.controlSocket=socket;socket.setNoDelay(true);
    socket.on('connect',()=>{if(this.session===s){s.controlReady=true;this.state(s,'control_ready');}});
    // Clipboard synchronization is disabled. Drain unexpected device messages without exposing them.
    socket.on('data',()=>{});
    socket.on('error',error=>this.fail(s,error));
    socket.on('close',()=>{if(this.session===s)this.fail(s,new Error('安卓控制连接已断开'));});
  }
  writeControl(s,bytes){
    if(!s.controlReady||!s.controlSocket||s.controlSocket.destroyed)throw new Error('实时控制尚未就绪');
    if(s.controlSocket.writableLength>65536){this.fail(s,new Error('安卓控制连接拥塞，请重新连接'));throw new Error('安卓控制连接拥塞');}
    s.controlSocket.write(bytes);
  }
  releaseTouch(){
    const s=this.session,t=s?.touch;if(!t)return;
    s.touch=null;s.releasePending=t;clearTimeout(s.touchTimer);
    if(s.controlReady&&!s.controlSocket.destroyed){try{this.writeControl(s,releasePacket(t));}catch(error){this.fail(s,error);}}
    this.state(s,'touch_released',{gesture_id:t.id});
  }
  control(args){
    const s=this.session;
    if(!s||args.id!==s.id||args.request_id!==s.request_id||args.target?.serial!==s.serial||args.target?.platform!=='android')throw new Error('安卓控制会话已变化');
    const event=args.event;
    if(event==='cancel'){if(!args.gesture_id||s.touch?.id===args.gesture_id)this.releaseTouch();return {};}
    const size=args.size;
    if(!Array.isArray(size)||size.length!==2||size.some(v=>!Number.isInteger(v)||v<1||v>8192))throw new Error('无效的实时画面尺寸');
    if(!Number.isSafeInteger(args.epoch)||args.epoch<1)throw new Error('无效的画面版本');
    if(event==='geometry'){
      if(s.epoch&&args.epoch<s.epoch)throw new Error('实时画面已变化');
      if(s.epoch!==args.epoch||String(s.size)!==String(size)){
        // Release using the new video dimensions: old dimensions may already be rejected by the server.
        s.touch||=s.releasePending;
        if(s.touch){s.touch.point=s.touch.point.map((v,i)=>Math.min(size[i]-1,Math.round(v/Math.max(1,s.touch.size[i]-1)*(size[i]-1))));s.touch.size=size;this.releaseTouch();}
        s.releasePending=null;
        s.size=[...size];s.epoch=args.epoch;
      }
      return {};
    }
    if(s.epoch!==args.epoch||String(s.size)!==String(size))throw new Error('实时画面方向或尺寸已变化');
    if(!s.controlReady)throw new Error('实时控制尚未就绪');
    if(['down','move','up'].includes(event)){
      const point=args.point;
      if(!Array.isArray(point)||point.length!==2||point.some((v,i)=>!Number.isInteger(v)||v<0||v>=size[i])||typeof args.gesture_id!=='string'||!/^[A-Za-z0-9-]{8,80}$/.test(args.gesture_id))throw new Error('无效的实时触控参数');
      if(event==='down'){
        if(s.touch)throw new Error('上一触控尚未结束');
        this.writeControl(s,touchPacket(0,point,size));
        s.releasePending=null;
        s.touch={id:args.gesture_id,point:[...point],start:[...point],size:[...size],started:Date.now(),moved:false};
        s.touchTimer=setTimeout(()=>this.releaseTouch(),10000);s.touchTimer.unref?.();
      }else{
        const t=s.touch;if(!t||t.id!==args.gesture_id)throw new Error('触控已经结束');
        this.writeControl(s,touchPacket(event==='up'?1:2,point,size));t.point=[...point];
        t.moved||=Math.hypot((point[0]-t.start[0])/size[0],(point[1]-t.start[1])/size[1])>.005;
        if(event==='up'){
          s.touch=null;clearTimeout(s.touchTimer);const ended=Date.now(),duration=Math.min(10,Math.max(.01,(ended-t.started)/1000));
          this.onAction({serial:s.serial,size:[...size],action:t.moved?'swipe':duration>=.5?'long_press':'tap',params:{point:t.start,...(t.moved?{end:[...point]}:{}),duration},started_at:t.started,ended_at:ended});
        }
      }
      return {sent:true};
    }
    if(s.touch)throw new Error('请先结束当前触控');
    const now=Date.now();let params;
    if(event==='key'){
      const code=KEYS[args.keys];if(code===undefined)throw new Error('不支持的安卓按键');
      this.writeControl(s,Buffer.concat([keyPacket(0,code),keyPacket(1,code)]));params={keys:args.keys};
    }else if(event==='text'){
      if(typeof args.text!=='string'||!args.text.length||args.text.length>4096||/[^\x20-\x7e]/.test(args.text))throw new Error('文本支持最多 4096 个 ASCII 可打印字符');
      const text=Buffer.from(args.text),packets=[];
      for(let offset=0;offset<text.length;offset+=300){const chunk=text.subarray(offset,offset+300),bytes=Buffer.alloc(5+chunk.length);bytes[0]=1;bytes.writeUInt32BE(chunk.length,1);chunk.copy(bytes,5);packets.push(bytes);}
      this.writeControl(s,Buffer.concat(packets));params={text:args.text};
    }else throw new Error('不支持的安卓实时操作');
    this.onAction({serial:s.serial,size:[...size],action:event,params,started_at:now,ended_at:now});return {sent:true};
  }
  ack(id,sequence){if(this.session?.id===id)this.session.pending.delete(sequence);}
  fail(s,error){if(this.session!==s)return;this.state(s,'error',{message:error.message});this.stop().catch(()=>{});}
  async stop(id,internal=false){
    if(id&&this.session?.id!==id)return;
    if(!internal)this.generation++;
    const s=this.session;if(!s||(id&&id!==s.id))return;
    const touch=s.touch||s.releasePending;s.touch=null;clearTimeout(s.touchTimer);
    this.session=null;s.abort.abort();clearTimeout(s.timer);clearTimeout(s.retry);
    if(s.controlSocket&&!s.controlSocket.destroyed){
      await new Promise(resolve=>{const timer=setTimeout(resolve,150);s.controlSocket.end(touch?releasePacket(touch):undefined,()=>{clearTimeout(timer);resolve();});});
      s.controlSocket.destroy();
    }
    s.socket?.destroy();s.child?.kill();
    const tasks=[];
    if(s.port)tasks.push(this.command(s,['forward','--remove',`tcp:${s.port}`],false));
    tasks.push(this.command(s,['shell','rm','-f',s.remote],false));
    await Promise.allSettled(tasks);this.state(s,'stopped');
  }
}
module.exports={AndroidStream,VideoPackets,touchPacket,keyPacket,VERSION,SERVER_SHA256,MAX_PACKET};
