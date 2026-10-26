'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {pathToFileURL,fileURLToPath}=require('node:url');
const PRELUDE='from _echotest_editor import window, game, controls, variables, case_dir, report_dir, step_name, render, assign, run_script';
const uriKey=uri=>{try{const value=path.resolve(fileURLToPath(uri));return process.platform==='win32'?value.toLowerCase():value;}catch{return uri;}};
class PythonLanguageService{
  constructor({root,onDiagnostics=()=>{},caseDirectory}={}){
    this.root=root||path.resolve(__dirname,'..');this.onDiagnostics=onDiagnostics;this.caseDirectory=caseDirectory||(()=>this.root);
    this.documents=new Map();this.pending=new Map();this.sequence=0;this.closed=false;this.buffer=Buffer.alloc(0);
    this.directory=path.join(this.root,'.runtime','editor-analysis',crypto.randomUUID());
  }
  async start(){
    if(this.closed)throw new Error('Python 编辑服务已关闭');
    if(this.starting)return this.starting;
    this.starting=(async()=>{
      fs.mkdirSync(this.directory,{recursive:true});
      fs.copyFileSync(path.join(__dirname,'python-api.pyi'),path.join(this.directory,'_echotest_editor.pyi'));
      const node=path.join(this.root,'runtime','node','node.exe');
      const executable=fs.existsSync(node)?node:process.execPath;
      const env={...process.env};if(process.versions.electron&&executable===process.execPath)env.ELECTRON_RUN_AS_NODE='1';
      const child=this.child=spawn(executable,[require.resolve('pyright/langserver.index.js'),'--stdio'],{cwd:this.root,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
      child.stdout.on('data',data=>this.receive(data));child.stderr.on('data',()=>{});
      child.stdin.on('error',error=>this.fail(error));
      child.on('error',error=>this.fail(error));child.on('exit',()=>this.fail(new Error('Python 语言服务已退出')));
      await this.request('initialize',{processId:process.pid,rootUri:pathToFileURL(this.directory).href,capabilities:{textDocument:{publishDiagnostics:{versionSupport:true},completion:{completionItem:{snippetSupport:true}},hover:{contentFormat:['markdown','plaintext']}},workspace:{configuration:true}},workspaceFolders:[{uri:pathToFileURL(this.directory).href,name:'EchoTest Python'}]});
      this.notify('initialized',{});this.notify('workspace/didChangeConfiguration',{settings:this.configuration()});
    })().catch(error=>{this.child?.kill();throw error;});
    return this.starting;
  }
  configuration(){return {python:{pythonPath:require('./python-runtime.cjs').resolvePython(process.env,fs.existsSync,this.root),analysis:{typeCheckingMode:'basic',diagnosticMode:'openFilesOnly',autoImportCompletions:true,extraPaths:[this.directory,this.root,this.caseDirectory()],useLibraryCodeForTypes:true}}};}
  write(message){if(!this.child?.stdin.writable)throw new Error('Python 语言服务不可用');const body=Buffer.from(JSON.stringify(message));this.child.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`),body]));}
  notify(method,params){this.write({jsonrpc:'2.0',method,params});}
  request(method,params){return new Promise((resolve,reject)=>{const id=++this.sequence,timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Python 编辑请求超时'));},15000);this.pending.set(id,{resolve,reject,timer});try{this.write({jsonrpc:'2.0',id,method,params});}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}});}
  fail(error){for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(error);}this.pending.clear();}
  receive(data){
    this.buffer=Buffer.concat([this.buffer,data]);
    if(this.buffer.length>16*1024*1024){this.child.kill();this.fail(new Error('语言服务消息过大'));return;}
    while(true){const end=this.buffer.indexOf('\r\n\r\n');if(end<0)return;const length=/Content-Length:\s*(\d+)/i.exec(this.buffer.subarray(0,end).toString());if(!length){this.child.kill();return;}const count=Number(length[1]);if(this.buffer.length<end+4+count)return;
      let message;try{message=JSON.parse(this.buffer.subarray(end+4,end+4+count).toString());}catch{this.child.kill();return;}this.buffer=this.buffer.subarray(end+4+count);
      if(message.method){
        if(message.id!=null){let result=null;if(message.method==='workspace/configuration')result=message.params.items.map(item=>item.section==='python'?this.configuration().python:item.section==='python.analysis'?this.configuration().python.analysis:null);this.write({jsonrpc:'2.0',id:message.id,result});}
        else if(message.method==='textDocument/publishDiagnostics'){
          const doc=[...this.documents.values()].find(d=>uriKey(d.uri)===uriKey(message.params.uri));if(!doc||message.params.version!=null&&message.params.version!==doc.version)continue;
          const diagnostics=message.params.diagnostics.filter(d=>d.range.start.line!==doc.prelude).map(d=>({...d,range:this.fromRange(doc,d.range)}));
          this.onDiagnostics({id:doc.id,version:doc.version,diagnostics});
        }
      }else{const item=this.pending.get(message.id);if(item){clearTimeout(item.timer);this.pending.delete(message.id);message.error?item.reject(new Error(message.error.message)):item.resolve(message.result);}}
    }
  }
  validate({id,version,code}){if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(id)||!Number.isSafeInteger(version)||version<1||code!=null&&(typeof code!=='string'||Buffer.byteLength(code)>256*1024))throw new Error('无效的编辑文档');}
  async sync(data){
    this.validate(data);if(typeof data.code!=='string')throw new Error('缺少编辑代码');await this.start();
    const caseDirectory=this.caseDirectory();if(caseDirectory!==this.lastCaseDirectory){this.lastCaseDirectory=caseDirectory;this.notify('workspace/didChangeConfiguration',{settings:this.configuration()});}
    let doc=this.documents.get(data.id);if(doc&&data.version<=doc.version)return {version:doc.version};
    if(!doc&&this.documents.size>=16)throw new Error('打开的 Python 文档过多');
    const lines=data.code.split('\n');let prelude=0;
    for(const match of data.code.matchAll(/^from __future__ import\s*(?:\([\s\S]*?\)|[^\n]*)/gm))prelude=data.code.slice(0,match.index+match[0].length).split('\n').length;
    if(prelude>=lines.length)lines.push('');lines.splice(prelude,0,PRELUDE);
    const text=lines.join('\n'),uri=doc?.uri||pathToFileURL(path.join(this.directory,data.id+'.py')).href;
    const opened=!!doc;doc={id:data.id,version:data.version,code:data.code,uri,prelude};this.documents.set(data.id,doc);
    if(opened)this.notify('textDocument/didChange',{textDocument:{uri,version:data.version},contentChanges:[{text}]});
    else this.notify('textDocument/didOpen',{textDocument:{uri,version:data.version,languageId:'python',text}});
    return {version:data.version};
  }
  fromPosition(doc,p){return {...p,line:p.line>doc.prelude?p.line-1:Math.min(p.line,doc.prelude)};}
  fromRange(doc,r){return {start:this.fromPosition(doc,r.start),end:this.fromPosition(doc,r.end)};}
  async query(kind,data){
    const methods={completion:'textDocument/completion',signature:'textDocument/signatureHelp',hover:'textDocument/hover',definition:'textDocument/definition',references:'textDocument/references'};
    if(!methods[kind])throw new Error('不支持的编辑操作');this.validate(data);const doc=this.documents.get(data.id);
    if(!doc||data.version!==doc.version)return null;
    const lines=doc.code.split('\n');if(!Number.isInteger(data.line)||data.line<0||data.line>=lines.length||!Number.isInteger(data.character)||data.character<0||data.character>lines[data.line].length)throw new Error('无效的光标位置');
    const position={line:data.line+(data.line>=doc.prelude?1:0),character:data.character};
    const result=await this.request(methods[kind],{textDocument:{uri:doc.uri},position,context:kind==='references'?{includeDeclaration:true}:undefined});
    if(this.documents.get(data.id)?.version!==data.version)return null;
    if(kind==='completion'){
      const items=Array.isArray(result)?result:result?.items||[];
      return {isIncomplete:!!result?.isIncomplete,items:items.map(item=>({...item,textEdit:item.textEdit?.range?{...item.textEdit,range:this.fromRange(doc,item.textEdit.range)}:undefined,additionalTextEdits:item.additionalTextEdits?.map(edit=>({...edit,range:this.fromRange(doc,edit.range)}))}))};
    }
    if(kind==='hover')return result&&{...result,range:result.range?this.fromRange(doc,result.range):undefined};
    if(kind==='definition'||kind==='references')return this.locations(doc,result);
    return result;
  }
  locations(doc,result){return (Array.isArray(result)?result:result?[result]:[]).map(location=>{
    const uri=location.uri||location.targetUri,range=location.range||location.targetSelectionRange;
    if(uriKey(uri)===uriKey(doc.uri))return {uri:doc.id,range:this.fromRange(doc,range)};
    try{const file=fs.realpathSync(fileURLToPath(uri)),allowed=[this.root,this.caseDirectory()].map(dir=>fs.realpathSync(dir));if(!allowed.some(dir=>file.startsWith(dir+path.sep))||!['.py','.pyi'].includes(path.extname(file))||fs.statSync(file).size>1024*1024)return null;return {uri,range,text:fs.readFileSync(file,'utf8')};}catch{return null;}
  }).filter(Boolean);}
  async format(code){
    if(typeof code!=='string'||Buffer.byteLength(code)>256*1024)throw new Error('无效的格式化代码');
    return new Promise((resolve,reject)=>{const python=require('./python-runtime.cjs').resolvePython(process.env,fs.existsSync,this.root),child=spawn(python,['-X','utf8','-m','ruff','format','--isolated','--stdin-filename','case.py','-'],{cwd:this.root,windowsHide:true,stdio:['pipe','pipe','pipe']});let output='',error='';
      const timer=setTimeout(()=>{child.kill();reject(new Error('格式化超时'));},10000);
      child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',b=>{output+=b;if(output.length>512*1024)child.kill();});child.stderr.on('data',b=>{if(error.length<4000)error+=b;});child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',status=>{clearTimeout(timer);status===0?resolve(output):reject(new Error(error||'Python 代码无法格式化，请先修正语法错误'));});child.stdin.on('error',()=>{});child.stdin.end(code);
    });
  }
  closeDocument(id){const doc=this.documents.get(id);if(doc){if(this.child?.stdin.writable)this.notify('textDocument/didClose',{textDocument:{uri:doc.uri}});this.documents.delete(id);}}
  resetDocuments(){for(const id of [...this.documents.keys()])this.closeDocument(id);}
  close(){this.closed=true;this.fail(new Error('Python 编辑服务已关闭'));if(this.child&&!this.child.killed)this.child.kill();}
}
module.exports={PythonLanguageService};
