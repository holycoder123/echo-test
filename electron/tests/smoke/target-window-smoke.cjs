// UI fixture only: window enumeration, picking and connecting send no real input.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {artifactFile}=require('../../paths.cjs');
async function verify(main){
  const js=code=>main.webContents.executeJavaScript(code),result={};
  try{
    Object.assign(result,await js(`(async()=>{
      window.__targetSaved={api,view:S.view,windows:S.windows,windowSearch:S.windowSearch,connection:S.connection,handle:S.handle,targetWindowMode:S.targetWindowMode,windowPicking:S.windowPicking,busy:S.busy,dirty:S.dirty};
      window.__targetProject=JSON.stringify(S.project);window.__targetPath=S.path;window.__targetCalls=[];
      window.__targetWindows=[{handle:94101,pid:301,title:'测试客户端 · 开发环境',process_name:'GameClient.exe'},
        {handle:94102,pid:302,title:'设计文档 — 项目工作区',process_name:'Editor.exe'},
        {handle:94103,pid:303,title:'浏览器 — 自动化测试平台',process_name:'chrome.exe'},
        {handle:94104,pid:304,title:'日志查看器',process_name:'LogViewer.exe'},
        {handle:94105,pid:305,title:'调试窗口 <Draft>',process_name:'Debug.exe'}];
      api=async(method,args)=>{
        window.__targetCalls.push({method,args});
        if(method==='windows')return {windows:clone(window.__targetWindows),admin:S.admin};
        if(method==='window_pick_start')return new Promise(resolve=>window.__targetPickResolve=resolve);
        if(method==='window_pick_cancel'){window.__targetPickResolve({selected:null,cancelled:true});return {cancelled:true};}
        if(method==='game_connect')return {connection:{...window.__targetWindows.find(item=>item.handle===args.handle),width:1024,height:700}};
        if(method==='game_disconnect')return {};
        if(method==='game_focus')return {};
        if(method==='game_open')throw new Error('选择页面入口不能直接打开工具栏');
        return window.__targetSaved.api(method,args);
      };
      Object.assign(S,{connection:null,handle:null,windowSearch:'',targetWindowMode:'pick',windowPicking:false,busy:'',dirty:true});
      await handleAction('view-select-window',{dataset:{}});
      return {navigation:S.view==='select-window'&&document.querySelector('.nav-button.active').textContent.trim()==='选择目标窗口',
        twoMethods:document.querySelectorAll('.target-method').length===2,
        pickInstructions:document.querySelector('.target-point-copy').textContent.includes('单击')&&!!document.querySelector('[data-act="target-pick-start"]'),
        noAutomaticConnection:!window.__targetCalls.some(call=>['game_connect','game_focus','game_open'].includes(call.method))};
    })()`));
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await new Promise(resolve=>setTimeout(resolve,80));
    fs.writeFileSync(artifactFile('smoke','target-window-pick-preview.png'),(await main.webContents.capturePage()).toPNG());
    Object.assign(result,await js(`(async()=>{
      const choosing=chooseTargetWindow();
      const picking=S.windowPicking&&!!document.querySelector('[data-act="target-pick-cancel"]');
      window.__targetPickResolve({selected:window.__targetWindows[0],connection:{...window.__targetWindows[0],width:1024,height:700},cancelled:false});await choosing;
      const confirmed=S.connection.handle===94101&&!S.windowPicking&&document.querySelector('.target-current').textContent.includes('GameClient.exe');
      const cancelled=chooseTargetWindow();await handleAction('target-pick-cancel',{dataset:{}});await cancelled;
      const cancelPreservesTarget=!S.windowPicking&&S.connection.handle===94101;
      await handleAction('target-mode',{dataset:{mode:'search'}});
      return {picking,confirmed,cancelPreservesTarget,table:document.querySelectorAll('.target-window-table tbody tr').length===5,
        connectedBadge:document.querySelector('.target-window-table tr.connected').textContent.includes('当前目标')};
    })()`));
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await new Promise(resolve=>setTimeout(resolve,80));
    fs.writeFileSync(artifactFile('smoke','target-window-search-preview.png'),(await main.webContents.capturePage()).toPNG());
    Object.assign(result,await js(`(async()=>{
      const search=document.querySelector('#target-window-search');search.focus();search.value='editor';search.dispatchEvent(new Event('input',{bubbles:true}));
      const filter=document.querySelectorAll('.target-window-table tbody tr').length===1&&document.querySelector('.target-window-table').textContent.includes('Editor.exe')&&document.activeElement===search;
      await handleAction('target-connect',{dataset:{handle:'94102'}});
      const call=window.__targetCalls.filter(item=>item.method==='game_connect').at(-1);
      const rowConnect=S.connection.handle===94102&&call.args.expected_pid===302;
      await handleAction('window-search-clear',{dataset:{}});
      const cleared=S.windowSearch===''&&document.querySelectorAll('.target-window-table tbody tr').length===5;
      await handleAction('target-disconnect',{dataset:{}});
      return {filter,rowConnect,cleared,disconnect:S.connection===null&&S.handle===null,
        projectPreserved:JSON.stringify(S.project)===window.__targetProject&&S.path===window.__targetPath&&S.dirty,
        errors:window.__studioErrors};
    })()`));
    const previousSize=main.getSize();main.setSize(1120,740);
    try{
      await new Promise(resolve=>setTimeout(resolve,100));
      result.minimumWidthLayout=await js(`document.body.scrollWidth<=innerWidth&&[...document.querySelectorAll('.target-method,.target-list-tools,.target-window-table')].every(node=>{const rect=node.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth;})`);
      result.minimumWidthPicker=await js(`S.targetWindowMode='pick';render();document.body.scrollWidth<=innerWidth&&(()=>{const rect=document.querySelector('[data-act="target-pick-start"]').getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth&&rect.bottom<innerHeight;})()`);
    }finally{main.setSize(...previousSize);}
    for(const [name,value] of Object.entries(result))if(name!=='errors')assert.equal(value,true,name);
    assert.deepEqual(result.errors,[]);result.passed=true;
  }catch(error){result.error=error.stack;throw error;}
  finally{
    fs.writeFileSync(artifactFile('smoke','target-window-smoke.json'),JSON.stringify(result,null,2));
    await js(`if(window.__targetSaved){const saved=window.__targetSaved;api=saved.api;delete saved.api;Object.assign(S,saved);render();}`);
  }
}
module.exports={verify};
