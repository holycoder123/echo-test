from __future__ import annotations

from dataclasses import asdict, dataclass, field
import json
import math
from pathlib import Path
import shutil
import hashlib

ACTIONS = {
    "click": "单击", "double_click": "双击", "right_click": "右键",
    "long_press": "长按", "drag": "拖动", "scroll": "滚动",
    "wait_image": "等待图片出现", "assert_image": "断言图片存在",
    "assert_absent": "断言图片不存在", "key": "按键 / 组合键",
    "text": "输入文本", "sleep": "等待", "screenshot": "保存截图",
    "key_down": "按下按键", "key_up": "松开按键",
    "python": "Python 脚本",
    "loop": "循环开始", "end_loop": "循环结束", "set_variable": "设置变量",
}
PARAMETERS = {
    "click": [], "double_click": [("interval", "双击间隔（秒）", .12)],
    "right_click": [], "long_press": [("duration", "按住时间（秒）", 1)],
    "drag": [("duration", "拖动时间（秒）", 1)],
    "scroll": [("amount", "滚动格数（向上为正）", -3), ("axis", "方向 vertical / horizontal", "vertical")],
    "wait_image": [], "assert_image": [], "assert_absent": [],
    "key": [("keys", "按键，如 CTRL+A、ENTER、F1", "ENTER")],
    "text": [("text", "文本内容", "")], "sleep": [("duration", "等待时间（秒）", 1)],
    "screenshot": [],
    "key_down": [("keys", "按键", "W")], "key_up": [("keys", "按键", "W")],
    "python": [("code", "Python 代码", "")],
    "loop": [("variable", "循环变量", "i"), ("start", "起始值", 1), ("end", "结束值（包含）", 10), ("step", "步长", 1)],
    "end_loop": [], "set_variable": [("variable", "变量名", "value"), ("value", "值（文本或 JSON）", "")],
}
TARGET_ACTIONS = {"click", "double_click", "right_click", "long_press", "drag", "scroll", "wait_image", "assert_image", "assert_absent"}
IMAGE_ACTIONS = {"wait_image", "assert_image", "assert_absent"}


def number(value, label, minimum, maximum):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not minimum <= value <= maximum:
        raise ValueError(f"{label}必须在 {minimum} ~ {maximum} 之间")


@dataclass
class Selector:
    name: str
    kind: str = "coordinate"
    x: float = .5
    y: float = .5
    normalized: bool = True
    image: str = ""
    threshold: float = .86
    scales: list[float] = field(default_factory=lambda: [1.0])
    roi: list[int] | None = None
    offset_x: int = 0
    offset_y: int = 0
    recognition: str = "template"
    templates: list[dict] = field(default_factory=list)
    mask: str = ""
    anchor: str = ""
    text: str = ""
    text_match: str = "exact"
    color_tolerance: float | None = None
    library_id: str = ""

    def asset_fields(self):
        if self.kind != "image":
            return []
        return [(self, "image"), (self, "mask")] + [(item, key) for item in self.templates for key in ("image", "mask")]

    def asset_paths(self):
        return [owner.get(key, "") if isinstance(owner, dict) else getattr(owner, key) for owner, key in self.asset_fields()
                if (owner.get(key, "") if isinstance(owner, dict) else getattr(owner, key))]

    def validate(self):
        import re
        if not isinstance(self.library_id, str) or (self.library_id and not re.fullmatch(r"[a-f0-9]{32}", self.library_id)):
            raise ValueError("通用控件引用标识无效")
        if not self.name.strip():
            raise ValueError("控件名称不能为空")
        if self.kind not in {"coordinate", "image"}:
            raise ValueError("定位方式必须是 coordinate 或 image")
        if self.kind == "coordinate":
            number(self.x, "X", 0, 1 if self.normalized else 100000)
            number(self.y, "Y", 0, 1 if self.normalized else 100000)
        else:
            if self.recognition not in {"template", "ocr"}:
                raise ValueError("识别方式必须为 template 或 ocr")
            if self.recognition == "template" and not self.image and not self.templates:
                raise ValueError(f"控件 {self.name} 未设置模板图片")
            if self.recognition == "ocr" and (not isinstance(self.text, str) or not self.text.strip() or len(self.text) > 200):
                raise ValueError("OCR 目标文字需要 1 ~ 200 字")
            if self.text_match not in {"exact", "contains"}:
                raise ValueError("文字匹配方式必须为 exact 或 contains")
            if not isinstance(self.anchor, str) or len(self.anchor) > 200:
                raise ValueError("锚点需要控件名称")
            if self.anchor and not self.roi:
                raise ValueError("锚点定位需要相对搜索区域")
            if not isinstance(self.templates, list) or len(self.templates) > 10:
                raise ValueError("附加模板最多 10 张")
            for item in self.templates:
                if not isinstance(item, dict) or set(item) - {"image", "mask"} or not isinstance(item.get("image"), str) or not item["image"]:
                    raise ValueError("附加模板需要 image，可选 mask")
            if any(not isinstance(v, str) for v in [self.image, self.mask] + [item.get("mask", "") for item in self.templates]):
                raise ValueError("模板和遮罩路径必须是文本")
            if self.color_tolerance is not None:
                number(self.color_tolerance, "颜色容差", 0, 255)
            number(self.threshold, "匹配阈值", .5, 1)
            if not self.scales or len(self.scales) > 15:
                raise ValueError("缩放倍率需要 1 ~ 15 项")
            for scale in self.scales:
                number(scale, "模板倍率", .25, 4)
            if self.roi is not None:
                if len(self.roi) != 4 or any(type(v) is not int or abs(v) > 100000 for v in self.roi) or (not self.anchor and (self.roi[0] < 0 or self.roi[1] < 0)) or self.roi[2] <= 0 or self.roi[3] <= 0:
                    raise ValueError("搜索区域需要整数 [x, y, 宽, 高]；宽高为正，相对锚点的 x/y 可为负")
        for value in (self.offset_x, self.offset_y):
            if type(value) is not int or abs(value) > 100000:
                raise ValueError("控件偏移必须是整数")


