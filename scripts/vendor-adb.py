"""Vendor the open-source ADB components from a pinned official Platform-Tools archive."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = '37.0.1'
ARCHIVE = f'platform-tools_r{VERSION}-win.zip'
URL = f'https://dl.google.com/android/repository/{ARCHIVE}'
SHA256 = '45f4d63113e895ebde0c90f194099a4676b6ac653bd28d54314a9e022bbc1a99'
FILES = ('adb.exe', 'AdbWinApi.dll', 'AdbWinUsbApi.dll', 'libwinpthread-1.dll', 'NOTICE.txt', 'source.properties')


def bundle_directory(root):
    root = Path(root).resolve()
    directory = root / 'runtime' / 'android' / 'platform-tools'
    if directory.resolve() != directory:
        raise RuntimeError('Refusing redirected ADB runtime directory')
    return directory


def install_archive(root, data):
    if hashlib.sha256(data).hexdigest() != SHA256:
        raise ValueError('Android Platform-Tools archive checksum mismatch')
    directory = bundle_directory(root)
    # Read only the named ADB binaries and their notices, never extract arbitrary paths.
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        contents = {name: archive.read('platform-tools/' + name) for name in FILES}
    if f'Pkg.Revision={VERSION}' not in contents['source.properties'].decode('utf-8'):
        raise ValueError('Unexpected Android Platform-Tools revision')
    directory.mkdir(parents=True, exist_ok=True)
    for name, content in contents.items():
        destination = directory / name
        if destination.is_symlink():
            raise RuntimeError('Refusing redirected ADB runtime file')
        if not destination.exists() or destination.read_bytes() != content:
            temporary = destination.with_name(name + '.partial')
            temporary.write_bytes(content)
            temporary.replace(destination)
    manifest = {'version': VERSION, 'source_url': URL, 'archive_sha256': SHA256,
                'license_notice': 'platform-tools/NOTICE.txt',
                'files': {name: hashlib.sha256(content).hexdigest() for name, content in contents.items()}}
    (directory.parent / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    main_manifest = Path(root) / 'runtime' / 'manifest.json'
    if main_manifest.exists():
        runtime = json.loads(main_manifest.read_text(encoding='utf-8'))
        runtime['android_adb'] = manifest
        main_manifest.write_text(json.dumps(runtime, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return manifest


def verify_bundle(root, execute=True):
    directory = bundle_directory(root)
    manifest = json.loads((directory.parent / 'manifest.json').read_text(encoding='utf-8'))
    if manifest.get('version') != VERSION or manifest.get('archive_sha256') != SHA256 or set(manifest.get('files', {})) != set(FILES):
        raise ValueError('Unexpected bundled ADB manifest')
    for name in FILES:
        file = directory / name
        if file.is_symlink() or hashlib.sha256(file.read_bytes()).hexdigest() != manifest['files'][name]:
            raise ValueError('Bundled ADB file checksum mismatch: ' + name)
    result = {'passed': True, 'version': VERSION, 'adb_path': str(directory / 'adb.exe'), 'file_count': len(FILES)}
    if execute:
        environment = dict(os.environ)
        # Version checking must also work without Android Studio or system ADB.
        environment['PATH'] = os.environ.get('SystemRoot', 'C:\\Windows') + '\\System32'
        version = subprocess.run([str(directory / 'adb.exe'), 'version'], cwd=directory, env=environment,
                                 stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0), timeout=15, check=True)
        text = version.stdout.decode('utf-8', errors='replace').strip()
        if 'Android Debug Bridge' not in text or f'Version {VERSION}' not in text:
            raise ValueError('Bundled ADB version check failed: ' + text)
        result['output'] = text
    return result


def vendor(root=ROOT):
    cache = Path(root) / '.runtime' / 'android-build'
    cache.mkdir(parents=True, exist_ok=True)
    archive = cache / ARCHIVE
    if archive.exists():
        data = archive.read_bytes()
    else:
        print('Downloading pinned ADB from ' + URL, flush=True)
        with urllib.request.urlopen(URL, timeout=60) as response:
            data = response.read(32 * 1024 * 1024)
        if hashlib.sha256(data).hexdigest() != SHA256:
            raise ValueError('Android Platform-Tools download checksum mismatch')
        archive.write_bytes(data)
    install_archive(root, data)
    return verify_bundle(root)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--verify-only', action='store_true')
    options = parser.parse_args()
    print(json.dumps(verify_bundle(ROOT) if options.verify_only else vendor(), ensure_ascii=False), flush=True)
