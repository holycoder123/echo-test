"""Verify the real local OCR engine against saved game templates; no application input."""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from PIL import Image
from echo_test.models import Selector
from echo_test.vision import Vision


def main():
    vision = Vision(ROOT)
    results = []
    for filename, text in [("newbie_accept_task.png", "接受任务"), ("newbie_complete_task.png", "完成任务")]:
        with Image.open(ROOT / "test_cases" / "assets" / filename) as image:
            selector = Selector(text, kind="image", recognition="ocr", text=text, threshold=.86)
            found = vision.match(image, selector)
        results.append({"asset": filename, **vision.last_diagnostic})
    result = {"passed": all(item["matched"] for item in results), "results": results}
    dest = ROOT / "artifacts" / "recognition-ocr-smoke.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
