"""Check NSIS resource contracts rather than comparing generated binary snapshots."""
import importlib.util
from pathlib import Path
import struct
import unittest

ROOT = Path(__file__).resolve().parents[1]


class InstallerUiResourceTests(unittest.TestCase):
    def load(self):
        source = ROOT / 'scripts/installer-ui/resources.py'
        self.assertTrue(source.exists(), 'Native installer resource builder has not been implemented')
        spec = importlib.util.spec_from_file_location('installer_ui_resources', source)
        ui = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(ui)
        return ui

    def test_main_dialog_retains_native_navigation_and_page_container(self):
        dialog = self.load().dialog_definitions()[105]
        controls = {item['id']: item for item in dialog['controls']}
        self.assertTrue({1, 2, 3, 1018, 1028, 3200}.issubset(controls))
        self.assertEqual(dialog['font'], 'Segoe UI')
        self.assertNotEqual(dialog['style'] & 0x00C00000, 0x00C00000,
                            'System caption would duplicate custom chrome')
        self.assertTrue(dialog['style'] & 0x00800000, 'A native outer border must remain visible')
        for identity in (1, 2, 3, 3200):
            self.assertTrue(controls[identity]['style'] & 0x10000, 'Native tab navigation is required')
            self.assertEqual(controls[identity]['style'] & 0xf, 0xb, 'Buttons must support owner drawing')

    def test_progress_dialog_keeps_real_nsis_progress_and_detail_controls(self):
        dialog = self.load().dialog_definitions()[106]
        controls = {item['id']: item for item in dialog['controls']}
        self.assertEqual(controls[1004]['class'], 'msctls_progress32')
        self.assertEqual(controls[1016]['class'], 'SysListView32')
        self.assertTrue({1006, 1027, 3301, 3302, 3303, 3304}.issubset(controls))

    def test_progress_exposes_real_percentage_stages_and_disclosure(self):
        controls = {item['id']: item for item in self.load().dialog_definitions()[106]['controls']}
        self.assertTrue({3305, 3306, 3307, 3308, 3309, 3310}.issubset(controls),
                        'Preview requires percentage, current stage, three tasks and a detail toggle')
        self.assertFalse(controls[1016]['style'] & 0x10000000,
                         'Detailed extraction log must start collapsed')

    def test_encoded_templates_are_aligned_and_preserve_chinese_labels(self):
        ui = self.load()
        for identity, dialog in ui.dialog_definitions().items():
            data = ui.encode_dialog(dialog)
            self.assertEqual(struct.unpack_from('<HH', data), (1, 0xffff))
            self.assertEqual(struct.unpack_from('<H', data, 16)[0], len(dialog['controls']))
            self.assertIn('Segoe UI'.encode('utf-16-le'), data)
            for item in dialog['controls']:
                if isinstance(item['text'], str) and item['text']:
                    self.assertIn(item['text'].encode('utf-16-le'), data, (identity, item['id']))


if __name__ == '__main__':
    unittest.main()
