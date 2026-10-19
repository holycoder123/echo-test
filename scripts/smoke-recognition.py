"""Verify real offline Chinese and English OCR using generated images; no application input."""
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from PIL import Image, ImageDraw, ImageFont
from echo_test.models import Selector
from echo_test.vision import Vision


def main():
    fonts = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "Fonts"
    font_path = next((fonts / name for name in ("msyh.ttc", "simhei.ttf", "simsun.ttc") if (fonts / name).is_file()), None)
    if font_path is None:
        raise RuntimeError("Chinese system font is required for the offline OCR check")
    font = ImageFont.truetype(str(font_path), 40)
    vision = Vision(ROOT)
    results = []
    for text in ("开始测试", "Automation"):
        image = Image.new("RGB", (360, 100), "white")
        ImageDraw.Draw(image).text((24, 20), text, font=font, fill="black")
        selector = Selector(text, kind="image", recognition="ocr", text=text, threshold=.86)
        found = vision.match(image, selector)
        results.append({"generated_text": text, **vision.last_diagnostic})
    result = {"passed": all(item["matched"] for item in results), "results": results}
    dest = ROOT / "artifacts" / "recognition-ocr-smoke.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
