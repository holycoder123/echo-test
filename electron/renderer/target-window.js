function targetWindowSelectionView(){
  const locked=disabled()||S.connecting||S.windowPicking?'disabled':'';
  const current=S.connection;
  return `<div class="target-window-page">
    ${current?`<section class="target-current"><span class="target-current-icon">${icon('game')}</span><div><small>当前目标窗口</small><strong title="${esc(current.title)}">${esc(current.title)}</strong><span>${esc(current.process_name||'应用窗口')} · PID ${current.pid} · ${current.width} × ${current.height}</span></div><div class="target-current-actions">${button('操作目标窗口','view-game','','game',locked)}${button('断开连接','target-disconnect','ghost','',locked)}</div></section>`:''}
    <div class="target-methods" role="tablist" aria-label="选择目标窗口的方式"><button class="target-method ${S.targetWindowMode==='pick'?'active':''}" role="tab" aria-selected="${S.targetWindowMode==='pick'}" data-act="target-mode" data-mode="pick"><span class="target-method-number">01</span><span class="target-method-icon">${icon('coordinate')}</span><span><strong>选择窗口</strong><small>用鼠标直接指选屏幕上的窗口</small></span>${icon('check')}</button><button class="target-method ${S.targetWindowMode==='search'?'active':''}" role="tab" aria-selected="${S.targetWindowMode==='search'}" data-act="target-mode" data-mode="search"><span class="target-method-number">02</span><span class="target-method-icon">${icon('search')}</span><span><strong>搜索窗口</strong><small>按标题、进程或 PID 查找并连接</small></span>${icon('check')}</button></div>
    <section class="target-method-panel">${S.targetWindowMode==='search'?targetWindowSearchView():`<div class="target-point-layout"><div class="target-point-art" aria-hidden="true"><div class="target-art-back"><i></i><i></i><i></i></div><div class="target-art-window"><div><i></i><i></i><i></i><span>应用窗口</span></div><span class="target-art-lines"></span><span class="target-art-cursor">${icon('click')}</span><span class="target-art-label">${icon('check')}单击确认选择</span></div></div><div class="target-point-copy"><h2>指向窗口，单击选中</h2><p>开始后工具会自动最小化。将鼠标移到要测试的窗口上，高亮边框会显示当前选中的范围。</p><ol><li><span>1</span>点击「开始选择」，回到桌面</li><li><span>2</span>悬停目标窗口，确认高亮范围</li><li><span>3</span>单击确认，自动连接该窗口</li></ol><div class="target-point-actions">${S.windowPicking?button('取消选择','target-pick-cancel','primary','close'):button('开始选择','target-pick-start','primary','coordinate',locked)}<span><kbd>Esc</kbd> / <kbd>F12</kbd> 取消</span></div><small class="target-point-hint">确认点击仅用于选择窗口，不会触发目标应用中的操作。</small></div></div>`}</section></div>`;
}
function targetWindowSearchView(){return `<div class="target-list-heading"><div><h2>搜索窗口</h2><p>展示可选择的应用窗口，包含最小化窗口。</p></div>${button('刷新窗口','refresh','','refresh',disabled())}</div><div class="target-list-tools"><div class="search"><span>${icon('search')}</span><input type="search" id="target-window-search" placeholder="输入窗口标题、进程名称或 PID" value="${esc(S.windowSearch)}" aria-label="搜索窗口" autocomplete="off" ${disabled()}><button class="icon-button" data-act="window-search-clear" title="清除搜索" aria-label="清除窗口搜索" ${S.windowSearch?'':'hidden'}>${icon('close')}</button></div><span id="target-window-count"></span></div><div id="target-window-results">${targetWindowRows()}</div>`;}
function targetWindowRows(){
  const matches=matchingWindows();
  return matches.length?`<table class="target-window-table"><thead><tr><th>窗口标题</th><th>进程 / PID</th><th>操作</th></tr></thead><tbody>${matches.map(item=>{const connected=item.handle===S.connection?.handle&&item.pid===S.connection?.pid;return `<tr class="${connected?'connected':''}"><td><div>${icon('game')}<strong title="${esc(item.title)}">${esc(item.title)}</strong>${connected?'<span class="target-row-badge">当前目标</span>':''}</div></td><td><span>${esc(item.process_name||'未知进程')}</span><small>PID ${item.pid}</small></td><td>${button(connected?'已连接':'连接','target-connect',connected?'quiet':'',connected?'check':'',`data-handle="${item.handle}" ${disabled()||S.connecting||connected?'disabled':''}`)}</td></tr>`;}).join('')}</tbody></table>`:`<div class="target-window-empty">${icon('search')}<strong>${S.windowSearch?'没有匹配的窗口':'暂未发现可选择的窗口'}</strong><p>${S.windowSearch?'尝试其他标题、进程名称或 PID。':'请启动目标应用，列表会自动更新，也可以点击刷新。'}</p></div>`;
}
function updateTargetWindowResults(){
  const results=document.querySelector('#target-window-results');if(!results)return;
  results.innerHTML=targetWindowRows();
  const count=document.querySelector('#target-window-count');if(count)count.textContent=matchingWindows().length+' 个窗口';
  const clear=document.querySelector('[data-act="window-search-clear"]');if(clear)clear.hidden=!S.windowSearch;
}
async function chooseTargetWindow(){
  if(lock()||S.connecting)return;
  S.windowPicking=true;render();
  try{
    const data=await api('window_pick_start');
    if(data.connection){S.connection=data.connection;S.handle=data.connection.handle;toast('已连接目标窗口','success');}
    else if(data.reason==='timeout')toast('窗口选择已超时，可以重新开始');
  }finally{S.windowPicking=false;render();}
}
