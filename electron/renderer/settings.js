const settingSections={shortcuts:['快捷键','常用操作，随时触达'],mcp:['MCP','管理 AI 工具连接'],startup:['启动与关闭','让工作台按习惯启动'],target:['目标窗口','选择与发现窗口'],history:['报告与日志','管理本机历史数据']};
function settingField(section,key,label,help='',choices=null){
  const value=S.settingsDraft[section][key],attribute=`data-setting="${section}.${key}"`;
  let control;
  if(typeof value==='boolean')control=`<label class="setting-toggle"><input type="checkbox" ${attribute} ${value?'checked':''}><span></span></label>`;
  else if(choices)control=`<select ${attribute}>${options(choices,value)}</select>`;
  else control=`<input ${attribute} ${section==='shortcuts'?'readonly data-shortcut="true" placeholder="未设置 · 点击后按组合键"':typeof value==='number'?'type="number" min="1" max="30"':'maxlength="200"'} value="${esc(value)}" aria-label="${esc(label)}">`;
  return `<div class="setting-row"><div><strong>${label}</strong>${help?`<p>${help}</p>`:''}</div><div class="setting-control">${control}</div></div>`;
}
function settingsView(){
  const data=S.settingsData;if(!data||!S.settingsDraft)return '<div class="empty">正在加载设置…</div>';
  const tab=S.settingsTab||'shortcuts',f=(...args)=>settingField(tab,...args);let body='';
  if(tab==='shortcuts')body=Object.entries({run:'运行当前用例',record:'开始录制',screenshot:'截取目标窗口',pick:'指选目标窗口',show:'显示工作台',stop:'停止执行 / 录制'}).map(([key,label])=>f(key,label,key==='stop'?'F12 始终保留为紧急停止键。':'点击输入框，直接按下组合键；Backspace 清空。')).join('')+'<p class="settings-note">这些快捷键在其他应用前台时也可使用。F1 帮助、Ctrl+S 保存、Ctrl+Shift+S 另存为保持固定。</p>';
  if(tab==='mcp')body=`<div class="settings-status"><i class="status-dot ${data.mcp.running?'green':''}"></i><strong>${data.mcp.running?'MCP 正在运行':'MCP 已关闭'}</strong><span>${esc(data.mcp.url)}</span></div>`+f('enabled','启用 MCP','允许本机 AI 工具通过 MCP 操作工作台。')+f('explorationTimeout','默认探索超时（秒）','范围 1 ~ 30 秒；接口明确传入超时时优先使用传入值。')+`<div class="settings-tools">${button('复制 Codex 配置','settings-mcp-copy','','copy')}${button('复制通用配置','settings-mcp-copy','ghost','', 'data-format="json"')}${button('重置连接','settings-mcp-reset','','refresh',data.mcp.running?'':'disabled')}</div><p class="settings-note">重置后旧连接凭据立即失效，客户端需要重新连接。${data.mcp.allowed?'':'本次启动使用了 --disable-mcp，需正常重启后才能启用。'}</p>`;
  if(tab==='startup')body=f('admin','启动时请求管理员权限','下次启动生效。用于操作具有管理员权限的目标程序。')+f('rememberBounds','记住窗口位置与大小','再次启动时恢复工作台位置；屏幕变化时自动调整可见区域。')+f('closeAction','点击关闭按钮时','托盘菜单始终提供“退出工作台”。',[['exit','退出程序'],['tray','最小化到系统托盘']])+`<p class="settings-note">退出前仍会提示未保存的用例。运行或录制期间请先停止再退出。</p>`;
  if(tab==='target')body=f('defaultMode','默认选择方式','打开工作台后优先展示的窗口选择方式。',[['pick','鼠标指选'],['search','搜索窗口']])+f('refreshSeconds','窗口列表自动刷新','后台扫描不会切换或连接目标窗口。',[[0,'关闭'],[3,'每 3 秒'],[5,'每 5 秒'],[10,'每 10 秒'],[30,'每 30 秒']])+f('filter','默认搜索条件','可填写窗口标题或进程名，留空展示全部窗口。')+f('autoToolbar','连接后自动打开工具栏','关闭后仍可手动打开窗口工具栏。')+f('linkToolbar','默认捆绑工具栏','下次连接目标窗口时生效。');
  if(tab==='history')body=f('retentionDays','历史清理范围','仅清理早于此时间且已完成的报告和诊断日志。',[[7,'超过 7 天'],[30,'超过 30 天'],[90,'超过 90 天'],[180,'超过 180 天'],[365,'超过 1 年']])+`<div class="settings-cleanup"><div>${icon('history')}<h3>检查历史占用</h3><p>先保存清理范围，再查看候选记录和可释放空间。确认后才会删除。</p></div>${button('预览清理','settings-cleanup-preview','','search')}</div><p class="settings-note">每次最多处理 1000 份报告、最近 1000 条日志。保留测试用例、通用控件和录制数据。</p>`;
  return `<div class="settings-page"><div class="page-heading"><div><h1>设置</h1><p class="sub">配置你的工作台，设置保存在本机。</p></div><span class="settings-version">v${esc(data.version)}</span></div>${data.warning?`<p class="settings-warning">${esc(data.warning)}</p>`:''}<div class="settings-layout"><nav class="settings-nav" aria-label="设置分类">${Object.entries(settingSections).map(([key,[label,description]])=>`<button data-act="settings-tab" data-tab="${key}" class="${key===tab?'active':''}"><strong>${label}</strong><small>${description}</small></button>`).join('')}<div class="settings-transfer">${button('导入设置','settings-import','ghost','folder')}${button('导出设置','settings-export','ghost','upload')}</div></nav><section class="settings-panel"><header><h2>${settingSections[tab][0]}</h2><span>${settingSections[tab][1]}</span></header>${body}<footer><span id="settings-save-state" role="status">${settingsDraftChanged()?'有未保存的设置':'已保存'}</span><div>${button('重置本组','settings-reset','ghost','refresh')}${button('保存设置','settings-save','primary','save',disabled())}</div></footer></section></div></div>`;
}
function settingsDraftChanged(){return S.settingsDraft&&JSON.stringify(S.settingsDraft)!==JSON.stringify(S.settingsData?.values);}
function applySettingsConfig(data){
  const previous=S.settingsData?.values;S.settingsData=data;
  if(!previous||previous.target.defaultMode!==data.values.target.defaultMode)S.targetWindowMode=data.values.target.defaultMode;
  if(!previous||previous.target.filter!==data.values.target.filter)S.windowSearch=data.values.target.filter;
  if(window.__studioReady)windowDiscovery.start();
}
async function loadSettings(){const data=await api('settings_get');applySettingsConfig(data);S.settingsDraft=clone(data.values);render();}
const humanBytes=value=>value<1024?value+' B':value<1048576?(value/1024).toFixed(1)+' KB':(value/1048576).toFixed(1)+' MB';
async function settingsAction(action,node){
  if(!action.startsWith('settings-'))return false;
  if(action==='settings-tab'){S.settingsTab=node.dataset.tab;render();return true;}
  if(action==='settings-reset'){const tab=S.settingsTab||'shortcuts';S.settingsDraft[tab]=clone(S.settingsData.defaults[tab]);render();return true;}
  if(action==='settings-save'){
    if(lock())return true;const data=await api('settings_save',{values:S.settingsDraft});applySettingsConfig(data);S.settingsDraft=clone(data.values);render();toast('设置已保存','success');return true;
  }
  if(action==='settings-import'){const data=await api('settings_import');if(data){S.settingsDraft=data.values;render();toast('已载入设置，点击保存后生效');}return true;}
  if(action==='settings-export'){await api('settings_export');return true;}
  if(action==='settings-mcp-copy'){await api('settings_mcp_copy',{format:node.dataset.format||'toml'});toast('连接配置已复制','success');return true;}
  if(action==='settings-mcp-reset'){
    if(lock())return true;if(await confirm('重置 MCP 连接？','现有客户端连接将断开，需要重新连接。')){applySettingsConfig(await api('settings_mcp_reset'));render();toast('MCP 连接已重置','success');}return true;
  }
  if(action==='settings-cleanup-preview'){
    if(lock())return true;if(settingsDraftChanged()){toast('请先保存设置，再预览清理');return true;}
    const preview=await api('settings_cleanup_preview');
    const bytes=preview.reports.delete_bytes+preview.logs.reduce((sum,row)=>sum+row.bytes,0);
    const reportList=preview.reports.entries.map(row=>row.id).slice(0,6).join('、');
    if(!preview.reports.entries.length&&!preview.logs.length){toast('暂无符合条件的历史记录');return true;}
    const message=`超过 ${preview.days} 天：${preview.reports.entries.length} 份报告、${preview.logs.length} 条日志，可释放约 ${humanBytes(bytes)}。报告总占用 ${humanBytes(preview.reports.total_bytes)}。${reportList?' 报告：'+reportList+(preview.reports.entries.length>6?' 等。':'。'):''}${preview.reports.skipped?' 已跳过 '+preview.reports.skipped+' 个异常目录。':''}删除后无法恢复。`;
    if(await confirm('确认清理历史？',message)){
      const result=await api('settings_cleanup_delete',{token:preview.token});await reports();toast(`已删除 ${result.reports} 份报告、${result.logs} 条日志`,'success');
    }return true;
  }
  return true;
}
document.addEventListener('change',event=>{
  const node=event.target,key=node.dataset.setting;if(!key||!S.settingsDraft)return;
  const [section,field]=key.split('.'),old=S.settingsDraft[section][field];
  S.settingsDraft[section][field]=node.type==='checkbox'?node.checked:typeof old==='number'?Number(node.value):node.value;
  const status=document.querySelector('#settings-save-state');if(status)status.textContent=settingsDraftChanged()?'有未保存的设置':'已保存';
});
document.addEventListener('keydown',event=>{
  const node=event.target;if(!node.matches?.('[data-shortcut]')||event.key==='Tab')return;
  event.preventDefault();event.stopImmediatePropagation();
  if(['Control','Alt','Shift','Meta'].includes(event.key))return;
  const key=event.key===' '? 'SPACE':event.key.toUpperCase();
  node.value=['BACKSPACE','ESCAPE'].includes(key)?'':[event.ctrlKey?'Ctrl':'',event.altKey?'Alt':'',event.shiftKey?'Shift':'',event.metaKey?'Super':'',key].filter(Boolean).join('+');
  node.dispatchEvent(new Event('change',{bubbles:true}));
},true);

document.addEventListener('focusin',event=>{if(event.target.matches?.('[data-shortcut]'))api('settings_shortcut_capture',{active:true}).catch(error=>toast(error.message));});
document.addEventListener('focusout',event=>{if(event.target.matches?.('[data-shortcut]'))api('settings_shortcut_capture',{active:false}).catch(error=>toast(error.message));});
window.addEventListener('focus',()=>{if(document.activeElement?.matches('[data-shortcut]'))api('settings_shortcut_capture',{active:true}).catch(()=>{});});
