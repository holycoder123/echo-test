'use strict';
// Local, curated instructions. No network or game connection is needed to read them.
window.StudioHelp = (() => {
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const sections=[
    {id:'start',title:'快速开始',keywords:'入门 第一次 商城',body:`
      <p>便携版已包含 Node.js、Python、Electron、OCR 依赖和模型。完整解压到可写目录后双击 <code>start.cmd</code>，无需另装 Node/Python；缺少微软 C++ 运行库时，启动器会使用包内安装器补齐。请保留 <code>runtime</code> 和 <code>node_modules</code> 目录。</p>
      <p>默认启动请求管理员权限并启用本机 MCP 接口，请确认 Windows 权限提示。接入信息可通过 <code>mcp_info.cmd</code> 查看；已有管理员权限时不会重复请求；取消权限确认则不启动。关闭当前主窗口后，<code>start_no_mcp.cmd</code> 可禁用本次 MCP。</p>
      <ol><li>启动游戏，再打开工作台。启动工作台时确认 Windows 管理员权限提示。</li>
      <li>右上角点击刷新，选择游戏窗口后点击「连接」。只有一个客户端时可以直接连接。</li>
      <li>点击「开始录制」，在游戏中完成一段操作，然后按 <kbd>F12</kbd> 或点击停止按钮。</li>
      <li>在录制结果中选择「创建新用例」或「追加到当前用例」，检查步骤和控件。</li>
      <li>为关键结果添加「图片存在」断言，例如点击商城按钮后检查商城标题。</li>
      <li>保存用例，点击运行，在「运行记录」查看步骤结果和报告。</li></ol>
      <p class="help-note">录制生成操作步骤，业务结果需要补充断言。第一次运行前先确认角色位置、已打开的面板和游戏分辨率符合用例要求。</p>`},
    {id:'connect',title:'连接游戏与进程识别',keywords:'窗口 句柄 PID 找不到 多开 管理员 exe',body:`
      <p>右上角刷新会列出可见且标题包含「诺亚传说」的窗口。下拉列表显示服务器名称和进程 ID（PID），多开时选择要测试的客户端。</p>
      <p>连接后，工具使用窗口句柄和 PID 确认目标。窗口关闭、进程变化或游戏失去焦点时，会要求重新连接或停止输入。当前候选筛选依赖窗口标题，尚未校验游戏 EXE 名称和路径，请确认选中的是游戏客户端。</p>
      <p>发现窗口后再点击「连接／重新连接」。仅刷新列表不会自动替换当前连接；切换客户端前先停止录制和执行。</p>`},
    {id:'window',title:'独立游戏窗口与工具栏',keywords:'捆绑 解绑 右侧 拖动 最小化 窗口',body:`
      <p>游戏使用独立窗口。纵向工具栏优先捆绑在游戏右侧，宽约 380 像素、高度接近游戏窗口；窄屏会收窄，空间不足时按可用区域摆放。</p>
      <ul><li>拖动游戏或工具栏会带动另一个窗口，最小化与恢复也会联动。</li><li>点击连接信息旁的「解绑」可自由移动，再点「捆绑游戏」恢复。录制或执行期间不能切换捆绑。</li><li>工具栏上方用于录制和采集，中间选择用例、设置循环和查看进度，下方打开工作台、日志和说明。</li><li>关闭工具栏不会关闭游戏，从工作台左侧「游戏窗口 ↗」可重新打开。</li></ul>
      <p>游戏保持独立窗口和原分辨率。录制与采集在游戏工具栏中操作，采集时使用当前截图取点或框选；编辑用例与控件时可打开工作台。</p>`},
    {id:'record',title:'录制、重放与转换',keywords:'F12 手动操作 未录到操作 零事件 输入法',body:`
      <ol><li>连接目标游戏，点击「开始录制」，等待按钮显示监听已启动。</li><li>直接操作游戏。支持鼠标点击、双击、右键、长按、拖动、滚轮，以及键盘按下和松开。</li><li>按 <kbd>F12</kbd> 或点击「停止录制」。独立工具栏可点击「查看录制结果」。</li><li>可先「重放录制」验证一次，再选择追加或创建用例。重放结束后仍保留录制结果。</li><li>检查生成的比例坐标，必要时替换成图片控件，并添加等待和断言。</li></ol>
      <p>录制只采集当前游戏的有效输入，点击工具栏和表单不会加入步骤。原始事件保存在 <code>recordings</code> 中。</p>
      <p>中文输入法候选、粘贴内容不能仅靠按键恢复，请改成「输入文本」步骤。复杂的鼠标与键盘重叠操作需要检查生成步骤的顺序和等待时间。</p>
      <p>出现「未录到操作」时查看录制诊断，确认权限、游戏焦点和监听状态，然后使用「重新录制」。已有事件的录制需要先转换或明确丢弃。</p>`},
    {id:'selectors',title:'坐标、图片与 OCR 控件',keywords:'定位 模板 识别 阈值 ROI 锚点 遮罩 颜色 多模板 OCR',body:`
      <p>在「通用控件库」给按钮、标题或提示命名，所有用例共享这些控件，切换用例不会更换控件库。通过左侧分类和搜索按名称、分类或 OCR 文字筛选；可在「管理」中修改分类。点击步骤的「目标控件」或「拖动终点」打开控件库窗口，通过分类、搜索和图片预览找到控件，选中后点击「确认选择」。图片断言或等待图片只显示图片／OCR 控件。修改共享控件后其他引用也会更新，已被用例或锚点引用的控件不能删除。「预览定位」只显示识别结果，不发送点击。</p>
      <table><thead><tr><th>设置</th><th>使用方法</th></tr></thead><tbody>
      <tr><td>坐标定位</td><td>从截图取点，原点为游戏客户区左上角，不包含标题栏。比例坐标为 0～1；像素坐标适合固定分辨率。</td></tr>
      <tr><td>图片模板</td><td>框选稳定、独特的文字或图标，保留少量边缘，避开动画和大块纯色。采集时移开鼠标，避免悬停状态变化。</td></tr>
      <tr><td>阈值与倍率</td><td>默认阈值 0.86；越高越严格。倍率可填写 <code>0.9, 1, 1.1</code>。用预览校准，并测试目标不存在的画面；分数不是正确率。</td></tr>
      <tr><td>搜索区域</td><td>格式为 <code>X, Y, 宽, 高</code>，单位为客户区像素。限定到目标所在面板可减少重复图案干扰。</td></tr>
      <tr><td>附加模板</td><td>最多 10 张，保存正常、悬停、选中等状态。执行时比较各模板和倍率，选择通过校验的最高分候选。</td></tr>
      <tr><td>定位锚点</td><td>先创建稳定的面板标题控件，再将其选为锚点。搜索区域相对锚点匹配框左上角，X/Y 可为负数，例如 <code>-20, 30, 300, 180</code>。锚点缺失时不退回全屏搜索。</td></tr>
      <tr><td>颜色容差</td><td>留空关闭。0 最严格，255 最宽松，可从 40 开始校准。用于区分同形状但颜色不同的状态。</td></tr>
      <tr><td>模板遮罩</td><td>导入与对应模板尺寸一致的黑白 PNG。白色参与匹配，黑色忽略动画或倒计时；有效区域仍需包含文字或图案。</td></tr>
      <tr><td>OCR 文字</td><td>选择「OCR 文字」，填写目标文字，使用「整行一致」或「包含目标文字」。忽略空白、大小写及全角／半角差异；点击识别整行的中心，可配置点击偏移。</td></tr>
      </tbody></table>
      <p>预览未命中时可查看橙色最佳候选框、分数、倍率和原因；启用颜色校验时还显示颜色差异。执行失败报告保留识别诊断和候选截图。</p>
      <p>便携版已内置本地中英文 OCR 模型和 64 位 Python。可运行 <code>verify_portable.cmd</code> 检查环境；若缺少文件，重新解压完整便携包。源码目录可联网运行 <code>install_dependencies.cmd</code> 准备私有环境。UI 缩放、皮肤或分辨率变化后，需要重新校准。</p>`},
    {id:'steps',title:'编排步骤与验证结果',keywords:'添加步骤 拖动 排序 双击 长按 等待 断言',body:`
      <p>在「测试用例」页点击「添加步骤」，选择操作并在右侧编辑目标控件和参数。可拖动排序、复制、删除、启用／禁用步骤，以及设置重复次数、超时和步骤后等待。</p>
      <table><thead><tr><th>类型</th><th>常用步骤</th></tr></thead><tbody>
      <tr><td>鼠标</td><td>单击、双击、右键、长按、拖动、滚动；拖动需设置起点与终点控件。</td></tr>
      <tr><td>键盘与文字</td><td>按键组合，如 <code>CTRL+A</code>、<code>ENTER</code>；按下／松开按键；输入文本前先聚焦输入框。</td></tr>
      <tr><td>等待与验证</td><td>等待图片、图片存在、图片不存在；目标可以是图片模板或 OCR 控件。页面切换后先等待稳定标题，再进行下一步。</td></tr>
      <tr><td>证据</td><td>保存截图，或在关键操作后添加断言。用结果变化确认业务完成。</td></tr>
      </tbody></table>
      <p class="help-note">示例：单击「商城按钮」→ 等待「商城标题」→ 断言图片存在。仅有鼠标点击成功不能证明商城已经打开。</p>`},
    {id:'run',title:'运行用例与查看报告',keywords:'执行 循环 停止 失败 报告 进度',body:`
      <p>工作台游戏页或独立工具栏的用例下拉框可选择「当前编辑」内容或本地已保存用例。设置循环次数后点击「运行用例」。选择其他文件时，未保存修改会先提示处理。</p>
      <p>运行区域显示实际用例名称、当前步骤、轮次、耗时、进度以及通过／失败数量。独立工具栏的步骤结果默认展开，长名称和错误详情可以滚动查看。</p>
      <p>失败会停止后续步骤。点击「停止执行」或按 <kbd>F12</kbd> 中止；运行结束会释放工具持有的按键和鼠标。运行期间不要切换游戏焦点、最小化游戏或切换显示模式。</p>
      <p>完成后在「运行记录」查看结果并打开本地 HTML 报告。报告位于 <code>reports/&lt;运行编号&gt;</code>，包含步骤状态、耗时、错误和截图；识别失败时还有候选框及诊断。</p>`},
    {id:'scripts',title:'Python 脚本步骤',keywords:'自定义 代码 导入 print variables game API',body:`
      <p>选择「添加步骤 → Python 脚本」，可直接编写、展开编辑或导入 UTF-8 编码的 <code>.py</code> 文件。导入复制代码到用例中，点击运行才执行。代码会随 JSON 用例保存。</p>
      <p>默认超时 30 秒，更多设置中可调整；输出和异常行号进入报告，F12 可以停止。脚本使用工作台后端的 Python 环境和权限，外部模块与数据文件需要另行携带。</p>
      <pre><code>print("游戏尺寸：", game.size())
game.click("任务按钮")
game.assert_image("任务列表标题", timeout=5)
game.screenshot()</code></pre>
      <p>将示例中的控件名称替换成当前控件库中的名称。常用调用：<code>game.key("ENTER")</code>、<code>game.text("测试文本")</code>、<code>game.sleep(1)</code>。</p>
      <p>内置对象包括 <code>case_dir</code>、<code>report_dir</code>、<code>step_name</code> 和 <code>variables</code>。每个脚本步骤使用独立进程；跨步骤数据放入可 JSON 保存的 <code>variables</code> 字典。</p>`},
    {id:'files',title:'保存、迁移与快捷键',keywords:'文件 目录 assets 另存为 Ctrl+S F1 日志',body:`
      <p>表单修改先保留在当前编辑内容中，点击「保存」写入磁盘。未保存修改会显示圆点或「未保存」提示。</p>
      <table><thead><tr><th>快捷键</th><th>作用</th></tr></thead><tbody>
      <tr><td><kbd>Ctrl+S</kbd></td><td>保存当前用例。</td></tr><tr><td><kbd>Ctrl+Shift+S</kbd></td><td>另存为。</td></tr>
      <tr><td><kbd>F12</kbd></td><td>停止录制或执行；被其他程序占用时使用停止按钮。</td></tr>
      <tr><td><kbd>F1</kbd></td><td>工作台或工具栏获得焦点时打开使用说明；游戏获得焦点时仍由游戏处理。</td></tr></tbody></table>
      <ul><li><code>test_cases</code>：新用例默认保存目录，支持子目录。</li><li><code>assets</code>：用例旁的图片模板和遮罩。移动用例时一起移动，另存为会复制引用的图片。</li><li><code>recordings</code>：原始录制和转换结果。</li><li><code>reports</code>：执行报告、结果和截图。</li></ul>
      <p>「测试用例」页可搜索已保存文件，并刷新或打开用例目录。错误日志页可打开日志目录或导出记录；日志默认在 <code>%APPDATA%/nycs-test-studio/logs</code>，重启后仍可查看。</p>`},
    {id:'faq',title:'常见问题与排查',keywords:'故障 报错 权限 零事件 不识别 误匹配 找不到 窄屏',body:`
      <dl><dt>找不到游戏窗口</dt><dd>确认游戏已启动，窗口标题包含「诺亚传说」，再点击右上角刷新。多开时核对列表中的服务器名称与 PID。</dd>
      <dt>无法连接、激活或录制</dt><dd>游戏以管理员运行时，使用 start_admin.cmd 启动工具；手动切回目标游戏，关闭弹窗后重试。在「错误日志」查看具体错误及日志编号。</dd>
      <dt>录制结果没有事件</dt><dd>确认录制已启动，并在实际游戏窗口中点击或按键。仅移动鼠标不会生成步骤；查看录制诊断中的权限、前台窗口与监听状态。</dd>
      <dt>图片找不到或点错位置</dt><dd>先「预览定位」，检查候选框与分数。重新截取稳定模板，限定搜索区域，按实际 UI 尺寸设置倍率；移动面板可使用锚点，多状态按钮可添加模板。</dd>
      <dt>OCR 无法使用或文字识别不准</dt><dd>先运行 verify_portable.cmd；缺少文件时重新解压完整便携包，源码目录可联网运行 install_dependencies.cmd。文字模糊时扩大搜索区域或重新截图，对短文字限定面板，检查「整行一致／包含」设置。</dd>
      <dt>工具栏无法与游戏同时放入屏幕</dt><dd>工具栏会优先右侧并适当收窄。仍放不下时可手动解绑、将工具栏移到其他位置或移到更大的屏幕，游戏分辨率不会自动缩小。</dd>
      <dt>用例失败或游戏失去焦点</dt><dd>先查看失败步骤和报告截图，恢复用例要求的初始状态后重跑。检查等待时间、控件位置、游戏焦点和分辨率。</dd></dl>`}
  ];
  const searchable=row=>(row.title+' '+row.keywords+' '+row.body.replace(/<[^>]*>/g,' ')).normalize('NFKC').toLocaleLowerCase();
  function contents(query='') {
    const words=query.trim().normalize('NFKC').toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const rows=sections.filter(row=>words.every(word=>searchable(row).includes(word)));
    if(!rows.length)return `<div class="help-empty" role="status"><strong>没有找到相关说明</strong><p>试试「录制」「OCR」「锚点」「报告」等关键词，或清空搜索查看全部。</p></div>`;
    return `<div class="help-layout"><nav class="help-toc" aria-label="使用说明目录"><span>说明目录${words.length?' · '+rows.length+' 项':''}</span>${rows.map(row=>`<button data-act="help-section" data-section="${row.id}">${row.title}</button>`).join('')}</nav><div class="help-articles">${rows.map(row=>`<article class="help-article" id="guide-${row.id}" aria-labelledby="guide-title-${row.id}"><h2 id="guide-title-${row.id}">${row.title}</h2>${row.body}</article>`).join('')}</div></div>`;
  }
  function render(query='') {
    return `<div class="page-heading help-heading"><div><h1>使用说明</h1><p class="sub">从连接游戏到查看执行结果 · 内置文档，离线可用</p></div><label class="help-search"><span>搜索说明</span><input id="help-search" type="search" placeholder="搜索录制、OCR、锚点…" value="${escape(query)}" aria-label="搜索使用说明"></label></div><div class="help-results">${contents(query)}</div>`;
  }
  return {render,contents};
})();
