'use strict';
const STEP_POSITION_ACTIONS=new Set(['click','double_click','right_click','long_press','drag','scroll']);
function positionField(key){return key==='end_target'?'end_position':'position';}
function positionSummary(p){return p.normalized!==false?`X ${(p.x*100).toFixed(1)}% · Y ${(p.y*100).toFixed(1)}%`:`X ${p.x} · Y ${p.y} 像素`;}
function stepPositionChoice(step,key){
  if(!STEP_POSITION_ACTIONS.has(step.action))return '';
  const p=step.params?.[positionField(key)],attrs=`data-field="${key}" ${disabled()}`;
  return `<div class="step-position-choice">${p?`<strong>本步位置</strong><span>${esc(positionSummary(p))}</span><small>${p.normalized!==false?'随客户区尺寸变化':'客户区像素坐标'}${p.offset_x||p.offset_y?` · 偏移 ${p.offset_x||0}, ${p.offset_y||0}`:''}</small>`:''}<div>${button(p?'编辑位置':'使用本步位置','wb-position-edit','ghost','coordinate',attrs)}${p?button('预览位置','wb-preview','ghost','search',attrs)+button('保存为共享控件','wb-position-promote','ghost','targets',attrs)+(key==='target'?button('改用图片定位','wb-recapture','ghost','image',disabled()):''):''}</div></div>`;
}
function currentPositionContext(key){
  const step=S.project.steps[S.selected];
  if(!step||!STEP_POSITION_ACTIONS.has(step.action)||!['target','end_target'].includes(key)||key==='end_target'&&step.action!=='drag')throw new Error('请先选择支持位置的操作步骤');
  return {project:S.project,step,key};
}
function checkPositionContext(ctx){if(ctx.pending)return checkStepSetup(ctx);if(S.project!==ctx.project||!S.project.steps.includes(ctx.step))throw new Error('步骤已变化，请重新编辑位置');}
function openStepPosition(key){
  if(lock())return;
  const ctx=currentPositionContext(key),p=ctx.step.params?.[positionField(key)];
  showModal({kind:'selector',stepPosition:ctx,draft:{...defaultSelector(),...(p||{}),name:'步骤位置'}});
}
function stepPositionModal(m){
  const p=m.draft;
  return header(m.stepPosition.key==='end_target'?'拖动终点位置':'本步操作位置')+`<div class="modal-body"><p class="field-help">位置仅属于当前步骤。多处复用时，可保存为共享控件。${m.stepPosition.step.params?.path?'修改拖动端点后将清除原轨迹，按新起终点直线拖动。':''}</p><div class="field-grid">${field('X 坐标',input(p.x,'data-dfield="x"','number','step="0.001" min="0"'))}${field('Y 坐标',input(p.y,'data-dfield="y"','number','step="0.001" min="0"'))}</div><label class="check-line"><input type="checkbox" data-dfield="normalized" ${p.normalized!==false?'checked':''}>使用比例坐标 · 0 到 1</label><p class="field-help">以目标客户区左上角为原点。切换坐标模式后，请重新取点或输入对应数值。</p>${button('从目标截图重新取点','pick-target','quiet wide','coordinate',disabled())}<div class="field-grid">${field('X 偏移 · 像素',input(p.offset_x||0,'data-dfield="offset_x"','number','step="1"'))}${field('Y 偏移 · 像素',input(p.offset_y||0,'data-dfield="offset_y"','number','step="1"'))}</div></div><footer class="modal-footer">${m.stepPosition.pending?button('返回定位方式','setup-back','ghost'):''}${button('取消','close-modal')}${button(m.stepPosition.pending?m.stepPosition.step.action==='drag'&&m.stepPosition.key==='target'?'下一步：设置终点':'添加步骤':'应用到本步','wb-position-save','primary','check',disabled())}</footer>`;
}
function saveStepPosition(){
  if(lock())return;
  const m=S.modal,ctx=m?.stepPosition;if(!ctx)return;checkPositionContext(ctx);
  const p=Object.fromEntries(['x','y','normalized','offset_x','offset_y'].map(key=>[key,m.draft[key]]));
  if(![p.x,p.y].every(v=>Number.isFinite(v)&&v>=0&&v<=(p.normalized?1:100000))||![p.offset_x,p.offset_y].every(v=>Number.isInteger(v)&&Math.abs(v)<=100000))throw new Error('请输入有效坐标：比例值为 0 到 1，像素值非负，偏移为整数');
  ctx.step.params||={};const old=ctx.step.params[positionField(ctx.key)],changed=ctx.step[ctx.key]||!old||Object.keys(p).some(key=>p[key]!== (old[key]??(key==='normalized'?true:0)));
  if(changed&&ctx.step.action==='drag')delete ctx.step.params.path;
  ctx.step.params[positionField(ctx.key)]=p;ctx.step[ctx.key]='';
  if(ctx.pending)return finishStepSetup(ctx);
  S.wb.previewRequest=null;dirty();closeModal();render();toast('已更新本步位置','success');
}
function promoteStepPosition(key){
  if(lock())return;
  const ctx=currentPositionContext(key),p=ctx.step.params?.[positionField(key)];if(!p)throw new Error('请先设置本步位置');
  showModal({kind:'position-promotion',ctx,position:clone(p),name:'',categoryId:''});
}
function positionPromotionModal(m){return header('保存为共享控件')+`<div class="modal-body"><p class="field-help">为复用的位置起一个有意义的名称，例如「背包入口」。保存后，本步将引用这个共享控件。</p>${field('控件名称',input(m.name,'id="position-control-name"','text','maxlength="200"'))}${field('分类',`<select id="position-control-category"><option value="">未分类</option>${options(S.controls.categories.map(c=>[c.id,c.name]),m.categoryId)}</select>`)}<p>${esc(positionSummary(m.position))}</p></div><footer class="modal-footer">${button('取消','close-modal')}${button('保存并引用','wb-position-share','primary','targets',disabled())}</footer>`;}
async function savePositionPromotion(){
  if(lock())return;
  const m=S.modal;if(m?.kind!=='position-promotion')return;checkPositionContext(m.ctx);
  const name=m.name.trim();if(!name)throw new Error('请填写方便复用的控件名称');
  const data=await api('control_save',{selector:{...defaultSelector(),...m.position,name},category_id:m.categoryId});
  checkPositionContext(m.ctx);setControls(data);
  const target=data.control?.selector||data.entries.find(e=>e.selector.name===name)?.selector;if(!target)throw new Error('共享控件未保存，请刷新后重试');
  useControl(target.name);m.ctx.step[m.ctx.key]=target.name;delete m.ctx.step.params[positionField(m.ctx.key)];
  S.wb.previewRequest=null;dirty();closeModal();render();toast('已保存为共享控件并引用','success');
}
async function localizeRecordingPositions(){
  if(lock())return;
  const project=S.project,before=JSON.stringify(project);
  const result=await api('record_positions_localize',{project});
  if(S.project!==project||JSON.stringify(project)!==before)throw new Error('用例已变化，请重试整理');
  if(!result.converted){toast(result.reason||'当前没有可转换的录制位置');return;}
  if(!await confirm(`将 ${result.converted} 处录制坐标改为本步位置？`,'仅修改当前草稿。共享库和已保存用例保留，Python 及其他用例引用的位置会跳过。保存用例后生效。'))return;
  if(S.project!==project||JSON.stringify(project)!==before)throw new Error('用例已变化，请重试整理');
  S.project=result.project;S.selected=Math.max(0,Math.min(S.selected,S.project.steps.length-1));S.wb.previewRequest=null;S.wb.selection=[];S.wb.failure=null;S.stepStatus={};dirty();render();toast(`已整理 ${result.converted} 处录制坐标，等待保存用例`,'success');
}
document.addEventListener('input',event=>{if(event.target.id==='position-control-name'&&S.modal?.kind==='position-promotion')S.modal.name=event.target.value;});
document.addEventListener('change',event=>{if(event.target.id==='position-control-category'&&S.modal?.kind==='position-promotion')S.modal.categoryId=event.target.value;});

