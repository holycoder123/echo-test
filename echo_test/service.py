"""JSON-line service for the renderer, including explicit Python case steps."""
from __future__ import annotations
import base64
from dataclasses import asdict
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sys
import traceback
import threading
import time
from uuid import uuid4
from .backend import list_game_windows, WindowsBackend, is_admin
from .models import Project, load_project, save_project
from .engine import Runner
from .vision import Vision, coordinate
from .recording import convert_events
from .recorder import Recorder
from .native_windows import user32, get_long, ct, wt
from .legacy_window_recovery import recover_legacy_window
from .case_library import CaseLibrary
from .control_library import ControlLibrary
from .report_library import ReportLibrary
from .paths import runtime_file
from .window_pair import NativeToolbarPair

ROOT = Path(__file__).resolve().parents[1]
write_lock = threading.Lock()
AUTOMATION_CAPTURE_MAX_SIDE = 4096
AUTOMATION_CAPTURE_MAX_PIXELS = 8 * 1024 * 1024
AUTOMATION_CAPTURE_MAX_AGE = 300


def output(data):
    with write_lock:
        print(json.dumps(data, ensure_ascii=False), flush=True)


def png(image):
    memory = io.BytesIO()
    image.save(memory, format="PNG")
    return "data:image/png;base64," + base64.b64encode(memory.getvalue()).decode("ascii")


