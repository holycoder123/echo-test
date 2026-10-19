const readline = require('node:readline');
readline.createInterface({input: process.stdin}).on('line', line => {
  const {id, method, args} = JSON.parse(line);
  if(method==='hang') return;
  if(method==='shutdown') {console.log(JSON.stringify({id,result:{done:true}}));process.exit(0);}
  if(method==='event') console.log(JSON.stringify({event:{kind:'step',name:'测试'}}));
  setTimeout(() => console.log(JSON.stringify(method==='fail'?{id,error:'测试错误',traceback:'Traceback: mocked hook failed'}:{id,result:args})), args.delay||0);
});
