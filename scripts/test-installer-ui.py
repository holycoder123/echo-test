"""Exercise the actual NSIS wizard without installing or launching the application.

Windows only; uses Python's standard library and Win32, with no desktop input.
Example:
  python scripts/test-installer-ui.py dist/echo-test-1.1.0-white-setup-x64.exe \
    --target .runtime/installer-build/ui-fresh --report artifacts/installer-ui.json
"""

import argparse
import ctypes as C
from ctypes import wintypes as W
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import time
import traceback
import winreg
import zlib


PROJECT = Path(__file__).resolve().parents[1]
U = C.WinDLL("user32", use_last_error=True)
G = C.WinDLL("gdi32", use_last_error=True)
K = C.WinDLL("kernel32", use_last_error=True)
CALLBACK = C.WINFUNCTYPE(W.BOOL, W.HWND, W.LPARAM)
UINT_PTR = C.c_size_t
LONG_PTR = C.c_ssize_t


def bind(dll, name, result, *args):
    fn = getattr(dll, name)
    fn.restype = result
    fn.argtypes = args
    return fn


bind(U, "EnumWindows", W.BOOL, CALLBACK, W.LPARAM)
bind(U, "EnumChildWindows", W.BOOL, W.HWND, CALLBACK, W.LPARAM)
bind(U, "GetWindowThreadProcessId", W.DWORD, W.HWND, C.POINTER(W.DWORD))
bind(U, "GetWindowTextW", C.c_int, W.HWND, W.LPWSTR, C.c_int)
bind(U, "GetClassNameW", C.c_int, W.HWND, W.LPWSTR, C.c_int)
bind(U, "GetDlgCtrlID", C.c_int, W.HWND)
bind(U, "GetDlgItem", W.HWND, W.HWND, C.c_int)
bind(U, "GetParent", W.HWND, W.HWND)
bind(U, "GetWindowLongW", W.LONG, W.HWND, C.c_int)
bind(U, "IsWindow", W.BOOL, W.HWND)
bind(U, "IsWindowEnabled", W.BOOL, W.HWND)
bind(U, "IsWindowVisible", W.BOOL, W.HWND)
bind(U, "ShowWindow", W.BOOL, W.HWND, C.c_int)
bind(U, "GetWindowRect", W.BOOL, W.HWND, C.POINTER(W.RECT))
bind(U, "GetClientRect", W.BOOL, W.HWND, C.POINTER(W.RECT))
bind(U, "ClientToScreen", W.BOOL, W.HWND, C.POINTER(W.POINT))
bind(U, "SetWindowPos", W.BOOL, W.HWND, W.HWND, C.c_int, C.c_int,
     C.c_int, C.c_int, W.UINT)
bind(U, "PostMessageW", W.BOOL, W.HWND, W.UINT, W.WPARAM, W.LPARAM)
bind(U, "SendMessageTimeoutW", LONG_PTR, W.HWND, W.UINT, W.WPARAM,
     W.LPARAM, W.UINT, W.UINT, C.POINTER(UINT_PTR))
bind(U, "GetWindowDC", W.HDC, W.HWND)
bind(U, "ReleaseDC", C.c_int, W.HWND, W.HDC)
bind(U, "PrintWindow", W.BOOL, W.HWND, W.HDC, W.UINT)
bind(G, "CreateCompatibleDC", W.HDC, W.HDC)
bind(G, "CreateCompatibleBitmap", W.HBITMAP, W.HDC, C.c_int, C.c_int)
bind(G, "SelectObject", W.HGDIOBJ, W.HDC, W.HGDIOBJ)
bind(G, "DeleteObject", W.BOOL, W.HGDIOBJ)
bind(G, "DeleteDC", W.BOOL, W.HDC)
bind(G, "GetDIBits", C.c_int, W.HDC, W.HBITMAP, W.UINT, W.UINT,
     C.c_void_p, C.c_void_p, W.UINT)
