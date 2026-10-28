import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
from scripts.release_payload import (APPLICATION_DIRECTORIES, APPLICATION_FILES, EMPTY_CONTROLS,
                                     WORKSPACE_SEEDS, copy_payload, assert_clean_archive, assert_clean_payload)


class ReleasePayloadTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)/'source'
        self.stage = Path(temporary.name)/'payload'
        self.root.mkdir()
        self.stage.mkdir()
        for name in APPLICATION_DIRECTORIES:
            (self.root/name).mkdir()
            (self.root/name/'program.txt').write_text('program')
        for name in APPLICATION_FILES:
            (self.root/name).write_text('program')

    def test_private_workspace_and_logs_are_never_copied_or_deleted(self):
        private = [
            'test_cases/private.echo.json', 'test_cases/assets/private.png',
            'control_library/controls.json', 'control_library/private.png',
            'projects/private.json', 'reports/result.json', 'recordings/private.json',
            '.runtime/mcp-connection.json', 'artifacts/smoke/errors.json',
            'electron/logs/audit.jsonl', 'electron/.runtime/private.json',
            'electron/renderer/debug.log', 'electron/userData/recent.json',
            'echo_test/.env', 'runtime/python/__pycache__/cached.pyc',
        ]
        for name in private:
            file = self.root/name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(b'personal data must stay local')
        copy_payload(self.root, self.stage)
        for name in private:
            self.assertEqual((self.root/name).read_bytes(), b'personal data must stay local')
            if name != 'control_library/controls.json':
                self.assertFalse((self.stage/name).exists(), name)
        self.assertEqual(json.loads((self.stage/'control_library/controls.json').read_text()), EMPTY_CONTROLS)
        self.assertEqual((self.stage/'electron/program.txt').read_text(), 'program')
        assert_clean_payload(self.stage)

    def archive(self, extra=None):
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as archive:
            for name, content in {**WORKSPACE_SEEDS, **(extra or {})}.items():
                archive.writestr('echo-test/'+name, content)
        output.seek(0)
        return zipfile.ZipFile(output)

    def test_generated_empty_workspace_is_accepted(self):
        with self.archive() as archive:
            assert_clean_archive(archive)

    def test_archive_check_rejects_log_case_and_populated_control_library(self):
        for extra in ({'logs/audit.jsonl': 'secret'}, {'test_cases/private.echo.json': '{}'},
                      {'control_library/controls.json': '{"entries":[{"private":true}]}'}):
            with self.subTest(extra=list(extra)), self.archive(extra) as archive:
                with self.assertRaises(ValueError):
                    assert_clean_archive(archive)

    def test_staging_check_rejects_newly_added_execution_data(self):
        copy_payload(self.root, self.stage)
        (self.stage/'electron/error.log').write_text('private error')
        with self.assertRaises(ValueError):
            assert_clean_payload(self.stage)


if __name__ == '__main__':
    unittest.main()
