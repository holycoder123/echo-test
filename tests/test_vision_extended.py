import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import cv2
import numpy as np
from PIL import Image

from echo_test.models import Project, Selector, Step, load_project, save_project
from echo_test.vision import Vision
from echo_test.engine import Runner


class RecognitionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.rng = np.random.default_rng(619)
        self.pattern = self.rng.integers(30, 220, (20, 24, 3), dtype=np.uint8)
        self.store('button.png', self.pattern)

    def store(self, name, array):
        Image.fromarray(array).save(self.root / name)

    def frame(self, pattern=None, position=(80, 60)):
        screen = Image.new('RGB', (220, 160), 'black')
        screen.paste(Image.fromarray(self.pattern if pattern is None else pattern), position)
        return screen

    def test_miss_preserves_candidate_box_scale_and_score(self):
        screen = self.frame(np.clip(self.pattern.astype(int) + self.rng.integers(-25, 26, self.pattern.shape), 0, 255).astype(np.uint8))
        vision = Vision(self.root)
        self.assertIsNone(vision.match(screen, Selector('button', kind='image', image='button.png', threshold=.999)))
        detail = vision.last_diagnostic
        self.assertFalse(detail['matched'])
        self.assertEqual(detail['candidate']['box'], (80, 60, 24, 20))
        self.assertGreater(detail['candidate']['score'], .8)
        self.assertEqual(detail['candidate']['scale'], 1)
        json.dumps(detail)

    def test_alternative_template_and_scaled_variant_win(self):
        alternate = self.rng.integers(0, 256, self.pattern.shape, dtype=np.uint8)
        self.store('hover.png', alternate)
        screen = self.frame(cv2.resize(alternate, (36, 30), interpolation=cv2.INTER_CUBIC))
        selector = Selector('button', kind='image', image='button.png', templates=[{'image':'hover.png'}], scales=[1, 1.5], threshold=.98)
        found = Vision(self.root).match(screen, selector)
        self.assertEqual(found.image, 'hover.png')
        self.assertEqual(found.box, (80, 60, 36, 30))
        self.assertEqual(found.scale, 1.5)

    def test_anchor_moves_roi_and_ignores_duplicate_elsewhere(self):
        title = self.rng.integers(0, 256, (14, 30, 3), dtype=np.uint8)
        self.store('title.png', title)
        anchor = Selector('title', kind='image', image='title.png', threshold=.99)
        button = Selector('button', kind='image', image='button.png', anchor='title', roi=[-5, 20, 65, 40], threshold=.99)
        for position in [(40, 30), (110, 80)]:
            screen = self.frame(position=(5, 5))
            screen.paste(Image.fromarray(title), position)
            screen.paste(Image.fromarray(self.pattern), (position[0]+20, position[1]+25))
            vision = Vision(self.root)
            found = vision.match(screen, button, {'title':anchor, 'button':button})
            self.assertEqual(found.box[:2], (position[0]+20, position[1]+25))
            self.assertTrue(vision.last_diagnostic['anchor']['matched'])

    def test_missing_anchor_does_not_fall_back_to_full_screen(self):
        self.store('title.png', self.rng.integers(0, 256, (14, 30, 3), dtype=np.uint8))
        anchor = Selector('title', kind='image', image='title.png', threshold=.99)
        selector = Selector('button', kind='image', image='button.png', anchor='title', roi=[0, 0, 80, 60])
        vision = Vision(self.root)
        self.assertIsNone(vision.match(self.frame(), selector, {'title':anchor}))
        self.assertIn('title', vision.last_diagnostic['reason'])
        self.assertFalse(vision.last_diagnostic['anchor']['matched'])

    def test_color_check_skips_wrong_color_at_best_grayscale_peak(self):
        gray = self.rng.integers(50, 180, (20, 24), dtype=np.uint8)
        pattern = np.repeat(gray[:, :, None], 3, axis=2)
        self.store('color.png', pattern)
        # Uniform brightness shift preserves normalized grayscale correlation.
        screen = self.frame(pattern+50, (5, 5))
        screen.paste(Image.fromarray(pattern), (80, 60))
        vision = Vision(self.root)
        selector = Selector('color', kind='image', image='color.png', color_tolerance=5, threshold=.99)
        found = vision.match(screen, selector)
        self.assertEqual(found.box[:2], (80, 60))
        self.assertLess(found.color_difference, 1)
        self.assertIsNone(vision.match(self.frame(pattern+50), selector))
        self.assertIn('颜色', vision.last_diagnostic['reason'])

    def test_mask_ignores_dynamic_half_with_color_check(self):
        mask = np.zeros(self.pattern.shape[:2], dtype=np.uint8)
        mask[:, :12] = 255
        self.store('mask.png', mask)
        changed = self.pattern.copy()
        changed[:, 12:] = 250
        selector = Selector('masked', kind='image', image='button.png', mask='mask.png', color_tolerance=5, threshold=.99)
        found = Vision(self.root).match(self.frame(changed), selector)
        self.assertEqual(found.box[:2], (80, 60))
        self.assertGreater(found.score, .99)
        self.assertLess(found.color_difference, 1)

    def test_bad_mask_and_offset_are_rejected(self):
        self.store('small.png', np.ones((5, 5), dtype=np.uint8)*255)
        with self.assertRaisesRegex(ValueError, '遮罩'):
            Vision(self.root).match(self.frame(), Selector('bad', kind='image', image='button.png', mask='small.png'))
        vision = Vision(self.root)
        self.assertIsNone(vision.match(self.frame(), Selector('bad', kind='image', image='button.png', offset_x=500)))
        self.assertIn('偏移', vision.last_diagnostic['reason'])

    def test_ocr_normalization_contains_roi_and_diagnostics(self):
        rows = [[[[2,3],[80,3],[80,20],[2,20]], '完成 任务 Ａ', .96]]
        vision = Vision(self.root, ocr=lambda image:(rows, None))
        selector = Selector('text', kind='image', recognition='ocr', text='完成任务a', roi=[30,40,100,50])
        found = vision.match(self.frame(), selector)
        self.assertEqual(found.box, (32,43,78,17))
        self.assertEqual((found.x,found.y), (71,51))
        self.assertEqual(found.method, 'ocr')
        json.dumps(vision.last_diagnostic)
        selector.text = '任务'
        self.assertIsNone(vision.match(self.frame(), selector))
        self.assertEqual(vision.last_diagnostic['recognized'][0]['text'], '完成 任务 Ａ')
        selector.text_match = 'contains'
        self.assertIsNotNone(vision.match(self.frame(), selector))
        selector.threshold = .99
        self.assertIsNone(vision.match(self.frame(), selector))
        self.assertGreater(vision.last_diagnostic['candidate']['score'], .9)

    def test_empty_ocr_result_never_clicks(self):
        vision = Vision(self.root, ocr=lambda image:(None,None))
        self.assertIsNone(vision.match(self.frame(), Selector('text', kind='image', recognition='ocr', text='完成任务')))
        self.assertEqual(vision.last_diagnostic['recognized'], [])

    def test_assets_roundtrip_includes_alternatives_and_masks(self):
        self.store('hover.png', self.pattern[::-1].copy())
        self.store('mask.png', np.ones(self.pattern.shape[:2], dtype=np.uint8)*255)
        selector = Selector('button', kind='image', image='button.png', mask='mask.png', templates=[{'image':'hover.png','mask':'mask.png'}])
        text = Selector('text', kind='image', recognition='ocr', text='任务', anchor='button', roi=[0,20,60,30])
        path = self.root/'portable'/'case.echo.json'
        saved = save_project(Project(selectors=[selector,text]), path, self.root)
        self.assertEqual(saved.to_dict(), load_project(path).to_dict())
        for asset in saved.selectors[0].asset_paths():
            self.assertTrue((path.parent/asset).is_file())
        self.assertIsNotNone(Vision(path.parent).match(self.frame(), saved.selectors[0]))

    def test_anchor_validation_rejects_cycles_missing_and_coordinate(self):
        for anchor in ['missing', 'A', 'point']:
            with self.subTest(anchor=anchor), self.assertRaises(ValueError):
                Project(selectors=[Selector('A',kind='image',image='button.png',anchor=anchor,roi=[0,0,40,40]),Selector('point')]).validate()

    def test_runner_failure_report_retains_recognition_and_candidate_image(self):
        class Backend:
            def size(inner): return (220,160)
            def activate(inner): pass
            def pause(inner,seconds): pass
            def cancelled(inner): return False
            def capture(inner): return self.frame(np.clip(self.pattern.astype(int)+self.rng.integers(-30,31,self.pattern.shape),0,255).astype(np.uint8))
        project = Project(selectors=[Selector('button',kind='image',image='button.png',threshold=.999)],steps=[Step(target='button',timeout=.1)])
        runner = Runner(Backend(), project, self.root, self.root/'reports')
        result = runner.run()
        self.assertEqual(result['status'], 'failed')
        step = result['steps'][0]
        self.assertIn('最佳匹配度', step['error'])
        self.assertFalse(step['recognition']['button']['matched'])
        self.assertTrue((runner.directory/step['recognition_screenshot']).is_file())
        self.assertIn('识别诊断', (runner.directory/'report.html').read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main()
