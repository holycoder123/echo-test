import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch

from echo_test.engine import Runner
from echo_test.models import Project, Step, Selector, save_project, load_project
from echo_test.scripting import read_script, validate_code
from echo_test import scripting
from test_studio import FakeBackend


class ScriptTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.backend = FakeBackend()
        self.backend.release_all = Mock()
        self.events = []
        self.processes = []
        real_popen = subprocess.Popen
        def spawn(*args, **kwargs):
            process = real_popen(*args, **kwargs)
            self.processes.append(process)
            return process
        self.enterContext(patch.object(scripting.subprocess, 'Popen', side_effect=spawn))

    def run_code(self, code, *, timeout=5, extra=None):
        steps = [Step('自定义检查', 'python', params={'code': code}, timeout=timeout, delay=0)]
        if extra:
            steps.extend(extra)
        self.runner = Runner(self.backend, Project('脚本验证', [Selector('按钮', normalized=False, x=10, y=20)], steps),
                             self.root, self.root/'reports', self.events.append)
        result = self.runner.run()
        self.assertTrue(all(process.poll() is not None for process in self.processes), '脚本进程应被回收')
        self.backend.release_all.assert_called_once()
        return result

    def test_real_child_executes_game_api_imports_and_saves_output(self):
        (self.root/'helper.py').write_text('VALUE = "中文模块"\n', encoding='utf-8')
        code = '''import os, sys
from helper import VALUE
print(VALUE, game.size())
print("错误流测试", file=sys.stderr)
sys.stdout.buffer.write("二进制输出\\n".encode("utf-8"))
assert game.locate("按钮") == (10, 20)
game.click("按钮")
game.key("ENTER")
game.text("测试文本")
image = game.capture()
assert image.size == game.size()
variables["pid"] = os.getpid()
variables["message"] = VALUE
print("末尾没有换行", end="")
'''
        result = self.run_code(code)
        self.assertEqual(result['status'], 'passed', result.get('error'))
        record = result['steps'][0]
        self.assertIn('中文模块 (200, 120)', record['output'])
        self.assertIn('错误流测试', record['output'])
        self.assertIn('二进制输出', record['output'])
        self.assertTrue(record['output'].endswith('末尾没有换行'))
        self.assertEqual((self.runner.directory/record['script']).read_text(encoding='utf-8'), code)
        self.assertEqual((self.runner.directory/record['output_file']).read_text(encoding='utf-8'), record['output'])
        self.assertIn(('click', (10, 20), {'count': 1, 'button': 'left', 'interval': .12, 'hold': 0}), self.backend.calls)
        self.assertIn(('key', 'ENTER'), self.backend.calls)
        self.assertNotEqual(self.runner.script_variables['pid'], os.getpid())
        self.assertTrue(list(self.runner.directory.glob('script_screen_*.png')))
        self.assertIn('脚本输出', (self.runner.directory/'report.html').read_text(encoding='utf-8'))

    def test_variables_flow_between_steps_repetitions_and_iterations(self):
        project = Project('变量', steps=[Step('计数', 'python', delay=0, repeat=2,
                           params={'code': 'variables["count"] = variables.get("count", 0) + 1'}),
                           Step('核对', 'python', delay=0, params={'code': 'print("计数", variables["count"])'})])
        runner = Runner(self.backend, project, self.root, self.root/'reports', self.events.append)
        self.assertEqual(runner.run(2)['status'], 'passed')
        self.assertEqual(runner.script_variables, {'count': 4})
        self.assertEqual(len(self.processes), 6)

    def test_exception_reports_source_line_and_skips_later_input(self):
        result = self.run_code('print("开始检查")\nassert False, "<错误>"\n', extra=[Step('不能输入', 'text', params={'text': 'bad'})])
        self.assertEqual(result['status'], 'failed')
        self.assertIn('line 2', result['error'])
        self.assertIn('AssertionError: <错误>', result['error'])
        self.assertEqual(len(result['steps']), 1)
        self.assertFalse(any(call[0] == 'text' for call in self.backend.calls))
        report = (self.runner.directory/'report.html').read_text(encoding='utf-8')
        self.assertIn('&lt;错误&gt;', report)

    def test_infinite_loop_times_out_and_process_is_terminated(self):
        started = time.monotonic()
        result = self.run_code('while True:\n    pass\n', timeout=.3)
        self.assertEqual(result['status'], 'failed')
        self.assertIn('超过 0.3 秒', result['error'])
        self.assertLess(time.monotonic()-started, 2)

    def test_stop_interrupts_python_sleep_without_game_rpc(self):
        timer = threading.Timer(.2, lambda: setattr(self.backend, 'stopped', True))
        timer.start(); self.addCleanup(timer.cancel)
        started = time.monotonic()
        result = self.run_code('import time\ntime.sleep(100)\n')
        self.assertEqual(result['status'], 'stopped')
        self.assertLess(time.monotonic()-started, 2)

    def test_stop_cannot_be_swallowed_by_script_game_error_handler(self):
        self.backend.key = Mock(side_effect=lambda _: setattr(self.backend, 'stopped', True))
        result = self.run_code('try:\n    game.key("ENTER")\nexcept Exception:\n    print("忽略错误")\n')
        self.assertEqual(result['status'], 'stopped')
        self.assertNotIn('忽略错误', result['steps'][0].get('output', ''))

    def test_excessive_output_is_bounded_and_execution_continues(self):
        result = self.run_code('print("x" * 600000)\nvariables["finished"] = True\n')
        self.assertEqual(result['status'], 'passed', result.get('error'))
        record = result['steps'][0]
        self.assertTrue(record['output_truncated'])
        self.assertLessEqual((self.runner.directory/record['output_file']).stat().st_size, 256*1024+200)
        self.assertLessEqual(len(record['output']), 16000)
        self.assertEqual(self.runner.script_variables, {'finished': True})

    def test_abrupt_process_exit_is_failure(self):
        result = self.run_code('import os\nos._exit(7)\n')
        self.assertEqual(result['status'], 'failed')
        self.assertIn('进程意外退出', result['error'])

    def test_timeout_cleans_up_script_spawned_children(self):
        code = '''import subprocess, sys, time
child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(100)"], creationflags=subprocess.CREATE_NO_WINDOW)
(report_dir / "child.pid").write_text(str(child.pid), encoding="utf-8")
time.sleep(100)
'''
        result = self.run_code(code, timeout=.5)
        self.assertEqual(result['status'], 'failed')
        pid = int((self.runner.directory/'child.pid').read_text(encoding='utf-8'))
        import ctypes as ct
        from ctypes import wintypes as wt
        kernel = ct.WinDLL('kernel32', use_last_error=True)
        kernel.OpenProcess.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
        kernel.OpenProcess.restype = wt.HANDLE
        kernel.WaitForSingleObject.argtypes = [wt.HANDLE, wt.DWORD]
        kernel.CloseHandle.argtypes = [wt.HANDLE]
        handle = kernel.OpenProcess(0x100000, False, pid)
        if handle:
            try:
                self.assertEqual(kernel.WaitForSingleObject(handle, 1000), 0, '脚本的子进程应一起停止')
            finally:
                kernel.CloseHandle(handle)

    def test_invalid_game_target_does_not_send_input(self):
        result = self.run_code('game.click((-1, 20))\n')
        self.assertEqual(result['status'], 'failed')
        self.assertFalse(any(call[0] == 'click' for call in self.backend.calls))

    def test_non_json_variables_fail_with_clear_message(self):
        result = self.run_code('variables["path"] = case_dir\n')
        self.assertEqual(result['status'], 'failed')
        self.assertIn('JSON', result['error'])

    def test_imported_source_is_portable_when_original_is_removed(self):
        original = self.root/'导入.py'
        original.write_text('print("导入成功")\n', encoding='utf-8-sig')
        imported = read_script(original)
        project = Project('导入', steps=[Step(imported['name'], 'python', params={'code': imported['code']}, delay=0)])
        destination = self.root/'portable'/'case.echo.json'
        save_project(project, destination, self.root)
        original.unlink()
        loaded = load_project(destination)
        runner = Runner(self.backend, loaded, destination.parent, self.root/'reports')
        result = runner.run()
        self.assertEqual(result['status'], 'passed', result.get('error'))
        self.assertIn('导入成功', result['steps'][0]['output'])

    def test_script_validation_and_import_do_not_execute_source(self):
        for code in ['', 'for:', 'print("x")\x00', 'x'* (256*1024+1)]:
            with self.assertRaises(ValueError):
                validate_code(code)
        source = self.root/'安全导入.py'
        source.write_text('raise RuntimeError("只导入不执行")', encoding='utf-8')
        self.assertEqual(read_script(source)['name'], '安全导入')
        source.write_bytes('print("中文")'.encode('utf-16'))
        with self.assertRaisesRegex(ValueError, 'UTF-8'):
            read_script(source)
        with self.assertRaisesRegex(ValueError, '第 1 行'):
            Project(steps=[Step(action='python', params={'code': 'for:'})]).validate()

    def test_backend_game_errors_can_be_handled_by_python(self):
        result = self.run_code('try:\n    game.locate("不存在")\nexcept RuntimeError as error:\n    print("已处理", error)\n')
        self.assertEqual(result['status'], 'passed')
        self.assertIn('控件不存在', result['steps'][0]['output'])


if __name__ == '__main__':
    unittest.main()