@dataclass
class Step:
    name: str = "单击控件"
    action: str = "click"
    target: str = ""
    end_target: str = ""
    enabled: bool = True
    timeout: float = 5
    delay: float = .5
    repeat: int = 1
    params: dict = field(default_factory=dict)

    def validate(self, selectors):
        if self.action not in ACTIONS:
            raise ValueError(f"未知事件：{self.action}")
        if not isinstance(self.params, dict):
            raise ValueError('步骤参数必须是对象')
        if self.action == 'python':
            from .scripting import validate_code
            validate_code(self.params.get('code'))
        if self.action == 'loop':
            from .workflow import loop_values
            loop_values(self)
        if self.action == 'set_variable':
            from .workflow import variable_name
            variable_name(self.params.get('variable'))
        number(self.timeout, "定位超时", .1, 600)
        number(self.delay, "步骤后等待", 0, 600)
        if type(self.repeat) is not int or not 1 <= self.repeat <= 1000:
            raise ValueError("重复次数必须为 1 ~ 1000 的整数")
        if self.action in TARGET_ACTIONS and self.target not in selectors:
            raise ValueError(f"步骤 {self.name} 的目标控件不存在")
        if self.action == "drag" and self.end_target not in selectors:
            raise ValueError("拖动终点控件不存在")
        if self.action in IMAGE_ACTIONS and selectors[self.target].kind != "image":
            raise ValueError("图片等待 / 断言需要截图识别控件")
        for key, _, default in PARAMETERS[self.action]:
            value = self.params.get(key, default)
            if self.action == 'loop' and key in {'start', 'end', 'step'}:
                continue
            if isinstance(default, (int, float)):
                number(value, key, -100 if key == "amount" else .01, 600 if key != "amount" else 100)
                if key == "amount" and (int(value) != value or value == 0):
                    raise ValueError("滚动格数必须是非零整数")
            elif not isinstance(value, str):
                raise ValueError(f"{key} 必须是文本")
        if self.action == "scroll" and self.params.get("axis", "vertical") not in {"vertical", "horizontal"}:
            raise ValueError("滚动方向必须是 vertical 或 horizontal")
        if "path" in self.params:
            if self.action != "drag" or not isinstance(self.params["path"], list) or len(self.params["path"]) > 5000:
                raise ValueError("无效的拖动轨迹")
            for point in self.params["path"]:
                if not isinstance(point, list) or len(point) != 2:
                    raise ValueError("拖动轨迹点必须是 [x,y]")
                for value in point:
                    number(value, "轨迹比例", 0, 1)
        if self.params.get("button", "left") not in {"left", "right", "middle"}:
            raise ValueError("不支持的鼠标按钮")


