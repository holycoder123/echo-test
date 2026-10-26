const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {AndroidStream,VideoPackets,MAX_PACKET}=require('../android-stream.cjs');
const header=()=>{const data=Buffer.alloc(13);data.writeUInt32BE(0x68323634,1);data.writeUInt32BE(576,5);data.writeUInt32BE(1280,9);return data;};
const packet=(flags=0n,data=Buffer.from([0,0,0,1,0x65]))=>{const bytes=Buffer.alloc(12);bytes.writeBigUInt64BE(flags);bytes.writeUInt32BE(data.length,8);return Buffer.concat([bytes,data]);};
test('video parser handles arbitrary TCP fragmentation, metadata and 64-bit frame flags',()=>{
  const frames=[],sizes=[],parser=new VideoPackets(s=>sizes.push(s),p=>frames.push(p));
  const wire=Buffer.concat([header(),packet(1n<<63n),packet((1n<<62n)|123456n)]);
  for(const byte of wire)parser.feed(Buffer.from([byte]));
  assert.deepEqual(sizes,[{width:576,height:1280}]);assert.equal(frames.length,2);assert.equal(frames[0].config,true);assert.equal(frames[1].keyframe,true);assert.equal(frames[1].timestamp,123456);
});
test('video parser rejects unknown codecs, invalid geometry and oversized packets',()=>{
  for(const offset of [0,1,5]){const h=header();h.writeUInt32BE(0xffffffff,offset);assert.throws(()=>new VideoPackets(()=>{},()=>{}).feed(h));}
  const parser=new VideoPackets(()=>{},()=>{});parser.feed(header());const h=Buffer.alloc(12);h.writeUInt32BE(MAX_PACKET+1,8);assert.throws(()=>parser.feed(h));
});
function fixture(){
  const commands=[],frames=[],states=[],sockets=[],actions=[],launches=[];
  const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{child.killed=true;};
  const manager=new AndroidStream({root:'.',validateServer:()=>{},onPacket:p=>frames.push(p),onState:s=>states.push(s),onAction:a=>actions.push(a),execute:(file,args,options,callback)=>{commands.push(args);queueMicrotask(()=>callback(null,args.includes('tcp:0')?'45678':'',''));},launch:()=>child,connect:()=>{const socket=new EventEmitter();socket.writes=[];socket.write=bytes=>{socket.writes.push(bytes);return true;};socket.end=(bytes,done)=>{if(bytes)socket.write(bytes);done();};socket.setNoDelay=()=>{};socket.destroy=()=>{socket.destroyed=true;socket.emit('close');};sockets.push(socket);queueMicrotask(()=>socket.emit('connect'));return socket;}});
  const launch=manager.launch;manager.launch=(...args)=>{launches.push(args);return launch(...args);};
  return {manager,commands,frames,states,sockets,child,actions,launches};
}

async function controlFixture(){
  const f=fixture();await f.manager.start({serial:'device',adb_path:'adb.exe',request_id:'request-test-1'});
  // Control must not connect until the video socket has received the dummy byte.
  assert.equal(f.sockets.length,1);f.sockets[0].emit('data',Buffer.from([0]));assert.equal(f.sockets.length,2);
  f.sockets[0].emit('data',header().subarray(1));await new Promise(resolve=>setImmediate(resolve));
  const args={id:f.manager.session.id,request_id:'request-test-1',target:{platform:'android',serial:'device'},size:[576,1280],epoch:1};
  f.send=extra=>f.manager.control({...args,...extra});f.writes=f.sockets[1].writes;
  f.send({event:'geometry'});return f;
}

test('live touch uses ordered persistent DOWN/MOVE/UP packets and records only the completed gesture',async()=>{
  const f=await controlFixture(),g={gesture_id:'gesture-test-1'};
  f.send({...g,event:'down',point:[20,30]});assert.equal(f.actions.length,0);
  f.send({...g,event:'move',point:[40,100]});f.send({...g,event:'up',point:[90,200]});
  assert.deepEqual(f.writes.map(b=>[b.length,b[0],b[1]]),[[32,2,0],[32,2,2],[32,2,1]]);
  assert.equal(f.writes[0].readBigInt64BE(2),-2n);assert.equal(f.writes[0].readUInt16BE(18),576);assert.equal(f.writes[2].readUInt16BE(22),0);
  assert.equal(f.actions.length,1);assert.equal(f.actions[0].action,'swipe');assert.deepEqual(f.actions[0].params.end,[90,200]);
  assert.ok(!f.commands.some(args=>args.includes('screencap')||args.includes('input')));await f.manager.stop();
});

test('stale, wrong-target and out-of-bounds input never reaches the control socket',async()=>{
  const f=await controlFixture();
  for(const invalid of [{id:'stale'},{target:{platform:'android',serial:'other'}},{epoch:2},{point:[576,0]},{gesture_id:'--'}]){
    assert.throws(()=>f.send({event:'down',point:[20,30],gesture_id:'gesture-test-1',...invalid}));
  }
  assert.equal(f.writes.length,0);await f.manager.stop();
});

test('rotation and stop release held fingers without replaying or recording cancelled gestures',async()=>{
  const f=await controlFixture();f.send({event:'down',point:[100,200],gesture_id:'gesture-test-1'});
  f.send({event:'geometry',size:[1280,576],epoch:2});assert.equal(f.writes[1][1],3);assert.equal(f.writes[1][33],1);assert.equal(f.writes[1].readUInt16BE(18),1280);
  assert.equal(f.manager.session.touch,null);assert.equal(f.actions.length,0);
  assert.throws(()=>f.send({event:'move',point:[110,210],gesture_id:'gesture-test-1'}));
  f.send({event:'down',size:[1280,576],epoch:2,point:[110,210],gesture_id:'gesture-test-2'});
  await f.manager.stop();assert.equal(f.writes.at(-1)[1],3);assert.equal(f.writes.at(-1)[33],1);assert.equal(f.sockets[1].destroyed,true);assert.equal(f.actions.length,0);
});

