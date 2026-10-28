"""Build integrity checks and NSIS extraction blocks for bundled dependencies."""
import hashlib
import json
from pathlib import Path


def component_roots(payload):
    """Keep runtimes separate; npm packages can be upgraded independently."""
    for folder in (payload / 'runtime').iterdir():
        if folder.is_dir():
            yield folder
    for folder in (payload / 'node_modules').iterdir():
        if not folder.is_dir() or folder.name == '.bin':
            continue
        if folder.name.startswith('@'):
            yield from (item for item in folder.iterdir() if item.is_dir())
        else:
            yield folder


def prepare(payload, output):
    payload, output = Path(payload), Path(output)
    components = []
    blocks = []
    for folder in sorted(component_roots(payload)):
        relative = folder.relative_to(payload).as_posix()
        identity = hashlib.sha256(relative.encode('utf-8')).hexdigest()[:24]
        files = []
        for source in sorted(folder.rglob('*')):
            if not source.is_file() or '__pycache__' in source.parts or source.suffix in {'.pyc', '.pyo'}:
                continue
            with source.open('rb') as stream:
                digest = hashlib.file_digest(stream, 'sha256').hexdigest()
            files.append({'path': source.relative_to(folder).as_posix(),
                          'size': source.stat().st_size, 'sha256': digest})
        if not files:
            continue
        components.append({'id': identity, 'path': relative, 'files': files})
        nsis_path = relative.replace('/', '\\')
        # All names come from our payload. Reject NSIS metacharacters at build time.
        if any(char in nsis_path for char in '$"\r\n'):
            raise ValueError(f'Unsupported dependency path: {relative}')
        blocks.extend([
            f'ReadINIStr $0 "$PLUGINSDIR\\environment-reuse.ini" "Reuse" "{identity}"',
            '${If} $0 == "1"',
            f'  DetailPrint "Reusing verified environment: {relative}"',
            '${Else}',
            f'  DetailPrint "Installing or repairing environment: {relative}"',
            f'  SetOutPath "$INSTDIR\\{nsis_path}"',
            f'  File /r /x "__pycache__" /x "*.pyc" /x "*.pyo" "${{PAYLOAD_ROOT}}\\{nsis_path}\\*"',
            '${EndIf}',
        ])
    if not components:
        raise ValueError('Installer payload has no bundled dependencies')
    output.mkdir(parents=True, exist_ok=True)
    (output / 'environment-manifest.json').write_text(
        json.dumps({'schema_version': 1, 'components': components}, separators=(',', ':')),
        encoding='utf-8')
    (output / 'environment-files.nsh').write_text('\n'.join(blocks) + '\n', encoding='utf-8')
    return components
