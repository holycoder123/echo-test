"""Read-only checks for an explicitly requested workbench MCP start.

These checks never send window messages, close a window, terminate a process,
or request elevation. The launcher retains its existing user-confirmed start.
"""
from __future__ import annotations

import ctypes as ct
from ctypes import wintypes as wt
import json
import os
from pathlib import Path
import re
import time


MAX_STATE_BYTES = 16 * 1024


class McpStartupError(RuntimeError):
    """A startup state requiring a concrete user action, not dependency setup."""


def _read_json(filename: Path):
    try:
        before = filename.lstat()
    except FileNotFoundError:
        return None
    if filename.is_symlink() or filename.parent.is_symlink() or not filename.is_file():
        raise McpStartupError("工作台运行状态文件不能使用符号链接或重定向目录。")
    if before.st_size > MAX_STATE_BYTES:
        raise McpStartupError("工作台运行状态文件过大，无法确认启动状态。")
    with filename.open("rb") as stream:
        opened = os.fstat(stream.fileno())
        if (before.st_dev, before.st_ino) != (opened.st_dev, opened.st_ino):
            raise McpStartupError("工作台运行状态文件已变化，请重新启动检查。")
        content = stream.read(MAX_STATE_BYTES + 1)
    if len(content) > MAX_STATE_BYTES:
        raise McpStartupError("工作台运行状态文件过大，无法确认启动状态。")
    try:
        value = json.loads(content.decode("utf-8"))
    except (ValueError, UnicodeError):
        raise McpStartupError("工作台运行状态文件尚未就绪或格式无效。") from None
    if not isinstance(value, dict):
        raise McpStartupError("工作台运行状态文件格式无效。")
    return value


def _default_apis():
    # Defer native imports when no running-workbench snapshot exists.
    from .backend import user32, kernel32
    user32.IsWindow.argtypes = [wt.HWND]
    user32.IsWindow.restype = wt.BOOL
    user32.GetWindowThreadProcessId.argtypes = [wt.HWND, ct.POINTER(wt.DWORD)]
    user32.GetWindowThreadProcessId.restype = wt.DWORD
    user32.GetWindowTextW.argtypes = [wt.HWND, wt.LPWSTR, ct.c_int]
    user32.GetWindowTextW.restype = ct.c_int
    kernel32.OpenProcess.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
    kernel32.OpenProcess.restype = wt.HANDLE
    kernel32.QueryFullProcessImageNameW.argtypes = [wt.HANDLE, wt.DWORD, wt.LPWSTR, ct.POINTER(wt.DWORD)]
    kernel32.QueryFullProcessImageNameW.restype = wt.BOOL
    kernel32.CloseHandle.argtypes = [wt.HANDLE]
    kernel32.CloseHandle.restype = wt.BOOL
    return user32, kernel32


def _path_key(value):
    return os.path.normcase(str(Path(value).resolve()))


def _main_window(root: Path, user32=None, kernel32=None):
    snapshot = None
    for candidate in (root / ".runtime" / "workbench-state.json", root / ".workbench-state.json"):
        snapshot = _read_json(candidate)
        if snapshot is not None:
            break
    if snapshot is None:
        return None
    handle, expected_pid = snapshot.get("host"), snapshot.get("host_pid")
    if (type(handle) is not int or handle <= 0 or type(expected_pid) is not int or
            expected_pid <= 0 or expected_pid > 0xFFFFFFFF):
        raise McpStartupError("工作台主窗口运行状态无效，请确认旧主窗口已正常退出后重试。")
    if user32 is None or kernel32 is None:
        user32, kernel32 = _default_apis()
    if not user32.IsWindow(handle):
        return None
    actual_pid = wt.DWORD()
    user32.GetWindowThreadProcessId(handle, ct.byref(actual_pid))
    if actual_pid.value != expected_pid:
        return None  # A closed window's handle was reused; it is not our instance.
    title = ct.create_unicode_buffer(512)
    user32.GetWindowTextW(handle, title, len(title))
    if not any(title.value == name or title.value.endswith(" · " + name) for name in ("EchoTest", "echo test")):
        raise McpStartupError("无法确认运行中的工作台主窗口身份，请确认“EchoTest”主窗口已正常退出后重试。")
    process = kernel32.OpenProcess(0x1000, False, expected_pid)
    if process:
        try:
            image = ct.create_unicode_buffer(32768)
            length = wt.DWORD(len(image))
            if kernel32.QueryFullProcessImageNameW(process, 0, image, ct.byref(length)):
                expected_image = root / "node_modules" / "electron" / "dist" / "electron.exe"
                if _path_key(image.value) != _path_key(expected_image):
                    raise McpStartupError("运行中的工作台进程身份已变化，请检查并正常退出旧主窗口后重试。")
            # Access denied does not make a known live administrator window closed.
        finally:
            kernel32.CloseHandle(process)
    return {"handle": handle, "pid": expected_pid}


