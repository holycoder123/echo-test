import * as monaco from '@echotest/monaco';

globalThis.MonacoEnvironment={getWorker(){return new Worker(new URL('editor/editor.worker.js',document.baseURI));}};
monaco.editor.defineTheme('echo-light',{base:'vs',inherit:true,rules:[{token:'comment',foreground:'87928A',fontStyle:'italic'},{token:'keyword',foreground:'8751A5'},{token:'string',foreground:'3E7C59'},{token:'number',foreground:'3F78A1'}],colors:{'editor.background':'#FFFFFF','editor.foreground':'#303746','editorLineNumber.foreground':'#AFB6C4','editorLineNumber.activeForeground':'#6576A0','editor.lineHighlightBackground':'#F6F8FD','editor.selectionBackground':'#DAE5FA','editorCursor.foreground':'#536EA8','editorIndentGuide.background1':'#EDEFF5','editorWidget.background':'#FFFFFF','editorWidget.border':'#DFE4EF','editorSuggestWidget.selectedBackground':'#EDF2FC','editorError.foreground':'#C9525E'}});
const records=new Map(),owners=new WeakMap(),byModel=new Map(),externalModels=new Map();
let serial=0;const sessionId=crypto.randomUUID().replaceAll('-','').slice(0,12);
const rpc=(method,args)=>window.studio.call(method,args);
const range=r=>new monaco.Range(r.start.line+1,r.start.character+1,r.end.line+1,r.end.character+1);
function ownerFor(node){if(node.id==='case-python-code')return S.project;if(node.id==='script-code'||node.id==='generated-python-code')return S.modal;return S.project.steps[S.selected]||S.project;}
function status(record,text){record.status=text;const node=record.wrapper?.querySelector('.ide-service-status');if(node)node.textContent=text;}
async function sync(record){
  const version=record.model.getVersionId(),code=record.model.getValue();
  record.chain=(record.chain||Promise.resolve()).catch(()=>{}).then(async()=>{if(record.sent===version)return;await rpc('editor_sync',{id:record.id,version,code});record.sent=version;status(record,'Python 检查已就绪');});
  await record.chain;return version;
}
async function query(record,kind,position){try{const version=await sync(record);if(version!==record.model.getVersionId())return null;return await rpc('editor_query',{id:record.id,version,kind,line:position.lineNumber-1,character:position.column-1});}catch(error){status(record,error.message);return null;}}
function schedule(record){clearTimeout(record.timer);record.timer=setTimeout(()=>sync(record).catch(error=>status(record,error.message)),300);schedulePreviews(record);}
function previewStatus(record,text){const node=record.wrapper?.querySelector('.ide-controls-status');if(node)node.textContent=text;}
function clearPreviews(record){
  record.previewToken=(record.previewToken||0)+1;clearTimeout(record.previewTimer);
  if(record.editor&&record.previewZones?.length)record.editor.changeViewZones(accessor=>{for(const id of record.previewZones)accessor.removeZone(id);});
  for(const item of record.previewInline||[])record.editor?.removeContentWidget(item.widget);
  record.previewDecorations?.clear();record.previewInline=[];
  record.previewZones=[];record.previewDialog?.remove();record.previewDialog=null;
}
function updateInlinePreviews(record){
  if(!record.editor||!record.previewInline?.length)return;
  const editor=record.editor,positions=(editor.getSelections()||[]).map(selection=>selection.getPosition()),decorations=[];
  for(const item of record.previewInline){
    item.expanded=editor.hasTextFocus()&&positions.some(position=>position.lineNumber===item.range.startLineNumber&&position.column>=item.range.startColumn&&position.column<item.range.endColumn);
    if(!item.expanded)decorations.push({range:item.range,options:{description:'control-image-argument',inlineClassName:'ide-control-source-hidden',inlineClassNameAffectsLetterSpacing:true,lineHeight:2.1,before:{content:'\u00a0',inlineClassName:'ide-control-image-slot',inlineClassNameAffectsLetterSpacing:true,cursorStops:monaco.editor.InjectedTextCursorStops.None},stickiness:monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges}});
    editor.layoutContentWidget(item.widget);
  }
  if(!record.previewDecorations)record.previewDecorations=editor.createDecorationsCollection();record.previewDecorations.set(decorations);
}
function inlinePreview(record,ref,row){
  if(ref.endLine!==ref.line||!Number.isInteger(ref.column)||!Number.isInteger(ref.endColumn)||ref.column<1||ref.endColumn<=ref.column||ref.endColumn>record.model.getLineMaxColumn(ref.line))return false;
  const item={range:new monaco.Range(ref.line,ref.column,ref.line,ref.endColumn),expanded:false};row.classList.add('ide-control-inline');row.title=row.textContent+'\n'+record.model.getValueInRange(item.range)+'\n光标移入参数可编辑源码';
  item.widget={getId:()=>record.id+'-control-'+record.previewToken+'-'+record.previewInline.length,getDomNode:()=>row,suppressMouseDown:true,getPosition:()=>item.expanded?null:{position:{lineNumber:ref.line,column:ref.column},positionAffinity:monaco.editor.PositionAffinity.LeftOfInjectedText,preference:[monaco.editor.ContentWidgetPositionPreference.EXACT]}};
  // Capture the ID now: the array length changes as further occurrences are added.
  const id=item.widget.getId();item.widget.getId=()=>id;record.previewInline.push(item);record.editor.addContentWidget(item.widget);return true;
}
function schedulePreviews(record){clearPreviews(record);if(record.previewEnabled&&record.editor)record.previewTimer=setTimeout(()=>refreshPreviews(record),250);}
function previewImage(value){return typeof value==='string'&&value.length<=16*1024*1024&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)?value:null;}
function openControlImage(record,image,current){
  if(!current())return;record.previewDialog?.remove();
  const dialog=document.createElement('dialog'),close=document.createElement('button'),message=document.createElement('p');dialog.className='ide-control-image-dialog';close.type='button';close.textContent='关闭';message.textContent='正在读取图片…';dialog.append(close,message);document.body.append(dialog);record.previewDialog=dialog;
  const dismiss=()=>{dialog.remove();if(record.previewDialog===dialog)record.previewDialog=null;};close.onclick=dismiss;dialog.addEventListener('close',dismiss,{once:true});dialog.showModal();
  rpc('template_preview',{image,full_size:true}).then(result=>{if(!current()||record.previewDialog!==dialog||!dialog.isConnected)return;const source=previewImage(result.image);if(!source)throw new Error('图片数据无效');const large=document.createElement('img');large.alt='控件模板大图';large.onerror=()=>{if(dialog.isConnected){large.remove();message.textContent='图片加载失败';}};large.src=source;message.textContent='';dialog.append(large);}).catch(()=>{if(current()&&dialog.isConnected)message.textContent='图片加载失败';});
}
async function refreshPreviews(record){
  clearPreviews(record);if(!record.previewEnabled||!record.editor||!record.wrapper?.isConnected)return;
  const token=record.previewToken,editor=record.editor,version=record.model.getVersionId();
  const current=()=>record.previewEnabled&&record.previewToken===token&&record.editor===editor&&!record.model.isDisposed()&&record.model.getVersionId()===version&&record.wrapper?.isConnected;
  previewStatus(record,'正在读取控件引用…');
  try{
    const result=await rpc('editor_control_refs',{code:record.model.getValue()});if(!current())return;
    if(result.error){previewStatus(record,result.error==='syntax'?'语法未完整，继续编辑后刷新':'代码过大，暂不显示预览');return;}
    const grouped=new Map();
    for(const ref of (result.references||[]).slice(0,500)){
      if(!Number.isInteger(ref.line)||ref.line<1||ref.line>record.model.getLineCount())continue;
      const rows=grouped.get(ref.line)||[];rows.push(ref);grouped.set(ref.line,rows);
    }
    editor.changeViewZones(accessor=>{for(const [line,refs] of grouped){
      const zone=document.createElement('div');zone.className='ide-control-zone';
      for(const ref of refs){
        const row=document.createElement('div'),label=document.createElement('span');row.className='ide-control-reference';row.dataset.line=String(line);row.append(label);zone.append(row);
        if(ref.kind==='dynamic'||ref.kind==='unknown'){label.textContent=ref.kind==='dynamic'?'动态引用 · 无法静态预览':'未知引用 · '+String(ref.value);continue;}
        const entries=typeof S==='undefined'?[]:S.controls?.entries||[],aliases=ref.kind==='name'&&typeof S!=='undefined'?(S.project?.selectors||[]).filter(selector=>selector.name===ref.value):[];
        const matches=aliases.length?aliases.flatMap(selector=>selector.library_id?entries.filter(entry=>entry.id===selector.library_id):[{selector}]):entries.filter(entry=>ref.kind==='id'?entry.id===ref.value:entry.selector?.name===ref.value);
        if(matches.length!==1){label.textContent=(matches.length?'控件名称不唯一 · ':'控件不存在 · ')+String(ref.value);continue;}
        const selector=matches[0].selector||{},types={image:'图片',coordinate:'坐标',android_ui:'原生控件'};label.textContent=(selector.name||ref.value)+' · '+(types[selector.kind]||selector.kind||'控件');
        if(selector.kind!=='image')continue;
        const image=selector.image||selector.templates?.[0]?.image,thumbnail=document.createElement('button');thumbnail.type='button';thumbnail.className='ide-control-thumbnail';thumbnail.textContent=image?'正在读取图片…':'未配置模板图片';row.prepend(thumbnail);thumbnail.disabled=true;
        thumbnail.setAttribute('aria-label',(selector.name||ref.value)+' · 查看控件图片');thumbnail.title=(selector.name||ref.value)+' · 点击查看大图';
        inlinePreview(record,ref,row);
        if(image)rpc('template_preview',{image}).then(result=>{if(!current()||!row.isConnected)return;const source=previewImage(result.image);if(!source)throw new Error('图片数据无效');const img=document.createElement('img');img.alt=(selector.name||'控件')+'模板缩略图';img.onerror=()=>{if(current()&&row.isConnected){thumbnail.replaceChildren();thumbnail.textContent='图片加载失败';thumbnail.disabled=true;}};img.src=source;thumbnail.replaceChildren(img);thumbnail.disabled=false;thumbnail.title='查看控件模板大图';thumbnail.onclick=()=>openControlImage(record,image,current);}).catch(()=>{if(current()&&row.isConnected)thumbnail.textContent='图片加载失败';});
      }
      if(zone.children.length)record.previewZones.push(accessor.addZone({afterLineNumber:line,heightInPx:zone.children.length*48+8,domNode:zone,suppressMouseDown:true}));
    }});
    updateInlinePreviews(record);
    previewStatus(record,result.truncated?'引用过多，已截断':grouped.size?'':'没有可预览的控件引用');
  }catch(error){if(current())previewStatus(record,'控件预览失败：'+error.message);}
}
function markdown(contents){if(!contents)return [];return (Array.isArray(contents)?contents:[contents]).map(item=>({value:typeof item==='string'?item:item.language?'```'+item.language+'\n'+item.value+'\n```':item.value||'',isTrusted:false}));}
function lspKind(kind){const names={2:'Method',3:'Function',4:'Constructor',5:'Field',6:'Variable',7:'Class',8:'Interface',9:'Module',10:'Property',14:'Keyword',15:'Snippet',21:'Constant'};return monaco.languages.CompletionItemKind[names[kind]||'Text'];}
function controlSuggestions(model,position){
  const line=model.getLineContent(position.lineNumber).slice(0,position.column-1),match=/(controls\[|controls\.by_id\()(["'])([^"']*)$/.exec(line);if(!match)return null;
  const byId=match[1].includes('by_id'),prefix=match[3],selection=new monaco.Range(position.lineNumber,position.column-prefix.length,position.lineNumber,position.column);
  return {suggestions:S.controls.entries.filter(e=>(byId?e.id:e.selector.name).startsWith(prefix)).map(e=>({label:e.selector.name,detail:byId?e.id:'控件参数',kind:monaco.languages.CompletionItemKind.Variable,insertText:byId?e.id:e.selector.name,range:selection}))};
}
monaco.languages.registerCompletionItemProvider('python',{triggerCharacters:['.','"',"'",'['],async provideCompletionItems(model,position){
  const record=byModel.get(model);if(!record||record.node?.disabled||record.node?.readOnly)return {suggestions:[]};
  const controls=controlSuggestions(model,position);if(controls)return controls;
  const context=PythonCompletion.context(model.getValue(),model.getOffsetAt(position));
  if(context){const existingCall=/^\s*\(/.test(model.getValue().slice(context.end));return {suggestions:PythonCompletion.suggestions(context.prefix).map(item=>({label:item.name,detail:'window.'+item.signature,documentation:{value:item.description},kind:monaco.languages.CompletionItemKind.Method,insertText:item.name+(existingCall?'':item.hasArguments?'(${1})':'()'),insertTextRules:monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,range:range({start:{line:position.lineNumber-1,character:context.start-model.getOffsetAt({lineNumber:position.lineNumber,column:1})},end:{line:position.lineNumber-1,character:context.end-model.getOffsetAt({lineNumber:position.lineNumber,column:1})}})}))};}
  const result=await query(record,'completion',position),word=model.getWordUntilPosition(position);
  return {incomplete:result?.isIncomplete,suggestions:(result?.items||[]).map(item=>({label:item.label,detail:item.detail||'',documentation:markdown(item.documentation)[0],kind:lspKind(item.kind),insertText:item.textEdit?.newText||item.insertText||item.label,insertTextRules:item.insertTextFormat===2?monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet:undefined,range:item.textEdit?.range?range(item.textEdit.range):new monaco.Range(position.lineNumber,word.startColumn,position.lineNumber,word.endColumn),additionalTextEdits:item.additionalTextEdits?.map(edit=>({range:range(edit.range),text:edit.newText})),sortText:item.sortText,filterText:item.filterText}))};
}});
monaco.languages.registerSignatureHelpProvider('python',{signatureHelpTriggerCharacters:['(',','],signatureHelpRetriggerCharacters:[','],async provideSignatureHelp(model,position){const record=byModel.get(model);if(!record)return null;const data=await query(record,'signature',position);if(!data?.signatures?.length)return null;return {value:{signatures:data.signatures.map(s=>({...s,documentation:markdown(s.documentation)[0],parameters:(s.parameters||[]).map(p=>({...p,documentation:markdown(p.documentation)[0]}))})),activeSignature:data.activeSignature||0,activeParameter:data.activeParameter||0},dispose(){}};}});
monaco.languages.registerHoverProvider('python',{async provideHover(model,position){const record=byModel.get(model);if(!record)return null;const data=await query(record,'hover',position);return data?{contents:markdown(data.contents),range:data.range?range(data.range):undefined}:null;}});
async function locations(model,position,kind){const record=byModel.get(model);if(!record)return [];const result=await query(record,kind,position)||[];return result.map(item=>{if(item.uri===record.id)return {uri:model.uri,range:range(item.range)};let external=externalModels.get(item.uri);if(!external){if(externalModels.size>=20){const [key,old]=externalModels.entries().next().value;old.dispose();externalModels.delete(key);}external=monaco.editor.createModel(item.text||'','python',monaco.Uri.parse('echo-definition://library/'+encodeURIComponent(item.uri)));externalModels.set(item.uri,external);}return {uri:external.uri,range:range(item.range)};});}
monaco.languages.registerDefinitionProvider('python',{provideDefinition:(model,position)=>locations(model,position,'definition')});
monaco.languages.registerReferenceProvider('python',{provideReferences:(model,position)=>locations(model,position,'references')});
monaco.languages.registerDocumentFormattingEditProvider('python',{async provideDocumentFormattingEdits(model){const record=byModel.get(model);if(!record||record.node?.disabled||record.node?.readOnly)return [];const version=model.getVersionId();try{const result=await rpc('editor_format',{code:model.getValue()});if(version!==model.getVersionId())return [];return [{range:model.getFullModelRange(),text:result.code}];}catch(error){status(record,error.message);return [];}}});

function positionStatus(record){const position=record.editor?.getPosition();if(!position)return;const node=record.wrapper.querySelector('.ide-cursor-status');if(node)node.textContent=`行 ${position.lineNumber}，列 ${position.column} · 空格: 4 · Python`;const value=record.model.getValue();record.node.setSelectionRangeNative?.(record.model.getOffsetAt(record.editor.getSelection().getStartPosition()),record.model.getOffsetAt(record.editor.getSelection().getEndPosition()));if(record.node.id==='case-python-code')S.pythonSelection=[record.node.selectionStart,record.node.selectionEnd];const count=document.querySelector('.python-case-main>.section-toolbar>span');if(count)count.textContent=value.split('\n').length+' 行 Python';}
function showProblems(record){const node=record.wrapper?.querySelector('.ide-problem-list');if(!node)return;node.replaceChildren();for(const diagnostic of (record.diagnostics||[]).slice(0,50)){const button=document.createElement('button');button.type='button';button.className='ide-problem';button.textContent=`${diagnostic.severity===1?'错误':'提示'} · 第 ${diagnostic.range.start.line+1} 行：${diagnostic.message}`;button.onclick=()=>{record.editor.setPosition({lineNumber:diagnostic.range.start.line+1,column:diagnostic.range.start.character+1});record.editor.revealLineInCenter(diagnostic.range.start.line+1);record.editor.focus();};node.append(button);}const summary=record.wrapper.querySelector('.ide-problems summary');summary.textContent=record.diagnostics?.length?`问题 (${record.diagnostics.length})`:'问题 (0)';}
function createRecord(owner,node){
  const id='python-'+sessionId+'-'+(++serial),model=monaco.editor.createModel(node.value,'python',monaco.Uri.parse('inmemory://echotest/'+id+'.py'));
  const record={id,model,owner,node,diagnostics:[],status:'正在准备 Python 检查…'};records.set(id,record);byModel.set(model,record);owners.set(owner,record);
  model.onDidChangeContent(()=>{const textarea=record.node;if(textarea?.isConnected){textarea.value=model.getValue();textarea.dispatchEvent(new Event('input',{bubbles:true}));positionStatus(record);}schedule(record);});
  return record;
}
function mount(container=document){
  for(const node of container.querySelectorAll('textarea.python-editor:not(.ide-source)')){
    if(typeof S==='undefined')continue;const owner=ownerFor(node);if(!owner)continue;
    let record=owners.get(owner);if(!record||record.model.isDisposed())record=createRecord(owner,node);
    if(record.editor)detach(record.wrapper);
    // Disabled state belongs to a textarea instance; a rerender supplies its own state.
    if(record.node!==node){record.stateDisabled=false;record.previousDisabled=false;}
    record.node=node;
    if(record.model.getValue()!==node.value)record.model.setValue(node.value);
    const wrapper=record.wrapper=document.createElement('div');wrapper.className='python-ide '+(node.id==='case-python-code'?'ide-case':node.id==='generated-python-code'?'ide-preview':node.id==='script-code'?'ide-dialog':'ide-inline');wrapper.dataset.editorId=record.id;
    wrapper.innerHTML='<div class="ide-toolbar"><span class="ide-file-label">Python</span><span class="ide-editor-tools"></span></div><div class="ide-surface"></div><div class="ide-status"><span class="ide-service-status"></span><span class="ide-cursor-status"></span></div><details class="ide-problems"><summary>问题 (0)</summary><div class="ide-problem-list"></div></details>';
    node.replaceWith(wrapper);wrapper.append(node);node.classList.add('ide-source');node.hidden=true;node.setAttribute('aria-hidden','true');node.tabIndex=-1;
    const editor=record.editor=monaco.editor.create(wrapper.querySelector('.ide-surface'),{model:record.model,theme:'echo-light',automaticLayout:true,fontFamily:"'Cascadia Code', Consolas, 'Microsoft YaHei UI', monospace",fontSize:13,lineHeight:23,tabSize:4,insertSpaces:true,minimap:{enabled:false},scrollBeyondLastLine:false,padding:{top:14,bottom:14},lineNumbers:'on',glyphMargin:false,folding:true,renderLineHighlight:'line',bracketPairColorization:{enabled:true},guides:{indentation:true,bracketPairs:true},autoIndent:'full',wordWrap:'off',readOnly:node.disabled||node.readOnly,domReadOnly:node.disabled||node.readOnly,ariaLabel:node.getAttribute('aria-label')||'Python 编辑器',fixedOverflowWidgets:false,quickSuggestions:{other:true,comments:false,strings:false},suggest:{showWords:true},unicodeHighlight:{ambiguousCharacters:false,invisibleCharacters:false},contextmenu:true,links:false});
    // Keep the existing form/input handlers as the source of project updates.
    node.setSelectionRangeNative=node.setSelectionRange.bind(node);
    node.focus=()=>editor.focus();
    node.setSelectionRange=(start,end)=>{node.setSelectionRangeNative(start,end);const a=record.model.getPositionAt(start),b=record.model.getPositionAt(end);editor.setSelection(new monaco.Selection(a.lineNumber,a.column,b.lineNumber,b.column));};
    node.setRangeText=(text,start,end)=>{const a=record.model.getPositionAt(start),b=record.model.getPositionAt(end);editor.executeEdits('control-reference',[{range:new monaco.Range(a.lineNumber,a.column,b.lineNumber,b.column),text,forceMoveMarkers:true}]);const p=record.model.getPositionAt(start+text.length);editor.setPosition(p);};
    node.addEventListener('input',()=>{if(record.model.getValue()!==node.value)record.model.setValue(node.value);});
    editor.onDidChangeCursorSelection(()=>{positionStatus(record);updateInlinePreviews(record);});
    editor.onDidFocusEditorText(()=>updateInlinePreviews(record));editor.onDidBlurEditorText(()=>updateInlinePreviews(record));
    const tools=wrapper.querySelector('.ide-editor-tools'),previewButton=document.createElement('button'),previewHint=document.createElement('span');
    previewButton.type='button';previewButton.className='ide-controls-toggle';previewButton.textContent='控件预览';previewButton.setAttribute('aria-pressed',String(!!record.previewEnabled));previewButton.onclick=()=>{record.previewEnabled=!record.previewEnabled;previewButton.setAttribute('aria-pressed',String(record.previewEnabled));if(record.previewEnabled)refreshPreviews(record);else{clearPreviews(record);previewStatus(record,'');}};tools.append(previewButton);
    previewHint.className='ide-controls-status';previewHint.setAttribute('aria-live','polite');wrapper.querySelector('.ide-status').prepend(previewHint);
    for(const [label,action,disabled] of [['格式化','editor.action.formatDocument',node.readOnly||node.disabled],['查找','actions.find',false],['替换','editor.action.startFindReplaceAction',node.readOnly||node.disabled],['定义','editor.action.peekDefinition',false]]){const button=document.createElement('button');button.type='button';button.textContent=label;button.disabled=disabled;button.onclick=()=>{editor.focus();const registered=editor.getAction(action);if(registered)registered.run().catch(error=>status(record,error.message));else editor.trigger('toolbar',action,{});};tools.append(button);}
    editor.addAction({id:'echo.format',label:'格式化 Python',keybindings:[monaco.KeyMod.CtrlCmd|monaco.KeyMod.Alt|monaco.KeyCode.KeyL],run:()=>node.disabled||node.readOnly?undefined:editor.getAction('editor.action.formatDocument').run()});
    editor.addAction({id:'echo.definition',label:'查看定义',keybindings:[monaco.KeyMod.CtrlCmd|monaco.KeyCode.KeyB],run:()=>editor.trigger('keyboard','editor.action.peekDefinition',{})});
    editor.addAction({id:'echo.stop',label:'停止执行',keybindings:[monaco.KeyCode.F12],run:()=>rpc('stop',{}).catch(error=>status(record,error.message))});
    editor.addAction({id:'echo.save',label:'保存用例',keybindings:[monaco.KeyMod.CtrlCmd|monaco.KeyCode.KeyS],run:()=>handleAction(S.modal?.kind==='script'?'script-apply':'save',{dataset:{}}).catch(error=>toast(error.message,'error'))});
    if(record.view)editor.restoreViewState(record.view);positionStatus(record);status(record,record.status);showProblems(record);schedule(record);
    if(record.wasFocused&&!node.disabled&&!node.readOnly&&!document.querySelector('#modal')?.open)queueMicrotask(()=>{if(record.editor===editor)editor.focus();});
  }
  for(const record of [...records.values()])if(records.size>12&&!record.wrapper?.isConnected){clearTimeout(record.timer);clearPreviews(record);record.editor?.dispose();record.model.dispose();byModel.delete(record.model);records.delete(record.id);rpc('editor_close',{id:record.id}).catch(()=>{});}
  refreshLocks();
}
function detach(container){for(const record of records.values())if(record.editor&&(record.wrapper===container||container?.contains(record.wrapper))){record.wasFocused=record.editor.hasTextFocus();record.view=record.editor.saveViewState();clearPreviews(record);record.previewDecorations=null;record.editor.dispose();record.editor=null;}}
function refreshLocks(){if(typeof S==='undefined')return;for(const record of records.values()){if(!record.editor)continue;const node=record.node,blocked=!!disabled();if(blocked&&!record.stateDisabled){record.previousDisabled=node.disabled;record.stateDisabled=true;node.disabled=true;}else if(!blocked&&record.stateDisabled){node.disabled=record.previousDisabled;record.stateDisabled=false;}const readOnly=node.disabled||node.readOnly;record.editor.updateOptions({readOnly,domReadOnly:readOnly});for(const button of record.wrapper.querySelectorAll('.ide-editor-tools button'))if(['格式化','替换'].includes(button.textContent)&&button.disabled!==readOnly)button.disabled=readOnly;}}
let scheduled=false;new MutationObserver(changes=>{const selector='textarea.python-editor:not(.ide-source)';if(!changes.some(change=>change.type==='attributes'&&change.target.matches?.('textarea.ide-source')||[...change.addedNodes].some(node=>node.nodeType===1&&(node.matches?.(selector)||node.querySelector?.(selector)))))return;if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;for(const record of records.values())if(record.editor&&!record.wrapper.isConnected)detach(record.wrapper);mount();});}).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','readonly']});
window.studio.onEvent(event=>{if(event.kind!=='python_diagnostics')return;const record=records.get(event.id);if(!record||record.model.getVersionId()!==event.version)return;record.diagnostics=event.diagnostics;monaco.editor.setModelMarkers(record.model,'python',event.diagnostics.map(d=>({severity:d.severity===1?monaco.MarkerSeverity.Error:d.severity===2?monaco.MarkerSeverity.Warning:monaco.MarkerSeverity.Info,message:d.message,...{startLineNumber:d.range.start.line+1,startColumn:d.range.start.character+1,endLineNumber:d.range.end.line+1,endColumn:Math.max(d.range.end.character+1,d.range.start.character+2)}})));showProblems(record);status(record,event.diagnostics.length?`${event.diagnostics.length} 个问题`:'检查通过');});
globalThis.PythonIde={mount,detach,refreshPreviews(){for(const record of records.values())schedulePreviews(record);},editorFor(selector){const node=typeof selector==='string'?document.querySelector(selector):selector;return [...records.values()].find(record=>record.node===node)?.editor;},recordFor(selector){const node=typeof selector==='string'?document.querySelector(selector):selector;return [...records.values()].find(record=>record.node===node);},monaco};
window.addEventListener('beforeunload',()=>{for(const record of records.values()){clearTimeout(record.timer);clearPreviews(record);rpc('editor_close',{id:record.id}).catch(()=>{});record.editor?.dispose();record.model.dispose();}for(const model of externalModels.values())model.dispose();});
