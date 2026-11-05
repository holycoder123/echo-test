'use strict';
const WB_DRAFT_KEY='echo-test.workbench.draft.v1';
function initializeWorkbench(){
  S.wb={stepOrder:'asc',selection:[],recordContext:null,converting:false,undoRecording:null,previewRequest:null,failure:null,draftReady:false,draftStatus:'',recovery:null,runOpen:true,range:null};
  try{S.wb.recovery=WorkbenchModel.parseDraft(localStorage.getItem(WB_DRAFT_KEY));}catch{S.wb.draftStatus='草稿存储不可用，请及时保存用例';}
}
function persistWorkbenchDraft(){
  if(S.wb?.undoRecording&&JSON.stringify(S.project)!==S.wb.undoRecording.after)S.wb.undoRecording=null;
  if(!S.wb?.draftReady||S.wb.recovery||!S.dirty)return;
  try{
    const text=JSON.stringify({version:1,project:S.project,path:S.path||null,baseDir:S.baseDir||'',selected:S.selected,at:new Date().toISOString()});
    if(text.length>4*1024*1024)throw new Error('草稿过大');
    localStorage.setItem(WB_DRAFT_KEY,text);S.wb.draftStatus='草稿已在本机恢复点保存';
  }catch{S.wb.draftStatus='草稿未能自动保存，请使用 Ctrl+S 保存';}
  const node=document.querySelector('#wb-draft-status');if(node)node.textContent=S.wb.draftStatus;
}
function clearWorkbenchDraft(force=false){if(S.wb?.recovery&&!force)return;try{localStorage.removeItem(WB_DRAFT_KEY);}catch{}if(S.wb){S.wb.recovery=null;S.wb.draftStatus='';}}
function workbenchReset(){if(!S.wb)return;S.wb.selection=[];S.wb.previewRequest=null;S.wb.failure=null;S.wb.failureStep=null;S.wb.failureImage=null;S.wb.range=null;S.wb.undoRecording=null;}
function workbenchHint(){
  if(S.wb.converting)return `<div class="wb-hint"><span>正在整理录制并保存草稿，请稍候…</span></div>`;
  if(S.busy==='recording')return `<div class="wb-hint recording"><i class="status-dot red"></i><span id="wb-record-status">${S.recordStarting?'正在启动监听，请稍候…':'正在录制目标窗口 · '+S.recordCount+' 个事件'} · <kbd>F12</kbd> 停止</span>${button('停止录制','stop','record','stop')}</div>`;
  if(S.busy==='running')return `<div class="wb-hint"><i class="status-dot green"></i><span>${S.wb.range?`正在试跑第 ${S.wb.range.start+1}–${S.wb.range.end+1} 步`:'用例执行中'} · <kbd>F12</kbd> 停止</span>${button('停止执行','stop','','stop')}</div>`;
  if(S.wb.recovery)return `<div class="wb-hint recovery"><span>${icon('history')}发现未保存草稿「${esc(S.wb.recovery.project.name)}」 · ${esc(dateLabel(S.wb.recovery.at))}</span>${button('恢复草稿','wb-restore','primary')}${button('丢弃恢复点','wb-dismiss-draft','ghost')}</div>`;
  if(S.wb.undoRecording)return `<div class="wb-hint"><span>${icon('check')}录制已加入草稿 · ${S.wb.undoRecording.count} 个步骤，可继续添加验证或试跑。</span>${button('撤销本次录制','wb-undo-recording','ghost','history')}</div>`;
  const hasChecks=S.project.steps.some(step=>['assert_image','assert_absent','wait_image','assert_ui','assert_ui_absent'].includes(step.action));
  if(!hasTarget())return `<div class="wb-hint"><span>先连接游戏窗口，再录制操作或采集验证目标。</span>${button('连接目标','view-select-window','primary','game')}</div>`;
  if(!S.project.steps.length&&S.project.mode!=='python')return `<div class="wb-hint"><span>从打开背包或商城开始，录制一段操作。</span>${button('开始录制','wb-record','record','record')}</div>`;
  if(!hasChecks&&S.project.mode!=='python')return `<div class="wb-hint"><span>操作步骤已就绪，为关键结果添加一个验证。</span>${button('添加验证','wb-assert','primary','check')}</div>`;
  return `<div class="wb-hint subtle"><span>试跑前恢复游戏初始状态。选中步骤可预览定位或局部运行。</span><small>${esc(S.wb.draftStatus|| (S.dirty?'尚未保存':'用例已保存'))}</small></div>`;
}
function workbenchLibrary(){
  const q=S.caseSearch.toLocaleLowerCase(),items=S.library.filter(row=>(row.name+' '+row.location).toLocaleLowerCase().includes(q));
  return `<aside class="wb-projects" aria-label="项目用例"><div class="wb-projects-title"><strong>本地用例</strong><button class="icon-button" data-act="case-refresh" title="刷新用例">${icon('refresh')}</button></div><input type="search" id="wb-case-search" value="${esc(S.caseSearch)}" placeholder="搜索用例" aria-label="搜索本地用例">${items.map(row=>`<button class="wb-case ${row.path===S.path?'active':''}" data-act="case-open" data-path="${esc(row.path)}" title="${esc(row.location)}" ${row.error||disabled()?'disabled':''}>${icon('cases')}<span>${esc(row.name)}<small>${row.steps} 个步骤</small></span></button>`).join('')||'<p class="field-help">保存的用例会显示在这里。</p>'}<div class="wb-project-actions">${button('新建用例','new','ghost','plus',disabled())}${button('打开本地用例','open','ghost','folder',disabled())}</div></aside>`;
}
function caseView(){
  return `<div class="wb-workspace"><div class="wb-target"><i class="status-dot ${hasTarget()?'green':''}"></i><span>${esc(S.android.connection?.model||S.connection?.title||'尚未连接目标')}</span>${S.connection?`<small>${S.connection.width} × ${S.connection.height}</small>`:''}<small id="wb-draft-status" role="status">${esc(S.wb.draftStatus)}</small><span class="wb-beta">1.2.1-beta</span></div>${workbenchHint()}<div class="wb-layout">${workbenchLibrary()}<div class="wb-editor">${legacyCaseView()}${workbenchRunView()}</div></div></div>`;
}
function workbenchStepOrderTools(){
  const descending=S.wb.stepOrder==='desc';
  return `<div class="wb-step-order" role="group" aria-label="步骤显示顺序" title="按步骤序号排序，仅改变显示顺序，执行顺序不变"><button type="button" data-act="wb-step-order" data-order="asc" aria-pressed="${!descending}" class="${descending?'':'active'}">升序 ↑</button><button type="button" data-act="wb-step-order" data-order="desc" aria-pressed="${descending}" class="${descending?'active':''}">降序 ↓</button></div>`;
}
function workbenchStepRows(depths){
  const rows=S.project.steps.map((step,index)=>stepRow(step,index,depths[index]));
  if(S.wb.stepOrder==='desc')rows.reverse();
  return rows.join('');
}
function workbenchStepTools(){
  if(S.project.mode==='python')return '';
  return `<div class="wb-step-tools" aria-label="步骤调试"><span>调试步骤</span>${button('执行本步','wb-run-step','ghost','play',disabled())}${button('选中片段','wb-run-selection','ghost','play',disabled())}${button('在此后录制','wb-record-after','ghost','record',disabled())}<details><summary>更多运行方式</summary><div>${button('运行到这里','wb-run-to','ghost','play',disabled())}${button('从这里运行','wb-run-from','ghost','play',disabled())}</div></details></div>`;
}
function workbenchInspectorView(){
  const step=S.project.steps[S.selected],target=step&&S.project.selectors.find(t=>t.name===step.target);
  return `${step?workbenchStepTools():''}${workbenchFailureView()}${target?`<section class="wb-target-detail"><div><strong>目标检查</strong>${button('预览定位','wb-preview','ghost','search',disabled())}</div><p>${esc(target.name)} · ${esc(controlKind(target))}</p>${target.kind==='image'?controlImageSlot(controlImage(target),target.name):''}<div class="wb-target-actions">${button('重新采集副本','wb-recapture','ghost','screenshot',disabled())}${button('高级设置','wb-edit-target','ghost','settings',disabled())}</div><small>重新采集仅替换本步引用；共享原控件保持不变。</small></section>`:''}${inspectorView()}`;
}
function workbenchFailureView(){
  const failure=S.wb.failure;if(!failure||S.project.steps[S.selected]!==S.wb.failureStep)return '';
  const details=Object.entries(failure.recognition||{});
  return `<section class="wb-failure" role="region" aria-label="失败修复"><strong>第 ${failure.index+1} 步失败 · ${esc(failure.name)}</strong><p>${esc(failure.error)}</p>${S.wb.failureImage?`<img src="${esc(S.wb.failureImage)}" alt="本次失败时的目标画面">`:''}${details.map(([name,d])=>`<div><b>${esc(name)}</b><p>${esc(d.reason||'识别未通过')}${d.candidate?.score!=null?` · 最佳分数 ${Number(d.candidate.score).toFixed(3)}`:''}${d.threshold!=null?` · 阈值 ${d.threshold}`:''}</p>${d.roi?`<small>搜索范围 ${esc(d.roi.join(', '))}</small>`:''}</div>`).join('')}<div class="wb-target-actions">${button('预览当前定位','wb-preview','ghost','search',disabled())}${button('重跑本步','wb-run-step','','play',disabled())}</div>${S.lastResult?.id?button('完整报告','open-report','ghost','history',`data-id="${esc(S.lastResult.id)}"`):''}<small>画面属于本次失败现场；修复后先预览，再试跑。</small></section>`;
}
function workbenchRunView(){
  return `<details class="wb-run-drawer" ${S.wb.runOpen?'open':''}><summary>本次运行 <span>${esc(S.wb.range?`局部试跑 · 第 ${S.wb.range.start+1}–${S.wb.range.end+1} 步`:S.runState?.case||'尚未运行')}</span></summary><section id="wb-run-results" aria-label="当前用例运行状态">${RunPanel.html(S.runState)}</section></details>`;
}
async function workbenchPreview(key='target'){
  if(lock())return;if(!hasTarget())throw new Error('请先连接目标窗口');
  const step=S.project.steps[S.selected],p=step?.params?.[positionField(key)],target=p?{...defaultSelector(),...p,name:key==='end_target'?'拖动终点位置':'本步位置'}:S.project.selectors.find(t=>t.name===step?.[key]);
  if(!target)throw new Error('请先选择带有目标控件的步骤');
  const project=S.project,view=S.view,previousModal=S.modal,request={};
  S.wb.previewRequest=request;
  try{
    const shot=await api('preview',{...targetArgs(),selector:target,selectors:project.selectors});
    if(S.wb.previewRequest!==request||S.project!==project||S.project.steps[S.selected]!==step||S.view!==view||S.modal!==previousModal)return;
    showModal({kind:'preview',shot,at:new Date().toISOString()});
  }finally{if(S.wb.previewRequest===request)S.wb.previewRequest=null;}
}
async function workbenchStartRecord(after=false){
  if(lock())return;if(S.project.mode==='python'){toast('Python 用例可通过「录制」页创建独立低代码用例');S.view='record';render();return;}
  if(S.recordPending){S.view='record';render();toast('请先处理上一段录制');return;}
  S.wb.recordContext={project:S.project,index:after&&S.project.steps.length?caseGroupBounds(S.project.steps,S.selected)[1]+1:S.project.steps.length,before:clone(S.project),path:S.path};
  try{await startRecord();}catch(error){S.wb.recordContext=null;throw error;}
}
async function workbenchAcceptRecording(event){
  S.busy='';S.recordStarting=false;
  const ctx=S.wb.recordContext;S.wb.recordContext=null;
  if(!ctx||ctx.project!==S.project||!event.project?.steps?.length){S.recordPending=event;S.view='record';render();return;}
  S.wb.converting=true;
  render();
  try{
    const imported=await api('control_import',{project:event.project,category_id:''});
    if(S.project!==ctx.project)throw new Error('当前用例已切换，录制保留在录制结果页');
    setControls(imported.controls);for(const t of imported.project.selectors)useControl(t.name);
    const steps=imported.project.steps;S.project.steps.splice(ctx.index,0,...steps);S.selected=ctx.index;S.wb.selection=steps.map((_,i)=>ctx.index+i);S.stepStatus={};S.view='cases';
    S.wb.undoRecording={before:ctx.before,after:JSON.stringify(S.project),count:steps.length};
    dirty();S.recordPending=null;try{await api('record_reviewed');}catch(error){log('录制已加入草稿，录制确认未完成：'+error.message,'error');}render();
  }catch(error){S.recordPending=event;S.view='record';render();toast('录制已保留，请重试转换：'+error.message,'error');}
  finally{S.wb.converting=false;render();}
}
async function workbenchCaptureVerification(action='assert_image',repair=false){
  if(lock())return;if(!hasTarget())throw new Error('请先连接目标窗口');
  if(S.project.mode==='python')throw new Error('请在低代码用例中添加验证，Python 可引用已采集控件');
  const step=repair?S.project.steps[S.selected]:null;
  if(repair&&!step?.target&&!step?.params?.position)throw new Error('当前步骤没有操作目标');
  const old=step&&S.project.selectors.find(t=>t.name===step.target);
  const draft={...defaultSelector(),kind:'image',name:repair?`${old?.name||'目标'} · 修复副本`:'背包标题'};
  const project=S.project,index=S.selected;
  const shot=await api('capture',targetArgs());
  if(S.project!==project)return;
  showModal({kind:'picker',shot,selection:null,returnModal:{kind:'selector',index:null,draft,workbench:{action,repair,project,step,index},categoryId:''}});
}
function workbenchVerificationFields(m){
  return `${m.workbench.repair?'':field('验证方式',`<select id="wb-assert-action">${options([['assert_image','应该出现'],['assert_absent','应该消失'],['wait_image','等待出现']],m.workbench.action)}</select>`)}<p class="field-help">${m.workbench.repair?'保存一个新控件，只替换当前步骤，原共享控件不受影响。':'框选稳定的标题或图标，再预览定位。保存后自动插入当前步骤后。'}</p>${button('预览定位','wb-modal-preview','ghost','search',disabled())}${m.previewShot?`<div class="wb-inline-preview"><strong>${m.previewShot.matched===false?'未找到目标':'已找到目标'}</strong><p>${esc(previewHint(m.previewShot))}</p></div>`:''}`;
}
function workbenchVerificationModal(m){
  const t=m.draft;
  return header(m.workbench.repair?'修复当前步骤的目标':'添加界面验证')+`<div class="modal-body">${field('目标名称',input(t.name,'data-dfield="name"'))}${workbenchVerificationFields(m)}<div class="template-placeholder">${t.image&&S.thumbnails[t.image]?`<img src="${esc(S.thumbnails[t.image])}" alt="验证目标模板">`:esc(t.image||'请框选稳定的标题或图标')}</div><div class="modal-actions">${button('重新框选','pick-target','','screenshot')}${button('导入图片','import-image','ghost','upload')}</div><details class="details"><summary>高级识别设置</summary>${recognitionFields(t)}</details></div><footer class="modal-footer">${button('取消','close-modal')}${button(m.workbench.repair?'替换本步目标':'加入测试步骤','save-target','primary','check',disabled())}</footer>`;
}
async function workbenchSaveVerification(){
  const m=S.modal,ctx=m.workbench;if(lock())return;
  if(S.project!==ctx.project||ctx.repair&&!S.project.steps.includes(ctx.step))throw new Error('用例已变化，请重新采集');
  const draft=clone(m.draft);draft.name=draft.name.trim();
  if(!draft.name)throw new Error('请填写目标名称');
  const used=new Set(controlSelectors().map(t=>t.name));const base=draft.name;let n=2;while(used.has(draft.name))draft.name=`${base} ${n++}`;
  const data=await api('control_save',{selector:draft,category_id:''});setControls(data);
  const saved=data.entries.find(row=>row.selector.name===draft.name);if(!saved)throw new Error('目标保存失败');
  useControl(saved.selector.name);
  if(ctx.repair){ctx.step.target=saved.selector.name;delete ctx.step.params.position;if(ctx.step.action==='drag')delete ctx.step.params.path;}
  else{const index=S.project.steps.length?Math.min(ctx.index+1,S.project.steps.length):0;S.project.steps.splice(index,0,{name:`${ctx.action==='assert_absent'?'验证消失':ctx.action==='wait_image'?'等待出现':'验证出现'} · ${saved.selector.name}`,action:ctx.action,target:saved.selector.name,enabled:true,timeout:5,delay:0,repeat:1,params:{}});S.selected=index;}
  S.wb.previewRequest=null;S.wb.selection=[];dirty();closeModal();S.view='cases';render();toast(ctx.repair?'已替换本步目标，可预览或重跑':'验证步骤已加入草稿','success');
}
async function workbenchRun(mode){
  if(lock())return;if(!hasTarget())throw new Error('请先连接目标窗口');
  const selected=WorkbenchModel.range(S.project,mode,S.selected,S.wb.selection);
  if(['from','selection'].includes(mode)||selected.expanded){
    if(!await confirm(`试跑第 ${selected.start+1}–${selected.end+1} 步？`,`${selected.expanded?'已扩展为完整循环组。':''}请先将游戏恢复到这段操作所需的状态。所选首尾之间的步骤会连续执行，范围外的变量赋值和准备步骤不会执行。局部通过仅代表所选片段通过。`))return;
  }
  selected.project.name+=` · 局部试跑 [${selected.start+1}–${selected.end+1}]`;
  S.wb.range={start:selected.start,end:selected.end};
  await run({stayOnWorkbench:true,project:selected.project,iterations:1});
}
async function workbenchOnFinished(event){
  if(!S.wb)return;
  if(S.view!=='cases'||S.recordReplaying||['recording','exploration'].includes(S.runState?.source))return;
  S.wb.runOpen=true;
  const failure=event.result.steps?.find(row=>row.status==='failed');
  S.wb.failure=failure||null;S.wb.failureStep=failure?S.project.steps[failure.index]:null;S.wb.failureImage=null;
  if(failure){
    S.selected=failure.index;S.wb.previewRequest=null;
    if(event.directory&&(failure.recognition_screenshot||failure.screenshot)){
      try{const image=await api('report_image',{id:event.directory.split(/[\\/]/).at(-1),file:failure.recognition_screenshot||failure.screenshot});if(S.wb.failure===failure)S.wb.failureImage=image.image;}catch(error){log('失败截图读取失败：'+error.message,'error');}
    }
  }
  if(S.view==='cases')render();
}
async function workbenchAction(action,node){
  if(action==='wb-step-order'){S.wb.stepOrder=node.dataset.order==='desc'?'desc':'asc';render();return;}
  if(action==='wb-position-edit')return openStepPosition(node.dataset.field);
  if(action==='wb-position-save')return saveStepPosition();
  if(action==='wb-position-promote')return promoteStepPosition(node.dataset.field);
  if(action==='wb-position-share')return savePositionPromotion();
  if(action==='wb-position-localize')return localizeRecordingPositions();
  if(action==='wb-record')return workbenchStartRecord();
  if(action==='wb-record-after')return workbenchStartRecord(true);
  if(action==='wb-select'){const i=Number(node.dataset.i);S.wb.selection=node.checked?[...new Set([...S.wb.selection,i])]:S.wb.selection.filter(v=>v!==i);return;}
  if(action==='wb-assert')return workbenchCaptureVerification();
  if(action==='wb-recapture')return workbenchCaptureVerification('assert_image',true);
  if(action==='wb-preview')return workbenchPreview(node?.dataset?.field||'target');
  if(action==='wb-edit-target'){
    const t=S.project.selectors.find(t=>t.name===S.project.steps[S.selected]?.target),i=S.controls.entries.findIndex(row=>row.id===t?.library_id);
    if(i<0)throw new Error('目标不在共享库，请重新采集');
    if(!await confirm('修改共享控件？','所有引用此控件的用例都会使用新配置。若只修复本步，请取消并使用「重新采集副本」。'))return;
    return editSharedControl(i);
  }
  if(action==='wb-modal-preview'){
    const m=S.modal,shot=await api('preview',{...targetArgs(),selector:m.draft,selectors:S.project.selectors});if(S.modal===m){m.previewShot=shot;renderModal();}return;
  }
  if(action.startsWith('wb-run-'))return workbenchRun(action.slice(7));
  if(action==='wb-undo-recording'){
    if(lock())return;const undo=S.wb.undoRecording;if(!undo)return;
    if(JSON.stringify(S.project)!==undo.after)throw new Error('录制后已有其他修改，撤销已停用；可选中录制步骤手动删除');
    S.project=clone(undo.before);S.selected=Math.max(0,S.project.steps.length-1);S.wb.undoRecording=null;S.wb.selection=[];S.stepStatus={};dirty();render();return;
  }
  if(action==='wb-restore'){
    if(lock())return;const d=S.wb.recovery;if(!d)return;
    if(S.dirty&&!await canReplace())return;
    const data=await api('case_context',{path:d.path,base_dir:d.baseDir});S.project=clone(d.project);S.path=data.path;S.baseDir=data.base_dir;S.selected=Math.max(0,Math.min(d.selected||0,S.project.steps.length-1));S.wb.recovery=null;syncProjectControls();dirty();S.view='cases';render();return;
  }
  if(action==='wb-dismiss-draft'){if(await confirm('丢弃草稿恢复点？','只删除自动恢复点，已保存用例不受影响。')){clearWorkbenchDraft(true);persistWorkbenchDraft();render();}return;}
}
document.addEventListener('input',event=>{if(event.target.id==='wb-case-search'){S.caseSearch=event.target.value;const start=event.target.selectionStart,end=event.target.selectionEnd;render();const field=document.querySelector('#wb-case-search');field?.focus();if(start!=null)field?.setSelectionRange(start,end);}});
document.addEventListener('change',event=>{if(event.target.id==='wb-assert-action'&&S.modal?.workbench)S.modal.workbench.action=event.target.value;});
document.addEventListener('toggle',event=>{if(event.target.matches?.('.wb-run-drawer'))S.wb.runOpen=event.target.open;},true);
window.addEventListener('beforeunload',persistWorkbenchDraft);

