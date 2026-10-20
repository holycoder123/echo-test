// Discovery is mocked: no real application is connected, focused or controlled.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {artifactFile}=require('../../paths.cjs');
async function verify(window){
  const expected=Number(process.env.ECHO_TEST_DISCOVERY_EXPECT_HANDLE||0);
  let realStartupWindow=false;
  if(expected){
    realStartupWindow=await window.webContents.executeJavaScript('S.windows.some(item=>item.handle==='+expected+')');
    assert.equal(realStartupWindow,true,'the real target must appear in the startup window list');
  }
  const result=await window.webContents.executeJavaScript(`(async()=>{
    const original=api,saved={windows:S.windows,windowSearch:S.windowSearch,connection:S.connection,handle:S.handle,view:S.view,busy:S.busy,connecting:S.connecting,recordStarting:S.recordStarting,mcpOperation:S.mcpOperation,modal:S.modal,dirty:S.dirty};
    const wasRunning=windowDiscovery.enabled;windowDiscovery.stop();
    const other={handle:93001,pid:101,title:'编辑器',process_name:'Editor.exe'};
    const game={handle:93002,pid:202,title:'诺亚传说怀旧版 · 启动后才可见',process_name:'NYCSClient.exe'};
    let discovered=[other],calls=0,inputs=0,fail=false,release;
    const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const waitFor=async(check)=>{const until=Date.now()+4500;while(!check()){if(Date.now()>until)throw new Error('automatic discovery timed out');await pause(20);}};
    api=async(method,args)=>{
      if(method==='windows'){
        calls++;if(fail){fail=false;throw new Error('测试瞬时枚举失败');}
        if(release===true)return new Promise(resolve=>{release=resolve;});
        return {windows:clone(discovered),admin:S.admin};
      }
      if(['game_connect','game_disconnect','game_focus'].includes(method)){inputs++;throw new Error('自动扫描不能连接或聚焦');}
      return original(method,args);
    };
    const result={};
    try{
      Object.assign(S,{windows:[other],windowSearch:'',connection:null,handle:null,view:'cases',busy:'',connecting:false,recordStarting:false,mcpOperation:'',modal:null,dirty:true});
      render();document.querySelector('[data-project-name]').focus();
      const editor=document.querySelector('[data-project-name]'),project=JSON.stringify(S.project),path=S.path;
      editor.value='正在编辑的名称';
      windowDiscovery.start();await windowDiscovery.refresh();
      result.initialSnapshotMissing=!S.windows.some(item=>item.handle===game.handle);
      discovered=[other,game];await waitFor(()=>S.windows.some(item=>item.handle===game.handle));
      result.delayedWindowAppears=[...document.querySelector('#connection').options].some(option=>option.value===String(game.handle));
      result.editorPreserved=editor===document.querySelector('[data-project-name]')&&editor.value==='正在编辑的名称'&&S.dirty&&S.path===path&&JSON.stringify(S.project)===project;
      result.noAutomaticConnection=S.connection===null&&S.handle===null&&inputs===0;
      const search=document.querySelector('#window-search');S.windowSearch='nycs';search.value='nycs';search.focus();search.setSelectionRange(2,2);updateWindowChoices();
      await windowDiscovery.refresh();
      discovered=[other,{...game,title:'诺亚传说怀旧版 · 新标题'}];await windowDiscovery.refresh();
      result.searchAndCaretPreserved=document.querySelector('#window-search')===search&&document.activeElement===search&&search.selectionStart===2&&S.windowSearch==='nycs'&&document.querySelector('#connection').textContent.includes('新标题');
      S.connection={...game,width:1024,height:700};S.handle=game.handle;updateWindowChoices();
      discovered=[other];await windowDiscovery.refresh();
      result.missingSnapshotKeepsConnection=S.connection.handle===game.handle&&S.handle===game.handle&&document.querySelector('#connection').value===String(game.handle)&&inputs===0;
      const picker=document.querySelector('#connection');picker.focus();const beforePicker=calls;
      discovered=[other,game];await windowDiscovery.refresh();
      result.nativePickerNotReplaced=calls===beforePicker&&document.querySelector('#connection')===picker;
      search.focus();await windowDiscovery.refresh();
      release=true;const before=calls,first=windowDiscovery.refresh(),second=windowDiscovery.refresh();
      result.requestsCoalesced=calls===before+1;
      S.busy='running';release({windows:[other],admin:S.admin});release=null;await Promise.all([first,second]);
      result.executionRaceDiscardsSnapshot=S.windows.some(item=>item.handle===game.handle);
      const locked=calls;await windowDiscovery.refresh();S.busy='';S.mcpOperation='echo_test_explore';await windowDiscovery.refresh();S.mcpOperation='';S.recordStarting=true;await windowDiscovery.refresh();S.recordStarting=false;
      result.skipsDuringExecution=calls===locked;
      fail=true;await windowDiscovery.refresh();await windowDiscovery.refresh();
      result.transientFailureRecovers=S.windows.some(item=>item.handle===game.handle);
      windowDiscovery.stop();S.windows=[other];S.connection=null;S.handle=null;render();document.querySelector('[data-project-name]').focus();
      windowDiscovery.start();await windowDiscovery.refresh();
      result.repeatedStartupRescans=S.windows.some(item=>item.handle===game.handle);
      windowDiscovery.stop();discovered=[other];const stopped=calls;await windowDiscovery.refresh();
      result.stoppedScannerDoesNothing=calls===stopped;
      result.errors=window.__studioErrors;return result;
    }finally{
      windowDiscovery.stop();if(windowRefreshPromise)await windowRefreshPromise;
      api=original;Object.assign(S,saved);render();if(wasRunning)windowDiscovery.start();
    }
  })()`);
  for(const [name,value] of Object.entries(result))if(name!=='errors')assert.equal(value,true,name);
  assert.deepEqual(result.errors,[]);if(expected)result.realStartupWindow=realStartupWindow;result.passed=true;
  fs.writeFileSync(artifactFile('smoke','window-discovery-smoke.json'),JSON.stringify(result,null,2));
}
module.exports={verify};
