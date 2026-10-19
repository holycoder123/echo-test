import json
from pathlib import Path
import tempfile
import unittest
import numpy as np
from PIL import Image
from nycs_studio.models import Project, Selector, Step, save_project, load_project
from nycs_studio.vision import coordinate, Vision
from nycs_studio.engine import Runner


class FakeBackend:
    def __init__(self, frame=None):
        self.frame = frame or Image.new("RGB", (200, 120), "gray")
        self.calls = []
        self.stopped = False

    def cancelled(self):
        return self.stopped

    def activate(self):
        self.calls.append(("activate",))

    def pause(self, seconds):
        if self.stopped:
            raise RuntimeError("stopped")

    def size(self):
        return self.frame.size

    def capture(self):
        return self.frame.copy()

    def click(self, point, **kwargs):
        self.calls.append(("click", point, kwargs))

    def drag(self, start, end, duration):
        self.calls.append(("drag", start, end, duration))

    def scroll(self, point, amount, axis):
        self.calls.append(("scroll", point, amount, axis))

    def key(self, chord):
        self.calls.append(("key", chord))

    def text(self, value):
        self.calls.append(("text", value))


class StudioTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def template(self):
        rng = np.random.default_rng(42)
        pattern = rng.integers(0, 256, (18, 24, 3), dtype=np.uint8)
        Image.fromarray(pattern).save(self.root / "target.png")
        frame = np.zeros((100, 140, 3), dtype=np.uint8)
        frame[40:58, 60:84] = pattern
        return Image.fromarray(frame)

    def test_template_match_returns_center_and_roi_origin(self):
        frame = self.template()
        selector = Selector("目标", kind="image", image="target.png", roi=[50, 30, 50, 40], threshold=.95)
        found = Vision(self.root).match(frame, selector)
        self.assertEqual((found.x, found.y), (72, 49))
        self.assertGreater(found.score, .99)
        self.assertEqual(found.box, (60, 40, 24, 18))

    def test_missing_template_does_not_create_false_match(self):
        self.template()
        selector = Selector("目标", kind="image", image="target.png", threshold=.95)
        self.assertIsNone(Vision(self.root).match(Image.new("RGB", (140, 100), "black"), selector))

    def test_flat_template_and_invalid_roi_rejected(self):
        Image.new("RGB", (15, 15), "white").save(self.root / "flat.png")
        with self.assertRaises(ValueError):
            Vision(self.root).match(Image.new("RGB", (100, 100)), Selector("纯色", kind="image", image="flat.png"))
        frame = self.template()
        with self.assertRaises(ValueError):
            Vision(self.root).match(frame, Selector("越界", kind="image", image="target.png", roi=[130, 0, 30, 40]))

    def test_coordinate_clamps_to_actual_pixel_range(self):
        self.assertEqual(coordinate(Selector("边缘", x=1, y=1), (200, 120)), (199, 119))
        with self.assertRaises(ValueError):
            coordinate(Selector("越界", normalized=False, x=201, y=5), (200, 120))

    def test_save_as_copies_assets_and_roundtrips(self):
        self.template()
        project = Project("用例", selectors=[Selector("图片", kind="image", image="target.png")], steps=[Step("验证", "assert_image", target="图片")])
        destination = self.root / "portable" / "case.nycs.json"
        saved = save_project(project, destination, self.root)
        self.assertTrue((destination.parent / saved.selectors[0].image).exists())
        self.assertEqual(load_project(destination).to_dict(), saved.to_dict())

    def test_runner_dispatches_gestures_and_repeats(self):
        selectors = [Selector("A", normalized=False, x=10, y=20), Selector("B", normalized=False, x=50, y=70)]
        steps = [Step("双击", "double_click", "A", delay=0), Step("长按", "long_press", "A", params={"duration": 2}, delay=0),
                 Step("右键", "right_click", "A", delay=0), Step("拖动", "drag", "A", "B", params={"duration": 1.5}, delay=0),
                 Step("滚动", "scroll", "B", params={"amount": -2}, delay=0), Step("文本", "text", params={"text": "测试"}, repeat=2, delay=0)]
        backend = FakeBackend()
        result = Runner(backend, Project("事件", selectors, steps), self.root, self.root / "reports").run(2)
        self.assertEqual(result["status"], "passed")
        self.assertEqual(len(result["steps"]), 14)
        self.assertIn(("click", (10, 20), {"count": 2, "interval": .12}), backend.calls)
        self.assertIn(("click", (10, 20), {"hold": 2}), backend.calls)
        self.assertIn(("drag", (10, 20), (50, 70), 1.5), backend.calls)
        self.assertIn(("scroll", (50, 70), -2, "vertical"), backend.calls)

    def test_failure_stops_later_inputs_and_saves_evidence(self):
        self.template()
        backend = FakeBackend(Image.new("RGB", (140, 100), "black"))
        project = Project("失败用例", [Selector("图片", kind="image", image="target.png")],
                          [Step("不存在", "assert_image", "图片", timeout=.1, delay=0), Step("不能输入", "text", params={"text": "bad"})])
        runner = Runner(backend, project, self.root, self.root / "reports")
        result = runner.run()
        self.assertEqual(result["status"], "failed")
        self.assertEqual(len(result["steps"]), 1)
        self.assertFalse(any(call[0] == "text" for call in backend.calls))
        self.assertTrue((runner.directory / result["steps"][0]["screenshot"]).is_file())
        self.assertTrue((runner.directory / "report.html").is_file())

    def test_absence_assertion_fails_if_image_present(self):
        frame = self.template()
        project = Project("消失断言", [Selector("图片", kind="image", image="target.png")], [Step("不应存在", "assert_absent", "图片", timeout=.1)])
        self.assertEqual(Runner(FakeBackend(frame), project, self.root, self.root / "reports").run()["status"], "failed")

    def test_invalid_references_and_params_rejected(self):
        with self.assertRaises(ValueError):
            Project("无引用", steps=[Step(target="不存在")]).validate()
        with self.assertRaises(ValueError):
            Project(selectors=[Selector("A")], steps=[Step(action="scroll", target="A", params={"amount": 1.5})]).validate()
        with self.assertRaises(ValueError):
            Project(selectors=[Selector("A"), Selector("A")]).validate()


if __name__ == "__main__":
    unittest.main()