def _connection(root: Path, pid: int):
    value = _read_json(root / ".runtime" / "mcp-connection.json")
    if value is None:
        return None
    endpoint = value.get("url")
    match = re.fullmatch(r"http://127\.0\.0\.1:(\d{1,5})/mcp", endpoint) if isinstance(endpoint, str) else None
    valid = (type(value.get("pid")) is int and value["pid"] == pid and
             isinstance(value.get("root"), str) and Path(value["root"]).is_absolute() and
             _path_key(value["root"]) == _path_key(root) and match is not None and
             1 <= int(match[1]) <= 65535 and
             isinstance(value.get("token"), str) and re.fullmatch(r"[a-f0-9]{64}", value["token"]) is not None and
             isinstance(value.get("version"), str) and re.fullmatch(r"[A-Za-z0-9.+_-]{1,64}", value["version"]) is not None)
    if not valid:
        # Never interpolate descriptor content or the credential into an error.
        raise McpStartupError("MCP 连接信息与当前工作台不匹配，请保存用例、正常退出主窗口后重试。")
    return {"already_enabled": True, "pid": pid}


def check_mcp_startup(root: Path, *, user32=None, kernel32=None):
    """Return an existing enabled instance, or refuse silent singleton reuse."""
    root = Path(root).resolve()
    main = _main_window(root, user32, kernel32)
    if main is None:
        return {"already_enabled": False}
    connection = _connection(root, main["pid"])
    if connection is not None:
        return connection
    raise McpStartupError(
        "已有未启用 MCP 的“EchoTest”正在运行。\n"
        "请先停止录制或执行，保存未保存用例，然后关闭“EchoTest”主窗口"
        "（不是“EchoTest · 窗口工具栏”）。如出现未保存或忙碌提示，请处理后正常退出。\n"
        "退出后再双击 start_admin_mcp.cmd。新启动参数不能应用到旧实例；本次没有关闭任何窗口。"
    )


def wait_for_mcp(root: Path, *, timeout=10.0, interval=.1, user32=None,
                 kernel32=None, monotonic=time.monotonic, sleep=time.sleep):
    """Wait for this root's live main window and matching server descriptor."""
    if not 0 < timeout <= 60 or not 0 < interval <= timeout:
        raise ValueError("Invalid MCP startup wait bounds")
    root = Path(root).resolve()
    deadline = monotonic() + timeout
    while True:
        try:
            main = _main_window(root, user32, kernel32)
            if main is not None:
                connection = _connection(root, main["pid"])
                if connection is not None:
                    return connection
        except McpStartupError:
            # The descriptor may still be being written by the new instance.
            pass
        remaining = deadline - monotonic()
        if remaining <= 0:
            break
        sleep(min(interval, remaining))
    raise McpStartupError(
        f"MCP 工作台未能在 {timeout:g} 秒内完成启动。操作系统接收启动请求不代表 MCP 已启用。\n"
        f"未找到与当前主窗口匹配的有效连接信息：{root / '.runtime' / 'mcp-connection.json'}\n"
        "请确认管理员启动提示已完成；保存用例并正常关闭“EchoTest”主窗口"
        "（不是工具栏），然后重新运行 start_admin_mcp.cmd。若主窗口已重新启动，"
        "请查看工作台中的“MCP 启动失败”提示或错误日志。本次没有关闭任何窗口。"
    )
