"""Real Win32 pairing smoke with two disposable windows in separate processes.

Creates only test fixtures; never connects to or sends input to an actual game.
"""
import ctypes as ct
from ctypes import wintypes as wt
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from echo_test.backend import GameWindow, user32
from echo_test.native_windows import get_long
from echo_test.window_pair import NativeToolbarPair, adjacent


def fixture(kind):
    user32.CreateWindowExW.argtypes = [wt.DWORD, wt.LPCWSTR, wt.LPCWSTR, wt.DWORD,
                                       ct.c_int, ct.c_int, ct.c_int, ct.c_int,
                                       wt.HWND, wt.HMENU, wt.HINSTANCE, wt.LPVOID]
    user32.CreateWindowExW.restype = wt.HWND
    handle = user32.CreateWindowExW(0, 'STATIC', 'ECHO_TEST pairing test: ' + kind,
                                   0x00CF0000, 100, 300, 600 if kind == 'game' else 380, 700,
                                   None, None, None, None)
    if not handle:
        raise ct.WinError(ct.get_last_error())
    user32.ShowWindow(handle, 4)
    print(json.dumps({'handle': handle, 'pid': os.getpid()}), flush=True)
    message = wt.MSG()
    while True:
        while user32.PeekMessageW(ct.byref(message), None, 0, 0, 1):
            user32.TranslateMessage(ct.byref(message)); user32.DispatchMessageW(ct.byref(message))
        time.sleep(0.005)


def verify():
    children = []
    events = []
    pair = NativeToolbarPair(events.append)
    result = {}

    def create(kind):
        child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '--fixture', kind],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                 creationflags=subprocess.CREATE_NO_WINDOW)
        children.append(child)
        line = child.stdout.readline()
        if not line:
            raise RuntimeError(child.stderr.read())
        return json.loads(line)

    def wait(check, label):
        end = time.monotonic() + 4
        while time.monotonic() < end:
            if pair.error:
                raise RuntimeError(pair.error)
            if check():
                return
            time.sleep(0.02)
        raise AssertionError(label + ' timeout')

    def properties(handle):
        return (get_long(handle, -8), get_long(handle, -16), get_long(handle, -20), pair.rect(handle)[2:])

    def move(handle, dx, dy):
        x, y, _, _ = pair.rect(handle)
        assert user32.SetWindowPos(handle, None, x+dx, y+dy, 0, 0, 0x15)

    try:
        game, bar = create('game'), create('toolbar')
        gh, bh = game['handle'], bar['handle']
        original = properties(gh)
        result['attached'] = pair.attach(GameWindow(gh, 'ECHO_TEST pairing test', game['pid']), bh, bar['pid'])
        assert result['attached']['edge'] == 'right'
        assert get_long(bh, -8) == gh
        assert properties(gh) == original
        edge = result['attached']['edge']
        move(gh, 80, 30)
        wait(lambda: pair.rect(bh) == adjacent(pair.rect(gh), pair.rect(bh), edge), 'game follows')
        expected_game = pair.rect(gh)
        time.sleep(0.15)
        assert pair.rect(gh) == expected_game, 'movement feedback loop'
        result['game_move'] = True
        move(bh, 60, 20)
        wait(lambda: pair.rect(gh) == adjacent(pair.rect(bh), pair.rect(gh), edge, False), 'toolbar follows')
        assert properties(gh) == original
        result['toolbar_move'] = True
        user32.ShowWindow(gh, 6)
        wait(lambda: not user32.IsWindowVisible(bh), 'toolbar hides with game')
        user32.ShowWindow(gh, 4)
        wait(lambda: user32.IsWindowVisible(bh), 'toolbar restores with game')
        result['game_minimize_restore'] = True
        user32.ShowWindow(bh, 6)
        wait(lambda: user32.IsIconic(gh), 'toolbar minimizes game')
        user32.ShowWindow(gh, 4)
        wait(lambda: user32.IsWindowVisible(bh) and not user32.IsIconic(bh), 'toolbar restores')
        result['toolbar_minimize_restore'] = True
        pair.detach()
        assert get_long(bh, -8) == 0
        before = pair.rect(gh)
        move(bh, 30, 15); time.sleep(0.15)
        assert pair.rect(gh) == before
        assert properties(gh) == original
        result['unlink'] = True
        pair.attach(GameWindow(gh, 'ECHO_TEST pairing test', game['pid']), bh, bar['pid'])
        children[0].terminate(); children[0].wait(3)
        wait(lambda: any(event.get('game_closed') for event in events), 'game closure')
        result['game_close'] = True
        result['events'] = events
        result['passed'] = True
        return result
    finally:
        try:
            pair.detach()
        finally:
            for child in children:
                if child.poll() is None:
                    child.terminate(); child.wait(3)
                child.stdout.close(); child.stderr.close()
            output = ROOT / 'artifacts' / 'smoke' / 'window-pair-native.json'
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    if '--fixture' in sys.argv:
        fixture(sys.argv[-1])
    else:
        print(json.dumps(verify(), ensure_ascii=False, indent=2))
