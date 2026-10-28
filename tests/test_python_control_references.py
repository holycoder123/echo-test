import unittest

try:
    from echo_test import python_control_references as refs
except ImportError:
    refs = None


class ControlReferenceTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(refs, 'Static control reference parser is not implemented')

    def parse(self, source):
        return refs.control_references(source)

    def test_literals_and_alias_uses(self):
        result = self.parse('button = controls.by_id("stable")\ncopy = button\nwindow.click(copy)\nwindow.click(controls["按钮"])')
        self.assertEqual(result['references'], [
            {'line': 1, 'kind': 'id', 'value': 'stable'},
            {'line': 2, 'kind': 'id', 'value': 'stable'},
            {'line': 3, 'kind': 'id', 'value': 'stable'},
            {'line': 4, 'kind': 'name', 'value': '按钮'},
        ])
        self.assertIsNone(result['error'])

    def test_preview_ranges_use_utf16_columns_and_keep_same_line_occurrences(self):
        source = '标题="😀"; window.drag(controls["按钮"], controls["按钮"])'
        result = refs.control_references(source, include_ranges=True)['references']
        self.assertEqual(len(result), 2)
        for reference in result:
            self.assertEqual(reference['line'], 1)
            self.assertEqual(reference['endLine'], 1)
            raw = source.encode('utf-16-le')[(reference['column']-1)*2:(reference['endColumn']-1)*2].decode('utf-16-le')
            self.assertEqual(raw, 'controls["按钮"]')
        self.assertLess(result[0]['column'], result[1]['column'])

    def test_alias_and_multiline_ranges_cover_only_the_reference(self):
        source = 'button=controls.by_id(\n    "stable"\n)\nwindow.click(button)'
        result = refs.control_references(source, include_ranges=True)['references']
        self.assertEqual((result[0]['line'], result[0]['column'], result[0]['endLine'], result[0]['endColumn']), (1, 8, 3, 2))
        self.assertEqual((result[1]['line'], result[1]['column'], result[1]['endLine'], result[1]['endColumn']), (4, 14, 4, 20))

    def test_unicode_separators_inside_strings_are_not_source_line_breaks(self):
        for separator in ('\u2028', '\u0085', '\f'):
            for newline in ('\n', '\r\n', '\r'):
                source = f'label="a{separator}b"{newline}controls["x"]'
                reference = refs.control_references(source, include_ranges=True)['references'][0]
                self.assertEqual((reference['line'], reference['column'], reference['endLine'], reference['endColumn']), (2, 1, 2, 14))

    def test_reassigned_alias_is_unknown(self):
        result = self.parse('button = controls["按钮"]\nbutton = object()\nwindow.click(button)')
        self.assertEqual(result['references'][-1], {'line': 3, 'kind': 'unknown', 'value': 'button'})

    def test_function_shadowing_is_not_resolved_as_global(self):
        source = 'button = controls["global"]\ndef f(button, controls):\n    window.click(button)\n    window.click(controls["local"])\nwindow.click(button)'
        result = self.parse(source)['references']
        self.assertEqual(result[-1], {'line': 5, 'kind': 'name', 'value': 'global'})
        self.assertFalse(any(r['kind'] == 'name' and r['line'] in (3, 4) for r in result))

    def test_function_local_assignment_shadows_outer_before_assignment(self):
        result = self.parse('button=controls["outer"]\ndef f():\n    window.click(button)\n    button=None')['references']
        self.assertFalse(any(r['kind'] == 'name' and r['line'] == 3 for r in result))

    def test_function_local_import_shadows_outer_before_import(self):
        result = self.parse('button=controls["outer"]\ndef f():\n    window.click(button)\n    import os as button')['references']
        self.assertFalse(any(r['kind'] == 'name' and r['line'] == 3 for r in result))

    def test_dynamic_references_are_marked_without_execution(self):
        result = self.parse('controls.by_id(danger())\ncontrols[name]\ncontrols.by_id("x" + suffix)')['references']
        self.assertEqual([r['kind'] for r in result], ['dynamic'] * 3)

    def test_comments_and_strings_are_not_references(self):
        self.assertEqual(self.parse('# controls["comment"]\ntext = \'controls.by_id("string")\'')['references'], [])

    def test_unrelated_by_id_is_not_a_control_reference(self):
        self.assertEqual(self.parse('database.by_id("record")')['references'], [])

    def test_ordinary_function_locals_are_not_unknown_control_references(self):
        result = self.parse('def greet(name):\n    value=name.upper()\n    return value\n[x for x in range(3)]')['references']
        self.assertEqual(result, [])

    def test_non_utf8_surrogate_is_nonfatal(self):
        self.assertEqual(self.parse('"\ud800"')['error'], 'syntax')

    def test_exception_binding_shadows_controls(self):
        result = self.parse('try:\n    work()\nexcept Exception as controls:\n    controls["local"]')['references']
        self.assertFalse(any(r['kind'] == 'name' for r in result))

    def test_match_capture_shadows_alias(self):
        result = self.parse('button=controls["outer"]\nmatch value:\n    case {"item": button}:\n        window.click(button)')['references']
        self.assertFalse(any(r['kind'] == 'name' and r['line'] == 4 for r in result))

    def test_class_attributes_are_not_function_closure_aliases(self):
        result = self.parse('button=controls["global"]\nclass Example:\n    button=controls["class"]\n    def use(self):\n        window.click(button)')['references']
        self.assertEqual(result[-1], {'line': 5, 'kind': 'name', 'value': 'global'})

    def test_import_rebinding_and_non_execution(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as folder:
            marker = Path(folder) / 'must-not-exist'
            source = f'from pathlib import Path\nPath({str(marker)!r}).touch()\nimport module as controls\ncontrols["shadow"]'
            result = self.parse(source)
            self.assertFalse(marker.exists())
            self.assertEqual(result['references'][-1]['kind'], 'unknown')

    def test_incomplete_source_is_a_nonfatal_syntax_result(self):
        result = self.parse('button = controls[')
        self.assertEqual(result['references'], [])
        self.assertEqual(result['error'], 'syntax')

    def test_conditional_assignment_does_not_claim_a_definite_alias(self):
        result = self.parse('button=controls["first"]\nif condition:\n    button=controls["second"]\nwindow.click(button)')
        self.assertEqual(result['references'][-1], {'line': 4, 'kind': 'unknown', 'value': 'button'})

    def test_try_assignment_does_not_leak_into_exception_handler(self):
        source = 'button=controls["old"]\ntry:\n    might_fail()\n    button=controls["new"]\nexcept Exception:\n    window.click(button)'
        self.assertEqual(self.parse(source)['references'][-1], {'line': 6, 'kind': 'unknown', 'value': 'button'})

    def test_match_cases_do_not_leak_assignments_to_other_cases(self):
        source = 'button=controls["old"]\nmatch value:\n    case 1:\n        button=controls["new"]\n    case 2:\n        window.click(button)'
        self.assertEqual(self.parse(source)['references'][-1], {'line': 6, 'kind': 'name', 'value': 'old'})

    def test_short_circuit_walrus_assignment_is_conditional(self):
        for operation in ('and', 'or'):
            source = f'button=controls["old"]\ncondition {operation} (button := controls["new"])\nwindow.click(button)'
            self.assertEqual(self.parse(source)['references'][-1], {'line': 3, 'kind': 'unknown', 'value': 'button'})

    def test_conditional_expression_walrus_assignment_is_conditional(self):
        source = 'button=controls["old"]\n(button := controls["new"]) if condition else None\nwindow.click(button)'
        self.assertEqual(self.parse(source)['references'][-1], {'line': 3, 'kind': 'unknown', 'value': 'button'})

    def test_global_rebinding_invalidates_function_and_lambda_free_aliases(self):
        for definition in ('def use():\n    window.click(button)', 'use=lambda: window.click(button)'):
            source = f'button=controls["old"]\n{definition}\nbutton=controls["new"]\nuse()'
            result = self.parse(source)['references']
            free_line = 3 if definition.startswith('def') else 2
            self.assertIn({'line': free_line, 'kind': 'unknown', 'value': 'button'}, result)
            self.assertFalse(any(r['line'] == free_line and r['kind'] == 'name' for r in result))

    def test_closure_rebinding_invalidates_captured_alias(self):
        source = 'def outer():\n    button=controls["old"]\n    def use():\n        window.click(button)\n    button=controls["new"]\n    return use'
        self.assertIn({'line': 4, 'kind': 'unknown', 'value': 'button'}, self.parse(source)['references'])

    def test_rebinding_runtime_controls_invalidates_function_lookup(self):
        source = 'def use():\n    controls["old"]\ncontrols=other_library\nuse()'
        self.assertIn({'line': 2, 'kind': 'unknown', 'value': 'controls'}, self.parse(source)['references'])

    def test_nonlocal_rebinding_invalidates_captured_alias(self):
        source = 'def outer():\n    button=controls["old"]\n    def use():\n        window.click(button)\n    def change():\n        nonlocal button\n        button=controls["new"]\n    return use, change'
        self.assertIn({'line': 4, 'kind': 'unknown', 'value': 'button'}, self.parse(source)['references'])

    def test_stable_free_aliases_and_sequential_function_local_aliases_still_resolve(self):
        source = 'button=controls["stable"]\ndef use():\n    window.click(button)\n    local=controls["first"]\n    window.click(local)\n    local=controls["second"]\n    window.click(local)'
        result = self.parse(source)['references']
        self.assertIn({'line': 3, 'kind': 'name', 'value': 'stable'}, result)
        self.assertIn({'line': 5, 'kind': 'name', 'value': 'first'}, result)
        self.assertIn({'line': 7, 'kind': 'name', 'value': 'second'}, result)

    def test_comprehension_target_shadows_outer_alias(self):
        result = self.parse('button=controls["outer"]\n[window.click(button) for button in values]')['references']
        self.assertFalse(any(r['kind'] == 'name' and r['line'] == 2 for r in result))

    def test_source_and_result_are_bounded(self):
        self.assertEqual(self.parse('x' * (refs.MAX_SOURCE_BYTES + 1))['error'], 'limit')
        result = self.parse('controls["x"]\n' * (refs.MAX_REFERENCES + 10))
        self.assertEqual(len(result['references']), refs.MAX_REFERENCES)
        self.assertTrue(result['truncated'])

    def test_ast_nodes_are_bounded(self):
        self.assertEqual(self.parse('a=1\n' * (refs.MAX_AST_NODES // 4 + 1))['error'], 'limit')


if __name__ == '__main__':
    unittest.main()
