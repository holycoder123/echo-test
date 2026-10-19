# Windows 安装版

安装包为 `dist/echo-test-1.0.0-setup-x64.exe`，适用于 Windows 10/11 x64。中文向导可以选择安装位置和桌面快捷方式，默认目录为当前用户的 `%LOCALAPPDATA%/Programs/EchoTest`，无需为程序本身申请管理员安装权限。

安装内容包括工作台、Electron、Node、Python、Tcl/Tk、图片识别和 OCR 库及模型。桌面和开始菜单的默认入口会通过 Windows UAC 请求管理员权限，并默认启用 MCP；已具备管理员权限时直接启动，取消权限确认则不启动。旧的「MCP 管理员启动」入口仍兼容。关闭主窗口后，安装目录中的 `start_no_mcp.cmd` 可禁用本次 MCP。

产品名称统一为 EchoTest；仓库、包名和用户配置目录继续使用 `echo-test`。升级会从现有注册信息读取安装目录，保留已有安装位置与用户数据。

包内保留微软 C++ 离线安装器，系统缺少运行库时由启动入口调用。工作台运行期间请先保存用例并正常关闭，再升级或卸载。安装包尚未做数字签名。

## 升级和卸载

升级覆盖程序与运行环境，已存在的用例和模板不会被安装包覆盖。可以从 Windows 应用列表、开始菜单或安装目录的 `Uninstall.exe` 卸载。

卸载只移除程序及运行环境，保留 `test_cases`、`projects`、`reports`、`recordings` 以及用户生成的其他数据。保留数据时安装目录可能仍然存在；如需删除，卸载后先确认已备份，再自行处理。

## 构建

双击 `build_installer.cmd`。构建器使用已验证的便携 ZIP 作为载荷，并从 NSIS 官方发行包准备私有编译工具，无需全局安装编译器。NSIS 版本及发行包 SHA-256 固定在构建脚本中。

输出 EXE 与 SHA-256 文件。`scripts/installer.nsi` 定义向导、快捷方式、卸载入口和数据保留规则，`scripts/installer-guard.py` 只读检查同一安装目录的工作台是否仍在运行。

`scripts/test-installer.ps1` 在项目内隔离目录及专用注册表项中验证静默安装、重复安装后的用例保留、屏蔽系统 Node/Python 后的 OCR 与界面启动，以及卸载后的数据保留。测试不会安装到默认用户目录，也不会创建正式快捷方式。
