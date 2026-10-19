const {spawn} = require('node:child_process');
const {EventEmitter} = require('node:events');
const readline = require('node:readline');

class PythonBridge extends EventEmitter {
  constructor(command, args, options = {}) {
    super();
    this.command = command;
    this.sequence = 0;
    this.pending = new Map();
    this.closed = false;
    this.child = spawn(command, args, {windowsHide: true, ...options, stdio: ['pipe', 'pipe', 'pipe']});
    readline.createInterface({input: this.child.stdout}).on('line', line => this.receive(line));
    this.child.stderr.on('data', data => this.emit('diagnostic', data.toString()));
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', code => this.fail(new Error(`测试服务已退出（${code}）`)));
    this.child.stdin.on('error', error => this.fail(error));
  }
  receive(line) {
    let message;
    try { message = JSON.parse(line); } catch { this.emit('diagnostic', line); return; }
    if (message.event) { this.emit('event', message.event); return; }
    const item = this.pending.get(message.id);
    if (!item) return;
    clearTimeout(item.timer);
    this.pending.delete(message.id);
    if (message.error) {const error=new Error(message.error);error.backendTrace=message.traceback;item.reject(error);}
    else item.resolve(message.result);
  }
  async call(method, args = {}, timeout = 20000) {
    const started=Date.now();const details={requestId:`python-${this.sequence+1}`,targetHandle:Number(args.handle)||undefined};
    this.audit?.('start',method,details);
    try {const result=await this.request(method,args,timeout);this.audit?.('success',method,{...details,elapsedMs:Date.now()-started});return result;}
    catch(error){this.audit?.('error',method,{...details,elapsedMs:Date.now()-started},error);throw error;}
  }
  request(method, args = {}, timeout = 20000) {
    if (this.closed) return Promise.reject(new Error('测试服务未连接，请重启应用'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 请求超时，请检查测试服务`));
      }, timeout);
      this.pending.set(id, {resolve, reject, timer});
      this.child.stdin.write(JSON.stringify({id, method, args}) + '\n');
    });
  }
  fail(error) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    if(!this.stopping)this.emit('unavailable', error.message);
  }
  async shutdown() {
    this.stopping=true;
    if (!this.closed) {
      try { await this.call('shutdown', {}, 8000); } catch {}
      this.child.stdin.end();
    }
  }
}
module.exports = {PythonBridge};
