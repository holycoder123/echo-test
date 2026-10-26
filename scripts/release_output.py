"""Keep the newest build separate from timestamped, preserved build history."""
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import uuid


def prepare_latest(root, version):
    if not re.fullmatch(r'\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?', version):
        raise ValueError('Invalid release version')
    dist = Path(root).resolve() / 'dist'
    latest, history = dist / 'latest', dist / 'history'
    for path in (dist, latest, history):
        if path.resolve() != path:
            raise RuntimeError('Refusing redirected release directory')
    latest.mkdir(parents=True, exist_ok=True)
    files = list(latest.iterdir())
    if any(not path.is_file() or path.resolve() != path for path in files):
        raise RuntimeError('Latest output must contain regular files only')
    if files:
        previous = 'unversioned'
        info = latest / 'build-info.json'
        if info.exists():
            previous = json.loads(info.read_text(encoding='utf-8'))['version']
        if not re.fullmatch(r'[A-Za-z0-9.+-]+', previous):
            raise ValueError('Invalid previous build version')
        stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8]
        destination = history / ('v' + previous) / stamp
        if destination.resolve() != destination:
            raise RuntimeError('Refusing redirected history directory')
        destination.mkdir(parents=True)
        for path in files:
            path.rename(destination / path.name)
    (latest / 'build-info.json').write_text(json.dumps({
        'version': version, 'built_at_utc': datetime.now(timezone.utc).isoformat(),
    }, indent=2) + '\n', encoding='utf-8')
    return latest
