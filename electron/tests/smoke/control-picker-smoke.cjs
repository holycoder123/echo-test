const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {ROOT,artifactFile}=require('../../paths.cjs');
async function verify(window){
  const asset=path.join(ROOT,'test_cases','assets','template_b561edf49377.png');
  const image=fs.existsSync(asset)?'data:image/png;base64,'+fs.readFileSync(asset).toString('base64'):'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZuoAAAAASUVORK5CYII=';
  const result=await window.webContents.executeJavaScript(`(async()=>{
    const saved={project:S.project,path:S.path,view:S.view,dirty:S.dirty,selected:S.selected,controls:S.controls,thumbnails:S.thumbnails,handle:S.handle};
    const original=api,calls=[],result={};
    window.__controlPickerSaved=saved;
    const entry=(id,name,extra={},category='任务')=>({id,category_id:category,selector:{...defaultSelector(),library_id:id,name,...extra}});
    const entries=[entry('a'.repeat(32),'初始任务_初临曙光站',{kind:'image',image:'picker-primary.png'}),entry('b'.repeat(32),'领取奖励',{kind:'image',image:'',templates:[{image:'picker-variant.png',mask:''}]}),entry('c'.repeat(32),'确认文字',{kind:'image',recognition:'ocr',text:'完成任务'}),entry('d'.repeat(32),'移动终点',{x:.8,y:.2,image:'assets/old-coordinate.png',templates:[{image:'assets/old-coordinate-variant.png',mask:''}]},'')];
    try{
      S.controls={entries,categories:[{id:'任务',name:'主线任务',count:3}],uncategorized:1,total:4,warnings:[]};
      S.project={name:'控件选择预览',schema_version:1,selectors:[clone(entries[0].selector)],steps:[{name:'单击任务',action:'click',target:entries[0].selector.name,enabled:true,params:{}}]};
      S.path=null;S.view='cases';S.selected=0;S.handle=null;S.thumbnails={};S.dirty=false;
      api=async(method,args)=>{
        calls.push({method,args});
        if(method==='control_list')return clone(S.controls);
        if(method==='template_preview'){await new Promise(resolve=>setTimeout(resolve,60));return {image:${JSON.stringify(image)}};}
        if(method==='dirty')return {};
        return original(method,args);
      };
      render();result.trigger=!!document.querySelector('[data-act="choose-control"][data-field="target"]')&&!document.querySelector('select[data-sfield="target"]');
      const opening=handleAction('choose-control',{dataset:{field:'target'}});
      await new Promise(resolve=>setTimeout(resolve,20));
      const search=modal.querySelector('#control-picker-search');search.value='主线 初始';search.dispatchEvent(new Event('input',{bubbles:true}));
      await opening;
      const pictures=[...modal.querySelectorAll('img[data-control-image]')];await Promise.all(pictures.map(img=>img.decode()));
      result.imagesVisible=pictures.length===2&&pictures.every(img=>!img.hidden&&img.naturalWidth>0&&img.getBoundingClientRect().height>0);
      result.imageLoadingKeepsSearch=document.activeElement===search&&search.value==='主线 初始';
      result.search=modal.querySelectorAll('.control-picker-card').length===1;
      result.currentHighlighted=modal.querySelector('.control-picker-card.selected').dataset.id===entries[0].id;
      result.enlargedPreview=modal.querySelector('#control-picker-detail img').getBoundingClientRect().width>modal.querySelector('.control-picker-card img').getBoundingClientRect().width;
      search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));
      await handleAction('picker-category',{dataset:{category:''}});
      result.category=modal.querySelectorAll('.control-picker-card').length===1&&modal.querySelector('.control-category.active').dataset.category==='';
      result.coordinateCardShowsPosition=modal.querySelector('.control-picker-card').textContent.includes('80.0%')&&!modal.querySelector('.control-picker-card img');
      await handleAction('picker-select',{dataset:{id:entries[3].id}});
      result.coordinateDetailHasNoImage=!modal.querySelector('#control-picker-detail img')&&modal.querySelector('#control-picker-detail').textContent.includes('80.0%');
      closeModal();
      result.cancelUnchanged=S.project.steps[0].target===entries[0].selector.name&&!S.dirty;
      await handleAction('choose-control',{dataset:{field:'target'}});
      const card=modal.querySelector('[data-id="'+entries[1].id+'"]');card.focus();card.click();await new Promise(resolve=>setTimeout(resolve,0));
      result.keyboardFocus=document.activeElement?.dataset.id===entries[1].id;
      await modal.querySelector('#control-picker-detail img').decode();
      result.variantImage=modal.querySelector('#control-picker-detail img').dataset.controlImage==='picker-variant.png'&&!modal.querySelector('#control-picker-detail img').hidden;
      modal.querySelector('[data-act="picker-accept"]').click();await new Promise(resolve=>setTimeout(resolve,0));
      result.confirm=S.project.steps[0].target===entries[1].selector.name&&S.project.selectors.some(item=>item.library_id===entries[1].id)&&!modal.open;
      S.project.steps[0].action='assert_image';render();await handleAction('choose-control',{dataset:{field:'target'}});
      result.imageOnly=modal.querySelectorAll('.control-picker-card').length===3&&!modal.querySelector('[data-id="'+entries[3].id+'"]');
      const before=S.modal.selectedId;await handleAction('picker-select',{dataset:{id:entries[3].id}});result.coordinateRejected=S.modal.selectedId===before;
      await handleAction('picker-select',{dataset:{id:entries[2].id}});result.ocrText=modal.querySelector('#control-picker-detail').textContent.includes('完成任务');closeModal();
      S.project.steps[0].action='drag';render();await handleAction('choose-control',{dataset:{field:'end_target'}});
      await handleAction('picker-select',{dataset:{id:entries[3].id}});await handleAction('picker-accept',{dataset:{}});
      result.dragEnd=S.project.steps[0].end_target==='移动终点'&&S.project.steps[0].target===entries[1].selector.name;
      await handleAction('choose-control',{dataset:{field:'end_target'}});await handleAction('picker-clear',{dataset:{}});await handleAction('picker-accept',{dataset:{}});
      result.clear=S.project.steps[0].end_target==='';
      await handleAction('choose-control',{dataset:{field:'target'}});S.busy='running';const selected=S.project.steps[0].target;await handleAction('picker-accept',{dataset:{}});S.busy='';
      result.operationLock=S.project.steps[0].target===selected&&modal.open;closeModal();
      result.noCoordinateImageRequests=!calls.some(call=>call.method==='template_preview'&&call.args.image.includes('old-coordinate'));
      closeModal();await editTarget(3);closeModal();
      await refreshControls();
      result.coordinateEditorAndRefreshSkipImages=!calls.some(call=>call.method==='template_preview'&&call.args.image.includes('old-coordinate'));
      result.noGameRequired=!calls.some(call=>['capture','preview'].includes(call.method))&&S.handle===null;
      S.project.steps[0].action='click';S.project.steps[0].target=entries[0].selector.name;render();await handleAction('choose-control',{dataset:{field:'target'}});
      for(const img of modal.querySelectorAll('img[data-control-image]'))await img.decode();
      document.querySelector('#toasts').replaceChildren();
      result.errors=window.__studioErrors;return result;
    }catch(error){api=original;closeModal();Object.assign(S,saved);render();throw error;}
    finally{api=original;}
  })()`);
  try{
    for(const [key,value] of Object.entries(result))if(key!=='errors')assert.equal(value,true,key);
    assert.deepEqual(result.errors,[]);result.passed=true;
    fs.writeFileSync(artifactFile('smoke','control-picker-preview.png'),(await window.webContents.capturePage()).toPNG());
    fs.writeFileSync(artifactFile('smoke','control-picker-smoke.json'),JSON.stringify(result,null,2));
  }finally{await window.webContents.executeJavaScript('closeModal();Object.assign(S,window.__controlPickerSaved);delete window.__controlPickerSaved;render()');}
}
module.exports={verify};
