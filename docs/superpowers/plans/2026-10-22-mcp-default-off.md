# MCP 默认关闭

**需求：** 用户要求默认不启用 MCP。未保存设置时 Electron、Python 启动入口以及恢复默认值统一关闭 MCP；保留已保存的手动开关、设置页启停和显式 MCP 启动入口。普通默认关闭不等同于 `--disable-mcp`，仍允许在本次会话手动开启。

**实现：** `electron/settings.cjs` 与 `echo_test/startup_preferences.py` 的 MCP 默认值设为 false；更新 Python 参数说明及当前用户文档，保留历史版本说明。现有测试改为验证默认关闭和显式开启，安装检查结果字段同步命名。MCP 启动 smoke 每轮使用独立配置，依次检查默认关闭、强制开启、强制禁用优先和正常退出。

## 验证

- 修改前，Node 设置测试与 Python 默认偏好测试均因 true 不等于 false 失败。
- 修改后 `npm run check` 通过，`npm test` 106项通过，Python `test_settings.py` 5项及 `test_mcp_startup.py` 25项通过。
- `artifacts/mcp-default-off-smoke.json`：实际 Electron 默认关闭、显式开启及认证 SDK 握手、显式禁用优先、正常退出清理均通过。
- 实际启动检查在 `.runtime/mcp-default-off-*` 独立源码目录进行，第三方运行时使用目录连接。首轮测试关闭步骤发现现有维护工具的路径比较不支持该测试目录连接；仅在该私有测试副本将预期可执行路径同样 resolve 后，已验证身份并正常关闭测试窗口，再完整重跑通过。产品维护工具未更改，没有终止进程或操作用户窗口。
- 版本仍为1.1.0，已有安装包没有重新编译。
