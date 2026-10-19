// Stop must also cancel an operation waiting for the foreground handoff.
class StartGate {
  constructor(){this.generation=0;this.pending=false;}
  begin(){this.pending=true;return ++this.generation;}
  cancel(){if(this.pending)this.generation++;}
  submit(generation,operation){
    if(generation!==this.generation){const error=new Error('已取消尚未开始的执行或录制');error.cancelled=true;throw error;}
    return operation();
  }
  finish(){this.pending=false;}
}
module.exports={StartGate};
