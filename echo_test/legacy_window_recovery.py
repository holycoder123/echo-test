"""Restore a game left docked by an older version, without offering docking."""
import json
from pathlib import Path
from .backend import window_title
from .native_windows import user32, get_long, checked_long, ct, wt


user32.SetParent.argtypes = [wt.HWND, wt.HWND]
user32.SetParent.restype = wt.HWND
user32.SetWindowRgn.argtypes = [wt.HWND, wt.HANDLE, wt.BOOL]
user32.EnableWindow.argtypes = [wt.HWND, wt.BOOL]
user32.EnableWindow.restype = wt.BOOL


def window_pid(handle):
    if not handle or not user32.IsWindow(handle):
        return None
    pid = wt.DWORD()
    user32.GetWindowThreadProcessId(handle, ct.byref(pid))
    return pid.value


def recover_legacy_window(path: Path):
    path = Path(path)
    if not path.exists():
        return False
    try:
        state = json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(state, dict):
            raise ValueError('恢复记录不是对象')
        for name in ('handle', 'pid', 'host', 'host_pid', 'parent', 'style', 'exstyle'):
            if type(state.get(name)) is not int or state[name] < 0:
                raise ValueError('恢复记录的窗口身份或样式无效')
        if not state['handle'] or not state['pid']:
            raise ValueError('恢复记录缺少目标窗口身份')
        if max(state['style'], state['exstyle']) > 0xffffffff:
            raise ValueError('恢复记录的窗口样式超出范围')
        rect = state.get('rect')
        if not isinstance(rect, list) or len(rect) != 4 or any(type(v) is not int or abs(v) > 100000 for v in rect) or min(rect[2:]) < 1:
            raise ValueError('恢复记录的窗口位置无效')
        if state.get('mode', 'child') not in ('child', 'docked'):
            raise ValueError('恢复记录的旧显示模式无效')
        if type(state.get('enabled', True)) is not bool:
            raise ValueError('恢复记录的输入状态无效')
    except (OSError, ValueError) as error:
        raise RuntimeError(f'无法读取旧版目标窗口恢复记录，请保留 {path.name}：{error}') from error

    game = state['handle']
    if window_pid(game) != state['pid']:
        # A closed game or a reused HWND must never change another window.
        path.unlink()
        return False
    if state['host'] and window_pid(state['host']) == state['host_pid']:
        raise RuntimeError('旧版工作台仍在运行，请正常关闭后重新启动，以恢复独立目标窗口')

    # Old snapshots did not record the original owner's PID. Restore ownership
    # only to a live window in the verified game process, avoiding HWND reuse.
    parent = state['parent'] if window_pid(state['parent']) == state['pid'] else 0
    if get_long(game, -16) & 0x40000000:
        ct.set_last_error(0)
        user32.SetParent(game, 0)
        if user32.GetParent(game):
            raise RuntimeError('旧版目标窗口无法脱离宿主，请保留恢复记录并以匹配的管理员权限重试')
    checked_long(game, -16, state['style'])
    checked_long(game, -20, state['exstyle'])
    checked_long(game, -8, parent)
    if not user32.SetWindowPos(game, -1 if state['exstyle'] & 8 else -2, *state['rect'], 0x20 | 0x10):
        raise RuntimeError('旧版目标窗口位置恢复失败，请保留恢复记录并重试')
    # The persisted snapshot has no native region object. Clear the old
    # viewport clipping so the complete native client area is visible again.
    if not user32.SetWindowRgn(game, None, True):
        raise RuntimeError('旧版目标窗口裁切恢复失败，请保留恢复记录并重试')
    user32.EnableWindow(game, state.get('enabled', True))
    if bool(user32.IsWindowEnabled(game)) != state.get('enabled', True):
        raise RuntimeError('旧版目标窗口输入状态恢复失败，请保留恢复记录并重试')
    user32.ShowWindow(game, 4)
    if not user32.IsWindowVisible(game):
        raise RuntimeError('旧版目标窗口仍不可见，请保留恢复记录并重试')
    path.unlink()
    return True
