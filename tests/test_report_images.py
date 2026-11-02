import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from PIL import Image
from echo_test.report_library import ReportLibrary


class ReportImageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.library = ReportLibrary(self.root)
        self.report = self.root / 'reports' / 'run_123'
        self.report.mkdir(parents=True)
        (self.report / 'result.json').write_text(json.dumps({'steps': [{'screenshot': 'failure_1.png'}]}))
        Image.new('RGB', (200, 120), 'red').save(self.report / 'failure_1.png')

    def test_reads_only_a_referenced_report_screenshot(self):
        self.assertEqual(self.library.image('run_123', 'failure_1.png').size, (200, 120))
        Image.new('RGB', (10, 10)).save(self.report / 'unreferenced.png')
        for name in ['../failure_1.png', 'result.json', 'unreferenced.png', 'missing.png']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.library.image('run_123', name)
        with self.assertRaises(ValueError):
            self.library.image('../run_123', 'failure_1.png')

    def test_rejects_redirected_report_image_and_result(self):
        original = Path.resolve
        for redirected in [self.report, self.report/'failure_1.png', self.report/'result.json']:
            def resolve(path, *args, **kwargs):
                return self.root/'outside' if path == redirected else original(path, *args, **kwargs)
            with self.subTest(path=redirected), patch.object(Path, 'resolve', autospec=True, side_effect=resolve):
                with self.assertRaises(ValueError):
                    self.library.image('run_123', 'failure_1.png')


if __name__ == '__main__':
    unittest.main()