bind(K, "CreateToolhelp32Snapshot", W.HANDLE, W.DWORD, W.DWORD)
bind(K, "CloseHandle", W.BOOL, W.HANDLE)
bind(K, "OpenProcess", W.HANDLE, W.DWORD, W.BOOL, W.DWORD)
bind(K, "TerminateProcess", W.BOOL, W.HANDLE, W.UINT)
bind(K, "GetExitCodeProcess", W.BOOL, W.HANDLE, C.POINTER(W.DWORD))


class GuiThreadInfo(C.Structure):
    _fields_ = [("cbSize", W.DWORD), ("flags", W.DWORD),
                ("hwndActive", W.HWND), ("hwndFocus", W.HWND),
                ("hwndCapture", W.HWND), ("hwndMenuOwner", W.HWND),
                ("hwndMoveSize", W.HWND), ("hwndCaret", W.HWND),
                ("rcCaret", W.RECT)]


bind(U, "GetGUIThreadInfo", W.BOOL, W.DWORD, C.POINTER(GuiThreadInfo))


def thread_focus(root):
    info = GuiThreadInfo()
    info.cbSize = C.sizeof(info)
    thread_id = U.GetWindowThreadProcessId(root, None)
    if not U.GetGUIThreadInfo(thread_id, C.byref(info)):
        raise C.WinError(C.get_last_error())
    return info.hwndFocus


class ProcessEntry(C.Structure):
    _fields_ = [("dwSize", W.DWORD), ("cntUsage", W.DWORD),
                ("th32ProcessID", W.DWORD), ("th32DefaultHeapID", UINT_PTR),
                ("th32ModuleID", W.DWORD), ("cntThreads", W.DWORD),
                ("th32ParentProcessID", W.DWORD), ("pcPriClassBase", W.LONG),
                ("dwFlags", W.DWORD), ("szExeFile", W.WCHAR * 260)]


bind(K, "Process32FirstW", W.BOOL, W.HANDLE, C.POINTER(ProcessEntry))
bind(K, "Process32NextW", W.BOOL, W.HANDLE, C.POINTER(ProcessEntry))


def wait_for(check, description, timeout=10):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = check()
        if value:
            return value
        time.sleep(0.05)
    raise AssertionError("Timed out: " + description)


def enum_windows(parent=None):
    result = []

    @CALLBACK
    def callback(hwnd, _):
        result.append(hwnd)
        return True

    if parent is None:
        U.EnumWindows(callback, 0)
    else:
        U.EnumChildWindows(parent, callback, 0)
    return result


def send(hwnd, message, wparam=0, lparam=0):
    result = UINT_PTR()
    if not U.SendMessageTimeoutW(hwnd, message, wparam, lparam, 0x2, 1000,
                                 C.byref(result)):
        raise RuntimeError("Unresponsive installer control: %s" % hwnd)
    return result.value


def window_text(hwnd):
    buffer = C.create_unicode_buffer(4096)
    send(hwnd, 0x000D, len(buffer), C.addressof(buffer))  # WM_GETTEXT
    return buffer.value


def class_name(hwnd):
    buffer = C.create_unicode_buffer(256)
    U.GetClassNameW(hwnd, buffer, len(buffer))
    return buffer.value


def page_visible(hwnd, root):
    # The top-level window may start hidden. Check descendants' own style bits.
    while hwnd and hwnd != root:
        if not U.GetWindowLongW(hwnd, -16) & 0x10000000:
            return False
        hwnd = U.GetParent(hwnd)
    return True


def controls(root):
    return [{"hwnd": hwnd, "id": U.GetDlgCtrlID(hwnd),
             "class": class_name(hwnd), "text": window_text(hwnd)}
            for hwnd in enum_windows(root) if page_visible(hwnd, root)]


class LogFont(C.Structure):
    _fields_ = [("height", W.LONG), ("width", W.LONG),
                ("escapement", W.LONG), ("orientation", W.LONG),
                ("weight", W.LONG), ("italic", W.BYTE),
                ("underline", W.BYTE), ("strikeout", W.BYTE),
                ("charset", W.BYTE), ("outPrecision", W.BYTE),
                ("clipPrecision", W.BYTE), ("quality", W.BYTE),
                ("pitchAndFamily", W.BYTE), ("face", W.WCHAR * 32)]


