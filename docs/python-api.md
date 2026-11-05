# Python 模式接口文档

适用于 EchoTest 1.2.1-beta 的 Python 用例主程序及低代码中的 Python 脚本步骤。接口由工作台在执行时注入，无需自行导入 `window`；直接用系统 Python 运行导出的脚本不会自动获得这些对象。界面操作与编辑器用法见 [Python 用例与脚本](python-scripts.md)。

## 快速开始

先连接目标窗口或安卓设备，并在用例中准备对应控件。以下示例的「任务按钮」「任务面板」需替换为实际控件，任务面板应为图片或 OCR 控件。

```python
print("目标尺寸：", window.size())
button = controls["任务按钮"]
window.click(button)
window.assert_image("任务面板", timeout=5)
variables["面板已打开"] = True
print("截图：", window.screenshot())
```

接口同步执行：一次调用完成后才执行下一行。定位失败会抛出异常，不返回 `False`。一次点击成功只代表操作已发出，业务结果应通过断言或截图确认。

## 运行环境和生命周期

| 项目 | 约定 |
| --- | --- |
| Python 主程序 | 用例 `mode="python"`，执行 `code`，整体超时由 `script_timeout` 控制，默认 600 秒，范围 0.1～600 秒 |
| 低代码 Python 步骤 | 步骤 `action="python"`，执行 `params.code`，超时由步骤 `timeout` 控制；界面新增时默认 30 秒 |
| 进程 | 每次脚本执行使用独立 Python 进程；局部变量、导入模块和自定义函数不跨进程保留 |
| 解释器 | 使用工作台后端的 Python 环境、依赖和权限；支持标准库及已安装第三方库，可访问文件和网络 |
| 工作目录 | `case_dir`，同时加入本地模块搜索路径 |
| 停止 | 停止按钮或 F12；也能终止普通 `time.sleep()` 和死循环。结束时清理脚本进程及受管理的子进程 |
| 输入清理 | 运行结束后释放工作台持有的按键和鼠标输入；长按操作仍建议使用 `try/finally` 主动释放 |

操作的定位超时还受脚本剩余执行时间限制；增大单次操作的 `timeout` 不会延长主程序的总时限。

## 内置对象

| 名称 | 类型 | 含义 |
| --- | --- | --- |
| `window` | `Window` | 当前连接目标的操作接口 |
| `game` | `Window` | 与 `window` 相同的旧名称，新代码使用 `window` |
| `controls` | `Controls` | 按名称或稳定 ID 获取控件引用 |
| `variables` | `dict` | 一次运行中共享的数据，跨脚本步骤、重复与用例迭代保留；下一次启动运行时清空 |
| `case_dir` | `pathlib.Path` | 用例目录，可用于读取数据或导入同目录模块 |
| `report_dir` | `pathlib.Path` | 本次执行的报告目录 |
| `step_name` | `str` | 当前步骤名称，完整 Python 用例为「Python 主程序」 |
| `render`、`assign`、`run_script` | 函数 | 兼容低代码生成代码的辅助接口，见后文 |

`variables` 在脚本正常完成后回传。其内容须能 JSON 序列化，禁止 `Path`、图片、控件引用、集合和非有限数值等对象；使用 `str(path)` 保存路径。实际限制为 `json.dumps(..., ensure_ascii=True, allow_nan=False)` 后不超过 48000 个字符，中文会转义并占用更多长度。JSON 回传会将元组转换为列表。

```python
variables["次数"] = variables.get("次数", 0) + 1
data = (case_dir / "input.txt").read_text(encoding="utf-8")
(report_dir / "result.txt").write_text(data, encoding="utf-8")
```

## 控件引用与坐标

```python
controls["名称"]                    # 返回 ControlRef
controls.by_id("实际的控件稳定ID")    # 返回 ControlRef
```

控件不存在会抛出 `ValueError`。编辑器插入的稳定 ID 引用可在控件改名后继续使用。引用只保存标识，每次调用重新定位；`window.locate()` 返回的坐标则是当时位置的快照。

下文 `Target` 表示以下任意一种参数：

| 形式 | 示例 | 坐标或定位方式 |
| --- | --- | --- |
| 控件引用 | `controls["确定"]` | 使用该控件的坐标、图片、OCR 或安卓 UI 配置 |
| 控件名称 | `"确定"` | 按当前用例运行时控件定义查找 |
| 二元组或列表 | `(100, 200)`、`[100, 200]` | 客户区像素坐标，左上角为原点，不是桌面绝对坐标 |

直接坐标不使用 0～1 的归一化比例；例如 `(0.5, 0.5)` 不代表窗口中心。需要比例定位时自行换算：

```python
width, height = window.size()
window.click((round((width - 1) * 0.5), round((height - 1) * 0.5)))
```

## 尺寸与定位接口

```text
window.size() -> tuple[int, int]
window.locate(target: Target, timeout: float = 5) -> tuple[int, int]
```

