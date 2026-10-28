"""Create a relocatable source bundle without local credentials or execution history."""
import hashlib
import json
from pathlib import Path
import shutil
import zipfile
import subprocess
from datetime import datetime, timezone
from scripts.release_output import prepare_latest
from scripts.release_payload import copy_payload, assert_clean_archive

ROOT = Path(__file__).resolve().parents[1]


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
    copy_payload(ROOT, stage)
    # Rebuilding a local checkout must not claim to be the previous tagged binary.
    try:
        commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, stderr=subprocess.DEVNULL).decode().strip()
        dirty = bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT))
        metadata = {'product': 'EchoTest', 'version': json.loads((ROOT/'package.json').read_text())['version'],
                    'source_commit': commit, 'source_url': f'https://github.com/holycoder123/echo-test/tree/{commit}',
                    'tag': 'v' + json.loads((ROOT/'package.json').read_text())['version'],
                    'source_dirty': dirty, 'built_at_utc': datetime.now(timezone.utc).isoformat()}
        (stage/'runtime/release.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
    except (OSError, subprocess.CalledProcessError):
        pass  # Source archives retain the provenance supplied by their publisher.
    note = 'Offline bundle for Windows 10/11 x64. Unzip to a writable folder and run start.cmd.\nDefault starts request Windows administrator permission. Confirm the UAC prompt; cancellation stops startup.\nDo not copy .runtime, reports or recordings from a running workbench.\nNode, Python, Electron, libraries and OCR models are included.\n'
    (stage/'PORTABLE-README.txt').write_text(note, encoding='utf-8')
    version = json.loads((ROOT/'package.json').read_text(encoding='utf-8'))['version']
    archive = stage.parent / f'echo-test-{version}-portable-x64.zip'
    print('Compressing portable application...', flush=True)
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
        for source in sorted(stage.rglob('*')):
            if source.is_file():
                bundle.write(source, source.relative_to(stage.parent).as_posix())
    with zipfile.ZipFile(archive) as bundle:
        assert_clean_archive(bundle)
    with archive.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    output = prepare_latest(ROOT, version)
    archive = archive.rename(output / archive.name)
    archive.with_name(archive.name+'.sha256').write_text(digest+'  '+archive.name+'\n', encoding='ascii')
    print(json.dumps({'archive': str(archive), 'bytes': archive.stat().st_size, 'sha256': digest, 'stage': str(stage)}), flush=True)


if __name__ == '__main__':
    main()
