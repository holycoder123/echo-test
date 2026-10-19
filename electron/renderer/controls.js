'use strict';
const SHARED_CONTROL_ACTIONS=new Set(['choose-control','picker-category','picker-select','picker-clear','picker-accept','control-filter','control-refresh','control-clear-search','control-categories','new-category','edit-category','save-category','delete-category','delete-target','preview-target']);

function projectControlIds(){
  const names=new Set(S.project.steps.flatMap(step=>[step.target,step.end_target]).filter(Boolean));
  const all=S.project.steps.some(step=>step.enabled!==false&&step.action==='python');
  const queue=[...names];
  while(queue.length){const name=queue.pop(),target=S.project.selectors.find(item=>item.name===name);if(target?.kind==='image'&&target.anchor&&!names.has(target.anchor)){names.add(target.anchor);queue.push(target.anchor);}}
  return S.project.selectors.filter(target=>all||names.has(target.name)).map(target=>target.library_id).filter(Boolean);
}
function controlSelectors(){return S.controls.entries.map(entry=>entry.selector);}
function categoryName(id){return S.controls.categories.find(category=>category.id===id)?.name||'未分类';}
function setControls(data,markDirty=false){
  if(!data)return;
  S.controls=data;
  if(S.targetCategory!=='all'&&S.targetCategory!==''&&!data.categories.some(category=>category.id===S.targetCategory))S.targetCategory='all';
  const changed=syncProjectControls();
  if(markDirty&&changed)dirty();
}
function syncProjectControls(){
  const previous=JSON.stringify(S.project);
  const byId=new Map(S.controls.entries.map(entry=>[entry.id,entry.selector]));
  const names=new Map(),selectors=new Map(),aliases=[];
  const hasPython=S.project.steps.some(step=>step.enabled!==false&&step.action==='python');
  for(const original of S.project.selectors){
    const shared=byId.get(original.library_id);
    if(!shared){selectors.set(original.name,clone(original));continue;}
    names.set(original.name,shared.name);selectors.set(shared.name,clone(shared));
    if(hasPython&&original.name!==shared.name)aliases.push({...clone(shared),name:original.name});
  }
  function addAnchor(target){
    if(target.kind==='image'&&target.anchor&&!selectors.has(target.anchor)){
      const anchor=controlSelectors().find(item=>item.name===target.anchor);
      if(anchor){selectors.set(anchor.name,clone(anchor));addAnchor(anchor);}
    }
  }
  for(const target of [...selectors.values()])addAnchor(target);
  for(const alias of aliases)if(!selectors.has(alias.name))selectors.set(alias.name,alias);
  for(const target of selectors.values())if(!target.library_id)target.anchor=names.get(target.anchor)||target.anchor;
  for(const step of S.project.steps){step.target=names.get(step.target)||step.target;step.end_target=names.get(step.end_target)||step.end_target;}
  S.project.selectors=[...selectors.values()];
  return previous!==JSON.stringify(S.project);
}
function useControl(name){
  const target=controlSelectors().find(item=>item.name===name);
  if(!target)return S.project.selectors.find(item=>item.name===name);
  if(target.kind==='image'&&target.anchor)useControl(target.anchor);
  const existing=S.project.selectors.findIndex(item=>item.name===target.name);
  if(existing<0)S.project.selectors.push(clone(target));else S.project.selectors[existing]=clone(target);
  return target;
}
function controlImage(target){return target.kind==='image'?(target.image||target.templates?.find(item=>item.image)?.image||''):'';}
function controlImages(target){return target.kind==='image'?[...new Set([controlImage(target),...(target.templates||[]).map(item=>item.image)].filter(Boolean))]:[];}
function controlKind(target){return target.kind==='coordinate'?'坐标':target.recognition==='ocr'?'OCR 文字':'图片模板';}
function matchesControl(entry,search){
  const target=entry.selector,text=[target.name,categoryName(entry.category_id),target.text||'',controlKind(target),target.kind,target.recognition||''].join(' ').toLocaleLowerCase();
  return search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean).every(word=>text.includes(word));
}
function controlChoice(step,key){
  const name=step[key]||'';
  return `<button type="button" class="control-choice" data-act="choose-control" data-field="${key}" aria-haspopup="dialog" ${disabled()}><span>${esc(name||'从控件库选择')}</span>${icon('targets')}</button>`;
}
function controlImageSlot(image,alt){
  const source=S.thumbnails[image],failed=thumbnailFailures.has(image);
  return `<div class="control-image-slot" data-image-slot="${esc(image)}"><img data-control-image="${esc(image)}" ${source?`src="${esc(source)}"`:'hidden'} alt="${esc(alt)}"><span ${source?'hidden':''}>${icon('image')}<small>${failed?'图片无法读取':image?'正在加载图片…':'暂无模板图片'}</small></span></div>`;
}
function updateControlImages(image,failed=false){
  for(const slot of document.querySelectorAll('[data-image-slot]')){
    if(slot.dataset.imageSlot!==image)continue;
    const img=slot.querySelector('img'),hint=slot.querySelector('span');
    if(S.thumbnails[image]){img.src=S.thumbnails[image];img.hidden=false;hint.hidden=true;}
    else if(failed)hint.querySelector('small').textContent='图片无法读取';
  }
}
async function openControlPicker(key){
  if(lock())return;
  if(!['target','end_target'].includes(key))return;
  const project=S.project,step=project.steps[S.selected];
  if(!step||(key==='target'&&!TARGETS.has(step.action))||(key==='end_target'&&step.action!=='drag'))return;
  const data=await api('control_list');
  if(lock()||S.project!==project||S.project.steps[S.selected]!==step)return;
  setControls(data,true);
  const imageOnly=key==='target'&&IMAGES.has(step.action),eligible=S.controls.entries.filter(entry=>!imageOnly||entry.selector.kind==='image');
  const selected=eligible.find(entry=>entry.selector.name===step[key]);
  const m={kind:'control-picker',project,step,key,imageOnly,category:'all',search:'',selectedId:selected?.id||'',clear:false};
  showModal(m);modal.querySelector('#control-picker-search').focus();
  // Load saved templates without requiring a connected game. Keep search focus and scroll intact.
  const images=[...new Set(eligible.flatMap(entry=>controlImages(entry.selector)))];
  let next=0;
  const worker=async()=>{while(next<images.length&&S.modal===m){await thumbnail(images[next++]);}};
  await Promise.all(Array.from({length:Math.min(4,images.length)},worker));
}
function controlPickerResults(m){
  const entries=S.controls.entries.filter(entry=>(!m.imageOnly||entry.selector.kind==='image')&&(m.category==='all'||m.category===entry.category_id)&&matchesControl(entry,m.search));
  return `<div class="control-result-count">${entries.length} 个${m.search?'匹配':''}控件${m.imageOnly?' · 仅图片 / OCR 控件':''}</div>${entries.length?`<div class="control-picker-grid">${entries.map(entry=>{
    const target=entry.selector,image=controlImage(target),selected=m.selectedId===entry.id;
    const preview=image?controlImageSlot(image,target.name):`<div class="control-text-preview">${icon(target.kind==='coordinate'?'coordinate':'image')}<span>${esc(target.kind==='coordinate'?target.normalized!==false?`X ${(target.x*100).toFixed(1)}% · Y ${(target.y*100).toFixed(1)}%`:`X ${target.x} · Y ${target.y}`:target.text||'未设置识别文字')}</span></div>`;
    return `<button type="button" class="control-picker-card ${selected?'selected':''}" data-act="picker-select" data-id="${entry.id}" aria-pressed="${selected}">${preview}<span class="control-picker-copy"><strong>${esc(target.name)}</strong><small>${esc(categoryName(entry.category_id))} · ${controlKind(target)}</small></span></button>`;
  }).join('')}</div>`:'<div class="empty compact"><strong>没有匹配的控件</strong><p>试试其他分类或搜索词。</p></div>'}`;
}
function controlPickerDetail(m){
  const entry=S.controls.entries.find(item=>item.id===m.selectedId);
  if(!entry)return `<div class="empty compact"><p>${m.clear?'确认后将清空此步骤的目标。':'选择控件，查看图片和信息。'}</p></div>`;
  const target=entry.selector,images=controlImages(target);
  return `<strong>${esc(target.name)}</strong><p>${esc(categoryName(entry.category_id))} · ${controlKind(target)}</p>${images.map(image=>controlImageSlot(image,target.name+' 模板预览')).join('')}${target.recognition==='ocr'?`<p class="control-ocr-text">识别文字：${esc(target.text||'未设置')}</p>`:''}${target.kind==='coordinate'?`<p>${target.normalized!==false?`客户区比例坐标<br>X ${(target.x*100).toFixed(1)}% · Y ${(target.y*100).toFixed(1)}%`:`客户区像素坐标<br>X ${target.x} · Y ${target.y}`}</p>`:''}`;
}
function renderControlPickerResults(){
  const m=S.modal;if(m?.kind!=='control-picker')return;
  const results=modal.querySelector('#control-picker-results'),scroll=results.scrollTop,focusedId=document.activeElement?.dataset.act==='picker-select'?document.activeElement.dataset.id:null;
  results.innerHTML=controlPickerResults(m);results.scrollTop=scroll;
  if(focusedId)[...results.querySelectorAll('[data-act="picker-select"]')].find(button=>button.dataset.id===focusedId)?.focus({preventScroll:true});
  modal.querySelector('#control-picker-detail').innerHTML=controlPickerDetail(m);
  modal.querySelector('[data-act="picker-accept"]').disabled=!!disabled()||(!m.selectedId&&!m.clear);
  for(const button of modal.querySelectorAll('[data-act="picker-category"]')){const active=button.dataset.category===m.category;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}
}
function controlPickerModal(m){
  const eligible=S.controls.entries.filter(entry=>!m.imageOnly||entry.selector.kind==='image');
  const categories=[{id:'all',name:'全部控件'},{id:'',name:'未分类'},...S.controls.categories];
  return header(m.key==='end_target'?'选择拖动终点控件':'选择目标控件')+`<div class="control-picker-tools"><div class="search"><input id="control-picker-search" placeholder="搜索名称、分类或识别文字" aria-label="搜索可选控件" value="${esc(m.search)}">${icon('search')}</div><span>选中控件后，确认选择</span></div><div class="control-picker-layout"><aside class="control-categories" aria-label="可选控件分类">${categories.map(category=>`<button type="button" class="control-category ${m.category===category.id?'active':''}" data-act="picker-category" data-category="${esc(category.id)}" aria-pressed="${m.category===category.id}"><span>${esc(category.name)}</span><small>${eligible.filter(entry=>category.id==='all'||entry.category_id===category.id).length}</small></button>`).join('')}</aside><div id="control-picker-results">${controlPickerResults(m)}</div><aside id="control-picker-detail" aria-label="选中控件预览">${controlPickerDetail(m)}</aside></div><footer class="modal-footer"><button class="btn ghost control-picker-clear" data-act="picker-clear" ${disabled()}>清空目标</button>${button('取消','close-modal')}${button('确认选择','picker-accept','primary','',disabled()||(!m.selectedId&&!m.clear?'disabled':''))}</footer>`;
}
async function refreshControls(){
  setControls(await api('control_list'),true);render();
  const bank=S.controls,images=[...new Set(controlSelectors().map(controlImage).filter(Boolean))];
  thumbnailFailures.clear();
  let next=0;
  const worker=async()=>{while(next<images.length&&S.view==='targets'&&S.controls===bank)await thumbnail(images[next++]);};
  void Promise.all(Array.from({length:Math.min(4,images.length)},worker));
}
function controlView(){
  const words=S.targetSearch.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const cards=S.controls.entries.map((entry,index)=>({...entry,index})).filter(entry=>{
    const t=entry.selector,text=[t.name,categoryName(entry.category_id),t.text||'',t.kind==='image'?t.recognition==='ocr'?'图片 image OCR 文字':'图片 image 模板 template':'坐标 coordinate'].join(' ').toLocaleLowerCase();
    return (S.targetCategory==='all'||entry.category_id===S.targetCategory)&&words.every(word=>text.includes(word));
  });
  const usedIds=new Set(projectControlIds());
  const categoryButton=(id,name,count)=>`<button class="control-category ${S.targetCategory===id?'active':''}" data-act="control-filter" data-category="${esc(id)}" aria-pressed="${S.targetCategory===id}"><span>${esc(name)}</span><small>${count}</small></button>`;
  return `<div class="page-heading control-heading"><div><h1>通用控件库</h1><p class="sub">所有用例共享控件；在步骤设置中直接选择，修改后统一生效。</p></div><div class="heading-actions"><div class="search"><input placeholder="搜索名称、分类或识别文字" id="target-search" value="${esc(S.targetSearch)}" aria-label="搜索通用控件">${icon('search')}</div>${button('刷新','control-refresh','ghost','refresh')}${button('新增控件','new-target','primary','plus',disabled())}</div></div>
  <div class="control-layout"><aside class="control-categories" aria-label="控件分类"><div class="control-category-heading"><strong>分类</strong>${button('管理','control-categories','ghost','',disabled())}</div>${categoryButton('all','全部控件',S.controls.entries.length)}${categoryButton('','未分类',S.controls.uncategorized||0)}${S.controls.categories.map(category=>categoryButton(category.id,category.name,category.count||0)).join('')}${button('新建分类','new-category','ghost','plus',disabled())}</aside>
  <div class="control-results"><div class="control-result-count">${esc(S.targetCategory==='all'?'全部控件':categoryName(S.targetCategory))} · ${cards.length} 个${S.targetSearch?'匹配结果':''}</div>${S.controls.warnings?.length?`<p class="control-import-note">${S.controls.warnings.length} 个旧文件未能迁入，请检查用例文件和模板是否完整。</p>`:''}
  ${cards.length?`<div class="target-grid">${cards.map(entry=>{
    const target=entry.selector,index=entry.index,used=usedIds.has(entry.id);
    return `<article class="target-card" data-control-id="${entry.id}">${target.kind==='image'?`<div class="target-thumb">${controlImageSlot(controlImage(target),target.name)}</div>`:''}<div class="target-body"><div class="top">${icon(target.kind)}<strong>${esc(target.name)}</strong><span class="type-pill">${target.kind==='image'?target.recognition==='ocr'?'OCR':'图片':'坐标'}</span></div><div class="control-tags"><span>${esc(categoryName(entry.category_id))}</span>${used?'<span class="control-used">当前用例已引用</span>':''}</div><div class="target-values">${target.kind==='image'?`${target.recognition==='ocr'?'OCR 文字':'模板匹配'} · 阈值 ${target.threshold??.86}<br>${esc(target.recognition==='ocr'?target.text:target.image||target.templates?.[0]?.image||'')}${target.templates?.length?`<br>附加模板 ${target.templates.length} 张`:''}${target.anchor?`<br>锚点 ${esc(target.anchor)}`:''}`:target.normalized!==false?`X ${(target.x*100).toFixed(1)}% · Y ${(target.y*100).toFixed(1)}%<br>随客户区尺寸变化`:`X ${target.x} · Y ${target.y}<br>客户区像素坐标`}</div></div><footer>${button('编辑','edit-target','','',`data-i="${index}" ${disabled()}`)}${button('预览定位','preview-target','ghost','',`data-i="${index}" ${disabled()}`)}<button class="icon-button last" data-act="delete-target" data-i="${index}" title="删除通用控件" ${disabled()}>${icon('trash')}</button></footer></article>`;
  }).join('')}</div>`:`<div class="empty"><div class="empty-icon">${icon('targets')}</div><strong>${S.targetSearch?'没有匹配的控件':'此分类还没有控件'}</strong><p>新建控件后，所有用例都可以引用。</p>${S.targetSearch?button('清除搜索','control-clear-search','ghost'):button('新增控件','new-target','quiet','plus',disabled())}</div>`}</div></div>`;
}
async function editSharedControl(index=null){
  if(lock())return;
  const entry=index===null?null:S.controls.entries[index];
  if(index!==null&&!entry)throw new Error('控件已不存在，请刷新');
  showModal({kind:'selector',index,id:entry?.id||null,categoryId:entry?.category_id??(S.targetCategory==='all'?'':S.targetCategory),draft:entry?clone(entry.selector):defaultSelector()});
  await thumbnail(controlImage(S.modal.draft),true);
}
async function saveSharedControl(){
  if(lock())return;
  const m=S.modal,t=m.draft;t.name=t.name.trim();
  if(!t.name)throw new Error('请填写控件名称');
  const data=await api('control_save',{id:m.id||null,selector:t,category_id:m.categoryId||''});
  setControls(data,true);closeModal();render();toast('已保存到通用控件库','success');
}
function sharedControlModals(m){
  if(m.kind==='control-picker')return controlPickerModal(m);
  if(m.kind==='control-categories')return header('管理分类')+`<div class="modal-body"><p class="field-help">分类用于组织共享控件，删除分类后控件会移至「未分类」。</p><div class="control-category-list">${S.controls.categories.map(category=>`<div class="control-category-row"><span>${esc(category.name)} <small>${category.count||0} 个控件</small></span>${button('改名','edit-category','ghost','',`data-id="${category.id}"`)}${button('删除','delete-category','danger','',`data-id="${category.id}"`)}</div>`).join('')||'<div class="empty compact">还没有分类。</div>'}</div></div><footer class="modal-footer">${button('关闭','close-modal')}${button('新建分类','new-category','primary','plus')}</footer>`;
  if(m.kind==='category-editor')return header(m.id?'修改分类名称':'新建分类')+`<div class="modal-body">${field('分类名称',input(m.name,'data-category-name','text','maxlength="80"'))}</div><footer class="modal-footer">${button('取消','close-modal')}${button('保存分类','save-category','primary')}</footer>`;
  return null;
}
async function sharedControlAction(action,node){
  const index=Number(node.dataset.i);
  if(action==='choose-control'){await openControlPicker(node.dataset.field);return true;}
  if(action.startsWith('picker-')){
    const m=S.modal;if(m?.kind!=='control-picker')return true;
    if(action==='picker-category'){m.category=node.dataset.category;renderControlPickerResults();}
    if(action==='picker-select'){
      const entry=S.controls.entries.find(item=>item.id===node.dataset.id);
      if(!entry||(m.imageOnly&&entry.selector.kind!=='image'))return true;
      m.selectedId=entry.id;m.clear=false;renderControlPickerResults();
    }
    if(action==='picker-clear'){m.selectedId='';m.clear=true;renderControlPickerResults();}
    if(action==='picker-accept'){
      if(lock())return true;
      if(S.project!==m.project||!S.project.steps.includes(m.step))throw new Error('步骤已发生变化，请重新选择控件');
      const entry=S.controls.entries.find(item=>item.id===m.selectedId);
      if(!m.clear&&(!entry||(m.imageOnly&&entry.selector.kind!=='image')))throw new Error('请先选择控件');
      m.step[m.key]=m.clear?'':useControl(entry.selector.name).name;
      dirty();closeModal();render();
    }
    return true;
  }
  if(action==='control-filter'){S.targetCategory=node.dataset.category;render();return true;}
  if(action==='control-refresh'){await refreshControls();return true;}
  if(action==='control-clear-search'){S.targetSearch='';render();return true;}
  if(action==='control-categories'){if(!lock())showModal({kind:'control-categories'});return true;}
  if(action==='new-category'||action==='edit-category'){
    if(lock())return true;
    const category=S.controls.categories.find(item=>item.id===node.dataset.id);
    showModal({kind:'category-editor',id:category?.id||null,name:category?.name||''});return true;
  }
  if(action==='save-category'){
    if(lock())return true;
    const data=await api('control_category_save',{id:S.modal.id,name:S.modal.name});setControls(data);
    closeModal();render();toast('分类已保存','success');return true;
  }
  if(action==='delete-category'){
    if(lock())return true;
    const id=node.dataset.id,category=S.controls.categories.find(item=>item.id===id);
    if(await confirm(`删除分类「${category.name}」？`,'分类中的控件会移至「未分类」，不会被删除。')){
      setControls(await api('control_category_delete',{id}));render();showModal({kind:'control-categories'});
    }return true;
  }
  if(action==='delete-target'){
    if(lock())return true;
    const entry=S.controls.entries[index];
    if(!entry)throw new Error('控件已不存在，请刷新');
    if(S.controls.entries.some(row=>row.id!==entry.id&&row.selector.anchor===entry.selector.name))throw new Error('这个控件仍被用作定位锚点');
    const used=usedIds.has(entry.id);
    if(used)throw new Error('这个控件仍被当前用例使用，请先移除对应引用');
    if(await confirm(`删除通用控件「${entry.selector.name}」？`,'已被用例或定位锚点引用的控件无法删除。')){
      setControls(await api('control_delete',{id:entry.id,current_ids:projectControlIds()}));S.project.selectors=S.project.selectors.filter(item=>item.library_id!==entry.id);render();
    }return true;
  }
  if(action==='preview-target'){
    if(!S.handle)throw new Error('请先连接游戏窗口');
    const target=S.controls.entries[index]?.selector;if(!target)throw new Error('控件已不存在，请刷新');
    const shot=await api('preview',{handle:S.handle,selector:target,selectors:controlSelectors()});showModal({kind:'preview',shot});return true;
  }
  return false;
}