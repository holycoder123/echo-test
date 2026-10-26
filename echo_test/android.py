"""ADB device transport and the Android implementation of the runner backend."""
from __future__ import annotations

import io
import math
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import time
from uuid import uuid4

from PIL import Image

from .models import Project, Selector, Step


class AndroidStopped(RuntimeError):
    pass


def serial_value(value):
    if not isinstance(value, str) or not re.fullmatch(r"(?:[A-Za-z0-9_]|\[)[A-Za-z0-9_.:\[\]-]{0,199}", value):
        raise ValueError("无效的安卓设备序列号")
    return value


def endpoint_value(value):
    if not isinstance(value, str) or not re.fullmatch(r"(?:[A-Za-z0-9][A-Za-z0-9.-]*|\[[0-9a-fA-F:]+\]):[0-9]{1,5}", value):
        raise ValueError("请输入设备地址和端口，例如 192.168.1.10:37123")
    if not 1 <= int(value.rsplit(':', 1)[1]) <= 65535:
        raise ValueError("设备端口需在 1 ~ 65535 之间")
    return value


class Adb:
    def __init__(self, root, executable=None):
        self.root = Path(root)
        self.executable = executable

    def configure(self, executable):
        path = Path(executable).expanduser().resolve() if executable else None
        if path and (path.name.lower() not in {'adb.exe', 'adb'} or not path.is_file()):
            raise ValueError("请选择 Android SDK Platform-Tools 中的 adb.exe")
        previous = self.executable
        self.executable = str(path) if path else None
        try:
            self.run(['version'])
        except Exception:
            self.executable = previous
            raise
        return self.resolve()

    def resolve(self):
        candidates = [self.executable, os.environ.get('ECHO_TEST_ADB'),
                      self.root / 'runtime' / 'android' / 'platform-tools' / 'adb.exe']
        for key in ('ANDROID_HOME', 'ANDROID_SDK_ROOT'):
            if os.environ.get(key):
                candidates.append(Path(os.environ[key]) / 'platform-tools' / 'adb.exe')
        candidates += [Path(os.environ.get('LOCALAPPDATA', '')) / 'Android' / 'Sdk' / 'platform-tools' / 'adb.exe', shutil.which('adb')]
        for candidate in candidates:
            if candidate and Path(candidate).is_file():
                return str(candidate)
        raise RuntimeError("未找到 ADB。请重新安装完整 EchoTest 恢复内置 ADB，或在「设置 → 环境设置」中更换 ADB。")

    def run(self, arguments, *, serial=None, binary=False, stop=None, timeout=12):
        command = [self.resolve()]
        if serial is not None:
            command += ['-s', serial_value(serial)]
        command += list(arguments)
        if stop and stop():
            raise AndroidStopped("用户停止执行")
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        deadline = time.monotonic() + timeout
        try:
            while True:
                if stop and stop():
                    raise AndroidStopped("用户停止执行")
                if time.monotonic() >= deadline:
                    raise TimeoutError("ADB 请求超时，请检查设备连接后重试")
                try:
                    stdout, stderr = process.communicate(timeout=min(.1, max(.001, deadline-time.monotonic())))
                    break
                except subprocess.TimeoutExpired:
                    continue
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate()
        if process.returncode:
            detail = stderr.decode('utf-8', errors='replace').strip() or stdout.decode('utf-8', errors='replace').strip()
            raise RuntimeError("ADB 操作失败：" + detail[:1500])
        return stdout if binary else stdout.decode('utf-8', errors='replace').strip()

    def devices(self, stop=None):
        output = self.run(['devices', '-l'], stop=stop)
        devices = []
        for line in output.splitlines():
            parts = line.split()
            if len(parts) < 2 or parts[0] == 'List' or parts[0].startswith('*'):
                continue
            serial, state = parts[:2]
            metadata = dict(part.split(':', 1) for part in parts[2:] if ':' in part)
            devices.append({'serial': serial, 'state': state, 'model': metadata.get('model', serial).replace('_', ' '),
                            'transport': 'emulator' if serial.startswith('emulator-') else 'wifi' if ':' in serial else 'usb'})
        resolved = self.resolve()
        bundled = self.root / 'runtime' / 'android' / 'platform-tools' / 'adb.exe'
        source = 'bundled' if Path(resolved).resolve() == bundled.resolve() else 'external'
        return {'devices': devices, 'adb_path': resolved, 'adb_source': source}

    def require_device(self, serial, stop=None):
        serial_value(serial)
        device = next((item for item in self.devices(stop)['devices'] if item['serial'] == serial), None)
        if not device:
            raise RuntimeError("安卓设备已断开，请刷新设备列表后重新连接")
        if device['state'] != 'device':
            hint = '请解锁手机并允许 USB 调试授权' if device['state'] == 'unauthorized' else '设备离线，请重新连接 USB 或无线调试'
            raise RuntimeError(hint)
        return device

    def network(self, endpoint, code=None):
        endpoint_value(endpoint)
        if code is not None and (not isinstance(code, str) or not re.fullmatch(r'\d{6}', code)):
            raise ValueError("请输入手机显示的 6 位配对码")
        output = self.run(['connect', endpoint] if code is None else ['pair', endpoint, code], timeout=18)
        expected = ('connected to', 'already connected to') if code is None else ('successfully paired',)
        if not any(value in output.lower() for value in expected):
            raise RuntimeError("无线连接失败：" + output[:1000])
        return {'message': output}


