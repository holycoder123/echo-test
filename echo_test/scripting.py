"""Execute cancellable Python steps in a separate interpreter process."""
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import threading
import time
from uuid import uuid4

MAX_CODE = 256 * 1024
MAX_OUTPUT = 256 * 1024


def validate_code(code):
    if not isinstance(code, str) or not code.strip():
        raise ValueError('Python 脚本不能为空')
    if len(code.encode('utf-8')) > MAX_CODE:
        raise ValueError('Python 脚本不能超过 256 KB')
    try:
        compile(code, '<自定义 Python 脚本>', 'exec')
    except (SyntaxError, ValueError) as error:
        line = getattr(error, 'lineno', None)
        raise ValueError(f'Python 脚本语法错误{f"（第 {line} 行）" if line else ""}：{error}') from error


def read_script(path):
    path = Path(path)
    if path.suffix.lower() != '.py' or not path.is_file():
        raise ValueError('请选择 .py 脚本文件')
    if path.stat().st_size > MAX_CODE:
        raise ValueError('Python 脚本不能超过 256 KB')
    try:
        code = path.read_text(encoding='utf-8-sig')
    except UnicodeError as error:
        raise ValueError('请将 Python 脚本保存为 UTF-8 编码') from error
    validate_code(code)
    return {'code': code, 'name': path.stem}


