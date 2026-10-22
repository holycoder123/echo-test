'use strict';

function caseGroupBounds(steps,index){
  const kind=steps[index]?.action;
  if(kind==='loop'){
    let depth=0;for(let i=index;i<steps.length;i++){
      if(steps[i].action==='loop')depth++;
      if(steps[i].action==='end_loop'&&!--depth)return [index,i];
    }
  }else if(kind==='end_loop'){
    let depth=0;for(let i=index;i>=0;i--){
      if(steps[i].action==='end_loop')depth++;
      if(steps[i].action==='loop'&&!--depth)return [i,index];
    }
  }
  return [index,index];
}
function moveCaseGroup(from,to){
  const steps=S.project.steps,[start,end]=caseGroupBounds(steps,from);
  if(to>=start&&to<=end)return false;
  const group=steps.splice(start,end-start+1);
  const destination=to>start?to-group.length+1:to;
  steps.splice(destination,0,...group);S.selected=destination;return true;
}
function caseStepDepths(){
  let depth=0;return S.project.steps.map(step=>{
    if(step.action==='end_loop')depth=Math.max(0,depth-1);
    const value=depth;if(step.action==='loop')depth++;return value;
  });
}
function pythonControlReference(target){
  return target.library_id?`controls.by_id(${JSON.stringify(target.library_id)})`:`controls[${JSON.stringify(target.name)}]`;
}
function caseModeBar(){
  const python=S.project.mode==='python';
  return `<div class="case-mode-bar"><div class="mode-label">${icon(python?'python':'cases')}<strong>${python?'Python 模式':'低代码模式'}</strong><span>${python?'编写代码，使用共享控件作为参数':'编排操作、循环与变量'}</span></div><div class="mode-actions">${python?S.modeSource?button('返回低代码原稿','mode-source','ghost','',disabled()):'':button('预览 Python','mode-preview','ghost','python',disabled())+button('创建 Python 副本','mode-copy','', '',disabled())}${button(python?'新建低代码用例':'新建 Python 用例',python?'mode-new-lowcode':'mode-new-python','ghost','plus',disabled())}</div></div>`;
}
function pythonControlPanel(){
  const query=(S.pythonControlSearch||'').trim().toLocaleLowerCase();
  const entries=S.controls.entries.filter(entry=>[entry.selector.name,entry.selector.text||'',categoryName(entry.category_id)].join(' ').toLocaleLowerCase().includes(query));
  return `<div class="inspector-head"><span>控件参数</span><small>${entries.length} 个</small></div><div class="search python-control-search"><input id="python-control-search" type="search" placeholder="搜索控件名称 / 分类" value="${esc(S.pythonControlSearch||'')}" aria-label="搜索 Python 控件" ${disabled()}></div><p class="field-help">选中控件可预览并插入引用。引用可作为 window 操作或自定义函数的参数。</p><div class="python-control-list">${entries.map(entry=>{
    const target=entry.selector;
    return `<button class="python-control-card ${S.pythonControlSelected===entry.id?'active':''}" data-act="mode-control" data-id="${esc(entry.id)}" ${disabled()}>${controlImage(target)?controlImageSlot(controlImage(target),target.name):icon(target.kind==='image'?'image':'coordinate')}<span><strong>${esc(target.name)}</strong><small>${esc(controlKind(target))} · ${esc(categoryName(entry.category_id))}</small></span></button>`;
  }).join('')||'<div class="empty compact">没有匹配控件，可在通用控件库中添加。</div>'}</div>${pythonControlDetail()}`;
}
function pythonControlDetail(){
  const target=S.controls.entries.find(entry=>entry.id===S.pythonControlSelected)?.selector;
  if(!target)return '';
  return `<div class="python-control-detail">${controlImage(target)?controlImageSlot(controlImage(target),target.name):''}<strong>${esc(target.name)}</strong><code>${esc(pythonControlReference(target))}</code>${button('插入控件引用','mode-insert-control','primary','plus',disabled())}<p class="field-help">在光标处插入；共享控件改名后仍按 ID 引用。</p></div>`;
}
function pythonCaseView(){
  return `<div class="case-layout python-case-layout"><div class="python-case-main"><div class="section-toolbar"><span>${(S.project.code||'').split('\n').length} 行 Python</span><div class="right"><span>用例循环</span>${input(S.iterations,'id="iterations"','number','class="tiny-number" min="1" max="1000"')}${button('导入 .py','mode-import','ghost','upload',disabled())}</div></div><textarea id="case-python-code" class="python-editor case-python-code" spellcheck="false" aria-label="Python 用例代码" ${disabled()}>${esc(S.project.code||'')}</textarea><p class="field-help">window 操作目标窗口 · controls 引用控件 · variables 保存变量 · print 输出进入报告 · window. 函数补全 · Ctrl+Space 提示 · Tab 缩进 · F12 停止</p></div><aside class="inspector python-case-inspector">${field('用例执行超时 · 秒',input(S.project.script_timeout??600,'data-project-timeout','number','min="0.1" max="600" step="1"'))}<div id="python-controls">${pythonControlPanel()}</div></aside></div>`;
}
async function createPythonCopy(){
  if(lock())return;
  const original=S.project,snapshot=JSON.stringify(original),data=await api('python_copy',{project:original});
  if(lock()||S.project!==original)return;
  if(JSON.stringify(original)!==snapshot){toast('用例已变化，请重新创建 Python 副本');return;}
  const source={project:clone(original),path:S.path,baseDir:S.baseDir,dirty:S.dirty,selected:S.selected,libraryOpen:S.libraryOpen};
  await api('case_context',{path:null});
  if(S.modal?.kind==='python-preview')closeModal();
  S.modeSource=source;S.project=data.project;S.path=null;S.selected=0;S.stepStatus={};S.pythonControlSelected='';
  S.pythonSelection=null;
  S.libraryOpen=false;
  dirty();render();toast('已创建独立 Python 副本；低代码原稿保留在本次编辑中','success');
}
async function caseModeAction(action,node){
  if(!action.startsWith('mode-'))return false;
  if(lock())return true;
  if(action==='mode-copy'){await createPythonCopy();return true;}
  if(action==='mode-preview'){
    const project=S.project,data=await api('generate_python',{project});
    if(lock()||S.project!==project)return true;
    showModal({kind:'python-preview',code:data.code});return true;
  }
  if(action==='mode-new-python'||action==='mode-new-lowcode'){
    if(!await canReplace())return true;
    setProject(await api('new_project'));S.modeSource=null;
    if(action==='mode-new-python'){
      Object.assign(S.project,{mode:'python',name:'未命名 Python 用例',code:'# 从右侧选择控件并插入引用\nprint("目标应用尺寸：", window.size())\n',script_timeout:600});dirty();
      S.libraryOpen=false;
    }
    S.view='cases';render();return true;
  }
  if(action==='mode-source'){
    if(!S.modeSource||!await canReplace())return true;
    const source=S.modeSource;await api('case_context',{path:source.path,base_dir:source.baseDir});
    S.project=source.project;S.path=source.path;S.baseDir=source.baseDir;S.selected=source.selected;S.dirty=source.dirty;S.libraryOpen=source.libraryOpen;S.modeSource=null;S.stepStatus={};
    await api('dirty',{value:S.dirty,caseName:S.project.name});render();return true;
  }
  if(action==='mode-control'){
    S.pythonControlSelected=node.dataset.id;const panel=document.querySelector('#python-controls');
    panel.innerHTML=pythonControlPanel();
    const target=S.controls.entries.find(entry=>entry.id===node.dataset.id)?.selector;
    if(target)await thumbnail(controlImage(target));return true;
  }
  if(action==='mode-insert-control'){
    const target=S.controls.entries.find(entry=>entry.id===S.pythonControlSelected)?.selector;
    if(!target)return true;useControl(target.name);
    const editor=document.querySelector('#case-python-code'),range=S.pythonSelection||[editor.selectionStart,editor.selectionEnd];
    editor.focus();editor.setSelectionRange(...range);editor.setRangeText(pythonControlReference(target),...range,'end');
    S.project.code=editor.value;S.pythonSelection=[editor.selectionStart,editor.selectionEnd];dirty();return true;
  }
  if(action==='mode-import'){
    const project=S.project,data=await api('script_import');if(!data||lock()||S.project!==project)return true;
    if(project.code?.trim()&&!await confirm('替换当前 Python 代码？','导入只替换当前编辑内容，保存后写入用例。'))return true;
    project.code=data.code;dirty();render();return true;
  }
  return true;
}
function caseModeInput(event){
  const node=event.target;
  if(node.id==='python-control-search'){
    if(disabled())return true;S.pythonControlSearch=node.value;
    const start=node.selectionStart;document.querySelector('#python-controls').innerHTML=pythonControlPanel();
    const next=document.querySelector('#python-control-search');next.focus();next.setSelectionRange(start,start);return true;
  }
  if(node.id==='case-python-code'||node.hasAttribute('data-project-timeout')){
    if(disabled())return true;
    if(node.id==='case-python-code'){S.project.code=node.value;S.pythonSelection=[node.selectionStart,node.selectionEnd];}
    else S.project.script_timeout=Number(node.value);dirty();return true;
  }
  return false;
}
