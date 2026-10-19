const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {AuditLog}=require('../audit.cjs');
function create(t,options={}){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nycs-audit-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return new AuditLog(directory,options);}
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
