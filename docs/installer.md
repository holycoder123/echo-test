# Windows 安装版

安装包为 `dist/latest/echo-test-1.2.0-setup-x64.exe`，适用于 Windows 10/11 x64。白色简约中文向导包含「欢迎 → 安装选项 → 安装 → 完成」四步，可以选择安装位置和是否创建桌面快捷方式。默认目录为当前用户的 `%LOCALAPPDATA%/Programs/EchoTest`，无需为程序本身申请管理员安装权限。完成页可选择启动工作台；静默安装和隔离测试不会自动启动。安装器不再提供 MCP 快捷方式选项，正常升级会清理旧版的 MCP 专用菜单快捷方式。

最新安装包、便携包和校验文件统一放在 `dist/latest/`。每次重建前，将旧 latest 文件完整保存在 `dist/history/v<版本>/<UTC构建时间>-<标识>/`，同版本重编译也不覆盖旧包。安装器和便携包使用同一次源码打包结果。

安装内容包括工作台、Electron、Node、Python、Tcl/Tk、图片识别和 OCR 库及模型，以及安卓连接所需的 ADB 和运行依赖。安卓功能无需用户另行安装 SDK。桌面和开始菜单的默认入口会通过 Windows UAC 请求管理员权限，MCP 默认关闭；已具备管理员权限时直接启动，取消权限确认则不启动。需要 MCP 时可在「设置 → MCP」中开启，或运行安装目录中的 `start_admin_mcp.cmd`。关闭主窗口后，安装目录中的 `start_no_mcp.cmd` 可强制禁用本次 MCP。已保存的手动开关继续生效。

产品名称统一为 EchoTest；仓库、包名和用户配置目录继续使用 `echo-test`。升级会从现有注册信息读取安装目录，保留已有安装位置与用户数据。

包内保留微软 C++ 离线安装器，系统缺少运行库时由启动入口调用。工作台运行期间请先保存用例并正常关闭，再升级或卸载。安装包尚未做数字签名。

## 升级和卸载

安装包直接提供离线运行环境，不会在用户电脑重复运行 pip / npm 安装依赖。安装或升级前，按组件核对目标目录中的环境文件大小和 SHA-256：Python（含识别库与 OCR 模型）、Node、安卓工具、运行库安装器及各个 npm 包完整且与本次载荷一致时直接复用，不重新写入；组件缺失、内容损坏或依赖版本变化时，安装或修复对应组件。仅安装了系统 Python / Node 不会跳过内置环境，以保证离线运行和版本兼容。系统 Visual C++ 运行库仍由启动入口检测，已有所需 DLL 时不再安装。

检测使用 Windows 自带的 PowerShell / .NET，不依赖被检查的 Python / Node；检测失败时回退为正常安装。安装详情会显示环境复用或修复信息，安装目录的 `echo-test-install.ini` 记录组件数量。首次安装正常写入全部环境；应用源码、运行环境说明和启动脚本随版本更新。该行为在下一次构建的安装包中生效，已发布的 1.2.0 安装包保持原样。

已存在的用例和模板不会被安装包覆盖。可以从 Windows 应用列表、开始菜单或安装目录的 `Uninstall.exe` 卸载。

卸载只移除程序及运行环境，保留 `test_cases`、`projects`、`reports`、`recordings` 以及用户生成的其他数据。保留数据时安装目录可能仍然存在；如需删除，卸载后先确认已备份，再自行处理。

## 构建

双击 `build_installer.cmd`。构建器使用已验证的便携 ZIP 作为载荷，并从 NSIS 官方发行包准备私有编译工具，无需全局安装编译器。NSIS 版本及发行包 SHA-256 固定在构建脚本中。

输出 EXE 与 SHA-256 文件。`scripts/installer.nsi` 定义安装和数据保留规则，`scripts/installer-ui/pages.nsh` 定义页面，`native.c` 绘制原生窗口、步骤和按钮，`resources.py` 生成 NSIS 对话框资源，并用运行环境已有的 Pillow 将透明品牌标识封装为 ICO。界面仅依赖 Windows 系统库，无需额外安装浏览器或运行环境。编译阶段会下载 SHA-256 固定的 TinyCC 0.9.27，缓存在 `.runtime/installer-build`；它不进入安装包。深层工作目录通过临时盘符映射避免 NSIS 的路径长度限制，构建结束会释放映射。

`scripts/installer-guard.py` 只读检查同一安装目录的工作台是否仍在运行。目录选择会拒绝相对路径、磁盘/共享根目录和 Windows 系统目录。

`scripts/test-installer.ps1` 在项目内隔离目录及专用注册表项中验证静默安装、重复安装后的用例保留、屏蔽系统 Node/Python 后的 OCR 与界面启动，以及卸载后的数据保留。测试不会安装到默认用户目录，也不会创建正式快捷方式。

`node scripts/python.cjs scripts/test-installer-environment.py` 使用独立的小型载荷和真实 NSIS 安装流程，验证首次安装、完整环境复用（文件修改时间保持不变）、损坏 / 缺失修复、依赖版本升级与用户数据保留；不替换 `dist/latest` 中的发行包。结果写入 `artifacts/installer-environment.json`。

`scripts/test-installer-ui.py <安装包> --target .runtime/installer-build/<新测试目录> --report artifacts/installer-ui.json` 检查真实向导的页面、目录校验、选项记忆和取消确认，并保存原生窗口截图。该检查不会执行安装；DPI 参数只能验证当前真实缩放，不能模拟其他系统缩放。

`scripts/test-installer-flow.py <安装包> --target .runtime/installer-build/<新测试目录> --report artifacts/installer-flow.json` 在隔离目录实际走完四步安装和卸载，检查真实解压进度、完成按钮及卸载保留数据。它使用专用测试注册项，禁用快捷方式和安装后启动；长工作路径建议通过临时盘符映射运行。

安装页的百分比来自 NSIS 原生进度状态，阶段由环境检查、文件写入和配置步骤实际触发。安装详情默认折叠；展开时增高窗口，收起和进入完成页时恢复高度。