class AndroidBackend:
    KEYS = {'BACK': 4, 'HOME': 3, 'APP_SWITCH': 187, 'ENTER': 66, 'RETURN': 66, 'TAB': 61, 'SPACE': 62,
            'BACKSPACE': 67, 'DELETE': 112, 'LEFT': 21, 'RIGHT': 22, 'UP': 19, 'DOWN': 20, 'ESC': 111, 'ESCAPE': 111}
    KEYS.update({chr(65 + index): 29 + index for index in range(26)})
    KEYS.update({str(index): 7 + index for index in range(10)})

    def __init__(self, adb, serial, stop=None):
        self.adb, self.serial, self.stop = adb, serial_value(serial), stop or (lambda: False)
        self._size = None

    def cancelled(self):
        return bool(self.stop())

    def pause(self, seconds):
        deadline = time.monotonic() + seconds
        while True:
            if self.cancelled():
                raise AndroidStopped("用户停止执行（停止按钮 / F12）")
            remaining = deadline-time.monotonic()
            if remaining <= 0:
                return
            time.sleep(min(.02, remaining))

    def command(self, *arguments, timeout=12):
        return self.adb.run(list(arguments), serial=self.serial, stop=self.stop, timeout=timeout)

    def activate(self, require_input=True):
        self.adb.require_device(self.serial, stop=self.stop)
        self.capture()

    def capture(self):
        data = self.adb.run(['exec-out', 'screencap', '-p'], serial=self.serial, binary=True, stop=self.stop)
        if len(data) > 64 * 1024 * 1024:
            raise RuntimeError("安卓截图超过大小限制")
        try:
            with Image.open(io.BytesIO(data)) as source:
                if source.width * source.height > 32 * 1024 * 1024:
                    raise ValueError("安卓截图尺寸过大")
                image = source.convert('RGB')
        except (OSError, ValueError) as error:
            raise RuntimeError("无法读取安卓截图，请检查设备是否允许截图") from error
        self._size = image.size
        return image

    def size(self):
        if self._size is None:
            self.capture()
        return self._size

    def hierarchy(self, timeout=12):
        from .android_ui import parse_hierarchy
        remote = '/data/local/tmp/echotest-ui-'+uuid4().hex+'.xml'
        started = time.monotonic()
        def remaining():
            value = timeout-(time.monotonic()-started)
            if value <= 0:
                raise TimeoutError('读取安卓控件树超时，界面可能持续变化或未暴露控件')
            return value
        try:
            output = self.command('shell', 'uiautomator', 'dump', '--compressed', remote, timeout=remaining())
            if 'dumped to:' not in output.lower():
                raise RuntimeError('无法读取安卓控件树：'+output[-500:]+'。界面可能未暴露控件，请使用图片或 OCR 定位。')
            data = self.adb.run(['exec-out', 'cat', remote], serial=self.serial, binary=True, stop=self.stop, timeout=remaining())
            size_output = self.command('shell', 'wm', 'size', timeout=remaining())
            sizes = re.findall(r'(?:Physical|Override) size:\s*(\d+)x(\d+)', size_output)
            if not sizes:
                raise ValueError('无法读取安卓屏幕尺寸')
            size = tuple(map(int, sizes[-1]))
            if any(not 0 < value <= 16384 for value in size):
                raise ValueError('安卓屏幕尺寸无效')
            snapshot = parse_hierarchy(data, size)
            self._size = snapshot['width'], snapshot['height']
            return snapshot
        except TimeoutError as error:
            raise TimeoutError('读取安卓 UI 控件树超时，请保持界面稳定，或增加步骤的定位超时；也可使用图片 / OCR。') from error
        finally:
            try:
                self.adb.run(['shell', 'rm', '-f', remote], serial=self.serial, timeout=2)
            except Exception:
                pass

    def find_ui(self, selector, timeout=12):
        from .android_ui import locate
        self.last_ui_diagnostic = {'method':'android_ui', 'matched':False, 'count':0, 'query':selector.ui}
        try:
            snapshot = self.hierarchy(timeout)
            node, count = locate(snapshot, selector.ui)
            self.last_ui_diagnostic = {'method':'android_ui', 'matched':node is not None, 'count':count, 'query':selector.ui,
                                       'reason':'已找到控件' if node else '未找到匹配的安卓 UI 控件'}
            if node:
                x, y, width, height = node['bounds']
                point = (x+width//2+selector.offset_x, y+height//2+selector.offset_y)
                self.point(point)
                self.last_ui_diagnostic['candidate'] = {'method':'android_ui', 'box':node['bounds'], 'point':point}
                return point
            return None
        except Exception as error:
            self.last_ui_diagnostic.update(matched=False, reason=str(error))
            raise

    def verify_geometry(self):
        if getattr(self, '_geometry_verified', False):
            self._geometry_verified = False
            return
        expected = self._size
        self.capture()
        if expected and self._size != expected:
            raise ValueError('安卓屏幕方向或尺寸在定位后发生变化，请刷新画面后重新运行')

    def point(self, point):
        width, height = self.size()
        if len(point) != 2 or any(type(value) not in (int, float) or not math.isfinite(value) for value in point):
            raise ValueError("无效的安卓触控坐标")
        x, y = map(round, point)
        if not (0 <= x < width and 0 <= y < height):
            raise ValueError("触控坐标超出安卓屏幕")
        return str(x), str(y)

    @staticmethod
    def duration(value):
        if type(value) not in (int, float) or not math.isfinite(value) or not .01 <= value <= 10:
            raise ValueError("安卓长按 / 滑动时长需在 0.01 ~ 10 秒之间")
        return str(max(1, round(value * 1000)))

    def click(self, point, button='left', hold=.1, count=1, interval=.12):
        if button != 'left':
            raise ValueError("安卓仅支持触控点击，请使用左键")
        self.verify_geometry()
        x, y = self.point(point)
        for index in range(count):
            if hold >= .5:
                self.command('shell', 'input', 'swipe', x, y, x, y, self.duration(hold), timeout=hold+5)
            else:
                self.command('shell', 'input', 'tap', x, y)
            if index + 1 < count:
                self.pause(interval)

    def drag(self, start, end, duration=1, path=None, button='left'):
        if button != 'left' or (path and len(path) > 2):
            raise ValueError("安卓首版支持起点到终点的单指滑动")
        self.verify_geometry()
        self.command('shell', 'input', 'swipe', *self.point(start), *self.point(end), self.duration(duration), timeout=duration+5)

    def scroll(self, point, amount, axis='vertical'):
        width, height = self.size()
        x, y = map(int, point)
        distance = min(abs(amount) * .1, .7) * (height if axis == 'vertical' else width)
        # Positive desktop wheel values move towards the top/right.
        delta = round(distance if amount > 0 else -distance)
        end = (x, max(0, min(height-1, y+delta))) if axis == 'vertical' else (max(0, min(width-1, x-delta)), y)
        self.drag(point, end, .35)

    def key(self, chord):
        code = self.KEYS.get(chord.upper().strip())
        if code is None:
            raise ValueError("安卓不支持此按键组合；可使用 BACK、HOME、APP_SWITCH、ENTER 等单个按键")
        self.command('shell', 'input', 'keyevent', str(code))

    def text(self, text):
        if not isinstance(text, str) or not text.isascii() or any(ord(char) < 32 or ord(char) == 127 for char in text):
            raise ValueError("安卓首版文本输入支持 ASCII 可打印字符；中文请先在手机上输入")
        if not text:
            return
        if '%s' in text:
            raise ValueError("ADB 文本输入暂不支持字面量 %s")
        self.command('shell', 'input', 'text', shlex.quote(text.replace(' ', '%s')))

    def key_down(self, chord):
        raise ValueError("安卓不支持单独按下 / 松开键盘按键，请使用「按键」步骤")

    key_up = key_down

    def release_all(self):
        pass

    def launch(self, package):
        if not isinstance(package, str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+', package):
            raise ValueError("请输入应用包名，例如 com.example.app")
        resolved = self.command('shell', 'cmd', 'package', 'resolve-activity', '--brief', '-c', 'android.intent.category.LAUNCHER', package)
        activity = resolved.splitlines()[-1] if resolved else ''
        if not re.fullmatch(r'[A-Za-z0-9_.$]+/[A-Za-z0-9_.$]+', activity):
            raise RuntimeError("未找到应用启动入口，请检查包名和应用安装状态")
        output = self.command('shell', 'am', 'start', '-W', '-n', activity)
        if re.search(r'(?im)^Error', output):
            raise RuntimeError(output)

    @classmethod
    def validate_project(cls, project):
        for step in project.steps:
            if not step.enabled:
                continue
            if step.action in {'right_click', 'key_down', 'key_up'} or step.params.get('button', 'left') != 'left':
                raise ValueError(f"安卓不支持步骤「{step.name}」的鼠标或键盘动作")
            if step.action in {'drag', 'long_press'}:
                cls.duration(step.params.get('duration', 1))
            if step.action == 'drag' and len(step.params.get('path') or []) > 2:
                raise ValueError(f"步骤「{step.name}」包含曲线轨迹，安卓首版仅支持直线滑动")
            if step.action == 'key' and step.params.get('keys', 'ENTER').upper().strip() not in cls.KEYS:
                raise ValueError(f"安卓不支持步骤「{step.name}」的按键组合")


class AndroidRecorder:
    """Record successful operations issued through the preview, not physical phone touches."""
    def __init__(self, serial, emit):
        self.serial, self.emit = serial, emit
        self.start_time = time.monotonic()
        self.events = []
        self.project = Project('安卓录制用例')
        self.active = True
        self.last_end = 0
        self.size = None

    def diagnostics(self):
        return {'platform': 'android', 'serial': self.serial, 'listening': self.active, 'event_count': len(self.events)}

    def record(self, action, params, size, started, ended=None):
        if not self.active:
            return
        if len(self.events) >= 10000:
            raise ValueError("安卓录制最多 10000 个操作，请停止并保存")
        if self.size and self.size != size:
            raise ValueError("录制过程中屏幕方向发生变化，请结束本段录制后重新开始")
        self.size = size
        def target(point):
            name = f'安卓录制位置 {len(self.project.selectors)+1:02d}'
            self.project.selectors.append(Selector(name, x=point[0]/max(1,size[0]-1), y=point[1]/max(1,size[1]-1)))
            return name
        step = Step(name={'tap':'点击屏幕','long_press':'长按屏幕','swipe':'滑动屏幕','key':'安卓按键','text':'输入文本'}[action], delay=0)
        if self.project.steps:
            self.project.steps[-1].delay = round(min(600, max(0, started-self.start_time-self.last_end)), 3)
        if action in {'tap', 'long_press', 'swipe'}:
            step.target = target(params['point'])
            step.action = {'tap':'click','long_press':'long_press','swipe':'drag'}[action]
            if action != 'tap':
                step.params = {'duration': params.get('duration', 1)}
            if action == 'swipe':
                step.end_target = target(params['end'])
        else:
            step.action = action
            step.params = {'keys': params['keys']} if action == 'key' else {'text': params['text']}
        self.project.steps.append(step)
        self.last_end = (time.monotonic() if ended is None else ended)-self.start_time
        event = {'kind':'android', 'event':action, 't':round(self.last_end,3)}
        self.events.append(event)
        self.emit({'kind':'record_event', 'count':len(self.events), 'event':event})

    def stop(self):
        self.active = False
        return list(self.events)
