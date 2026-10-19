import unittest
from unittest.mock import patch
from echo_test import backend as native


class FocusTests(unittest.TestCase):
    def setUp(self):
        self.backend = native.WindowsBackend(native.GameWindow(10, "目标应用", 1))

    def test_activation_waits_for_delayed_foreground_change(self):
        with patch.object(native, "elevation", return_value=False), \
             patch.object(native.user32, "IsWindow", return_value=True), \
             patch.object(native.user32, "ShowWindow"), \
             patch.object(native.user32, "SetForegroundWindow") as activate, \
             patch.object(native.user32, "GetForegroundWindow", side_effect=[20,20,10,10]), \
             patch.object(self.backend, "pause") as wait, \
             patch.object(self.backend, "check_foreground"):
            self.backend.activate()
            activate.assert_called_once_with(10)
            wait.assert_any_call(.05)

    def test_denied_activation_names_actual_foreground_window(self):
        with patch.object(native, "elevation", return_value=False), \
             patch.object(native.user32, "IsWindow", return_value=True), \
             patch.object(native.user32, "ShowWindow"), \
             patch.object(native.user32, "SetForegroundWindow", return_value=False), \
             patch.object(native.user32, "GetForegroundWindow", return_value=20), \
             patch.object(native, "window_title", return_value="echo test"), \
             patch.object(native.time, "monotonic", side_effect=[0,2]):
            with self.assertRaisesRegex(RuntimeError, "无法激活.*echo test"):
                self.backend.activate()

    def test_elevation_error_precedes_focus_error(self):
        with patch.object(native.user32, "IsWindow", return_value=True), \
             patch.object(native, "elevation", return_value=True), \
             patch.object(native, "is_admin", return_value=False), \
             patch.object(native.user32, "SetForegroundWindow") as activate:
            with self.assertRaisesRegex(RuntimeError, "管理员权限"):
                self.backend.activate()
            activate.assert_not_called()

    def test_focus_loss_during_execution_still_stops_input(self):
        with patch.object(self.backend, "check_window"), \
             patch.object(native.user32, "GetForegroundWindow", return_value=20), \
             patch.object(native, "window_title", return_value="其他窗口"):
            with self.assertRaisesRegex(RuntimeError, "失去焦点.*其他窗口"):
                self.backend.check_foreground()

    def test_read_only_capture_activation_does_not_require_input_elevation(self):
        with patch.object(native.user32, "IsWindow", return_value=True), \
             patch.object(native, "elevation") as elevation, \
             patch.object(native.user32, "ShowWindow"), \
             patch.object(native.user32, "GetForegroundWindow", return_value=10), \
             patch.object(self.backend, "pause"), \
             patch.object(self.backend, "check_foreground"):
            self.backend.activate(require_input=False)
            elevation.assert_not_called()


if __name__ == "__main__":
    unittest.main()
