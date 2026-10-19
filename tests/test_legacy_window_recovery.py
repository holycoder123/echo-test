import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from echo_test import legacy_window_recovery as native
from echo_test import service


class LegacyWindowRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'embed-recovery.json'
        self.state = {'handle':10, 'pid':11, 'host':20, 'host_pid':22,
                      'parent':0, 'style':0x00cf0000, 'exstyle':0,
                      'rect':[100, 200, 1040, 730], 'mode':'docked', 'enabled':True}
        self.pids = {10:11}
        self.enterContext(patch.object(native, 'window_pid', side_effect=self.pids.get))
        self.enterContext(patch.object(native, 'window_title', return_value='目标应用'))
        self.style = self.enterContext(patch.object(native, 'checked_long'))
        self.enterContext(patch.object(native, 'get_long', return_value=0x80000000))
        self.parent = self.enterContext(patch.object(native.user32, 'SetParent', return_value=20))
        self.enterContext(patch.object(native.user32, 'GetParent', return_value=0))
        self.move = self.enterContext(patch.object(native.user32, 'SetWindowPos', return_value=True))
        self.region = self.enterContext(patch.object(native.user32, 'SetWindowRgn', return_value=True))
        self.enable = self.enterContext(patch.object(native.user32, 'EnableWindow', return_value=False))
        self.enterContext(patch.object(native.user32, 'IsWindowEnabled', return_value=True))
        self.show = self.enterContext(patch.object(native.user32, 'ShowWindow'))
        self.enterContext(patch.object(native.user32, 'IsWindowVisible', return_value=True))

    def save(self):
        self.path.write_text(json.dumps(self.state), encoding='utf-8')

    def assert_untouched(self):
        for mutation in (self.style, self.parent, self.move, self.region, self.enable, self.show):
            mutation.assert_not_called()

    def test_restores_native_geometry_input_and_full_region_without_focus(self):
        self.save()
        with patch.object(native.user32, 'SetForegroundWindow') as focus:
            self.assertTrue(native.recover_legacy_window(self.path))
        focus.assert_not_called()
        self.assertFalse(self.path.exists())
        self.assertEqual([call.args for call in self.style.call_args_list],
                         [(10,-16,0x00cf0000), (10,-20,0), (10,-8,0)])
        self.move.assert_called_once_with(10, -2, 100, 200, 1040, 730, 0x30)
        self.region.assert_called_once_with(10, None, True)
        self.enable.assert_called_once_with(10, True)
        self.show.assert_called_once_with(10, 4)
        self.parent.assert_not_called()

    def test_running_original_host_requires_normal_shutdown(self):
        self.save(); self.pids[20] = 22
        with self.assertRaisesRegex(RuntimeError, '旧版工作台仍在运行'):
            native.recover_legacy_window(self.path)
        self.assertTrue(self.path.exists()); self.assert_untouched()

    def test_closed_game_or_reused_handle_discards_snapshot_without_mutation(self):
        for pid in (None, 99):
            with self.subTest(pid=pid):
                self.save(); self.pids[10] = pid
                self.assertFalse(native.recover_legacy_window(self.path))
                self.assertFalse(self.path.exists()); self.assert_untouched()

    def test_changed_window_title_with_same_pid_still_restores_snapshot(self):
        self.save()
        with patch.object(native, 'window_title', return_value='已修改文档 - 记事本'):
            self.assertTrue(native.recover_legacy_window(self.path))
        self.assertFalse(self.path.exists())
        self.move.assert_called_once()

    def test_reused_host_is_not_treated_as_running_original_workbench(self):
        self.save(); self.pids[20] = 99
        self.assertTrue(native.recover_legacy_window(self.path))

    def test_child_window_is_unparented_before_restoring_native_style(self):
        self.state['mode'] = 'child'; self.save()
        with patch.object(native, 'get_long', return_value=0x40000000):
            self.assertTrue(native.recover_legacy_window(self.path))
        self.parent.assert_called_once_with(10, 0)

    def test_owner_restore_ignores_a_window_from_another_process(self):
        self.state['parent'] = 30; self.pids[30] = 99; self.save()
        native.recover_legacy_window(self.path)
        self.assertEqual(self.style.call_args.args, (10,-8,0))

    def test_owner_restore_keeps_a_live_window_in_the_game_process(self):
        self.state['parent'] = 30; self.pids[30] = 11; self.save()
        native.recover_legacy_window(self.path)
        self.assertEqual(self.style.call_args.args, (10,-8,30))

    def test_failed_restore_preserves_snapshot_for_retry(self):
        self.save(); self.move.return_value = False
        with self.assertRaisesRegex(RuntimeError, '位置恢复失败'):
            native.recover_legacy_window(self.path)
        self.assertTrue(self.path.exists()); self.region.assert_not_called()
        self.move.return_value = True
        self.assertTrue(native.recover_legacy_window(self.path))

    def test_malformed_snapshot_is_preserved_without_native_changes(self):
        self.state['rect'] = [100,200,1040]; self.save()
        with self.assertRaisesRegex(RuntimeError, '恢复记录'):
            native.recover_legacy_window(self.path)
        self.assertTrue(self.path.exists()); self.assert_untouched()

    def test_missing_snapshot_does_nothing(self):
        self.assertFalse(native.recover_legacy_window(self.path))
        self.assert_untouched()


class NativeServiceStartupTests(unittest.TestCase):
    def test_startup_recovers_both_legacy_project_snapshot_locations(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(service, 'ROOT', root), \
                 patch.dict(service.os.environ, {}, clear=True), \
                 patch.object(service, 'NativeToolbarPair'), \
                 patch.object(service, 'recover_legacy_window') as recover:
                service.Service()
            self.assertEqual([call.args[0] for call in recover.call_args_list],
                             [root/'.runtime'/'embed-recovery.json', root/'.embed-recovery.json'])

    def test_custom_recovery_path_does_not_touch_project_snapshots(self):
        with patch.dict(service.os.environ, {'ECHO_TEST_EMBED_RECOVERY':'custom-recovery.json'}), \
             patch.object(service, 'NativeToolbarPair'), \
             patch.object(service, 'recover_legacy_window') as recover:
            service.Service()
        recover.assert_called_once_with(Path('custom-recovery.json'))

    def test_removed_docking_commands_cannot_mutate_a_game(self):
        instance = service.Service.__new__(service.Service)
        instance.window = Mock()
        for method in ('embed_attach', 'embed_detach', 'embed_layout', 'embed_visibility',
                       'embed_sync', 'embed_focus', 'embed_frame', 'embed_status',
                       'embed_motion', 'embed_motion_probe', 'embed_host_focus', 'embed_workspace_capture'):
            with self.subTest(method=method):
                with self.assertRaisesRegex(ValueError, '不支持的命令'):
                    instance.call(method, {'handle':10})
        instance.window.assert_not_called()


if __name__ == '__main__':
    unittest.main()
