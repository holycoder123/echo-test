import unittest
from unittest.mock import patch
from echo_test import backend as native


class GenericWindowTests(unittest.TestCase):
    def test_discovery_lists_unrelated_apps_and_excludes_hidden_empty_and_own_windows(self):
        windows = {1: ('计算器', 201), 2: ('文档 - 记事本', 202), 3: ('', 203),
                   4: ('测试进程', 100), 5: ('echo test', 101), 6: ('隐藏应用', 206),
                   7: ('无客户区', 207), 8: ('无进程', 0), 90: ('桌面', 209), 91: ('系统外壳', 210)}
        def enumerate_windows(callback, _):
            for handle in windows:
                callback(handle, 0)
            return 1
        def process(handle, output):
            output._obj.value = windows[handle][1]
            return 1
        def rectangle(handle, output):
            output._obj.right = 0 if handle == 7 else 640
            output._obj.bottom = 480
            return 1
        with patch.dict(native.os.environ, {'ECHO_TEST_HOST_PID': '101'}), \
             patch.object(native.os, 'getpid', return_value=100), \
             patch.object(native, 'window_title', side_effect=lambda handle: windows[handle][0]), \
             patch.object(native.user32, 'GetShellWindow', return_value=91), \
             patch.object(native.user32, 'GetDesktopWindow', return_value=90), \
             patch.object(native.user32, 'IsWindowVisible', side_effect=lambda handle: handle != 6), \
             patch.object(native.user32, 'GetWindowThreadProcessId', side_effect=process), \
             patch.object(native.user32, 'GetClientRect', side_effect=rectangle), \
             patch.object(native.user32, 'EnumWindows', side_effect=enumerate_windows):
            self.assertEqual([window.title for window in native.list_game_windows()], ['计算器', '文档 - 记事本'])
            self.assertEqual([window.handle for window in native.list_game_windows(include_hidden=True)], [1, 2, 6])

    def test_window_validation_accepts_changed_title_and_still_rejects_pid_reuse(self):
        backend = native.WindowsBackend(native.GameWindow(10, '文档 - 记事本', 201))
        def process(_handle, output):
            output._obj.value = 201
        with patch.object(native.user32, 'IsWindow', return_value=True), \
             patch.object(native.user32, 'IsIconic', return_value=False), \
             patch.object(native.user32, 'GetWindowThreadProcessId', side_effect=process) as identity, \
             patch.object(native, 'window_title', return_value='已修改文档 - 记事本'):
            backend.check_window()
            identity.side_effect = lambda _handle, output: setattr(output._obj, 'value', 999)
            with self.assertRaisesRegex(RuntimeError, '进程已改变'):
                backend.check_window()
