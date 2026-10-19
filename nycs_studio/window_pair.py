"""Keep the recording toolbar beside the selected native game, without reparenting it."""
import ctypes as ct
from ctypes import wintypes as wt
import threading
import time
from .backend import user32, kernel32
from .native_windows import get_long, checked_long, CALLBACK


class MonitorInfo(ct.Structure):
    _fields_ = [('size', wt.DWORD), ('monitor', wt.RECT), ('work', wt.RECT), ('flags', wt.DWORD)]


user32.MonitorFromWindow.argtypes = [wt.HWND, wt.DWORD]
user32.MonitorFromWindow.restype = wt.HANDLE
user32.GetMonitorInfoW.argtypes = [wt.HANDLE, ct.POINTER(MonitorInfo)]
user32.GetMonitorInfoW.restype = wt.BOOL


def placement(game, toolbar, work, gap=8):
    """Choose a nonoverlapping edge, fitting the whole pair when space permits."""
    gx, gy, gw, gh = game
    _, _, tw, th = toolbar
    wx, wy, ww, wh = work
    candidates = [('right', gw + tw + gap, max(gh, th)),
                  ('left', gw + tw + gap, max(gh, th)),
                  ('below', max(gw, tw), gh + th + gap),
                  ('above', max(gw, tw), gh + th + gap)]
    edge, width, height = next((row for row in candidates if row[1] <= ww and row[2] <= wh), candidates[0])
    # An undersized monitor cannot fit two full windows. Keep the game visible;
    # the toolbar can still be moved with it rather than covering its client area.
    fits = width <= ww and height <= wh
    if not fits:
        return edge, game, adjacent(game, toolbar, edge), False
    bx = gx - (tw + gap if edge == 'left' else 0)
    by = gy - (th + gap if edge == 'above' else 0)
    bx = min(max(bx, wx), wx + ww - width)
    by = min(max(by, wy), wy + wh - height)
    new_game = (bx + (tw + gap if edge == 'left' else 0),
                by + (th + gap if edge == 'above' else 0), gw, gh)
    return edge, new_game, adjacent(new_game, toolbar, edge), True


def adjacent(source, target, edge, source_is_game=True, gap=8):
    x, y, w, h = source
    _, _, tw, th = target
    if source_is_game:
        x, y = {'above': (x, y - th - gap), 'below': (x, y + h + gap),
                'right': (x + w + gap, y), 'left': (x - tw - gap, y)}[edge]
    else:
        x, y = {'above': (x, y + h + gap), 'below': (x, y - th - gap),
                'right': (x - tw - gap, y), 'left': (x + w + gap, y)}[edge]
    return x, y, tw, th


