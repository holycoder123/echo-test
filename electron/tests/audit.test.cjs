const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {AuditLog}=require('../audit.cjs');
function create(t,options={}){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'echo-test-audit-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return new AuditLog(directory,options);}
test('persists errors, traceback and context across sessions without input payloads',t=>{
 const log=create(t);const error=new Error('录制失败');error.backendTrace='Traceback: hook failed';
 const entry=log.error('record_start',error,{context:{handle:10,displayMode:'native'},password:'private',args:{text:'private'}});
 assert.equal(error.auditId,entry.id);
 const rows=new AuditLog(log.directory).read({level:'error',search:'hook'});
 assert.equal(rows.length,1);assert.equal(rows[0].context.handle,10);assert.equal(rows[0].backendTrace,error.backendTrace);
 assert.equal(fs.readFileSync(log.file,'utf8').includes('private'),false);
});
test('rotates files and keeps bounded history readable even after a partial line',t=>{
 const log=create(t,{maxBytes:600,files:3});
 for(let index=0;index<30;index++)log.write('info','capture','completed',{message:'x'.repeat(120),index});
 fs.appendFileSync(log.file,'{"partial":');
 const rows=log.read({limit:1000});assert.equal(rows[0].index,29);assert.ok(rows.length<30);
 assert.equal(fs.readdirSync(log.directory).length,3);
});
test('deduplicates the same propagated error and throttles recurring layout failures',t=>{
 const log=create(t);const error=new Error('hook');log.error('record_start',error);log.error('record_start',error);
 const first=log.error('embed_sync',new Error('gone'),{},true);const next=log.error('embed_sync',new Error('gone'),{},true);
 assert.equal(first.id,next.id);assert.equal(log.read().length,2);
});

test('deletes selected IDs across rotations and preserves unselected entries after restart',t=>{
 const log=create(t,{maxBytes:550,files:5});
 for(let index=0;index<8;index++)log.write('info','capture','completed',{message:'x'.repeat(70),index});
 const before=log.read({limit:1000}),ids=[before[0].id,before.at(-1).id];
 const result=log.delete(ids);assert.equal(result.deleted,2);
 const reopened=new AuditLog(log.directory).read({limit:1000});
 assert.deepEqual(reopened.map(row=>row.id),before.filter(row=>!ids.includes(row.id)).map(row=>row.id));
 log.delete(reopened.map(row=>row.id));assert.deepEqual(log.read(),[]);
 log.write('info','capture','completed');assert.equal(log.read().length,1);
});
test('log deletion validates the complete request and keeps malformed lines',t=>{
 const log=create(t),first=log.write('error','capture','failed'),second=log.write('info','windows','completed');
 fs.appendFileSync(log.file,'null\n{"partial":');const original=fs.readFileSync(log.file,'utf8');
 for(const ids of [null,[],[first.id,'../outside'],[null]])assert.throws(()=>log.delete(ids));
 assert.equal(fs.readFileSync(log.file,'utf8'),original);
 log.delete([first.id]);assert.deepEqual(log.read().map(row=>row.id),[second.id]);
 assert.ok(fs.readFileSync(log.file,'utf8').endsWith('null\n{"partial":'));
});
test('deleting a throttled error lets the next failure create a visible entry',t=>{
 const log=create(t),first=log.error('layout',new Error('lost'),{},true);log.delete([first.id]);
 const next=log.error('layout',new Error('lost'),{},true);assert.notEqual(next.id,first.id);assert.equal(log.read().length,1);
});
test('failed log rewrite leaves existing logs unchanged',t=>{
 const log=create(t),row=log.write('info','windows','completed');const original=fs.readFileSync(log.file,'utf8'),write=fs.writeFileSync;
 t.mock.method(fs,'writeFileSync',function(file,...args){if(String(file).includes('.audit-delete-'))throw new Error('disk full');return write.call(this,file,...args);});
 assert.throws(()=>log.delete([row.id]),/disk full/);assert.equal(fs.readFileSync(log.file,'utf8'),original);
});
test('log deletion refuses redirected log files',t=>{
 const log=create(t),row=log.write('info','windows','completed'),real=fs.realpathSync;
 t.mock.method(fs,'realpathSync',function(file,...args){return file===log.file?path.join(log.directory,'outside'):real.call(this,file,...args);});
 assert.throws(()=>log.delete([row.id]),/重定向/);assert.equal(log.read().length,1);
});
