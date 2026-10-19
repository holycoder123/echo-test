"use strict";
const HISTORY_KINDS=new Set(['reports','audit','logs']);
function historyRows(kind){
  if(kind==='logs'){for(const row of S.logs)if(!row.id)row.id='run-log-'+(++logSequence);return S.logs;}
  return kind==='audit'?S.auditEntries:S.reports;
}
function pruneHistorySelection(kind){
  const visible=new Set(historyRows(kind).map(row=>row.id));
  const selection=S.historySelections[kind];
  for(const id of selection)if(!visible.has(id))selection.delete(id);
  return selection;
}
function historyLocked(){return !!disabled()||!!S.historyDeleting;}
function historyCheckbox(kind,id=null){
  const selected=S.historySelections[kind],all=id===null;
  return `<input type="checkbox" class="history-check" ${all?`data-history-all="${kind}" aria-label="全选当前列表"`: `data-history-row="${kind}" data-id="${esc(id)}" aria-label="选择此记录" ${selected.has(id)?'checked':''}`} ${historyLocked()?'disabled':''}>`;
}
function historySelectionBar(kind){
  const count=pruneHistorySelection(kind).size;
  return `<div class="history-selection-bar"><label>${historyCheckbox(kind)}<span>全选当前列表</span></label><span class="small" data-history-count="${kind}">已选 ${count} 项</span><button class="btn danger" data-act="history-delete" data-kind="${kind}" ${!count||historyLocked()?'disabled':''}>${icon('trash')}删除所选</button></div>`;
}
function updateHistorySelection(){
  for(const kind of HISTORY_KINDS){
    const rows=historyRows(kind),selection=pruneHistorySelection(kind),locked=historyLocked();
    for(const node of document.querySelectorAll(`[data-history-all="${kind}"]`)){
      node.checked=rows.length>0&&selection.size===rows.length;node.indeterminate=selection.size>0&&selection.size<rows.length;node.disabled=locked||!rows.length;
    }
    for(const node of document.querySelectorAll(`[data-history-row="${kind}"]`)){
      node.checked=selection.has(node.dataset.id);node.disabled=locked;node.closest('tr,.log-line')?.classList.toggle('history-selected',node.checked);
    }
    for(const node of document.querySelectorAll(`[data-history-count="${kind}"]`))node.textContent=`已选 ${selection.size} 项`;
    for(const node of document.querySelectorAll(`[data-act="history-delete"][data-kind="${kind}"]`))node.disabled=locked||!selection.size;
  }
}
function changeHistorySelection(node){
  const kind=node.dataset.historyAll||node.dataset.historyRow;
  if(!HISTORY_KINDS.has(kind)||node.disabled)return;
  const selection=pruneHistorySelection(kind);
  if(node.dataset.historyAll){selection.clear();if(node.checked)for(const row of historyRows(kind))selection.add(row.id);}
  else if(node.checked)selection.add(node.dataset.id);else selection.delete(node.dataset.id);
  updateHistorySelection();
}
async function deleteHistory(kind){
  if(!HISTORY_KINDS.has(kind)||historyLocked()||lock())return;
  const ids=[...pruneHistorySelection(kind)];if(!ids.length)return;
  const name={reports:'运行报告',audit:'错误日志',logs:'执行日志'}[kind],unit=kind==='reports'?'份':'条';
  const detail=kind==='reports'?'所选报告及其截图、脚本输出将一并删除，此操作无法撤销。':kind==='logs'?'清除本页面中所选执行日志，历史报告仍保留。':'所选日志将从本机日志文件中删除，此操作无法撤销。';
  S.historyDeleting=kind;updateHistorySelection();
  try{
    if(!await confirm(`删除选中的 ${ids.length} ${unit}${name}？`,detail)||lock())return;
    let deleted;
    if(kind==='logs'){
      const selected=new Set(ids),before=S.logs.length;S.logs=S.logs.filter(row=>!selected.has(row.id));deleted=before-S.logs.length;
    }else{
      const result=await api(kind==='audit'?'audit_delete':'reports_delete',{ids});deleted=result.deleted;
      if(kind==='reports'){
        const removed=new Set(result.ids);
        if(removed.has(S.lastResult?.id))delete S.lastResult.id;
        if(removed.has(S.runState?.reportId))S.runState.reportId=null;
        if(removed.has(S.recordReplayRun?.reportId))S.recordReplayRun.reportId=null;
        await reports();
      }else{
        if(result.ids.includes(S.auditSelected?.id))S.auditSelected=null;
        await refreshAudit();
      }
    }
    S.historySelections[kind].clear();render();toast(`已删除 ${deleted} ${unit}${name}`,'success');
  }catch(error){if(kind==='reports')await reports().catch(()=>{});throw error;}
  finally{S.historyDeleting='';updateHistorySelection();}
}
document.addEventListener('change',event=>{if(event.target.matches('[data-history-all],[data-history-row]'))changeHistorySelection(event.target);});
