"""Create a relocatable source bundle without local credentials or execution history."""
import hashlib
import json
from pathlib import Path
import shutil
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def excluded(directory, names):
    return [name for name in names if name in {'__pycache__', '.drafts', '.git', '.cache'} or name.endswith(('.pyc', '.pyo'))]


def main():
    # Every path is a fixed child of the workspace; user case/report directories are never removed.
    stage = ROOT/'.runtime'/'portable-build'/'nycs-test-studio'
    if stage.exists():
        if stage.resolve() != ROOT.resolve()/'.runtime'/'portable-build'/'nycs-test-studio':
            raise RuntimeError('Refusing redirected staging directory')
        shutil.rmtree(stage)
    stage.mkdir(parents=True)
    for name in ['electron', 'nycs_studio', 'scripts', 'docs', 'test_cases', 'projects', 'runtime', 'node_modules', 'tests']:
        shutil.copytree(ROOT/name, stage/name, ignore=excluded)
    if (ROOT/'control_library').exists():
        shutil.copytree(ROOT/'control_library', stage/'control_library', ignore=excluded)
    for pattern in ['*.cmd', 'app.py', 'README.md', 'package*.json', 'requirements*.txt', 'requirements*.lock']:
        for source in ROOT.glob(pattern):
            shutil.copy2(source, stage/source.name)
    note = 'Offline bundle for Windows 10/11 x64. Unzip to a writable folder and run start.cmd.\nDefault starts request Windows administrator permission. Confirm the UAC prompt; cancellation stops startup.\nDo not copy .runtime, reports or recordings from a running workbench.\nNode, Python, Electron, libraries and OCR models are included.\n'
    (stage/'PORTABLE-README.txt').write_text(note, encoding='utf-8')
    output = ROOT/'dist'
    output.mkdir(exist_ok=True)
    archive = output/'nycs-test-studio-win-x64.zip'
    print('Compressing portable application...', flush=True)
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
        for source in sorted(stage.rglob('*')):
            if source.is_file():
                bundle.write(source, source.relative_to(stage.parent).as_posix())
    with archive.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    (output/'nycs-test-studio-win-x64.sha256').write_text(digest+'  '+archive.name+'\n', encoding='ascii')
    print(json.dumps({'archive': str(archive), 'bytes': archive.stat().st_size, 'sha256': digest, 'stage': str(stage)}), flush=True)


if __name__ == '__main__':
    main()
