"""Read-only check that an installation's own workbench is not still running."""
import ctypes as ct
from ctypes import wintypes as wt
import json
from pathlib import Path
import sys


def check(root):
    root = Path(root).resolve()
    expected = root/'node_modules'/'electron'/'dist'/'electron.exe'
    for name in ['workbench-state.json', 'embed-recovery.json']:
        state = root/'.runtime'/name
        if not state.exists():
            continue
        data = json.loads(state.read_text(encoding='utf-8'))
        pid = data.get('host_pid')
        if not isinstance(pid, int) or pid <= 0:
            continue
        kernel = ct.WinDLL('kernel32', use_last_error=True)
        kernel.OpenProcess.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
        kernel.OpenProcess.restype = wt.HANDLE
        kernel.QueryFullProcessImageNameW.argtypes = [wt.HANDLE, wt.DWORD, wt.LPWSTR, ct.POINTER(wt.DWORD)]
        kernel.CloseHandle.argtypes = [wt.HANDLE]
        process = kernel.OpenProcess(0x1000, False, pid)
        if not process:
            if ct.get_last_error() == 5:
                return 2
            continue
        try:
            output = ct.create_unicode_buffer(32768)
            size = wt.DWORD(len(output))
            if not kernel.QueryFullProcessImageNameW(process, 0, output, ct.byref(size)):
                return 2
            if Path(output.value).resolve() == expected:
                return 1
        finally:
            kernel.CloseHandle(process)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(check(sys.argv[1]))
    except Exception:
        sys.exit(2)
