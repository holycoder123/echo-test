import base64
from concurrent.futures import Future
import io
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch

from PIL import Image
import numpy as np
from echo_test import service as native
from echo_test.backend import GameWindow
from echo_test.models import Project, Selector, Step
from echo_test.service import Service, respond_future


class ExplorationBackend:
    """No desktop API calls: small mutable frame and cooperative input cancellation."""
    def __init__(self):
        self.stop = lambda: False
        self.calls = []
        self.frame = Image.new("RGB", (80, 60), "blue")
        self.entered = threading.Event()
        self.key_pressed = threading.Event()
        self.held_keys = set()
        self.release_error = None
        self.capture_error = None
        self.click_error = None

    def cancelled(self):
        return self.stop()

    def pause(self, seconds):
        self.entered.set()
        deadline = time.monotonic() + seconds
        while True:
            if self.cancelled():
                raise RuntimeError("用户停止执行")
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return
            time.sleep(min(.005, remaining))

    def activate(self, **kwargs):
        self.calls.append("activate")
        self.pause(0)

    def size(self):
        return self.frame.size

    def rect(self):
        return (0, 0, *self.frame.size)

    def click(self, point):
        self.pause(0)
        self.calls.append(("click", point))
        if self.click_error:
            raise self.click_error
        self.frame.paste("green", (0, 0, *self.frame.size))

    def key_down(self, keys):
        self.calls.append(("key_down", keys))
        self.held_keys.add(keys)
        self.key_pressed.set()

    def capture(self):
        self.calls.append("capture")
        if self.capture_error:
            raise self.capture_error
        return self.frame.copy()

    def release_all(self):
        self.calls.append("release_all")
        if self.release_error:
            raise self.release_error
        self.held_keys.clear()


class ExplorationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.enterContext(patch.object(native, "ROOT", self.root))
        self.service = Service.__new__(Service)
        self.service.running = False
        self.service.recorder = None
        self.service.stop_event = threading.Event()
        self.service.worker = None
        self.service.toolbar_pair = Mock()
        self.service.base_dir = self.root / "editor-draft"
        self.service.case_path = self.service.base_dir / "unsaved.echo.json"
        self.service.pending_recording = {"preserved": True}
        self.service.capture_id = "renderer-observation"
        self.service.capture_image = Image.new("RGB", (20, 20), "red")
        self.game = GameWindow(1234, "目标应用", 99)
        self.service.window = Mock(return_value=self.game)
        self.backend = ExplorationBackend()
        self.events = []

        def emit(event):
            if event["kind"] == "finished":
                self.assertEqual(self.backend.calls[-1], "capture")
                self.service.running = False
            self.events.append(event)
        self.service.emit = emit

        def backend(game, stop=None):
            if stop is not None:
                self.backend.stop = stop
            return self.backend
        self.backend_factory = self.enterContext(patch.object(native, "WindowsBackend", side_effect=backend))
        self.addCleanup(self.stop_worker)

    def stop_worker(self):
        self.service.stop_event.set()
        if self.service.worker:
            self.service.worker.join(3)

    def project(self, steps=None):
        return Project("探索任务", [Selector("按钮", x=.5, y=.5)], steps if steps is not None else [Step("点击", "click", "按钮", delay=0)]).to_dict()

    def start(self, project=None, **args):
        return self.service.call("automation_explore", {"handle": 1234, "expected_pid": 99, "project": project or self.project(), **args})

    def snapshot(self):
        return {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob("*") if p.is_file()}

    def test_success_returns_changed_pixels_after_release_without_persisting_or_replacing_editor(self):
        sentinel = self.root / "controls" / "library.json"
        sentinel.parent.mkdir()
        sentinel.write_text('{"original":true}', encoding="utf-8")
        before = self.snapshot()
        renderer_image = self.service.capture_image
        result = self.start().result(3)
        self.assertEqual(result["result"]["status"], "passed")
        self.assertEqual(len(result["result"]["steps"]), 1)
        self.assertFalse(result["saved"])
        self.assertEqual(result["id"], result["capture_id"])
        self.assertEqual(self.backend.calls[-2:], ["release_all", "capture"])
        with Image.open(io.BytesIO(base64.b64decode(result["image"].split(",", 1)[1]))) as image:
            self.assertEqual(image.getpixel((10, 10)), (0, 128, 0))
        self.assertEqual(before, self.snapshot())
        self.assertFalse((self.root / "reports").exists())
        self.assertFalse((self.root / "test_cases").exists())
        self.assertFalse(hasattr(self.service, "_controls_library"))
        self.assertEqual(self.service.case_path, self.root / "editor-draft" / "unsaved.echo.json")
        self.assertEqual(self.service.pending_recording, {"preserved": True})
        self.assertEqual(self.service.capture_id, "renderer-observation")
        self.assertIs(self.service.capture_image, renderer_image)
        self.assertIsNone(self.events[-1]["directory"])
        self.assertNotIn("image", json.dumps(self.events))

    def test_image_assertions_use_inline_assets_and_keep_diagnostics_without_writing_reports(self):
        assets = self.root / "test_cases" / "assets"
        assets.mkdir(parents=True)
        pattern = Image.fromarray(np.random.default_rng(42).integers(0, 256, (15, 20, 3), dtype=np.uint8))
        pattern.save(assets / "button.png")
        project = Project("图片验证", [Selector("图片", kind="image", image="assets/button.png", threshold=.95)],
            [Step("确认出现", "assert_image", "图片", timeout=.1, delay=0)]).to_dict()
        before = self.snapshot()
        self.backend.frame.paste(pattern, (10, 20))
        passed = self.start(project).result(3)
        self.assertEqual(passed["result"]["status"], "passed")
        self.assertTrue(passed["result"]["steps"][0]["recognition"]["图片"]["matched"])
        self.backend.frame = Image.new("RGB", (80, 60), "blue")
        failed = self.start(project).result(3)
        self.assertEqual(failed["result"]["status"], "failed")
        self.assertFalse(failed["result"]["steps"][0]["recognition"]["图片"]["matched"])
        self.assertNotIn("recognition_screenshot", failed["result"]["steps"][0])
        self.assertEqual(before, self.snapshot())
        self.assertFalse((self.root / "reports").exists())

    def test_final_observation_can_be_cropped_only_when_explicitly_saved(self):
        result = self.start().result(3)
        self.assertFalse(self.snapshot())
        saved = self.service.call("automation_save_template", {"capture_id": result["capture_id"], "handle": 1234,
            "expected_pid": 99, "name": "verified.png", "rect": {"x": 5, "y": 5, "w": 10, "h": 10}})
        self.assertEqual(saved["image"], "assets/verified.png")
        self.assertEqual(len(self.snapshot()), 1)

    def test_failed_step_stops_following_inputs_and_returns_fresh_evidence_without_reports(self):
        self.backend.click_error = RuntimeError("点击被遮挡")
        steps = [Step("失败", "click", "按钮", delay=0), Step("不能执行", "click", "按钮", delay=0)]
        result = self.start(self.project(steps)).result(3)
        self.assertEqual(result["result"]["status"], "failed")
        self.assertEqual(len(result["result"]["steps"]), 1)
        self.assertIn("点击被遮挡", result["result"]["error"])
        self.assertTrue(result["image"].startswith("data:image/png;base64,"))
        self.assertFalse(self.snapshot())

    def test_stop_responds_while_exploration_rpc_waits_and_releases_held_keys(self):
        steps = [Step("按住", "key_down", params={"keys": "W"}, delay=0), Step("等待", "sleep", params={"duration": 10}, delay=0)]
        future = self.start(self.project(steps))
        self.assertIsInstance(future, Future)
        self.assertTrue(self.backend.key_pressed.wait(1))
        self.assertEqual(self.backend.held_keys, {"W"})
        response = self.service.call("stop", {})
        self.assertIn("stopping", response)
        result = future.result(3)
        self.assertEqual(result["result"]["status"], "stopped")
        self.assertEqual(result["result"]["stop_reason"], "user")
        self.assertIn("release_all", self.backend.calls)
        self.assertFalse(self.backend.held_keys)
        self.assertIn("image", result)
        self.assertFalse(self.service.running)
        self.assertFalse(self.snapshot())

    def test_total_deadline_stops_long_sleep_and_skips_later_clicks(self):
        steps = [Step("等待", "sleep", params={"duration": 10}, delay=0), Step("不能点击", "click", "按钮", delay=0)]
        result = self.start(self.project(steps), timeout=1).result(4)
        self.assertEqual(result["result"]["status"], "stopped")
        self.assertEqual(result["result"]["stop_reason"], "timeout")
        self.assertIn("执行时限", result["result"]["error"])
        self.assertEqual(len(result["result"]["steps"]), 1)
        self.assertFalse(any(isinstance(call, tuple) and call[0] == "click" for call in self.backend.calls))
        self.assertIn("image", result)
        self.assertFalse(self.snapshot())

    def test_screenshot_step_is_memory_only_and_still_returns_final_frame(self):
        result = self.start(self.project([Step("截图", "screenshot", delay=0)])).result(3)
        self.assertEqual(result["result"]["status"], "passed")
        self.assertEqual(self.backend.calls.count("capture"), 2)
        self.assertNotIn("screenshot", result["result"]["steps"][0])
        self.assertIn("image", result)
        self.assertFalse(self.snapshot())

    def test_capture_failure_preserves_step_results_and_never_returns_stale_pixels(self):
        self.backend.capture_error = RuntimeError("窗口已关闭")
        result = self.start().result(3)
        self.assertEqual(result["result"]["steps"][0]["status"], "passed")
        self.assertEqual(result["result"]["status"], "failed")
        self.assertIn("窗口已关闭", result["capture_error"])
        self.assertIsNone(result["capture_id"])
        self.assertNotIn("image", result)
        self.assertFalse(self.service.running)

    def test_release_failure_is_not_reported_as_success(self):
        self.backend.release_error = RuntimeError("按键释放失败")
        result = self.start().result(3)
        self.assertEqual(result["result"]["status"], "failed")
        self.assertIn("按键释放失败", result["result"]["error"])
        self.assertIn("image", result)

    def test_limits_and_script_rejection_happen_before_backend_creation(self):
        invalid = [self.project([]), self.project([Step("禁用", "sleep", enabled=False)]),
            self.project([Step("过多", "sleep")] * 11), self.project([Step("重复", "sleep", repeat=11)]),
            self.project([Step("脚本", "python", params={"code": "raise Exception()"})])]
        for project in invalid:
            with self.subTest(project=project), self.assertRaises(ValueError):
                self.start(project)
        for timeout in [0, 31, True, "15", float("nan"), float("inf")]:
            with self.subTest(timeout=timeout), self.assertRaisesRegex(ValueError, "执行时限"):
                self.start(timeout=timeout)
        self.backend_factory.assert_not_called()
        self.assertFalse(self.snapshot())

    def test_busy_and_reused_window_are_rejected_before_sending_input(self):
        self.service.running = True
        with self.assertRaisesRegex(ValueError, "请先停止"):
            self.start()
        self.service.running = False
        self.service.window.return_value = GameWindow(1234, "另一个进程", 100)
        with self.assertRaisesRegex(ValueError, "身份已变化"):
            self.start()
        self.backend_factory.assert_not_called()

    def test_unexpected_worker_failure_releases_busy_and_rejects_future(self):
        with patch.object(native.Runner, "run", side_effect=RuntimeError("执行器异常")):
            with self.assertRaisesRegex(RuntimeError, "执行器异常"):
                self.start().result(3)
        self.assertFalse(self.service.running)
        self.assertEqual(self.events[-1]["kind"], "run_error")

    def test_json_rpc_loop_keeps_reading_stop_and_binds_deferred_response_id(self):
        requests = [
            {"id": 101, "method": "automation_explore", "args": {"handle": 1234, "expected_pid": 99,
                "project": self.project([Step("等待", "sleep", params={"duration": 10}, delay=0)])}},
            {"id": 202, "method": "stop"}, {"id": 303, "method": "shutdown"}]
        stream = io.TextIOWrapper(io.BytesIO(("\n".join(json.dumps(row) for row in requests) + "\n").encode()))
        replies = []
        with patch.object(native, "Service", return_value=self.service), patch.object(native.sys, "stdin", stream), patch.object(native, "output", side_effect=replies.append):
            native.main()
        rows = {row["id"]: row for row in replies}
        self.assertIn("stopping", rows[202]["result"])
        self.assertEqual(rows[101]["result"]["result"]["status"], "stopped")
        self.assertEqual(rows[303]["result"], {"done": True})

    def test_deferred_rpc_error_keeps_request_identity(self):
        future = Future()
        future.set_exception(ValueError("探索异常"))
        with patch.object(native, "output") as output:
            respond_future(73, future)
        self.assertEqual(output.call_args.args[0]["id"], 73)
        self.assertEqual(output.call_args.args[0]["error"], "探索异常")


if __name__ == "__main__":
    unittest.main()
