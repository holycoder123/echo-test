import ctypes as ct
from ctypes import wintypes as wt
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from nycs_studio.mcp_startup import (
    MAX_STATE_BYTES, McpStartupError, check_mcp_startup, wait_for_mcp,
)


class McpStartupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.runtime = self.root / ".runtime"
        self.runtime.mkdir()
        self.user32, self.kernel32 = Mock(), Mock()
        self.user32.IsWindow.return_value = True
        self.user32.GetWindowThreadProcessId.side_effect = self.window_pid
        self.user32.GetWindowTextW.side_effect = self.window_title
        self.kernel32.OpenProcess.return_value = 101
        self.kernel32.QueryFullProcessImageNameW.side_effect = self.process_path
        self.clock = 0.0

    @staticmethod
    def window_pid(_handle, pointer):
        ct.cast(pointer, ct.POINTER(wt.DWORD))[0] = 88
        return 1

    @staticmethod
    def window_title(_handle, output, _length):
        output.value = "诺亚测试工作台"
        return len(output.value)

    def process_path(self, _handle, _flags, output, _length):
        output.value = str(self.root / "node_modules" / "electron" / "dist" / "electron.exe")
        return True

    def snapshot(self, *, host=22, pid=88, legacy=False):
        filename = self.root / ".workbench-state.json" if legacy else self.runtime / "workbench-state.json"
        filename.write_text(json.dumps({"host": host, "host_pid": pid}), encoding="utf-8")

    def descriptor(self, **updates):
        value = {"pid": 88, "root": str(self.root), "url": "http://127.0.0.1:45678/mcp",
                 "token": "a" * 64, "version": "1.0.0"}
        value.update(updates)
        (self.runtime / "mcp-connection.json").write_text(json.dumps(value), encoding="utf-8")

    def check(self):
        return check_mcp_startup(self.root, user32=self.user32, kernel32=self.kernel32)

    def assert_read_only(self):
        self.assertTrue(set(call[0] for call in self.user32.mock_calls) <= {
            "IsWindow", "GetWindowThreadProcessId", "GetWindowTextW"})
        self.assertTrue(set(call[0] for call in self.kernel32.mock_calls) <= {
            "OpenProcess", "QueryFullProcessImageNameW", "CloseHandle"})

    def test_no_snapshot_allows_a_new_start_without_native_calls(self):
        self.assertEqual(self.check(), {"already_enabled": False})
        self.assertEqual(self.user32.mock_calls, [])
        self.assertEqual(self.kernel32.mock_calls, [])

    def test_live_old_main_window_refuses_silent_singleton_reuse(self):
        self.snapshot()
        with self.assertRaisesRegex(McpStartupError, "主窗口.*不是.*工具栏") as raised:
            self.check()
        self.assertIn("保存", str(raised.exception))
        self.assertIn("停止录制或执行", str(raised.exception))
        self.assert_read_only()
        self.kernel32.CloseHandle.assert_called_once_with(101)

    def test_access_denied_is_not_a_closed_administrator_instance(self):
        self.snapshot()
        self.kernel32.OpenProcess.return_value = 0
        with self.assertRaisesRegex(McpStartupError, "未启用 MCP"):
            self.check()
        self.kernel32.QueryFullProcessImageNameW.assert_not_called()
        self.assert_read_only()

    def test_failed_process_path_query_still_preserves_live_instance(self):
        self.snapshot()
        self.kernel32.QueryFullProcessImageNameW.return_value = False
        self.kernel32.QueryFullProcessImageNameW.side_effect = None
        with self.assertRaisesRegex(McpStartupError, "未启用 MCP"):
            self.check()
        self.assert_read_only()

    def test_valid_enabled_instance_can_be_reused_without_returning_token(self):
        self.snapshot()
        self.descriptor()
        self.kernel32.OpenProcess.return_value = 0
        self.assertEqual(self.check(), {"already_enabled": True, "pid": 88})
        self.assert_read_only()

    def test_closed_stale_window_does_not_block_a_new_start(self):
        self.snapshot()
        self.user32.IsWindow.return_value = False
        self.assertEqual(self.check(), {"already_enabled": False})
        self.user32.GetWindowThreadProcessId.assert_not_called()

    def test_reused_handle_with_different_pid_is_not_the_old_instance(self):
        self.snapshot(pid=77)
        self.assertEqual(self.check(), {"already_enabled": False})
        self.user32.GetWindowTextW.assert_not_called()

    def test_toolbar_cannot_pass_as_the_main_window(self):
        self.snapshot()
        self.user32.GetWindowTextW.side_effect = lambda _h, output, _n: setattr(output, "value", "诺亚游戏工具栏") or 7
        with self.assertRaisesRegex(McpStartupError, "主窗口身份"):
            self.check()

    def test_process_from_another_project_is_not_reused(self):
        self.snapshot()
        self.kernel32.QueryFullProcessImageNameW.side_effect = lambda _h, _f, output, _n: setattr(output, "value", str(self.root / "other" / "electron.exe")) or True
        with self.assertRaisesRegex(McpStartupError, "进程身份已变化"):
            self.check()
        self.kernel32.CloseHandle.assert_called_once_with(101)

    def test_mismatched_or_untrusted_descriptor_is_rejected_without_secrets(self):
        self.snapshot()
        for updates in ({"pid": 99}, {"root": str(self.root.parent)},
                        {"url": "http://localhost:45678/mcp"},
                        {"url": "http://127.0.0.1:65536/mcp"},
                        {"url": "http://127.0.0.1:45678/mcp?extra=1"},
                        {"token": "secret-value"}, {"version": ""}):
            with self.subTest(updates=tuple(updates)):
                self.descriptor(**updates)
                with self.assertRaises(McpStartupError) as raised:
                    self.check()
                self.assertNotIn("secret-value", str(raised.exception))
                self.assertNotIn("a" * 64, str(raised.exception))

    def test_oversize_snapshot_is_bounded_and_rejected(self):
        (self.runtime / "workbench-state.json").write_text("x" * (MAX_STATE_BYTES + 1))
        with self.assertRaisesRegex(McpStartupError, "过大"):
            self.check()
        self.assertEqual(self.user32.mock_calls, [])

    def test_legacy_snapshot_is_checked_too(self):
        self.snapshot(legacy=True)
        with self.assertRaisesRegex(McpStartupError, "未启用 MCP"):
            self.check()

    def test_wait_observes_the_new_matching_descriptor(self):
        self.snapshot()
        pauses = []

        def sleep(seconds):
            pauses.append(seconds)
            self.clock += seconds
            if self.clock >= .2:
                self.descriptor()

        result = wait_for_mcp(self.root, timeout=1, interval=.1,
            user32=self.user32, kernel32=self.kernel32,
            monotonic=lambda: self.clock, sleep=sleep)
        self.assertEqual(result, {"already_enabled": True, "pid": 88})
        self.assertEqual(pauses, [.1, .1])
        self.assert_read_only()

    def test_wait_has_an_upper_bound_and_concrete_error(self):
        self.snapshot()

        def sleep(seconds):
            self.clock += seconds

        with self.assertRaises(McpStartupError) as raised:
            wait_for_mcp(self.root, timeout=.3, interval=.1,
                user32=self.user32, kernel32=self.kernel32,
                monotonic=lambda: self.clock, sleep=sleep)
        self.assertAlmostEqual(self.clock, .3)
        self.assertIn("mcp-connection.json", str(raised.exception))
        self.assertIn("主窗口", str(raised.exception))
        self.assert_read_only()

    def test_wait_does_not_accept_descriptor_without_its_live_main_window(self):
        self.snapshot()
        self.descriptor()
        self.user32.IsWindow.return_value = False
        with self.assertRaises(McpStartupError):
            wait_for_mcp(self.root, timeout=.1, interval=.1,
                user32=self.user32, kernel32=self.kernel32,
                monotonic=lambda: self.clock, sleep=lambda seconds: setattr(self, "clock", self.clock + seconds))

    def test_launcher_preflight_runs_before_any_elevation_request(self):
        import app
        with patch("sys.argv", ["app.py", "--admin", "--mcp"]), \
             patch("nycs_studio.mcp_startup.check_mcp_startup", side_effect=McpStartupError("旧主窗口")), \
             patch.object(ct.windll.shell32, "ShellExecuteW") as launch:
            with self.assertRaisesRegex(McpStartupError, "旧主窗口"):
                app.main()
            launch.assert_not_called()

    def test_already_elevated_launcher_enables_mcp_and_waits_for_readiness(self):
        import app
        with patch('sys.argv',['app.py']), patch('nycs_studio.mcp_startup.check_mcp_startup',return_value={'already_enabled':False}) as preflight, \
             patch('nycs_studio.mcp_startup.wait_for_mcp') as ready, patch('nycs_studio.backend.is_admin',return_value=True), patch('subprocess.Popen') as launch:
            self.assertEqual(app.main(),0)
            self.assertIn('--enable-mcp',launch.call_args.args[0])
            preflight.assert_called_once();ready.assert_called_once()

    def test_no_mcp_launch_does_not_wait_for_an_endpoint(self):
        import app
        with patch('sys.argv',['app.py','--no-mcp']), patch('nycs_studio.mcp_startup.check_mcp_startup') as preflight, \
             patch('nycs_studio.mcp_startup.wait_for_mcp') as ready, patch('nycs_studio.backend.is_admin',return_value=True), patch('subprocess.Popen') as launch:
            self.assertEqual(app.main(),0)
            self.assertIn('--disable-mcp',launch.call_args.args[0])
            preflight.assert_not_called();ready.assert_not_called()

    def test_admin_start_cannot_reuse_a_non_elevated_mcp_instance(self):
        import app
        with patch('sys.argv',['app.py','--admin']), patch('nycs_studio.mcp_startup.check_mcp_startup',return_value={'already_enabled':True,'pid':88}), \
             patch('nycs_studio.backend.elevation',return_value=False), patch.object(ct.windll.shell32,'ShellExecuteW') as launch:
            with self.assertRaisesRegex(McpStartupError,'管理员权限'):
                app.main()
            launch.assert_not_called()

    def test_default_launcher_requests_elevation_and_keeps_case_and_mcp_parameters(self):
        import app
        case=Path('test_cases')/'example test.nycs.json'
        with patch('sys.argv',['app.py','--case',str(case)]), \
             patch('nycs_studio.mcp_startup.check_mcp_startup',return_value={'already_enabled':False}), \
             patch('nycs_studio.mcp_startup.wait_for_mcp') as ready, \
             patch('nycs_studio.backend.is_admin',return_value=False), \
             patch.object(ct.windll.shell32,'ShellExecuteW',return_value=42) as launch, \
             patch('subprocess.Popen') as ordinary:
            self.assertEqual(app.main(),0)
            self.assertEqual(launch.call_args.args[1],'runas')
            self.assertIn('--enable-mcp',launch.call_args.args[3])
            self.assertIn(str(case.resolve()),launch.call_args.args[3])
            ordinary.assert_not_called();ready.assert_called_once()

    def test_no_mcp_default_still_requests_administrator_permission(self):
        import app
        with patch('sys.argv',['app.py','--no-mcp']), \
             patch('nycs_studio.backend.is_admin',return_value=False), \
             patch.object(ct.windll.shell32,'ShellExecuteW',return_value=42) as launch, \
             patch('nycs_studio.mcp_startup.wait_for_mcp') as ready:
            self.assertEqual(app.main(),0)
            self.assertIn('--disable-mcp',launch.call_args.args[3]);ready.assert_not_called()

    def test_cancelled_default_permission_request_never_launches_an_ordinary_workbench(self):
        import app
        with patch('sys.argv',['app.py','--no-mcp']), \
             patch('nycs_studio.backend.is_admin',return_value=False), \
             patch.object(ct.windll.shell32,'ShellExecuteW',return_value=5), \
             patch('subprocess.Popen') as ordinary, \
             patch('nycs_studio.mcp_startup.wait_for_mcp') as ready:
            with self.assertRaisesRegex(app.StartupPermissionError,'未启动'):app.main()
            ordinary.assert_not_called();ready.assert_not_called()

    def test_explicit_no_admin_is_forwarded_to_electron_without_uac(self):
        import app
        with patch('sys.argv',['app.py','--no-admin','--no-mcp']), \
             patch('nycs_studio.backend.is_admin',return_value=False), \
             patch.object(ct.windll.shell32,'ShellExecuteW') as elevated, \
             patch('subprocess.Popen') as launch:
            self.assertEqual(app.main(),0)
            self.assertIn('--no-admin',launch.call_args.args[0]);elevated.assert_not_called()

    def test_default_start_cannot_reuse_a_non_elevated_mcp_instance(self):
        import app
        with patch('sys.argv',['app.py']), \
             patch('nycs_studio.mcp_startup.check_mcp_startup',return_value={'already_enabled':True,'pid':88}), \
             patch('nycs_studio.backend.elevation',return_value=False), \
             patch.object(ct.windll.shell32,'ShellExecuteW') as launch:
            with self.assertRaisesRegex(McpStartupError,'管理员权限'):app.main()
            launch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
