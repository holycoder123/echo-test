import unittest
from unittest.mock import patch
from echo_test import backend as native


class GenericWindowTests(unittest.TestCase):
    def test_discovery_lists_unrelated_apps_and_excludes_hidden_empty_and_own_windows(self):
        windows = {1: ('计算器', 201), 2: ('文档 - 记事本', 202), 3: ('', 203),
                   4: ('测试进程', 100), 5: ('EchoTest', 101), 6: ('隐藏应用', 206),
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
             patch.object(native.user32, 'IsIconic', return_value=False), \
             patch.object(native.user32, 'GetWindowThreadProcessId', side_effect=process), \
             patch.object(native.user32, 'GetClientRect', side_effect=rectangle), \
             patch.object(native.user32, 'EnumWindows', side_effect=enumerate_windows):
            self.assertEqual([window.title for window in native.list_game_windows()], ['计算器', '文档 - 记事本', '第二个文档'])
            self.assertEqual(names.call_count, 2)
            self.assertEqual([window.process_name for window in native.list_game_windows()], ['CalculatorApp.exe', 'notepad.exe', 'notepad.exe'])
            self.assertEqual([window.handle for window in native.list_game_windows(include_hidden=True)], [1, 2, 6, 9])

    def test_minimized_zero_size_window_remains_selectable_without_restoring_it(self):
        def enumerate_windows(callback, _):
            for handle in [1, 2, 3]:
                callback(handle, 0)
            return 1
        def process(handle, output):
            output._obj.value = 200 + handle
            return 1
        def rectangle(handle, output):
            output._obj.right = output._obj.bottom = 0
            return handle != 3
        with patch.object(native, 'process_executable_name', return_value='Client.exe'), \
             patch.object(native, 'window_title', return_value='应用主窗口'), \
             patch.object(native.user32, 'GetShellWindow', return_value=90), \
             patch.object(native.user32, 'GetDesktopWindow', return_value=91), \
             patch.object(native.user32, 'IsWindowVisible', return_value=True), \
             patch.object(native.user32, 'IsIconic', side_effect=lambda handle: handle in [1, 3]), \
             patch.object(native.user32, 'GetWindowThreadProcessId', side_effect=process), \
             patch.object(native.user32, 'GetClientRect', side_effect=rectangle), \
             patch.object(native.user32, 'EnumWindows', side_effect=enumerate_windows), \
             patch.object(native.user32, 'ShowWindow') as show:
            self.assertEqual([window.handle for window in native.list_game_windows()], [1, 3])
            show.assert_not_called()

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


class MinimizedConnectionTests(unittest.TestCase):
    def setUp(self):
        from echo_test import service
        self.service_module=service
        self.service=service.Service.__new__(service.Service)
        self.game=native.GameWindow(10,'最小化应用',201,'Client.exe')
        self.service.window=lambda handle:self.game
        self.minimized=True
        def rectangle(_handle, output):
            output._obj.right=0 if self.minimized else 1024
            output._obj.bottom=0 if self.minimized else 700
            return True
        def show(_handle, _mode):
            self.minimized=False
        self.enterContext(patch.object(native.user32,'GetClientRect',side_effect=rectangle))
        self.enterContext(patch.object(native.user32,'IsIconic',side_effect=lambda handle:self.minimized))
        self.enterContext(patch.object(native.user32,'ClientToScreen',return_value=False))
        self.show=self.enterContext(patch.object(native.user32,'ShowWindow',side_effect=show))

    def test_explicit_connection_restores_before_reading_size(self):
        data=self.service.call('game_info',{'handle':10,'restore':True})
        self.show.assert_called_once_with(10,9)
        self.assertEqual((data['width'],data['height']),(1024,700))

    def test_metadata_read_does_not_restore_or_focus_window(self):
        data=self.service.call('game_info',{'handle':10})
        self.show.assert_not_called()
        self.assertEqual((data['width'],data['height']),(0,0))

    def test_window_that_does_not_restore_returns_error_instead_of_zero_size_connection(self):
        self.show.side_effect=None
        with patch.object(self.service_module.time,'monotonic',side_effect=[0,2]):
            with self.assertRaisesRegex(RuntimeError,'尚未就绪'):
                self.service.call('game_info',{'handle':10,'restore':True})
