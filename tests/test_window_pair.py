import unittest
from unittest.mock import Mock, patch
from nycs_studio import window_pair as native
from nycs_studio.backend import GameWindow
from nycs_studio.service import Service


class PlacementTests(unittest.TestCase):
    def test_pair_fits_work_area_without_covering_or_resizing_game(self):
        for work in [(0, 0, 1920, 1040), (-1920, 100, 1920, 1040), (1920, -200, 2300, 900)]:
            edge, game, toolbar, fits = native.placement((50, 40, 1024, 730), (0, 0, 380, 730), work)
            self.assertTrue(fits)
            self.assertEqual(edge, 'right')
            self.assertEqual(game[2:], (1024, 730))
            self.assertEqual(toolbar[2:], (380, 730))
            for x, y, w, h in (game, toolbar):
                self.assertGreaterEqual(x, work[0]); self.assertGreaterEqual(y, work[1])
                self.assertLessEqual(x+w, work[0]+work[2]); self.assertLessEqual(y+h, work[1]+work[3])
            self.assertEqual(native.adjacent(toolbar, game, edge, False), game)

    def test_undersized_monitor_reports_failure_and_preserves_game(self):
        game = (0, 0, 1024, 730)
        edge, result, toolbar, fits = native.placement(game, (0, 0, 380, 730), (0, 0, 1366, 768))
        self.assertFalse(fits)
        self.assertEqual(result, game)
        self.assertEqual(edge, 'right')
        self.assertGreaterEqual(toolbar[0], game[0]+game[2])

    def test_falls_back_below_when_only_vertical_pair_fits(self):
        edge, game, toolbar, fits = native.placement((30, 50, 900, 600), (0, 0, 380, 600), (0, 0, 1000, 1300))
        self.assertTrue(fits)
        self.assertEqual(edge, 'below')
        self.assertEqual(toolbar[1], game[1]+game[3]+8)

    def test_adaptive_narrow_panel_fits_small_monitor(self):
        edge, game, toolbar, fits = native.placement((0, 0, 1024, 730), (0, 0, 320, 730), (0, 0, 1366, 768))
        self.assertTrue(fits)
        self.assertEqual(edge, 'right')
        self.assertLessEqual(toolbar[0]+toolbar[2], 1366)


