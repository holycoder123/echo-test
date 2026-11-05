import queue
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
from PIL import Image
from echo_test.service import Service
from echo_test.recording import convert_events


class FloatingScreenshotTests(unittest.TestCase):
    def test_screenshot_marker_keeps_order_and_prevents_click_merging(self):
        events = [dict(kind='mouse', event=event, t=stamp, x=.3, y=.4, button='left')
                  for event, stamp in [('down', 0), ('up', .05), ('down', .2), ('up', .25)]]
        events.append(dict(kind='screenshot', event='screenshot', t=.1))
        project = convert_events(events)
        self.assertEqual([s.action for s in project.steps], ['click', 'screenshot', 'click'])
        self.assertEqual(project.steps[1].delay, .1)

    def capture(self, recording=False, fail=False):
        service = Service.__new__(Service)
        service.running = False
        service.record_lock = threading.Lock()
        game = SimpleNamespace(handle=123, pid=456)
        service.window = Mock(return_value=game)
        service.verify_game_pid = Mock()
        service.recorder = SimpleNamespace(window=game, queue=queue.Queue(), start_time=time.monotonic()) if recording else None
        backend = Mock()
        backend.capture.return_value = Image.new('RGB', (20, 20))
        if fail:
            backend.capture.side_effect = RuntimeError('截图失败')
        with tempfile.TemporaryDirectory() as temp, patch('echo_test.service.ROOT', Path(temp)), patch('echo_test.service.WindowsBackend', return_value=backend):
            if fail:
                with self.assertRaisesRegex(RuntimeError, '截图失败'):
                    service.call('floating_screenshot', {'handle':123, 'expected_pid':456})
                self.assertTrue(service.recorder.queue.empty())
                return
            result = service.call('floating_screenshot', {'handle':123, 'expected_pid':456})
            self.assertTrue(Path(result['path']).is_file())
            self.assertEqual(result['recorded'], recording)
            if recording:
                self.assertEqual(service.recorder.queue.get()['kind'], 'screenshot')
                backend.activate.assert_not_called()
            else:
                backend.activate.assert_called_once()

    def test_idle_capture_saves_png(self):
        self.capture()

    def test_recording_capture_enqueues_marker(self):
        self.capture(recording=True)

    def test_failed_capture_does_not_enqueue_marker(self):
        self.capture(recording=True, fail=True)
