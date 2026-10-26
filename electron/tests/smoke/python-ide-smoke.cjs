// Real Monaco editing and local Python services; no target input.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {artifactFile}=require('../../paths.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function verify(main){
  const js=code=>main.webContents.executeJavaScript(code),result={};
  const wait=async(code,label)=>{const until=Date.now()+15000;while(Date.now()<until){if(await js(code))return;await pause(80);}throw new Error('Editor UI timed out: '+label);};
  await js(`window.__completionSaved={project:S.project,view:S.view,selected:S.selected,dirty:S.dirty,busy:S.busy,libraryOpen:S.libraryOpen,controls:S.controls,pythonControlSelected:S.pythonControlSelected};S.busy='';S.view='cases';S.libraryOpen=false;`);
  try{
    result.primary=await js(`(()=>{S.project={name:'Python 编辑体验',mode:'python',code:'',script_timeout:600,steps:[],selectors:[]};render();window.__ide=PythonIde.editorFor('#case-python-code');window.__ideModel=__ide.getModel();return !!document.querySelector('.monaco-editor')&&document.querySelector('#case-python-code').hidden;})()`);assert.equal(result.primary,true);
    await js(`__ideModel.setValue('window.cl');__ide.setPosition({lineNumber:1,column:10});__ide.focus();__ide.trigger('test','editor.action.triggerSuggest',{});`);
    await wait(`!!document.querySelector('.suggest-widget.visible .monaco-list-row')`,'window completion');
    result.filterAndAccept=await js(`(()=>{const shown=document.querySelector('.suggest-widget.visible').textContent.includes('click');__ide.trigger('test','acceptSelectedSuggestion',{});return shown&&__ideModel.getValue()==='window.click()'&&S.project.code===__ideModel.getValue()&&__ide.getPosition().column===14;})()`);assert.equal(result.filterAndAccept,true);
    await js(`__ideModel.setValue('window.cl("button")');__ide.setPosition({lineNumber:1,column:10});__ide.trigger('test','editor.action.triggerSuggest',{});`);
    await wait(`!!document.querySelector('.suggest-widget.visible .monaco-list-row')`,'existing-call completion');
    result.existingCall=await js(`(()=>{__ide.trigger('test','acceptSelectedSuggestion',{});return __ideModel.getValue()==='window.click("button")'&&S.project.code===__ideModel.getValue();})()`);assert.equal(result.existingCall,true);
    await js(`__ideModel.setValue('');__ide.pushUndoStop();__ide.trigger('test','type',{text:'window.cl'});__ide.pushUndoStop();__ide.trigger('test','editor.action.triggerSuggest',{});`);
    await wait(`!!document.querySelector('.suggest-widget.visible .monaco-list-row')`,'undo completion');
    result.undo=await js(`(()=>{__ide.trigger('test','acceptSelectedSuggestion',{});__ide.pushUndoStop();const accepted=__ideModel.getValue()==='window.click()';__ide.trigger('test','undo',{});return accepted&&__ideModel.getValue()==='window.cl'&&S.project.code===__ideModel.getValue();})()`);assert.equal(result.undo,true);
    await js(`__ideModel.setValue('import math\\nmath.sq');__ide.setPosition({lineNumber:2,column:8});__ide.trigger('test','editor.action.triggerSuggest',{});`);
    await wait(`!!document.querySelector('.suggest-widget.visible')&&document.querySelector('.suggest-widget.visible').textContent.includes('sqrt')`,'standard-library completion');result.standardLibrary=true;
    await js(`__ide.trigger('test','hideSuggestWidget',{});__ideModel.setValue('window.click(');__ide.setPosition({lineNumber:1,column:14});__ide.trigger('test','editor.action.triggerParameterHints',{});`);
    await wait(`!!document.querySelector('.parameter-hints-widget.visible')&&document.querySelector('.parameter-hints-widget.visible').textContent.includes('target')`,'signature help');result.signature=true;
    await js(`__ide.trigger('test','closeParameterHints',{});__ideModel.setValue('unknown_symbol + 1\\n');`);
    await wait(`PythonIde.monaco.editor.getModelMarkers({resource:__ideModel.uri}).some(m=>m.startLineNumber===1&&m.message.includes('unknown_symbol'))`,'diagnostics');result.diagnostics=true;
    result.problemNavigation=await js(`(()=>{document.querySelector('.ide-problems').open=true;document.querySelector('.ide-problem').click();return __ide.getPosition().lineNumber===1;})()`);assert.equal(result.problemNavigation,true);
    await js(`__ideModel.setValue('name="中文"\\nitems=[1,2,3]\\n');window.__beforeFormat=__ideModel.getValue();__ide.pushUndoStop();__ide.getAction('editor.action.formatDocument').run();`);
    await wait(`__ideModel.getValue().includes('items = [1, 2, 3]')`,'formatting');
    result.formatAndUndo=await js(`(()=>{const formatted=__ideModel.getValue().includes('中文')&&S.project.code===__ideModel.getValue();__ide.trigger('test','undo',{});return formatted&&__ideModel.getValue()===__beforeFormat;})()`);assert.equal(result.formatAndUndo,true);
    await js(`__ideModel.setValue('def greet(name: str):\\n    return name.upper()\\n\\ngreet("中文")\\n');__ide.setPosition({lineNumber:4,column:2});__ide.trigger('test','editor.action.peekDefinition',{});`);
    await wait(`!!document.querySelector('.peekview-widget')`,'definition peek');result.definition=true;
    await js(`__ide.trigger('test','closeReferenceSearch',{});__ideModel.setValue(Array.from({length:100},(_,i)=>'# 第 '+i+' 行').join('\\n'));__ide.pushUndoStop();__ide.executeEdits('test',[{range:new PythonIde.monaco.Range(10,1,10,1),text:'sentinel'}]);__ide.pushUndoStop();__ide.setPosition({lineNumber:10,column:5});__ide.setScrollTop(160);window.__modelBeforeRender=__ideModel;render();window.__ide=PythonIde.editorFor('#case-python-code');true;`);
    await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    result.preservedOnRender=await js(`(()=>{window.__preservedState={sameModel:__ide.getModel()===__modelBeforeRender,position:__ide.getPosition(),scrollTop:__ide.getScrollTop()};const same=__preservedState.sameModel&&__ide.getPosition().lineNumber===10&&__ide.getPosition().column===5&&__ide.getScrollTop()>0;__ide.trigger('test','undo',{});return same&&!__ideModel.getValue().includes('sentinel');})()`);assert.equal(result.preservedOnRender,true);
    await js(`S.view='settings';render();S.view='cases';render();window.__ide=PythonIde.editorFor('#case-python-code');true;`);
    result.preservedOnNavigation=await js(`__ide.getModel()===__ideModel&&!__ideModel.getValue().includes('sentinel')`);assert.equal(result.preservedOnNavigation,true);
    result.controlInsertion=await js(`(async()=>{S.controls={...S.controls,entries:[{id:'ide-control-fixture',category_id:'',selector:{name:'编辑器测试按钮',kind:'coordinate',x:.5,y:.5,library_id:'ide-control-fixture'}}]};await handleAction('mode-control',{dataset:{id:'ide-control-fixture'}});__ideModel.setValue('window.click()');__ide.setPosition({lineNumber:1,column:14});await handleAction('mode-insert-control',{dataset:{}});return __ideModel.getValue()==='window.click(controls.by_id("ide-control-fixture"))'&&S.project.code===__ideModel.getValue();})()`);assert.equal(result.controlInsertion,true);
    await js(`__ide.getAction('actions.find').run();`);await wait(`!!document.querySelector('.find-widget.visible')`,'find');result.find=true;
    await js(`__ide.trigger('test','closeFindWidget',{});S.busy='running';render();window.__lockedIde=PythonIde.editorFor('#case-python-code');window.__lockedText=__lockedIde.getValue();__lockedIde.trigger('test','type',{text:'should_not_insert'});`);
    result.locked=await js(`__lockedIde.getOption(PythonIde.monaco.editor.EditorOption.readOnly)&&__lockedIde.getValue()===__lockedText&&[...document.querySelectorAll('.ide-editor-tools button')].find(b=>b.textContent==='格式化').disabled`);assert.equal(result.locked,true);
    await js(`S.busy='';render();window.__unlockedIde=PythonIde.editorFor('#case-python-code');window.__unlockedText=__unlockedIde.getValue();__unlockedIde.pushUndoStop();__unlockedIde.trigger('test','type',{text:'editable'});__unlockedIde.pushUndoStop();`);
    result.unlocked=await js(`(()=>{const editable=!__unlockedIde.getOption(PythonIde.monaco.editor.EditorOption.readOnly)&&__unlockedIde.getValue()!==__unlockedText&&![...document.querySelectorAll('.ide-editor-tools button')].find(b=>b.textContent==='格式化').disabled;__unlockedIde.trigger('test','undo',{});return editable&&__unlockedIde.getValue()===__unlockedText;})()`);assert.equal(result.unlocked,true);
    await js(`S.busy='';S.project={name:'局部脚本',mode:'lowcode',steps:[],selectors:[]};addStep('python');PythonIde.editorFor('[data-param="code"]').setValue('print("inline")');`);
    result.inline=await js(`S.project.steps[S.selected].params.code==='print("inline")'`);assert.equal(result.inline,true);
    await js(`handleAction('script-edit',{dataset:{}})`);await wait(`!!PythonIde.editorFor('#script-code')`,'expanded editor');
    await js(`PythonIde.editorFor('#script-code').setValue('print("expanded")');handleAction('script-apply',{dataset:{}});`);
    result.dialogSaved=await js(`!modal.open&&S.project.steps[S.selected].params.code==='print("expanded")'`);assert.equal(result.dialogSaved,true);
    await js(`handleAction('mode-preview',{dataset:{}})`);await wait(`!!PythonIde.editorFor('#generated-python-code')`,'readonly preview');
    result.readonly=await js(`(()=>{const editor=PythonIde.editorFor('#generated-python-code'),text=editor.getValue();editor.trigger('test','type',{text:'forbidden'});return editor.getOption(PythonIde.monaco.editor.EditorOption.readOnly)&&editor.getValue()===text;})()`);assert.equal(result.readonly,true);
    await js(`closeModal();S.project={name:'Python 编辑体验',mode:'python',code:'# 使用共享控件作为函数参数\\ndef click_and_wait(target, seconds=1):\\n    window.click(target)\\n    window.sleep(seconds)\\n\\nbutton = controls.by_id("ide-control-fixture")\\nclick_and_wait(button)\\nprint("测试完成")\\n',script_timeout:600,steps:[],selectors:[]};render();document.querySelector('#toasts').replaceChildren();`);
    await pause(500);fs.writeFileSync(artifactFile('smoke','python-ide-preview.png'),(await main.webContents.capturePage()).toPNG());
    result.errors=await js('window.__studioErrors');assert.deepEqual(result.errors,[]);result.passed=true;
  }catch(error){result.error=error.stack;result.debug=await js(`(()=>{const record=PythonIde.recordFor('#case-python-code');return {preserved:window.__preservedState,status:record?.status,sent:record?.sent,version:record?.model.getVersionId(),code:record?.model.getValue(),errors:window.__studioErrors};})()`);fs.writeFileSync(artifactFile('smoke','python-ide-failure.png'),(await main.webContents.capturePage()).toPNG());throw error;}
  finally{fs.writeFileSync(artifactFile('smoke','python-completion-smoke.json'),JSON.stringify(result,null,2));await js(`if(modal.open)closeModal();Object.assign(S,window.__completionSaved);render();api('dirty',{value:S.dirty,caseName:S.project.name});delete window.__completionSaved;`);}
}
module.exports={verify};
