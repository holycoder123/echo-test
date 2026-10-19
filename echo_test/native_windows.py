"""Native window declarations shared by the toolbar and legacy recovery."""
import ctypes as ct
from ctypes import wintypes as wt
from .backend import user32


get_long = user32.GetWindowLongPtrW if ct.sizeof(ct.c_void_p) == 8 else user32.GetWindowLongW
set_long = user32.SetWindowLongPtrW if ct.sizeof(ct.c_void_p) == 8 else user32.SetWindowLongW
get_long.argtypes = [wt.HWND, ct.c_int]
get_long.restype = ct.c_ssize_t
set_long.argtypes = [wt.HWND, ct.c_int, ct.c_ssize_t]
set_long.restype = ct.c_ssize_t
user32.GetParent.argtypes = [wt.HWND]
user32.GetParent.restype = wt.HWND
user32.GetWindowRect.argtypes = [wt.HWND, ct.POINTER(wt.RECT)]
user32.SetWindowPos.argtypes = [wt.HWND, wt.HWND, ct.c_int, ct.c_int, ct.c_int, ct.c_int, wt.UINT]
user32.IsWindowEnabled.argtypes = [wt.HWND]
user32.IsWindowEnabled.restype = wt.BOOL
CALLBACK = ct.WINFUNCTYPE(None, wt.HANDLE, wt.DWORD, wt.HWND, wt.LONG,
                         wt.LONG, wt.DWORD, wt.DWORD)
user32.SetWinEventHook.argtypes = [wt.DWORD, wt.DWORD, wt.HMODULE, CALLBACK,
                                 wt.DWORD, wt.DWORD, wt.DWORD]
user32.SetWinEventHook.restype = wt.HANDLE
user32.UnhookWinEvent.argtypes = [wt.HANDLE]
user32.UnhookWinEvent.restype = wt.BOOL
user32.PeekMessageW.argtypes = [ct.POINTER(wt.MSG), wt.HWND, wt.UINT, wt.UINT, wt.UINT]
user32.MsgWaitForMultipleObjectsEx.argtypes = [wt.DWORD, ct.POINTER(wt.HANDLE), wt.DWORD, wt.DWORD, wt.DWORD]
user32.MsgWaitForMultipleObjectsEx.restype = wt.DWORD
user32.GetThreadDpiAwarenessContext.restype = wt.HANDLE
user32.SetThreadDpiAwarenessContext.argtypes = [wt.HANDLE]
user32.SetThreadDpiAwarenessContext.restype = wt.HANDLE


def checked_long(handle, index, value):
    value = ct.c_ssize_t(value).value
    if user32.IsWindow(handle) and get_long(handle, index) == value:
        return
    ct.set_last_error(0)
    previous = set_long(handle, index, value)
    error = ct.get_last_error()
    if not previous and error and (not user32.IsWindow(handle) or get_long(handle, index) != value):
        raise RuntimeError(f"无法修改窗口样式（错误码 {error}），请以匹配的管理员权限运行")
