"""Isolated Python step process. Game operations are performed by the runner."""
import json
from pathlib import Path
import sys
import threading
import traceback

_wire = sys.stdout
_write_lock = threading.Lock()
_rpc_lock = threading.Lock()


def send(message):
    with _write_lock:
        _wire.write(json.dumps(message, ensure_ascii=True) + '\n')
        _wire.flush()


class Output:
    encoding = 'utf-8'

    def __init__(self, stream):
        self.stream = stream
        self.pending = ''
        self.lock = threading.RLock()

    def _emit(self, text):
        for start in range(0, len(text), 2048):
            send({'kind': 'output', 'stream': self.stream, 'text': text[start:start+2048]})

    def write(self, text):
        text = str(text)
        with self.lock:
            self.pending += text
            while '\n' in self.pending:
                line, self.pending = self.pending.split('\n', 1)
                self._emit(line + '\n')
            if len(self.pending) >= 2048:
                self._emit(self.pending); self.pending = ''
        return len(text)

    def flush(self):
        with self.lock:
            self._emit(self.pending); self.pending = ''

    @property
    def buffer(self):
        return BinaryOutput(self)

    def fileno(self):
        return (_wire if self.stream == 'stdout' else sys.__stderr__).fileno()

    def isatty(self):
        return False


class BinaryOutput:
    def __init__(self, output):
        self.output = output

    def write(self, data):
        self.output.write(bytes(data).decode('utf-8', errors='replace'))
        return len(data)

    def flush(self):
        self.output.flush()


class Game:
    def __init__(self, info):
        self.handle = info.get('handle')
        self.pid = info.get('pid')

    def _call(self, method, **args):
        with _rpc_lock:
            send({'kind': 'call', 'method': method, 'args': args})
            response = json.loads(sys.stdin.readline())
            if not response.get('ok'):
                raise RuntimeError(response.get('error', '游戏操作失败'))
            return response.get('value')

    def size(self):
        return tuple(self._call('size'))

    def locate(self, target, timeout=5):
        return tuple(self._call('locate', target=target, timeout=timeout))

    def click(self, target, button='left', count=1, interval=.12, hold=0, timeout=5):
        return self._call('click', target=target, button=button, count=count, interval=interval, hold=hold, timeout=timeout)

    def drag(self, start, end, duration=1, timeout=5):
        return self._call('drag', start=start, end=end, duration=duration, timeout=timeout)

    def scroll(self, target, amount=-3, axis='vertical', timeout=5):
        return self._call('scroll', target=target, amount=amount, axis=axis, timeout=timeout)

    def key(self, keys):
        return self._call('key', keys=keys)

    def key_down(self, keys):
        return self._call('key_down', keys=keys)

    def key_up(self, keys):
        return self._call('key_up', keys=keys)

    def text(self, text):
        return self._call('text', text=text)

    def sleep(self, seconds):
        return self._call('sleep', seconds=seconds)

    def assert_image(self, target, timeout=5):
        return self._call('assert_image', target=target, timeout=timeout)

    def assert_absent(self, target, timeout=5):
        return self._call('assert_absent', target=target, timeout=timeout)

    def screenshot(self):
        return Path(self._call('screenshot'))

    def capture(self):
        from PIL import Image
        with Image.open(self.screenshot()) as image:
            return image.copy()


def main():
    data = json.loads(sys.stdin.readline())
    sys.stdout, sys.stderr = Output('stdout'), Output('stderr')
    case_dir = Path(data['case_dir'])
    sys.argv = [data['filename']]
    sys.path.insert(0, str(case_dir))
    sys.path.insert(1, str(Path(__file__).resolve().parents[1]))
    scope = {'__name__': '__main__', '__file__': data['filename'],
             'game': Game(data['game']), 'case_dir': case_dir,
             'report_dir': Path(data['report_dir']), 'step_name': data['step_name'],
             'variables': data['variables']}
    try:
        source = Path(data['filename']).read_text(encoding='utf-8')
        exec(compile(source, data['filename'], 'exec'), scope)
    except BaseException as error:
        if not isinstance(error, SystemExit) or error.code not in (None, 0):
            sys.stdout.flush(); sys.stderr.flush()
            send({'kind': 'error', 'error': ''.join(traceback.format_exception(type(error), error, error.__traceback__))[-16000:]})
            return
    try:
        sys.stdout.flush(); sys.stderr.flush()
        variables = scope['variables']
        if not isinstance(variables, dict) or len(json.dumps(variables, ensure_ascii=True)) > 48000:
            raise ValueError('variables 必须是可 JSON 保存的字典，且不超过 48 KB')
        send({'kind': 'done', 'variables': variables})
    except Exception as error:
        send({'kind': 'error', 'error': str(error)})


if __name__ == '__main__':
    main()
