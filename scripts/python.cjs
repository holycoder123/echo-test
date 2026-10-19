const {spawnSync}=require('node:child_process');
const {resolvePython}=require('../electron/python-runtime.cjs');
const result=spawnSync(resolvePython(),['-X','utf8',...process.argv.slice(2)],{
  stdio:'inherit',windowsHide:true,env:{...process.env,PYTHONUTF8:'1'},
});
if(result.error)console.error(result.error.message);
process.exit(result.status??1);
