import ctypes as ct
from ctypes import wintypes as wt
import threading
import queue
import time
import unittest
from unittest.mock import Mock, patch
from echo_test import window_picker as native
from echo_test.backend import GameWindow
from echo_test.window_picker import WindowPicker, MouseHook, KeyHook


class WindowPickerTests(unittest.TestCase):
    def setUp(self):
        self.events=[]
        self.picker=WindowPicker(self.events.append,overlay_handle=900)
        self.window=GameWindow(10,'测试目标窗口',99,'Client.exe')
        self.picker.windows={10:self.window}
        self.bounds=[-1200,30,800,600]
        self.hit=self.enterContext(patch.object(native.user32,'WindowFromPoint',return_value=11))
        self.root=self.enterContext(patch.object(native.user32,'GetAncestor',return_value=10))
        self.enterContext(patch.object(native.user32,'IsWindow',return_value=True))
        self.iconic=self.enterContext(patch.object(native.user32,'IsIconic',return_value=False))
        self.enterContext(patch.object(native.user32,'GetWindowThreadProcessId',side_effect=lambda handle,pid:setattr(pid._obj,'value',99)))
        def rectangle(handle,rect):
            x,y,w,h=self.bounds
            rect._obj.left=x;rect._obj.top=y;rect._obj.right=x+w;rect._obj.bottom=y+h
            return True
        self.enterContext(patch.object(native.user32,'GetWindowRect',side_effect=rectangle))
        self.next=self.enterContext(patch.object(native.user32,'CallNextHookEx',return_value=77))
        self.show=self.enterContext(patch.object(native.user32,'ShowWindow'))
        # A private message queue exercises concurrency without installing hooks
        # on the user's desktop or injecting any actual mouse/key input.
        self.messages=queue.Queue()
        self.enterContext(patch.object(native.kernel32,'GetCurrentThreadId',return_value=801))
        self.enterContext(patch.object(native.user32,'PeekMessageW',return_value=False))
        def get_message(output, *_):
            message=self.messages.get(timeout=3)
            output._obj.message=message
            return 0 if message==0x12 else 1
        self.enterContext(patch.object(native.user32,'GetMessageW',side_effect=get_message))
        self.enterContext(patch.object(native.user32,'PostThreadMessageW',side_effect=lambda thread,message,*_:self.messages.put(message) or 1))
        self.enterContext(patch.object(native.user32,'TranslateMessage'))
        self.dispatch=self.enterContext(patch.object(native.user32,'DispatchMessageW'))
        self.enterContext(patch.object(native.user32,'GetCursorPos',return_value=False))

    def test_child_hit_selects_top_level_window_and_preserves_negative_monitor_coordinates(self):
        result=self.picker.candidate((-1100,100))
        self.assertEqual(result['handle'],10)
        self.assertEqual(result['pid'],99)
        self.assertEqual(result['bounds'],[-1200,30,800,600])
        self.show.assert_not_called()

    def test_click_through_overlay_finds_eligible_window_beneath_it(self):
        self.root.return_value=900
        self.assertEqual(self.picker.candidate((-1100,100))['handle'],10)
        self.assertIsNone(self.picker.candidate((5000,100)))

    def test_workbench_or_other_noneligible_window_does_not_select_a_window_behind_it(self):
        self.root.return_value=500
        self.assertIsNone(self.picker.candidate((-1100,100)))

    def test_minimized_closed_and_reused_window_are_not_confirmed(self):
        self.iconic.return_value=True
        self.assertIsNone(self.picker.candidate((100,100)))
        self.iconic.return_value=False
        with patch.object(native.user32,'IsWindow',return_value=False):
            self.assertIsNone(self.picker.candidate((100,100)))
        with patch.object(native.user32,'GetWindowThreadProcessId',side_effect=lambda handle,pid:setattr(pid._obj,'value',100)):
            self.assertIsNone(self.picker.candidate((100,100)))

    def test_hover_updates_only_when_target_or_bounds_change_and_clears_on_empty_area(self):
        self.picker.hover((100,100));self.picker.hover((200,100))
        self.assertEqual(len(self.events),1)
        self.bounds[0]=-1000;self.picker.hover((200,100))
        self.assertEqual(len(self.events),2)
        self.hit.return_value=0;self.picker.hover((200,100))
        self.assertIsNone(self.events[-1]['window'])

    def test_confirmation_consumes_both_mouse_down_and_up_before_selecting(self):
        data=MouseHook(pt=wt.POINT(-1100,100))
        address=ct.addressof(data)
        self.assertEqual(self.picker.mouse_callback(0,0x201,address),1)
        self.picker.refresh=Mock()
        self.assertFalse(self.picker.drain())
        self.assertIsNone(self.picker.selected)
        self.assertEqual(self.picker.mouse_callback(0,0x202,address),1)
        self.assertTrue(self.picker.drain())
        self.assertEqual(self.picker.selected['handle'],10)
        self.next.assert_not_called()

    def test_releasing_a_click_that_began_before_picker_is_not_a_confirmation(self):
        data=MouseHook(pt=wt.POINT(100,100))
        self.assertEqual(self.picker.mouse_callback(0,0x202,ct.addressof(data)),77)
        self.assertFalse(self.picker.drain())

    def test_escape_and_f12_cancel_without_sending_keys_to_target(self):
        for vk in [27,123]:
            self.picker.cancelled.clear()
            key=KeyHook(vkCode=vk)
            self.assertEqual(self.picker.key_callback(0,0x100,ct.addressof(key)),1)
            self.assertTrue(self.picker.cancelled.is_set())
            self.assertEqual(self.picker.key_callback(0,0x101,ct.addressof(key)),1)
        self.next.assert_not_called()

    def test_other_events_are_forwarded(self):
        self.assertEqual(self.picker.mouse_callback(-1,0x201,0),77)
        self.assertEqual(self.picker.mouse_callback(0,0x200,0),77)
        key=KeyHook(vkCode=65)
        self.assertEqual(self.picker.key_callback(0,0x100,ct.addressof(key)),77)

    def test_cancelled_listener_unhooks_both_hooks_before_future_completes(self):
        self.picker.refresh=Mock()
        self.picker.emit=lambda event:self.picker.cancel()
        with patch.object(native.kernel32,'GetModuleHandleW',return_value=55), \
             patch.object(native.user32,'SetWindowsHookExW',side_effect=[11,22]), \
             patch.object(native.user32,'UnhookWindowsHookEx') as unhook:
            result=self.picker.start().result(2)
            self.assertTrue(result['cancelled'])
            self.assertFalse(self.picker.active)
            self.assertEqual([call.args[0] for call in unhook.call_args_list],[22,11])
        self.picker.close()

    def test_partial_hook_failure_unhooks_mouse_and_rejects_future(self):
        with patch.object(native.kernel32,'GetModuleHandleW',return_value=55), \
             patch.object(native.user32,'SetWindowsHookExW',side_effect=[11,0]), \
             patch.object(native.user32,'UnhookWindowsHookEx') as unhook:
            with self.assertRaisesRegex(RuntimeError,'取消键监听'):
                self.picker.start().result(2)
            unhook.assert_called_once_with(11)
            self.assertFalse(self.picker.active)

    def test_timeout_releases_hooks(self):
        self.picker.timeout=0
        self.picker.refresh=Mock()
        with patch.object(native.kernel32,'GetModuleHandleW',return_value=55), \
             patch.object(native.user32,'SetWindowsHookExW',side_effect=[11,22]), \
             patch.object(native.user32,'UnhookWindowsHookEx') as unhook, \
             patch.object(native.user32,'PeekMessageW',return_value=False):
            result=self.picker.start().result(2)
            self.assertEqual(result['reason'],'timeout')
            self.assertEqual(unhook.call_count,2)

    def test_service_cancel_stop_and_shutdown_release_picker(self):
        from echo_test.service import Service
        service=Service.__new__(Service)
        service.window_picker=Mock(active=True)
        service.running=False;service.recorder=None;service.worker=None
        service.stop_event=threading.Event();service.toolbar_pair=Mock()
        with self.assertRaisesRegex(ValueError,'请先停止'):
            service.idle()
        service.call('window_pick_cancel',{})
        service.call('stop',{})
        self.assertEqual(service.window_picker.cancel.call_count,2)
        service.call('shutdown',{})
        service.window_picker.close.assert_called_once()

    def test_service_returns_deferred_selection_and_checks_pid_before_restoring(self):
        from echo_test.service import Service
        service=Service.__new__(Service)
        service.window_picker=None;service.running=False;service.recorder=None
        with patch.object(native,'WindowPicker') as picker:
            result=service.call('window_pick_start',{'overlay_handle':900})
            self.assertIs(result,picker.return_value.start.return_value)
            self.assertEqual(picker.call_args.kwargs['overlay_handle'],900)
        service.window=lambda handle:self.window
        with self.assertRaisesRegex(ValueError,'身份已变化'):
            service.call('game_info',{'handle':10,'expected_pid':100,'restore':True})
        self.show.assert_not_called()


    def test_slow_window_enumeration_does_not_block_mouse_hook_message_dispatch(self):
        scan_entered=threading.Event();release_scan=threading.Event();dispatched=threading.Event()
        hook_thread=[];query_thread=[]
        def scan():
            query_thread.append(threading.get_ident())
            scan_entered.set()
            release_scan.wait(3)
            self.picker.last_refresh=time.monotonic()
        def dispatch(_):
            hook_thread.append(threading.get_ident())
            self.assertEqual(self.picker.mouse_callback(0,0x200,0),77)
            dispatched.set()
        self.picker.refresh=scan
        self.dispatch.side_effect=dispatch
        with patch.object(native.kernel32,'GetModuleHandleW',return_value=55), \
             patch.object(native.user32,'SetWindowsHookExW',side_effect=[11,22]), \
             patch.object(native.user32,'UnhookWindowsHookEx'):
            future=self.picker.start()
            try:
                self.assertTrue(scan_entered.wait(1))
                self.messages.put(0x8001)
                self.assertTrue(dispatched.wait(1),'mouse forwarding waited for slow window enumeration')
                self.assertFalse(release_scan.is_set())
                self.assertNotEqual(hook_thread[0],query_thread[0])
            finally:
                release_scan.set();self.picker.cancel();future.result(2);self.picker.close()

    def test_slow_hover_ipc_does_not_block_mouse_messages(self):
        ipc_entered=threading.Event();release_ipc=threading.Event();dispatched=threading.Event()
        self.picker.refresh=Mock()
        def emit(_):
            ipc_entered.set();release_ipc.wait(3)
        self.picker.emit=emit
        self.dispatch.side_effect=lambda _:dispatched.set()
        with patch.object(native.kernel32,'GetModuleHandleW',return_value=55), \
             patch.object(native.user32,'SetWindowsHookExW',side_effect=[11,22]), \
             patch.object(native.user32,'UnhookWindowsHookEx'):
            future=self.picker.start()
            try:
                self.assertTrue(ipc_entered.wait(1))
                self.messages.put(0x8001)
                self.assertTrue(dispatched.wait(1),'input dispatch waited for output/IPC')
            finally:
                release_ipc.set();self.picker.cancel();future.result(2);self.picker.close()

    def test_cancellation_releases_hooks_even_while_background_query_is_blocked(self):
        entered=threading.Event();release=threading.Event()
        def scan():
            entered.set();release.wait(3)
        self.picker.refresh=scan
        with patch.object(native.kernel32,'GetModuleHandleW',return_value=55), \
             patch.object(native.user32,'SetWindowsHookExW',side_effect=[11,22]), \
             patch.object(native.user32,'UnhookWindowsHookEx') as unhook:
            future=self.picker.start()
            try:
                self.assertTrue(entered.wait(1))
                self.picker.cancel()
                self.assertTrue(future.result(1)['cancelled'])
                self.assertEqual(unhook.call_count,2)
                self.assertIsNone(self.picker.thread_id)
                self.assertEqual(self.events,[])
            finally:
                release.set();self.picker.close()
                self.picker.tracker.join(1)
        self.assertEqual(self.events,[],'cancelled background work emitted a late highlight')

    def test_background_failure_stops_message_loop_and_unhooks(self):
        self.picker.refresh=Mock(side_effect=RuntimeError('模拟窗口枚举失败'))
        with patch.object(native.kernel32,'GetModuleHandleW',return_value=55), \
             patch.object(native.user32,'SetWindowsHookExW',side_effect=[11,22]), \
             patch.object(native.user32,'UnhookWindowsHookEx') as unhook:
            with self.assertRaisesRegex(RuntimeError,'模拟窗口枚举失败'):
                self.picker.start().result(2)
            self.assertEqual(unhook.call_count,2)
            self.assertFalse(self.picker.active)

    def test_input_message_error_unhooks_both_handlers(self):
        self.picker.refresh=Mock()
        with patch.object(native.kernel32,'GetModuleHandleW',return_value=55), \
             patch.object(native.user32,'SetWindowsHookExW',side_effect=[11,22]), \
             patch.object(native.user32,'UnhookWindowsHookEx') as unhook, \
             patch.object(native.user32,'GetMessageW',return_value=-1):
            with self.assertRaisesRegex(RuntimeError,'消息循环异常'):
                self.picker.start().result(2)
            self.assertEqual(unhook.call_count,2)

    def test_cancelling_before_listen_does_not_install_hooks_or_post_to_an_old_thread(self):
        self.picker.cancel()
        with patch.object(native.user32,'SetWindowsHookExW') as install, \
             patch.object(native.user32,'PostThreadMessageW') as post:
            self.assertTrue(self.picker.start().result(2)['cancelled'])
            self.picker.cancel()
            install.assert_not_called();post.assert_not_called()


    def test_confirmed_click_wakes_message_loop_and_returns_selection_after_unhooking(self):
        ready=threading.Event()
        self.picker.refresh=Mock()
        self.picker.emit=lambda event:ready.set() if event['kind']=='window_pick_started' else None
        data=MouseHook(pt=wt.POINT(-1100,100))
        with patch.object(native.kernel32,'GetModuleHandleW',return_value=55), \
             patch.object(native.user32,'SetWindowsHookExW',side_effect=[11,22]), \
             patch.object(native.user32,'UnhookWindowsHookEx') as unhook:
            future=self.picker.start()
            try:
                self.assertTrue(ready.wait(1))
                self.picker.mouse_callback(0,0x201,ct.addressof(data))
                self.picker.mouse_callback(0,0x202,ct.addressof(data))
                result=future.result(2)
                self.assertFalse(result['cancelled'])
                self.assertEqual(result['selected']['handle'],10)
                self.assertEqual(result['selected']['pid'],99)
                self.assertEqual(unhook.call_count,2)
                self.assertFalse(self.picker.active)
            finally:
                self.picker.close()
