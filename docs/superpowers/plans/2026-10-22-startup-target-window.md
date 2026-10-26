# 启动时显示目标窗口选择页

**Goal:** 软件正常启动后显示用户截图中的“选择目标窗口”界面。

**Design:** 用户提供的截图即视觉依据。现有 `target-window.js`、`target-window.css` 和工作台外壳已经实现相同布局，直接复用；真实连接状态决定是否展示当前窗口卡片。默认选择“选择窗口”，搜索入口及用例导航继续可用。打开本地用例仍进入用例编辑器，不把截图中的窗口标题或连接状态作为固定内容。

**Architecture:** 修改渲染器初始视图，不新增状态持久化或后端接口。沿用现有 Electron smoke 测试验证真实启动 DOM，再显式导航到用例页执行原有后续检查。

**Tech Stack:** Electron、原生 JavaScript、现有 HTML/CSS。

- [x] 在现有启动 smoke 结果中记录初始视图、选窗页和两种选择入口；要求启动视图是 `select-window`。先运行验证，观察当前默认 `cases` 失败。
- [x] 将 `electron/renderer/app.js` 中初始 `S.view` 改为 `select-window`；smoke 的用例交互先点击现有“测试用例”导航。
- [x] 运行 `npm run check` 与 `npm run test:ui`，检查真实初始页面截图和选窗交互、最小窗口尺寸结果。保留版本1.1.0，不发布或修改之前的安装包。

## 验证结果

- 修改前：`electron-smoke.json` 记录 `initialView: cases`、`startupTargetPage: false`，启动页断言失败。
- 修改后：`npm run check` 退出0；`npm run test:ui` 退出0并输出 `UI smoke passed`。启动页和两种选窗入口检查均为 true。
- `artifacts/smoke/electron-preview.png` 为真实未连接启动页面，已经目视检查。`target-window-smoke.json` 的连接、取消、搜索、断开、用例保留与最小尺寸布局检查均通过；`electron-interaction.json` 的用例列表、打开、编辑及录制转换检查均通过。
- 本次只修改项目启动页及现有 UI 验证，已有安装包未重新编译。
