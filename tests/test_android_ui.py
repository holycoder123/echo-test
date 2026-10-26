import tempfile
import time
import unittest
from dataclasses import asdict
from pathlib import Path
from unittest.mock import Mock, patch

from echo_test.android import AndroidBackend, AndroidStopped
from echo_test.android_service import AndroidService
from echo_test.android_ui import parse_hierarchy, locate, selector_for, validate_query
from echo_test.codegen import generate_python
from echo_test.control_library import ControlLibrary
from echo_test.engine import Runner
from echo_test.models import Project, Selector, Step
from echo_test.scripting import game_call
from echo_test.service import Service


def xml(rotation=0, duplicate=False):
    node = '<node resource-id="app:id/login" text="登录" content-desc="登录按钮" class="android.widget.Button" package="app" clickable="true" enabled="true" bounds="[10,20][90,60]"/>'
    return (f'<hierarchy rotation="{rotation}"><node class="android.widget.FrameLayout" package="app" bounds="[0,0][120,240]">'+node+(node if duplicate else '')+'</node></hierarchy>').encode()


def native_selector():
    return Selector('登录', kind='android_ui', ui={'resource_id':'app:id/login'})


class AndroidUiTreeTests(unittest.TestCase):
    def test_tree_parent_geometry_rotation_and_clipped_nodes(self):
        tree = parse_hierarchy(xml(), (120,240))
        self.assertEqual(tree['nodes'][1]['parent'], 0)
        self.assertEqual(tree['nodes'][1]['bounds'], [10,20,80,40])
        self.assertTrue(tree['nodes'][1]['clickable'])
        self.assertEqual(parse_hierarchy(xml(1), (120,240))['height'], 120)
        clipped = parse_hierarchy(b'<hierarchy><node text="x" bounds="[-2,-3][10,20]"/><node text="x" bounds="[900,0][910,20]"/></hierarchy>', (120,240))
        self.assertEqual(clipped['nodes'][0]['bounds'], [0,0,10,20])
        self.assertFalse(clipped['nodes'][1]['visible'])
        self.assertEqual(locate(clipped, {'text':'x'})[1], 1)

    def test_rejects_entities_malformed_and_oversized_or_deep_trees(self):
        for data in [b'', b'garbage', b'<!DOCTYPE hierarchy [<!ENTITY a "x">]><hierarchy/>',
                     '<!DOCTYPE hierarchy><hierarchy/>'.encode('utf-16'), b'<hierarchy rotation="8"/>',
                     b'<hierarchy><node bounds="bad"/></hierarchy>', b'x'*(8*1024*1024+1),
                     b'<hierarchy>'+b'<node bounds="[0,0][1,1]">'*130+b'</node>'*130+b'</hierarchy>',
                     b'<hierarchy>'+b'<node bounds="[0,0][1,1]"/>'*5001+b'</hierarchy>']:
            with self.subTest(size=len(data)), self.assertRaises(ValueError):
                parse_hierarchy(data, (120,240))

    def test_exact_conditions_ambiguity_and_explicit_one_based_index(self):
        tree = parse_hierarchy(xml(duplicate=True), (120,240))
        with self.assertRaisesRegex(ValueError, '2 个'):
            locate(tree, {'text':'登录'})
        self.assertEqual(locate(tree, {'text':'登录','enabled':True,'clickable':True,'index':2})[0]['id'], 2)
        self.assertIsNone(locate(tree, {'text':'登'})[0])
        self.assertIsNone(locate(tree, {'text':'登录','index':3})[0])
        query = selector_for(tree, 2)
        self.assertEqual(query['index'], 2)
        self.assertEqual(locate(tree, query)[0]['id'], 2)
        unique = selector_for(parse_hierarchy(xml(), (120,240)), 1)
        self.assertEqual(unique, {'package':'app','resource_id':'app:id/login'})

    def test_query_validation_and_portable_control_library(self):
        for query in [{}, {'index':1}, {'text':'x','index':0}, {'text':'x','index':True}, {'text':'x','enabled':1},
                      {'text':'x','xpath':'//*'}, {'text':'x'*4097}]:
            with self.subTest(query=str(query)[:80]), self.assertRaises(ValueError):
                validate_query(query)
        with tempfile.TemporaryDirectory() as folder:
            bank = ControlLibrary(folder)
            saved = bank.save(asdict(native_selector()))['control']
            self.assertEqual(saved['selector']['ui'], native_selector().ui)
            self.assertEqual(ControlLibrary(folder).list('app:id/login')['entries'][0]['id'], saved['id'])
            selector = Selector(**saved['selector'])
            self.assertEqual(selector.asset_paths(), [])


