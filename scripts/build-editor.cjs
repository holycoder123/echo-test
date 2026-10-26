const fs=require('node:fs'),path=require('node:path'),esbuild=require('esbuild');
const root=path.resolve(__dirname,'..'),base=path.join(root,'node_modules/monaco-editor/esm/vs/editor');
const out=path.join(root,'electron/renderer/editor');
fs.mkdirSync(out,{recursive:true});
const monaco={name:'python-monaco',setup(build){build.onResolve({filter:/^@echotest\/monaco$/},()=>({path:'monaco',namespace:'python-monaco'}));build.onLoad({filter:/.*/,namespace:'python-monaco'},()=>({contents:fs.readFileSync(path.join(base,'editor.main.js'),'utf8').split('\n').filter(line=>!line.includes('monaco-lsp-client')&&!line.includes('index as lsp')&&(!line.includes('/languages/definitions/')||line.includes('/python/'))).join('\n'),resolveDir:base,loader:'js'}));}};
(async()=>{
 await esbuild.build({entryPoints:[path.join(root,'electron/renderer/python-ide-entry.js')],outfile:path.join(out,'python-ide.js'),bundle:true,format:'iife',platform:'browser',target:'chrome144',minify:true,loader:{'.ttf':'file'},assetNames:'[name]-[hash]',plugins:[monaco],legalComments:'eof'});
 await esbuild.build({entryPoints:[path.join(base,'editor.worker.js')],outfile:path.join(out,'editor.worker.js'),bundle:true,format:'iife',platform:'browser',target:'chrome144',minify:true,legalComments:'eof'});
 fs.copyFileSync(path.join(root,'node_modules/monaco-editor/LICENSE'),path.join(out,'MONACO-LICENSE.txt'));
 fs.copyFileSync(path.join(root,'node_modules/monaco-editor/esm/vs/nls/lang/zh-cn.js'),path.join(out,'nls.zh-cn.js'));
 console.log('Local Python editor and worker built.');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
