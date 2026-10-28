# 开发与验证

以下命令在项目根目录运行。Node 测试保存在 `electron/tests`，Python 测试保存在 `tests`。

Python 编辑器使用 `npm run build:editor` 构建本地 Monaco、中文语言包与 worker；`npm start`、`npm run test:ui` 和打包流程会自动调用。`electron/tests/python-language-service.test.cjs` 使用真实 Pyright/Ruff 验证补全、悬浮、参数提示、定义/引用、错误行号映射、future import 和格式化；`electron/tests/smoke/python-ide-smoke.cjs` 验证真实 Monaco 的补全撤销、查找、格式化撤销、问题定位、切页状态保留、控件插入、脚本弹窗和只读锁，不执行目标窗口输入。

```powershell
npm start
npm run check
npm test
npm run test:python
npm run test:all
```

`test:all` 依次执行前端语法检查、Node 单元测试和 Python 单元测试。`ECHO_TEST_PYTHON` 可指定 Electron 后端使用的 Python 可执行文件；Python 测试与工作台使用同一个运行时选择器，优先选择项目内便携 Python，无便携环境时再寻找本机 64 位 Python。

便携版优先使用 `runtime/python`。直接运行项目内 `runtime/node/node.exe scripts/smoke-ui.cjs` 可验证界面；`verify_portable.cmd` 验证屏蔽系统 Node/Python 路径后的依赖导入和禁止外部 HTTP 请求时的 OCR 推理。构建和运行说明见 [便携运行包](portable.md)。

2026-10-04 的自动检查通过：60 项 Node 测试、169 项 Python 测试，完整输出保存在 [test-all-python-latest.log](../artifacts/test-all-python-latest.log)。