def execute_script(runner, step, record):
    validate_code(step.params.get('code'))
    runner.directory.mkdir(parents=True, exist_ok=True)
    stem = 'script_' + uuid4().hex[:8]
    source = runner.directory / (stem + '.py')
    output = runner.directory / (stem + '.log')
    source.write_text(step.params['code'], encoding='utf-8')
    record.update(script=source.name, output_file=output.name)
    base_dir = runner.vision.base_dir.resolve()
    base_dir.mkdir(parents=True, exist_ok=True)
    environment = dict(os.environ, PYTHONIOENCODING='utf-8', PYTHONUTF8='1', PYTHONUNBUFFERED='1')
    process = subprocess.Popen([sys.executable, '-X', 'utf8', '-u', str(Path(__file__).with_name('script_worker.py'))],
                               cwd=base_dir, env=environment, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True, encoding='utf-8', errors='replace',
                               creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    deadline = time.monotonic() + step.timeout
    scope_deadlines = []
    messages = queue.Queue(maxsize=256)
    reading_done = threading.Event()
    readers = []
    def read(stream, label):
        while not reading_done.is_set():
            text = stream.readline(65536)
            if not text:
                text = None
            while not reading_done.is_set():
                try:
                    messages.put((label, text), timeout=.05)
                    break
                except queue.Full:
                    continue
            if text is None:
                return
    for stream, label in [(process.stdout, 'stdout'), (process.stderr, 'stderr')]:
        reader = threading.Thread(target=read, args=(stream, label), daemon=True, name='python-step-output')
        reader.start(); readers.append(reader)
    output_size = 0
    emitted = 0
    def log(text):
        nonlocal output_size, emitted
        text = str(text)
        encoded = text.encode('utf-8')
        available = MAX_OUTPUT - output_size
        if available > 0:
            kept = encoded[:available].decode('utf-8', errors='ignore')
            log_file.write(kept); log_file.flush()
            record['output'] = (record.get('output', '') + kept)[-16000:]
            output_size += len(kept.encode('utf-8'))
            if emitted < 200 and kept.strip():
                runner.message(kind='log', message=f'[{step.name}] {kept.rstrip()}')
                emitted += 1
        if len(encoded) > available and not record.get('output_truncated'):
            record['output_truncated'] = True
            log_file.write('\n[脚本输出超过 256 KB，后续输出已省略]\n'); log_file.flush()
    def check():
        runner.backend.pause(0)
        if scope_deadlines and time.monotonic() >= min(scope_deadlines):
            raise TimeoutError('低代码 Python 步骤超过设定超时，已终止')
        if time.monotonic() >= deadline:
            raise TimeoutError(f'Python 脚本超过 {step.timeout:g} 秒，已终止')
    def reply(message):
        process.stdin.write(json.dumps(message, ensure_ascii=True) + '\n'); process.stdin.flush()
    job = None
    try:
        if os.name == 'nt':
            from .script_process import ScriptProcessJob
            job = ScriptProcessJob(process)
        with output.open('w', encoding='utf-8') as log_file:
            window = getattr(runner.backend, 'window', None)
            reply({'filename': str(source.resolve()), 'case_dir': str(base_dir), 'report_dir': str(runner.directory.resolve()),
                   'step_name': step.name, 'variables': runner.script_variables,
                   'selectors': [{'name': s.name, 'library_id': s.library_id} for s in runner.project.selectors],
                   'window': {'handle': getattr(window, 'handle', None), 'pid': getattr(window, 'pid', None)}})
            ended = set()
            while True:
                check()
                try:
                    stream, line = messages.get(timeout=.05)
                except queue.Empty:
                    if process.poll() is not None:
                        raise RuntimeError(f'Python 脚本进程意外退出（退出码 {process.returncode}）')
                    continue
                if line is None:
                    ended.add(stream)
                    if len(ended) == 2:
                        raise RuntimeError(f'Python 脚本进程意外退出（退出码 {process.poll()}）')
                    continue
                if stream == 'stderr':
                    log(line); continue
                try:
                    event = json.loads(line)
                except (ValueError, TypeError):
                    log(line); continue
                if not isinstance(event, dict):
                    log(line); continue
                kind = event.get('kind')
                if kind == 'output':
                    log(event.get('text', ''))
                elif kind == 'error':
                    error = str(event.get('error', 'Python 脚本执行失败'))
                    log(error)
                    raise RuntimeError(error)
                elif kind == 'done':
                    variables = event.get('variables')
                    if not isinstance(variables, dict):
                        raise RuntimeError('Python 脚本返回了无效的 variables')
                    runner.script_variables.clear()
                    runner.script_variables.update(variables)
                    return
                elif kind == 'call':
                    if event.get('method') == 'begin_step':
                        from .models import number
                        timeout = event.get('args', {}).get('timeout')
                        number(timeout, 'Python 步骤超时', .1, 600)
                        if len(scope_deadlines) >= 8:
                            raise ValueError('Python 步骤最多嵌套 8 层')
                        scope_deadlines.append(time.monotonic()+timeout)
                        reply({'ok': True})
                        continue
                    if event.get('method') == 'end_step':
                        if not scope_deadlines:
                            raise ValueError('Python 步骤超时作用域无效')
                        scope_deadlines.pop()
                        reply({'ok': True})
                        continue
                    operation = {'method': event.get('method'), 'args': event.get('args'), 'status': 'running'}
                    operations = record.setdefault('operations', [])
                    operation_size = len(json.dumps(operation, ensure_ascii=True))
                    if len(operations) < 1000 and record.get('operations_size', 0)+operation_size <= MAX_OUTPUT:
                        operations.append(operation)
                        record['operations_size'] = record.get('operations_size', 0)+operation_size
                    else:
                        record['operations_truncated'] = True
                    try:
                        value = game_call(runner, event.get('method'), event.get('args'), min([deadline]+scope_deadlines))
                        check()
                        operation['status'] = 'passed'
                        reply({'ok': True, 'value': value})
                    except Exception as error:
                        operation.update(status='stopped' if runner.backend.cancelled() else 'failed', error=str(error))
                        check()  # Cancellation and step deadline cannot be caught by user code.
                        reply({'ok': False, 'error': str(error)})
                else:
                    log(line)
    finally:
        if job:
            job.close()
        if process.poll() is None:
            try:
                process.terminate()
            except ProcessLookupError:
                pass
            try:
                process.wait(1)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait(1)
        reading_done.set()
        for reader in readers:
            reader.join(.5)
        for stream in (process.stdin, process.stdout, process.stderr):
            stream.close()


def game_call(runner, method, args, deadline):
    from .models import number
    from .vision import coordinate
    from .models import Selector
    if not isinstance(args, dict):
        raise ValueError('目标应用操作参数无效')
    backend = runner.backend
    def duration(value, label='时间'):
        number(value, label, 0, 600)
        if value > max(0, deadline-time.monotonic()):
            raise TimeoutError('目标应用操作所需时间超过脚本剩余时间')
        return value
    def target(value):
        value = target_name(value)
        if isinstance(value, str):
            if value not in runner.targets:
                raise ValueError(f'控件不存在：{value}')
            timeout = args.get('timeout', 5)
            number(timeout, '控件定位超时', .1, 600)
            return runner.resolve(value, min(timeout, max(.001, deadline-time.monotonic())))
        if isinstance(value, (list, tuple)) and len(value) == 2:
            for coordinate_value in value:
                number(coordinate_value, '坐标', 0, 100000)
            return coordinate(Selector('脚本坐标', normalized=False, x=value[0], y=value[1]), backend.size())
        raise ValueError('目标需要控件名称或客户区像素坐标 (x, y)')
    def target_name(value):
        if isinstance(value, dict):
            if set(value) == {'control_id'}:
                from dataclasses import asdict
                matches = [s for s in runner.targets.values() if s.library_id == value['control_id']]
                # The control library appends historical-name aliases after the
                # current definition. Equivalent aliases refer to one control.
                definitions = [{key: item for key, item in asdict(s).items() if key != 'name'} for s in matches]
                if not matches or any(item != definitions[0] for item in definitions[1:]):
                    raise ValueError(f'控件标识不存在或不唯一：{value["control_id"]}')
                return matches[0].name
            if set(value) == {'control_name'} and isinstance(value['control_name'], str):
                return value['control_name']
            raise ValueError('控件引用无效')
        return value
    if method == 'size':
        return backend.size()
    if method == 'locate':
        return target(args.get('target'))
    if method == 'click':
        count = args.get('count', 1)
        if type(count) is not int or not 1 <= count <= 1000:
            raise ValueError('点击次数必须在 1 ~ 1000 之间')
        button = args.get('button', 'left')
        if button not in {'left', 'right', 'middle'}:
            raise ValueError('不支持的鼠标按钮')
        hold, interval = duration(args.get('hold', 0)), duration(args.get('interval', .12))
        duration(count*hold + max(0, count-1)*interval)
        point = target(args.get('target'))
        duration(count*hold + max(0, count-1)*interval)
        backend.click(point, count=count, button=button, interval=interval, hold=hold)
    elif method == 'drag':
        start, end = target(args.get('start')), target(args.get('end'))
        start = target(args.get('start'))
        extra = {}
        path = args.get('path')
        if path:
            if not isinstance(path, list) or len(path) > 5000:
                raise ValueError('无效的拖动轨迹')
            for point in path:
                if not isinstance(point, (list, tuple)) or len(point) != 2:
                    raise ValueError('拖动轨迹点必须是 [x,y]')
                for value in point:
                    number(value, '轨迹比例', 0, 1)
            width, height = backend.size()
            extra['path'] = [(round(x*(width-1)), round(y*(height-1))) for x, y in path]
        button = args.get('button', 'left')
        if button not in {'left', 'right', 'middle'}:
            raise ValueError('不支持的鼠标按钮')
        if button != 'left':
            extra['button'] = button
        backend.drag(start, end, duration(args.get('duration', 1)), **extra)
    elif method == 'scroll':
        amount, axis = args.get('amount', -3), args.get('axis', 'vertical')
        if type(amount) is not int or not -100 <= amount <= 100 or amount == 0 or axis not in {'vertical', 'horizontal'}:
            raise ValueError('滚动格数或方向无效')
        backend.scroll(target(args.get('target')), amount, axis)
    elif method in {'key', 'key_down', 'key_up', 'text'}:
        value = args.get('text' if method == 'text' else 'keys')
        if not isinstance(value, str) or len(value) > 4000:
            raise ValueError('按键或文本需要不超过 4000 字符的字符串')
        getattr(backend, method)(value)
    elif method == 'sleep':
        backend.pause(duration(args.get('seconds', 0)))
    elif method in {'assert_image', 'assert_absent', 'wait_ui', 'assert_ui', 'assert_ui_absent'}:
        name = target_name(args.get('target'))
        native = method in {'wait_ui', 'assert_ui', 'assert_ui_absent'}
        if name not in runner.targets or runner.targets[name].kind != ('android_ui' if native else 'image'):
            raise ValueError('安卓控件等待 / 断言需要安卓 UI 控件名称' if native else '图片断言需要图片控件名称')
        timeout = args.get('timeout', 5)
        number(timeout, '控件定位超时', .1, 600)
        return runner.resolve(name, min(timeout, max(.001, deadline-time.monotonic())), absent=method in {'assert_absent', 'assert_ui_absent'})
    elif method == 'screenshot':
        path = runner.directory / ('script_screen_' + uuid4().hex[:8] + '.png')
        backend.capture().save(path)
        return str(path.resolve())
    else:
        raise ValueError('不支持的目标应用操作：' + str(method))
