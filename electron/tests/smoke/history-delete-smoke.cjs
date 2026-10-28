const assert=require('node:assert/strict');
const fs=require('node:fs');
const {artifactFile}=require('../../paths.cjs');
async function verify(window){
  const result=await window.webContents.executeJavaScript(`(async()=>{
    const saved={reports:S.reports,logs:S.logs,view:S.view,auditEntries:S.auditEntries,auditSelected:S.auditSelected,auditLevel:S.auditLevel,auditSearch:S.auditSearch,auditDirectory:S.auditDirectory,historySelections:S.historySelections,historyDeleting:S.historyDeleting,lastResult:S.lastResult,runState:S.runState,recordReplayRun:S.recordReplayRun,busy:S.busy};
    const original=api,result={},calls=[];
    const pause=()=>new Promise(resolve=>setTimeout(resolve,10));
    const wait=async check=>{for(let i=0;i<100;i++){if(check())return;await pause();}throw new Error('等待历史记录删除界面超时');};
    const row=(kind,id)=>document.querySelector('[data-history-row="'+kind+'"][data-id="'+id+'"]');
    const all=kind=>document.querySelector('[data-history-all="'+kind+'"]');
    const remove=kind=>document.querySelector('[data-act="history-delete"][data-kind="'+kind+'"]');
    const begin=async kind=>{remove(kind).click();await wait(()=>modal.open);};
    const answer=async yes=>{modal.querySelector('[data-act="confirm-'+(yes?'yes':'no')+'"]').click();await wait(()=>!S.historyDeleting);};
    const report=id=>({id,case:'报告 '+id,started:new Date().toISOString(),status:'failed',steps:[]});
    const entry=(id,level,message)=>({id,time:new Date().toISOString(),level,message,operation:'verify',stage:'completed'});
    let reportBank=[report('report-one'),report('report-two'),report('report-three')];
    let auditBank=[entry('audit-one','error','定位失败'),entry('audit-two','info','连接成功'),entry('audit-three','error','运行失败')];
    try{
      S.busy='';S.historySelections={reports:new Set(),audit:new Set(),logs:new Set()};S.historyDeleting='';
      const marker=await original('renderer_error',{message:'history_delete_probe_'+Date.now(),action:'history-delete-smoke'});
      const actual=await original('audit_delete',{ids:[marker.id]});
      const remaining=await original('audit_list',{search:marker.id});
      result.actualLogDeletion=actual.deleted===1&&!remaining.entries.some(item=>item.id===marker.id);
      api=async(method,args)=>{
        calls.push({method,args});
        if(method==='reports')return clone(reportBank);
        if(method==='reports_delete'){
          const ids=reportBank.filter(item=>args.ids.includes(item.id)).map(item=>item.id);reportBank=reportBank.filter(item=>!ids.includes(item.id));return {ids,deleted:ids.length};
        }
        if(method==='audit_list')return {directory:'isolated-test-logs',entries:clone(auditBank.filter(item=>(!args.level||item.level===args.level)&&(!args.search||JSON.stringify(item).includes(args.search))))};
        if(method==='audit_delete'){
          const ids=auditBank.filter(item=>args.ids.includes(item.id)).map(item=>item.id);auditBank=auditBank.filter(item=>!ids.includes(item.id));return {ids,deleted:ids.length};
        }
        return original(method,args);
      };
      S.logs=[{id:'log-one',message:'第一条执行日志',type:'',time:'12:00:00'},{id:'log-two',message:'第二条执行日志',type:'error',time:'12:00:01'}];
      S.lastResult={id:'report-one',status:'failed'};S.reports=clone(reportBank);S.view='runs';render();
      row('reports','report-one').click();
      result.singleSelection=all('reports').indeterminate&&S.historySelections.reports.size===1&&!remove('reports').disabled;
      await begin('reports');await answer(false);
      result.cancelDoesNotDelete=reportBank.length===3&&!calls.some(call=>call.method==='reports_delete')&&S.historySelections.reports.has('report-one');
      await begin('reports');await answer(true);
      result.singleReportDeleted=reportBank.length===2&&S.reports.length===2&&!S.lastResult.id&&calls.find(call=>call.method==='reports_delete').args.ids.join(',')==='report-one';
      all('reports').click();
      result.selectAllSyncsHeaders=[...document.querySelectorAll('[data-history-all="reports"]')].every(node=>node.checked&&!node.indeterminate)&&S.historySelections.reports.size===2;
      await begin('reports');reportBank.push(report('report-new'));await reports();await answer(true);
      result.allUsesConfirmedSnapshot=reportBank.length===1&&reportBank[0].id==='report-new'&&S.historySelections.reports.size===0;
      result.executionLogsReadOnly=S.logs.length===2&&!document.querySelector('.run-current input[type="checkbox"],.run-current .history-selection-bar,.run-current [data-act="history-delete"]');

      S.view='diagnostics';S.auditLevel='';S.auditSearch='';await refreshAudit();
      row('audit','audit-one').click();const filter=document.querySelector('#audit-level');filter.value='error';filter.dispatchEvent(new Event('change',{bubbles:true}));
      await wait(()=>S.auditEntries.length===2);
      result.filterClearsHiddenSelection=S.historySelections.audit.size===0&&remove('audit').disabled;
      const search=document.querySelector('#audit-search');search.value='定位';search.dispatchEvent(new Event('input',{bubbles:true}));await wait(()=>S.auditEntries.length===1);
      S.auditSelected=S.auditEntries[0];render();all('audit').click();
      await begin('audit');await answer(false);result.cancelAuditKeepsRecord=auditBank.length===3&&!!S.auditSelected;
      await begin('audit');auditBank.push(entry('audit-new','error','定位失败新记录'));await answer(true);
      result.filteredSelectionProtectsOtherLogs=auditBank.length===3&&!auditBank.some(item=>item.id==='audit-one')&&auditBank.some(item=>item.id==='audit-two')&&auditBank.some(item=>item.id==='audit-new');
      result.deletedDetailCloses=S.auditSelected===null&&!document.querySelector('.audit-detail');
      result.filtersRemain=S.auditLevel==='error'&&S.auditSearch==='定位'&&S.auditEntries.length===1&&S.historySelections.audit.size===0;
      clearTimeout(auditTimer);S.auditLevel='';S.auditSearch='';await refreshAudit();all('audit').click();
      S.busy='running';render();const auditCalls=calls.filter(call=>call.method==='audit_delete').length;await handleAction('history-delete',{dataset:{kind:'audit'}});
      result.lockedWhileRunning=remove('audit').disabled&&all('audit').disabled&&!modal.open&&calls.filter(call=>call.method==='audit_delete').length===auditCalls;
      S.busy='';render();await begin('audit');await answer(true);
      result.allAuditDeleted=auditBank.length===0&&S.auditEntries.length===0&&all('audit').disabled;
      S.view='runs';await reports();all('reports').click();await begin('reports');await answer(true);
      result.allReportsDeleted=S.reports.length===0&&reportBank.length===0&&!document.querySelector('[data-history-row="reports"]');
      S.reports=[report('preview-one'),report('preview-two')];S.logs=[{id:'preview-log',message:'测试步骤未找到目标，已保存截图',time:'12:00:00',type:'error'}];render();all('reports').click();
      window.__historyDeletePreview={reports:S.reports,logs:S.logs,view:S.view};
      result.errors=window.__studioErrors;return result;
    }finally{clearTimeout(auditTimer);closeModal();api=original;Object.assign(S,saved);render();}
  })()`);
  for(const [key,value] of Object.entries(result))if(key!=='errors')assert.equal(value,true,key);
  assert.deepEqual(result.errors,[]);result.passed=true;
  await window.webContents.executeJavaScript(`(async()=>{window.__historyVisualSaved={reports:S.reports,logs:S.logs,view:S.view,historySelections:S.historySelections,auditEntries:S.auditEntries,auditSelected:S.auditSelected,auditLevel:S.auditLevel,auditSearch:S.auditSearch,auditDirectory:S.auditDirectory};Object.assign(S,window.__historyDeletePreview);S.historySelections={reports:new Set(S.reports.map(row=>row.id)),audit:new Set(),logs:new Set()};render();document.querySelector('#toasts').replaceChildren();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));})()`);
  const size=window.getSize();
  try{
    fs.writeFileSync(artifactFile('smoke','history-delete-preview.png'),(await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript(`(async()=>{
      S.view='diagnostics';S.auditLevel='';S.auditSearch='';S.auditDirectory='测试日志目录';
      S.auditEntries=[{id:'preview-error',time:new Date().toISOString(),level:'error',message:'目标控件未找到，已保留失败信息',operation:'preview',stage:'failed'},
        {id:'preview-info',time:new Date().toISOString(),level:'info',message:'连接窗口成功',operation:'game_connect',stage:'completed'}];
      S.auditSelected=S.auditEntries[0];S.historySelections.audit=new Set(S.auditEntries.map(row=>row.id));render();
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    })()`);
    fs.writeFileSync(artifactFile('smoke','audit-delete-preview.png'),(await window.webContents.capturePage()).toPNG());
    window.setSize(1120,740);await new Promise(resolve=>setTimeout(resolve,100));
    result.minimumWidthLayout=await window.webContents.executeJavaScript(`[...document.querySelectorAll('.audit-layout .report-table,.audit-layout [data-act="history-delete"],.audit-detail')].every(node=>node.getBoundingClientRect().right<=innerWidth+1)`);
    assert.equal(result.minimumWidthLayout,true,'history selection fits minimum window size');
  }
  finally{window.setSize(...size);await window.webContents.executeJavaScript('Object.assign(S,window.__historyVisualSaved);render();delete window.__historyVisualSaved;delete window.__historyDeletePreview');}
  fs.writeFileSync(artifactFile('smoke','history-delete-smoke.json'),JSON.stringify(result,null,2));
}
module.exports={verify};
