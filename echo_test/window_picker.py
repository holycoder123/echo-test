"""Interactive top-level window picker. Confirmation clicks never reach applications."""
from __future__ import annotations
from concurrent.futures import Future
import ctypes as ct
from ctypes import wintypes as wt
from dataclasses import asdict
import queue
import threading
import time
from .backend import list_game_windows, kernel32
from .native_windows import user32
from .recorder import HOOKPROC, MouseHook, KeyHook


class WindowPicker:
    def __init__(self, emit, timeout=60, overlay_handle=None):
        self.emit = emit
        self.overlay_handle = overlay_handle
        self.timeout = timeout
        self.cancelled = threading.Event()
        self.events = queue.SimpleQueue()
        self.future = Future()
        self.active = False
        self.thread = None
        self.windows = {}
        self.last_refresh = 0
        self.last_hover = None
        self.pressed_point = None
        self.selected = None
        self.swallow_up = False
        self.thread_id = None
        self.thread_lock = threading.Lock()
        self.tracker = None
        self.tracking_result = None
        self.tracking_error = None

    def start(self):
        self.active = True
        self.thread = threading.Thread(target=self._run, daemon=True)
        try:
            self.thread.start()
        except Exception:
            self.active = False
            raise
        return self.future

    def wake_listener(self):
        # The queue is created before publishing thread_id. Protect the ID until
        # posting completes so it cannot refer to a subsequently recycled thread.
        with self.thread_lock:
            if self.thread_id is not None:
                user32.PostThreadMessageW(self.thread_id, 0x12, 0, 0)

    def cancel(self):
        self.cancelled.set()
        self.wake_listener()

    def close(self):
        self.cancel()
        if self.thread:
            self.thread.join(2)
            if self.thread.is_alive():
                raise RuntimeError('窗口选择监听尚未退出，请稍后重试')

    def refresh(self):
        self.windows = {window.handle: window for window in list_game_windows()}
        self.last_refresh = time.monotonic()

    def candidate(self, point):
        hit = user32.WindowFromPoint(wt.POINT(*point))
        root = int(user32.GetAncestor(hit, 2) or 0) if hit else 0
        window = self.windows.get(root)
        if window is None:
            # The click-through highlight belongs to the workbench. Find the
            # first eligible window underneath it in native Z order.
            if not root or root != self.overlay_handle:
                return None
            for possible in self.windows.values():
                rect = wt.RECT()
                if user32.GetWindowRect(possible.handle, ct.byref(rect)) and rect.left <= point[0] < rect.right and rect.top <= point[1] < rect.bottom:
                    window = possible
                    break
        if window is None or user32.IsIconic(window.handle) or not user32.IsWindow(window.handle):
            return None
        pid = wt.DWORD()
        user32.GetWindowThreadProcessId(window.handle, ct.byref(pid))
        if pid.value != window.pid:
            return None
        rect = wt.RECT()
        if not user32.GetWindowRect(window.handle, ct.byref(rect)) or rect.right <= rect.left or rect.bottom <= rect.top:
            return None
        return {**asdict(window), 'bounds': [rect.left, rect.top, rect.right-rect.left, rect.bottom-rect.top]}

    def hover(self, point):
        window = self.candidate(point)
        signature = (window['handle'], window['pid'], window['title'], *window['bounds']) if window else None
        if signature != self.last_hover:
            self.last_hover = signature
            if not self.cancelled.is_set():
                self.emit({'kind': 'window_pick_hover', 'window': window})

    def mouse_callback(self, code, message, address):
        if code >= 0 and message in {0x201, 0x202}:
            try:
                data = ct.cast(address, ct.POINTER(MouseHook)).contents
                point = (data.pt.x, data.pt.y)
                if message == 0x201:
                    self.swallow_up = True
                    self.events.put(('down', point))
                elif self.swallow_up:
                    self.events.put(('up', point))
                    self.swallow_up = False
                else:
                    return user32.CallNextHookEx(None, code, message, address)
                return 1
            except Exception as error:
                self.events.put(('error', str(error)))
                return 1
        return user32.CallNextHookEx(None, code, message, address)

    def key_callback(self, code, message, address):
        if code >= 0:
            data = ct.cast(address, ct.POINTER(KeyHook)).contents
            if data.vkCode in {27, 123}:
                if message in {0x100, 0x104}:
                    self.cancel()
                return 1
        return user32.CallNextHookEx(None, code, message, address)

    def drain(self):
        while not self.events.empty():
            kind, value = self.events.get()
            if kind == 'error':
                raise RuntimeError(value)
            if kind == 'down':
                self.pressed_point = value
            elif kind == 'up' and self.pressed_point is not None:
                # Resolve on the worker, never inside the time-limited OS hook.
                self.refresh()
                if self.cancelled.is_set():
                    return False
                self.selected = self.candidate(self.pressed_point)
                self.pressed_point = None
                if self.selected:
                    return True
        return False

    def _track(self):
        """Slow window queries and IPC must never run on the input hook thread."""
        try:
            self.refresh()
            if self.cancelled.is_set():
                return
            self.emit({'kind': 'window_pick_started'})
            deadline = time.monotonic() + self.timeout
            last_point = None
            last_probe = 0
            while not self.cancelled.is_set():
                if self.drain():
                    self.tracking_result = {'selected': self.selected, 'cancelled': False}
                    return
                now = time.monotonic()
                if now >= deadline:
                    self.tracking_result = {'selected': None, 'cancelled': True, 'reason': 'timeout'}
                    return
                if now - self.last_refresh >= 1:
                    self.refresh()
                if self.cancelled.is_set():
                    return
                point = wt.POINT()
                if user32.GetCursorPos(ct.byref(point)):
                    position = (point.x, point.y)
                    # Mouse movement gets a 30 Hz highlight; a stationary cursor
                    # only needs occasional checks for a moving/replaced window.
                    if position != last_point or now - last_probe >= .2:
                        self.hover(position)
                        last_point, last_probe = position, now
                self.cancelled.wait(1 / 30)
        except Exception as error:
            self.tracking_error = error
        finally:
            self.wake_listener()

    def _listen(self):
        # GetMessage blocks until input arrives and dispatches low-level hooks
        # immediately. Never put polling sleeps, window enumeration or stdout
        # writes here: Windows waits synchronously for these callbacks.
        message = wt.MSG()
        user32.PeekMessageW(ct.byref(message), None, 0, 0, 0)
        with self.thread_lock:
            self.thread_id = kernel32.GetCurrentThreadId()
        mouse = keyboard = None
        try:
            if self.cancelled.is_set():
                return {'selected': None, 'cancelled': True, 'reason': 'cancelled'}
            self.mouse_hook_callback = HOOKPROC(self.mouse_callback)
            self.key_hook_callback = HOOKPROC(self.key_callback)
            module = kernel32.GetModuleHandleW(None)
            mouse = user32.SetWindowsHookExW(14, self.mouse_hook_callback, module, 0)
            if not mouse:
                raise RuntimeError('无法启动窗口选择鼠标监听，请检查管理员权限')
            keyboard = user32.SetWindowsHookExW(13, self.key_hook_callback, module, 0)
            if not keyboard:
                raise RuntimeError('无法启动窗口选择取消键监听，请检查管理员权限')
            self.tracker = threading.Thread(target=self._track, daemon=True)
            self.tracker.start()
            while not self.cancelled.is_set():
                status = user32.GetMessageW(ct.byref(message), None, 0, 0)
                if status == -1:
                    raise RuntimeError('窗口选择鼠标消息循环异常')
                if status == 0:
                    break
                user32.TranslateMessage(ct.byref(message))
                user32.DispatchMessageW(ct.byref(message))
            if self.cancelled.is_set():
                return {'selected': None, 'cancelled': True, 'reason': 'cancelled'}
            if self.tracking_error:
                raise self.tracking_error
            return self.tracking_result or {'selected': None, 'cancelled': True, 'reason': 'cancelled'}
        finally:
            # Release global input hooks before waiting for a possibly slow
            # background query to finish. Late work checks cancelled before IPC.
            if keyboard:
                user32.UnhookWindowsHookEx(keyboard)
            if mouse:
                user32.UnhookWindowsHookEx(mouse)
            with self.thread_lock:
                self.thread_id = None
            self.cancelled.set()
            if self.tracker:
                self.tracker.join(.25)

    def _run(self):
        try:
            result = self._listen()
        except Exception as error:
            self.active = False
            self.future.set_exception(error)
        else:
            self.active = False
            self.future.set_result(result)
