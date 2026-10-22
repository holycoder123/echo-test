from pathlib import Path
import tempfile
import unittest
from dataclasses import asdict
from unittest.mock import Mock

from echo_test.models import Project, Selector, Step, save_project
from echo_test.control_library import ControlLibrary
from echo_test.service import Service


class DualModeServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.service = Service.__new__(Service)
        self.service.base_dir = self.root
        self.service.case_path = None
        self.service.idle = Mock()
        self.service._controls_library = ControlLibrary(self.root)

    def test_generation_and_copy_do_not_write_or_replace_source(self):
        project = Project('原用例', steps=[Step(action='text', params={'text': 'hello'}, delay=0)])
        filename = self.root / 'source.echo.json'
        save_project(project, filename, self.root)
        original = filename.read_bytes()
        self.service.case_path = filename
        generated = self.service.call('generate_python', {'project': project.to_dict()})
        self.assertIn('window.text', generated['code'])
        copied = self.service.call('python_copy', {'project': project.to_dict()})['project']
        self.assertEqual(copied['mode'], 'python')
        self.assertEqual(project.steps[0].params['text'], 'hello')
        self.assertEqual(filename.read_bytes(), original)
        self.assertEqual(self.service.case_path, filename)

    def test_python_mode_keeps_shared_control_aliases_after_rename_and_save(self):
        library = self.service.controls
        control = library.save(asdict(Selector('按钮', x=.2)))['control']
        project = Project('脚本', selectors=[Selector(**control['selector'])], mode='python',
                          code='game.click(controls["按钮"])')
        library.save({**control['selector'], 'name': '按钮新名', 'x': .8}, identifier=control['id'])
        imported = library.import_project(project, self.root)
        resolved = library.prune_project(library.resolve_project(imported, self.root))
        self.assertIn('按钮', [s.name for s in resolved.selectors])
        self.assertTrue(all(s.x == .8 for s in resolved.selectors))
        with self.assertRaisesRegex(ValueError, '当前用例'):
            library.delete(control['id'], [control['id']])

    def test_case_context_resets_copy_identity_and_restores_source_directory(self):
        source = self.root / 'nested' / 'source.echo.json'
        self.service.call('case_context', {'path': None})
        self.assertIsNone(self.service.case_path)
        self.service.call('case_context', {'path': str(source)})
        self.assertEqual(self.service.case_path, source)
        self.assertEqual(self.service.base_dir, source.parent)

    def test_unsaved_source_restores_its_directory_after_copy_is_saved_elsewhere(self):
        original = self.root / 'source-draft'
        self.service.base_dir = self.root / 'python-copy'
        self.service.case_path = self.service.base_dir / 'copy.echo.json'
        self.service.call('case_context', {'path': None, 'base_dir': str(original)})
        self.assertEqual(self.service.base_dir, original)
        self.assertIsNone(self.service.case_path)
