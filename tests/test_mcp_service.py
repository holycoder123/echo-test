import base64
import hashlib
import io
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch

from PIL import Image

from nycs_studio.backend import GameWindow
from nycs_studio.service import Service
from nycs_studio.models import Project, Selector, Step, load_project
from nycs_studio import service as native


class McpServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.enterContext(patch.object(native, "ROOT", self.root))
        # Never initialize window recovery or call real desktop APIs here.
        self.service = Service.__new__(Service)
        self.service.running = False
        self.service.recorder = None
        self.service.capture_image = Image.new("RGB", (20, 20), "red")
        self.service.capture_id = "renderer-capture"
        self.service.base_dir = self.root / "editor-draft"
        self.service.automation_capture_image = None
        self.service.automation_capture_id = None
        self.service.automation_capture_handle = None
        self.service.automation_capture_pid = None
        self.service.automation_capture_at = None
        self.game = GameWindow(1234, "诺亚传说测试", 99)
        self.service.window = Mock(return_value=self.game)
        self.frame = Image.new("RGB", (1024, 700), "blue")
        self.frame.paste("red", (10, 20, 30, 40))
        self.backend = Mock()
        self.backend.rect.return_value = (100, 200, 1024, 700)
        self.backend.capture.side_effect = lambda: self.frame.copy()
        self.backend_factory = self.enterContext(patch.object(native, "WindowsBackend", return_value=self.backend))

    def observe(self):
        return self.service.call("automation_capture", {"handle": self.game.handle})

    def save(self, observation, *, name="新手_任务-01.png", handle=None, rect=None):
        return self.service.call("automation_save_template", {
            "capture_id": observation["id"],
            "handle": self.game.handle if handle is None else handle,
            "name": name,
            "rect": {"x": 10, "y": 20, "w": 20, "h": 20} if rect is None else rect,
        })

    def test_capture_returns_client_area_png_and_keeps_renderer_capture(self):
        renderer_image = self.service.capture_image
        observation = self.observe()
        self.assertEqual((observation["width"], observation["height"], observation["handle"]), (1024, 700, 1234))
        self.backend.activate.assert_called_once_with(require_input=False)
        self.service.window.assert_called_once_with(1234)
        self.backend_factory.assert_called_once_with(self.game)
        with Image.open(io.BytesIO(base64.b64decode(observation["image"].split(",", 1)[1]))) as image:
            self.assertEqual(image.size, (1024, 700))
            self.assertEqual(image.getpixel((10, 20)), (255, 0, 0))
        self.assertIs(self.service.capture_image, renderer_image)
        self.assertEqual(self.service.capture_id, "renderer-capture")
        self.assertEqual(self.service.base_dir, self.root / "editor-draft")

    def test_busy_capture_does_not_activate_or_change_running_recording_state(self):
        for running, recorder in [(True, None), (False, object())]:
            with self.subTest(running=running):
                self.backend.activate.reset_mock()
                self.service.running, self.service.recorder = running, recorder
                observation = self.observe()
                self.backend.activate.assert_not_called()
                self.assertEqual(observation["handle"], 1234)
                self.assertIs(self.service.recorder, recorder)
                self.assertEqual(self.service.running, running)

    def test_busy_capture_reports_focus_failure_without_activating(self):
        self.service.running = True
        self.backend.capture.side_effect = RuntimeError("游戏窗口失去焦点")
        with self.assertRaisesRegex(RuntimeError, "失去焦点"):
            self.observe()
        self.backend.activate.assert_not_called()
        self.assertIsNone(self.service.automation_capture_image)

    def test_handles_must_be_positive_integers(self):
        for handle in [False, True, 0, -1, "1234", 12.5, None, 2**64]:
            with self.subTest(handle=handle), self.assertRaisesRegex(ValueError, "句柄"):
                self.service.automation_capture(handle)
        self.backend_factory.assert_not_called()

    def test_closed_window_is_rejected_before_any_capture(self):
        self.service.window.side_effect = ValueError("游戏窗口已关闭")
        with self.assertRaisesRegex(ValueError, "已关闭"):
            self.observe()
        self.backend_factory.assert_not_called()

    def test_oversize_client_area_is_rejected_before_allocating_screenshot(self):
        for size in [(4097, 700), (1024, 4097), (4096, 4096), (0, 700), (9, 700), (1024, True), (1024.0, 700)]:
            with self.subTest(size=size):
                self.backend.rect.return_value = (0, 0, *size)
                with self.assertRaisesRegex(ValueError, "尺寸超出限制"):
                    self.observe()
        self.backend.capture.assert_not_called()

    def test_capture_rejects_resize_between_rectangle_and_screenshot(self):
        self.frame = Image.new("RGB", (1030, 700))
        with self.assertRaisesRegex(ValueError, "尺寸已改变"):
            self.observe()
        self.assertIsNone(self.service.automation_capture_id)

    def test_saving_uses_observed_image_without_new_capture_and_fixed_assets_folder(self):
        observation = self.observe()
        self.backend.capture.reset_mock()
        self.frame.paste("green", (0, 0, 1024, 700))
        template = self.save(observation)
        self.backend.capture.assert_not_called()
        self.assertEqual(template, {"image": "assets/新手_任务-01.png", "width": 20, "height": 20, "handle": 1234})
        with Image.open(self.root / "test_cases" / template["image"]) as image:
            self.assertEqual(image.size, (20, 20))
            self.assertEqual(image.getpixel((0, 0)), (255, 0, 0))
        self.assertFalse(self.service.base_dir.exists())

    def test_only_latest_capture_id_can_save_a_template(self):
        old_observation = self.observe()
        previous_frame = self.service.automation_capture_image
        current_observation = self.observe()
        self.assertNotEqual(old_observation["id"], current_observation["id"])
        self.assertIsNot(previous_frame, self.service.automation_capture_image)
        with self.assertRaisesRegex(ValueError, "截图已失效"):
            self.save(old_observation)
        self.save(current_observation)

    def test_expired_capture_cannot_save_a_template(self):
        observation = self.observe()
        self.service.automation_capture_at = time.monotonic() - native.AUTOMATION_CAPTURE_MAX_AGE - 1
        with self.assertRaisesRegex(ValueError, "截图已失效"):
            self.save(observation)
        self.assertFalse((self.root / "test_cases").exists())

    def test_capture_cannot_be_used_for_another_handle(self):
        observation = self.observe()
        self.service.window.reset_mock()
        with self.assertRaisesRegex(ValueError, "不属于当前游戏窗口"):
            self.save(observation, handle=4321)
        self.service.window.assert_not_called()

    def test_template_rejects_closed_changed_or_resized_window(self):
        observation = self.observe()
        self.service.window.side_effect = ValueError("游戏窗口已关闭")
        with self.assertRaisesRegex(ValueError, "已关闭"):
            self.save(observation)
        self.service.window.side_effect = None
        self.service.window.return_value = GameWindow(1234, "诺亚传说测试", 100)
        with self.assertRaisesRegex(ValueError, "进程已改变"):
            self.save(observation)
        self.service.window.return_value = self.game
        self.backend.rect.return_value = (100, 200, 1024, 701)
        with self.assertRaisesRegex(ValueError, "尺寸已改变"):
            self.save(observation)
        self.assertFalse((self.root / "test_cases").exists())

    def test_template_rejects_noninteger_small_and_out_of_bounds_rectangles(self):
        observation = self.observe()
        bad_rectangles = [
            {"x": 0, "y": 0, "w": 3, "h": 20},
            {"x": -1, "y": 0, "w": 20, "h": 20},
            {"x": 1020, "y": 0, "w": 5, "h": 20},
            {"x": 0, "y": 690, "w": 20, "h": 11},
            {"x": 0, "y": 0, "w": 20.0, "h": 20},
            {"x": False, "y": 0, "w": 20, "h": 20},
            {"x": 0, "y": 0, "w": 20},
            {"x": 0, "y": 0, "w": 20, "h": 20, "extra": 1},
            [0, 0, 20, 20],
        ]
        for rect in bad_rectangles:
            with self.subTest(rect=rect), self.assertRaises(ValueError):
                self.save(observation, rect=rect)
        self.assertFalse((self.root / "test_cases").exists())

    def test_template_rejects_path_traversal_and_windows_reserved_names(self):
        observation = self.observe()
        for name in ["../escape", "..\\escape", "a/b", "a\\b", "C:\\escape", "a:b", ".", "..", "CON", "con.png", "NUL", "LPT1", "COM¹", "a.png.png", "a ", "", "a" * 65, 1, None]:
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.save(observation, name=name)
        self.assertFalse((self.root / "test_cases").exists())

    def test_busy_service_cannot_write_templates(self):
        observation = self.observe()
        for running, recorder in [(True, None), (False, object())]:
            with self.subTest(running=running):
                self.service.running, self.service.recorder = running, recorder
                with self.assertRaisesRegex(ValueError, "停止执行或录制"):
                    self.save(observation)
        self.assertFalse((self.root / "test_cases").exists())

    def test_existing_template_is_never_overwritten(self):
        observation = self.observe()
        template = self.save(observation)
        destination = self.root / "test_cases" / template["image"]
        original = destination.read_bytes()
        with self.assertRaisesRegex(ValueError, "模板已存在"):
            self.save(observation)
        self.assertEqual(destination.read_bytes(), original)

    def test_assets_directory_redirect_is_rejected(self):
        observation = self.observe()
        original_resolve = Path.resolve
        directory = self.root / "test_cases" / "assets"
        def resolve(path, *args, **kwargs):
            return self.root / "external" if path == directory else original_resolve(path, *args, **kwargs)
        with patch.object(Path, "resolve", autospec=True, side_effect=resolve):
            with self.assertRaisesRegex(ValueError, "重定向路径"):
                self.save(observation)
        self.assertFalse(directory.exists())

    def test_save_case_validates_and_returns_portable_project(self):
        observation = self.observe()
        template = self.save(observation)
        project = Project("新手任务", [Selector("任务图", kind="image", image=template["image"])],
                          [Step("任务验证", "assert_image", "任务图")]).to_dict()
        result = self.service.call("automation_save_case", {"name": "新手全部任务", "project": project})
        destination = self.root / "test_cases" / "新手全部任务.nycs.json"
        self.assertEqual(result["path"], str(destination))
        self.assertEqual(result["base_dir"], str(destination.parent))
        self.assertEqual(self.service.case_path, destination)
        self.assertEqual(self.service.base_dir, destination.parent)
        portable_image = result["project"]["selectors"][0]["image"]
        self.assertRegex(portable_image, r"^assets/template_[a-f0-9]{12}\.png$")
        self.assertTrue((destination.parent / portable_image).is_file())
        self.assertEqual(load_project(destination).to_dict(), result["project"])
        self.assertEqual(self.service.capture_id, "renderer-capture")

    def test_save_case_allows_updating_same_safe_case_name(self):
        project = Project("第一次", steps=[Step("等待", "sleep", params={"duration": .1})]).to_dict()
        first = self.service.automation_save_case("newbie.nycs.json", project)
        project["name"] = "第二次"
        second = self.service.automation_save_case("newbie", project)
        self.assertEqual(first["path"], second["path"])
        self.assertEqual(load_project(Path(second["path"])).name, "第二次")

    def test_save_case_rejects_paths_and_invalid_project_before_writing(self):
        project = Project("测试").to_dict()
        for name in ["../case", "..\\case", "C:\\case", "CON", "case.txt", ""]:
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.service.automation_save_case(name, project)
        with self.assertRaises(ValueError):
            self.service.automation_save_case("case", {"schema_version": 2})
        self.assertFalse((self.root / "test_cases").exists())

    def test_save_case_rejects_external_or_missing_template_paths(self):
        for image in ["../external.png", "C:\\external.png", "assets/../external.png", "assets\\test.png",
                      "other/test.png", "assets/missing.png", "assets/CON.png", "assets/test.jpg"]:
            with self.subTest(image=image):
                project = Project("测试", [Selector("图片", kind="image", image=image)]).to_dict()
                with self.assertRaises(ValueError):
                    self.service.automation_save_case("case", project)
        self.assertFalse((self.root / "test_cases").exists())

    def test_save_case_rejects_template_file_redirect_before_read(self):
        observation = self.observe()
        template = self.save(observation)
        source = self.root / "test_cases" / template["image"]
        project = Project("测试", [Selector("图片", kind="image", image=template["image"])]).to_dict()
        original_resolve = Path.resolve
        def resolve(path, *args, **kwargs):
            return self.root / "external.png" if path == source else original_resolve(path, *args, **kwargs)
        with patch.object(Path, "resolve", autospec=True, side_effect=resolve):
            with self.assertRaisesRegex(ValueError, "重定向路径"):
                self.service.automation_save_case("case", project)
        self.assertFalse((self.root / "test_cases" / "case.nycs.json").exists())

    def test_save_case_rejects_asset_copy_destination_redirect(self):
        observation = self.observe()
        template = self.save(observation)
        source = self.root / "test_cases" / template["image"]
        digest = hashlib.sha256(source.read_bytes()).hexdigest()[:12]
        destination = source.parent / ("template_" + digest + ".png")
        project = Project("测试", [Selector("图片", kind="image", image=template["image"])]).to_dict()
        original_resolve = Path.resolve
        def resolve(path, *args, **kwargs):
            return self.root / "external.png" if path == destination else original_resolve(path, *args, **kwargs)
        with patch.object(Path, "resolve", autospec=True, side_effect=resolve):
            with self.assertRaisesRegex(ValueError, "模板目标使用了重定向路径"):
                self.service.automation_save_case("case", project)

    def test_save_case_rejects_case_or_temporary_file_redirect(self):
        project = Project("测试").to_dict()
        original_resolve = Path.resolve
        for redirected in ["case.nycs.json", "case.nycs.json.tmp"]:
            with self.subTest(redirected=redirected):
                def resolve(path, *args, **kwargs):
                    if path == self.root / "test_cases" / redirected:
                        return self.root / "external.json"
                    return original_resolve(path, *args, **kwargs)
                with patch.object(Path, "resolve", autospec=True, side_effect=resolve):
                    with self.assertRaisesRegex(ValueError, "用例目标使用了重定向路径"):
                        self.service.automation_save_case("case", project)
        self.assertFalse((self.root / "test_cases").exists())

    def test_busy_save_case_is_rejected(self):
        for running, recorder in [(True, None), (False, object())]:
            with self.subTest(running=running):
                self.service.running, self.service.recorder = running, recorder
                with self.assertRaisesRegex(ValueError, "停止执行或录制"):
                    self.service.automation_save_case("case", Project("测试").to_dict())
        self.assertFalse((self.root / "test_cases").exists())

    def test_preview_coordinate_uses_independent_capture_and_preserves_editor(self):
        result = self.service.call("automation_preview", {
            "handle": 1234, "selector": {"name": "中心", "x": .5, "y": .5},
        })
        self.assertEqual(result["point"], (512, 350))
        self.assertIsNone(result["score"])
        self.assertEqual(result["handle"], 1234)
        self.assertEqual(self.service.capture_id, "renderer-capture")
        self.assertEqual(self.service.base_dir, self.root / "editor-draft")

    def test_preview_image_matches_fixed_test_cases_assets(self):
        pattern = Image.frombytes("RGB", (12, 12), bytes((i * 73 + i // 17) % 256 for i in range(12 * 12 * 3)))
        self.frame.paste(pattern, (10, 20))
        observation = self.observe()
        template = self.save(observation, rect={"x": 10, "y": 20, "w": 12, "h": 12})
        result = self.service.automation_preview(1234, {
            "name": "图像目标", "kind": "image", "image": template["image"],
            "roi": [5, 10, 40, 40], "threshold": .95,
        })
        self.assertEqual(result["point"], [16, 26])
        self.assertEqual(result["box"], (10, 20, 12, 12))
        self.assertGreater(result["score"], .99)
        self.assertEqual(self.service.base_dir, self.root / "editor-draft")

    def test_preview_rejects_external_template_before_capture(self):
        with self.assertRaises(ValueError):
            self.service.automation_preview(1234, {"name": "图片", "kind": "image", "image": "../outside.png"})
        self.backend_factory.assert_not_called()

    def test_preview_reports_missing_match_and_rejects_busy(self):
        pattern = Image.frombytes("RGB", (12, 12), bytes((i * 73 + i // 17) % 256 for i in range(12 * 12 * 3)))
        self.frame.paste(pattern, (10, 20))
        observation = self.observe()
        template = self.save(observation, rect={"x": 10, "y": 20, "w": 12, "h": 12})
        selector = {"name": "图片", "kind": "image", "image": template["image"], "threshold": .95}
        self.frame.paste("blue", (0, 0, 1024, 700))
        result = self.service.automation_preview(1234, selector)
        self.assertFalse(result["matched"])
        self.assertIsNone(result["point"])
        self.assertIn("reason", result["diagnostic"])
        self.service.running = True
        with self.assertRaisesRegex(ValueError, "停止执行或录制"):
            self.service.automation_preview(1234, selector)

    def test_all_variant_and_mask_paths_are_checked_before_capture(self):
        observation = self.observe()
        template = self.save(observation)
        self.backend_factory.reset_mock()
        for extra in [{"mask":"../outside.png"}, {"templates":[{"image":"../outside.png"}]},
                      {"templates":[{"image":template["image"],"mask":"../outside.png"}]}]:
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                self.service.automation_preview(1234, {"name":"图片","kind":"image","image":template["image"],**extra})
        self.backend_factory.assert_not_called()

    def test_preview_resolves_named_anchor_on_same_capture(self):
        title = Image.frombytes("RGB", (12,12), bytes((i*71+i//19)%256 for i in range(432)))
        button = Image.frombytes("RGB", (12,12), bytes((i*31+i//13)%256 for i in range(432)))
        self.frame.paste(title,(100,100))
        self.frame.paste(button,(110,130))
        shot = self.observe()
        title_path = self.save(shot,name="title.png",rect={"x":100,"y":100,"w":12,"h":12})["image"]
        button_path = self.save(shot,name="button.png",rect={"x":110,"y":130,"w":12,"h":12})["image"]
        self.backend.capture.reset_mock()
        result = self.service.call("automation_preview", {"handle":1234,
            "selector":{"name":"button","kind":"image","image":button_path,"anchor":"title","roi":[0,20,50,40]},
            "selectors":[{"name":"title","kind":"image","image":title_path}]})
        self.assertTrue(result["matched"])
        self.assertEqual(result["point"], [116,136])
        self.assertTrue(result["diagnostic"]["anchor"]["matched"])
        self.backend.capture.assert_called_once()

    def test_ocr_preview_needs_no_asset_and_returns_serializable_metadata(self):
        from types import SimpleNamespace
        import numpy as np
        import json
        result = SimpleNamespace(boxes=np.array([[[10,20],[90,20],[90,40],[10,40]]]),txts=["完成任务"],scores=[.98])
        with patch("nycs_studio.vision.ocr_engine", return_value=lambda frame:result):
            preview = self.service.automation_preview(1234, {"name":"文字","kind":"image","recognition":"ocr","text":"完成任务"})
        self.assertEqual(preview["point"], [50,30])
        self.assertTrue(preview["matched"])
        json.dumps(preview)

    def test_capture_and_preview_reject_reused_window_handle_before_activation(self):
        self.service.window.return_value = GameWindow(1234, "诺亚传说新进程", 100)
        for method, args in [
            ("automation_capture", {"handle": 1234, "expected_pid": 99}),
            ("automation_preview", {"handle": 1234, "expected_pid": 99, "selector": {"name": "中心"}}),
        ]:
            with self.subTest(method=method), self.assertRaisesRegex(ValueError, "身份已变化"):
                self.service.call(method, args)
        self.backend_factory.assert_not_called()
        self.backend.activate.assert_not_called()
        self.assertIsNone(self.service.automation_capture_id)

    def test_template_rejects_request_for_another_pid_without_writing(self):
        observation = self.observe()
        with self.assertRaisesRegex(ValueError, "身份已变化"):
            self.service.call("automation_save_template", {
                "capture_id": observation["id"], "handle": 1234, "expected_pid": 100,
                "name": "template", "rect": {"x": 10, "y": 20, "w": 20, "h": 20},
            })
        self.assertFalse((self.root / "test_cases").exists())
        result = self.service.call("automation_save_template", {
            "capture_id": observation["id"], "handle": 1234, "expected_pid": 99,
            "name": "template", "rect": {"x": 10, "y": 20, "w": 20, "h": 20},
        })
        self.assertEqual(result["image"], "assets/template.png")

    def test_run_and_record_reject_reused_handle_before_creating_input_workers(self):
        self.service.stop_event = threading.Event()
        self.service.stop_event.set()
        self.service.pending_recording = {"preserved": True}
        self.service.window.return_value = GameWindow(1234, "诺亚传说新进程", 100)
        project = Project("不能开始", steps=[Step("等待", "sleep", params={"duration": .1})]).to_dict()
        with patch.object(native, "Runner") as runner, patch.object(native, "Recorder") as recorder:
            for method, args in [
                ("run", {"handle": 1234, "expected_pid": 99, "project": project}),
                ("record_start", {"handle": 1234, "expected_pid": 99}),
            ]:
                with self.subTest(method=method), self.assertRaisesRegex(ValueError, "身份已变化"):
                    self.service.call(method, args)
            runner.assert_not_called()
            recorder.assert_not_called()
        self.backend_factory.assert_not_called()
        self.assertTrue(self.service.stop_event.is_set())
        self.assertFalse(self.service.running)
        self.assertIsNone(self.service.recorder)
        self.assertEqual(self.service.pending_recording, {"preserved": True})

    def test_expected_pid_is_a_positive_integer_or_omitted(self):
        for expected_pid in [False, True, 0, -1, "99", 99.0, 2**32]:
            with self.subTest(expected_pid=expected_pid), self.assertRaisesRegex(ValueError, "无效的游戏进程身份"):
                self.service.automation_capture(1234, expected_pid)
        self.backend_factory.assert_not_called()
        observation = self.service.automation_capture(1234, 99)
        self.assertEqual(observation["handle"], 1234)
        observation = self.observe()
        self.assertEqual(observation["handle"], 1234)


if __name__ == "__main__":
    unittest.main()
