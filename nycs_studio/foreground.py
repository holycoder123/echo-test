"""Short-lived foreground permission broker, started by the user-facing Electron app.

Grant only our existing service process; do not change the global foreground lock.
The OS may still deny the request. The backend always verifies actual activation.
"""
import ctypes as ct
from ctypes import wintypes as wt
import json
import sys


def grant(pid):
    if not 0 < pid < 0xffffffff:
        raise ValueError("无效的测试服务进程")
    user32 = ct.WinDLL("user32", use_last_error=True)
    user32.AllowSetForegroundWindow.argtypes = [wt.DWORD]
    user32.AllowSetForegroundWindow.restype = wt.BOOL
    success = bool(user32.AllowSetForegroundWindow(pid))
    return {"granted": success, "error": 0 if success else ct.get_last_error()}


if __name__ == "__main__":
    print(json.dumps(grant(int(sys.argv[1]))), flush=True)
