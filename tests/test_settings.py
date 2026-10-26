import json
import os
from pathlib import Path
import tempfile
import time
import unittest

from echo_test.startup_preferences import startup_preferences
from echo_test.report_library import ReportLibrary


class SettingsTests(unittest.TestCase):
    def test_launcher_saved_mcp_off_does_not_force_session_disabled(self):
        import app
        from unittest.mock import patch
        with patch('sys.argv', ['app.py']), \
             patch('echo_test.startup_preferences.startup_preferences', return_value={'admin': False, 'mcp': False}), \
             patch('subprocess.Popen') as launch, \
             patch('echo_test.mcp_startup.wait_for_mcp') as wait:
            self.assertEqual(app.main(), 0)
            self.assertNotIn('--disable-mcp', launch.call_args.args[0])
            self.assertIn('--no-admin', launch.call_args.args[0])
            wait.assert_not_called()

    def test_explicit_mcp_and_admin_override_saved_disabled_preferences(self):
        import app
        from unittest.mock import patch
        with patch('sys.argv', ['app.py', '--mcp', '--admin']), \
             patch('echo_test.startup_preferences.startup_preferences', return_value={'admin': False, 'mcp': False}), \
             patch('echo_test.backend.is_admin', return_value=True), \
             patch('echo_test.mcp_startup.check_mcp_startup', return_value={'already_enabled': False}), \
             patch('echo_test.mcp_startup.wait_for_mcp'), \
             patch('subprocess.Popen') as launch:
            self.assertEqual(app.main(), 0)
            self.assertIn('--force-mcp', launch.call_args.args[0])
            self.assertIn('--force-admin', launch.call_args.args[0])

    def test_launcher_defaults_and_local_overrides(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.assertEqual(startup_preferences(root), {'admin': True, 'mcp': False})
            (root / 'settings.json').write_text(json.dumps({'startup': {'admin': False}, 'mcp': {'enabled': False}}))
            self.assertEqual(startup_preferences(root), {'admin': False, 'mcp': False})
            (root / 'settings.json').write_text('{broken')
            self.assertEqual(startup_preferences(root), {'admin': True, 'mcp': False})
            (root / 'settings.json').write_text(json.dumps({'startup': {'admin': 'false'}, 'mcp': {'enabled': None}}))
            self.assertEqual(startup_preferences(root), {'admin': True, 'mcp': False})
            (root / 'settings.json').write_text(json.dumps({'mcp': {'enabled': True}}))
            self.assertEqual(startup_preferences(root), {'admin': True, 'mcp': True})

    def test_cleanup_only_previews_old_complete_reports_without_mutation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            now = time.time()
            for name, age in [('old', 40), ('recent', 2), ('incomplete', 40)]:
                report = root / 'reports' / name
                report.mkdir(parents=True)
                (report / ('result.json' if name != 'incomplete' else 'progress.txt')).write_text('{}')
                (report / 'shot.png').write_bytes(b'png')
                for child in report.iterdir():
                    os.utime(child, (now - age * 86400, now - age * 86400))
            library = ReportLibrary(root)
            preview = library.cleanup_preview(30, now=now)
            self.assertEqual([row['id'] for row in preview['entries']], ['old'])
            self.assertEqual(preview['delete_bytes'], 5)
            self.assertEqual(preview['total_bytes'], 10)
            self.assertTrue((root / 'reports' / 'old').exists())
            os.utime(root / 'reports' / 'old' / 'shot.png', (now, now))
            self.assertEqual(library.cleanup_preview(30, now=now)['entries'], [])
            for days in [True, 0, 30.0, 366]:
                with self.assertRaises(ValueError):
                    library.cleanup_preview(days)

    def test_cleanup_skips_junctions_and_keeps_outside_data(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            report = root / 'reports' / 'redirect'
            report.mkdir(parents=True)
            (report / 'result.json').write_text('{}')
            library = ReportLibrary(root)
            original = library._redirected
            with patch.object(library, '_redirected', side_effect=lambda p: p == report or original(p)):
                preview = library.cleanup_preview(7)
            self.assertEqual(preview['skipped'], 1)
            self.assertTrue((report / 'result.json').exists())
