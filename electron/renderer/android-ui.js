'use strict';
const ANDROID_UI_FIELDS=[['resource_id','资源 ID'],['text','文字'],['description','无障碍描述'],['class_name','类名'],['package','应用包名']];
function androidUiSummary(target){const q=target.ui||{};return q.resource_id||q.description||q.text||q.class_name||q.package||'未设置定位条件';}
function androidUiFields(target){
  const q=target.ui||{};
  return `<p class="field-help">读取系统暴露的原生控件。已填写条件同时精确匹配；优先使用资源 ID，动态文字可留空。</p>${button('从安卓设备采集','android-ui-open','quiet wide','android',S.android.connection?'':'disabled')}<div class="field-grid">${ANDROID_UI_FIELDS.map(([key,label])=>field(label,input(q[key]||'',`data-ui-field="${key}"`,'text','maxlength="4096"'))).join('')}${field('匹配序号（0 表示要求唯一）',input(q.index||0,'data-ui-field="index"','number','min="0" max="5000" step="1"'))}${['clickable','enabled'].map(key=>field(key==='clickable'?'可点击':'已启用',`<select data-ui-field="${key}">${options([['','不限'],['true','是'],['false','否']],key in q?String(q[key]):'')}</select>`)).join('')}</div><p class="field-help">匹配到多个节点时需补充条件或指定从 1 开始的序号。未暴露控件的游戏画布仍使用图片 / OCR 定位。读取可能耗时数秒，可在步骤中增加定位超时。</p>`;
}
function androidUiRows(m){
  const search=m.search.trim().toLocaleLowerCase(),nodes=(m.snapshot?.nodes||[]).filter(n=>n.visible&&(!search||ANDROID_UI_FIELDS.some(([key])=>n[key].toLocaleLowerCase().includes(search))));
  if(m.loading)return '<p role="status">正在读取控件树，请稍候…</p>';
  if(!nodes.length)return '<p class="field-help">没有可选控件。可尝试刷新或清空搜索；游戏画布可能未暴露内部控件，请使用图片 / OCR。</p>';
  return nodes.map(n=>`<button class="android-ui-node ${m.selectedId===n.id?'selected':''}" data-act="android-ui-select" data-id="${n.id}" style="padding-left:${12+Math.min(n.depth,12)*12}px" aria-pressed="${m.selectedId===n.id}"><strong>${esc(n.text||n.description||n.resource_id||n.class_name)}</strong><small>${esc(n.class_name)}${n.resource_id?' · '+esc(n.resource_id):''}</small></button>`).join('');
}
function androidUiDetail(m){
  const node=m.snapshot?.nodes.find(n=>n.id===m.selectedId);
  return node?`${ANDROID_UI_FIELDS.map(([key,label])=>`<p><strong>${label}</strong><br>${esc(node[key]||'（空）')}</p>`).join('')}<p>可点击：${node.clickable?'是':'否'} · 已启用：${node.enabled?'是':'否'}</p><p>边界 [x, y, 宽, 高]：${node.bounds.join(', ')}</p>`:'<p class="field-help">选择节点查看属性，保存后每次执行都会重新读取当前界面定位。</p>';
}
function androidUiModal(m){
  return header('采集安卓 UI 控件')+`<div class="modal-body"><p class="field-help">读取手机当前界面的原生控件；无需另装应用。读取可能耗时数秒。</p><div class="android-ui-tools"><input id="android-ui-search" placeholder="搜索 ID、文字、描述或类名" aria-label="搜索安卓控件" value="${esc(m.search)}" ${m.loading?'disabled':''}>${button('刷新控件树','android-ui-refresh','quiet','refresh',m.loading?'disabled':'')}</div><p class="android-error" role="status">${esc(m.error||'')}</p><p class="field-help">${m.snapshot?`${m.snapshot.nodes.filter(n=>n.visible).length} 个可见节点 · ${m.snapshot.width} × ${m.snapshot.height}`:''}</p><div class="android-ui-inspector"><div id="android-ui-nodes">${androidUiRows(m)}</div><aside id="android-ui-detail">${androidUiDetail(m)}</aside></div></div><footer class="modal-footer">${button('取消','android-ui-cancel')}${button('使用所选控件','android-ui-accept','primary','',m.loading||m.selectedId===null?'disabled':'')}</footer>`;
}
async function refreshAndroidUi(m){
  if(m.loading)return;
  m.loading=true;m.error='';m.snapshot=null;m.selectedId=null;renderModal();
  try{
    const snapshot=await api('android_hierarchy',{target:m.target});
    if(S.modal!==m||S.android.connection?.serial!==m.target.serial)return;
    m.snapshot=snapshot;
  }catch(error){if(S.modal===m)m.error=error.message;}
  finally{m.loading=false;if(S.modal===m)renderModal();}
}
async function androidUiAction(action,node){
  if(action==='android-ui-open'){
    if(lock()||!S.android.connection)throw new Error('请先连接安卓设备，并停止录制或执行');
    const previous=S.modal?.kind==='selector'?S.modal:null;
    const m={kind:'android-ui',returnModal:previous,target:clone(targetArgs().target),loading:false,search:'',selectedId:null,snapshot:null,error:''};
    showModal(m);await refreshAndroidUi(m);return;
  }
  const m=S.modal;if(m?.kind!=='android-ui')return;
  if(action==='android-ui-cancel'){if(m.returnModal)showModal(m.returnModal);else closeModal();return;}
  if(action==='android-ui-refresh'){await refreshAndroidUi(m);return;}
  if(action==='android-ui-select'&&!m.loading){m.selectedId=Number(node.dataset.id);renderModal();return;}
  if(action==='android-ui-accept'){
    if(m.loading||!m.snapshot||m.selectedId===null||lock())return;
    if(S.android.connection?.serial!==m.target.serial)throw new Error('安卓目标已变化，请重新采集');
    m.loading=true;renderModal();
    try{
      const result=await api('android_ui_pick',{target:m.target,snapshot_id:m.snapshot.id,node_id:m.selectedId});
      if(S.modal!==m||S.android.connection?.serial!==m.target.serial)return;
      const selected=m.snapshot.nodes.find(n=>n.id===m.selectedId);
      const previous=m.returnModal||{kind:'selector',index:null,id:null,categoryId:S.targetCategory==='all'?'':S.targetCategory,draft:defaultSelector()};
      if(!m.returnModal)previous.draft.name=(selected.text||selected.description||selected.resource_id.split('/').pop()||'安卓 UI 控件').slice(0,200);
      previous.draft.kind='android_ui';previous.draft.ui=result.ui;showModal(previous);
    }catch(error){m.error=error.message;}
    finally{m.loading=false;if(S.modal===m)renderModal();}
  }
}
function editAndroidUiField(node){
  const key=node.dataset.uiField;if(!key||S.modal?.kind!=='selector')return;
  const q=S.modal.draft.ui||={};
  if(node.value===''||(key==='index'&&Number(node.value)===0))delete q[key];
  else q[key]=key==='index'?Number(node.value):['clickable','enabled'].includes(key)?node.value==='true':node.value;
}
document.addEventListener('input',event=>{
  editAndroidUiField(event.target);
  if(event.target.id==='android-ui-search'&&S.modal?.kind==='android-ui'){
    S.modal.search=event.target.value;modal.querySelector('#android-ui-nodes').innerHTML=androidUiRows(S.modal);
  }
});
document.addEventListener('change',event=>editAndroidUiField(event.target));
