import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('release_output', Path(__file__).resolve().parents[1] / 'scripts/release_output.py')
release_output = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release_output)


class ReleaseOutputTests(unittest.TestCase):
    def test_rebuild_and_version_upgrade_preserve_all_previous_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            latest = release_output.prepare_latest(root, '1.1.0')
            (latest / 'setup.exe').write_bytes(b'first installer')
            (latest / 'setup.exe.sha256').write_bytes(b'first checksum')
            release_output.prepare_latest(root, '1.1.0')
            first = list((root / 'dist/history/v1.1.0').iterdir())[0]
            self.assertEqual((first / 'setup.exe').read_bytes(), b'first installer')
            self.assertEqual((first / 'setup.exe.sha256').read_bytes(), b'first checksum')
            (latest / 'setup.exe').write_bytes(b'second installer')
            release_output.prepare_latest(root, '1.2.0')
            self.assertEqual(len(list((root / 'dist/history/v1.1.0').iterdir())), 2)
            self.assertEqual([p.name for p in latest.iterdir()], ['build-info.json'])
            self.assertEqual(json.loads((latest / 'build-info.json').read_text())['version'], '1.2.0')

    def test_invalid_version_does_not_move_existing_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            latest = release_output.prepare_latest(root, '1.1.0')
            (latest / 'setup.exe').write_bytes(b'keep')
            with self.assertRaises(ValueError):
                release_output.prepare_latest(root, '../outside')
            self.assertEqual((latest / 'setup.exe').read_bytes(), b'keep')

    def test_unexpected_subdirectory_is_preserved_and_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            latest = release_output.prepare_latest(root, '1.1.0')
            (latest / 'unexpected').mkdir()
            with self.assertRaises(RuntimeError):
                release_output.prepare_latest(root, '1.1.0')
            self.assertTrue((latest / 'unexpected').is_dir())
