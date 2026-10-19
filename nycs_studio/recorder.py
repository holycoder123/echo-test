from __future__ import annotations
import ctypes as ct
from ctypes import wintypes as wt
import queue
import traceback
import threading
import time
from .backend import kernel32, WindowsBackend, elevation, is_admin, is_game_foreground, belongs_to_game, ECHO_INPUT_TAG
from .native_windows import user32
from .raw_input import RawInputListener


class MouseHook(ct.Structure):
    _fields_ = [("pt", wt.POINT), ("mouseData", wt.DWORD), ("flags", wt.DWORD), ("time", wt.DWORD), ("dwExtraInfo", ct.c_size_t)]


class KeyHook(ct.Structure):
    _fields_ = [("vkCode", wt.DWORD), ("scanCode", wt.DWORD), ("flags", wt.DWORD), ("time", wt.DWORD), ("dwExtraInfo", ct.c_size_t)]


HOOKPROC = ct.WINFUNCTYPE(ct.c_ssize_t, ct.c_int, wt.WPARAM, wt.LPARAM)
user32.SetWindowsHookExW.argtypes = [ct.c_int, HOOKPROC, wt.HINSTANCE, wt.DWORD]
user32.SetWindowsHookExW.restype = wt.HANDLE
user32.CallNextHookEx.argtypes = [wt.HANDLE, ct.c_int, wt.WPARAM, wt.LPARAM]
user32.CallNextHookEx.restype = ct.c_ssize_t
user32.UnhookWindowsHookEx.argtypes = [wt.HANDLE]
user32.PostThreadMessageW.argtypes = [wt.DWORD, wt.UINT, wt.WPARAM, wt.LPARAM]
user32.GetMessageW.argtypes = [ct.POINTER(wt.MSG), wt.HWND, wt.UINT, wt.UINT]
kernel32.GetModuleHandleW.argtypes = [wt.LPCWSTR]
kernel32.GetModuleHandleW.restype = wt.HMODULE
kernel32.GetCurrentThreadId.restype = wt.DWORD


