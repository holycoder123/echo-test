# Python 脚本步骤

在测试用例页点击「添加步骤」→「Python 脚本」。右侧可以直接输入代码、展开编辑，或导入 UTF-8 编码的 `.py` 文件。导入会复制文件内容到用例中，不会执行文件；保存或另存为后，代码仍包含在 JSON 用例内。外部模块和数据文件需要随用例另行携带。

脚本按步骤顺序执行，支持启用、重复和用例循环。默认执行超时为 30 秒，可在步骤的「更多设置」中设为 0.1～600 秒。停止按钮与 F12 可停止脚本，包括普通 `time.sleep()` 和死循环；每个步骤结束时会清理脚本进程及其启动的子进程。脚本在独立进程中运行，使用与工作台后端相同的 Python 解释器、依赖和 Windows 权限，可按这些权限访问文件和网络。

脚本的 `print()`、标准错误、异常行号写入运行日志和报告。报告还保留执行时的源码、输出日志和目标应用截图。单个脚本源码和输出各最多 256 KB，超出输出上限会记录截断提示。

## 内置对象

| 对象 | 用途 |
|---|---|
| `game` | 操作当前连接的目标应用；控件名称使用当前用例的控件库 |
| `case_dir` | 用例目录的 `pathlib.Path`；也是脚本工作目录和本地模块搜索路径 |
| `report_dir` | 本次运行报告目录的 `pathlib.Path` |
| `step_name` | 当前步骤名称 |
| `variables` | 本次执行中跨脚本步骤、重复和循环共享的字典；内容须可 JSON 保存，最多 48 KB |

每个脚本步骤使用新的 Python 进程。普通局部变量不会跨步骤保留；使用 `variables` 传递数据，下次运行用例时重新初始化。

## 目标应用操作

坐标 `(x, y)` 使用目标应用客户区像素，以左上角为原点；也可直接使用控件名称。

| 调用 | 功能 |
|---|---|
| `game.size()` | 返回客户区 `(width, height)` |
| `game.locate("按钮", timeout=5)` | 定位坐标或图片控件，返回 `(x, y)` |
| `game.click("按钮")` | 单击控件；支持 `button`、`count`、`interval`、`hold`、`timeout` |
| `game.click((100, 200), count=2)` | 双击客户区位置 |
| `game.drag("起点", "终点", duration=1)` | 拖动，起终点也可使用像素坐标 |
| `game.scroll("列表", amount=-3, axis="vertical")` | 滚动；`horizontal` 为水平方向 |
| `game.key("CTRL+A")` | 按键或组合键 |
| `game.key_down("W")` / `game.key_up("W")` | 按住、松开按键；运行结束会释放工具持有的按键 |
| `game.text("测试文本")` | 输入文本 |
| `game.sleep(1)` | 可停止的等待 |
| `game.assert_image("完成提示", timeout=5)` | 等待并断言图片控件存在 |
| `game.assert_absent("加载提示", timeout=5)` | 在等待期间断言图片控件持续不存在 |
| `game.screenshot()` | 保存 PNG 到报告目录，返回路径 `Path` |
| `game.capture()` | 保存截图并返回 `PIL.Image.Image`，可用于自定义识别 |

`game` 操作通过工作台原有的定位和输入流程执行，使用当前连接窗口，并响应停止按钮和 F12。导入标准库或已安装第三方库即可扩展逻辑。

```python
print("目标应用尺寸：", game.size())
game.click("任务按钮")
game.assert_image("任务面板", timeout=5)
variables["任务面板已打开"] = True
game.screenshot()
```

可在空白用例中新增 Python 步骤，按上方 API 示例编写逻辑；仓库不附带预置用例。

MCP 的 `echo_test_save_case` / `echo_test_run_case` 也支持此步骤。JSON 中使用 `action: "python"`、`params: {"code": "..."}` 和 `timeout`；语法检查由 Python 后端执行。
