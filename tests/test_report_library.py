import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from echo_test.report_library import ReportLibrary
from echo_test.service import Service
from echo_test import service as native


class ReportLibraryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(); self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name); self.library = ReportLibrary(self.root)

    def report(self, identifier):
        directory = self.root / 'reports' / identifier; directory.mkdir(parents=True)
        (directory / 'result.json').write_text(json.dumps({'case':identifier,'status':'failed','steps':[]}), encoding='utf-8')
        (directory / 'failure.png').write_bytes(b'evidence')
        (directory / 'output').mkdir(); (directory / 'output' / 'script.log').write_text('output')
        return directory

    def test_delete_single_and_batch_remove_evidence_and_preserve_unselected_data(self):
        first, second, third = [self.report(name) for name in ['one','two','three']]
        protected = self.root / 'test_cases'; protected.mkdir(); (protected / 'keep.json').write_text('{}')
        self.assertEqual(self.library.delete(['one','one'])['ids'], ['one'])
        self.assertFalse(first.exists()); self.assertTrue(second.exists()); self.assertTrue(third.exists())
        self.assertEqual(self.library.delete(['two','three'])['deleted'], 2)
        self.assertEqual(self.library.list(), []); self.assertTrue((protected / 'keep.json').exists())

    def test_invalid_batch_is_rejected_before_any_report_is_removed(self):
        directory = self.report('valid')
        for identifiers in [[],None,'valid',['valid','../outside'],['valid','C:\\outside'],['valid',None]]:
            with self.subTest(identifiers=identifiers):
                with self.assertRaises(ValueError): self.library.delete(identifiers)
                self.assertTrue(directory.exists())

    def test_missing_report_is_stale_selection_and_unknown_folder_is_protected(self):
        self.assertEqual(self.library.delete(['missing']), {'deleted':0,'ids':[]})
        (self.root / 'reports' / 'unrelated').mkdir(parents=True)
        with self.assertRaisesRegex(ValueError, '尚未生成'): self.library.delete(['unrelated'])

    def test_redirected_report_or_nested_file_rejects_the_entire_batch(self):
        first = self.report('first'); second = self.report('second')
        original = Path.resolve
        for redirected in [second, second / 'output' / 'script.log', self.library.directory]:
            with self.subTest(redirected=redirected):
                def resolve(path, *args, **kwargs):
                    return self.root / 'external' if path == redirected else original(path, *args, **kwargs)
                with patch.object(Path, 'resolve', autospec=True, side_effect=resolve):
                    with self.assertRaisesRegex(ValueError, '重定向'): self.library.delete(['first','second'])
                self.assertTrue(first.exists()); self.assertTrue(second.exists())

    def test_report_discovery_skips_redirected_result_files(self):
        first = self.report('first'); second = self.report('second')
        (second / 'result.json').write_text('broken',encoding='utf-8')
        self.assertEqual([row['id'] for row in self.library.list()], ['first'])
        original = Path.resolve
        def resolve(path, *args, **kwargs):
            return self.root / 'external.json' if path == first / 'result.json' else original(path, *args, **kwargs)
        with patch.object(Path, 'resolve', autospec=True, side_effect=resolve):
            self.assertEqual(self.library.list(), [])

    def test_service_rejects_deletion_while_running_or_recording(self):
        directory = self.report('valid'); service = Service.__new__(Service)
        with patch.object(native, 'ROOT', self.root):
            for running, recorder in [(True,None),(False,object())]:
                service.running, service.recorder = running, recorder
                with self.assertRaisesRegex(ValueError, '停止执行或录制'): service.call('reports_delete', {'ids':['valid']})
                self.assertTrue(directory.exists())
            service.running=False;service.recorder=None
            self.assertEqual(service.call('reports_delete', {'ids':['valid']})['deleted'], 1)