class NativeToolbarPair:
    def __init__(self, emit=None):
        self.emit = emit or (lambda event: None)
        self.lock = threading.RLock()
        self.state = None
        self.thread = None
        self.thread_id = 0
        self.ready = threading.Event()
        self.stopping = threading.Event()
        self.error = None
        self.dpi_context = user32.GetThreadDpiAwarenessContext()

    @staticmethod
    def pid(handle):
        if not user32.IsWindow(handle):
            return None
        pid = wt.DWORD()
        user32.GetWindowThreadProcessId(handle, ct.byref(pid))
        return pid.value

    @staticmethod
    def rect(handle):
        rect = wt.RECT()
        if not user32.GetWindowRect(handle, ct.byref(rect)):
            raise RuntimeError('无法读取捆绑窗口位置')
        return rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top

    def valid(self):
        s = self.state
        return bool(s and self.pid(s['game']) == s['game_pid'] and self.pid(s['toolbar']) == s['toolbar_pid'])

    def attach(self, game, toolbar, toolbar_pid):
        self.detach()
        if game.handle == toolbar or self.pid(game.handle) != game.pid or self.pid(toolbar) != toolbar_pid:
            raise ValueError('游戏或工具栏窗口身份已变化，请重新连接')
        if get_long(game.handle, -16) & 0x40000000:
            raise ValueError('请先将游戏切换为独立窗口')
        if user32.IsIconic(game.handle):
            user32.ShowWindow(game.handle, 4)
        original_owner = int(get_long(toolbar, -8))
        game_rect, toolbar_rect = self.rect(game.handle), self.rect(toolbar)
        monitor = MonitorInfo(size=ct.sizeof(MonitorInfo))
        if not user32.GetMonitorInfoW(user32.MonitorFromWindow(game.handle, 2), ct.byref(monitor)):
            raise RuntimeError('无法读取游戏所在屏幕的可用区域')
        r = monitor.work
        edge, game_rect, toolbar_rect, fits = placement(game_rect, toolbar_rect, (r.left, r.top, r.right-r.left, r.bottom-r.top))
        self.state = {'game': game.handle, 'game_pid': game.pid, 'toolbar': toolbar,
                      'toolbar_pid': toolbar_pid, 'owner': original_owner, 'edge': edge,
                      'game_rect': game_rect, 'toolbar_rect': toolbar_rect, 'pending': None,
                      'hidden': False, 'drag': None, 'fits': fits}
        try:
            # The toolbar is owned by the game. The game's styles and owner stay intact.
            checked_long(toolbar, -8, game.handle)
            for handle, rect in [(game.handle, game_rect), (toolbar, toolbar_rect)]:
                if self.rect(handle) != rect:
                    if not user32.SetWindowPos(handle, 0, *rect, 0x04 | 0x10 | 0x200):
                        raise RuntimeError('无法放置游戏与工具栏，请检查管理员权限')
            self.state['game_rect'], self.state['toolbar_rect'] = self.rect(game.handle), self.rect(toolbar)
            self.error = None
            self.ready.clear()
            self.stopping.clear()
            self.thread = threading.Thread(target=self._listen, daemon=True, name='native-toolbar-pair')
            self.thread.start()
            if not self.ready.wait(3):
                raise RuntimeError('游戏与工具栏捆绑监听启动超时')
            if self.error:
                raise RuntimeError(self.error)
            return {'linked': True, 'handle': game.handle, 'fits': fits, 'edge': edge}
        except Exception:
            self.detach()
            raise

    def _listen(self):
        hooks = []
        callback = CALLBACK(self.on_event)
        message = wt.MSG()
        self.thread_id = kernel32.GetCurrentThreadId()
        previous = user32.SetThreadDpiAwarenessContext(self.dpi_context)
        try:
            if not previous:
                raise RuntimeError('无法同步捆绑窗口 DPI 坐标')
            user32.PeekMessageW(ct.byref(message), None, 0, 0, 0)
            for pid in {self.state['game_pid'], self.state['toolbar_pid']}:
                for first, last in [(0x8002, 0x800B), (0x000A, 0x0017)]:
                    hook = user32.SetWinEventHook(first, last, None, callback, pid, 0, 0)
                    if not hook:
                        raise RuntimeError('无法监听游戏与工具栏窗口')
                    hooks.append(hook)
            self.ready.set()
            while not self.stopping.is_set():
                if user32.MsgWaitForMultipleObjectsEx(0, None, 16, 0x04ff, 4) == 0xffffffff:
                    raise RuntimeError('游戏与工具栏位置监听已中断')
                while user32.PeekMessageW(ct.byref(message), None, 0, 0, 1):
                    user32.TranslateMessage(ct.byref(message))
                    user32.DispatchMessageW(ct.byref(message))
                self.sync()
        except Exception as error:
            self.error = str(error)
            try:
                self._release_owner()
            except Exception as cleanup_error:
                self.error += '；解绑失败：' + str(cleanup_error)
            self.emit({'kind': 'toolbar_pair_error', 'message': self.error})
        finally:
            for hook in hooks:
                user32.UnhookWinEvent(hook)
            if previous:
                user32.SetThreadDpiAwarenessContext(previous)
            self.ready.set()

    def on_event(self, hook, event, hwnd, object_id, child_id, thread_id, timestamp):
        with self.lock:
            s = self.state
            if not s or hwnd not in (s['game'], s['toolbar']) or object_id or child_id:
                return
            if event == 0x000A:
                s['drag'] = 'game' if hwnd == s['game'] else 'toolbar'
            elif event == 0x000B:
                s['drag'] = None
        # sync runs on the hook's message-loop thread and also polls current
        # rectangles during native drag loops where WinEvents are coalesced.

    def sync(self):
        with self.lock:
            s = self.state
            if not s:
                return
            if not self.valid():
                if self.pid(s['toolbar']) == s['toolbar_pid']:
                    user32.ShowWindow(s['toolbar'], 0)
                self._release_owner()
                self.stopping.set()
                self.emit({'kind': 'toolbar_pair_closed', 'handle': s['game'],
                           'game_closed': self.pid(s['game']) != s['game_pid']})
                return
            game, toolbar = s['game'], s['toolbar']
            if user32.IsIconic(game) or not user32.IsWindowVisible(game):
                if user32.IsWindowVisible(toolbar):
                    user32.ShowWindow(toolbar, 0)
                s['hidden'] = True
                return
            if s['hidden']:
                user32.ShowWindow(toolbar, 4)
                s['hidden'] = False
                s['game_rect'], s['toolbar_rect'] = self.rect(game), self.rect(toolbar)
                s['pending'] = None
                return
            if user32.IsIconic(toolbar):
                user32.ShowWindow(game, 6)
                s['hidden'] = True
                return
            actual = {'game': self.rect(game), 'toolbar': self.rect(toolbar)}
            pending = s['pending']
            if pending:
                target, point, started = pending
                if actual[target][:2] != point:
                    if time.monotonic() - started > 2:
                        raise RuntimeError('捆绑窗口移动未响应，请确认游戏窗口没有阻塞')
                    return
                s[target + '_rect'] = actual[target]
                s['pending'] = None
            changed = [name for name in ('game', 'toolbar') if actual[name] != s[name + '_rect']]
            if not changed:
                return
            source = s['drag'] if s['drag'] in changed else changed[0]
            target = 'toolbar' if source == 'game' else 'game'
            desired = adjacent(actual[source], actual[target], s['edge'], source == 'game')
            s[source + '_rect'] = actual[source]
            if actual[target][:2] == desired[:2]:
                s[target + '_rect'] = actual[target]
                return
            # One asynchronous foreign-window move at a time. No focus,
            # resizing, Z-order changes or queued intermediate drag positions.
            s['pending'] = (target, desired[:2], time.monotonic())
            if not user32.SetWindowPos(s[target], 0, desired[0], desired[1], 0, 0, 0x01 | 0x04 | 0x10 | 0x4000):
                s['pending'] = None
                raise RuntimeError('游戏与工具栏联动移动失败')

    def show(self):
        with self.lock:
            if not self.valid():
                raise RuntimeError('捆绑窗口已关闭，请重新连接')
            user32.ShowWindow(self.state['game'], 4)
            user32.ShowWindow(self.state['toolbar'], 4)
            self.state['hidden'] = False
            self.state['game_rect'] = self.rect(self.state['game'])
            self.state['toolbar_rect'] = self.rect(self.state['toolbar'])
            self.state['pending'] = None
            return {'linked': True}

    def _release_owner(self):
        with self.lock:
            s = self.state
            if s and self.pid(s['toolbar']) == s['toolbar_pid'] and int(get_long(s['toolbar'], -8)) == s['game']:
                owner = s['owner'] if s['owner'] and user32.IsWindow(s['owner']) else 0
                checked_long(s['toolbar'], -8, owner)

    def detach(self):
        self.stopping.set()
        if self.thread and self.thread.is_alive():
            if threading.current_thread() is self.thread:
                raise RuntimeError('不能在窗口监听线程中断开捆绑')
            self.thread.join(3)
            if self.thread.is_alive():
                raise RuntimeError('捆绑监听尚未停止，请稍后重试')
        self._release_owner()
        self.thread = None
        self.state = None
        return {'linked': False}