class Service:
    def __init__(self):
        self.base_dir = ROOT / "test_cases"
        self.case_path = None
        self.stop_event = threading.Event()
        self.running = False
        self.recorder = None
        self.record_lock = threading.Lock()
        self.pending_recording = None
        self.capture_image = None
        self.capture_id = None
        # MCP observations are separate from the renderer's template editor.
        # Retain only the most recent bounded client-area image.
        self.automation_capture_image = None
        self.automation_capture_id = None
        self.automation_capture_handle = None
        self.automation_capture_pid = None
        self.automation_capture_at = None
        self.worker = None
        self.toolbar_pair = NativeToolbarPair(self.emit)
        recovery = os.environ.get('ECHO_TEST_EMBED_RECOVERY')
        recovery_path = Path(recovery) if recovery else runtime_file('embed-recovery.json', ROOT)
        recover_legacy_window(recovery_path)
        if recovery_path.resolve() == (ROOT / '.runtime' / 'embed-recovery.json').resolve():
            recover_legacy_window(ROOT / '.embed-recovery.json')

    def emit(self, event):
        if event.get("kind") == "finished":
            self.running = False
        output({"event": event})

    def idle(self):
        if self.running or self.recorder:
            raise ValueError("请先停止执行或录制")

    def window(self, handle):
        found = [w for w in list_game_windows(include_hidden=True) if w.handle == int(handle)]
        if len(found) != 1:
            raise ValueError("目标窗口已关闭，请重新连接")
        return found[0]

    @property
    def controls(self):
        if not hasattr(self, '_controls_library'):
            self._controls_library = ControlLibrary(os.environ.get('ECHO_TEST_CONTROL_LIBRARY_ROOT') or ROOT)
            self._controls_library.migrate()
        return self._controls_library

    def project_response(self, project, path=None):
        project = self.controls.import_project(project, self.base_dir, path)
        return {"project": project.to_dict(), "path": str(path) if path else None,
                "base_dir": str(self.base_dir), "controls": self.controls.list()}

    def bootstrap(self, preferred_handle=None):
        windows=list_game_windows()
        if preferred_handle and not any(w.handle==int(preferred_handle) for w in windows):
            windows.extend(w for w in list_game_windows(include_hidden=True) if w.handle==int(preferred_handle))
        project = load_project(self.case_path) if self.case_path else Project("未命名用例")
        return {**self.project_response(project, self.case_path),
                "admin": is_admin(), "windows": [asdict(w) for w in windows]}

    def capture(self, handle):
        self.idle()
        backend = WindowsBackend(self.window(handle))
        backend.activate(require_input=False)
        screen = backend.capture()
        self.capture_image, self.capture_id = screen, uuid4().hex
        return {"id": self.capture_id, "image": png(screen), "width": screen.width, "height": screen.height}

    @staticmethod
    def automation_handle(handle):
        if type(handle) is not int or not 0 < handle < 2**64:
            raise ValueError("无效的目标窗口句柄")
        return handle

    @staticmethod
    def verify_game_pid(game, expected_pid):
        if expected_pid is None:
            return
        if type(expected_pid) is not int or not 0 < expected_pid < 2**32:
            raise ValueError("无效的目标应用进程身份")
        if expected_pid != game.pid:
            raise ValueError("目标窗口身份已变化，请重新连接")

    @staticmethod
    def automation_size(width, height):
        if (type(width) is not int or type(height) is not int or
                not 10 <= width <= AUTOMATION_CAPTURE_MAX_SIDE or
                not 10 <= height <= AUTOMATION_CAPTURE_MAX_SIDE or
                width * height > AUTOMATION_CAPTURE_MAX_PIXELS):
            raise ValueError("目标应用客户区截图尺寸超出限制")

    @staticmethod
    def automation_name(name, suffix):
        if not isinstance(name, str):
            raise ValueError("名称必须为安全文件名")
        stem = name[:-len(suffix)] if name.lower().endswith(suffix) else name
        if (not re.fullmatch(r"[\w-]{1,64}", stem) or
                stem.upper() in {"CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"} or
                re.fullmatch(r"(?:COM|LPT)[1-9¹²³]", stem, re.IGNORECASE)):
            raise ValueError("名称只允许中文、字母、数字、下划线和连字符")
        return stem + suffix

    @staticmethod
    def automation_directory(assets=False):
        directory = ROOT.resolve() / "test_cases"
        if assets:
            directory = directory / "assets"
        if directory.resolve() != directory:
            raise ValueError("用例及模板资产目录不能使用重定向路径")
        return directory

    def automation_selector_asset(self, selector):
        paths = [self.automation_asset(image) for image in selector.asset_paths()]
        return paths[0] if paths else None

    def automation_asset(self, image):
        if not isinstance(image, str) or not image.startswith("assets/"):
            raise ValueError("模板必须使用 test_cases/assets 内的 PNG 图片")
        basename = image[len("assets/"):]
        if (not basename.lower().endswith(".png") or
                self.automation_name(basename, ".png").lower() != basename.lower()):
            raise ValueError("模板必须使用 test_cases/assets 内的 PNG 图片")
        directory = self.automation_directory(assets=True)
        path = directory / basename
        if path.resolve() != path or not path.is_file():
            raise ValueError("模板图片不存在或使用了重定向路径")
        if path.stat().st_size > 16 * 1024 * 1024:
            raise ValueError("模板图片超过 16 MB")
        from PIL import Image
        with Image.open(path) as template:
            if (template.format != "PNG" or
                    not 1 <= template.width <= AUTOMATION_CAPTURE_MAX_SIDE or
                    not 1 <= template.height <= AUTOMATION_CAPTURE_MAX_SIDE or
                    template.width * template.height > AUTOMATION_CAPTURE_MAX_PIXELS):
                raise ValueError("模板 PNG 图片尺寸超出限制")
            template.verify()
        return path

    def automation_capture(self, handle, expected_pid=None):
        handle = self.automation_handle(handle)
        game = self.window(handle)
        self.verify_game_pid(game, expected_pid)
        backend = WindowsBackend(game)
        # A running case or recorder owns focus; observations must not move it.
        if not self.running and not self.recorder:
            backend.activate(require_input=False)
        _, _, width, height = backend.rect()
        self.automation_size(width, height)
        screen = backend.capture()
        self.automation_size(screen.width, screen.height)
        if screen.size != (width, height):
            raise ValueError("目标应用客户区尺寸已改变，请重新截取")
        encoded = png(screen)
        capture_id = uuid4().hex
        self.automation_capture_image = screen
        self.automation_capture_id = capture_id
        self.automation_capture_handle = handle
        self.automation_capture_pid = game.pid
        self.automation_capture_at = time.monotonic()
        return {"id": capture_id, "image": encoded, "width": width, "height": height, "handle": handle}

    def automation_save_template(self, capture_id, handle, name, rect, expected_pid=None):
        self.idle()
        handle = self.automation_handle(handle)
        if (not isinstance(capture_id, str) or capture_id != self.automation_capture_id or
                self.automation_capture_image is None or self.automation_capture_at is None or
                time.monotonic() - self.automation_capture_at > AUTOMATION_CAPTURE_MAX_AGE):
            raise ValueError("MCP 截图已失效，请重新截取")
        if handle != self.automation_capture_handle:
            raise ValueError("截图不属于当前目标窗口，请重新截取")
        game = self.window(handle)
        self.verify_game_pid(game, expected_pid)
        if game.pid != self.automation_capture_pid:
            raise ValueError("目标应用进程已改变，请重新连接并截取")
        _, _, width, height = WindowsBackend(game).rect()
        self.automation_size(width, height)
        screen = self.automation_capture_image
        if screen.size != (width, height):
            raise ValueError("目标应用客户区尺寸已改变，请重新截取")
        if (not isinstance(rect, dict) or set(rect) != {"x", "y", "w", "h"} or
                any(type(rect[key]) is not int for key in ("x", "y", "w", "h"))):
            raise ValueError("模板选区必须为整数像素 {x,y,w,h}")
        x, y, w, h = (rect[key] for key in ("x", "y", "w", "h"))
        if not (0 <= x < width and 0 <= y < height and
                4 <= w <= width - x and 4 <= h <= height - y):
            raise ValueError("模板区域必须在目标应用客户区内，且至少为 4 × 4 像素")
        filename = self.automation_name(name, ".png")
        directory = self.automation_directory(assets=True)
        directory.mkdir(parents=True, exist_ok=True)
        self.automation_directory(assets=True)
        path = directory / filename
        # Exclusive creation prevents replacing another case's template and
        # prevents following a pre-existing file symlink outside this folder.
        created = False
        try:
            with path.open("xb") as target:
                created = True
                screen.crop((x, y, x + w, y + h)).save(target, format="PNG")
        except FileExistsError:
            raise ValueError("模板已存在，请换个名称") from None
        except Exception:
            if created:
                path.unlink(missing_ok=True)
            raise
        return {"image": path.relative_to(directory.parent).as_posix(),
                "width": w, "height": h, "handle": handle}

    def automation_save_case(self, name, project):
        self.idle()
        filename = self.automation_name(name, ".echo.json")
        directory = self.automation_directory()
        parsed = Project.from_dict(project)
        for selector in parsed.selectors:
            self.automation_selector_asset(selector)
            for image in selector.asset_paths():
                source = self.automation_asset(image)
                digest = hashlib.sha256(source.read_bytes()).hexdigest()[:12]
                destination = directory / "assets" / ("template_" + digest + ".png")
                if destination.resolve() != destination:
                    raise ValueError("模板目标使用了重定向路径")
        path = directory / filename
        temporary = path.with_suffix(path.suffix + ".tmp")
        if path.resolve() != path or temporary.resolve() != temporary:
            raise ValueError("用例目标使用了重定向路径")
        parsed = self.controls.import_project(parsed, directory, path)
        saved = save_project(self.controls.prune_project(self.controls.resolve_project(parsed, directory)), path, directory)
        self.case_path, self.base_dir = path, directory
        return {"project": saved.to_dict(), "path": str(path), "base_dir": str(directory), "controls": self.controls.list()}

    def preview_selectors(self, selector, selectors=None):
        rows = [row for row in (selectors or []) if row.get("name") != selector.get("name")]
        parsed = Project.from_dict({"selectors": [*rows, selector]})
        return parsed.selectors[-1], {item.name: item for item in parsed.selectors}

    @staticmethod
    def vision_preview(shot, screen, selector, directory, selectors):
        vision = Vision(directory)
        match = vision.match(screen, selector, selectors)
        detail = vision.last_diagnostic
        candidate = detail.get("candidate")
        shot.update(matched=match is not None, diagnostic=detail,
                    point=[match.x, match.y] if match else None,
                    score=round(candidate["score"], 4) if candidate else None,
                    box=match.box if match else (candidate["box"] if candidate else None))
        return shot

    def automation_preview(self, handle, selector, expected_pid=None, selectors=None):
        self.idle()
        parsed, mapping = self.preview_selectors(selector, selectors)
        for item in mapping.values():
            self.automation_selector_asset(item)
        shot = self.automation_capture(handle, expected_pid)
        if parsed.kind == "coordinate":
            shot.update(point=coordinate(parsed, self.automation_capture_image.size), score=None)
        else:
            self.vision_preview(shot, self.automation_capture_image, parsed, self.automation_directory(), mapping)
        return shot

    def record_emit(self, event):
        if event["kind"] == "stop_request":
            threading.Thread(target=self.stop_from_listener, args=(event,), daemon=True).start()
        else:
            self.emit(event)

    def stop_from_listener(self, event):
        reason = event.get("reason", "")
        try:
            self.finish_recording()
        except Exception:
            # finish_recording already publishes its error with the traceback.
            return
        if reason and reason != "F12":
            self.emit({"kind": "record_error", "message": "录制监听异常：" + reason,
                       "traceback": event.get("traceback", "")})

    def finish_recording(self):
        with self.record_lock:
            if not self.recorder:
                return self.pending_recording
            recorder = self.recorder
            try:
                raw = recorder.stop()
                project = convert_events(raw)
                folder = ROOT / "recordings"
                folder.mkdir(exist_ok=True)
                path = folder / (uuid4().hex[:12] + ".json")
                path.write_text(json.dumps({"events": raw, "project": project.to_dict()}, ensure_ascii=False, indent=2), encoding="utf-8")
                self.pending_recording = {"project": project.to_dict(), "duration": round(time.monotonic()-recorder.start_time, 2), "raw_count": len(raw), "path": str(path), "diagnostics": recorder.diagnostics()}
                self.recorder = None
                self.emit({"kind": "record_stopped", **self.pending_recording})
                return self.pending_recording
            except Exception as error:
                self.emit({"kind": "record_error", "message": str(error), "traceback": traceback.format_exc()})
                raise
            finally:
                self.recorder = None

    def call(self, method, args):
        if method == 'game_status':
            game=self.window(args['handle']);rect=wt.RECT()
            user32.GetWindowRect(game.handle,ct.byref(rect))
            return {'owner':int(user32.GetParent(game.handle) or 0),
                    'style':get_long(game.handle,-16)&0xffffffff,'exstyle':get_long(game.handle,-20)&0xffffffff,
                    'rect':[rect.left,rect.top,rect.right,rect.bottom]}
        if method == 'script_import':
            self.idle()
            from .scripting import read_script
            return read_script(args['path'])
        if method == 'toolbar_pair_attach':
            self.idle()
            game = self.window(args['handle'])
            if game.pid != int(args['game_pid']):
                raise ValueError('目标窗口身份已变化，请重新连接')
            return self.toolbar_pair.attach(game, int(args['toolbar']), int(args['toolbar_pid']))
        if method == 'toolbar_pair_detach':
            return self.toolbar_pair.detach()
        if method == 'toolbar_pair_show':
            return self.toolbar_pair.show()
        if method == 'game_info':
            game=self.window(args['handle']);rect=wt.RECT();origin=wt.POINT()
            if not user32.GetClientRect(game.handle,ct.byref(rect)):raise RuntimeError('无法读取目标应用客户区')
            info={'handle':game.handle,'pid':game.pid,'width':rect.right,'height':rect.bottom,'title':game.title,'process_name':game.process_name}
            if not user32.IsIconic(game.handle) and user32.ClientToScreen(game.handle,ct.byref(origin)):
                info['bounds']=[origin.x,origin.y,rect.right,rect.bottom]
                frame=wt.RECT()
                if user32.GetWindowRect(game.handle,ct.byref(frame)):
                    info['window_bounds']=[frame.left,frame.top,frame.right-frame.left,frame.bottom-frame.top]
            return info
        if method == 'game_focus':
            WindowsBackend(self.window(args['handle'])).activate(require_input=False)
            return {}
        if method == "bootstrap":
            return self.bootstrap(args.get('preferred_handle'))
        if method == "windows":
            return {"windows": [asdict(w) for w in list_game_windows()], "admin": is_admin()}
        if method == "new_project":
            self.idle()
            self.case_path = None
            self.base_dir = ROOT / "test_cases" / ".drafts" / uuid4().hex[:8]
            return self.project_response(Project("未命名用例"))
        if method == 'control_list':
            return self.controls.list(args.get('query', ''), args.get('category_id'))
        if method in {'control_save', 'control_delete', 'control_import', 'control_category_save', 'control_category_delete'}:
            self.idle()
            if method == 'control_save':
                return self.controls.save(args['selector'], args.get('category_id', ''), args.get('id'))
            if method == 'control_delete':
                current_ids = args.get('current_ids', [])
                if not isinstance(current_ids, list) or any(not isinstance(value, str) for value in current_ids):
                    raise ValueError('当前用例控件引用无效')
                return self.controls.delete(args['id'], current_ids)
            if method == 'control_category_save':
                return self.controls.save_category(args['name'], args.get('id'))
            if method == 'control_category_delete':
                return self.controls.delete_category(args['id'])
            project = self.controls.import_project(Project.from_dict(args['project']), self.base_dir,
                                                   category_id=args.get('category_id', ''))
            return {'project': project.to_dict(), 'controls': self.controls.list()}
        if method == "case_list":
            return CaseLibrary(ROOT).list(args.get("known", []))
        if method == "load_project":
            self.idle()
            path = Path(args["path"]).resolve()
            project = load_project(path)
            self.base_dir, self.case_path = path.parent, path
            return self.project_response(project, path)
        if method == "save_project":
            self.idle()
            path = Path(args["path"]).resolve()
            parsed = self.controls.import_project(Project.from_dict(args["project"]), self.controls.asset_base)
            project = save_project(self.controls.prune_project(self.controls.resolve_project(parsed, self.base_dir)), path, self.base_dir)
            self.case_path, self.base_dir = path, path.parent
            return self.project_response(project, path)
        if method == "capture":
            return self.capture(args["handle"])
        if method == "automation_capture":
            return self.automation_capture(args["handle"], args.get("expected_pid"))
        if method == "automation_save_template":
            return self.automation_save_template(args["capture_id"], args["handle"], args["name"], args["rect"], args.get("expected_pid"))
        if method == "automation_save_case":
            return self.automation_save_case(args["name"], args["project"])
        if method == "automation_preview":
            return self.automation_preview(args["handle"], args["selector"], args.get("expected_pid"), args.get("selectors"))
        if method == "save_template":
            self.idle()
            if args["capture_id"] != self.capture_id or self.capture_image is None:
                raise ValueError("截图已失效，请重新截取")
            box = args["box"]
            if len(box) != 4 or any(type(v) is not int for v in box):
                raise ValueError("无效的模板选区")
            x1, y1, x2, y2 = box
            if not (0 <= x1 < x2 <= self.capture_image.width and 0 <= y1 < y2 <= self.capture_image.height and min(x2-x1, y2-y1) >= 4):
                raise ValueError("模板区域至少需要 4 × 4 像素")
            directory = self.controls.assets
            directory.mkdir(parents=True, exist_ok=True)
            path = directory / ("capture_" + uuid4().hex[:12] + ".png")
            self.capture_image.crop(box).save(path)
            return {"image": path.relative_to(self.controls.asset_base).as_posix()}
        if method == "import_template":
            self.idle()
            from PIL import Image
            import hashlib
            path = Path(args["path"])
            with Image.open(path) as image:
                converted = image.convert("RGB")
                folder = self.controls.assets
                folder.mkdir(parents=True, exist_ok=True)
                dest = folder / ("import_" + uuid4().hex[:12] + ".png")
                converted.save(dest)
            return {"image": dest.relative_to(self.controls.asset_base).as_posix()}
        if method == "template_preview":
            from PIL import Image
            path = self.controls.asset_path(args["image"])
            with Image.open(path) as image:
                image.thumbnail((400, 240))
                return {"image": png(image.convert("RGB"))}
        if method == "preview":
            selector, mapping = self.preview_selectors(args["selector"], args.get("selectors"))
            shot = self.capture(args["handle"])
            if selector.kind == "coordinate":
                point = coordinate(selector, self.capture_image.size)
                shot.update(point=point, score=None)
            else:
                self.vision_preview(shot, self.capture_image, selector, self.controls.asset_base, mapping)
            return shot
        if method == "run":
            self.idle()
            project = self.controls.resolve_project(Project.from_dict(args["project"]), self.base_dir)
            if not any(step.enabled for step in project.steps):
                raise ValueError("请先添加并启用步骤")
            iterations = int(args.get("iterations", 1))
            if not 1 <= iterations <= 1000:
                raise ValueError("循环次数需在 1 ~ 1000 之间")
            game = self.window(args["handle"])
            self.verify_game_pid(game, args.get("expected_pid"))
            self.stop_event.clear()
            backend = WindowsBackend(game, self.stop_event.is_set)
            runner = Runner(backend, project, self.base_dir, ROOT / "reports", self.emit)
            self.running = True
            def work():
                try:
                    runner.run(iterations)
                except Exception as error:
                    self.running = False
                    self.emit({"kind": "run_error", "message": str(error), "traceback": traceback.format_exc()})
            self.worker = threading.Thread(target=work, daemon=True)
            self.worker.start()
            return {"started": True}
        if method == "stop":
            self.stop_event.set()
            if self.recorder:
                return self.finish_recording()
            return {"stopping": self.running}
        if method == "record_status":
            return self.recorder.diagnostics() if self.recorder else {"listening": False}
        if method == "record_start":
            self.idle()
            game = self.window(args["handle"])
            self.verify_game_pid(game, args.get("expected_pid"))
            recorder = Recorder(game, self.record_emit)
            self.pending_recording = None
            self.recorder = recorder
            try:
                recorder.start()
                if self.recorder is not recorder or recorder.done.is_set():
                    raise RuntimeError("录制监听启动后立即退出，请查看监听异常日志")
            except Exception:
                self.recorder = None
                raise
            self.emit({"kind": "record_started", "diagnostics": recorder.diagnostics()})
            return {"started": True}
        if method == "record_stop":
            return self.finish_recording()
        if method == "reports":
            return ReportLibrary(ROOT).list()
        if method == "reports_delete":
            self.idle()
            return ReportLibrary(ROOT).delete(args.get('ids'))
        if method == "shutdown":
            self.stop_event.set()
            if self.recorder:
                self.finish_recording()
            if self.worker:
                self.worker.join(timeout=5)
                if self.worker.is_alive():
                    raise RuntimeError("执行尚未停止，请稍后关闭工作台")
            self.toolbar_pair.detach()
            return {"done": True}
        raise ValueError("不支持的命令")


def main():
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    service = Service()
    for line in sys.stdin:
        request = {}
        try:
            if len(line) > 20*1024*1024:
                raise ValueError("请求过大")
            request = json.loads(line)
            result = service.call(request["method"], request.get("args") or {})
            output({"id": request["id"], "result": result})
            if request["method"] == "shutdown":
                break
        except Exception as error:
            output({"id": request.get("id"), "error": str(error), "traceback": traceback.format_exc()})
    # EOF also stops listeners and releases held input.
    service.call("shutdown", {})


if __name__ == "__main__":
    main()
