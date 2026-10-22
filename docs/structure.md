# 项目结构

JSON 用例包含版本、控件和步骤，也可保存显式添加的 Python 脚本步骤。截图模板随用例保存到旁边的 `assets` 目录，便于移动。报告保存到 `reports/<运行编号>`，包含 HTML、JSON、截图，以及脚本源码和输出，时间使用 UTC+8。所有数据保存在本机。

| 文件 | 职责 |
|---|---|
| electron/main.cjs、preload.cjs | 桌面窗口、文件对话框、受限 IPC、Python 进程通信 |
| electron/renderer/app.js | 工作台页面、表单、截图选择器、录制预览 |
| electron/renderer/case-modes.js、python-completion.js | 双模式编辑、循环组、控件参数插入及窗口 API 函数补全 |
| electron/renderer/game.html、game.js、game.css | 目标应用原生窗口旁的浮动工具栏 |
| electron/window-access.cjs | 按工作台与工具栏限制 IPC 权限 |
| echo_test/native_windows.py | 原生窗口查询、位置与 Win32 事件声明 |
| echo_test/legacy_window_recovery.py | 启动时恢复旧版本遗留的目标窗口状态 |
| echo_test/window_pair.py | 独立工具栏与目标应用的双向移动、最小化联动和解绑恢复 |
| electron/renderer/controls.js | 通用控件库、分类、搜索和共享控件选择 |
| echo_test/control_library.py | 共享定义持久化、旧控件迁移、稳定引用解析及删除保护 |
| echo_test/service.py | JSON 行协议服务，协调项目、录制和执行 |
| echo_test/recorder.py | Windows 鼠标 / 键盘低级监听、前台窗口过滤 |
| echo_test/recording.py | 将原始事件转换为控件和可编辑步骤 |
| echo_test/models.py、vision.py | 数据校验、保存和图片定位 |
| echo_test/backend.py、engine.py | Windows 输入、取消与释放、顺序执行和报告 |
| echo_test/workflow.py、codegen.py | 循环执行计划、变量替换与低代码生成独立 Python 副本 |
| echo_test/scripting.py、script_worker.py、script_process.py | 脚本导入、独立进程执行、目标应用操作通信、超时和停止、子进程清理 |

界面关闭 Node 集成，启用上下文隔离和沙箱；只允许本地页面通过白名单调用后端。参考 [Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security) 与 [Windows SetWindowsHookEx 文档](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowshookexw)。



## 目录约定

```text
echo-test/
├── app.py                       # Python CLI / 桌面启动入口
├── start.cmd / start_admin.cmd  # 双击启动
├── install_dependencies.cmd    # 依赖安装快捷入口
├── package.json / package-lock.json / requirements.txt
├── electron/                   # Electron 应用源码
│   ├── main.cjs / preload.cjs
│   ├── paths.cjs                # 运行状态与验证产物路径
│   ├── renderer/               # 工作台与窗口工具栏界面
│   ├── assets/                 # 应用图标
│   ├── tests/                  # Node 单元测试与 mock 服务
│   │   └── smoke/              # 工作台、工具栏和原生窗口冒烟
│   └── tools/                  # 手动焦点 / 录制诊断
├── echo_test/                # Python / Win32 测试后端
│   ├── paths.py                # 运行状态路径与旧版本兼容
│   └── ui.py                   # 保留的旧 Tk 界面代码
├── tests/                      # Python 单元测试
├── scripts/                    # 安装与界面冒烟启动脚本
├── runtime/                    # 便携 Python、Node、OCR 库与微软运行库安装器
├── dist/                       # 可分发的完整 ZIP 与 SHA-256
├── docs/                       # 使用、开发、目录说明
├── test_cases/                 # 用户保存的用例与 assets
├── projects/                   # 可选本地项目目录，初始为空
├── recordings/                 # 原始录制与转换结果
├── reports/                    # 用例执行历史、HTML 报告及截图
├── artifacts/                  # 可再生成的诊断 / 验证产物
│   ├── smoke/                  # 冒烟结果 JSON、截图
│   └── probes/                 # 手动诊断结果 JSON、截图
└── .runtime/                   # 工作台运行状态和诊断信息
```

根目录只保留项目说明、依赖配置与启动入口。启动和安装脚本以项目目录为工作目录，生成文件路径从源码位置计算；从其他目录启动时也不会向当前工作目录写入截图或状态文件。

`control_library`、`test_cases` 和 `projects` 初始为空库，新增用例和模板继续使用相对路径；`recordings` 和 `reports` 只保存本机运行数据。`artifacts` 与 `.runtime` 不纳入版本控制；请勿在工作台运行时清理 `.runtime`，其中包含工作台状态和诊断信息。正常退出会移除本次 `workbench-state.json`。

维护命令 `python -m echo_test.maintenance` 会请求工作台正常退出，结果写入 `.runtime/workbench-close.json`，保留未保存修改和运行状态保护；仍兼容旧版本在根目录生成的状态文件。

用户配置、最近打开的用例和错误日志继续保存在 `%APPDATA%\echo-test`。测试配置使用独立临时目录，避免覆盖正常工作台状态。

共享控件定义保存在 `control_library/controls.json`，模板集中到 `test_cases/assets`。用例内的 `selectors` 是实际引用的便携快照，通过 `library_id` 指向共享控件；加载、保存和运行时解析最新定义，步骤与锚点随名称更新。独立的脚本工作目录仍使用用例所在目录。
