"""Native Windows input, restricted to the explicitly selected application window."""
from __future__ import annotations
import ctypes as ct
from ctypes import wintypes as wt
from dataclasses import dataclass
import os
import time
import ntpath
from PIL import ImageGrab

if os.name != "nt":
    raise RuntimeError("EchoTest仅支持 Windows")
user32 = ct.WinDLL("user32", use_last_error=True)
kernel32 = ct.WinDLL("kernel32", use_last_error=True)
advapi32 = ct.WinDLL("advapi32", use_last_error=True)
user32.SetProcessDPIAware()
# Mark only this tool's replay input. Touch/remote/accessibility input may also
# carry Windows' injected flag and must remain recordable within the game.
ECHO_INPUT_TAG = 0x4543484F


class MouseInput(ct.Structure):
    _fields_ = [("dx", wt.LONG), ("dy", wt.LONG), ("mouseData", wt.DWORD),
                ("dwFlags", wt.DWORD), ("time", wt.DWORD), ("dwExtraInfo", ct.c_size_t)]


class KeyboardInput(ct.Structure):
    _fields_ = [("wVk", wt.WORD), ("wScan", wt.WORD), ("dwFlags", wt.DWORD),
                ("time", wt.DWORD), ("dwExtraInfo", ct.c_size_t)]


class HardwareInput(ct.Structure):
    _fields_ = [("uMsg", wt.DWORD), ("wParamL", wt.WORD), ("wParamH", wt.WORD)]


class InputUnion(ct.Union):
    _fields_ = [("mi", MouseInput), ("ki", KeyboardInput), ("hi", HardwareInput)]


class Input(ct.Structure):
    _anonymous_ = ("payload",)
    _fields_ = [("type", wt.DWORD), ("payload", InputUnion)]


user32.GetForegroundWindow.restype = wt.HWND
user32.IsChild.argtypes = [wt.HWND, wt.HWND]
kernel32.GetCurrentThreadId.restype = wt.DWORD


def belongs_to_game(handle, game):
    return bool(handle and (handle == game or user32.IsChild(game, handle)))


def is_game_foreground(window):
    return user32.GetForegroundWindow() == window.handle
user32.GetAncestor.argtypes = [wt.HWND, wt.UINT]
user32.GetAncestor.restype = wt.HWND
user32.WindowFromPoint.argtypes = [wt.POINT]
user32.WindowFromPoint.restype = wt.HWND
user32.IsWindow.argtypes = [wt.HWND]
user32.IsIconic.argtypes = [wt.HWND]
user32.IsWindowVisible.argtypes = [wt.HWND]
user32.GetClientRect.argtypes = [wt.HWND, ct.POINTER(wt.RECT)]
user32.ClientToScreen.argtypes = [wt.HWND, ct.POINTER(wt.POINT)]
user32.GetWindowTextLengthW.argtypes = [wt.HWND]
user32.GetWindowTextW.argtypes = [wt.HWND, wt.LPWSTR, ct.c_int]
user32.GetWindowThreadProcessId.argtypes = [wt.HWND, ct.POINTER(wt.DWORD)]
user32.ShowWindow.argtypes = [wt.HWND, ct.c_int]
user32.SetForegroundWindow.argtypes = [wt.HWND]
user32.SetCursorPos.argtypes = [ct.c_int, ct.c_int]
user32.GetCursorPos.argtypes = [ct.POINTER(wt.POINT)]
user32.SendInput.argtypes = [wt.UINT, ct.POINTER(Input), ct.c_int]
user32.SendInput.restype = wt.UINT
user32.GetAsyncKeyState.argtypes = [ct.c_int]
user32.GetAsyncKeyState.restype = ct.c_short
kernel32.OpenProcess.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
kernel32.OpenProcess.restype = wt.HANDLE
kernel32.CloseHandle.argtypes = [wt.HANDLE]
kernel32.QueryFullProcessImageNameW.argtypes = [wt.HANDLE, wt.DWORD, wt.LPWSTR, ct.POINTER(wt.DWORD)]
kernel32.QueryFullProcessImageNameW.restype = wt.BOOL
advapi32.OpenProcessToken.argtypes = [wt.HANDLE, wt.DWORD, ct.POINTER(wt.HANDLE)]
advapi32.GetTokenInformation.argtypes = [wt.HANDLE, ct.c_int, ct.c_void_p, wt.DWORD, ct.POINTER(wt.DWORD)]


