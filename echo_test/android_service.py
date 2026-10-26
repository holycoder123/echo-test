"""Android RPC operations, bound to one explicitly connected device."""
import time
import math
import re
from uuid import uuid4

from .android import Adb, AndroidBackend, AndroidRecorder, serial_value


class AndroidService:
    def __init__(self, service, root):
        self.service, self.adb = service, Adb(root)
        self.connection = None
        self.ui_snapshot = None

    def backend(self, target=None, stop=None):
        if not self.connection:
            raise ValueError('请先连接安卓设备')
        serial = serial_value((target or {}).get('serial'))
        if serial != self.connection['serial']:
            raise ValueError('安卓目标设备已变化，请重新连接')
        return AndroidBackend(self.adb, serial, stop)

    def frame(self, backend):
        from .service import png
        screen = backend.capture()
        self.connection.update(width=screen.width, height=screen.height)
        return {'id':uuid4().hex, 'image':png(screen), 'width':screen.width, 'height':screen.height}

    def call(self, method, args):
        service = self.service
        if method == 'android_hierarchy':
            service.idle()
            backend = self.backend(args.get('target'))
            snapshot = backend.hierarchy()
            snapshot.update(id=uuid4().hex, serial=backend.serial)
            self.ui_snapshot = snapshot
            return snapshot
        if method == 'android_ui_pick':
            service.idle()
            backend = self.backend(args.get('target'))
            snapshot = self.ui_snapshot
            if not snapshot or snapshot['serial'] != backend.serial or snapshot['id'] != args.get('snapshot_id'):
                raise ValueError('安卓控件树已变化，请重新读取')
            from .android_ui import selector_for
            node_id = args.get('node_id')
            if type(node_id) is not int:
                raise ValueError('无效的安卓控件节点')
            return {'ui':selector_for(snapshot, node_id)}
        if method == 'android_stream_info':
            backend = self.backend(args.get('target'))
            return {'serial':backend.serial,'adb_path':self.adb.resolve()}
        if method == 'android_devices':
            service.idle()
            return {**self.adb.devices(), 'connection':self.connection}
        if method == 'android_configure':
            service.idle()
            if self.connection:
                raise ValueError('请先断开安卓设备，再修改 ADB 路径')
            previous = self.adb.executable or ''
            return {'adb_path':self.adb.configure(args['path']), 'previous_path':previous}
        if method in {'android_pair', 'android_network_connect'}:
            service.idle()
            return self.adb.network(args.get('endpoint'), args.get('code') if method == 'android_pair' else None)
        if method == 'android_connect':
            service.idle()
            self.ui_snapshot = None
            serial = serial_value(args.get('serial'))
            device = self.adb.require_device(serial)
            output = self.adb.run(['shell', 'wm', 'size'], serial=serial)
            sizes = re.findall(r'(?:Physical|Override) size:\s*(\d+)x(\d+)', output)
            width, height = map(int, sizes[-1]) if sizes else (0, 0)
            if not (0 < width <= 16384 and 0 < height <= 16384):
                raise ValueError('无法读取安卓屏幕尺寸，请检查设备连接')
            self.connection = {**device, 'platform':'android', 'width':width, 'height':height}
            return {'connection':self.connection}
        if method == 'android_disconnect':
            service.idle()
            self.ui_snapshot = None
            self.connection = None
            return {'connection':None}
        if method == 'android_frame':
            if service.running or (service.recorder and not isinstance(service.recorder, AndroidRecorder)):
                raise ValueError('请先停止执行或桌面录制')
            return self.frame(self.backend(args.get('target')))
        if method == 'android_launch':
            service.idle()
            backend = self.backend(args.get('target'))
            backend.launch(args.get('package'))
            return self.frame(backend)
        if method == 'android_record_control':
            self.backend(args.get('target'))
            recorder = service.recorder
            if service.running or not isinstance(recorder, AndroidRecorder):
                raise ValueError('安卓录制已经结束')
            size = args.get('size')
            if not isinstance(size, list) or len(size) != 2 or any(type(v) is not int or not 1 <= v <= 8192 for v in size):
                raise ValueError('无效的录制画面尺寸')
            action, params = args.get('action'), args.get('params')
            if action not in {'tap', 'long_press', 'swipe', 'key', 'text'} or not isinstance(params, dict):
                raise ValueError('无效的安卓录制操作')
            now = time.time()*1000
            start, end = args.get('started_at'), args.get('ended_at')
            if any(type(v) not in (int, float) or not math.isfinite(v) for v in (start, end)) or not now-60000 <= start <= end <= now+1000 or end-start > 10500:
                raise ValueError('无效的安卓录制时间')
            ended = time.monotonic()-(now-end)/1000
            recorder.record(action, params, tuple(size), ended-(end-start)/1000, ended)
            return {'recorded':True}
        if method == 'android_action':
            if service.running or (service.recorder and not isinstance(service.recorder, AndroidRecorder)):
                raise ValueError('请先停止执行或桌面录制')
            backend = self.backend(args.get('target'))
            backend.capture()
            backend._geometry_verified = True
            size = backend.size()
            if args.get('frame_size') != list(size):
                raise ValueError('手机屏幕尺寸或方向已变化，请刷新预览后重试')
            recorder = service.recorder
            if recorder and ((recorder.size and recorder.size != size) or len(recorder.events) >= 10000):
                raise ValueError('录制方向已变化或操作数达到上限，请停止并保存本段录制')
            action, params = args.get('action'), args.get('params') or {}
            if not isinstance(params, dict):
                raise ValueError('无效的安卓操作参数')
            started = time.monotonic()
            if action == 'tap':
                backend.click(params['point'])
            elif action == 'long_press':
                duration = params.get('duration', 1)
                backend.duration(duration)
                backend.click(params['point'], hold=max(.5, duration))
            elif action == 'swipe':
                backend.drag(params['point'], params['end'], params.get('duration', .5))
            elif action == 'key':
                backend.key(params['keys'])
            elif action == 'text':
                backend.text(params['text'])
            else:
                raise ValueError('不支持的安卓预览操作')
            if recorder:
                recorder.record(action, params, size, started)
            return {'done':True}
        raise ValueError('不支持的安卓命令')
