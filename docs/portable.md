# 便携运行环境

便携版面向 Windows 10/11 x64。解压 `dist/nycs-test-studio-win-x64.zip` 后双击 `start.cmd`，不依赖系统 Node.js、Python 或 npm。所有默认入口均请求管理员权限并启用 MCP；请确认 Windows UAC 提示，取消则不启动。已具有管理员权限时不会重复请求；`start_admin.cmd` 仍兼容。关闭当前工作台后，`start_no_mcp.cmd` 可禁用本次 MCP。

## 包内内容

| 路径 | 内容 |
|---|---|
| `runtime/python` | 隔离的 64 位 Python、标准库、Tcl/Tk、Pillow、NumPy、OpenCV、RapidOCR、ONNX Runtime 及其依赖与中英文模型 |
| `runtime/node` | 独立 Node.js、npm 与官方许可证，用于 MCP 代理和开发命令 |
| `runtime/redist/vc_redist.x64.exe` | 带微软签名的 Visual C++ 离线安装器；仅系统缺失运行库时由启动器调用 |
| `node_modules` | Electron 可执行文件和项目锁定的 JS 依赖，包括 Koffi 与 MCP SDK |
| `runtime/manifest.json` | 平台、实际版本、下载包校验值和 Python 包清单 |
| `requirements-portable.lock` | 本次构建的精确 Python 依赖版本 |

Python 使用官方可嵌入发行版，以相对路径加载项目和私有库，关闭用户环境干扰。Python 官方建议应用将依赖随嵌入发行版一起提供。[Python 嵌入发行版说明](https://docs.python.org/3.13/using/windows.html#the-embeddable-package)

启动器检查微软运行库是否存在；缺失时调用包内安装器，Windows 会要求确认管理员提示。这一步无需联网。Windows、显卡驱动及游戏客户端由目标电脑提供。

## 复制与验证

1. 完整解压 ZIP 到可写目录，保留目录结构。
2. 双击 `verify_portable.cmd` 检查 Python、Node 模块和真实 OCR。验证会屏蔽 PATH 中的系统 Node/Python，并在 OCR 推理时禁止外部 HTTP 请求，结果在 `artifacts/portable-verification.json`。
3. 双击 `start.cmd`。首次启动后再连接游戏。

报告、原始录制、工作台连接凭证和 `.runtime` 状态不会进入发行包。已保存的用例与模板会进入包中。便携包移动后，MCP 的外部注册路径需要重新生成：双击 `mcp_info.cmd`，使用输出的项目内 Node 路径登记代理。

额外的自定义脚本依赖需要加入私有 Python，例如运行 `runtime/python/python.exe -m pip install 包名`。这只修改当前项目运行环境；重新分发前更新版本清单并验证。

## 从源码构建

联网运行 `build_portable.cmd`，无需预先安装 Node/Python。脚本下载并校验官方 Python、Node 压缩包，安装私有 Python 库，验证微软安装器签名，并安装缺失的项目 JS 依赖；版本固定在构建脚本、`package-lock.json` 和 `requirements-portable.lock` 中。构建缓存位于 `.runtime/portable-build`。

完成后输出 `dist/nycs-test-studio-win-x64.zip` 和 SHA-256 文件。运行环境二进制与发行文件不进入 Git；源码和构建脚本保留在项目中。库的许可证保留在对应包目录，Electron 与 Node 的官方许可证也包含在发行包。
