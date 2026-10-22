import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

from echo_test.models import Project, Step, Selector
from echo_test.engine import Runner
from test_studio import FakeBackend


def leaf(action='text', **params):
    return Step(action, action, params=params, delay=0)


def loop(variable='i', start=2, end=4, step=1, **options):
    return Step('循环', 'loop', params=dict(variable=variable, start=start, end=end, step=step), delay=0, **options)


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def run_project(self, project, iterations=1):
        self.backend = FakeBackend()
        self.events = []
        self.runner = Runner(self.backend, project, self.root, self.root/'reports', self.events.append)
        return self.runner.run(iterations)

    def test_old_project_defaults_and_python_main_ignores_inactive_lowcode(self):
        old = Project.from_dict({'name': '旧用例'})
        self.assertEqual(old.mode, 'lowcode')
        project = Project(mode='python', code='game.text("主程序")', steps=[leaf(text='不执行')])
        result = self.run_project(project)
        self.assertEqual(result['status'], 'passed', result.get('error'))
        self.assertEqual([c for c in self.backend.calls if c[0] == 'text'], [('text', '主程序')])
        self.assertEqual(result['steps'][0]['name'], 'Python 主程序')

    def test_nested_inclusive_loops_assignments_shared_python_variables_and_records(self):
        project = Project(steps=[leaf('set_variable', variable='prefix', value='"任务"'), loop(end=3),
            loop('j', 2, 1, -1), leaf(text='${prefix}-${i}-${j}'), leaf('end_loop'),
            leaf('python', code='variables["last"] = variables["i"]'), leaf('end_loop'), leaf(text='${last}')])
        result = self.run_project(project)
        self.assertEqual(result['status'], 'passed', result.get('error'))
        self.assertEqual([c[1] for c in self.backend.calls if c[0] == 'text'], ['任务-2-2', '任务-2-1', '任务-3-2', '任务-3-1', '3'])
        records = [r for r in result['steps'] if r['index'] == 3]
        self.assertEqual([r['repeat'] for r in records], [1, 2, 3, 4])
        self.assertEqual(records[0]['loop_variables'], {'i': 2, 'j': 2})
        from echo_test.workflow import operation_counts
        self.assertEqual(operation_counts(project), {0: 1, 3: 4, 5: 2, 7: 1})

    def test_disabled_group_has_no_effect_and_missing_variable_stops_later_input(self):
        result = self.run_project(Project(steps=[loop(enabled=False), leaf(text='bad'), leaf('end_loop'),
             leaf(text='${missing}'), leaf(text='later')]))
        self.assertEqual(result['status'], 'failed')
        self.assertIn('missing', result['error'])
        self.assertFalse(any(c[0] == 'text' for c in self.backend.calls))
        self.assertEqual(result['steps'][0]['index'], 3)

    def test_validation_rejects_bad_structure_and_expansion_before_activation(self):
        for steps in [[leaf('end_loop')], [loop()], [loop(step=0), leaf('end_loop')],
                      [loop(start=1, end=1001), leaf('end_loop')],
                      [loop(start=1, end=1000), loop('j', 1, 1000), leaf(text='x'), leaf('end_loop'), leaf('end_loop')],
                      [loop(variable='bad-name'), leaf('end_loop')],
                      [loop(start=True), leaf('end_loop')]]:
            with self.subTest(steps=steps), self.assertRaises(ValueError):
                Project(steps=steps).validate()

    def test_generated_python_matches_lowcode_and_copy_is_independent(self):
        from echo_test.codegen import generate_python, python_copy
        project = Project('示例', selectors=[Selector('按钮', normalized=False, x=4, y=8, library_id='a'*32)], steps=[
            leaf('set_variable', variable='label', value='"工作"'), loop(end=3),
            Step('点击', 'click', target='按钮', repeat=2, delay=0), leaf(text='${label}${i}'),
            leaf('python', code='variables["last"] = variables["i"]'), leaf('end_loop'),
            leaf(text='${last}')])
        original = self.run_project(project)
        self.assertEqual(original['status'], 'passed', original.get('error'))
        original_calls = [c for c in self.backend.calls if c[0] in {'text', 'click'}]
        copied = python_copy(project)
        self.assertEqual(copied.mode, 'python')
        self.assertIn('controls.by_id', generate_python(project))
        result = self.run_project(copied)
        self.assertEqual(result['status'], 'passed', result.get('error'))
        calls = [c for c in self.backend.calls if c[0] in {'text', 'click'}]
        self.assertEqual([c[:2] for c in calls], [c[:2] for c in original_calls])
        copied.selectors[0].name = '改名'
        copied.steps.clear()
        self.assertEqual(project.selectors[0].name, '按钮')
        self.assertTrue(project.steps)

    def test_empty_nested_loops_are_bounded_without_expanding_them(self):
        with self.assertRaisesRegex(ValueError, '100000'):
            Project(steps=[loop(start=1, end=1000), loop('j', 1, 1000), leaf('end_loop'), leaf('end_loop')]).validate()

    def test_generated_script_step_keeps_own_deadline(self):
        from echo_test.codegen import python_copy
        project = Project(steps=[Step('忙循环', 'python', params={'code': 'while True:\n    pass'}, timeout=.1, delay=0), leaf(text='later')])
        result = self.run_project(python_copy(project))
        self.assertEqual(result['status'], 'failed')
        self.assertIn('超过设定超时', result['error'])
        self.assertFalse(any(c[0] == 'text' for c in self.backend.calls))

    def test_generated_all_input_actions_match_lowcode(self):
        from echo_test.codegen import python_copy
        selectors = [Selector('开始', x=10, y=20, normalized=False), Selector('结束', x=30, y=40, normalized=False)]
        actions = [Step(action, action, '开始', '结束' if action == 'drag' else '', delay=.01,
                        params={'path': [[.1, .2], [.5, .6]], 'button': 'right'} if action == 'drag' else {})
                   for action in ['click', 'double_click', 'right_click', 'long_press', 'drag', 'scroll']]
        actions += [leaf('key', keys='ENTER'), leaf('key_down', keys='W'), leaf('key_up', keys='W'), leaf('sleep', duration=.01), leaf('screenshot')]
        project = Project(selectors=selectors, steps=actions)
        def run(recording):
            self.backend = FakeBackend()
            self.backend.drag = lambda start, end, duration, **extra: self.backend.calls.append(('drag', start, end, duration, extra))
            self.backend.key_down = lambda key: self.backend.calls.append(('key_down', key))
            self.backend.key_up = lambda key: self.backend.calls.append(('key_up', key))
            runner = Runner(self.backend, recording, self.root, self.root/'reports')
            result = runner.run()
            self.assertEqual(result['status'], 'passed', result.get('error'))
            # click API emits explicit defaults while the low-code backend uses default keyword values.
            calls = []
            for call in self.backend.calls:
                if call[0] == 'click':
                    call = (call[0], call[1], dict(count=1, button='left', interval=.12, hold=0, **{} ) | call[2])
                calls.append(call)
            return calls
        self.assertEqual(run(project), run(python_copy(project)))

    def test_generated_dynamic_variable_replacement_and_namespace_isolation(self):
        from echo_test.codegen import python_copy
        project = Project(steps=[leaf('python', code='variables = {"value": [1, 2]}\ntemporary = "private"'),
            leaf(text='${value}'), leaf('set_variable', variable='copy', value='${value}'),
            leaf('python', code='assert "temporary" not in globals()\nassert variables["copy"] == [1, 2]')])
        for candidate in [project, python_copy(project)]:
            with self.subTest(mode=candidate.mode):
                result = self.run_project(candidate)
                self.assertEqual(result['status'], 'passed', result.get('error'))
                self.assertIn(('text', '[1, 2]'), self.backend.calls)

    def test_generated_comment_names_cannot_become_python_statements(self):
        from echo_test.codegen import python_copy
        project = Project(steps=[Step('标题\ngame.text("bad")', 'text', params={'text': 'good'}, delay=0)])
        result = self.run_project(python_copy(project))
        self.assertEqual(result['status'], 'passed', result.get('error'))
        self.assertEqual([c for c in self.backend.calls if c[0] == 'text'], [('text', 'good')])

    def test_disabled_end_marker_is_structural_and_not_a_record(self):
        from echo_test.workflow import operation_counts
        marker = leaf('end_loop')
        marker.enabled = False
        project = Project(steps=[loop(end=3), leaf(text='${i}'), marker, leaf(text='done')])
        self.assertEqual(operation_counts(project), {1: 2, 3: 1})
        result = self.run_project(project)
        self.assertEqual(result['status'], 'passed', result.get('error'))
        self.assertEqual([r['index'] for r in result['steps']], [1, 1, 3])

    def test_generated_snippets_receive_original_step_name(self):
        from echo_test.codegen import python_copy
        project = Project(steps=[Step('第一个检查', 'python', delay=0, params={'code': 'game.text(step_name)'}),
                                Step('第二个检查', 'python', delay=0, params={'code': 'game.text(step_name)'})])
        for candidate in [project, python_copy(project)]:
            result = self.run_project(candidate)
            self.assertEqual(result['status'], 'passed', result.get('error'))
            self.assertEqual([c[1] for c in self.backend.calls if c[0] == 'text'], ['第一个检查', '第二个检查'])

    def test_generated_successful_system_exit_only_finishes_its_snippet(self):
        from echo_test.codegen import python_copy
        for exit_code in ['None', '0']:
            project = Project(steps=[leaf('python', code=f'variables["before_exit"] = (1, 2)\nraise SystemExit({exit_code})'),
                leaf('python', code='assert variables["before_exit"] == [1, 2]\ngame.text("continued")'), leaf(text='later')])
            for candidate in [project, python_copy(project)]:
                with self.subTest(exit_code=exit_code, mode=candidate.mode):
                    result = self.run_project(candidate)
                    self.assertEqual(result['status'], 'passed', result.get('error'))
                    self.assertEqual([c[1] for c in self.backend.calls if c[0] == 'text'], ['continued', 'later'])

    def test_generated_script_json_boundary_normalizes_values_and_keys(self):
        from echo_test.codegen import python_copy
        project = Project(steps=[leaf('python', code='variables = {"tuple": (1, 2), 5: "key"}\ntemporary = 1'),
            leaf('python', code='assert variables == {"tuple": [1, 2], "5": "key"}\nassert "temporary" not in globals()'),
            leaf(text='after')])
        for candidate in [project, python_copy(project)]:
            with self.subTest(mode=candidate.mode):
                result = self.run_project(candidate)
                self.assertEqual(result['status'], 'passed', result.get('error'))

    def test_generated_script_rejects_invalid_or_oversized_json_before_later_input(self):
        from echo_test.codegen import python_copy
        for code in ['variables["bad"] = float("nan")', 'variables["bad"] = "x" * 48000', 'variables["bad"] = {1, 2}']:
            project = Project(steps=[leaf('python', code=code), leaf(text='later')])
            for candidate in [project, python_copy(project)]:
                with self.subTest(code=code, mode=candidate.mode):
                    result = self.run_project(candidate)
                    self.assertEqual(result['status'], 'failed')
                    self.assertIn('JSON', result['error'])
                    self.assertFalse(any(c[0] == 'text' for c in self.backend.calls))

    def test_generated_nonzero_system_exit_stops_following_steps(self):
        from echo_test.codegen import python_copy
        project = Project(steps=[leaf('python', code='raise SystemExit(7)'), leaf(text='later')])
        for candidate in [project, python_copy(project)]:
            result = self.run_project(candidate)
            self.assertEqual(result['status'], 'failed')
            self.assertIn('SystemExit: 7', result['error'])
            self.assertFalse(any(c[0] == 'text' for c in self.backend.calls))

    def test_generated_snippet_helpers_bind_to_its_reassigned_variables(self):
        from echo_test.codegen import python_copy
        project = Project(steps=[leaf('python', code='variables = {"name": "child"}\nassign("next", "${name}")\ngame.text(render("${next}"))'),
            leaf('python', code='assert variables == {"name": "child", "next": "child"}')])
        for candidate in [project, python_copy(project)]:
            result = self.run_project(candidate)
            self.assertEqual(result['status'], 'passed', result.get('error'))
            self.assertIn(('text', 'child'), self.backend.calls)

    def test_outer_iterations_cap_control_flow_work_before_activation(self):
        project = Project(steps=[loop(start=1, end=999), loop('j', 1, 99), leaf('end_loop'), leaf('end_loop'), leaf(text='x')])
        def fail_after_activation(backend):
            backend.calls.append(('activate',))
            raise RuntimeError('应当在激活窗口前拒绝过量流程')
        with patch.object(FakeBackend, 'activate', fail_after_activation):
            result = self.run_project(project, iterations=1000)
        self.assertEqual(result['status'], 'failed')
        self.assertIn('100000', result['error'])
        self.assertFalse(self.backend.calls)

    def test_codegen_uses_window_without_rewriting_user_python_or_text_literals(self):
        import ast
        from echo_test.codegen import generate_python, python_copy
        project = Project(steps=[leaf(text='literal game.click()'),
            leaf('python', code='assert window is game\nwindow.text("primary")\ngame.text("legacy")')])
        generated = generate_python(project)
        tree = ast.parse(generated)
        self.assertIn('# window、controls', generated)
        self.assertFalse(any(isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id == 'game'
                             for node in ast.walk(tree)))
        self.assertIn('literal game.click()', generated)
        self.assertIn('game.text', generated)
        result = self.run_project(python_copy(project))
        self.assertEqual(result['status'], 'passed', result.get('error'))
        self.assertEqual([c[1] for c in self.backend.calls if c[0] == 'text'], ['literal game.click()', 'primary', 'legacy'])


if __name__ == '__main__':
    unittest.main()
