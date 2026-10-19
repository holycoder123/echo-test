const assert=require('node:assert/strict');
const fs=require('node:fs');
const {artifactFile}=require('../../paths.cjs');
async function verify(window){
  const result=await window.webContents.executeJavaScript(`(async()=>{
    const saved={windows:S.windows,windowSearch:S.windowSearch,connection:S.connection,handle:S.handle,view:S.view,busy:S.busy,connecting:S.connecting};
    const original=api,calls=[],result={};
    let discovered=[{handle:91001,pid:101,title:'编辑器 · Draft <1>',process_name:'Editor.EXE'},
      {handle:91002,pid:202,title:'计算器',process_name:'Calc.exe'},
      {handle:91003,pid:303,title:'浏览器',process_name:'Chrome.EXE'}];
    const type=value=>{const field=document.querySelector('#window-search');field.focus();field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));return field;};
    const choices=()=>[...document.querySelector('#connection').options].filter(option=>option.value);
    const pause=()=>new Promise(resolve=>setTimeout(resolve,20));
    api=async(method,args)=>{
      calls.push({method,args});
      if(method==='windows')return {windows:clone(discovered),admin:S.admin};
      if(method==='game_connect')return {connection:clone(discovered.find(item=>item.handle===args.handle))};
      if(method==='game_disconnect')return {connection:null};
      if(method==='game_focus')return {};
      return original(method,args);
    };
    try{
      S.connection=null;S.handle=null;S.windowSearch='';S.windows=clone(discovered);S.busy='';S.view='cases';render();
      result.allVisible=choices().length===3&&choices()[0].textContent.includes('Editor.EXE')&&choices()[0].textContent.includes('PID 101');
      const before=calls.length,field=type('编辑器');
      result.titleSearch=choices().length===1&&choices()[0].value==='91001';
      type('eDiToR');result.processNameSearch=choices().length===1&&choices()[0].value==='91001';
      type('303');result.pidSearch=choices().length===1&&choices()[0].value==='91003';
      type('editor 101');result.multipleWords=choices().length===1&&choices()[0].value==='91001';
      result.localFilteringKeepsFocus=document.querySelector('#window-search')===field&&document.activeElement===field&&calls.length===before;
      result.titleEscaped=choices()[0].textContent.includes('<1>')&&!document.querySelector('#connection script');
      type('unknown');result.noMatch=choices().length===0&&document.querySelector('#connection').textContent.includes('没有匹配')&&document.querySelector('#window-connect').disabled;
      const previous=calls.filter(call=>call.method==='game_connect').length;await reconnectGame();
      result.noUnexpectedConnection=S.connection===null&&calls.filter(call=>call.method==='game_connect').length===previous;
      document.querySelector('[data-act="window-search-clear"]').click();await pause();
      result.clearRestoresAll=S.windowSearch===''&&choices().length===3&&document.activeElement.id==='window-search';
      await connectGame(91001);type('chrome');
      result.currentConnectionPinned=S.connection.handle===91001&&document.querySelector('#connection').value==='91001'&&choices().length===2&&document.querySelector('#connection optgroup').label.includes('当前连接');
      type('unknown');result.noMatchKeepsConnection=S.connection.handle===91001&&document.querySelector('#window-connect').disabled;
      type('chrome');document.querySelector('#window-connect').click();await pause();
      result.connectSingleSearchResult=S.connection.handle===91003&&document.querySelector('#connection').value==='91003';
      type('calc');S.view='help';render();result.searchSurvivesNavigation=document.querySelector('#window-search').value==='calc';
      discovered.push({handle:91004,pid:404,title:'小型计算器',process_name:'CalcLite.exe'});await refreshGameWindows();
      result.refreshPreservesQuery=S.windowSearch==='calc'&&matchingWindows().length===2&&S.connection.handle===91003;
      const connected=calls.filter(call=>call.method==='game_connect').length;await reconnectGame();
      result.multipleMatchesRequireChoice=calls.filter(call=>call.method==='game_connect').length===connected;
      const select=document.querySelector('#connection');select.value='91002';select.dispatchEvent(new Event('change',{bubbles:true}));await pause();
      result.dropdownConnectsFilteredWindow=S.connection.handle===91002;
      S.busy='running';render();result.lockedDuringRun=document.querySelector('#window-search').disabled&&document.querySelector('#connection').disabled&&document.querySelector('#window-connect').disabled;
      S.busy='';discovered=discovered.filter(item=>item.handle!==91002);await refreshGameWindows();
      result.closedWindowDisconnects=S.connection===null&&S.windowSearch==='calc'&&matchingWindows()[0].handle===91004;
      S.view='cases';type('calc');render();window.__windowSearchPreview={windows:S.windows,windowSearch:S.windowSearch,connection:S.connection,view:S.view,handle:S.handle};
      result.errors=window.__studioErrors;return result;
    }finally{api=original;Object.assign(S,saved);render();}
  })()`);
  for(const [key,value] of Object.entries(result))if(key!=='errors')assert.equal(value,true,key);
  assert.deepEqual(result.errors,[]);result.passed=true;
  await window.webContents.executeJavaScript(`(async()=>{
    window.__windowSearchVisualSaved={windows:S.windows,windowSearch:S.windowSearch,connection:S.connection,view:S.view,handle:S.handle};
    Object.assign(S,window.__windowSearchPreview);render();document.querySelector('#toasts').replaceChildren();
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  })()`);
  const size=window.getSize();
  try{
    window.setSize(1120,740);await new Promise(resolve=>setTimeout(resolve,100));
    result.minimumWidthLayout=await window.webContents.executeJavaScript(`[...document.querySelectorAll('#window-search,#connection,#window-connect,.topbar-right>[data-act="refresh"]')].every(node=>{const rect=node.getBoundingClientRect();return rect.width>0&&rect.left>=0&&rect.right<=innerWidth&&rect.top>=0&&rect.bottom<=100;})`);
    assert.equal(result.minimumWidthLayout,true,'window search fits minimum window size');
    window.setSize(...size);await new Promise(resolve=>setTimeout(resolve,100));
    fs.writeFileSync(artifactFile('smoke','window-search-preview.png'),(await window.webContents.capturePage()).toPNG());
    fs.writeFileSync(artifactFile('smoke','window-search-smoke.json'),JSON.stringify(result,null,2));
  }finally{window.setSize(...size);await window.webContents.executeJavaScript('Object.assign(S,window.__windowSearchVisualSaved);render();delete window.__windowSearchVisualSaved;delete window.__windowSearchPreview');}

}
module.exports={verify};