class Recorder:
    def __init__(self, window, emit):
        self.window = window
        self.emit = emit
        self.events = []
        self.queue = queue.Queue()
        self.started = threading.Event()
        self.done = threading.Event()
        self.error = None
        self.stats = {name: 0 for name in (
            "mouse_observed", "key_observed", "mouse_recorded", "mouse_buttons_observed",
            "mouse_wheel_observed", "mouse_injected", "mouse_inactive", "mouse_outside",
            "mouse_obscured", "mouse_idle_moves", "mouse_queued", "key_injected", "key_inactive", "raw_mouse_observed", "raw_key_observed",
            "mouse_self_input_actions", "key_self_input", "mouse_inactive_actions", "mouse_outside_actions", "mouse_obscured_actions")}
        self.thread_id = 0
        self.start_time = 0
        self.cancelled = threading.Event()
        self.last_move = 0
        self.pressed_mouse = set()
        self.mouse_source = self.key_source = None
        self.raw_listener = RawInputListener(self._raw_event)

    def start(self):
        if elevation(self.window.pid) is True and not is_admin():
            raise RuntimeError("游戏为管理员权限，请以管理员身份启动工作台后录制")
        WindowsBackend(self.window).activate()
        self.start_time = time.monotonic()
        self.thread = threading.Thread(target=self._pump, daemon=True)
        self.thread.start()
        if not self.started.wait(3):
            self.cancelled.set()
            if self.thread_id:
                user32.PostThreadMessageW(self.thread_id, 0x12, 0, 0)
            raise RuntimeError("录制监听启动超时")
        if self.error:
            raise RuntimeError(self.error)
        self.dispatcher = threading.Thread(target=self._dispatch, daemon=True)
        self.dispatcher.start()

    def _dispatch(self):
        while not self.done.is_set() or not self.queue.empty():
            try:
                event = self.queue.get(timeout=.1)
            except queue.Empty:
                continue
            if event.get("kind") == "pending_mouse":
                try:
                    event = self._process_mouse(event)
                except Exception as error:
                    event = {"kind": "stop_request", "reason": str(error), "traceback": traceback.format_exc()}
                if event is None:
                    continue
            if event.get("kind") == "stop_request":
                self.emit(event)
            else:
                if event.get('kind')=='key':
                    source=event.pop('input_source','hook')
                    if self.key_source and source!=self.key_source:continue
                    self.key_source=source
                self.events.append(event)
                self.emit({"kind": "record_event", "event": event, "count": len(self.events)})

    def _process_mouse(self, pending):
        # Cross-process window queries may wait on the game's UI thread. They
        # must never run inside a time-limited low-level input hook.
        source=pending.get('input_source','hook')
        if self.mouse_source and source!=self.mouse_source:return None
        if not self.mouse_source and pending['event']=='move':return None
        left, top, width, height = WindowsBackend(self.window).rect()
        x, y = pending["screen_x"]-left, pending["screen_y"]-top
        action = pending["event"] != "move"
        if not (0 <= x < width and 0 <= y < height):
            self.stats["mouse_outside"] += 1
            if action:self.stats["mouse_outside_actions"] += 1
            return None
        hit = user32.WindowFromPoint(wt.POINT(pending["screen_x"], pending["screen_y"]))
        if not belongs_to_game(hit, self.window.handle):
            self.stats["mouse_obscured"] += 1
            if action:self.stats["mouse_obscured_actions"] += 1
            return None
        self.mouse_source=source  # One stream per device prevents double recording.
        event = {key: value for key, value in pending.items() if key not in {"screen_x", "screen_y", "kind", "input_source"}}
        event.update(kind="mouse", x=x/max(1,width-1), y=y/max(1,height-1))
        self.stats["mouse_recorded"] += 1
        return event

    def _raw_event(self,data):
        if data['kind']=='stop_request':self.queue.put(data);return
        if data['kind']=='raw_key':
            self.stats['raw_key_observed']+=1
            if data['extra']==ECHO_INPUT_TAG:return
            if data['vk']==123 and not data['up']:
                self.queue.put({'kind':'stop_request','reason':'F12'})
            elif data['vk'] not in (91,92,123) and is_game_foreground(self.window):
                self.queue.put({'kind':'key','input_source':'raw','event':'up' if data['up'] else 'down','vk':data['vk'],'t':round(time.monotonic()-self.start_time,4)})
            return
        self.stats['raw_mouse_observed']+=1
        if data['extra']==ECHO_INPUT_TAG:return
        actions=[]
        for flag,event,button in [(1,'down','left'),(2,'up','left'),(4,'down','right'),(8,'up','right'),(16,'down','middle'),(32,'up','middle')]:
            if data['flags']&flag:actions.append({'event':event,'button':button});self.stats['mouse_buttons_observed']+=1
        for flag,axis in [(0x400,'vertical'),(0x800,'horizontal')]:
            if data['flags']&flag:
                amount=round(ct.c_short(data['data']).value/120)
                if amount:actions.append({'event':'wheel','amount':amount,'axis':axis});self.stats['mouse_wheel_observed']+=1
        if not is_game_foreground(self.window):
            self.stats['mouse_inactive_actions']+=len(actions);return
        point=wt.POINT()
        if not user32.GetCursorPos(ct.byref(point)):raise RuntimeError('无法读取原始输入鼠标位置')
        stamp=round(time.monotonic()-self.start_time,4)
        for action in actions:
            if 'button' in action:(self.pressed_mouse.add if action['event']=='down' else self.pressed_mouse.discard)(action['button'])
            self.queue.put({'kind':'pending_mouse','input_source':'raw','screen_x':point.x,'screen_y':point.y,'t':stamp,**action});self.stats['mouse_queued']+=1
        if data['moving'] and self.pressed_mouse and time.monotonic()-self.last_move>=.02:
            self.last_move=time.monotonic()
            self.queue.put({'kind':'pending_mouse','input_source':'raw','event':'move','screen_x':point.x,'screen_y':point.y,'t':stamp});self.stats['mouse_queued']+=1

    def _pump(self):
        self.thread_id = kernel32.GetCurrentThreadId()
        mouse_events = {0x201: ("down", "left"), 0x202: ("up", "left"), 0x204: ("down", "right"), 0x205: ("up", "right"), 0x207: ("down", "middle"), 0x208: ("up", "middle")}
        def mouse_callback(code, message, address):
            try:
                if code >= 0:
                    self.stats["mouse_observed"] += 1
                    if message in mouse_events:self.stats["mouse_buttons_observed"] += 1
                    if message in {0x20A, 0x20E}:self.stats["mouse_wheel_observed"] += 1
                    action = message in mouse_events or message in {0x20A, 0x20E}
                    data = ct.cast(address, ct.POINTER(MouseHook)).contents
                    if data.flags & 1:
                        self.stats["mouse_injected"] += 1
                    if data.dwExtraInfo == ECHO_INPUT_TAG:
                        if action:self.stats["mouse_self_input_actions"] += 1
                    elif not is_game_foreground(self.window):
                        self.stats["mouse_inactive"] += 1
                        if action:self.stats["mouse_inactive_actions"] += 1
                    elif message == 0x200 and not self.pressed_mouse:
                        # Idle movement never becomes a step. Avoid foreign window
                        # hit tests on every move inside a time-limited OS hook.
                        self.stats["mouse_idle_moves"] += 1
                    else:
                        # Copy coordinates and timestamp while the native data
                        # pointer is valid. The dispatcher owns all hit testing.
                        event = {"kind":"pending_mouse", "t":round(time.monotonic()-self.start_time,4),
                                 "screen_x":data.pt.x, "screen_y":data.pt.y}
                        if message in mouse_events:
                            event["event"],event["button"] = mouse_events[message]
                            (self.pressed_mouse.add if event["event"] == "down" else self.pressed_mouse.discard)(event["button"])
                        elif message == 0x200 and time.monotonic()-self.last_move >= .02:
                            self.last_move = time.monotonic()
                            event["event"] = "move"
                        elif message in {0x20A,0x20E}:
                            amount = round(ct.c_short(data.mouseData >> 16).value/120)
                            if amount:event.update(event="wheel",amount=amount,axis="vertical" if message==0x20A else "horizontal")
                        if "event" in event:
                            self.stats["mouse_queued"] += 1
                            self.queue.put(event)
            except Exception as error:
                self.queue.put({"kind": "stop_request", "reason": str(error), "traceback": traceback.format_exc()})
            return user32.CallNextHookEx(None, code, message, address)

        def key_callback(code, message, address):
            try:
                if code >= 0:
                    self.stats["key_observed"] += 1
                    data = ct.cast(address, ct.POINTER(KeyHook)).contents
                    if data.flags & 0x10:
                        self.stats["key_injected"] += 1
                    if data.dwExtraInfo == ECHO_INPUT_TAG:
                        self.stats["key_self_input"] += 1
                    else:
                        if data.vkCode == 123 and message in {0x100, 0x104}:
                            self.queue.put({"kind": "stop_request", "reason": "F12"})
                        elif is_game_foreground(self.window) and data.vkCode not in {91, 92, 123}:
                            self.queue.put({"kind": "key", "event": "down" if message in {0x100, 0x104} else "up", "vk": data.vkCode, "t": round(time.monotonic()-self.start_time, 4)})
                        elif data.vkCode not in {91, 92, 123}:
                            self.stats["key_inactive"] += 1
            except Exception as error:
                self.queue.put({"kind": "stop_request", "reason": str(error), "traceback": traceback.format_exc()})
            return user32.CallNextHookEx(None, code, message, address)

        self.mouse_callback, self.key_callback = HOOKPROC(mouse_callback), HOOKPROC(key_callback)
        module = kernel32.GetModuleHandleW(None)
        mouse = user32.SetWindowsHookExW(14, self.mouse_callback, module, 0)
        keyboard = user32.SetWindowsHookExW(13, self.key_callback, module, 0)
        raw_available=self.raw_listener.start()
        if (not mouse or not keyboard) and not raw_available:
            self.error = f"无法安装录制监听（错误码 {ct.get_last_error()}），请检查管理员权限和交互桌面"
        try:
            # Create the thread message queue before publishing readiness.
            message = wt.MSG()
            user32.PeekMessageW(ct.byref(message), None, 0, 0, 0)
            self.started.set()
            if not self.error and not self.cancelled.is_set():
                while not self.cancelled.is_set():
                    status = user32.GetMessageW(ct.byref(message), None, 0, 0)
                    if status == -1:
                        raise RuntimeError(f"录制消息循环失败（错误码 {ct.get_last_error()}）")
                    if status == 0:
                        break
                    user32.TranslateMessage(ct.byref(message))
                    user32.DispatchMessageW(ct.byref(message))
        except Exception as error:
            self.queue.put({"kind": "stop_request", "reason": str(error), "traceback": traceback.format_exc()})
        finally:
            self.raw_listener.stop()
            if mouse:
                user32.UnhookWindowsHookEx(mouse)
            if keyboard:
                user32.UnhookWindowsHookEx(keyboard)
            self.done.set()

    def diagnostics(self):
        rect, origin = wt.RECT(), wt.POINT()
        hit = 0
        if user32.GetClientRect(self.window.handle, ct.byref(rect)) and user32.ClientToScreen(self.window.handle, ct.byref(origin)):
            if rect.right > 0 and rect.bottom > 0:
                hit = user32.WindowFromPoint(wt.POINT(origin.x+rect.right//2, origin.y+rect.bottom//2))
        return {"handle": self.window.handle, "game_pid": self.window.pid, "admin": is_admin(),
                "game_admin": elevation(self.window.pid), "foreground_handle": int(user32.GetForegroundWindow() or 0),
                "game_foreground": is_game_foreground(self.window),
                "game_visible": bool(user32.IsWindowVisible(self.window.handle)),
                "game_enabled": bool(user32.IsWindowEnabled(self.window.handle)),
                "game_hit_test": belongs_to_game(hit, self.window.handle),
                "raw_input_available": self.raw_listener.active,"raw_input_error":self.raw_listener.error,
                "mouse_source":self.mouse_source,"key_source":self.key_source,"pressed_buttons":len(self.pressed_mouse),
                "listener_alive": bool(getattr(self, "thread", None) and self.thread.is_alive()),
                "event_count": len(self.events), **self.stats}

    def stop(self):
        self.cancelled.set()
        if self.thread_id:
            user32.PostThreadMessageW(self.thread_id, 0x12, 0, 0)
        self.thread.join(timeout=3)
        if self.thread.is_alive():
            raise RuntimeError("录制线程无法停止")
        self.dispatcher.join(timeout=3)
        if self.dispatcher.is_alive():
            raise RuntimeError("录制事件尚未处理完成")
        return list(self.events)
