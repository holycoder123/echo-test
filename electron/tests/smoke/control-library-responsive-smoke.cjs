const assert=require('node:assert/strict');
const fs=require('node:fs');
const {artifactFile}=require('../../paths.cjs');
async function verify(window){
  const result=await window.webContents.executeJavaScript(`(async()=>{
    const saved={project:S.project,view:S.view,dirty:S.dirty,controls:S.controls,targetCategory:S.targetCategory,targetSearch:S.targetSearch,thumbnails:S.thumbnails};
    const original=api,result={},calls=[];let active=0,maximum=0,ticks=0;
    const timer=setInterval(()=>ticks++,5);
    try{
      const entries=Array.from({length:150},(_,i)=>{const id=i.toString(16).padStart(32,'0');return {id,category_id:'',selector:{...defaultSelector(),name:'压力控件_'+i,library_id:id,kind:'image',image:'assets/stress_'+(i%30)+'.png'}};});
      const bank={entries,categories:[],total:entries.length,uncategorized:entries.length,warnings:[]};
      S.project={name:'控件库响应测试',schema_version:1,steps:[{name:'引用丢失快照',action:'click',target:entries[0].selector.name}],selectors:[]};
      S.controls=bank;S.targetCategory='all';S.targetSearch='';S.thumbnails={};thumbnailFailures.clear();
      api=async(method,args)=>{
        if(method==='control_list')return clone(bank);
        if(method==='dirty')return {};
        if(method==='template_preview'){
          calls.push(args.image);active++;maximum=Math.max(maximum,active);
          try{await new Promise(resolve=>setTimeout(resolve,20));return {image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZuoAAAAASUVORK5CYII='};}finally{active--;}
        }
        return original(method,args);
      };
      await handleAction('view-targets',{dataset:{}});
      result.opensWithMissingDefinitions=S.view==='targets'&&S.project.selectors.length===0&&document.querySelectorAll('.target-card').length===150;
      let search=document.querySelector('#target-search');search.value='压力控件_1';search.dispatchEvent(new Event('input',{bubbles:true}));search=document.querySelector('#target-search');
      const card=document.querySelector('.target-card'),firstImage=card.querySelector('img');
      for(let i=0;i<300&&(active||thumbnailRequests.size||thumbnailQueue.length);i++)await new Promise(resolve=>setTimeout(resolve,10));
      result.backgroundLoadingFinished=!active&&!thumbnailRequests.size&&!thumbnailQueue.length;
      result.boundedConcurrency=maximum<=4&&maximum>0;
      result.duplicatePathsLoadedOnce=calls.length===30&&new Set(calls).size===30;
      result.noPageRebuild=document.querySelector('#target-search')===search&&document.querySelector('.target-card')===card;
      result.searchFocusPreserved=document.activeElement===search&&search.value==='压力控件_1';
      result.imagesUpdated=firstImage&&!firstImage.hidden&&!!firstImage.src;
      result.eventLoopResponsive=ticks>5;
      await handleAction('view-help',{dataset:{}});result.canSwitchViews=S.view==='help';
      result.errors=window.__studioErrors;return result;
    }finally{clearInterval(timer);api=original;Object.assign(S,saved);render();}
  })()`);
  for(const [key,value] of Object.entries(result))if(key!=='errors')assert.equal(value,true,key);
  assert.deepEqual(result.errors,[]);result.passed=true;
  fs.writeFileSync(artifactFile('smoke','control-library-responsive-smoke.json'),JSON.stringify(result,null,2));
}
module.exports={verify};
