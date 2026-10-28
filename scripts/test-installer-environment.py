"""Exercise real NSIS fresh install/reuse/repair without rebuilding release assets."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[1]


def main():
    import winreg
    registry = r'Software\Microsoft\Windows\CurrentVersion\Uninstall\EchoTest-InstallerTest'
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, registry, 0, winreg.KEY_READ | winreg.KEY_WOW64_64KEY):
            raise RuntimeError('Installer test registry key already exists; preserve it before another test')
    except FileNotFoundError:
        pass
    fixture = ROOT/'.runtime/installer-build'/('environment-test-' + uuid.uuid4().hex[:8])
    fixture.mkdir(parents=True)
    payload, target = fixture/'payload', fixture/'installed with spaces'
    output = fixture/'echo-test-environment-check.exe'
    report = {'passed': False, 'fixture': str(fixture)}
    # Use a real relocatable stdlib interpreter for the existing installation guard.
    python = payload/'runtime/python'
    python.mkdir(parents=True)
    source = ROOT/'runtime/python'
    for file in source.iterdir():
        if file.is_file() and file.suffix.lower() in {'.exe', '.dll', '.pyd', '.zip', '._pth'}:
            shutil.copy2(file, python/file.name)
    files = {
        'runtime/python/models/probe.bin': b'ocr-model-1',
        'runtime/node/node.exe': b'node-fixture-1',
        'runtime/android/adb.exe': b'adb-fixture-1',
        'runtime/manifest.json': b'{"fixture":true}',
        'node_modules/.package-lock.json': b'{}',
        'node_modules/.bin/probe.cmd': b'@exit /b 0',
        'node_modules/electron/dist/electron.exe': b'electron-fixture-1',
        'node_modules/@scope/lib/package.json': b'{"version":"1.0.0"}',
        'test_cases/README.md': b'Empty workspace',
        'control_library/controls.json': b'{"entries":[]}',
        'projects/README.md': b'Empty workspace',
        'electron/assets/studio.ico': (ROOT/'electron/assets/studio.ico').read_bytes(),
        'README.md': b'Application version 1',
        'scripts/installer-guard.py': (ROOT/'scripts/installer-guard.py').read_bytes(),
    }
    for name, content in files.items():
        file = payload/name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(content)
    spec = importlib.util.spec_from_file_location('installer_environment', ROOT/'scripts/installer-environment.py')
    environment = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(environment)
    components = environment.prepare(payload, fixture)
    compiler = ROOT/'.runtime/installer-build/nsis-3.13/makensis.exe'
    command = [str(compiler), '/V2', '/INPUTCHARSET', 'UTF8',
               '/DPRODUCT_VERSION=1.2.0', '/DSETUP_COMPRESSION=zlib',
               f'/DPROJECT_ROOT={ROOT}', f'/DPAYLOAD_ROOT={payload}',
               f'/DINSTALLER_ENVIRONMENT_ROOT={fixture}', f'/DOUTPUT_EXE={output}',
               str(ROOT/'scripts/installer.nsi')]
    def compile_fixture():
        subprocess.run(command, check=True, timeout=120)

    powershell = Path(os.environ['SystemRoot'])/'System32/WindowsPowerShell/v1.0/powershell.exe'
    def install():
        env = dict(os.environ, ECHO_FIXTURE_SETUP=str(output), ECHO_FIXTURE_TARGET=str(target))
        # NSIS /D= must be the final unquoted argument; Start-Process preserves spaces.
        script = '$p=Start-Process -FilePath $env:ECHO_FIXTURE_SETUP -ArgumentList "/S /TESTINSTALL /NOSHORTCUTS /D=$env:ECHO_FIXTURE_TARGET" -WindowStyle Hidden -Wait -PassThru;exit $p.ExitCode'
        subprocess.run([str(powershell), '-NoProfile', '-NonInteractive', '-Command', script],
                       env=env, check=True, timeout=120)

    def summary():
        import configparser
        ini = configparser.ConfigParser()
        ini.read(target/'echo-test-install.ini', encoding='utf-8-sig')
        return dict(ini['Environment'])

    def digest(file):
        return hashlib.sha256(file.read_bytes()).hexdigest()

    try:
        compile_fixture()
        install()
        assert summary() == {'reused': '0', 'installedorrepaired': str(len(components))}, summary()
        report['freshInstall'] = True
        tracked = [target/item['path']/file['path'] for item in components for file in item['files']]
        old = 946684800_000000000
        for file in tracked:
            os.utime(file, ns=(old, old))
        user = target/'test_cases/user.json'
        user.write_bytes(b'preserve user case')
        controls = target/'control_library/controls.json'
        controls.write_bytes(b'preserve edited controls')
        install()
        assert summary() == {'reused': str(len(components)), 'installedorrepaired': '0'}, summary()
        assert all(file.stat().st_mtime_ns == old for file in tracked), 'Reused dependency was rewritten'
        report['reinstallPreservesEveryDependencyTimestamp'] = True
        model = target/'runtime/python/models/probe.bin'
        model.write_bytes(b'bad-model-1')
        os.utime(model, ns=(old, old))
        (target/'runtime/python/python.exe').write_bytes(b'damaged old interpreter')
        (target/'runtime/android/adb.exe').unlink()
        unchanged = target/'node_modules/electron/dist/electron.exe'
        install()
        assert summary() == {'reused': str(len(components)-2), 'installedorrepaired': '2'}, summary()
        assert digest(model) == digest(payload/'runtime/python/models/probe.bin')
        assert digest(target/'runtime/python/python.exe') == digest(payload/'runtime/python/python.exe')
        assert (target/'runtime/android/adb.exe').read_bytes() == b'adb-fixture-1'
        assert unchanged.stat().st_mtime_ns == old
        report['repairsDamagedAndMissingComponentsOnly'] = True
        package = payload/'node_modules/@scope/lib/package.json'
        package.write_bytes(b'{"version":"2.0.0"}')
        (payload/'README.md').write_bytes(b'Application version 2')
        environment.prepare(payload, fixture)
        compile_fixture()
        install()
        assert summary() == {'reused': str(len(components)-1), 'installedorrepaired': '1'}, summary()
        assert (target/'node_modules/@scope/lib/package.json').read_bytes() == package.read_bytes()
        assert unchanged.stat().st_mtime_ns == old
        assert (target/'README.md').read_bytes() == b'Application version 2'
        assert user.read_bytes() == b'preserve user case'
        assert controls.read_bytes() == b'preserve edited controls'
        report['updatesChangedDependencyAndApplicationPreservesUserData'] = True
        env = dict(os.environ, ECHO_FIXTURE_UNINSTALLER=str(target/'Uninstall.exe'))
        script = '$p=Start-Process -FilePath $env:ECHO_FIXTURE_UNINSTALLER -ArgumentList "/S" -WindowStyle Hidden -Wait -PassThru;exit $p.ExitCode'
        subprocess.run([str(powershell), '-NoProfile', '-NonInteractive', '-Command', script],
                       env=env, check=True, timeout=120)
        assert not (target/'runtime/python/python.exe').exists()
        assert user.exists() and controls.exists()
        report['uninstallPreservesUserData'] = True
        report['passed'] = True
    except Exception as error:
        report['error'] = repr(error)
        raise
    finally:
        destination = ROOT/'artifacts/installer-environment.json'
        destination.parent.mkdir(exist_ok=True)
        destination.write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
