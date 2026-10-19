import os
from pathlib import Path
import unittest
import tempfile
from PIL import Image


@unittest.skipUnless(os.name == "nt", "Windows GUI / backend")
class WindowsStudioTests(unittest.TestCase):
    def test_gui_loads_temporary_case_and_applies_low_code_form(self):
        from echo_test.ui import Studio
        from echo_test.models import Project, Selector, Step, save_project
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        directory = Path(temporary.name); filename = directory / 'form.echo.json'
        save_project(Project('表单验证', [Selector('按钮')], [Step(target='按钮'), Step(target='按钮')]), filename, directory)
        studio = Studio(filename)
        try:
            studio.withdraw()
            studio.update_idletasks()
            self.assertEqual(len(studio.project.steps), 2)
            studio.select_step(0)
            studio.step_action.set("长按")
            studio.build_parameters()
            studio.parameter_vars["duration"].set("1.75")
            studio.apply_step()
            self.assertEqual(studio.project.steps[0].action, "long_press")
            self.assertEqual(studio.project.steps[0].params["duration"], 1.75)
            studio.duplicate_step()
            self.assertEqual(len(studio.project.steps), 3)
            studio.move_step(-1)
            self.assertEqual(studio.selected_step, 0)
        finally:
            studio.destroy()

    def test_cancelled_capture_does_not_return_selection(self):
        import tkinter as tk
        from echo_test.ui import CapturePicker
        root = tk.Tk()
        root.withdraw()
        try:
            picker = CapturePicker(root, Image.new("RGB", (100, 100)), "coordinate")
            picker.result = (20, 30)
            picker.cancel()
            self.assertIsNone(picker.result)
        finally:
            root.destroy()

    def backend_with_fake_input(self):
        from echo_test.backend import WindowsBackend, GameWindow, Stopped
        backend = WindowsBackend(GameWindow(1, "目标应用", 1))
        events = []
        backend.move = lambda point: None
        backend.check_foreground = lambda: None
        backend._mouse = lambda flags, data=0: events.append(flags)
        backend._key = lambda code, up=False, unicode=False: events.append((code, up))
        def pause(seconds):
            if seconds > .1:
                raise Stopped("test stop")
        backend.pause = pause
        return backend, events

    def test_cancel_during_long_press_releases_mouse(self):
        from echo_test.backend import Stopped
        backend, events = self.backend_with_fake_input()
        with self.assertRaises(Stopped):
            backend.click((10, 20), hold=1)
        self.assertEqual(events, [2, 4])

    def test_failure_during_drag_releases_mouse(self):
        from echo_test.backend import Stopped
        backend, events = self.backend_with_fake_input()
        def fail_move(point):
            if point != (0, 0):
                raise Stopped("test stop")
        backend.move = fail_move
        with self.assertRaises(Stopped):
            backend.drag((0, 0), (100, 100), 1)
        self.assertEqual(events, [2, 4])

    def test_partial_key_chord_releases_pressed_keys(self):
        from echo_test.backend import Stopped
        backend, events = self.backend_with_fake_input()
        count = 0
        def pause(seconds):
            nonlocal count
            count += 1
            if count == 2:
                raise Stopped("test stop")
        backend.pause = pause
        with self.assertRaises(Stopped):
            backend.key("CTRL+A")
        self.assertEqual(events, [(0x11, False), (0x11, True)])


if __name__ == "__main__":
    unittest.main()
