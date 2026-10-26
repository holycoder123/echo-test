import io
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch

import numpy as np
from PIL import Image

from echo_test.android import Adb, AndroidBackend, AndroidRecorder, AndroidStopped, endpoint_value, serial_value
from echo_test.android_service import AndroidService
from echo_test.models import Project, Selector, Step
from echo_test.service import Service
import echo_test.service as native


def png_bytes(size=(120, 240)):
    buffer = io.BytesIO()
    Image.new('RGB', size, 'steelblue').save(buffer, 'PNG')
    return buffer.getvalue()


class AndroidTransportTests(unittest.TestCase):
    def setUp(self):
        self.adb = Adb('.')
        self.adb.resolve = Mock(return_value='adb.exe')

    def test_device_list_preserves_authorization_and_identifies_emulators_and_wifi(self):
        self.adb.run = Mock(return_value='List of devices attached\nUSB1 device product:x model:Pixel_8 transport_id:1\nUSB2 unauthorized usb:1\nemulator-5554 device model:sdk_gphone\n192.168.1.2:37643 offline\n')
        devices = self.adb.devices()['devices']
        self.assertEqual(devices[0]['model'], 'Pixel 8')
        self.assertEqual([d['transport'] for d in devices], ['usb', 'usb', 'emulator', 'wifi'])
        with self.assertRaisesRegex(RuntimeError, '授权'):
            self.adb.require_device('USB2')
        with self.assertRaisesRegex(RuntimeError, '离线'):
            self.adb.require_device('192.168.1.2:37643')
        with self.assertRaisesRegex(RuntimeError, '断开'):
            self.adb.require_device('missing')

    def test_missing_adb_has_actionable_error_and_explicit_path_can_be_selected(self):
        adb = Adb('nonexistent-root')
        with patch.dict('os.environ', {}, clear=True), patch('echo_test.android.shutil.which', return_value=None), patch('echo_test.android.Path.is_file', return_value=False):
            with self.assertRaisesRegex(RuntimeError, '环境设置'):
                adb.resolve()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'adb.exe'
            path.write_bytes(b'fixture')
            adb.run = Mock(return_value='Android Debug Bridge')
            self.assertEqual(adb.configure(path), str(path.resolve()))
            adb.run.assert_called_once_with(['version'])

    def test_serial_endpoint_and_pairing_code_cannot_inject_options_or_shell(self):
        for value in ['-s', 'abc;id', 'abc\nother', '', None]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                serial_value(value)
        for value in ['host:0', 'host:65536', 'host:12;id', '-host:123', 'host']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                endpoint_value(value)
        self.assertEqual(endpoint_value('[::1]:5555'), '[::1]:5555')
        self.adb.run = Mock(return_value='Successfully paired to 192.168.1.2:12345')
        self.adb.network('192.168.1.2:12345', '123456')
        self.adb.run.assert_called_once_with(['pair', '192.168.1.2:12345', '123456'], timeout=18)
        with self.assertRaises(ValueError):
            self.adb.network('host:12345', '123456;id')
        self.adb.run.return_value = 'failed to connect to host'
        with self.assertRaisesRegex(RuntimeError, '无线连接失败'):
            self.adb.network('host:5555')

    def test_bundled_adb_works_after_relocation_without_system_android_tools(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)/'EchoTest moved'
            bundled = root/'runtime/android/platform-tools/adb.exe'
            bundled.parent.mkdir(parents=True)
            bundled.write_bytes(b'fixture')
            adb = Adb(root)
            with patch.dict('os.environ', {}, clear=True), patch('echo_test.android.shutil.which', return_value=None):
                self.assertEqual(adb.resolve(),str(bundled))
                adb.run=Mock(return_value='List of devices attached\n')
                self.assertEqual(adb.devices()['adb_source'],'bundled')
            external=root/'external/adb.exe';external.parent.mkdir();external.write_bytes(b'fixture')
            adb.run.side_effect=RuntimeError('missing DLL')
            with self.assertRaises(RuntimeError):
                adb.configure(external)
            self.assertIsNone(adb.executable)
            self.assertEqual(adb.resolve(),str(bundled))

    def test_restoring_automatic_adb_is_transactional(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            bundled=root/'runtime/android/platform-tools/adb.exe'
            bundled.parent.mkdir(parents=True);bundled.write_bytes(b'fixture')
            manual=root/'external/adb.exe';manual.parent.mkdir();manual.write_bytes(b'fixture')
            adb=Adb(root,str(manual));adb.run=Mock(side_effect=RuntimeError('unavailable'))
            with self.assertRaises(RuntimeError):adb.configure('')
            self.assertEqual(adb.executable,str(manual))
            adb.run.side_effect=None
            with patch.dict('os.environ',{},clear=True):
                self.assertEqual(adb.configure(''),str(bundled))
            self.assertIsNone(adb.executable)

    def test_transport_selects_device_without_shell_and_decodes_errors(self):
        process = Mock(returncode=0)
        process.communicate.return_value = (b'ok', b'')
        process.poll.return_value = 0
        with patch('echo_test.android.subprocess.Popen', return_value=process) as popen:
            self.assertEqual(self.adb.run(['shell', 'input', 'tap', '1', '2'], serial='USB1'), 'ok')
        self.assertEqual(popen.call_args.args[0], ['adb.exe', '-s', 'USB1', 'shell', 'input', 'tap', '1', '2'])
        self.assertNotIn('shell', popen.call_args.kwargs)
        process.returncode = 1
        process.communicate.return_value = (b'', b'device offline')
        with patch('echo_test.android.subprocess.Popen', return_value=process), self.assertRaisesRegex(RuntimeError, 'offline'):
            self.adb.run(['get-state'])

    def test_cancellation_and_timeout_kill_in_flight_adb_process(self):
        for cancel in (True, False):
            process = Mock(returncode=None)
            process.poll.return_value = None
            stop = Mock(side_effect=[False, True]) if cancel else None
            # On timeout, communicate in the cleanup path must still drain pipes.
            clock = [0, 1] if cancel else [0, 100]
            with patch('echo_test.android.subprocess.Popen', return_value=process), patch('echo_test.android.time.monotonic', side_effect=clock):
                with self.assertRaises(AndroidStopped if cancel else TimeoutError):
                    self.adb.run(['shell', 'input', 'swipe'], stop=stop)
            process.kill.assert_called_once()


class AndroidBackendTests(unittest.TestCase):
    def setUp(self):
        self.adb = Mock()
        self.adb.run.return_value = png_bytes()
        self.backend = AndroidBackend(self.adb, 'USB1')
        self.backend.capture()
        self.adb.reset_mock()

    def test_capture_uses_device_pixels_and_updates_for_rotation(self):
        self.adb.run.return_value = png_bytes((240, 120))
        self.assertEqual(self.backend.capture().size, (240, 120))
        self.assertEqual(self.backend.size(), (240, 120))
        self.assertEqual(self.adb.run.call_args.args[0], ['exec-out', 'screencap', '-p'])
        self.adb.run.return_value = b'not an image'
        with self.assertRaisesRegex(RuntimeError, '截图'):
            self.backend.capture()

    def test_tap_long_press_swipe_and_android_keys_use_expected_adb_commands(self):
        self.backend.click((10, 20))
        self.assertEqual(self.adb.run.call_args.args[0], ['shell', 'input', 'tap', '10', '20'])
        self.backend.click((10, 20), hold=1.2)
        self.assertEqual(self.adb.run.call_args.args[0], ['shell', 'input', 'swipe', '10', '20', '10', '20', '1200'])
        self.backend.drag((10, 20), (100, 200), .6)
        self.assertEqual(self.adb.run.call_args.args[0], ['shell', 'input', 'swipe', '10', '20', '100', '200', '600'])
        self.backend.key('BACK')
        self.assertEqual(self.adb.run.call_args.args[0], ['shell', 'input', 'keyevent', '4'])
        for invalid in [(-1, 10), (120, 0), (float('nan'), 0)]:
            with self.assertRaises(ValueError):
                self.backend.click(invalid)
        with self.assertRaises(ValueError):
            self.backend.key('CTRL+A')

    def test_ascii_text_is_quoted_for_remote_shell_and_unicode_is_explicitly_rejected(self):
        self.backend.text("hello & 'world'")
        value = self.adb.run.call_args.args[0][-1]
        self.assertEqual(value, "'hello%s&%s'\"'\"'world'\"'\"''")
        self.assertEqual(self.adb.run.call_args.kwargs['serial'], 'USB1')
        for text in ['中文', 'line\nbreak', 'literal%s']:
            with self.subTest(text=text), self.assertRaises(ValueError):
                self.backend.text(text)

    def test_rotation_between_recognition_and_touch_rejects_input(self):
        self.adb.run.return_value = png_bytes((240,120))
        with self.assertRaisesRegex(ValueError, '方向'):
            self.backend.click((20,30))
        self.assertFalse(any(call.args[0][:2] == ['shell','input'] for call in self.adb.run.call_args_list))

    def test_unsupported_desktop_steps_are_rejected_before_any_input(self):
        for step in [Step(action='right_click'), Step(action='key_down', params={'keys':'W'}), Step(action='drag', params={'duration':20})]:
            with self.assertRaises(ValueError):
                self.backend.validate_project(Project(steps=[step]))
        self.adb.run.assert_not_called()

    def test_package_launch_validates_resolved_activity(self):
        self.adb.run.side_effect = ['com.example.app/.MainActivity', 'Status: ok']
        self.backend.launch('com.example.app')
        self.assertEqual(self.adb.run.call_args.args[0], ['shell', 'am', 'start', '-W', '-n', 'com.example.app/.MainActivity'])
        with self.assertRaises(ValueError):
            self.backend.launch('com.example.app;id')
        self.adb.run.side_effect = None
        self.adb.run.return_value = 'No activity found'
        with self.assertRaisesRegex(RuntimeError, '启动入口'):
            self.backend.launch('com.missing.app')


class AndroidServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.root_patch = patch.object(native, 'ROOT', self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        self.environment = patch.dict('os.environ', {'ECHO_TEST_CONTROL_LIBRARY_ROOT':str(self.root)})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.service = Service.__new__(Service)
        self.service.base_dir = self.root/'test_cases'
        self.service.base_dir.mkdir()
        self.service.case_path = None
        self.service.running = False
        self.service.recorder = None
        self.service.pending_recording = None
        self.service.record_lock = threading.Lock()
        self.service.stop_event = threading.Event()
        self.events = []
        def emit(event):
            self.events.append(event)
            if event['kind'] == 'finished':
                self.service.running = False
        self.service.emit = emit
        self.service.window = Mock(side_effect=AssertionError('Android must not access a desktop window'))
        self.service._android = AndroidService(self.service, self.root)
        self.adb = self.service.android.adb
        self.adb.resolve = Mock(return_value='adb.exe')
        self.commands = []
        self.screen = png_bytes()
        def run(arguments, **kwargs):
            self.commands.append((arguments, kwargs))
            if arguments == ['devices','-l']:
                return 'List of devices attached\nUSB1 device model:Pixel_8\n'
            if arguments == ['shell','wm','size']:
                return 'Physical size: 120x240'
            if arguments == ['exec-out','screencap','-p']:
                return self.screen
            return ''
        self.adb.run = Mock(side_effect=run)
        self.target = {'platform':'android', 'serial':'USB1'}
        self.service.call('android_connect', {'serial':'USB1'})

    def action(self, action='tap', **params):
        return self.service.call('android_action', {'target':self.target, 'action':action, 'params':params or {'point':[20,30]}, 'frame_size':[120,240]})

    def test_capture_and_coordinate_preview_share_android_backend(self):
        shot = self.service.call('capture', {'target':self.target})
        self.assertEqual((shot['width'], shot['height']), (120,240))
        preview = self.service.call('preview', {'target':self.target, 'selector':{'name':'center','x':.5,'y':.5}})
        self.assertEqual(preview['point'], (60,120))
        self.service.window.assert_not_called()

    def test_video_transport_info_is_bound_to_selected_device_and_available_during_run(self):
        self.service.running=True
        info=self.service.call('android_stream_info',{'target':self.target})
        self.assertEqual(info,{'serial':'USB1','adb_path':'adb.exe'})
        with self.assertRaisesRegex(ValueError,'目标设备'):
            self.service.call('android_stream_info',{'target':{'serial':'other'}})

    def test_connect_only_reads_metadata_and_compatibility_touch_captures_once(self):
        self.assertFalse(any('screencap' in c for c,_ in self.commands))
        self.action()
        self.assertEqual(sum('screencap' in c for c,_ in self.commands),1)

    def test_live_recording_only_appends_semantic_steps_without_adb_or_screenshots(self):
        self.service.call('record_start', {'target':self.target})
        before=len(self.commands)
        ended=time.time()*1000
        args={'target':self.target,'size':[576,1280],'started_at':ended-250,'ended_at':ended,
              'action':'swipe','params':{'point':[100,200],'end':[200,900],'duration':.25}}
        self.service.call('android_record_control',args)
        self.assertEqual(len(self.commands),before)
        self.assertEqual(self.service.recorder.project.steps[0].action,'drag')
        selector=self.service.recorder.project.selectors[0]
        self.assertAlmostEqual(selector.x,100/575)
        self.assertAlmostEqual(selector.y,200/1279)
        with self.assertRaisesRegex(ValueError,'方向'):
            self.service.call('android_record_control',{**args,'size':[1280,576]})
        self.assertEqual(len(self.service.recorder.events),1)
        self.service.call('record_stop',{})
        with self.assertRaisesRegex(ValueError,'结束'):
            self.service.call('android_record_control',args)

    def test_actions_require_explicit_current_device_and_matching_frame_geometry(self):
        for args in [dict(target={**self.target,'serial':'other'}, frame_size=[120,240]), dict(target=self.target, frame_size=[240,120])]:
            with self.assertRaises(ValueError):
                self.service.call('android_action', {**args,'action':'tap','params':{'point':[20,30]}})
        self.assertFalse(any('input' in command for command,_ in self.commands))
        self.service.call('android_disconnect', {})
        with self.assertRaisesRegex(ValueError, '连接安卓'):
            self.action()

    def test_preview_recording_converts_successful_operations_and_keeps_source_target(self):
        self.service.call('record_start', {'target':self.target})
        self.action(point=[20,30])
        self.action('swipe', point=[20,30], end=[90,200], duration=.5)
        self.action('key', keys='BACK')
        self.action('text', text='hello world')
        self.assertEqual(self.service.call('android_frame', {'target':self.target})['width'],120)
        pending = self.service.call('record_stop', {})
        project = Project.from_dict(pending['project'])
        self.assertEqual([step.action for step in project.steps], ['click','drag','key','text'])
        self.assertEqual(pending['target'],self.target)
        self.assertEqual(pending['raw_count'],4)
        self.assertTrue(Path(pending['path']).is_file())
        self.assertEqual(project.steps[2].params['keys'],'BACK')
        self.assertEqual(self.events[-1]['kind'],'record_stopped')

    def test_failed_input_is_not_recorded_and_rotation_stops_input(self):
        self.service.call('record_start', {'target':self.target})
        with self.assertRaises(ValueError):
            self.action('text', text='中文')
        self.assertEqual(self.service.recorder.events,[])
        self.action()
        self.service.recorder.size=(240,120)
        before=len([c for c,_ in self.commands if 'input' in c])
        with self.assertRaisesRegex(ValueError, '方向'):
            self.action()
        self.assertEqual(len([c for c,_ in self.commands if 'input' in c]),before)

    def test_real_runner_executes_android_case_and_writes_target_in_report(self):
        project=Project('安卓运行', [Selector('center')], [Step(target='center',delay=0)])
        self.service.call('run', {'target':self.target, 'project':project.to_dict()})
        self.service.worker.join(2)
        finished=next(event for event in self.events if event['kind']=='finished')
        self.assertEqual(finished['result']['status'],'passed')
        self.assertEqual(finished['result']['target'],self.target)
        report=json.loads((Path(finished['directory'])/'result.json').read_text(encoding='utf-8'))
        self.assertEqual(report['steps'][0]['status'],'passed')
        self.assertTrue(any(command[:3]==['shell','input','tap'] for command,_ in self.commands))

    def test_stop_interrupts_android_execution_and_cannot_switch_device_during_run(self):
        project=Project('安卓停止', steps=[Step(action='sleep', params={'duration':10},delay=0)])
        self.service.call('run', {'target':self.target,'project':project.to_dict()})
        with self.assertRaisesRegex(ValueError,'停止'):
            self.service.call('android_disconnect',{})
        self.service.call('stop',{})
        self.service.worker.join(2)
        self.assertFalse(self.service.worker.is_alive())
        self.assertEqual(next(e for e in self.events if e['kind']=='finished')['result']['status'],'stopped')

    def test_android_screenshots_use_real_template_match_and_ocr_in_existing_runner(self):
        frame = Image.new('RGB', (120,240), 'white')
        template = Image.fromarray(np.random.default_rng(17).integers(0,255,(20,25,3),dtype=np.uint8))
        template.save(self.service.base_dir/'button.png')
        frame.paste(template,(30,60))
        data=io.BytesIO();frame.save(data,'PNG');self.screen=data.getvalue()
        project=Project('安卓识别', [Selector('button',kind='image',image='button.png',threshold=.98),
                                 Selector('confirm',kind='image',recognition='ocr',text='确认')],
                        [Step(action='assert_image',target='button',delay=0),Step(target='confirm',delay=0)])
        rows=[([[20,100],[60,100],[60,120],[20,120]],'确认',.99)]
        with patch('echo_test.vision.ocr_engine',return_value=lambda image:(rows,None)):
            self.service.call('run', {'target':self.target,'project':project.to_dict()})
            self.service.worker.join(2)
        result=next(event['result'] for event in self.events if event['kind']=='finished')
        self.assertEqual(result['status'],'passed')
        self.assertEqual(result['steps'][0]['recognition']['button']['candidate']['box'], (30,60,25,20))
        self.assertEqual(result['steps'][1]['recognition']['confirm']['candidate']['method'],'ocr')
        self.assertTrue(any(command==['shell','input','tap','40','110'] for command,_ in self.commands))


if __name__ == '__main__':
    unittest.main()
