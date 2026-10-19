'use strict';
window.RunPanel = (() => {
  const labels = {running:'执行中',passed:'通过',failed:'失败',stopped:'已停止',pending:'未执行',skipped:'已禁用'};
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function html(run) {
    const current = run?.current;
    const step = current ? `步骤 ${current.index + 1} / ${run.steps.length} · ${current.name}` : run?.status === 'running' ? '正在准备目标窗口…' : run ? '尚未执行任何步骤' : '选择用例后点击运行，可在这里查看进度和结果';
    const detail = current ? `第 ${current.iteration} / ${run.iterations} 轮 · 重复 ${current.repeat} / ${run.steps[current.index].repeatTotal} 次` : '';
    return `<div class="run-summary" aria-live="polite"><div class="run-heading"><strong title="${escape(run?.case)}">${escape(run?.case || '运行状态')}</strong><span class="run-badge ${escape(run?.status || '')}">${labels[run?.status] || '待运行'}</span></div><div class="execution-current"><span title="${escape(step)}">${escape(step)}</span><small>${escape(detail)}${current ? ' · <span data-run-elapsed></span>' : ''}</small></div><div class="run-progress-line"><progress max="${run?.total || 1}" value="${run?.completed || 0}" aria-label="用例执行进度"></progress><span>${run?.completed || 0} / ${run?.total || 0}</span><span class="run-passed">通过 ${run?.passed || 0}</span><span class="run-failed">失败 ${run?.failed || 0}</span>${run?.stopped ? `<span>停止 ${run.stopped}</span>` : ''}</div>${run?.error ? `<div class="run-error">${escape(run.error)}</div>` : ''}</div>${run ? `<details class="run-details"><summary>各步骤结果 <span>${run.steps.length} 个步骤</span></summary><div class="run-step-list">${run.steps.map(row => `<div class="run-step ${row.status}" data-run-step="${row.index}"><span>${row.index + 1}</span><strong title="${escape(row.name)}">${escape(row.name)}</strong><span class="run-badge ${row.status}">${labels[row.status]}</span>${row.error ? `<div class="run-step-error">${escape(row.error)}</div>` : ''}</div>`).join('')}</div></details>` : ''}`;
  }
  function tick(node, run) {
    const elapsed = node?.querySelector('[data-run-elapsed]');
    if (elapsed && run?.current) elapsed.textContent = `${run.current.status === 'running' && run.status === 'running' ? ((Date.now() - run.current.started) / 1000).toFixed(1) : Number(run.current.elapsed || 0).toFixed(1)} 秒`;
  }
  function update(node, run, options = {}) {
    if (!node) return;
    const open = node.querySelector('details')?.open ?? options.expanded ?? false;
    const scroll = node.querySelector('.run-step-list')?.scrollTop || 0;
    node.innerHTML = html(run);
    const details = node.querySelector('details');
    if (details) details.open = !!open;
    const list = node.querySelector('.run-step-list');
    if (list) list.scrollTop = scroll;
    tick(node, run);
  }
  return {html, update, tick};
})();
