<p align="center">
  <img src="docs/brand/github-banner.svg" width="100%" alt="echo test — 每一次测试，都有回响">
</p>

<p align="center">
  <strong>面向 Windows 桌面应用的低代码自动化测试工作台</strong><br>
  录制真实操作，复用识别控件，让每一次回归都有可追溯的结果。
</p>

<p align="center">
  <a href="https://github.com/holycoder123/echo-test/releases/latest"><img alt="下载最新版本" src="https://img.shields.io/badge/release-download-122D39?style=flat-square"></a>
  <img alt="Windows 10 / 11 x64" src="https://img.shields.io/badge/Windows-10%20%2F%2011%20x64-122D39?style=flat-square">
  <img alt="Electron + Python" src="https://img.shields.io/badge/Electron%20%2B%20Python-desktop-42D6B0?style=flat-square&amp;labelColor=122D39">
  <img alt="支持 MCP" src="https://img.shields.io/badge/MCP-supported-42D6B0?style=flat-square&amp;labelColor=122D39">
</p>

<p align="center">
  <a href="https://github.com/holycoder123/echo-test/releases/latest"><strong>下载应用</strong></a> ·
  <a href="docs/user-guide.md">使用指南</a> ·
  <a href="docs/mcp.md">MCP 接入</a> ·
  <a href="docs/brand/README.md">品牌资源</a> ·
  <a href="https://github.com/holycoder123/echo-test/issues">反馈问题</a>
</p>

## 从一次操作，到可重复的测试

echo test 将窗口连接、操作录制、步骤编辑、控件识别和执行报告放在同一个工作区。目标应用保持原生独立窗口，测试工具栏可捆绑在一旁，适合桌面应用的重复操作验证与回归测试。

| 连接与录制 | 识别与编排 | 执行与回响 |
| --- | --- | --- |
| 按标题、进程名或 PID 查找窗口；录制鼠标与键盘操作 | 使用坐标、截图、OCR 与锚点定位；编辑步骤与图片断言 | 运行用例，查看步骤状态、截图、HTML 报告和错误日志 |

## 工作台一览

以下截图使用演示数据展示实际界面。

<img src="docs/images/workbench.png" width="100%" alt="echo test 桌面工作台：用例步骤、目标窗口连接及参数编辑">

<details>
<summary><strong>查看共享控件库与窗口工具栏</strong></summary>

跨用例复用的控件库，支持分类、搜索和图片预览。

<img src="docs/images/controls.png" width="100%" alt="共享控件库及控件预览">

目标窗口旁的纵向工具栏，集中呈现录制入口和运行进度。

<img src="docs/images/toolbar.png" width="380" alt="窗口工具栏中的用例执行进度">

</details>

## 能做什么

| 能力 | 使用方式 |
| --- | --- |
| **操作录制与回放** | 将鼠标、键盘操作转换为可编辑用例；按 F12 停止录制或执行 |
| **图像与 OCR 识别** | 按坐标、图片或文字识别控件，结合锚点配置定位 |
| **通用控件库** | 在多个用例间共享控件，统一维护分类、名称和识别配置 |
| **断言与等待** | 配置图片存在、不存在和等待图片，核对目标应用状态 |
| **Python 脚本步骤** | 编写或导入 `.py` 步骤，处理变量、组合操作、超时和停止 |
| **本地执行报告** | 查看运行历史、步骤状态、截图、脚本输出与错误详情 |
| **MCP 接入** | 通过工作台截图和探索少量步骤，验证后再保存为正式用例 |
| **离线运行** | 发行包捆绑 Node.js、Python、Electron、识别依赖及中英文 OCR 模型 |

## 开始使用

### 下载发行包

前往 [GitHub Releases](https://github.com/holycoder123/echo-test/releases/latest)，选择适合你的版本：

| 版本 | 启动方式 |
| --- | --- |
| **Windows 安装版** | 运行 `echo-test-<版本>-setup-x64.exe`，按中文向导安装，从桌面或开始菜单启动 |
| **Windows 便携版** | 将 `echo-test-<版本>-portable-x64.zip` 完整解压到可写目录，双击 `start.cmd` |

支持 **Windows 10/11 x64**。发行包无需另装 Node.js 或 Python；默认启动会请求 Windows 管理员权限并开启 MCP。下载后可用同版本 SHA256 文件校验完整性，详见 [安装版](docs/installer.md) 与 [便携版](docs/portable.md) 文档。

> 本页展示当前源码的品牌与界面；已发布发行包以对应版本标签为准。

### 完成第一条用例

1. **连接窗口**：打开目标应用，在工作台搜索并连接目标窗口。
2. **录制操作**：开始录制，在目标应用中操作，点击停止或按 `F12`。
3. **整理用例**：将录制转换为用例，检查步骤，添加识别控件与图片断言。
4. **运行并检查**：保存用例，点击运行，在「运行记录」查看结果与报告。

`Ctrl+S` 保存 · `Ctrl+Shift+S` 另存为 · `F1` 打开离线使用说明。新工作区从空白用例与空控件库开始。

## 开发与构建

```powershell
git clone https://github.com/holycoder123/echo-test.git
cd echo-test
.\install_dependencies.cmd
npm start
```

```powershell
npm run test:all    # 源码检查、Node 与 Python 测试
npm run test:ui     # 独立配置目录中的界面冒烟
.\build_portable.cmd
.\build_installer.cmd
```

Electron 负责桌面界面，Python / OpenCV / Win32 负责识别、录制与执行。运行环境位于项目内的 `runtime/`；测试与打包的完整要求见 [开发与验证](docs/testing.md)。

## 文档导航

| 想了解什么 | 从这里开始 |
| --- | --- |
| 连接、录制、控件识别、断言与报告 | [使用指南](docs/user-guide.md) |
| 运行环境、共享控件及本地数据管理 | [工作区详解](docs/workspace.md) |
| 安装、升级、卸载与离线分发 | [Windows 安装版](docs/installer.md) · [便携运行包](docs/portable.md) |
| 接入支持 MCP 的客户端 | [MCP 接入](docs/mcp.md) |
| 扩展 Python 测试步骤 | [Python 脚本](docs/python-scripts.md) |
| 代码结构、测试与发布变化 | [项目结构](docs/structure.md) · [开发与验证](docs/testing.md) · [v1.0.0](docs/releases/v1.0.0.md) |
| Logo、桌面图标与分享封面 | [品牌资源及使用规范](docs/brand/README.md) |

用户用例、控件模板、录制及报告保存在本机。备份或迁移时请一并保留 `test_cases/`、`control_library/` 等数据目录，具体约定见 [工作区详解](docs/workspace.md)。

---

<p align="center"><strong>echo test</strong><br>每一次测试，都有回响。</p>
