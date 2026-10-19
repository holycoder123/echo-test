import unittest
from unittest.mock import patch
from echo_test import backend as native


class GenericWindowTests(unittest.TestCase):
    def test_discovery_lists_unrelated_apps_and_excludes_hidden_empty_and_own_windows(self):
        windows = {1: ('计算器', 201), 2: ('文档 - 记事本', 202), 3: ('', 203),
                   4: ('测试进程', 100), 5: ('echo test', 101), 6: ('隐藏应用', 206),
                   7: ('无客户区', 207), 8: ('无进程', 0), 9: ('第二个文档', 202), 90: ('桌面', 209), 91: ('系统外壳', 210)}
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
        with patch.object(native, 'process_executable_name', side_effect=lambda pid: {201:'CalculatorApp.exe',202:'notepad.exe',206:'hidden.exe'}.get(pid,'')) as names, \
             patch.dict(native.os.environ, {'ECHO_TEST_HOST_PID': '101'}), \
             patch.object(native.os, 'getpid', return_value=100), \
             patch.object(native, 'window_title', side_effect=lambda handle: windows[handle][0]), \
             patch.object(native.user32, 'GetShellWindow', return_value=91), \
             patch.object(native.user32, 'GetDesktopWindow', return_value=90), \
             patch.object(native.user32, 'IsWindowVisible', side_effect=lambda handle: handle != 6), \
             patch.object(native.user32, 'GetWindowThreadProcessId', side_effect=process), \
             patch.object(native.user32, 'GetClientRect', side_effect=rectangle), \
             patch.object(native.user32, 'EnumWindows', side_effect=enumerate_windows):
            self.assertEqual([window.title for window in native.list_game_windows()], ['计算器', '文档 - 记事本', '第二个文档'])
            self.assertEqual(names.call_count, 2)
            self.assertEqual([window.process_name for window in native.list_game_windows()], ['CalculatorApp.exe', 'notepad.exe', 'notepad.exe'])
            self.assertEqual([window.handle for window in native.list_game_windows(include_hidden=True)], [1, 2, 6, 9])

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


class ProcessNameTests(unittest.TestCase):
    def test_executable_name_does_not_expose_full_path_and_closes_process_handle(self):
        def query(_process, _flags, image, length):
            image.value = r'C:\Program Files\Editor\Editor.EXE'
            length._obj.value = len(image.value)
            return True
        with patch.object(native.kernel32, 'OpenProcess', return_value=1001) as opened, \
             patch.object(native.kernel32, 'QueryFullProcessImageNameW', side_effect=query), \
             patch.object(native.kernel32, 'CloseHandle') as closed:
            self.assertEqual(native.process_executable_name(201), 'Editor.EXE')
            opened.assert_called_once_with(0x1000, False, 201)
            closed.assert_called_once_with(1001)

    def test_inaccessible_process_has_empty_name_without_removing_window(self):
        with patch.object(native.kernel32, 'OpenProcess', return_value=0), \
             patch.object(native.kernel32, 'QueryFullProcessImageNameW') as query, \
             patch.object(native.kernel32, 'CloseHandle') as closed:
            self.assertEqual(native.process_executable_name(201), '')
            query.assert_not_called(); closed.assert_not_called()

    def test_failed_query_still_closes_handle(self):
        with patch.object(native.kernel32, 'OpenProcess', return_value=1001), \
             patch.object(native.kernel32, 'QueryFullProcessImageNameW', return_value=False), \
             patch.object(native.kernel32, 'CloseHandle') as closed:
            self.assertEqual(native.process_executable_name(201), '')
            closed.assert_called_once_with(1001)