class AndroidUiBackendTests(unittest.TestCase):
    def backend(self, error=None):
        adb = Mock()
        def run(args, **kwargs):
            if args[:2] == ['shell','uiautomator']:
                if error:
                    raise error
                return 'UI hierchary dumped to: '+args[-1]
            if args[:2] == ['exec-out','cat']:
                return xml()
            if args == ['shell','wm','size']:
                return 'Physical size: 120x240'
            return ''
        adb.run.side_effect = run
        return AndroidBackend(adb, 'phone')

    def test_dump_is_bound_to_serial_and_cleans_unique_remote_file(self):
        backend = self.backend()
        self.assertEqual(backend.find_ui(native_selector()), (50,40))
        calls = backend.adb.run.call_args_list
        remote = calls[0].args[0][-1]
        self.assertRegex(remote, r'^/data/local/tmp/echotest-ui-[a-f0-9]{32}\.xml$')
        self.assertEqual(calls[-1].args[0], ['shell','rm','-f',remote])
        self.assertTrue(all(c.kwargs['serial']=='phone' for c in calls))
        self.assertEqual(backend.last_ui_diagnostic['candidate']['box'], [10,20,80,40])
        self.assertFalse(any('screencap' in c.args[0] for c in calls))

    def test_failure_and_stop_are_never_mistaken_for_an_absent_node(self):
        for error in [TimeoutError('timeout'), AndroidStopped('stop'), RuntimeError('offline')]:
            backend = self.backend(error)
            with self.subTest(error=error), self.assertRaises(type(error)):
                backend.find_ui(native_selector())
            self.assertEqual(backend.adb.run.call_args_list[-1].args[0][:3], ['shell','rm','-f'])

    def test_click_rechecks_orientation_after_native_location(self):
        backend = self.backend()
        point = backend.find_ui(native_selector())
        def rotated_capture():
            backend._size = (240,120)
        backend.capture = rotated_capture
        with self.assertRaisesRegex(ValueError, '方向'):
            backend.click(point)
        self.assertFalse(any('input' in c.args[0] for c in backend.adb.run.call_args_list))

    def test_snapshot_rpc_rejects_stale_or_other_device_selection(self):
        service = AndroidService(Mock(), '.')
        service.connection = {'serial':'phone'}
        backend = self.backend()
        with patch.object(service, 'backend', return_value=backend):
            snapshot = service.call('android_hierarchy', {'target':{'serial':'phone'}})
            result = service.call('android_ui_pick', {'target':{'serial':'phone'},'snapshot_id':snapshot['id'],'node_id':1})
            self.assertEqual(result['ui']['resource_id'], 'app:id/login')
            for changes in [{'snapshot_id':'old'}, {'node_id':True}, {'node_id':99}]:
                with self.subTest(changes=changes), self.assertRaises(ValueError):
                    service.call('android_ui_pick', {'snapshot_id':snapshot['id'],'node_id':1,**changes})
        with self.assertRaisesRegex(ValueError, '已变化'):
            service.backend({'serial':'other'})


