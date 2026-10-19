from pathlib import Path
import tempfile
import unittest
from nycs_studio.models import Project, Step, Selector, load_project, save_project
from nycs_studio.recording import convert_events
from nycs_studio.engine import Runner
from test_studio import FakeBackend


def mouse(event, t, x=.3, y=.4, button="left", **extra):
    return {"kind": "mouse", "event": event, "t": t, "x": x, "y": y, "button": button, **extra}


class RecordingTests(unittest.TestCase):
    def test_two_clicks_become_double_click_with_one_selector(self):
        project = convert_events([mouse("down", 0), mouse("up", .05), mouse("down", .15), mouse("up", .20)])
        self.assertEqual(len(project.selectors), 1)
        self.assertEqual(len(project.steps), 1)
        self.assertEqual(project.steps[0].action, "double_click")
        self.assertAlmostEqual(project.steps[0].params["interval"], .1)

    def test_long_press_and_right_click_classified(self):
        project = convert_events([mouse("down", 0), mouse("up", 1.2), mouse("down", 2, button="right"), mouse("up", 2.1, button="right")])
        self.assertEqual([step.action for step in project.steps], ["long_press", "right_click"])
        self.assertAlmostEqual(project.steps[0].params["duration"], 1.2)
        self.assertAlmostEqual(project.steps[0].delay, .8)

    def test_drag_keeps_path_and_endpoint(self):
        project = convert_events([mouse("down", 0), mouse("move", .2, .4, .5), mouse("move", .4, .5, .6), mouse("up", .6, .6, .7)])
        step = project.steps[0]
        self.assertEqual(step.action, "drag")
        self.assertEqual(len(project.selectors), 2)
        self.assertEqual(step.params["path"][0], [.3, .4])
        self.assertEqual(step.params["path"][-1], [.6, .7])

    def test_wheel_ticks_merge_but_not_opposite_direction(self):
        project = convert_events([mouse("wheel", 0, amount=-1), mouse("wheel", .05, amount=-2), mouse("wheel", .1, amount=1)])
        self.assertEqual([step.params["amount"] for step in project.steps], [-3, 1])

    def test_held_key_spans_mouse_action(self):
        events = [{"kind": "key", "event": "down", "t": 0, "vk": 87}, mouse("down", .3), mouse("up", .4), {"kind": "key", "event": "up", "t": 1, "vk": 87}]
        project = convert_events(events)
        self.assertEqual([step.action for step in project.steps], ["key_down", "click", "key_up"])
        self.assertEqual(project.steps[0].params["keys"], "W")

    def test_repeat_keydown_filtered_and_unreleased_key_balanced(self):
        project = convert_events([{"kind":"key","event":"down","t":0,"vk":65}, {"kind":"key","event":"down","t":.1,"vk":65}])
        self.assertEqual([step.action for step in project.steps], ["key_down", "key_up"])

    def test_f12_and_windows_keys_are_not_replayed(self):
        project = convert_events([{"kind":"key","event":"down","t":0,"vk":vk} for vk in [91,92,123]])
        self.assertEqual(project.steps, [])

    def test_incomplete_mouse_press_is_not_converted_to_click(self):
        project = convert_events([mouse("down", 0)])
        self.assertFalse(project.steps)

    def test_recorded_project_roundtrips_as_existing_json_format(self):
        project = convert_events([mouse("down", 0), mouse("up", .1)])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/"recorded.nycs.json"
            save_project(project, path, Path(directory))
            self.assertEqual(load_project(path).to_dict(), project.to_dict())

    def test_runner_releases_held_keys_after_failure(self):
        class Backend(FakeBackend):
            def key_down(self, keys):
                self.calls.append(("down", keys))
            def text(self, text):
                raise ValueError("failure")
            def release_all(self):
                self.calls.append(("release",))
        backend = Backend()
        project = Project("释放", steps=[Step(action="key_down", params={"keys":"W"}), Step(action="text", params={"text":"a"})])
        with tempfile.TemporaryDirectory() as directory:
            result = Runner(backend, project, Path(directory), Path(directory)).run()
            self.assertEqual(result["status"], "failed")
        self.assertEqual(backend.calls[-1], ("release",))


if __name__ == "__main__":
    unittest.main()
