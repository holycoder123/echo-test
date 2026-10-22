// Editor completion only; no target window input.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {artifactFile}=require('../../paths.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function verify(main){
  const js=code=>main.webContents.executeJavaScript(code),result={};
  await js("window.__completionSaved={project:clone(S.project),view:S.view,selected:S.selected,dirty:S.dirty,busy:S.busy,libraryOpen:S.libraryOpen};S.busy='';S.view='cases';S.libraryOpen=false;");
  try{
    result.primary=await js(`(()=>{
      S.project={name:'补全验证',mode:'python',code:'',script_timeout:600,steps:[],selectors:[]};render();
      const editor=document.querySelector('#case-python-code');editor.focus();editor.value='window.';editor.setSelectionRange(7,7);editor.dispatchEvent(new Event('input',{bubbles:true}));
      return document.querySelectorAll('.python-completion [role="option"]').length===14&&document.querySelector('.python-completion-detail').textContent.includes('window.size()')&&S.project.code==='window.';
    })()`);assert.equal(result.primary,true);
    await pause(100);
    result.placement=await js(`(()=>{const popup=document.querySelector('.python-completion').getBoundingClientRect();return popup.left>=0&&popup.right<=innerWidth&&popup.top>=0&&popup.bottom<=innerHeight;})()`);assert.equal(result.placement,true);
    fs.writeFileSync(artifactFile('smoke','python-completion-preview.png'),(await main.webContents.capturePage()).toPNG());
    result.filterAndTab=await js(`(()=>{
      const editor=document.querySelector('#case-python-code');editor.value='window.cl';editor.setSelectionRange(9,9);editor.dispatchEvent(new Event('input',{bubbles:true}));
      const filtered=document.querySelectorAll('.python-completion [role="option"]').length===1&&document.querySelector('.python-completion-detail').textContent.includes('timeout=5');
      editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
      return filtered&&editor.value==='window.click()'&&editor.selectionStart===13&&S.project.code===editor.value&&!document.querySelector('.python-completion');
    })()`);assert.equal(result.filterAndTab,true);
    result.undo=await js(`(()=>{
      const editor=document.querySelector('#case-python-code');editor.value='';editor.focus();
      document.execCommand('insertText',false,'sentinel\\nwindow.cl');
      editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      const completed=editor.value==='sentinel\\nwindow.click()';
      document.execCommand('undo');
      return completed&&editor.value==='sentinel\\nwindow.cl'&&S.project.code===editor.value;
    })()`);assert.equal(result.undo,true);
    result.keyboard=await js(`(()=>{
      const editor=document.querySelector('#case-python-code');editor.value='window.';editor.setSelectionRange(7,7);editor.dispatchEvent(new Event('input',{bubbles:true}));
      editor.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
      const selected=document.querySelector('.python-completion [aria-selected="true"]').textContent.includes('locate');
      editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      const accepted=editor.value==='window.locate()';
      editor.value='window.';editor.setSelectionRange(7,7);editor.dispatchEvent(new Event('input',{bubbles:true}));
      editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
      const dismissed=!document.querySelector('.python-completion')&&editor.value==='window.';
      editor.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',ctrlKey:true,bubbles:true,cancelable:true}));
      return selected&&accepted&&dismissed&&!!document.querySelector('.python-completion');
    })()`);assert.equal(result.keyboard,true);
    result.clickAndSafety=await js(`(()=>{
      const option=[...document.querySelectorAll('.python-completion [role="option"]')].find(item=>item.textContent.includes('screenshot'));
      option.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));
      const editor=document.querySelector('#case-python-code'),clicked=editor.value==='window.screenshot()';
      editor.value='# window.';editor.setSelectionRange(9,9);editor.dispatchEvent(new Event('input',{bubbles:true}));
      const comment=!document.querySelector('.python-completion');
      editor.value='"window.';editor.setSelectionRange(8,8);editor.dispatchEvent(new Event('input',{bubbles:true}));
      const string=!document.querySelector('.python-completion');
      editor.readOnly=true;editor.value='window.';editor.setSelectionRange(7,7);editor.dispatchEvent(new Event('input',{bubbles:true}));
      editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
      const readonly=editor.value==='window.'&&!document.querySelector('.python-completion');
      editor.readOnly=false;editor.disabled=true;editor.dispatchEvent(new Event('input',{bubbles:true}));
      const disabled=!document.querySelector('.python-completion');editor.disabled=false;
      return clicked&&comment&&string&&readonly&&disabled;
    })()`);assert.equal(result.clickAndSafety,true);
    result.longLine=await js(`(()=>{
      const editor=document.querySelector('#case-python-code');editor.focus();editor.value='a'.repeat(2000)+'\\nwindow.';editor.setSelectionRange(editor.value.length,editor.value.length);editor.scrollLeft=0;editor.scrollTop=0;editor.dispatchEvent(new Event('input',{bubbles:true}));
      return getComputedStyle(editor).whiteSpace==='pre'&&!!document.querySelector('.python-completion');
    })()`);assert.equal(result.longLine,true);
    result.inline=await js(`(()=>{
      S.project={name:'局部脚本',mode:'lowcode',steps:[],selectors:[]};addStep('python');
      const editor=document.querySelector('[data-param="code"]');const defaultCode=editor.value.includes('window.size()');
      editor.focus();editor.value='window.te';editor.setSelectionRange(9,9);editor.dispatchEvent(new Event('input',{bubbles:true}));
      editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      return defaultCode&&editor.value==='window.text()'&&S.project.steps[S.selected].params.code===editor.value;
    })()`);assert.equal(result.inline,true);
    await js("handleAction('script-edit',{dataset:{}})");
    result.dialog=await js(`(()=>{
      const editor=document.querySelector('#script-code');editor.focus();editor.value='window.sl';editor.setSelectionRange(9,9);editor.dispatchEvent(new Event('input',{bubbles:true}));
      const popup=modal.querySelector('.python-completion');
      editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      return !!popup&&editor.value==='window.sleep()'&&modal.open;
    })()`);assert.equal(result.dialog,true);
    await js("handleAction('script-apply',{dataset:{}})");
    result.dialogSaved=await js("S.project.steps[S.selected].params.code==='window.sleep()'");assert.equal(result.dialogSaved,true);
    result.closedOnLock=await js(`(()=>{const editor=document.querySelector('[data-param="code"]');editor.focus();editor.value='window.';editor.setSelectionRange(7,7);editor.dispatchEvent(new Event('input',{bubbles:true}));S.busy='running';render();return Promise.resolve().then(()=>!document.querySelector('.python-completion'));})()`);assert.equal(result.closedOnLock,true);
    result.errors=await js('window.__studioErrors');assert.deepEqual(result.errors,[]);result.passed=true;return result;
  }catch(error){result.error=String(error.stack||error);throw error;}
  finally{
    fs.writeFileSync(artifactFile('smoke','python-completion-smoke.json'),JSON.stringify(result,null,2));
    await js("if(modal.open)closeModal();Object.assign(S,window.__completionSaved);render();api('dirty',{value:S.dirty,caseName:S.project.name});delete window.__completionSaved;");
  }
}
module.exports={verify};