class AndroidUiRunnerTests(unittest.TestCase):
    def runner(self, folder, found=(50,40), steps=None):
        backend = Mock(spec=AndroidBackend)
        backend.find_ui.return_value = found
        backend.last_ui_diagnostic = {'method':'android_ui','matched':found is not None,'count':int(found is not None),'reason':'test'}
        backend.cancelled.return_value = False
        project = Project('native', selectors=[native_selector()], steps=steps or [])
        return Runner(backend, project, Path(folder), Path(folder), persist_reports=False)

    def test_native_click_wait_assert_codegen_and_script_use_fresh_tree(self):
        with tempfile.TemporaryDirectory() as folder:
            steps = [Step(action=a, target='登录', delay=0) for a in ['click','wait_ui','assert_ui']]
            runner = self.runner(folder, steps=steps)
            result = runner.run()
            self.assertEqual(result['status'], 'passed', result)
            self.assertEqual(runner.backend.find_ui.call_count, 3)
            runner.backend.click.assert_called_once_with((50,40))
            runner.backend.capture.assert_not_called()
            for method in ['locate','wait_ui','assert_ui']:
                self.assertEqual(game_call(runner, method, {'target':'登录','timeout':5}, time.monotonic()+10), (50,40))
            code = generate_python(runner.project)
            self.assertIn('window.wait_ui(', code)
            self.assertIn('window.assert_ui(', code)
            self.assertIn('window.click(', code)
            compile(code, '<generated>', 'exec')

    def test_absence_waits_for_disappearance_and_read_error_is_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            runner = self.runner(folder, found=None)
            runner.backend.find_ui.side_effect = [(50,40), None]
            runner.execute(Step(action='assert_ui_absent', target='登录'))
            self.assertEqual(runner.backend.find_ui.call_count, 2)
            runner.backend.find_ui.side_effect = TimeoutError('dump timeout')
            with self.assertRaisesRegex(TimeoutError, 'dump timeout'):
                game_call(runner, 'assert_ui_absent', {'target':'登录'}, time.monotonic()+10)
            runner.backend.click.assert_not_called()

    def test_no_windows_activation_or_capture_for_native_controls(self):
        with tempfile.TemporaryDirectory() as folder:
            backend = Mock(spec=['activate','capture','pause','cancelled','release_all'])
            backend.cancelled.return_value = False
            runner = Runner(backend, Project('native', selectors=[native_selector()], steps=[Step(target='登录')]), Path(folder), Path(folder), persist_reports=False)
            result = runner.run()
            self.assertEqual(result['status'], 'failed')
            self.assertIn('安卓 UI', result['error'])
            backend.activate.assert_not_called()
            backend.capture.assert_not_called()
            service = Service.__new__(Service)
            service.capture = Mock()
            service.idle = Mock()
            with self.assertRaisesRegex(ValueError, '安卓 UI'):
                service.call('preview', {'handle':123,'selector':asdict(native_selector())})
            service.capture.assert_not_called()

    def test_native_actions_require_native_selectors(self):
        for action in ['wait_ui','assert_ui','assert_ui_absent']:
            with self.subTest(action=action), self.assertRaisesRegex(ValueError, '安卓 UI'):
                Project('wrong', selectors=[Selector('登录')], steps=[Step(action=action,target='登录')]).validate()

    def test_native_queries_timeout_and_stop_before_sending_input(self):
        with tempfile.TemporaryDirectory() as folder:
            runner = self.runner(folder, found=None)
            with patch('echo_test.engine.time.monotonic', side_effect=[0,0,6]):
                with self.assertRaisesRegex(TimeoutError, '未找到安卓 UI'):
                    runner.execute(Step(action='click', target='登录', timeout=5))
            runner.backend.click.assert_not_called()
            runner.backend.pause.side_effect = AndroidStopped('stopped')
            with self.assertRaises(AndroidStopped):
                runner.execute(Step(action='click', target='登录'))
            runner.backend.click.assert_not_called()

    def test_generated_python_runs_in_real_child_with_native_controls(self):
        with tempfile.TemporaryDirectory() as folder:
            runner = self.runner(folder)
            runner.persist_reports = True
            runner.backend.find_ui.side_effect = [(50,40), (50,40), (50,40), None]
            source = Project('native', selectors=[native_selector()], steps=[
                Step(action=action, target='登录', delay=0) for action in ['click','wait_ui','assert_ui','assert_ui_absent']])
            code = generate_python(source)
            runner.project = Project('native script', mode='python', code=code, selectors=source.selectors)
            result = runner.run()
            self.assertEqual(result['status'], 'passed', result)
            runner.backend.click.assert_called_once_with((50,40), count=1, button='left', interval=.12, hold=0)
            self.assertEqual(runner.backend.find_ui.call_count, 4)
            self.assertTrue((runner.directory/'result.json').is_file())


if __name__ == '__main__':
    unittest.main()