- `size()` 返回当前客户区宽高。
- `locate()` 返回可操作点 `(x, y)`；图片/OCR 和安卓 UI 根据控件配置定位，坐标控件按配置换算。
- 定位 `timeout` 范围 0.1～600 秒，单位为秒。直接传像素坐标时无需识别等待。

## 鼠标和触控接口

### 单击与长按

```text
window.click(target: Target, button: str = "left", count: int = 1,
             interval: float = 0.12, hold: float = 0, timeout: float = 5) -> None
```

| 参数 | 含义和范围 |
| --- | --- |
| `target` | 控件引用、名称或客户区像素坐标 |
| `button` | `"left"`、`"right"` 或 `"middle"`；具体支持情况由目标后端决定 |
| `count` | 点击次数，整数 1～1000 |
| `interval` | 多次点击之间的间隔，0～600 秒 |
| `hold` | 每次按下持续时间，0～600 秒 |
| `timeout` | 控件定位超时，默认 5 秒 |

多次点击在一次定位得到的位置执行。点击耗时也必须在脚本剩余时间内。

```python
window.click("确定")
window.click((100, 200), count=2)       # 双击
window.click("菜单", button="right")
window.click("目标", hold=1.5)        # 长按
```

### 拖动

```text
window.drag(start: Target, end: Target, duration: float = 1,
            timeout: float = 5, path=None, button: str = "left") -> None
```

`duration` 为拖动时长，范围 0～600 秒；`timeout` 用于端点定位。`button` 取值同 `click()`。可选 `path` 是最多 5000 个 `[x, y]` 点组成的列表，**轨迹点使用 0～1 的归一化比例**，按当前客户区尺寸换算，与 `start`、`end` 的直接像素坐标不同。

```python
window.drag("物品", "背包格", duration=1)
window.drag((20, 30), (200, 150), duration=0.8)
```

### 滚动

```text
window.scroll(target: Target, amount: int = -3,
              axis: str = "vertical", timeout: float = 5) -> None
```

在目标位置滚动。`amount` 为非零整数，范围 -100～100；`axis` 为 `"vertical"` 或 `"horizontal"`。桌面垂直滚动正数向上、负数向下；安卓按设备后端转换为滑动。

## 键盘与文本接口

```text
window.key(keys: str) -> None
window.key_down(keys: str) -> None
window.key_up(keys: str) -> None
window.text(text: str) -> None
```

`key()` 执行一次按键或组合键；`key_down()` 持续按住，`key_up()` 释放。桌面组合键用 `+` 连接，例如 `CTRL+A`、`SHIFT+TAB`、`ENTER`。F12 保留为紧急停止键；按键名称及系统保留组合由后端校验。

`text()` 输入字符串，最多 4000 字符；不会自动替换 `${变量名}`，需要使用 f-string 或 `render()`。桌面与安卓输入能力不同，安卓文本输入目前以 ASCII 为主，不能将桌面中文输入能力直接用于安卓。

```python
window.key("CTRL+A")
window.text(f"第 {variables.get('次数', 1)} 次测试")
window.key("ENTER")

try:
    window.key_down("W")
    window.sleep(1)
finally:
    window.key_up("W")
```

## 等待与断言接口

```text
window.sleep(seconds: float) -> None
window.assert_image(target: Target, timeout: float = 5)
window.assert_absent(target: Target, timeout: float = 5) -> None
window.wait_ui(target: Target, timeout: float = 5)
window.assert_ui(target: Target, timeout: float = 5)
window.assert_ui_absent(target: Target, timeout: float = 5) -> None
```

`sleep()` 为可停止的等待，范围 0～600 秒。断言接口的目标必须是相应类型的控件名称或引用，不能传像素坐标；定位超时范围为 0.1～600 秒。

| 接口 | 控件类型 | 成功条件及返回值 |
| --- | --- | --- |
| `assert_image` | 图片或 OCR（`kind="image"`） | 限时内找到，返回定位点；当前通过进程通信返回二元列表 |
| `assert_absent` | 图片或 OCR | 整个观察期每次检测均未发现，返回 `None`；任一次发现立即失败 |
| `wait_ui` | 安卓 UI | 限时内找到，返回定位点，当前为二元列表 |
| `assert_ui` | 安卓 UI | 与 `wait_ui` 使用相同定位逻辑 |
| `assert_ui_absent` | 安卓 UI | 限时内检测到不存在即可返回 `None`；超时仍存在则失败 |

**`assert_absent()` 不会等待已存在的图片消失**，与 `assert_ui_absent()` 的语义不同。安卓 UI 接口只适用于已连接的安卓目标。

等待图片消失可采用限时轮询；只捕获图片存在时的错误，其他错误继续上抛：

