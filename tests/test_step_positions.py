from copy import deepcopy
from pathlib import Path
import tempfile
import unittest

from echo_test.codegen import python_copy
from echo_test.control_library import ControlLibrary
from echo_test.engine import Runner
from echo_test.models import Project, Selector, Step, load_project, save_project
from echo_test.positions import inline_coordinates, legacy_recording_entry
from echo_test.recording import convert_events
from test_studio import FakeBackend


class StepPositionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def project(self, **position):
        return Project(steps=[Step(action='click', delay=0, params={'position': {'x': .3, 'y': .4, **position}})])

    def test_validation_rejects_ambiguous_invalid_and_unsupported_positions(self):
        self.project().validate()
        self.project(normalized=False, x=200).validate()
        for p in [None, {}, {'x': .2}, {'x': True, 'y': .2}, {'x': float('nan'), 'y': .2},
                  {'x': 1.1, 'y': .2}, {'x': -.1, 'y': .2}, {'x': .1, 'y': .2, 'normalized': 1},
                  {'x': .1, 'y': .2, 'offset_x': 1.5}, {'x': .1, 'y': .2, 'name': 'hidden'}]:
            with self.subTest(position=p), self.assertRaises(ValueError):
                Project(steps=[Step(params={'position': p})]).validate()
        for step in [Step(target='shared', params={'position': {'x': .2, 'y': .3}}),
                     Step(action='key', params={'position': {'x': .2, 'y': .3}}),
                     Step(params={'position': {'x': .2, 'y': .3}, 'end_position': {'x': .5, 'y': .5}})]:
            with self.assertRaises(ValueError):
                Project(selectors=[Selector('shared')], steps=[step]).validate()

    def test_runner_uses_current_client_size_and_checks_bounds(self):
        backend = FakeBackend()
        runner = Runner(backend, self.project(offset_x=2, offset_y=-1), self.root, self.root/'report')
        runner.execute(runner.project.steps[0])
        self.assertEqual(backend.calls[-1][1], (62, 47))
        backend.size = lambda: (400, 240)
        runner.execute(runner.project.steps[0])
        self.assertEqual(backend.calls[-1][1], (122, 95))
        with self.assertRaisesRegex(ValueError, '超出'):
            runner.execute(self.project(x=1, offset_x=1).steps[0])

    def test_all_mouse_actions_and_generated_python_match_without_controls(self):
        actions = ['click', 'double_click', 'right_click', 'long_press', 'drag', 'scroll']
        steps = [Step(action=a, delay=0, params={'position': {'x': .3, 'y': .4, 'offset_x': 2}}) for a in actions]
        steps[4].params.update(end_position={'x': 30, 'y': 40, 'normalized': False},
                               path=[[.3, .4], [.5, .6]], button='right')
        project = Project(steps=steps)

        def calls(candidate):
            backend = FakeBackend()
            backend.drag = lambda start, end, duration, **extra: backend.calls.append(('drag', start, end, duration, extra))
            result = Runner(backend, candidate, self.root, self.root/'report').run()
            self.assertEqual(result['status'], 'passed', result.get('error'))
            return [(c[0], c[1], dict(count=1, button='left', interval=.12, hold=0) | c[2])
                    if c[0] == 'click' else c for c in backend.calls]

        self.assertEqual(calls(project), calls(python_copy(project)))
        self.assertEqual(project.selectors, [])

    def test_recording_save_import_and_replay_never_create_shared_controls(self):
        events = [{'kind': 'mouse', 'event': e, 't': t, 'x': .3, 'y': .4, 'button': 'left'}
                  for e, t in [('down', 0), ('up', .1)]]
        project = convert_events(events)
        self.assertEqual(project.selectors, [])
        self.assertEqual(project.steps[0].target, '')
        self.assertAlmostEqual(project.steps[0].params['position']['x'], .3)
        library = ControlLibrary(self.root)
        imported = library.import_project(project, self.root)
        self.assertEqual(library.list()['entries'], [])
        path = self.root/'test_cases'/'recorded.echo.json'
        save_project(imported, path, self.root)
        loaded = library.resolve_project(load_project(path), path.parent)
        self.assertEqual(loaded.to_dict(), project.to_dict())
        result = Runner(FakeBackend(), loaded, path.parent, self.root/'report').run()
        self.assertEqual(result['status'], 'passed', result.get('error'))

    def test_conversion_retains_explicit_shared_coordinates_and_images(self):
        project = Project(selectors=[Selector('位置'), Selector('共享位置'), Selector('图片', kind='image', image='assets/a.png')],
                          steps=[Step(target='位置'), Step(target='共享位置'), Step(target='图片')])
        converted, count = inline_coordinates(project, [project.selectors[0]])
        self.assertEqual(count, 1)
        self.assertEqual([s.name for s in converted.selectors], ['共享位置', '图片'])
        self.assertEqual(project.steps[0].target, '位置')


class LegacyPositionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.library = ControlLibrary(self.root)
        old = Project(selectors=[Selector('录制位置 01', x=.2)], steps=[Step(target='录制位置 01')])
        self.project = self.library.import_project(old, self.root)
        self.path = self.root/'test_cases'/'current.echo.json'
        save_project(self.project, self.path, self.root)

    def test_history_classification_preserves_manual_coordinates_and_categories(self):
        self.assertTrue(self.library.list()['entries'][0]['legacy_recording'])
        manual = self.library.save({'name': '录制位置 02', 'kind': 'coordinate', 'x': .1, 'y': .2})['control']
        self.assertFalse(legacy_recording_entry(manual))
        for changes in [{'category_id': 'a'*32}, {'origin_name': ''},
                        {'selector': {'name': '录制位置 01', 'kind': 'image'}},
                        {'selector': {'name': '背包入口', 'kind': 'coordinate'}}]:
            self.assertFalse(legacy_recording_entry(self.library.data['entries'][0] | changes))

    def test_localization_only_changes_returned_draft_and_uses_live_definition(self):
        original = deepcopy(self.project.to_dict())
        # Simulate a coordinate edited in an earlier release.
        self.library.data['entries'][0]['selector']['x'] = .8
        self.library._commit(self.library.data)
        saved, bank = self.path.read_bytes(), self.library.path.read_bytes()
        result = self.library.localize_recording_positions(self.project, self.path)
        self.assertEqual(result['converted'], 1)
        converted = Project.from_dict(result['project'])
        self.assertEqual(converted.steps[0].params['position']['x'], .8)
        self.assertEqual(converted.selectors, [])
        self.assertEqual(self.project.to_dict(), original)
        self.assertEqual(self.path.read_bytes(), saved)
        self.assertEqual(self.library.path.read_bytes(), bank)

    def test_python_current_or_other_case_and_cross_case_references_are_protected(self):
        for mode, disabled in [('python', False), ('lowcode', False), ('lowcode', True)]:
            current = deepcopy(self.project)
            current.mode = mode
            current.code = 'pass'
            if mode == 'lowcode':
                current.steps.append(Step(action='python', enabled=not disabled, params={'code': 'pass'}))
            self.assertEqual(self.library.localize_recording_positions(current, self.path)['converted'], 0)
            other = self.root/'projects'/'other.echo.json'
            save_project(current, other, self.root)
            self.assertEqual(self.library.localize_recording_positions(self.project, self.path)['converted'], 0)
            other.unlink()
        other = self.root/'test_cases'/'shared.echo.json'
        save_project(self.project, other, self.root)
        self.assertEqual(self.library.localize_recording_positions(self.project, self.path)['converted'], 0)

    def test_invalid_saved_case_blocks_conversion_and_explicit_edit_restores_shared_status(self):
        bad = self.root/'test_cases'/'broken.echo.json'
        bad.write_text('{', encoding='utf-8')
        result = self.library.localize_recording_positions(self.project, self.path)
        self.assertEqual(result['converted'], 0)
        self.assertIn('无法检查', result['reason'])
        bad.unlink()
        entry = self.library.data['entries'][0]
        self.library.save(entry['selector'], identifier=entry['id'])
        self.assertFalse(self.library.list()['entries'][0]['legacy_recording'])
        self.assertEqual(self.library.localize_recording_positions(self.project, self.path)['converted'], 0)


if __name__ == '__main__':
    unittest.main()
