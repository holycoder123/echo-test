// Exercise the persisted shared library with an isolated application data root.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {artifactFile}=require('../../paths.cjs');
async function verify(window){
  const result=await window.webContents.executeJavaScript(`(async()=>{
    const saved={project:clone(S.project),path:S.path,view:S.view,dirty:S.dirty,selected:S.selected,search:S.targetSearch,category:S.targetCategory};
    const created=[],stamp=Date.now(),name='Shared_'+stamp,categoryName='任务_'+stamp;
    const result={};let category;
    try{
      await handleAction('new-category',{dataset:{}});
      const field=document.querySelector('[data-category-name]');field.value=categoryName;field.dispatchEvent(new Event('input',{bubbles:true}));
      await handleAction('save-category',{dataset:{}});
      category=S.controls.categories.find(item=>item.name===categoryName);
      result.categoryCreated=!!category;
      S.view='targets';S.targetCategory=category.id;S.targetSearch='';render();await editTarget();
      result.categoryEditor=!!document.querySelector('#control-category-choice')&&S.modal.categoryId===category.id;
      S.modal.draft.name=name;await saveTarget();
      const entry=S.controls.entries.find(item=>item.selector.name===name);created.push(entry.id);
      result.controlStored=entry.category_id===category.id;
      const second=await api('control_save',{selector:{...defaultSelector(),name:'OCR_'+stamp,kind:'image',recognition:'ocr',text:'领取奖励_'+stamp}});
      const other=second.control;created.push(other.id);setControls(second);
      S.targetSearch=categoryName+' shared_'+stamp;render();
      result.nameAndCategorySearch=document.querySelectorAll('.target-card').length===1&&!!document.querySelector('[data-control-id="'+entry.id+'"]');
      S.targetCategory='all';S.targetSearch='领取奖励_'+stamp;render();
      result.ocrSearch=document.querySelectorAll('.target-card').length===1&&!!document.querySelector('[data-control-id="'+other.id+'"]');
      S.targetSearch='no_match_'+stamp;render();result.emptySearch=document.querySelectorAll('.target-card').length===0&&document.querySelector('.empty strong').textContent==='没有匹配的控件';
      S.targetSearch='';await handleAction('control-filter',{dataset:{category:category.id}});
      result.categoryFilter=document.querySelectorAll('.target-card').length===1&&document.querySelector('.control-category.active').getAttribute('aria-pressed')==='true';
      const bank=clone(S.controls),blank=label=>({project:{name:label,schema_version:1,selectors:[],steps:[]},path:null,controls:bank});
      setProject(blank('共享引用甲'));S.view='cases';addStep('click');
      await handleAction('choose-control',{dataset:{field:'target'}});await handleAction('picker-select',{dataset:{id:entry.id}});await handleAction('picker-accept',{dataset:{}});
      result.stepReferencesShared=S.project.steps[0].target===name&&S.project.selectors.some(item=>item.library_id===entry.id);
      const first=clone(S.project),count=S.controls.entries.length;
      setProject(blank('共享引用乙'));S.view='targets';S.targetCategory='all';render();
      result.caseSwitchKeepsLibrary=S.controls.entries.length===count&&!!document.querySelector('[data-control-id="'+entry.id+'"]')&&S.project.selectors.length===0;
      S.view='cases';addStep('click');await handleAction('choose-control',{dataset:{field:'target'}});await handleAction('picker-select',{dataset:{id:entry.id}});await handleAction('picker-accept',{dataset:{}});
      await editTarget(S.controls.entries.findIndex(item=>item.id===entry.id));S.modal.draft.name=name+'_updated';S.modal.draft.x=.8;await saveTarget();
      result.currentReferenceUpdated=S.project.steps[0].target===name+'_updated'&&S.project.selectors.find(item=>item.library_id===entry.id).x===.8;
      S.project=first;setControls(S.controls);render();
      result.otherCaseUpdated=S.project.steps[0].target===name+'_updated'&&S.project.selectors.find(item=>item.library_id===entry.id).x===.8;
      try{await api('control_delete',{id:entry.id,current_ids:projectControlIds()});}catch(error){result.referenceProtected=error.message.includes('当前用例');}
      setControls(await api('control_category_save',{id:category.id,name:categoryName+'_renamed'}));
      S.view='targets';S.targetCategory='all';S.targetSearch=categoryName+'_renamed';render();
      result.categoryRenamed=document.querySelectorAll('.target-card').length===1;
      window.__sharedControlPreview={controls:clone(S.controls),project:clone(S.project)};
      setControls(await api('control_category_delete',{id:category.id}));category=null;
      result.categoryDeleteKeepsControl=S.controls.entries.find(item=>item.id===entry.id).category_id==='';
      await refreshControls();result.persisted=S.controls.entries.find(item=>item.id===entry.id).selector.x===.8;
      result.errors=window.__studioErrors;return result;
    }finally{
      closeModal();S.project={name:'清理',schema_version:1,selectors:[],steps:[]};
      if(category)await api('control_category_delete',{id:category.id});
      for(const id of created)await api('control_delete',{id,current_ids:[]});
      S.project=saved.project;S.path=saved.path;S.view=saved.view;S.dirty=saved.dirty;S.selected=saved.selected;S.targetSearch=saved.search;S.targetCategory=saved.category;
      setControls(await api('control_list'));render();await api('dirty',{value:S.dirty,caseName:S.project.name});
    }
  })()`);
  for(const [key,value] of Object.entries(result))if(key!=='errors')assert.equal(value,true,key);
  assert.deepEqual(result.errors,[]);result.passed=true;
  await window.webContents.executeJavaScript("window.__sharedVisualSaved={controls:S.controls,project:S.project,view:S.view,category:S.targetCategory,search:S.targetSearch};Object.assign(S,window.__sharedControlPreview);S.view='targets';S.targetCategory='all';S.targetSearch='';document.querySelector('#toasts').replaceChildren();render()");
  await new Promise(resolve=>setTimeout(resolve,180));
  try{fs.writeFileSync(artifactFile('smoke','shared-controls-preview.png'),(await window.webContents.capturePage()).toPNG());}
  finally{await window.webContents.executeJavaScript("(()=>{const saved=window.__sharedVisualSaved;S.controls=saved.controls;S.project=saved.project;S.view=saved.view;S.targetCategory=saved.category;S.targetSearch=saved.search;render();delete window.__sharedVisualSaved;delete window.__sharedControlPreview})()");}
  fs.writeFileSync(artifactFile('smoke','shared-controls-smoke.json'),JSON.stringify(result,null,2));
  return result;
}
module.exports={verify};