const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const python=path.join(root,'runtime','python','python.exe');
const node=path.join(root,'runtime','node','node.exe');
const system=process.env.SystemRoot||'C:\\Windows';
const env={...process.env,PATH:`${system}\\System32;${system}`,PYTHONUTF8:'1',PYTHONNOUSERSITE:'1'};
delete env.NYCS_PYTHON;delete env.PYTHONPATH;delete env.PYTHONHOME;
function run(exe,args){
  if(exe===python)args=['-X','utf8',...args];
  const result=spawnSync(exe,args,{cwd:root,env,windowsHide:true,encoding:'utf8',timeout:120000});
  if(result.error||result.status!==0)throw new Error(result.error?.message||result.stderr||result.stdout||`Exit ${result.status}`);
  return result.stdout.trim();
}
for(const file of [python,node,path.join(root,'node_modules','electron','dist','electron.exe')])if(!fs.existsSync(file))throw new Error(`Missing portable runtime: ${file}`);
const imports=run(python,['-c',`import sys,json,struct; import cv2,numpy,PIL,rapidocr,onnxruntime,tkinter; from nycs_studio import backend,service; assert struct.calcsize('P')==8; assert sys.flags.isolated; assert sys.flags.utf8_mode; print(json.dumps({'python':sys.version,'executable':sys.executable,'paths':sys.path}))`]);
const modules=run(node,['-e',`require('koffi');require('zod');require('@modelcontextprotocol/sdk/server/mcp.js'); console.log(process.version)`]);
// Fail any external HTTP request during real OCR inference.
const ocr=run(python,['-c',`import runpy,requests; from unittest.mock import patch; from pathlib import Path
with patch.object(requests.sessions.Session,'request',side_effect=RuntimeError('Network disabled for portable OCR verification')):
 runpy.run_path(str(Path('scripts/smoke-recognition.py')),run_name='__main__')`]);
const report={passed:true,systemPathExcluded:true,imports:JSON.parse(imports),node:modules,ocr:JSON.parse(ocr)};
fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
fs.writeFileSync(path.join(root,'artifacts','portable-verification.json'),JSON.stringify(report,null,2));
console.log('Portable imports and offline OCR passed with system Node/Python excluded from PATH.');