MCP 回归覆盖标准 SDK 握手和工具模式、认证与文件边界、启动时旧主窗口识别、取消开始以及前台交接。成功的 MCP 截图、定位预览和 `passed` 执行保持工作台最小化；失败、停止和失联恢复工作台，录制停止返回录制结果。测试使用模拟窗口和后端，不发送真实目标应用输入。真实任务是否完成，需要另按 [MCP 验收流程](mcp.md#用完成所有新手任务验收) 检查目标应用截图、任务列表和执行报告。

识别回归覆盖多模板、倍率、锚点移动和缺失、颜色排除相似候选、遮罩动态区域、OCR 坐标与置信度、资产另存为和失败报告。界面冒烟的 `recognition-smoke.json` 检查新控件配置、锚点重命名 / 删除保护和未命中预览。`npm run test:ocr` 使用真实本地 OCR 模型读取已保存的目标应用「接受任务」「完成任务」模板，结果保存在 `artifacts/recognition-ocr-smoke.json`。这些检查不点击目标应用；真实识别率仍需要用不同状态的实机截图评估。Python 测试与工作台使用相同的运行时选择规则。

## 界面冒烟

实时安卓视频的无设备回归覆盖协议分片、帧大小限制、队列背压、关键帧恢复、会话切换、旋转坐标和解码失败回退，位于 `electron/tests/android-stream.test.cjs` 与 `android-video.test.cjs`。`electron/tools/android-video-probe.cjs --serial=<已授权设备序列号>` 可由 Electron 运行被动实机验证：只读取屏幕，不发送触控，报告保存为 `artifacts/smoke/android-live-video.json`。安装包和便携包内的 scrcpy 服务及许可文件由固定 SHA-256 校验，运行时不联网下载。

实时控制回归验证视频 dummy 字节之后才连接第二条控制通道、DOWN/MOVE/UP 编码和顺序、过期会话与坐标拒绝、取消 / 停止 / 旋转释放触点、文本按 300 字节分包，以及手势结束只记录一次而不重放。Python 回归验证连接不截图、兼容触控只截图一次、实时录制不执行 ADB 并保留比例坐标和时间。界面冒烟验证流畅模式连接不请求截图、按下 / 移动立即转发、松开不调用旧的滑动 RPC，以及 Esc 和重绘取消触控。实机被动探针从空画面直接启动视频，并报告 `controlReady` 与首个解码帧耗时。

安卓首版回归：`tests/test_android.py` 覆盖 ADB 设备状态、进程停止 / 超时、截图、触控、录制、目标绑定、屏幕旋转和真实执行器的图片 / OCR 识别；`artifacts/smoke/android-smoke.json` 检查设备页和预览坐标映射。测试使用模拟设备，不向真实手机发送输入。接入和实机验收步骤见 [安卓设备接入](android.md)。

```powershell
npm run test:ui
```

使用独立应用配置，检查页面加载、用例库、控件编辑、录制结果转换和主工作台桌面操作入口。结果位于 `artifacts/smoke/electron-smoke.json`、`electron-interaction.json`、`desktop-workspace-smoke.json`，截图也位于同一目录。结果中的 `errors` 应为空。用例运行面板的额外结果保存在 `artifacts/smoke/game-run-smoke.json`：验证本地用例选择、保留目标应用页、步骤 / 错误显示、进度更新保留运行结果区域、未保存内容保护及主工作台操作按钮；这部分拦截运行请求，不发送目标应用输入。测试会退出，不向目标应用发送输入。

也兼容设置 `ECHO_TEST_SMOKE_TEST=1` 后启动应用。

`replay-smoke.json` 验证录制完成后的重放按钮、单次执行和停止、执行进度与报告、编辑内容及录制结果保留，以及重复点击、空录制、未连接和启动失败保护。执行请求被拦截，不向目标应用发送输入；预览位于 `record-replay-preview.png`。

`script-smoke.json` 验证 Python 步骤的添加、编辑、展开编辑、Tab 缩进、导入、运行期间锁定和代码的 HTML 转义，截图为 `python-editor-preview.png`。Python 的 `test_scripting.py` 使用真实独立解释器和模拟目标应用后端，验证目标应用 API、源码与输出报告、跨步骤变量、异常行号、死循环超时、停止、输出上限、导入后另存为，以及 Windows Job Object 对脚本子进程的清理。MCP 测试验证脚本源码传递及大小校验。这些测试不操作真实目标应用。

`case-modes-smoke.json` 验证循环分组、生成代码只读预览、独立 Python 副本、共享控件参数插入、编辑锁定和返回低代码原稿；截图为 `lowcode-loop-preview.png`、`python-mode-preview.png`。`test_workflow.py` 检查嵌套循环、变量、结构和工作量限制、生成代码与低代码输入等价及脚本时限；`test_dual_modes_service.py` 使用临时控件库验证复制不修改源文件、改名别名与编辑路径恢复。

`python-completion-smoke.json` 验证输入 `window.` 后的函数列表、参数说明、前缀筛选、键盘与鼠标插入、Ctrl+Space、Esc，以及主编辑器、局部脚本和展开对话框。注释、字符串、只读预览和执行锁定状态不会触发编辑；预览为 `python-completion-preview.png`。Node 测试检查补全目录与运行时公开方法一致；Python 测试检查 `window` 主接口与历史 `game` 别名为同一对象。


## 真实目标窗口验证

`scripts/smoke-mcp-startup.cjs` 使用独立工作台配置验证 MCP 默认关闭、显式开启后的随机凭证 SDK 握手、显式关闭优先于强制开启和正常退出后的凭证清理，不连接目标应用或发送输入。已有工作台状态或 MCP 凭证时会拒绝覆盖；可以在安装测试的隔离目录中运行。结果为 `artifacts/mcp-startup-smoke.json`。

`help-smoke.json` 验证内置使用说明的导航、关键词搜索、目录跳转、F1、无目标应用连接时打开，以及未保存用例和录制结果保留；同时检查搜索文本不会作为 HTML 执行。页面预览为 `help-preview.png`，文档在本地静态加载，无需联网。

`desktop-workspace-smoke.json` 验证连接卡片的「操作目标窗口」、主工作台的图片 / 坐标采集和录制入口、1120 × 740 与 1440 × 900 下按钮布局，以及工具栏设置已移除。测试拦截采集和录制请求，不发送实际目标输入；`desktop-workspace-preview.png` 为页面预览。

录制回归包含启动过程、监听通知、事件计数、监听失败后恢复按钮，以及空录制重新启动和已有结果保护。`artifacts/smoke/recording-smoke.json` 记录工作台录制页回归结果，录制请求被拦截，不发送目标应用输入。原生连接验证不启动录制，手动操作采集需另行验收。

零事件录制的错误日志包含鼠标按钮、滚轮和按键的观察计数，以及本工具回放输入、失焦、客户区之外和被其他窗口遮挡的过滤计数。`mouse_queued` 区分钩子是否收到待处理的操作，`mouse_recorded` 表示通过窗口过滤的事件数。窗口查询在后台处理，回调立即返回，避免慢查询导致 Windows 静默移除钩子。诊断不写入按键内容；仅移动鼠标不会生成用例步骤。

需要当前目标应用句柄、可交互桌面以及与目标应用匹配的管理员权限。先正常关闭现有工作台，再连接同一客户端开展验证。

```powershell
python app.py --list-windows
npm run test:game -- --game <目标应用句柄>
```

`--game-smoke` 验证原生目标应用连接与重新连接不会创建侧边窗口，主工作台的操作入口可用，目标窗口的样式、尺寸及位置保持。它不启动录制、执行用例或发送目标应用输入，结束后正常关闭工作台。结果保存在 `artifacts/smoke/native-game-smoke.json`，`passed` 应为 `true`，`errors` 应为空。

手动焦点诊断：

```powershell
node_modules\electron\dist\electron.exe electron/tools/focus-probe.cjs <目标应用句柄>
```

诊断只激活、截图和短暂监听目标应用，结果保存在 `artifacts/probes/focus-probe.json`。

`node_modules\electron\dist\electron.exe . --record-diagnose --game <目标应用句柄>` 可在正常工作台中自动启动录制诊断。目标应用连接后手动点击；收到一次完整鼠标操作后自动停止，最长等待五分钟，也可手动停止。诊断不向目标应用发送操作，结束后正常保存录制并显示结果，计数和过滤原因存放在 `.runtime/recording-probe.json`。已有运行或待处理录制时取消诊断，不覆盖编辑内容。

录制同步注册 `RIDEV_INPUTSINK` 接收 Raw Input，在钩子收不到输入时提供独立通道。不会设置 `NOLEGACY` 或 `CAPTUREMOUSE`，不会改变目标应用的输入处理。同一个设备选择一个有效事件流，避免双重录制；`raw_mouse_observed`、`raw_key_observed`、`mouse_source`、`key_source` 和 `raw_input_error` 用于区分通道故障。实现依据 [Microsoft Raw Input](https://learn.microsoft.com/en-us/windows/win32/inputdev/using-raw-input)。

## CLI

```powershell
python app.py --case path/to/case.echo.json
python app.py --run --case path/to/case.echo.json --window 123456 --iterations 1
```

`app.py` 默认打开 Electron。CLI 执行必须显式指定用例和当前目标应用句柄；实际执行会向该窗口发送用例输入，执行报告保存在 `reports/<运行编号>`。

## 通用控件库回归

`tests/test_control_library.py` 验证跨用例更新和改名、旧控件去重与同名冲突、分类与搜索、图片／遮罩／锚点迁移、便携快照、删除保护、脚本名称兼容，以及服务在执行前解析最新配置。

界面冒烟的 `shared-controls-smoke.json` 使用隔离的共享库目录，验证分类创建和删除、名称／分类／OCR 搜索、步骤引用、切换用例后的库可见性和共享修改同步，不写入用户控件库，也不向目标应用发送输入。

## 默认管理员启动

`electron/tests/elevation.test.cjs` 和 `tests/test_mcp_startup.py` 验证默认 UAC 请求、已提权直接启动、参数引用与单实例锁释放、取消或失败停止启动，以及旧普通权限实例的预检。系统提权调用使用模拟，不弹出实际 UAC；Win32 适配器仅查询当前令牌。

界面冒烟使用 `ECHO_TEST_SMOKE_TEST=1` 隔离配置，MCP 启动冒烟显式传入 `--no-admin`，避免自动检查请求管理员权限或连接实际目标应用。普通调试可显式使用 `python app.py --no-admin` 或 `scripts/start-studio.ps1 -NoAdmin`；默认入口仍请求管理员权限。

编辑器界面冒烟中的可配置全局快捷键使用隔离注册适配器，不争用用户当前应用的 F6/F7 等快捷键；快捷键注册失败与回滚由 `electron/tests/settings.test.cjs` 单独覆盖。
