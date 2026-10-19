const path=require('node:path');
function defaultCasePath(directory,name){
  let filename=String(name||'未命名用例').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'').slice(0,80)||'未命名用例';
  if(/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(filename))filename='用例_'+filename;
  return path.join(directory,filename+'.nycs.json');
}
module.exports={defaultCasePath};