class PairTests(unittest.TestCase):
    def setUp(self):
        self.events = []
        self.pair = native.NativeToolbarPair(self.events.append)
        self.positions = {10: (100, 338, 1024, 700), 20: (100, 100, 1040, 230)}
        self.pids = {10: 11, 20: 22, 30: 33}
        self.owners = {10: 30, 20: 0}
        self.minimized = set()
        self.hidden = set()
        self.enterContext(patch.object(self.pair, 'pid', side_effect=lambda handle: self.pids.get(handle)))
        self.enterContext(patch.object(self.pair, 'rect', side_effect=lambda handle: self.positions[handle]))
        self.enterContext(patch.object(native, 'get_long', side_effect=lambda h, index: self.owners[h] if index == -8 else 0x00CF0000))
        self.owner = self.enterContext(patch.object(native, 'checked_long', side_effect=lambda h, index, value: self.owners.update({h: value})))
        self.enterContext(patch.object(native.user32, 'IsWindow', side_effect=lambda h: h in self.pids))
        self.enterContext(patch.object(native.user32, 'IsIconic', side_effect=lambda h: h in self.minimized))
        self.enterContext(patch.object(native.user32, 'IsWindowVisible', side_effect=lambda h: h not in self.hidden))
        def show(h, action):
            if action == 0:
                self.hidden.add(h)
            elif action == 6:
                self.minimized.add(h)
            else:
                self.hidden.discard(h); self.minimized.discard(h)
            return True
        self.show = self.enterContext(patch.object(native.user32, 'ShowWindow', side_effect=show))
        def move(h, z, x, y, w, height, flags):
            old = self.positions[h]
            self.positions[h] = (x, y, *old[2:]) if flags & 1 else (x, y, w, height)
            return True
        self.move = self.enterContext(patch.object(native.user32, 'SetWindowPos', side_effect=move))
        self.pair.state = {'game': 10, 'game_pid': 11, 'toolbar': 20, 'toolbar_pid': 22,
                           'owner': 0, 'edge': 'above', 'game_rect': self.positions[10],
                           'toolbar_rect': self.positions[20], 'pending': None, 'hidden': False, 'drag': None}
        self.owners[20] = 10

    def test_game_move_follows_without_focus_resize_or_feedback(self):
        self.positions[10] = (300, 388, 1024, 700)
        self.pair.sync(); self.pair.sync(); self.pair.sync()
        self.move.assert_called_once_with(20, 0, 300, 150, 0, 0, 0x4015)
        self.assertEqual(self.positions[20], (300, 150, 1040, 230))
        self.assertIsNone(self.pair.state['pending'])

    def test_toolbar_move_follows_game_and_resize_keeps_outside_edge(self):
        self.positions[20] = (250, 50, 1040, 260)
        self.pair.sync(); self.pair.sync()
        self.move.assert_called_once_with(10, 0, 250, 318, 0, 0, 0x4015)
        self.assertEqual(self.positions[10][2:], (1024, 700))

    def test_right_sidebar_moves_and_resizes_without_changing_game_size(self):
        self.positions[10] = (100, 100, 1024, 700)
        self.positions[20] = (1132, 100, 380, 700)
        self.pair.state.update(edge='right', game_rect=self.positions[10], toolbar_rect=self.positions[20])
        self.positions[10] = (150, 130, 1024, 700)
        self.pair.sync(); self.pair.sync()
        self.assertEqual(self.positions[20], (1182, 130, 380, 700))
        self.positions[20] = (1232, 160, 420, 750)
        self.pair.sync(); self.pair.sync()
        self.assertEqual(self.positions[10], (200, 160, 1024, 700))

    def test_slow_target_coalesces_new_drag_positions(self):
        self.move.side_effect = None; self.move.return_value = True
        self.positions[20] = (200, 150, 1040, 230)
        self.pair.sync()
        self.positions[20] = (350, 250, 1040, 230)
        self.pair.sync(); self.pair.sync()
        self.assertEqual(self.move.call_count, 1)
        self.positions[10] = (200, 388, 1024, 700)
        self.pair.sync()
        self.assertEqual(self.move.call_args.args[2:4], (350, 488))
        self.assertEqual(self.move.call_count, 2)

    def test_drag_source_wins_when_both_rectangles_change(self):
        self.pair.on_event(1, 0x000A, 20, 0, 0, 1, 0)
        self.positions[10] = (150, 338, 1024, 700)
        self.positions[20] = (250, 100, 1040, 230)
        self.pair.sync()
        self.assertEqual(self.move.call_args.args[0:4], (10, 0, 250, 338))
        self.pair.on_event(1, 0x000B, 20, 0, 0, 1, 0)
        self.assertIsNone(self.pair.state['drag'])

    def test_minimize_game_hides_toolbar_and_restore_reveals_it(self):
        self.minimized.add(10); self.pair.sync()
        self.assertIn(20, self.hidden)
        self.minimized.remove(10); self.pair.sync()
        self.assertNotIn(20, self.hidden)
        self.move.assert_not_called()

    def test_minimize_toolbar_minimizes_game_and_game_restore_restores_toolbar(self):
        self.minimized.add(20); self.pair.sync()
        self.assertIn(10, self.minimized)
        self.minimized.remove(10); self.pair.sync()
        self.assertNotIn(20, self.minimized)

    def test_game_close_releases_toolbar_and_reports_disconnection(self):
        del self.pids[10]; self.pair.sync()
        self.assertEqual(self.owners[20], 0)
        self.assertEqual(self.owners[10], 30)
        self.assertEqual(self.events, [{'kind': 'toolbar_pair_closed', 'handle': 10, 'game_closed': True}])
        self.assertTrue(self.pair.stopping.is_set())

    def test_toolbar_handle_reuse_never_moves_or_hides_unrelated_window(self):
        self.pids[20] = 99; self.pair.sync()
        self.show.assert_not_called(); self.move.assert_not_called(); self.owner.assert_not_called()
        self.assertFalse(self.events[0]['game_closed'])

    def test_unlink_restores_only_toolbar_owner_and_stops_movement(self):
        self.pair.state['owner'] = 30
        self.pair.detach(); self.positions[10] = (500, 500, 1024, 700); self.pair.sync()
        self.owner.assert_called_once_with(20, -8, 30)
        self.assertEqual(self.owners[10], 30)
        self.move.assert_not_called()
        self.assertIsNone(self.pair.state)

    def test_move_failure_is_explicit_and_clears_pending(self):
        self.move.side_effect = None; self.move.return_value = False
        self.positions[10] = (400, 400, 1024, 700)
        with self.assertRaisesRegex(RuntimeError, '联动移动失败'):
            self.pair.sync()
        self.assertIsNone(self.pair.state['pending'])

    def mock_attach_environment(self):
        def monitor(handle, result):
            r = result._obj.work
            r.left, r.top, r.right, r.bottom = 0, 0, 1920, 1040
            return True
        self.enterContext(patch.object(native.user32, 'MonitorFromWindow', return_value=1))
        self.enterContext(patch.object(native.user32, 'GetMonitorInfoW', side_effect=monitor))
        thread = Mock(); thread.is_alive.return_value = False
        thread.start.side_effect = self.pair.ready.set
        self.enterContext(patch.object(native.threading, 'Thread', return_value=thread))

    def test_attach_pairs_toolbar_without_changing_game_owner(self):
        self.mock_attach_environment()
        self.pair.detach(); self.owner.reset_mock()
        result = self.pair.attach(GameWindow(10, '诺亚传说', 11), 20, 22)
        self.assertTrue(result['linked']); self.assertTrue(result['fits'])
        self.owner.assert_called_once_with(20, -8, 10)
        self.assertEqual(self.owners[10], 30)
        self.pair.detach()

    def test_failed_attach_rolls_back_toolbar_owner(self):
        self.mock_attach_environment(); self.pair.detach(); self.owner.reset_mock()
        self.positions[20] = (0, 0, 1040, 230)
        self.move.side_effect = None; self.move.return_value = False
        with self.assertRaisesRegex(RuntimeError, '无法放置'):
            self.pair.attach(GameWindow(10, '诺亚传说', 11), 20, 22)
        self.assertEqual(self.owners[20], 0)
        self.assertEqual(self.owners[10], 30)
        self.assertIsNone(self.pair.state)

    def test_attach_rejects_reused_window_identity_before_mutation(self):
        self.pair.detach(); self.owner.reset_mock()
        with self.assertRaisesRegex(ValueError, '身份已变化'):
            self.pair.attach(GameWindow(10, '诺亚传说', 44), 20, 22)
        self.owner.assert_not_called(); self.move.assert_not_called()

    def test_service_rejects_stale_game_pid(self):
        service = Service.__new__(Service)
        service.running = False; service.recorder = None
        service.window = Mock(return_value=GameWindow(10, '诺亚传说', 11))
        service.toolbar_pair = Mock()
        args = {'handle': 10, 'game_pid': 99, 'toolbar': 20, 'toolbar_pid': 22}
        with self.assertRaisesRegex(ValueError, '身份已变化'):
            service.call('toolbar_pair_attach', args)
        service.toolbar_pair.attach.assert_not_called()
        args['game_pid'] = 11
        service.call('toolbar_pair_attach', args)
        service.toolbar_pair.attach.assert_called_once_with(service.window.return_value, 20, 22)

    def test_attach_rejects_a_child_game_window(self):
        self.pair.detach(); self.owner.reset_mock()
        with patch.object(native, 'get_long', return_value=0x40000000):
            with self.assertRaisesRegex(ValueError, '独立窗口'):
                self.pair.attach(GameWindow(10, '诺亚传说', 11), 20, 22)
        self.owner.assert_not_called(); self.move.assert_not_called()


if __name__ == '__main__':
    unittest.main()