class Stopped(Exception):
    pass


def window_title(handle):
    length = user32.GetWindowTextLengthW(handle)
    text = ct.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(handle, text, length + 1)
    return text.value


@dataclass
class GameWindow:
    handle: int
    title: str
    pid: int
    process_name: str = ""


def process_executable_name(pid):
    """Return only the executable basename; inaccessible processes remain selectable."""
    process = kernel32.OpenProcess(0x1000, False, pid)
    if not process:
        return ""
    try:
        image = ct.create_unicode_buffer(32768)
        size = wt.DWORD(len(image))
        if kernel32.QueryFullProcessImageNameW(process, 0, image, ct.byref(size)):
            return ntpath.basename(image.value)
        return ""
    finally:
        kernel32.CloseHandle(process)


def list_game_windows(include_hidden=False):
    """Enumerate titled top-level application windows, regardless of product name."""
    results = []
    process_names = {}
    excluded_pids = {os.getpid()}
    host_pid = os.environ.get('ECHO_TEST_HOST_PID', '')
    if host_pid.isdecimal():
        excluded_pids.add(int(host_pid))
    user32.GetShellWindow.restype = wt.HWND
    user32.GetDesktopWindow.restype = wt.HWND
    shell = user32.GetShellWindow()
    desktop = user32.GetDesktopWindow()
    callback_type = ct.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    def collect(handle, _):
        if handle in (shell, desktop) or not (include_hidden or user32.IsWindowVisible(handle)):
            return True
        title = window_title(handle)
        if not title.strip():
            return True
        pid = wt.DWORD()
        user32.GetWindowThreadProcessId(handle, ct.byref(pid))
        if not pid.value or pid.value in excluded_pids:
            return True
        rectangle = wt.RECT()
        has_client = bool(user32.GetClientRect(handle, ct.byref(rectangle)) and
                          rectangle.right > rectangle.left and rectangle.bottom > rectangle.top)
        # Some game clients report 0x0 while minimized. Keep their real main
        # window selectable; discovering a window must never restore or focus it.
        if not has_client and not user32.IsIconic(handle):
            return True
        if pid.value not in process_names:
            process_names[pid.value] = process_executable_name(pid.value)
        results.append(GameWindow(int(handle), title, pid.value, process_names[pid.value]))
        return True
    callback = callback_type(collect)
    user32.EnumWindows.argtypes = [callback_type, wt.LPARAM]
    user32.EnumWindows(callback, 0)
    return results


def is_admin():
    return bool(ct.windll.shell32.IsUserAnAdmin())


def elevation(pid):
    process = kernel32.OpenProcess(0x1000, False, pid)
    if not process:
        return None
    token = wt.HANDLE()
    try:
        if not advapi32.OpenProcessToken(process, 8, ct.byref(token)):
            return None
        value, size = wt.DWORD(), wt.DWORD()
        if not advapi32.GetTokenInformation(token, 20, ct.byref(value), ct.sizeof(value), ct.byref(size)):
            return None
        return bool(value.value)
    finally:
        if token:
            kernel32.CloseHandle(token)
        kernel32.CloseHandle(process)


