"""Create a relocatable source bundle without local credentials or execution history."""
import hashlib
import json
from pathlib import Path
import shutil
import zipfile
import subprocess
from scripts.release_output import prepare_latest

ROOT = Path(__file__).resolve().parents[1]


def excluded(directory, names):
    return [name for name in names if name in {'__pycache__', '.drafts', '.git', '.cache'} or name.endswith(('.pyc', '.pyo'))]


def main():
    subprocess.run([str(ROOT/'runtime/python/python.exe'), '-X', 'utf8', str(ROOT/'scripts/vendor-adb.py')], cwd=ROOT, check=True)
    subprocess.run([str(ROOT/'runtime/python/python.exe'), '-X', 'utf8', str(ROOT/'scripts/vendor-scrcpy.py')], cwd=ROOT, check=True)
    node = ROOT/'runtime/node/node.exe'
    subprocess.run([str(node) if node.exists() else 'node', str(ROOT/'scripts/build-editor.cjs')], cwd=ROOT, check=True)
    # Every path is a fixed child of the workspace; user case/report directories are never removed.
    stage = ROOT/'.runtime'/'portable-build'/'echo-test'
    if stage.exists():
        if stage.resolve() != ROOT.resolve()/'.runtime'/'portable-build'/'echo-test':
            raise RuntimeError('Refusing redirected staging directory')
        shutil.rmtree(stage)
    stage.mkdir(parents=True)
    for name in ['electron', 'echo_test', 'scripts', 'docs', 'test_cases', 'projects', 'runtime', 'node_modules', 'tests']:
        shutil.copytree(ROOT/name, stage/name, ignore=excluded)
    if (ROOT/'control_library').exists():
        shutil.copytree(ROOT/'control_library', stage/'control_library', ignore=excluded)
    for pattern in ['*.cmd', 'app.py', 'README.md', 'package*.json', 'requirements*.txt', 'requirements*.lock']:
        for source in ROOT.glob(pattern):
            shutil.copy2(source, stage/source.name)
    note = 'Offline bundle for Windows 10/11 x64. Unzip to a writable folder and run start.cmd.\nDefault starts request Windows administrator permission. Confirm the UAC prompt; cancellation stops startup.\nDo not copy .runtime, reports or recordings from a running workbench.\nNode, Python, Electron, libraries and OCR models are included.\n'
    (stage/'PORTABLE-README.txt').write_text(note, encoding='utf-8')
    version = json.loads((ROOT/'package.json').read_text(encoding='utf-8'))['version']
    archive = stage.parent / f'echo-test-{version}-portable-x64.zip'
    print('Compressing portable application...', flush=True)
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
        for source in sorted(stage.rglob('*')):
            if source.is_file():
                bundle.write(source, source.relative_to(stage.parent).as_posix())
    with archive.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    output = prepare_latest(ROOT, version)
    archive = archive.rename(output / archive.name)
    archive.with_name(archive.name+'.sha256').write_text(digest+'  '+archive.name+'\n', encoding='ascii')
    print(json.dumps({'archive': str(archive), 'bytes': archive.stat().st_size, 'sha256': digest, 'stage': str(stage)}), flush=True)


if __name__ == '__main__':
    main()
