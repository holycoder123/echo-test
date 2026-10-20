const assert=require('node:assert/strict'),fs=require('node:fs');
const {artifactFile}=require('../../paths.cjs');
async function verify(main){
  const js=code=>main.webContents.executeJavaScript(code),result={};
  try{
    Object.assign(result,await js(`(async()=>{
      window.__settingsSaved={view:S.view,settingsData:S.settingsData,settingsDraft:S.settingsDraft,settingsTab:S.settingsTab,windowSearch:S.windowSearch,targetWindowMode:S.targetWindowMode};
      window.__settingsOriginal=await api('settings_get');window.__settingsProject=JSON.stringify(S.project);window.__settingsDirty=S.dirty;
      await handleAction('view-settings',{dataset:{}});
      const tabs=document.querySelectorAll('.settings-nav>button').length===5;
      const field=document.querySelector('[data-setting="shortcuts.run"]');field.focus();
      await new Promise(resolve=>setTimeout(resolve,50));
      field.dispatchEvent(new KeyboardEvent('keydown',{key:'F23',ctrlKey:true,altKey:true,shiftKey:true,bubbles:true}));field.blur();
      const capture=S.settingsDraft.shortcuts.run==='Ctrl+Alt+Shift+F23';
      await handleAction('settings-tab',{dataset:{tab:'target'}});
      const interval=document.querySelector('[data-setting="target.refreshSeconds"]');interval.value='10';interval.dispatchEvent(new Event('change',{bubbles:true}));
      const mode=document.querySelector('[data-setting="target.defaultMode"]');mode.value='search';mode.dispatchEvent(new Event('change',{bubbles:true}));
      const actualPreview=await api('settings_cleanup_preview');
      let invalidCleanupToken=false;try{await api('settings_cleanup_delete',{token:'invalid-token'});}catch(error){invalidCleanupToken=error.message.includes('预览已失效');}
      window.__settingsCleanupGuard=invalidCleanupToken&&typeof actualPreview.token==='string';
      const before=JSON.stringify(S.project);await handleAction('settings-save',{dataset:{}});
      const persisted=await api('settings_get');
      const saved=persisted.values.target.refreshSeconds===10&&persisted.values.target.defaultMode==='search'&&persisted.values.shortcuts.run==='Ctrl+Alt+Shift+F23';
      let conflict=false;try{await api('settings_save',{values:{...persisted.values,shortcuts:{...persisted.values.shortcuts,run:'F12'}}});}catch(error){conflict=error.message.includes('冲突');}
      const unchanged=(await api('settings_get')).values.shortcuts.run==='Ctrl+Alt+Shift+F23';
      await handleAction('settings-tab',{dataset:{tab:'startup'}});
      const toggle=document.querySelector('[data-setting="startup.admin"]');toggle.click();
      const changed=S.settingsDraft.startup.admin!==persisted.values.startup.admin;
      await handleAction('settings-reset',{dataset:{}});
      const reset=JSON.stringify(S.settingsDraft.startup)===JSON.stringify(S.settingsData.defaults.startup);
      await handleAction('settings-tab',{dataset:{tab:'mcp'}});
      const mcp=!!document.querySelector('[data-setting="mcp.explorationTimeout"]')&&!!document.querySelector('[data-act="settings-mcp-copy"]');
      await handleAction('settings-tab',{dataset:{tab:'history'}});
      const history=!!document.querySelector('[data-act="settings-cleanup-preview"]');
      return {cleanupGuard:window.__settingsCleanupGuard,tabs,capture,saved,conflict,unchanged,changed,reset,mcp,history,projectPreserved:JSON.stringify(S.project)===before&&S.dirty===window.__settingsDirty};
    })()`));
    const size=main.getSize();main.setSize(1120,740);
    try{
      await new Promise(resolve=>setTimeout(resolve,100));
      result.layout=await js(`document.body.scrollWidth<=innerWidth&&document.querySelector('.settings-panel').getBoundingClientRect().right<=innerWidth`);
    }finally{main.setSize(...size);}
    await js(`S.settingsTab='shortcuts';render();document.querySelector('#toasts').replaceChildren()`);
    await new Promise(resolve=>setTimeout(resolve,100));
    fs.writeFileSync(artifactFile('smoke','settings-preview.png'),(await main.webContents.capturePage()).toPNG());
    Object.assign(result,await js(`(async()=>{
      window.__settingsApi=api;window.__settingsCalls=[];S.settingsDraft=clone(S.settingsData.values);
      api=async(method,args)=>{
        window.__settingsCalls.push({method,args});
        if(method==='settings_cleanup_preview')return {token:'preview-token',days:30,reports:{entries:[{id:'old-report',bytes:1024}],delete_bytes:1024,total_bytes:4096,skipped:0},logs:[]};
        if(method==='settings_cleanup_delete')return {reports:1,logs:0};
        return window.__settingsApi(method,args);
      };
      S.settingsTab='history';render();
      const preview=handleAction('settings-cleanup-preview',{dataset:{}});
      await new Promise(resolve=>setTimeout(resolve,30));
      const review=modal.open&&modal.textContent.includes('old-report')&&modal.textContent.includes('1.0 KB');
      await handleAction('confirm-no',{dataset:{}});await preview;
      const cancel=!window.__settingsCalls.some(call=>call.method==='settings_cleanup_delete');
      const confirmed=handleAction('settings-cleanup-preview',{dataset:{}});await new Promise(resolve=>setTimeout(resolve,30));
      await handleAction('confirm-yes',{dataset:{}});await confirmed;
      const deletion=window.__settingsCalls.find(call=>call.method==='settings_cleanup_delete');
      api=window.__settingsApi;
      return {review,cancel,deleteToken:deletion?.args.token==='preview-token',errors:window.__studioErrors};
    })()`));
    for(const [name,value] of Object.entries(result))if(name!=='errors')assert.equal(value,true,name);
    assert.deepEqual(result.errors,[]);result.passed=true;
  }catch(error){result.error=error.stack;throw error;}
  finally{
    await js(`(async()=>{if(window.__settingsApi)api=window.__settingsApi;if(window.__settingsOriginal)await api('settings_save',{values:window.__settingsOriginal.values});if(window.__settingsSaved)Object.assign(S,window.__settingsSaved);windowDiscovery.stop();render();})()`);
    fs.writeFileSync(artifactFile('smoke','settings-smoke.json'),JSON.stringify(result,null,2));
  }
}
module.exports={verify};
