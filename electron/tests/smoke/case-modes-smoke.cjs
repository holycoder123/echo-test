// Isolated editor/service verification. No real window is connected or operated.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {artifactFile}=require('../../paths.cjs');
async function verify(main){
  const js=code=>main.webContents.executeJavaScript(code),result={};
  await js(`window.__caseModesState={project:clone(S.project),path:S.path,baseDir:S.baseDir,libraryOpen:S.libraryOpen,selected:S.selected,view:S.view,dirty:S.dirty,modeSource:S.modeSource,pythonControlSelected:S.pythonControlSelected};S.busy='';S.mcpOperation='';S.gameRunStarting=false;S.view='cases';`);
  try{
    result.loop=await js(`(async()=>{
      setProject(await api('new_project'));S.view='cases';
      addStep('loop');addStep('text');
      const editor=document.querySelector('[data-param="text"]');editor.value='thread '+String.fromCharCode(36)+'{i}';editor.dispatchEvent(new Event('input',{bubbles:true}));
      S.project.steps[0].params.end=3;S.project.steps[1].delay=0;
      render();return S.project.steps.map(s=>s.action).join(',')==='loop,text,end_loop'&&caseStepDepths()[1]===1&&document.querySelectorAll('.loop-marker').length===2;
    })()`);assert.equal(result.loop,true);
    await new Promise(resolve=>setTimeout(resolve,100));
    fs.writeFileSync(artifactFile('smoke','lowcode-loop-preview.png'),(await main.webContents.capturePage()).toPNG());
    await js("handleAction('mode-preview',{dataset:{}})");
    result.preview=await js(`(()=>{const editor=document.querySelector('#generated-python-code'),before=editor.value;editor.focus();editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));return editor.readOnly&&editor.value===before&&editor.value.includes('range(2, 4, 1)')&&editor.value.includes('window.text')&&S.project.mode==='lowcode';})()`);
    assert.equal(result.preview,true);
    await js("handleAction('mode-copy',{dataset:{}})");
    result.copy=await js("S.project.mode==='python'&&S.path===null&&S.modeSource.project.mode==='lowcode'&&!modal.open&&!!document.querySelector('#case-python-code')");assert.equal(result.copy,true);
    result.control=await js(`(async()=>{
      const data=await api('control_save',{selector:{name:'双模式冒烟控件',kind:'coordinate',x:.4,y:.3}});setControls(data);
      const id=data.control.id;await handleAction('mode-control',{dataset:{id}});
      const editor=document.querySelector('#case-python-code');editor.focus();editor.setSelectionRange(editor.value.length,editor.value.length);S.pythonSelection=[editor.value.length,editor.value.length];
      await handleAction('mode-insert-control',{dataset:{}});
      const inserted=S.project.code.endsWith('controls.by_id("'+id+'")');
      const search=document.querySelector('#python-control-search');search.value='双模式冒烟';search.dispatchEvent(new Event('input',{bubbles:true}));
      return inserted&&document.querySelectorAll('.python-control-card').length===1&&S.project.selectors.some(s=>s.library_id===id);
    })()`);assert.equal(result.control,true);
    await new Promise(resolve=>setTimeout(resolve,100));
    fs.writeFileSync(artifactFile('smoke','python-mode-preview.png'),(await main.webContents.capturePage()).toPNG());
    result.locked=await js("S.busy='running';render();document.querySelector('#case-python-code').disabled&&document.querySelector('[data-act=mode-source]').disabled");assert.equal(result.locked,true);
    await js("S.busy='';S.dirty=false;handleAction('mode-source',{dataset:{}})");
    result.source=await js("S.project.mode==='lowcode'&&S.project.steps[1].params.text==='thread ${i}'&&S.modeSource===null");assert.equal(result.source,true);
    result.errors=await js('window.__studioErrors');assert.deepEqual(result.errors,[]);
    result.passed=true;return result;
  }catch(error){result.errors=[String(error.stack||error)];throw error;}
  finally{
    fs.writeFileSync(artifactFile('smoke','case-modes-smoke.json'),JSON.stringify(result,null,2));
    await js("(async()=>{if(modal.open)closeModal();S.busy='';const previous=window.__caseModesState;await api('case_context',{path:previous.path||null,base_dir:previous.baseDir});Object.assign(S,previous);render();await api('dirty',{value:S.dirty,caseName:S.project.name});delete window.__caseModesState;})()");
  }
}
module.exports={verify};
