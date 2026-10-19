import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('installer_guard', Path(__file__).resolve().parents[1]/'scripts'/'installer-guard.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class InstallerGuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root/'.runtime').mkdir()

    def state(self):
        (self.root/'.runtime'/'workbench-state.json').write_text(json.dumps({'host_pid':123}),encoding='utf-8')

    def kernel(self, image):
        kernel = Mock()
        kernel.OpenProcess.return_value = 100
        def query(handle, flags, output, length):
            output.value = str(image)
            return True
        kernel.QueryFullProcessImageNameW.side_effect = query
        return kernel

    def test_no_workbench_state_allows_installation(self):
        self.assertEqual(guard.check(self.root),0)

    def test_same_installation_running_is_blocked_without_closing_it(self):
        self.state()
        kernel = self.kernel(self.root/'node_modules'/'electron'/'dist'/'electron.exe')
        with patch.object(guard.ct,'WinDLL',return_value=kernel):
            self.assertEqual(guard.check(self.root),1)
        kernel.CloseHandle.assert_called_once_with(100)

    def test_reused_pid_for_another_program_is_not_blocked(self):
        self.state()
        kernel = self.kernel(self.root/'another-program.exe')
        with patch.object(guard.ct,'WinDLL',return_value=kernel):
            self.assertEqual(guard.check(self.root),0)

    def test_running_legacy_embedded_workbench_still_blocks_installation(self):
        (self.root/'.runtime'/'embed-recovery.json').write_text(json.dumps({'host_pid':123}),encoding='utf-8')
        kernel = self.kernel(self.root/'node_modules'/'electron'/'dist'/'electron.exe')
        with patch.object(guard.ct,'WinDLL',return_value=kernel):
            self.assertEqual(guard.check(self.root),1)
        kernel.CloseHandle.assert_called_once_with(100)

    def test_access_denied_requires_user_to_close_the_workbench(self):
        self.state()
        kernel = Mock()
        kernel.OpenProcess.return_value = None
        with patch.object(guard.ct,'WinDLL',return_value=kernel), patch.object(guard.ct,'get_last_error',return_value=5):
            self.assertEqual(guard.check(self.root),2)
