const assert=require('node:assert/strict');
const fs=require('node:fs');
const {artifactFile}=require('../../paths.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function verify(main,bar) {
  const js=code=>main.webContents.executeJavaScript(code);
  const result={};
  try {
    result.read=await js(`(async()=>{
      window.__helpSaved={view:S.view,helpSearch:S.helpSearch,project:S.project,dirty:S.dirty,pending:S.recordPending};
      S.dirty=true;S.recordPending={raw_count:2,project:{steps:[],selectors:[]}};
      const project=JSON.stringify(S.project),pending=S.recordPending;
      await handleAction('view-help',{dataset:{}});
      return {nav:!!document.querySelector('.nav-button.active[data-act="view-help"]'),
        topics:document.querySelectorAll('.help-article').length===10,
        preservesEdits:JSON.stringify(S.project)===project&&S.dirty&&S.recordPending===pending,
        local:!!document.querySelector('#guide-start')&&!document.querySelector('.help-articles iframe')};
    })()`);
    for(const [key,value] of Object.entries(result.read))assert.equal(value,true,key);
    result.search=await js(`(()=>{
      const field=document.querySelector('#help-search');field.focus();field.value='遮罩';field.dispatchEvent(new Event('input',{bubbles:true}));
      const mask=document.querySelectorAll('.help-article').length<10&&!!document.querySelector('#guide-selectors')&&[...document.querySelectorAll('.help-article')].every(article=>article.textContent.includes('遮罩'))&&document.activeElement===field;
      field.value='<img src=x onerror=alert(1)>';field.dispatchEvent(new Event('input',{bubbles:true}));
      const escaped=!!document.querySelector('.help-empty')&&!document.querySelector('.help-results img');
      field.value='';field.dispatchEvent(new Event('input',{bubbles:true}));
      return {mask,escaped,reset:document.querySelectorAll('.help-article').length===10};
    })()`);
    for(const [key,value] of Object.entries(result.search))assert.equal(value,true,key);
    await js("handleAction('help-section',{dataset:{section:'selectors'}})");await pause(300);
    result.directory=await js("document.querySelector('#content').scrollTop>0");assert.equal(result.directory,true);
    await js("document.querySelector('#content').scrollTop=0;document.querySelector('#toasts').replaceChildren()");await pause(50);
    fs.writeFileSync(artifactFile('smoke','help-preview.png'),(await main.webContents.capturePage()).toPNG());
    result.shortcut=await js(`(async()=>{await handleAction('view-cases',{dataset:{}});document.dispatchEvent(new KeyboardEvent('keydown',{key:'F1',bubbles:true}));return S.view==='help';})()`);
    assert.equal(result.shortcut,true);
    // Exercise the real toolbar IPC with no game connected.
    await js("S.view='cases';render()");
    await bar.webContents.executeJavaScript("document.querySelector('#help').click()");await pause(100);
    result.toolbar=await js("S.view==='help'&&!!document.querySelector('#help-search')");assert.equal(result.toolbar,true);
    await js("S.view='cases';render()");
    await bar.webContents.executeJavaScript("document.dispatchEvent(new KeyboardEvent('keydown',{key:'F1',bubbles:true}))");await pause(100);
    result.toolbarShortcut=await js("S.view==='help'");assert.equal(result.toolbarShortcut,true);
    result.errors=await js('window.__studioErrors');assert.deepEqual(result.errors,[]);
    result.passed=true;
  }catch(error){result.error=error.stack;throw error;}finally {
    await js("if(window.__helpSaved){const saved=window.__helpSaved;Object.assign(S,{view:saved.view,helpSearch:saved.helpSearch,project:saved.project,dirty:saved.dirty,recordPending:saved.pending});render();delete window.__helpSaved;}");
    fs.writeFileSync(artifactFile('smoke','help-smoke.json'),JSON.stringify(result,null,2));
  }
}
module.exports={verify};
