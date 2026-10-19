const assert=require('node:assert/strict');
const fs=require('node:fs');
const {artifactFile}=require('../../paths.cjs');

async function verify(window) {
  const result=await window.webContents.executeJavaScript(`(async()=>{
    const saved={project:clone(S.project),view:S.view,dirty:S.dirty,handle:S.handle,controls:clone(S.controls),category:S.targetCategory};
    const original=api;const calls=[];const result={};
    try {
      const title={...defaultSelector(),library_id:'a'.repeat(32),name:'标题',kind:'image',image:'assets/title.png'};
      S.controls={entries:[{id:title.library_id,category_id:'',selector:title}],categories:[],uncategorized:1,total:1,warnings:[]};S.targetCategory='all';
      S.project={name:'识别冒烟',schema_version:1,selectors:[clone(title)],steps:[]};
      S.view='targets';S.handle=99123;render();
      api=async(method,args)=>{
        calls.push({method,args});
        if(method==='control_save'){
          const old=S.controls.entries.find(entry=>entry.id===args.id),id=args.id||'b'.repeat(32);
          const selector={...clone(args.selector),library_id:id};
          const entries=S.controls.entries.filter(entry=>entry.id!==id).map(entry=>({...clone(entry),selector:{...entry.selector,anchor:old&&entry.selector.anchor===old.selector.name?selector.name:entry.selector.anchor}}));
          entries.splice(old?S.controls.entries.indexOf(old):entries.length,0,{id,category_id:args.category_id,selector});
          return {...clone(S.controls),entries,total:entries.length,uncategorized:entries.length};
        }
        if(method==='import_template')return {image:'assets/hover.png'};
        if(method==='template_preview')return {image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZuoAAAAASUVORK5CYII='};
        if(method==='preview')return {width:220,height:160,image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZuoAAAAASUVORK5CYII=',point:null,score:.82,box:[80,60,24,20],matched:false,diagnostic:{matched:false,reason:'候选匹配度低于阈值',candidate:{score:.82,scale:1.1,image:'assets/hover.png'}}};
        return original(method,args);
      };
      await editTarget();S.modal.draft.kind='image';renderModal();
      result.templateSettings=!!document.querySelector('[data-dfield="color_tolerance"]')&&!!document.querySelector('[data-act="import-mask"]')===false&&!!document.querySelector('[data-act="import-variant"]');
      await handleAction('import-image',{dataset:{}});
      await handleAction('import-variant',{dataset:{}});
      await handleAction('import-mask',{dataset:{variant:'0'}});
      const draft=S.modal.draft;draft.name='按钮';draft.anchor='标题';draft.roi=[-5,20,100,50];draft.color_tolerance=40;renderModal();
      result.maskAndVariant=!!document.querySelector('[data-act="clear-mask"]')&&draft.templates[0].mask==='assets/hover.png';
      await saveTarget();
      result.savedSettings=S.controls.entries[1].selector.anchor==='标题'&&S.controls.entries[1].selector.templates.length===1;
      await editTarget(1);S.modal.draft.recognition='ocr';renderModal();
      result.ocrFields=!!document.querySelector('[data-dfield="text"]')&&!document.querySelector('[data-act="import-image"]');
      S.modal.draft.text='完成任务';S.modal.draft.image='';await saveTarget();
      result.ocrSaved=S.controls.entries[1].selector.recognition==='ocr'&&S.controls.entries[1].selector.text==='完成任务';
      await handleAction('preview-target',{dataset:{i:'1'}});
      result.missBox=!!document.querySelector('.recognition-miss')&&!document.querySelector('.pick-point')&&document.querySelector('#pick-hint').textContent.includes('未命中');
      result.previewSuppliesAnchors=calls.find(call=>call.method==='preview').args.selectors.length===2;
      closeModal();await editTarget(0);S.modal.draft.name='新标题';await saveTarget();
      result.renameUpdatesAnchor=S.controls.entries[1].selector.anchor==='新标题';
      try{await handleAction('delete-target',{dataset:{i:'0'}});}catch(error){result.deleteAnchorProtected=error.message.includes('锚点');}
      result.errors=window.__studioErrors;
      return result;
    }finally{api=original;closeModal();Object.assign(S,saved);S.targetCategory=saved.category;render();}
  })()`);
  for(const [key,value] of Object.entries(result))if(key!=='errors')assert.equal(value,true,key);
  assert.deepEqual(result.errors,[]);
  result.passed=true;
  fs.writeFileSync(artifactFile('smoke','recognition-smoke.json'),JSON.stringify(result,null,2));
}
module.exports={verify};
