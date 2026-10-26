# 安装器预览还原修正

延续用户已确认的 HTML 预览，不重新设计。修复上下步骤条、GDI 字体回退、默认 NSIS 详情列表挤压布局以及缺少百分比/阶段的差异。

1. 原生资源加入百分比、阶段、详情折叠控件；先记录缺失控件测试失败。
2. 横向步骤、透明品牌标识、统一中文无衬线字体与预览尺寸；真实 PBM 状态驱动百分比，真实 NSIS 阶段驱动任务状态。
3. 默认折叠详情；展开时增加窗口高度，完整显示日志并复位，不遮挡正文。
4. 小型原生 NSIS 测试程序逐页拍摄真实屏幕，测量控件范围及验证百分比/详情交互，再编译独立命名的完整安装包。
5. 对完整包验证安装和完成页，保存截图和 SHA-256。保留之前的构建与所有用户数据。

## 完成证据

- 资源合同测试先因缺少百分比/阶段/详情控件失败，修正后4项通过。
- `artifacts/fidelity-fixture.json`：实际 NSIS 进度值、标题700字重、折叠/展开/恢复窗口、展开状态自动进入完成页及正常正文范围均通过。
- `artifacts/fidelity-uninstall-fixture.json`：卸载内容不含安装阶段、日志开关、无重叠页脚、正常完成关闭均通过。
- `artifacts/fidelity-installer-ui.json`：最终完整包页面、路径校验、选项记忆及取消交互通过。
- `artifacts/fidelity-full-flow.json`：最终完整包实际安装、真实进度、展开详情后的完成页、正常完成退出、实际卸载、报告保留及注册表恢复均通过。
- `artifacts/fidelity-payload.json`：编译资源、载荷及本地源代码的校验值一致，未混入本地用户控件或私有编译缓存。
- 独立代码复查发现的完成页过高、卸载共用模板及静默调用问题均已修正；另以实际原生程序发现并修正卸载页脚覆盖关闭按钮的问题。
- 实际验证为96 DPI。桌面后来无法直接抓屏，最终图像使用原生窗口 PrintWindow 渲染；最终完整包也已记录实际15%安装进度图。
- 新本地产物 `dist/echo-test-1.1.0-setup-refined-x64.exe`，257,833,269字节；SHA-256 `9b6c5f4c4e38f45c1341cbcd3a53b526c8c8e344b2ef8d6d6ad5d4f0ac508ba6`。旧构建保留，未发布。

## 边框跟进（2026-10-22）

- 按用户反馈补上1像素浅灰边框（RGB 217,219,224）并保留圆角。使用原生 WS_BORDER 和非客户区绘制，客户区仍为736×600，展开详情为736×720；96 DPI 下外框为738×602 / 738×722。
- 资源测试先因缺少 WS_BORDER 失败，修正后4项通过；原生 DLL 编译通过。测试工具改用客户区坐标检查布局，避免把外框计入正文尺寸。
- `artifacts/border-fixture.json`、`border-uninstall-fixture.json`、`border-installer-ui.json`、`border-final-pixels.json` 和 `border-payload.json` 均通过，实际完整安装包四条边中点的颜色一致。
- 首次完整安装测试 `artifacts/border-full-flow.json` 失败；Windows 记录 Application Hang 1002，原因未确定。保留该失败记录，没有将其归因于已修复问题。
- 同一个二进制随后连续两轮完整安装、展开详情后进入完成页、正常退出、实际卸载、用户报告保留及注册表恢复通过：`artifacts/border-full-flow-retry1.json`、`border-full-flow-retry2.json`。`border-nc-stress.json` 的50次激活切换和50次完整窗口绘制也通过，首次异常未再复现。独立代码复查未发现边框处理中的具体阻塞或资源释放错误。
- 新本地产物 `dist/echo-test-1.1.0-setup-bordered-x64.exe`，257,861,192字节；SHA-256 `dd94bc8488639416f492c7e45acf58757b8566a2916e71fc107599e070ed155d`。版本仍为1.1.0，旧包保留，未发布；完整构建与异常/复测记录见 `artifacts/border-installer-build.json`。