test('navigation and text use framed control messages and reject oversized or unsupported input',async()=>{
  const f=await controlFixture();f.send({event:'key',keys:'BACK'});f.send({event:'text',text:'hello world'});
  assert.equal(f.writes[0].length,28);assert.equal(f.writes[0].readUInt32BE(2),4);assert.equal(f.writes[0][15],1);
  assert.equal(f.writes[1][0],1);assert.equal(f.writes[1].readUInt32BE(1),11);assert.equal(f.writes[1].subarray(5).toString(),'hello world');
  const before=f.writes.length;for(const extra of [{event:'key',keys:'POWER'},{event:'text',text:'中文'},{event:'text',text:'a'.repeat(4097)}])assert.throws(()=>f.send(extra));
  assert.equal(f.writes.length,before);assert.deepEqual(f.actions.map(a=>a.action),['key','text']);await f.manager.stop();
});

test('long ASCII input is split into protocol-sized messages while recording one text step',async()=>{
  const f=await controlFixture();const text='x'.repeat(601);f.send({event:'text',text});
  const wire=f.writes[0];let offset=0;const chunks=[];
  while(offset<wire.length){assert.equal(wire[offset],1);const length=wire.readUInt32BE(offset+1);assert.ok(length<=300);chunks.push(wire.subarray(offset+5,offset+5+length).toString());offset+=5+length;}
  assert.deepEqual(chunks.map(s=>s.length),[300,300,1]);assert.equal(chunks.join(''),text);assert.equal(f.actions.length,1);await f.manager.stop();
});

test('rotation reissues cancelled finger release in the new coordinate space',async()=>{
  const f=await controlFixture();f.send({event:'down',point:[100,200],gesture_id:'gesture-test-1'});
  f.send({event:'cancel',gesture_id:'gesture-test-1'});assert.equal(f.writes.length,2);
  f.send({event:'geometry',size:[1280,576],epoch:2});assert.equal(f.writes.length,3);assert.equal(f.writes[2][1],3);assert.equal(f.writes[2][33],1);assert.equal(f.writes[2].readUInt16BE(18),1280);
  assert.equal(f.manager.session.releasePending,null);await f.manager.stop();
});
test('stream transport bounds in-flight frames and waits for a keyframe after overload',async()=>{
  const f=fixture();await f.manager.start({serial:'device',adb_path:'adb.exe',request_id:'request-test-1'});
  const socket=f.sockets[0];socket.emit('data',header());socket.emit('data',packet(1n<<63n));
  for(let i=0;i<12;i++)socket.emit('data',packet(1n<<62n));
  assert.equal(f.manager.session.pending.size,6);assert.equal(f.frames.length,7);
  const first=f.frames.find(p=>p.sequence);f.manager.ack(first.id,first.sequence);
  socket.emit('data',packet());assert.equal(f.frames.length,7);
  socket.emit('data',packet(1n<<62n));assert.equal(f.frames.length,8);
  await f.manager.stop();assert.equal(f.child.killed,true);
  assert.ok(f.commands.some(args=>args.includes('--remove')&&args.includes('tcp:45678')));
  assert.ok(f.commands.every(args=>args[0]==='-s'&&args[1]==='device'));
});
test('stale session cleanup and acknowledgements cannot stop a newer stream',async()=>{
  const f=fixture();await f.manager.start({serial:'device',adb_path:'adb.exe',request_id:'request-test-1'});const old=f.manager.session.id;
  await f.manager.start({serial:'device',adb_path:'adb.exe',request_id:'request-test-2'});
  const current=f.manager.session;await f.manager.stop(old);f.manager.ack(old,1);assert.equal(f.manager.session,current);await f.manager.stop();
});
test('stream request rejects unselected option-like serials and invalid request identifiers',async()=>{
  const f=fixture();await assert.rejects(f.manager.start({serial:'-s',adb_path:'adb.exe',request_id:'request-test-1'}));assert.equal(f.commands.length,0);
});
test('overlapping starts cancel the older startup before it can own resources',async()=>{
  const f=fixture();const results=await Promise.allSettled([
    f.manager.start({serial:'device',adb_path:'adb.exe',request_id:'request-test-1'}),
    f.manager.start({serial:'device',adb_path:'adb.exe',request_id:'request-test-2'}),
  ]);
  assert.equal(results[0].status,'rejected');assert.equal(results[1].status,'fulfilled');assert.equal(f.manager.session.request_id,'request-test-2');await f.manager.stop();
});

test('configured video frame rate, size and bitrate reach the pinned server command',async()=>{
  const f=fixture();await f.manager.start({serial:'device',adb_path:'adb.exe',request_id:'request-test-1',max_fps:60,max_size:1920,bit_rate:8000000});
  const args=f.launches[0][1];for(const value of ['max_fps=60','max_size=1920','video_bit_rate=8000000'])assert.ok(args.includes(value));
  await assert.rejects(f.manager.start({serial:'device',adb_path:'adb.exe',request_id:'request-test-2',max_fps:999}));
  assert.equal(f.manager.session.request_id,'request-test-1');await f.manager.stop();
});
