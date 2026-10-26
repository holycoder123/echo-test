import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from echo_test.environment import runtime_info


class EnvironmentTests(unittest.TestCase):
    def test_inspection_reports_local_models_without_importing_ocr_or_capturing(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            package = root/'rapidocr'
            (package/'models').mkdir(parents=True)
            for name in ['det', 'cls', 'rec']:
                (package/'models'/f'{name}.onnx').write_bytes(b'model')
            adb = Mock()
            adb.resolve.return_value = str(root/'runtime/android/platform-tools/adb.exe')
            adb.run.return_value = 'Android Debug Bridge version 1.0.41\nVersion 37.0.1'
            with patch('echo_test.environment.importlib.util.find_spec', return_value=SimpleNamespace(origin=str(package/'__init__.py'))), \
                    patch('echo_test.environment.importlib.metadata.version', return_value='test'):
                info = runtime_info(root, adb)
            self.assertTrue(info['ocr']['ready'])
            self.assertEqual(info['ocr']['model_count'], 3)
            self.assertEqual(info['adb']['source'], 'bundled')
            adb.run.assert_called_once_with(['version'])
            json.dumps(info)

    def test_missing_models_and_adb_are_reported_without_failing_other_runtime_info(self):
        adb = Mock()
        adb.resolve.side_effect = RuntimeError('ADB missing')
        with patch('echo_test.environment.importlib.util.find_spec', return_value=None):
            info = runtime_info(Path.cwd(), adb)
        self.assertFalse(info['ocr']['ready'])
        self.assertEqual(info['adb']['error'], 'ADB missing')
        self.assertIn('version', info['python'])
        adb.run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