function workbenchRecordingStatus(){const node=document.querySelector('#wb-record-status');if(node)node.textContent=`正在录制目标窗口 · ${S.recordCount} 个事件 · F12 停止`;}

async function workbenchFloatingAction(event){
  let message='',error='';
  try{
    if(!window.__studioReady)throw new Error('工作台尚未准备好');
    if(S.connection?.handle!==event.handle)throw new Error('目标窗口已变化，请重新操作');
    if(S.modal)throw new Error('请先完成工作台中的弹窗操作');
    if(event.action==='record'){
      if(S.project.mode==='python')throw new Error('请先切换到低代码用例再录制');
      if(lock()||S.recordPending)throw new Error('请先停止当前操作或处理上一段录制');
      await workbenchStartRecord(true);message='录制已开始 · F12 停止';
    }else if(event.action==='screenshot'){
      if(S.project.mode==='python')throw new Error('Python 用例请使用 window.screenshot()');
      if(S.recordPending||S.wb.converting||S.mcpOperation||S.busy&&S.busy!=='recording')throw new Error('请先完成当前操作');
      const project=S.project,step=project.steps[S.selected];
      const result=await api('floating_screenshot',{handle:event.handle});
      if(!result.recorded){
        if(S.project!==project)throw new Error('截图已保存，用例已切换，未插入步骤');
        const index=step?project.steps.indexOf(step)+1:project.steps.length;
        if(step&&index===0)throw new Error('截图已保存，当前步骤已删除，未插入步骤');
        project.steps.splice(index,0,{name:'截图',action:'screenshot',target:'',enabled:true,timeout:5,delay:0,repeat:1,params:{}});
        S.selected=index;S.wb.selection=[];S.stepStatus={};dirty();render();
      }
      message=result.recorded?'截图已保存并加入录制序列':'截图已保存并加入当前步骤后';
      log('截图已保存：'+result.path,'success');
    }else throw new Error('不支持的悬浮窗操作');
  }catch(failure){error=failure.message;toast(error,'error');}
  try{await api('floating_result',{id:event.id,message,error});}catch(failure){toast(failure.message,'error');}
}