@dataclass
class Project:
    name: str = "未命名用例"
    selectors: list[Selector] = field(default_factory=list)
    steps: list[Step] = field(default_factory=list)
    schema_version: int = 1
    mode: str = 'lowcode'
    code: str = ''
    script_timeout: float = 600

    def validate(self):
        if self.schema_version != 1:
            raise ValueError("不支持的用例版本")
        if self.mode not in {'lowcode', 'python'}:
            raise ValueError('用例模式必须为 lowcode 或 python')
        number(self.script_timeout, 'Python 主程序超时', .1, 600)
        if not isinstance(self.code, str):
            raise ValueError('Python 主程序必须是文本')
        if self.mode == 'python':
            from .scripting import validate_code
            validate_code(self.code)
        if len(self.selectors) > 5000 or len(self.steps) > 10000:
            raise ValueError("用例规模超出限制")
        mapping = {}
        for selector in self.selectors:
            selector.validate()
            if selector.name in mapping:
                raise ValueError(f"控件名称重复：{selector.name}")
            mapping[selector.name] = selector
        for selector in self.selectors:
            seen = {selector.name}
            current = selector
            while current.kind == "image" and current.anchor:
                if current.anchor not in mapping or mapping[current.anchor].kind != "image":
                    raise ValueError(f"锚点控件不存在或不是图片 / OCR 控件：{current.anchor}")
                if current.anchor in seen:
                    raise ValueError("锚点引用不能循环")
                seen.add(current.anchor)
                current = mapping[current.anchor]
                if len(seen) > 32:
                    raise ValueError("锚点引用最多 32 层")
        for step in self.steps if self.mode == 'lowcode' else []:
            if step.action not in ACTIONS:
                raise ValueError(f"未知事件：{step.action}")
            if type(step.enabled) is not bool:
                raise ValueError("步骤启用状态必须是布尔值")
            if step.enabled:
                step.validate(mapping)
        from .workflow import operation_counts
        operation_counts(self)

    def to_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, data):
        if not isinstance(data, dict):
            raise ValueError("用例应为 JSON 对象")
        result = cls(name=data.get("name", "目标应用测试用例"), schema_version=data.get("schema_version", 1),
                     mode=data.get('mode', 'lowcode'), code=data.get('code', ''), script_timeout=data.get('script_timeout', 600),
                     selectors=[Selector(**v) for v in data.get("selectors", [])],
                     steps=[Step(**v) for v in data.get("steps", [])])
        result.validate()
        return result


def referenced_selector_names(project: Project):
    if project.mode == 'python' or any(step.enabled and step.action == 'python' for step in project.steps):
        return {selector.name for selector in project.selectors}
    names = {name for step in project.steps for name in (step.target, step.end_target) if name}
    mapping = {selector.name: selector for selector in project.selectors}
    pending = list(names)
    while pending:
        selector = mapping.get(pending.pop())
        if selector and selector.kind == 'image' and selector.anchor and selector.anchor not in names:
            names.add(selector.anchor); pending.append(selector.anchor)
    return names


def load_project(path: Path) -> Project:
    if path.stat().st_size > 10 * 1024 * 1024:
        raise ValueError("用例文件超过 10 MB")
    return Project.from_dict(json.loads(path.read_text(encoding="utf-8")))


def save_project(project: Project, path: Path, source_dir: Path):
    project.validate()
    payload = Project.from_dict(project.to_dict())
    path.parent.mkdir(parents=True, exist_ok=True)
    for selector in payload.selectors:
        if selector.kind != "image":
            continue
        for owner, key in selector.asset_fields():
            value = owner.get(key, "") if isinstance(owner, dict) else getattr(owner, key)
            if not value:
                continue
            source = (source_dir / value).resolve()
            if not source.is_file():
                raise ValueError(f"模板图片不存在：{source}")
            digest = hashlib.sha256(source.read_bytes()).hexdigest()[:12]
            dest = path.parent / "assets" / f"template_{digest}{source.suffix.lower()}"
            dest.parent.mkdir(exist_ok=True)
            if source != dest.resolve():
                shutil.copy2(source, dest)
            value = dest.relative_to(path.parent).as_posix()
            if isinstance(owner, dict):
                owner[key] = value
            else:
                setattr(owner, key, value)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)
    return payload
