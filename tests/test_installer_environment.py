"""Dependency reuse must check actual payload contents, not presence or timestamps."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('installer_environment', ROOT/'scripts/installer-environment.py')
environment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(environment)


@unittest.skipUnless(os.name == 'nt', 'Windows installer detection')
class InstallerEnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='echo environment ')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.payload = self.root/'payload'
        self.target = self.root/'installed with spaces'
        self.output = self.root/'manifest'
        for name, content in {
            'runtime/python/python.exe': b'python-1',
            'runtime/python/Lib/model.bin': b'ocr-model',
            'runtime/node/node.exe': b'node-1',
            'runtime/android/adb.exe': b'adb-1',
            'node_modules/electron/dist/electron.exe': b'electron-1',
            'node_modules/@scope/library/package.json': b'{"version":"1.0.0"}',
        }.items():
            file = self.payload/name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(content)
        self.components = environment.prepare(self.payload, self.output)
        self.ids = {item['path']: item['id'] for item in self.components}

    def detect(self, manifest=None):
        result = self.root/'reuse.ini'
        powershell = Path(os.environ['SystemRoot'])/'System32/WindowsPowerShell/v1.0/powershell.exe'
        process = subprocess.run([
            str(powershell), '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', str(ROOT/'scripts/installer-environment.ps1'),
            '-InstallDirectory', str(self.target), '-Manifest', str(manifest or self.output/'environment-manifest.json'),
            '-Output', str(result)], capture_output=True, timeout=30)
        self.assertEqual(process.returncode, 0, process.stderr.decode(errors='replace'))
        return {line.split('=', 1)[0] for line in result.read_text().splitlines() if line.endswith('=1') and len(line.split('=')[0]) == 24}

    def install(self):
        shutil.copytree(self.payload, self.target)

    def test_clean_install_and_complete_reinstall(self):
        self.assertEqual(self.detect(), set())
        self.install()
        self.assertEqual(self.detect(), set(self.ids.values()))

    def test_same_size_same_timestamp_damage_and_missing_file_repair_only_affected_components(self):
        self.install()
        file = self.target/'runtime/python/Lib/model.bin'
        original = file.stat()
        file.write_bytes(b'bad-model')
        os.utime(file, ns=(original.st_atime_ns, original.st_mtime_ns))
        (self.target/'runtime/android/adb.exe').unlink()
        self.assertEqual(self.detect(), set(self.ids.values()) - {self.ids['runtime/python'], self.ids['runtime/android']})

    def test_changed_dependency_version_is_updated_even_if_marker_exists(self):
        self.install()
        (self.payload/'node_modules/@scope/library/package.json').write_bytes(b'{"version":"2.0.0"}')
        environment.prepare(self.payload, self.output)
        self.assertEqual(self.detect(), set(self.ids.values()) - {self.ids['node_modules/@scope/library']})

    def test_invalid_manifest_or_unreadable_metadata_never_skips_installation(self):
        self.install()
        manifest = self.output/'environment-manifest.json'
        manifest.write_text('{broken', encoding='utf-8')
        self.assertEqual(self.detect(), set())

    def test_paths_outside_installation_never_qualify_for_reuse(self):
        self.install()
        manifest = self.output/'environment-manifest.json'
        data = json.loads(manifest.read_text())
        data['components'][0]['files'][0]['path'] = '../../outside'
        manifest.write_text(json.dumps(data), encoding='utf-8')
        self.assertNotIn(data['components'][0]['id'], self.detect())

    def test_python_cache_is_not_required_for_reuse(self):
        cache = self.payload/'runtime/python/Lib/__pycache__/local.pyc'
        cache.parent.mkdir()
        cache.write_bytes(b'volatile cache')
        components = environment.prepare(self.payload, self.output)
        self.assertFalse(any('__pycache__' in entry['path'] for item in components for entry in item['files']))


if __name__ == '__main__':
    unittest.main()