```python
import time

deadline = time.monotonic() + 10
while True:
    try:
        window.assert_absent("加载提示", timeout=0.1)
        break
    except RuntimeError as error:
        if "仍存在" not in str(error):
            raise
        if time.monotonic() >= deadline:
            raise TimeoutError("10 秒内加载提示未消失") from error
        window.sleep(0.2)
```

## 截图接口

```text
window.screenshot() -> pathlib.Path
window.capture() -> PIL.Image.Image
```

`screenshot()` 将当前目标画面保存到报告目录，文件名为 `script_screen_<随机标识>.png`，返回绝对路径。不能传入自定义文件名。

`capture()` 同样先保存报告截图，再返回独立的 PIL 图片对象；可用于取色、自定义识别或另存文件。

```python
image = window.capture()
print("图片尺寸：", image.size)
image.crop((0, 0, 100, 100)).save(report_dir / "局部截图.png")
```

## 低代码兼容辅助函数

### 变量替换与赋值

```text
render(value) -> str
assign(name: str, value: str) -> None
```

`render()` 实际要求字符串参数，将 `${名称}` 替换为 `variables` 中的值；不存在的变量报错，非字符串值按 JSON 转成文本。`assign()` 先做相同替换，再尝试按 JSON 解析，解析失败时保存为文本。变量名须为非 Python 关键字的有效标识符，最多 100 字符。

```python
assign("次数", "2")                  # 数字 2
assign("编号", '"2"')                # 字符串 "2"
window.text(render("当前次数 ${次数}"))
```

### 执行局部代码

```text
run_script(code: str, timeout: float = 5, step_name: str | None = None) -> None
```

在当前脚本进程内创建独立局部作用域，主要用于低代码生成的 Python。局部代码获得内置对象及 `variables` 的 JSON 副本，成功后将变量回写；不会继承调用方的普通局部变量和自定义函数，也不会新建进程。`step_name` 仅改变子作用域的步骤名称。

超时为 0.1～600 秒，最多嵌套 8 层，同时受外层总时限约束。该辅助函数不为每个局部代码段生成独立报告步骤。

```python
run_script('variables["已检查"] = True\nprint(step_name)',
           timeout=5, step_name="局部检查")
```

## 异常与报告

后端操作错误经进程通信后在脚本中表现为 `RuntimeError`，包括控件不存在、定位超时、参数错误和断言失败；`controls` 本地查询错误为 `ValueError`。Python 自身的异常保持原类型。不要依赖捕获 `TimeoutError` 来处理 `window.locate()` 的定位失败。

未捕获异常使当前脚本失败，停止后续步骤；异常栈与行号写入日志。正常结束或 `SystemExit(0)` 表示脚本代码完成；其他 `SystemExit` 状态视为失败。停止和整体执行超时由执行器控制，不能依靠捕获操作异常取消停止。

| 内容 | 保留规则 |
| --- | --- |
| 源码 | UTF-8，最多 256 KiB；导入文件支持 UTF-8 BOM，内容复制到用例内 |
| 输出 | 标准输出、标准错误写入报告日志，每次脚本最多 256 KiB，超出标记截断 |
| API 调用 | 记录操作参数、状态及失败信息；最多 1000 条，并限制记录体积，超限标记截断 |
| 截图 | 显式截图存入报告目录，报告也保留执行过程相关截图 |

输出使用 `print()`；长时间不换行时可用 `print(..., flush=True)` 及时刷新。脚本自定义文件建议写入 `report_dir`，便于和本次结果一起查阅。

## 用例数据与 MCP 接入

完整 Python 用例的最小数据结构：

```json
{
  "name": "Python 示例",
  "schema_version": 1,
  "mode": "python",
  "code": "print(window.size())\nwindow.screenshot()\n",
  "script_timeout": 60,
  "selectors": [],
  "steps": []
}
```

Python 模式以 `code` 为主程序，不按低代码 `steps` 执行。引用的控件需通过工作台共享控件机制或用例 `selectors` 提供；外部模块和数据文件不会随 `.py` 导入自动复制。

低代码中的单个 Python 步骤结构：

```json
{
  "name": "脚本检查",
  "action": "python",
  "timeout": 30,
  "delay": 0,
  "params": {"code": "print(window.size())\n"}
}
```

可通过 MCP `echo_test_save_case` 的 `project` 参数保存完整 Python 用例，再用 `echo_test_run_case` 执行，结合状态、事件及报告查看结果。`echo_test_explore` 不支持 Python。MCP 当前连接入口面向桌面窗口；安卓 Python 用例通过工作台连接设备后运行。详见 [MCP 接入](mcp.md)。

## 实现与类型定义

- [编辑器接口类型](../electron/python-api.pyi)
- [脚本对象和辅助函数](../echo_test/script_worker.py)
- [参数校验和执行通信](../echo_test/scripting.py)
- [定位与断言行为](../echo_test/engine.py)
- [Python 模式执行规划](../echo_test/workflow.py)
