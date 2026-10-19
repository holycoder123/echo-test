// Editor verification only; never executes a script against a live game.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {artifactFile}=require('../../paths.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function verify(main){
  const js=code=>main.webContents.executeJavaScript(code);
  const result={};
  try{
    result.editor=await js(`(()=>{
      window.__scriptSmokeState={project:clone(S.project),path:S.path,selected:S.selected,view:S.view,dirty:S.dirty};
      S.busy='';S.mcpOperation='';S.gameRunStarting=false;S.view='cases';
      addStep('python');
      const step=S.project.steps[S.selected];
      const input=document.querySelector('[data-param="code"]');
      input.value='print("脚本编辑验证")\\n';input.dispatchEvent(new Event('input',{bubbles:true}));
      return {added:step.action==='python',timeout:step.timeout===30,code:step.params.code===input.value,
        dirty:S.dirty,buttons:!!document.querySelector('[data-act="script-import"]')&&!!document.querySelector('[data-act="script-edit"]')};
    })()`);
    for(const value of Object.values(result.editor))assert.equal(value,true);
    await js("handleAction('script-edit',{dataset:{}})");
    result.expanded=await js(`(()=>{
      const editor=document.querySelector('#script-code');const before=editor.value;
      editor.focus();editor.setSelectionRange(0,0);
      editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
      const tab=editor.value==='    '+before;
      editor.value='print("修改后的脚本")\\n';
      return {modal:modal.open&&S.modal.kind==='script',tab};
    })()`);
    for(const value of Object.values(result.expanded))assert.equal(value,true);
    await js("handleAction('script-apply',{dataset:{}})");
    assert.equal(await js("S.project.steps[S.selected].params.code==='print(\"修改后的脚本\")\\n'&&!modal.open"),true);
    result.imported=await js(`(async()=>{
      const original=api;let called=0;
      api=(method,args)=>method==='script_import'?(called++,Promise.resolve({name:'导入示例',code:'print("导入示例")\\n'})):original(method,args);
      try{await handleAction('script-import',{dataset:{}});}finally{api=original;}
      return called===1&&S.project.steps[S.selected].name==='导入示例'&&S.project.steps[S.selected].params.code==='print("导入示例")\\n';
    })()`);assert.equal(result.imported,true);
    await js("handleAction('script-edit',{dataset:{}})");
    await pause(80);
    fs.writeFileSync(artifactFile('smoke','python-editor-preview.png'),(await main.webContents.capturePage()).toPNG());
    await js('closeModal()');
    result.locked=await js("S.busy='running';render();document.querySelector('[data-param=code]').disabled&&document.querySelector('[data-act=script-import]').disabled");
    assert.equal(result.locked,true);
    await js("S.busy='';render()");
    result.escaped=await js(`(()=>{
      const step=S.project.steps[S.selected];step.params.code='print("</textarea><script>bad</script>")';render();
      return document.querySelector('[data-param="code"]').value===step.params.code&&document.querySelectorAll('#app script').length===0;
    })()`);assert.equal(result.escaped,true);
    result.errors=await js('window.__studioErrors');assert.deepEqual(result.errors,[]);
    result.passed=true;return result;
  }finally{
    fs.writeFileSync(artifactFile('smoke','script-smoke.json'),JSON.stringify(result,null,2));
    await js("if(modal.open)closeModal();S.busy='';Object.assign(S,window.__scriptSmokeState);render();api('dirty',{value:S.dirty,caseName:S.project.name});delete window.__scriptSmokeState");
  }
}
module.exports={verify};
