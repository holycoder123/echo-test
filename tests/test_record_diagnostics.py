import unittest
import ctypes as ct
from unittest.mock import Mock, patch
from echo_test.service import Service
from echo_test.recorder import Recorder, MouseHook
from echo_test.backend import GameWindow
from echo_test import recorder as native


class RecordingDiagnosticsTests(unittest.TestCase):
    def setUp(self):
        # Unit tests must never register actual desktop input devices.
        self.enterContext(patch.object(native.RawInputListener,'start',return_value=False))
        self.enterContext(patch.object(native.RawInputListener,'stop'))

    def mouse_probe(self, message, *, injected=False, own_input=False, foreground=True, hit=True, point=(20, 20)):
        recorder = Recorder(GameWindow(10, "test", 1), Mock())
        with patch.object(native.user32, "SetWindowsHookExW", return_value=1), \
             patch.object(native.user32, "PeekMessageW"), \
             patch.object(native.user32, "GetMessageW", return_value=0), \
             patch.object(native.user32, "UnhookWindowsHookEx"):
            recorder._pump()
        mouse = MouseHook()
        mouse.pt.x, mouse.pt.y = point
        mouse.flags = int(injected)
        mouse.dwExtraInfo = native.ECHO_INPUT_TAG if own_input else 0
        with patch.object(native, "is_game_foreground", return_value=foreground), \
             patch.object(native.WindowsBackend, "rect", return_value=(0, 0, 100, 100)), \
             patch.object(native.user32, "WindowFromPoint", return_value=10), \
             patch.object(native, "belongs_to_game", return_value=hit), \
             patch.object(native.user32, "CallNextHookEx", return_value=0):
            recorder.mouse_callback(0, message, ct.addressof(mouse))
            if not recorder.queue.empty():
                pending = recorder.queue.get_nowait()
                event = recorder._process_mouse(pending)
                if event:recorder.queue.put(event)
        return recorder

    def test_mouse_hook_returns_before_any_foreign_window_query(self):
        recorder = self.mouse_probe(0x200)
        mouse = MouseHook();mouse.pt.x=mouse.pt.y=20
        with patch.object(native,"is_game_foreground",return_value=True), \
             patch.object(native.WindowsBackend,"rect") as rect, \
             patch.object(native.user32,"WindowFromPoint") as hit, \
             patch.object(native.user32,"CallNextHookEx",return_value=0):
            recorder.mouse_callback(0,0x201,ct.addressof(mouse))
            mouse.pt.x=90  # The hook must have copied the ephemeral native data.
            pending=recorder.queue.get_nowait()
            self.assertEqual(pending["screen_x"],20)
            self.assertEqual(pending["event"],"down")
            rect.assert_not_called();hit.assert_not_called()

    def test_physical_click_is_recorded_and_normalized(self):
        recorder = self.mouse_probe(0x201)
        event = recorder.queue.get_nowait()
        self.assertEqual((event["event"], event["button"]), ("down", "left"))
        self.assertAlmostEqual(event["x"], 20/99)
        self.assertEqual(recorder.stats["mouse_recorded"], 1)

    def test_rejected_clicks_have_distinct_diagnostics_and_never_record(self):
        for options, reason in [({"injected": True, "own_input": True}, "mouse_self_input_actions"),
                                ({"foreground": False}, "mouse_inactive"),
                                ({"hit": False}, "mouse_obscured"),
                                ({"point": (110, 20)}, "mouse_outside")]:
            with self.subTest(reason=reason):
                recorder = self.mouse_probe(0x201, **options)
                self.assertTrue(recorder.queue.empty())
                self.assertEqual(recorder.stats[reason], 1)
                self.assertEqual(recorder.stats["mouse_buttons_observed"], 1)

    def test_remote_or_touch_input_is_not_dropped_by_the_injected_flag(self):
        recorder = self.mouse_probe(0x201, injected=True)
        self.assertEqual(recorder.queue.get_nowait()["event"], "down")
        self.assertEqual(recorder.stats["mouse_injected"],1)
        self.assertEqual(recorder.stats["mouse_self_input_actions"],0)

    def test_background_processing_preserves_event_order_and_original_timestamps(self):
        recorder = self.mouse_probe(0x200)
        for event, stamp in [("down",1.0),("up",1.1)]:
            recorder.queue.put({"kind":"pending_mouse","event":event,"button":"left",
                                "screen_x":120,"screen_y":220,"t":stamp})
        with patch.object(native.WindowsBackend,"rect",return_value=(100,200,1280,720)), \
             patch.object(native.user32,"WindowFromPoint",return_value=10), \
             patch.object(native,"belongs_to_game",return_value=True):
            recorder._dispatch()
        self.assertEqual([e["event"] for e in recorder.events],["down","up"])
        self.assertEqual([e["t"] for e in recorder.events],[1.0,1.1])
        self.assertAlmostEqual(recorder.events[0]["x"],20/1279)
        self.assertNotIn("screen_x",recorder.events[0])
        self.assertEqual([call.args[0]["count"] for call in recorder.emit.call_args_list],[1,2])

    def test_background_hit_test_failure_is_reported_instead_of_losing_the_listener(self):
        recorder = self.mouse_probe(0x200)
        recorder.queue.put({"kind":"pending_mouse","event":"down","button":"left",
                            "screen_x":20,"screen_y":20,"t":1})
        with patch.object(native.WindowsBackend,"rect",side_effect=RuntimeError("窗口读取失败")):
            recorder._dispatch()
        failure=recorder.emit.call_args.args[0]
        self.assertEqual(failure["kind"],"stop_request")
        self.assertIn("窗口读取失败",failure["reason"])
        self.assertIn("Traceback",failure["traceback"])

    def test_replay_mouse_and_keyboard_inputs_carry_the_same_exclusion_tag(self):
        backend=native.WindowsBackend(GameWindow(10,"test",1))
        with patch.object(backend,"_send") as send:
            backend._mouse(2);backend._key(65)
        self.assertEqual(send.call_args_list[0].args[0].mi.dwExtraInfo,native.ECHO_INPUT_TAG)
        self.assertEqual(send.call_args_list[1].args[0].ki.dwExtraInfo,native.ECHO_INPUT_TAG)

    def test_raw_and_hook_streams_do_not_duplicate_a_click(self):
        for first in ['hook','raw']:
            with self.subTest(first=first):
                recorder=self.mouse_probe(0x200)
                other='raw' if first=='hook' else 'hook'
                for event in ['down','up']:
                    for source in [first,other]:
                        recorder.queue.put({'kind':'pending_mouse','event':event,'button':'left','input_source':source,'screen_x':20,'screen_y':20,'t':1})
                with patch.object(native.WindowsBackend,'rect',return_value=(0,0,100,100)), \
                     patch.object(native.user32,'WindowFromPoint',return_value=10), \
                     patch.object(native,'belongs_to_game',return_value=True):recorder._dispatch()
                self.assertEqual([e['event'] for e in recorder.events],['down','up'])
                self.assertEqual(recorder.mouse_source,first)

    def test_raw_mouse_fallback_captures_buttons_and_keeps_stop_key(self):
        recorder=self.mouse_probe(0x200)
        def cursor(pointer):
            point=ct.cast(pointer,ct.POINTER(native.wt.POINT)).contents
            point.x=point.y=20
            return True
        with patch.object(native,'is_game_foreground',return_value=True), \
             patch.object(native.user32,'GetCursorPos',side_effect=cursor), \
             patch.object(native.WindowsBackend,'rect',return_value=(0,0,100,100)), \
             patch.object(native.user32,'WindowFromPoint',return_value=10), \
             patch.object(native,'belongs_to_game',return_value=True):
            recorder._raw_event({'kind':'raw_mouse','flags':1,'data':0,'moving':False,'extra':0})
            recorder._raw_event({'kind':'raw_mouse','flags':2,'data':0,'moving':False,'extra':0})
            recorder._dispatch()
        self.assertEqual(recorder.mouse_source,'raw')
        self.assertEqual([e['event'] for e in recorder.events],['down','up'])
        recorder._raw_event({'kind':'raw_key','vk':123,'up':False,'extra':0})
        self.assertEqual(recorder.queue.get_nowait()['reason'],'F12')

    def test_keyboard_streams_deduplicate_and_can_fall_back_to_raw_input(self):
        recorder=self.mouse_probe(0x200)
        with patch.object(native,'is_game_foreground',return_value=True):
            for up in [False,True]:
                recorder._raw_event({'kind':'raw_key','vk':65,'up':up,'extra':0})
                recorder.queue.put({'kind':'key','vk':65,'event':'up' if up else 'down','t':1})
            recorder._dispatch()
        self.assertEqual(recorder.key_source,'raw')
        self.assertEqual([e['event'] for e in recorder.events],['down','up'])

    def test_idle_cursor_movement_is_distinguished_from_a_failed_click(self):
        recorder = self.mouse_probe(0x200)
        self.assertTrue(recorder.queue.empty())
        self.assertEqual(recorder.stats["mouse_idle_moves"], 1)
        self.assertEqual(recorder.stats["mouse_buttons_observed"], 0)

    def test_listener_failure_preserves_result_and_reports_original_reason(self):
        service = Service.__new__(Service)
        service.finish_recording = Mock(return_value={"raw_count": 2})
        service.emit = Mock()
        service.stop_from_listener({"reason": "窗口已失效", "traceback": "callback traceback"})
        service.finish_recording.assert_called_once()
        event = service.emit.call_args.args[0]
        self.assertEqual(event["kind"], "record_error")
        self.assertIn("窗口已失效", event["message"])
        self.assertEqual(event["traceback"], "callback traceback")

    def test_f12_is_a_normal_stop_and_failure_is_not_reported_twice(self):
        service = Service.__new__(Service)
        service.finish_recording = Mock()
        service.emit = Mock()
        service.stop_from_listener({"reason": "F12"})
        service.emit.assert_not_called()
        service.finish_recording.side_effect = RuntimeError("already reported")
        service.stop_from_listener({"reason": "callback failure"})
        service.emit.assert_not_called()

    def test_message_loop_failure_unhooks_and_emits_stop_reason(self):
        recorder = Recorder(GameWindow(10, "test", 1), Mock())
        with patch.object(native.user32, "SetWindowsHookExW", return_value=1), \
             patch.object(native.user32, "PeekMessageW"), \
             patch.object(native.user32, "GetMessageW", return_value=-1), \
             patch.object(native.user32, "UnhookWindowsHookEx") as unhook:
            recorder._pump()
        self.assertTrue(recorder.done.is_set())
        self.assertEqual(unhook.call_count, 2)
        event = recorder.queue.get_nowait()
        self.assertIn("消息循环失败", event["reason"])
        self.assertIn("Traceback", event["traceback"])

    def test_zero_delta_wheel_does_not_enqueue_an_incomplete_event(self):
        recorder = Recorder(GameWindow(10, "test", 1), Mock())
        with patch.object(native.user32, "SetWindowsHookExW", return_value=1), \
             patch.object(native.user32, "PeekMessageW"), \
             patch.object(native.user32, "GetMessageW", return_value=0), \
             patch.object(native.user32, "UnhookWindowsHookEx"):
            recorder._pump()
        mouse = MouseHook()
        mouse.pt.x = mouse.pt.y = 20
        with patch.object(native, "is_game_foreground", return_value=True), \
             patch.object(native.WindowsBackend, "rect", return_value=(0, 0, 100, 100)), \
             patch.object(native.user32, "WindowFromPoint", return_value=10), \
             patch.object(native, "belongs_to_game", return_value=True), \
             patch.object(native.user32, "CallNextHookEx", return_value=0):
            recorder.mouse_callback(0, 0x20A, ct.addressof(mouse))
        self.assertTrue(recorder.queue.empty())