class WindowsBackend:
    def __init__(self, window: GameWindow, stop=None):
        self.window = window
        self.stop = stop or (lambda: False)
        self.held_keys = set()

    def cancelled(self):
        return self.stop() or bool(user32.GetAsyncKeyState(0x7B) & 0x8000)  # F12

    def pause(self, seconds):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if self.cancelled():
                raise Stopped("用户停止执行（停止按钮 / F12）")
            time.sleep(min(.02, max(0, deadline - time.monotonic())))
        if self.cancelled():
            raise Stopped("用户停止执行（停止按钮 / F12）")

    def check_window(self):
        if not user32.IsWindow(self.window.handle):
            raise RuntimeError("所选目标窗口已关闭或发生变化，请重新连接")
        pid = wt.DWORD()
        user32.GetWindowThreadProcessId(self.window.handle, ct.byref(pid))
        if pid.value != self.window.pid:
            raise RuntimeError("目标应用进程已改变，请重新连接")
        if user32.IsIconic(self.window.handle):
            raise RuntimeError("目标窗口已最小化")

    def activate(self, require_input=True):
        if not user32.IsWindow(self.window.handle):
            raise RuntimeError("目标窗口已关闭")
        if require_input and elevation(self.window.pid) is True and not is_admin():
            raise RuntimeError("目标应用为管理员权限，但测试工具为普通权限。请右键启动文件，以管理员身份运行")
        target = self.window.handle
        user32.ShowWindow(target, 9)
        if user32.GetForegroundWindow() != target:
            user32.SetForegroundWindow(target)
        deadline = time.monotonic() + 1.5
        while user32.GetForegroundWindow() != target and time.monotonic() < deadline:
            self.pause(.05)
        if user32.GetForegroundWindow() != target:
            current = window_title(user32.GetForegroundWindow()) or "未知窗口"
            raise RuntimeError(f"无法激活所选目标应用，当前前台窗口为「{current}」。请确认选对客户端、关闭目标应用弹窗，并手动切换到目标应用后重试")
        self.pause(.1)
        self.check_foreground()

    def check_foreground(self):
        self.check_window()
        if not is_game_foreground(self.window):
            current = window_title(user32.GetForegroundWindow()) or "未知窗口"
            raise RuntimeError(f"目标窗口失去焦点，当前前台窗口为「{current}」，已停止输入。请关闭弹窗或切回所选目标应用")

    def rect(self):
        self.check_window()
        rect, origin = wt.RECT(), wt.POINT(0, 0)
        if not user32.GetClientRect(self.window.handle, ct.byref(rect)) or not user32.ClientToScreen(self.window.handle, ct.byref(origin)):
            raise RuntimeError("无法读取目标应用客户区")
        return origin.x, origin.y, rect.right, rect.bottom

    def size(self):
        _, _, width, height = self.rect()
        return width, height

    def capture(self):
        self.check_foreground()
        left, top, width, height = self.rect()
        if width < 10 or height < 10:
            raise RuntimeError("目标应用客户区不可见")
        virtual = (user32.GetSystemMetrics(76), user32.GetSystemMetrics(77), user32.GetSystemMetrics(78), user32.GetSystemMetrics(79))
        if left < virtual[0] or top < virtual[1] or left + width > virtual[0] + virtual[2] or top + height > virtual[1] + virtual[3]:
            raise RuntimeError("目标窗口部分位于屏幕之外，请将完整窗口移入屏幕")
        return ImageGrab.grab(bbox=(left, top, left + width, top + height), all_screens=True).convert("RGB")

    def _send(self, event):
        sent = user32.SendInput(1, ct.byref(event), ct.sizeof(Input))
        if sent != 1:
            raise RuntimeError(f"Windows 拒绝输入（错误码 {ct.get_last_error()}）。请检查管理员权限和交互桌面")

    def _mouse(self, flags, data=0):
        self._send(Input(type=0, mi=MouseInput(0, 0, data & 0xFFFFFFFF, flags, 0, ECHO_INPUT_TAG)))

    def move(self, point):
        self.pause(0)
        self.check_foreground()
        left, top, width, height = self.rect()
        x, y = point
        if not (0 <= x < width and 0 <= y < height):
            raise RuntimeError("鼠标坐标超出目标应用客户区")
        screen = wt.POINT(left + int(x), top + int(y))
        hit = user32.WindowFromPoint(screen)
        if not belongs_to_game(hit, self.window.handle):
            raise RuntimeError("目标坐标被其他窗口遮挡，已停止输入")
        if not user32.SetCursorPos(screen.x, screen.y):
            raise RuntimeError(f"无法移动鼠标（错误码 {ct.get_last_error()}），请检查权限 / 交互桌面")
        actual = wt.POINT()
        user32.GetCursorPos(ct.byref(actual))
        if abs(actual.x - screen.x) > 2 or abs(actual.y - screen.y) > 2:
            raise RuntimeError("鼠标未到达目标位置，可能被目标应用限制")

    def click(self, point, button="left", hold=.10, count=1, interval=.12):
        down, up = {"left": (0x2, 0x4), "right": (0x8, 0x10), "middle": (0x20, 0x40)}[button]
        self.move(point)
        self.pause(.10)
        for index in range(count):
            self.check_foreground()
            self._mouse(down)
            try:
                self.pause(hold)
            finally:
                self._mouse(up)
            if index + 1 < count:
                self.pause(interval)

    def scroll(self, point, amount, axis="vertical"):
        self.move(point)
        self.pause(.1)
        self.check_foreground()
        self._mouse(0x0800 if axis == "vertical" else 0x1000, int(amount) * 120)

    def drag(self, start, end, duration, path=None, button="left"):
        self.move(start)
        self.pause(.1)
        down, up = {"left": (0x2, 0x4), "right": (0x8, 0x10), "middle": (0x20, 0x40)}[button]
        self._mouse(down)
        try:
            steps = max(2, round(duration * 50)) if not path else len(path)
            for index in range(1, steps + 1):
                point = tuple(round(a + (b - a) * index / steps) for a, b in zip(start, end)) if not path else path[index-1]
                self.move(point)
                self.pause(duration / steps)
        finally:
            self._mouse(up)

    def _key(self, code, up=False, unicode=False):
        flags = (2 if up else 0) | (4 if unicode else 0)
        self._send(Input(type=1, ki=KeyboardInput(0 if unicode else code, code if unicode else 0, flags, 0, ECHO_INPUT_TAG)))

    def key_codes(self, chord):
        named = {"CTRL": 0x11, "CONTROL": 0x11, "ALT": 0x12, "SHIFT": 0x10,
                 "ENTER": 0x0D, "RETURN": 0x0D, "ESC": 0x1B, "ESCAPE": 0x1B,
                 "TAB": 9, "SPACE": 0x20, "BACKSPACE": 8, "DELETE": 0x2E,
                 "LEFT": 0x25, "UP": 0x26, "RIGHT": 0x27, "DOWN": 0x28,
                 "HOME": 0x24, "END": 0x23, "PAGEUP": 0x21, "PAGEDOWN": 0x22}
        named.update({"LCTRL": 0xA2, "RCTRL": 0xA3, "LSHIFT": 0xA0, "RSHIFT": 0xA1,
                      "LALT": 0xA4, "RALT": 0xA5, "CAPSLOCK": 0x14, "INSERT": 0x2D})
        codes = []
        for key in chord.upper().split("+"):
            key = key.strip()
            if key in named:
                codes.append(named[key])
            elif len(key) == 1 and key.isascii() and key.isalnum():
                codes.append(ord(key))
            elif key.startswith("F") and key[1:].isdigit() and 1 <= int(key[1:]) <= 11:
                codes.append(0x70 + int(key[1:]) - 1)
            elif key.startswith("VK_") and key[3:].isdigit() and 1 <= int(key[3:]) <= 255 and int(key[3:]) not in {0x5B, 0x5C, 0x7B}:
                codes.append(int(key[3:]))
            else:
                raise ValueError(f"不支持的按键：{key}（F12 保留为紧急停止）")
        return codes

    def key_down(self, chord):
        self.check_foreground()
        for code in self.key_codes(chord):
            self.pause(0)
            if code not in self.held_keys:
                self._key(code)
                self.held_keys.add(code)

    def key_up(self, chord):
        self.check_foreground()
        for code in reversed(self.key_codes(chord)):
            if code in self.held_keys:
                self._key(code, up=True)
                self.held_keys.discard(code)

    def release_all(self):
        failures = []
        for code in list(self.held_keys):
            try:
                self._key(code, up=True)
            except Exception as error:
                failures.append(str(error))
            finally:
                self.held_keys.discard(code)
        if failures:
            raise RuntimeError("部分按键未能释放：" + "; ".join(failures))

    def key(self, chord):
        self.check_foreground()
        codes = self.key_codes(chord)
        pressed = []
        try:
            for code in codes:
                self.pause(0)
                self.check_foreground()
                self._key(code)
                pressed.append(code)
            self.pause(.08)
        finally:
            for code in reversed(pressed):
                self._key(code, up=True)

    def text(self, text):
        encoded = text.encode("utf-16-le")
        for offset in range(0, len(encoded), 2):
            self.pause(0)
            self.check_foreground()
            code = int.from_bytes(encoded[offset:offset + 2], "little")
            self._key(code, unicode=True)
            try:
                self.pause(.01)
            finally:
                self._key(code, up=True, unicode=True)