bind(G, "GetObjectW", C.c_int, W.HGDIOBJ, C.c_int, C.c_void_p)


def control_diagnostics(root):
    origin = W.RECT()
    U.GetWindowRect(root, C.byref(origin))
    client_origin = W.POINT()
    U.ClientToScreen(root, C.byref(client_origin))
    result = controls(root)
    for item in result:
        hwnd = item["hwnd"]
        bounds = W.RECT()
        U.GetWindowRect(hwnd, C.byref(bounds))
        item["boundsInWindow"] = [bounds.left - origin.left, bounds.top - origin.top,
                                  bounds.right - bounds.left, bounds.bottom - bounds.top]
        item["boundsInClient"] = [bounds.left - client_origin.x, bounds.top - client_origin.y,
                                  bounds.right - bounds.left, bounds.bottom - bounds.top]
        item["visible"] = bool(U.IsWindowVisible(hwnd))
        item["enabled"] = bool(U.IsWindowEnabled(hwnd))
        item["style"] = hex(U.GetWindowLongW(hwnd, -16) & 0xFFFFFFFF)
        font_handle = send(hwnd, 0x0031)  # WM_GETFONT
        item["fontHandle"] = font_handle
        font = LogFont()
        if font_handle and G.GetObjectW(font_handle, C.sizeof(font), C.byref(font)):
            item["font"] = {"face": font.face, "height": font.height, "weight": font.weight}
    return result


def find_text(root, text, cls=None):
    return next((item["hwnd"] for item in controls(root)
                 if text in item["text"] and (not cls or item["class"] == cls)), 0)


def click(hwnd):
    if not hwnd or not U.IsWindowEnabled(hwnd):
        raise AssertionError("Missing or disabled installer button")
    # A synchronous BM_CLICK can deadlock on a modal MessageBox.
    if not U.PostMessageW(hwnd, 0x00F5, 0, 0):
        raise C.WinError(C.get_last_error())


def set_text(hwnd, value):
    buffer = C.create_unicode_buffer(value)
    send(hwnd, 0x000C, 0, C.addressof(buffer))  # WM_SETTEXT
    assert window_text(hwnd) == value, "Directory edit did not accept text"


def rect(hwnd):
    result = W.RECT()
    if not U.GetWindowRect(hwnd, C.byref(result)):
        raise C.WinError(C.get_last_error())
    return result.right - result.left, result.bottom - result.top


def client_size(hwnd):
    result = W.RECT()
    if not U.GetClientRect(hwnd, C.byref(result)):
        raise C.WinError(C.get_last_error())
    return result.right - result.left, result.bottom - result.top


def capture(hwnd, path):
    """Capture the window itself offscreen; encode a PNG with stdlib only."""
    width, height = rect(hwnd)
    source = U.GetWindowDC(hwnd)
    dc = G.CreateCompatibleDC(source)
    bitmap = G.CreateCompatibleBitmap(source, width, height)
    previous = G.SelectObject(dc, bitmap)
    try:
        if not U.PrintWindow(hwnd, dc, 2):
            if not U.PrintWindow(hwnd, dc, 0):
                raise RuntimeError("PrintWindow could not capture installer")
        G.SelectObject(dc, previous)
        previous = None
        # BITMAPINFOHEADER: negative height requests top-down BGRA pixels.
        header = C.create_string_buffer(struct.pack(
            "<IiiHHIIiiII", 40, width, -height, 1, 32, 0,
            width * height * 4, 0, 0, 0, 0))
        pixels = C.create_string_buffer(width * height * 4)
        if G.GetDIBits(dc, bitmap, 0, height, pixels, header, 0) != height:
            raise RuntimeError("GetDIBits failed")
        raw = pixels.raw
        rows = bytearray()
        for y in range(height):
            row = raw[y * width * 4:(y + 1) * width * 4]
            rows.append(0)  # PNG filter None
            rgb = bytearray(width * 3)
            rgb[0::3], rgb[1::3], rgb[2::3] = row[2::4], row[1::4], row[0::4]
            rows.extend(rgb)
        if len(set(rows)) < 3:
            raise AssertionError("Installer screenshot is blank")

        def chunk(kind, data):
            return (struct.pack(">I", len(data)) + kind + data
                    + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))

        path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(
            ">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows, 6)) + chunk(b"IEND", b""))
        return str(path)
    finally:
        if previous:
            G.SelectObject(dc, previous)
        G.DeleteObject(bitmap)
        G.DeleteDC(dc)
        U.ReleaseDC(hwnd, source)


def registry_state():
    result = {}
    prefix = "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\"
    for name in ("EchoTest", "EchoTest-InstallerTest"):
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, prefix + name, 0,
                                winreg.KEY_READ | winreg.KEY_WOW64_64KEY) as key:
                values = []
                for index in range(winreg.QueryInfoKey(key)[1]):
                    values.append(winreg.EnumValue(key, index))
                result[name] = sorted(values)
        except FileNotFoundError:
            result[name] = None
    return result


