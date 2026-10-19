"""Request a normal close of our own workbench when applying a local update.

The Electron close handler retains its unsaved/busy guards and restores the
game before exit. This module never terminates a process or closes the game.
"""
from pathlib import Path
import ctypes as ct
from ctypes import wintypes as wt
import json
import time
from .backend import user32, kernel32, window_title
from .paths import runtime_file, workbench_snapshot


def close_workbench(root: Path, timeout=12):
    snapshot=workbench_snapshot(root)
    if snapshot is None:return {'closed':True,'reason':'no_connected_workbench'}
    state=json.loads(snapshot.read_text(encoding='utf-8'))
    host=int(state.get('workbench',state['host']));pid=wt.DWORD()
    if not user32.IsWindow(host):return {'closed':True,'reason':'already_closed'}
    user32.GetWindowThreadProcessId(host,ct.byref(pid))
    if pid.value!=state['host_pid'] or '诺亚测试工作台' not in window_title(host):
        raise RuntimeError('工作台身份已变化，停止重启')
    process=kernel32.OpenProcess(0x1000,False,pid.value)
    if not process:raise RuntimeError('无法验证工作台进程，请以匹配的管理员权限运行')
    try:
        query=kernel32.QueryFullProcessImageNameW
        query.argtypes=[wt.HANDLE,wt.DWORD,wt.LPWSTR,ct.POINTER(wt.DWORD)]
        query.restype=wt.BOOL
        name=ct.create_unicode_buffer(32768);size=wt.DWORD(len(name))
        if not query(process,0,name,ct.byref(size)) or Path(name.value).resolve()!=root/'node_modules/electron/dist/electron.exe':
            raise RuntimeError('该窗口不是本项目工作台，停止重启')
    finally:kernel32.CloseHandle(process)
    user32.ShowWindow(host,9)
    post=user32.PostMessageW
    post.argtypes=[wt.HWND,wt.UINT,wt.WPARAM,wt.LPARAM];post.restype=wt.BOOL
    if not post(host,0x10,0,0):raise RuntimeError('无法请求工作台正常退出')
    deadline=time.monotonic()+timeout
    while user32.IsWindow(host) and time.monotonic()<deadline:time.sleep(.1)
    result={'closed':not bool(user32.IsWindow(host)),'host':host,'host_pid':pid.value}
    if not result['closed']:result['reason']='请处理工作台的未保存修改或运行状态提示，正常退出后重试'
    return result


if __name__=='__main__':
    root=Path(__file__).resolve().parents[1]
    try:result=close_workbench(root)
    except Exception as error:result={'closed':False,'error':str(error)}
    runtime_file('workbench-close.json',root).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
