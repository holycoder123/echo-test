from __future__ import annotations
from datetime import datetime, timezone, timedelta
import html
import json
from pathlib import Path
import time
from uuid import uuid4
from .models import Project, Step, ACTIONS
from .vision import Vision, coordinate


def local_now():
    return datetime.now(timezone(timedelta(hours=8)))


class Runner:
    def __init__(self, backend, project: Project, base_dir: Path, report_root: Path, emit=None):
        self.backend = backend
        self.project = Project.from_dict(project.to_dict())
        self.vision = Vision(base_dir)
        self.emit = emit or (lambda event: None)
        self.targets = {s.name: s for s in self.project.selectors}
        self.directory = report_root / (local_now().strftime("%Y%m%d_%H%M%S") + "_" + uuid4().hex[:6])
        self.result = {"case": project.name, "started": local_now().isoformat(), "status": "running", "steps": []}
        self.script_variables = {}
        self.recognition = {}
        self.recognition_frame = None

    def message(self, **data):
        self.emit(data)

    def resolve(self, name, timeout, absent=False):
        selector = self.targets[name]
        if selector.kind == "coordinate":
            return coordinate(selector, self.backend.size())
        deadline = time.monotonic() + timeout
        while True:
            self.backend.pause(0)
            self.recognition_frame = self.backend.capture()
            match = self.vision.match(self.recognition_frame, selector, self.targets)
            self.recognition[name] = self.vision.last_diagnostic
            if absent:
                if match:
                    raise AssertionError(f"图片 {name} 仍存在，匹配度 {match.score:.3f}")
                if time.monotonic() >= deadline:
                    return None
            elif match:
                self.message(kind="match", message=f"{name} 匹配度 {match.score:.3f}，中心 ({match.x}, {match.y})")
                return match.x, match.y
            elif time.monotonic() >= deadline:
                detail = self.vision.last_diagnostic
                candidate = detail.get("candidate")
                extra = f"，最佳匹配度 {candidate['score']:.3f}，倍率 {candidate['scale']:g}" if candidate else ""
                raise TimeoutError(f"{timeout:g} 秒内未找到图片控件：{name}，阈值 {selector.threshold:.2f}，{detail['reason']}{extra}")
            self.backend.pause(min(.2, max(0, deadline - time.monotonic())))

    def execute(self, step: Step, record=None):
        params = step.params
        action = step.action
        if action == 'python':
            from .scripting import execute_script
            execute_script(self, step, record if record is not None else {})
            return None
        point = None
        if action in {"click", "double_click", "right_click", "long_press", "scroll", "drag", "wait_image", "assert_image"}:
            point = self.resolve(step.target, step.timeout)
        if action == "click":
            self.backend.click(point)
        elif action == "double_click":
            self.backend.click(point, count=2, interval=params.get("interval", .12))
        elif action == "right_click":
            self.backend.click(point, button="right")
        elif action == "long_press":
            self.backend.click(point, hold=params.get("duration", 1), **({"button": params["button"]} if params.get("button") else {}))
        elif action == "scroll":
            self.backend.scroll(point, params.get("amount", -3), params.get("axis", "vertical"))
        elif action == "drag":
            end = self.resolve(step.end_target, step.timeout)
            # Re-resolve the start after waiting for the end image.
            point = self.resolve(step.target, step.timeout)
            extra = {}
            if params.get("path"):
                width, height = self.backend.size()
                extra["path"] = [(round(x*(width-1)), round(y*(height-1))) for x, y in params["path"]]
            if params.get("button"):
                extra["button"] = params["button"]
            self.backend.drag(point, end, params.get("duration", 1), **extra)
        elif action == "assert_absent":
            self.resolve(step.target, step.timeout, absent=True)
        elif action == "key":
            self.backend.key(params.get("keys", "ENTER"))
        elif action == "key_down":
            self.backend.key_down(params.get("keys", "W"))
        elif action == "key_up":
            self.backend.key_up(params.get("keys", "W"))
        elif action == "text":
            self.backend.text(params.get("text", ""))
        elif action == "sleep":
            self.backend.pause(params.get("duration", 1))
        elif action == "screenshot":
            destination = self.directory / f"screen_{uuid4().hex[:8]}.png"
            self.backend.capture().save(destination)
            return destination.name
        return None

    def run(self, iterations=1):
        if type(iterations) is not int or not 1 <= iterations <= 1000:
            raise ValueError("用例循环次数必须为 1 ~ 1000")
        self.directory.mkdir(parents=True, exist_ok=True)
        try:
            self.project.validate()
            self.backend.activate()
            for iteration in range(1, iterations + 1):
                for index, step in enumerate(self.project.steps):
                    if not step.enabled:
                        continue
                    for repetition in range(1, step.repeat + 1):
                        self.backend.pause(0)
                        record = {"index": index, "name": step.name, "action": ACTIONS[step.action],
                                  "iteration": iteration, "repeat": repetition, "status": "running"}
                        self.result["steps"].append(record)
                        self.message(kind="step", **record)
                        started = time.monotonic()
                        self.recognition = {}
                        self.recognition_frame = None
                        try:
                            shot = self.execute(step, record)
                            self.backend.pause(step.delay)
                            record.update(status="passed", elapsed=round(time.monotonic() - started, 3))
                            if self.recognition:
                                record["recognition"] = self.recognition
                            if shot:
                                record["screenshot"] = shot
                        except Exception as error:
                            record.update(status="stopped" if self.backend.cancelled() else "failed", error=str(error), elapsed=round(time.monotonic() - started, 3))
                            if self.recognition:
                                record["recognition"] = self.recognition
                                if self.recognition_frame is not None:
                                    from PIL import ImageDraw
                                    diagnostic_image = self.recognition_frame.copy()
                                    draw = ImageDraw.Draw(diagnostic_image)
                                    for detail in self.recognition.values():
                                        candidate = detail.get("candidate")
                                        if candidate:
                                            x, y, w, h = candidate["box"]
                                            draw.rectangle((x, y, x+w-1, y+h-1), outline="red", width=2)
                                    diagnostic_name = f"recognition_{index + 1}_{uuid4().hex[:6]}.png"
                                    diagnostic_image.save(self.directory / diagnostic_name)
                                    record["recognition_screenshot"] = diagnostic_name
                            try:
                                filename = f"failure_{index + 1}_{uuid4().hex[:6]}.png"
                                self.backend.capture().save(self.directory / filename)
                                record["screenshot"] = filename
                            except Exception as capture_error:
                                record["capture_error"] = str(capture_error)
                            self.message(kind="step", **record)
                            raise
                        self.message(kind="step", **record)
            self.result["status"] = "passed"
        except Exception as error:
            self.result.update(status="stopped" if self.backend.cancelled() else "failed", error=str(error))
            self.message(kind="log", message=str(error))
        finally:
            if hasattr(self.backend, "release_all"):
                try:
                    self.backend.release_all()
                except Exception as release_error:
                    self.result.update(status="failed", error=str(release_error))
            self.result["finished"] = local_now().isoformat()
            self.write_reports()
            self.message(kind="finished", result=self.result, directory=str(self.directory))
        return self.result

    def write_reports(self):
        (self.directory / "result.json").write_text(json.dumps(self.result, ensure_ascii=False, indent=2), encoding="utf-8")
        escape = lambda value: html.escape(str(value))
        rows = []
        for step in self.result["steps"]:
            image = f'<a href="{escape(step["screenshot"])}">查看截图</a>' if step.get("screenshot") else ""
            script = f'<a href="{escape(step["script"])}">脚本源码</a> · <a href="{escape(step["output_file"])}">完整输出</a>' if step.get('script') else ''
            output = f'<details><summary>脚本输出</summary><pre>{escape(step["output"])}</pre></details>' if step.get('output') else ''
            if step.get("recognition"):
                output += '<details><summary>识别诊断</summary><pre>' + escape(json.dumps(step["recognition"], ensure_ascii=False, indent=2)) + '</pre></details>'
            if step.get("recognition_screenshot"):
                output += f'<a href="{escape(step["recognition_screenshot"])}">查看候选框</a>'
            rows.append(f'<tr><td>{step["index"] + 1}</td><td>{escape(step["name"])}</td><td>{escape(step["action"])}</td><td>{step["iteration"]}/{step["repeat"]}</td><td class="{step["status"]}">{escape(step["status"])}</td><td>{step.get("elapsed", 0)}s</td><td>{escape(step.get("error", ""))} {image} {script} {output}</td></tr>')
        document = f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>echo test 测试报告</title>
<style>body{{font:15px 'Microsoft YaHei',sans-serif;background:#f3f6fa;padding:32px;color:#172438}}table{{width:100%;border-collapse:collapse;background:white}}td,th{{padding:12px;border-bottom:1px solid #ddd;text-align:left}}.passed{{color:#087d59}}.failed{{color:#bf283d}}.stopped{{color:#ab6900}}a{{color:#1465d4}}</style>
<h1>{escape(self.result['case'])}</h1><p>状态：{escape(self.result['status'])} · 开始：{escape(self.result['started'])}</p>
<p>{escape(self.result.get('error', ''))}</p><table><tr><th>步骤</th><th>名称</th><th>事件</th><th>轮次/重复</th><th>结果</th><th>耗时</th><th>详情</th></tr>{''.join(rows)}</table></html>'''
        (self.directory / "report.html").write_text(document, encoding="utf-8")