// New targeted steps remain outside the project until the user configures every endpoint.
function beginStepSetup(step,index){
  const ctx={pending:true,project:S.project,step,index,key:'target',before:JSON.stringify(S.project.steps)};
  showModal({kind:'step-setup',setup:ctx});
}
function checkStepSetup(ctx){if(S.project!==ctx.project||JSON.stringify(S.project.steps)!==ctx.before)throw new Error('用例步骤已变化，请重新添加步骤');}
function stepSetupModal(m){
  const ctx=m.setup,mouse=STEP_POSITION_ACTIONS.has(ctx.step.action),android=UI_ACTIONS.has(ctx.step.action);
  const choice=(mode,symbol,title,detail)=>`<button type="button" class="step-setup-choice" data-act="setup-${mode}" ${disabled()}>${icon(symbol)}<span><strong>${title}</strong><small>${detail}</small></span></button>`;
  return header(ctx.key==='end_target'?'设置拖动终点':`添加${A[ctx.step.action]} · 选择操作目标`)+`<div class="modal-body"><p class="field-help">${ctx.key==='end_target'?'起点已设置，请继续选择终点。':'请选择这个步骤要操作的位置或控件。'}完成配置后才会加入用例。</p><div class="step-setup-choices">${mouse?choice('coordinate','coordinate','本步坐标','从目标截图取点，或输入坐标；位置只属于本步。'):''}${!android?choice('image','image','图片定位','选择已有图片 / OCR 控件，或采集新的图片。'):''}${mouse||android?choice('shared','targets',android?'选择安卓控件':'已有共享控件',android?'从控件库明确选择安卓原生 UI 控件。':'从控件库选择要复用的坐标、图片或其他控件。'):''}</div></div><footer class="modal-footer">${button('取消添加','close-modal')}</footer>`;
}
function finishStepSetup(ctx){
  checkStepSetup(ctx);
  if(ctx.step.action==='drag'&&!ctx.step.end_target&&!ctx.step.params.end_position){showModal({kind:'step-setup',setup:{...ctx,key:'end_target'}});return;}
  for(const key of ['target','end_target'])if(ctx.step[key]){
    const target=controlSelectors().find(t=>t.name===ctx.step[key]);if(!target)throw new Error('所选控件已不存在，请重新添加步骤');
  }
  for(const key of ['target','end_target'])if(ctx.step[key])useControl(ctx.step[key]);
  if(S.project.selectors.some(t=>[ctx.step.target,ctx.step.end_target].includes(t.name)&&t.kind==='android_ui'))ctx.step.timeout=15;
  S.project.steps.splice(ctx.index,0,ctx.step);S.selected=ctx.index;S.stepStatus={};S.wb.previewRequest=null;S.wb.selection=[];
  dirty();closeModal();S.view='cases';render();
}
function stepSetupImageModal(m){
  return header(`添加${A[m.stepSetup.step.action]} · 新图片定位`)+`<div class="modal-body">${field('控件名称',input(m.draft.name,'data-dfield="name"'))}<p class="field-help">图片会保存到共享控件库，并由新步骤引用。${m.stepSetup.step.action==='drag'?'起点和终点都设置好后才会加入用例。':''}</p>${recognitionFields(m.draft)}</div><footer class="modal-footer">${button('返回定位方式','setup-back','ghost')}${button('取消添加','close-modal')}${button(m.stepSetup.step.action==='drag'&&m.stepSetup.key==='target'?'保存并设置终点':'保存并添加步骤','save-target','primary','check',disabled())}</footer>`;
}
async function saveStepSetupImage(){
  if(lock())return;
  const m=S.modal,ctx=m.stepSetup;checkStepSetup(ctx);
  const draft=clone(m.draft);draft.name=draft.name.trim();if(!draft.name)throw new Error('请填写控件名称');
  const used=new Set(controlSelectors().map(t=>t.name)),base=draft.name;let n=2;while(used.has(draft.name))draft.name=`${base} ${n++}`;
  const data=await api('control_save',{selector:draft,category_id:''});if(S.modal!==m)return;checkStepSetup(ctx);setControls(data);
  const saved=data.control?.selector||data.entries.find(e=>e.selector.name===draft.name)?.selector;if(!saved)throw new Error('图片控件保存失败');
  ctx.step[ctx.key]=saved.name;delete ctx.step.params[positionField(ctx.key)];finishStepSetup(ctx);
}
async function stepSetupAction(action){
  if(lock())return;
  const ctx=S.modal?.setup||S.modal?.stepSetup||S.modal?.stepPosition;if(!ctx?.pending)return;checkStepSetup(ctx);
  if(action==='setup-back'){showModal({kind:'step-setup',setup:ctx});return;}
  if(action==='setup-coordinate'){
    if(!STEP_POSITION_ACTIONS.has(ctx.step.action))return;
    showModal({kind:'selector',stepPosition:ctx,draft:{...defaultSelector(),name:'步骤位置'}});return;
  }
  if(action==='setup-image'||action==='setup-shared')return openControlPicker(ctx.key,ctx,action==='setup-image');
  if(action==='setup-capture'){
    showModal({kind:'selector',stepSetup:ctx,draft:{...defaultSelector(),kind:'image',name:`${A[ctx.step.action]}目标图片`}});return;
  }
}
