const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
function fixture(){
  const calls=[],decoded=[],canvases=[],decoders=[];
  const S={view:'android',modal:null,mcpOperation:'',android:{connection:{serial:'phone'},frame:{width:1080,height:2400}}};
  const canvas=()=>{const c={width:0,height:0,getContext:()=>({drawImage:()=>{}})};canvases.push(c);return c;};
  const context=vm.createContext({S,Uint8Array,performance:{now:()=>2000},crypto:{randomUUID:()=> 'test-request-id'},setInterval:()=>{},window:{__studioReady:true},document:{hidden:false,addEventListener:()=>{},querySelector:()=>null,createElement:canvas},api:async(method,args)=>{calls.push({method,args});return {id:'session'};},targetArgs:()=>({target:{serial:'phone',platform:'android'}}),refreshAndroidFrame:()=>calls.push({method:'fallback'}),VideoDecoder:class{
    constructor(callbacks){this.callbacks=callbacks;this.state='unconfigured';this.decodeQueueSize=0;decoders.push(this);}
    configure(config){this.config=config;this.state='configured';}
    decode(chunk){decoded.push(chunk);}
    close(){this.state='closed';}
  },EncodedVideoChunk:class{constructor(init){Object.assign(this,init);}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../renderer/android-video.js'),'utf8')+'\nthis.video=AndroidVideo;this.getCodec=avcCodec;',context);
  const event=extra=>({kind:'android_video',request_id:'test-request-id',serial:'phone',id:'session',...extra});
  return {context,S,calls,decoded,decoders,event,video:context.video};
}
test('SPS selects the actual H264 profile and keyframes carry SPS/PPS without base64',async()=>{
  const f=fixture();await f.video.start();
  const sps=new Uint8Array([0,0,0,1,0x67,0x64,0,0x28,0,0,1,0x68,0]);
  f.video.handle(f.event({config:true,data:sps}));
  assert.equal(f.decoders[0].config.codec,'avc1.640028');
  f.video.handle(f.event({keyframe:false,data:new Uint8Array([1]),sequence:1}));assert.equal(f.decoded.length,0);
  f.video.handle(f.event({keyframe:true,data:new Uint8Array([0,0,1,0x65]),timestamp:12,sequence:2}));
  assert.equal(f.decoded[0].data.length,sps.length+4);assert.equal(f.decoded[0].type,'key');assert.equal(f.decoded[0].timestamp,12);
  assert.ok(f.calls.some(call=>call.method==='android_stream_ack'&&call.args.sequence===2));
});
test('decoded rotation updates full-device coordinates, closes video frames and survives DOM replacement',async()=>{
  const f=fixture();await f.video.start();f.video.handle(f.event({config:true,data:new Uint8Array([0,0,1,0x67,0x42,0xe0,0x1e,0])}));
  let closed=0;f.decoders[0].callbacks.output({displayWidth:1280,displayHeight:576,close:()=>closed++});
  assert.equal(closed,1);assert.equal(f.S.android.frame.width,2400);assert.equal(f.S.android.frame.height,1080);assert.equal(f.video.hasFrame,true);
  f.video.paint();assert.equal(f.video.backing.width,1280);
  f.video.stop();assert.equal(f.decoders[0].state,'closed');
});
test('decoder overload drops deltas until the next keyframe, while stale sessions are ignored',async()=>{
  const f=fixture();await f.video.start();f.video.handle(f.event({config:true,data:new Uint8Array([0,0,1,0x67,0x42,0xe0,0x1e,0])}));
  f.decoders[0].decodeQueueSize=5;f.video.handle(f.event({keyframe:true,data:new Uint8Array([1])}));
  f.decoders[0].decodeQueueSize=0;f.video.handle(f.event({data:new Uint8Array([1])}));assert.equal(f.decoded.length,0);
  f.video.handle(f.event({request_id:'stale',keyframe:true,data:new Uint8Array([1])}));assert.equal(f.decoded.length,0);
  f.video.handle(f.event({keyframe:true,data:new Uint8Array([1])}));assert.equal(f.decoded.length,1);
});
test('unsupported video reports an error without screenshot fallback or disconnecting the target',async()=>{
  const f=fixture();f.context.VideoDecoder=undefined;await f.video.start();
  assert.equal(f.S.android.videoFailed,true);assert.equal(f.S.android.videoStatus,'error');assert.equal(f.S.android.connection.serial,'phone');assert.ok(!f.calls.some(call=>call.method==='fallback'||call.method==='android_frame'));
});

test('stream starts without any screenshot and enables control only after decoded geometry is registered',async()=>{
  const f=fixture();f.S.android.frame=null;await f.video.start();assert.equal(f.calls[0].method,'android_stream_start');
  assert.equal(f.video.usable(),false);
  f.video.handle(f.event({kind:'android_video_state',status:'control_ready'}));
  f.video.handle(f.event({config:true,data:new Uint8Array([0,0,1,0x67,0x42,0xe0,0x1e,0])}));
  f.decoders[0].callbacks.output({displayWidth:576,displayHeight:1280,close:()=>{}});
  assert.equal(f.video.usable(),false);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.video.usable(),true);assert.deepEqual(Array.from(f.video.geometry),[576,1280]);
  await f.video.control('down',{point:[20,30],gesture_id:'gesture-test-1'});
  assert.equal(f.calls.at(-1).method,'android_control');assert.equal(f.calls.at(-1).args.epoch,1);
  f.video.handle(f.event({config:true,data:new Uint8Array([0,0,1,0x67,0x42,0xe0,0x1e,0])}));
  assert.equal(f.video.usable(),false);assert.equal(f.video.epoch,2);
});


test('first decoded frame unlocks navigation without replacing the page, with busy/error/rotation guards',async()=>{
  const f=fixture(),buttons=Array.from({length:5},()=>({disabled:true}));
  f.context.document.querySelectorAll=()=>buttons;
  const source=fs.readFileSync(path.join(__dirname,'../renderer/android.js'),'utf8');
  vm.runInContext(source.slice(source.indexOf('function androidInteractionLocked'),source.indexOf('function androidView')),f.context);
  f.S.android.frame=null;await f.video.start();assert.ok(buttons.every(b=>b.disabled));
  f.video.handle(f.event({kind:'android_video_state',status:'control_ready'}));
  f.video.handle(f.event({config:true,data:new Uint8Array([0,0,1,0x67,0x42,0xe0,0x1e,0])}));
  f.decoders[0].callbacks.output({displayWidth:576,displayHeight:1280,close:()=>{}});
  await new Promise(resolve=>setImmediate(resolve));assert.ok(buttons.every(b=>!b.disabled));
  f.S.busy='running';f.video.update();assert.ok(buttons.every(b=>b.disabled));
  f.S.busy='recording';f.video.update();assert.ok(buttons.every(b=>!b.disabled));
  f.S.android.previewError='offline';f.video.update();assert.ok(buttons.every(b=>b.disabled));
  f.S.android.previewError='';f.video.handle(f.event({config:true,data:new Uint8Array([0,0,1,0x67,0x42,0xe0,0x1e,0])}));assert.ok(buttons.every(b=>b.disabled));
});
