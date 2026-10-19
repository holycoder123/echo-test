const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');

// Never pass command arguments, case contents, screenshots or input events here.
function clean(value,depth=0){
  if(depth>5)return '[truncated]';
  if(typeof value==='string')return value.slice(0,12000);
  if(Array.isArray(value))return value.slice(0,30).map(item=>clean(item,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,40).map(([key,item])=>[key,/password|token|secret|^(text|keys|image|events|project|args)$/i.test(key)?'[redacted]':clean(item,depth+1)]));
  return value;
}
class AuditLog{
  constructor(directory,{maxBytes=2*1024*1024,files=5,onEntry=()=>{}}={}){
    this.directory=directory;this.maxBytes=maxBytes;this.files=files;this.onEntry=onEntry;
    this.session=randomUUID();this.sequence=0;this.repeated=new Map();
    fs.mkdirSync(directory,{recursive:true});this.file=path.join(directory,'audit.jsonl');
  }
  write(level,operation,stage,details={}){
    const entry={...clean(details),id:`${this.session.slice(0,8)}-${++this.sequence}`,time:new Date().toISOString(),session:this.session,pid:process.pid,level,operation:String(operation).slice(0,100),stage};
    const line=JSON.stringify(entry)+'\n';
    if(fs.existsSync(this.file)&&fs.statSync(this.file).size+Buffer.byteLength(line)>this.maxBytes){
      for(let index=this.files-1;index>=1;index--){const from=index===1?this.file:`${this.file}.${index-1}`,to=`${this.file}.${index}`;if(fs.existsSync(to))fs.unlinkSync(to);if(fs.existsSync(from))fs.renameSync(from,to);}
    }
    fs.appendFileSync(this.file,line,'utf8');this.onEntry(entry);return entry;
  }
  error(operation,error,details={},throttle=false){
    if(error.auditId)return {id:error.auditId};
    const key=`${operation}:${error.message}`;const previous=this.repeated.get(key);const now=Date.now();
    if(throttle&&previous&&now-previous.time<5000){previous.count++;error.auditId=previous.id;return {id:previous.id};}
    const entry=this.write('error',operation,'failed',{...details,message:error.message||String(error),stack:error.stack,backendTrace:error.backendTrace,repeatCount:previous?.count||0});
    if(throttle){if(this.repeated.size>100)this.repeated.clear();this.repeated.set(key,{time:now,count:0,id:entry.id});}
    error.auditId=entry.id;return entry;
  }
  read({level='',search='',limit=300}={}){
    const rows=[];
    for(let index=this.files-1;index>=0;index--){const file=index?`${this.file}.${index}`:this.file;if(!fs.existsSync(file))continue;for(const line of fs.readFileSync(file,'utf8').split('\n')){try{rows.push(JSON.parse(line));}catch{}}}
    const query=String(search).toLowerCase().slice(0,200);
    return rows.filter(row=>(!level||row.level===level)&&(!query||JSON.stringify(row).toLowerCase().includes(query))).slice(-Math.min(1000,Math.max(1,Number(limit)||300))).reverse();
  }
}
module.exports={AuditLog};