class Installer:
    def __init__(self, exe, target):
        startup = subprocess.STARTUPINFO()
        startup.dwFlags = subprocess.STARTF_USESHOWWINDOW
        startup.wShowWindow = 0  # SW_HIDE; immediately move any shown windows offscreen.
        # NSIS requires /D= to be the final argument, without quotes even for spaces.
        command = subprocess.list2cmdline([str(exe)])
        command += " /TESTINSTALL /D=" + str(target)
        self.process = subprocess.Popen(command, startupinfo=startup, cwd=PROJECT)
        self.pids = {self.process.pid}
        self.handles = {}
        self.root = None

    def windows(self):
        snapshot = K.CreateToolhelp32Snapshot(0x2, 0)
        if snapshot == C.c_void_p(-1).value:
            raise C.WinError(C.get_last_error())
        entries = []
        try:
            entry = ProcessEntry()
            entry.dwSize = C.sizeof(entry)
            more = K.Process32FirstW(snapshot, C.byref(entry))
            while more:
                entries.append((entry.th32ProcessID, entry.th32ParentProcessID))
                more = K.Process32NextW(snapshot, C.byref(entry))
        finally:
            K.CloseHandle(snapshot)
        for _ in range(4):
            self.pids.update(pid for pid, parent in entries if parent in self.pids)
        for pid in self.pids:
            if pid not in self.handles:
                handle = K.OpenProcess(0x1000 | 0x1, False, pid)
                if handle:
                    self.handles[pid] = handle
        result = []
        for hwnd in enum_windows():
            pid = W.DWORD()
            U.GetWindowThreadProcessId(hwnd, C.byref(pid))
            if pid.value in self.pids:
                U.SetWindowPos(hwnd, None, -30000, -30000, 0, 0,
                               0x1 | 0x4 | 0x10)  # NOSIZE|NOZORDER|NOACTIVATE
                if class_name(hwnd) == "#32770":
                    U.ShowWindow(hwnd, 4)  # SHOWNOACTIVATE after moving offscreen
                result.append(hwnd)
        return result

    def locate(self):
        for hwnd in self.windows():
            if class_name(hwnd) == "#32770" and "EchoTest" in window_text(hwnd):
                self.root = hwnd
                return hwnd
        return None

    def button(self, control_id):
        return U.GetDlgItem(self.root, control_id)

    def prompt(self):
        for hwnd in self.windows():
            if hwnd != self.root and find_text(hwnd, "确定退出安装向导"):
                return hwnd
        return None

    def exited(self):
        self.windows()
        for handle in self.handles.values():
            code = W.DWORD()
            if K.GetExitCodeProcess(handle, C.byref(code)) and code.value == 259:
                return False
        return self.process.poll() is not None

    def close(self):
        # Only handles retained from the launched process tree can be terminated.
        # Never click Next here: a failure must never continue to installation.
        try:
            self.windows()
            for handle in self.handles.values():
                code = W.DWORD()
                if K.GetExitCodeProcess(handle, C.byref(code)) and code.value == 259:
                    K.TerminateProcess(handle, 99)
            self.process.wait(timeout=5)
        finally:
            for handle in self.handles.values():
                K.CloseHandle(handle)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("installer", type=Path)
    parser.add_argument("--target", type=Path, required=True,
                        help="Fresh directory below .runtime/installer-build")
    parser.add_argument("--report", type=Path, required=True, help="JSON report path")
    parser.add_argument("--dpi", type=int, choices=(96, 144),
                        help="Require this actual desktop DPI; does not simulate scaling")
    args = parser.parse_args()
    installer, target, report_path = (p.resolve() for p in
                                       (args.installer, args.target, args.report))
    allowed = (PROJECT / ".runtime" / "installer-build").resolve()
    if not target.is_relative_to(allowed) or target == allowed:
        parser.error("--target must be a fresh child of .runtime/installer-build")
    if target.exists():
        parser.error("--target already exists; preserve it and select a fresh directory")
    if not installer.is_file() or installer.suffix.lower() != ".exe":
        parser.error("installer must be an existing .exe")
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report = {"passed": False, "installer": str(installer), "target": str(target),
              "installed": False, "checks": {}, "screenshots": {},
              "dpiNote": "Actual window DPI; awareness does not simulate 150% scaling."}
    before_registry = registry_state()
    wizard = None
    try:
        if hasattr(U, "SetProcessDpiAwarenessContext"):
            bind(U, "SetProcessDpiAwarenessContext", W.BOOL, W.HANDLE)(C.c_void_p(-4))
        wizard = Installer(installer, target)
        root = wait_for(wizard.locate, "installer main window", timeout=30)
        time.sleep(0.3)
        report["windowTitle"] = window_text(root)
        report["initialControls"] = control_diagnostics(root)
        report["screenshots"]["welcome"] = capture(
            root, report_path.with_name(report_path.stem + "-welcome.png"))
        version = json.loads((PROJECT / "package.json").read_text("utf-8"))["version"]
        assert "EchoTest" in report["windowTitle"] and version in report["windowTitle"], (
            "Installer title must identify EchoTest " + version)
        assert find_text(root, "欢迎使用 EchoTest"), "Missing custom welcome title 欢迎使用 EchoTest"
        dpi = bind(U, "GetDpiForWindow", W.UINT, W.HWND)(root)
        report["dpi"] = dpi
        if args.dpi:
            assert dpi == args.dpi, "Actual DPI is %s, requested %s" % (dpi, args.dpi)
        width, height = rect(root)
        report["windowSize"] = [width, height]
        scale = dpi / 96
        assert abs(width - 736 * scale) <= 12 * scale, "Unexpected wizard width"
        assert abs(height - 600 * scale) <= 12 * scale, "Unexpected wizard height"
        report["checks"]["welcomeAndDimensions"] = True
        click(wizard.button(1))

        def options():
            edits = [item["hwnd"] for item in controls(root) if item["class"] == "Edit"]
            return edits[0] if edits else None

        edit = wait_for(options, "installation directory edit")
        desktop = find_text(root, "创建桌面快捷方式", "Button")
        mcp = find_text(root, "创建 MCP 启动快捷方式", "Button")
        assert desktop and U.IsWindowEnabled(desktop), "Missing or disabled desktop shortcut checkbox"
        assert not mcp, "Removed MCP shortcut option is still visible"
        report["checks"]["mcpShortcutOptionAbsent"] = True
        report["optionsControls"] = control_diagnostics(root)
        report["screenshots"]["options"] = capture(
            root, report_path.with_name(report_path.stem + "-options.png"))
        report["checks"]["optionsPresent"] = True
        browse = find_text(root, "更改", "Button")
        assert browse and U.IsWindowEnabled(browse), "Missing directory browse button"
        send(root, 0x0028, edit, 1)  # WM_NEXTDLGCTL establishes the starting focus.
        wait_for(lambda: thread_focus(root) == edit, "directory edit has keyboard focus")
        # Queue actual Tab messages in the installer's dialog loop; no global input.
        if not U.PostMessageW(edit, 0x0100, 9, 0x000F0001):
            raise C.WinError(C.get_last_error())
        if not U.PostMessageW(edit, 0x0101, 9, 0xC00F0001):
            raise C.WinError(C.get_last_error())
        wait_for(lambda: thread_focus(root) == browse, "Tab advances from directory to browse")
        report["checks"]["queuedTabMovesToBrowse"] = True
        for label, invalid in (("relative", "relative-install-folder"),
                               ("driveRoot", Path(os.environ.get("SystemDrive", "C:")) / "\\"),
                               ("windows", os.environ.get("WINDIR", r"C:\Windows"))):
            set_text(edit, str(invalid))
            click(wizard.button(1))
            wait_for(lambda: find_text(root, "请输入有效的安装文件夹。"),
                     "inline invalid-path error for " + label)
            assert options() == edit, "Invalid directory advanced past options"
            assert window_text(edit) == str(invalid), "Rejected directory unexpectedly changed"
            assert not target.exists(), "UI test unexpectedly installed files"
            report["checks"][label + "Rejected"] = True
        report["screenshots"]["invalidDirectory"] = capture(
            root, report_path.with_name(report_path.stem + "-invalid-directory.png"))
        set_text(edit, str(target))
        # Exercise a real click in both states even when defaults start unchecked.
        if send(desktop, 0x00F0) == 0:
            click(desktop)
            wait_for(lambda: send(desktop, 0x00F0) == 1, "desktop checkbox checked")
        click(desktop)
        wait_for(lambda: send(desktop, 0x00F0) == 0, "desktop checkbox unchecked")
        click(wizard.button(3))
        wait_for(lambda: find_text(root, "欢迎使用 EchoTest"), "Back to welcome")
        click(wizard.button(1))
        edit = wait_for(options, "return to options")
        assert window_text(edit) == str(target), "Directory lost after Back/Next"
        desktop = find_text(root, "创建桌面快捷方式", "Button")
        mcp = find_text(root, "创建 MCP 启动快捷方式", "Button")
        assert send(desktop, 0x00F0) == 0, "Desktop choice lost after Back/Next"
        assert not mcp, "Removed MCP shortcut option returned after Back/Next"
        report["preservedOptions"] = {"directory": str(target), "desktop": False}
        report["checks"]["optionsPersistAfterBack"] = True
        click(wizard.button(2))
        prompt = wait_for(wizard.prompt, "cancel confirmation")
        click(U.GetDlgItem(prompt, 7))  # IDNO
        wait_for(lambda: not U.IsWindow(prompt), "dismiss cancel confirmation with No")
        assert options(), "Declining cancel did not retain options page"
        assert window_text(edit) == str(target), "Declining cancel lost directory"
        report["checks"]["cancelNoStays"] = True
        click(wizard.button(2))
        prompt = wait_for(wizard.prompt, "second cancel confirmation")
        click(U.GetDlgItem(prompt, 6))  # IDYES
        wait_for(wizard.exited, "installer exits after cancel Yes")
        report["checks"]["cancelYesExits"] = True
        report["passed"] = True
    except Exception as error:
        report["error"] = str(error)
        report["traceback"] = traceback.format_exc()
        if wizard and wizard.root and U.IsWindow(wizard.root):
            try:
                report["finalControls"] = controls(wizard.root)
                report["screenshots"]["failure"] = capture(
                    wizard.root, report_path.with_name(report_path.stem + "-failure.png"))
            except Exception as capture_error:
                report["captureError"] = str(capture_error)
    finally:
        if wizard:
            try:
                wizard.close()
            except Exception as close_error:
                report["passed"] = False
                report["cleanupError"] = str(close_error)
        report["checks"]["noInstallationCreated"] = not target.exists()
        report["checks"]["uninstallRegistryUnchanged"] = before_registry == registry_state()
        if not all(report["checks"].values()):
            report["passed"] = False
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), "utf-8")
    print(json.dumps({"passed": report["passed"], "report": str(report_path),
                      "error": report.get("error")}, ensure_ascii=False))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
