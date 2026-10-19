from dataclasses import dataclass, asdict
from functools import lru_cache
import unicodedata
from pathlib import Path
import cv2
import numpy as np
from PIL import Image
from .models import Selector


@dataclass
class Match:
    x: int
    y: int
    score: float
    box: tuple[int, int, int, int]
    scale: float = 1.0
    image: str = ""
    method: str = "template"
    color_difference: float | None = None
    text: str = ""


@lru_cache(maxsize=1)
def ocr_engine():
    try:
        from rapidocr import RapidOCR
    except ImportError as error:
        raise RuntimeError("OCR 依赖未安装：需要 64 位 Python，请运行 install_dependencies.cmd 后重启工作台") from error
    return RapidOCR(params={"Global.text_score": 0., "Global.log_level": "error"})


def normalized_text(value):
    return "".join(unicodedata.normalize("NFKC", value).casefold().split())


class Vision:
    def __init__(self, base_dir: Path, ocr=None):
        self.base_dir = base_dir
        self.cache = {}
        self.ocr = ocr
        self.last_diagnostic = {}

    def load(self, name, mode="RGB"):
        path = (self.base_dir / name).resolve()
        stamp = path.stat().st_mtime_ns
        key = (str(path), stamp, mode)
        if key not in self.cache:
            with Image.open(path) as image:
                self.cache = {k: v for k, v in self.cache.items() if k[0] != str(path) or k[2] != mode}
                self.cache[key] = np.asarray(image.convert(mode))
        return self.cache[key]

    def match(self, screen: Image.Image, selector: Selector, selectors=None, _seen=()) -> Match | None:
        selector.validate()
        if selector.name in _seen or len(_seen) >= 32:
            raise ValueError("锚点引用循环或层数超过限制")
        self.last_diagnostic = {"matched": False, "target": selector.name, "threshold": selector.threshold,
                                "candidate": None, "reason": "搜索区域内没有可用候选"}
        ox = oy = 0
        anchor_diagnostic = None
        if selector.anchor:
            anchor = (selectors or {}).get(selector.anchor)
            if anchor is None or anchor.kind != "image":
                raise ValueError(f"锚点控件不存在或不是图片 / OCR 控件：{selector.anchor}")
            found = self.match(screen, anchor, selectors, (*_seen, selector.name))
            anchor_diagnostic = self.last_diagnostic
            self.last_diagnostic = {"matched": False, "target": selector.name, "threshold": selector.threshold,
                                    "candidate": None, "anchor": anchor_diagnostic, "reason": f"未找到锚点：{selector.anchor}"}
            if found is None:
                return None
            ox, oy = found.box[:2]
        width, height = screen.size
        if selector.roi:
            rx, ry, width, height = selector.roi
            ox, oy = ox + rx, oy + ry
            if not selector.anchor and (ox + width > screen.width or oy + height > screen.height):
                raise ValueError("图片搜索区域超出当前目标应用客户区")
            right, bottom = min(screen.width, ox + width), min(screen.height, oy + height)
            ox, oy = max(0, ox), max(0, oy)
            width, height = right - ox, bottom - oy
        self.last_diagnostic.update(reason="搜索区域内没有可用候选", roi=[ox, oy, width, height])
        if anchor_diagnostic is not None:
            self.last_diagnostic["anchor"] = anchor_diagnostic
        if width <= 0 or height <= 0:
            self.last_diagnostic["reason"] = "锚点相对搜索区域位于客户区外"
            return None
        rgb = np.asarray(screen.convert("RGB"))[oy:oy + height, ox:ox + width]
        if selector.recognition == "ocr":
            return self.match_text(rgb, selector, ox, oy, screen.size)
        frame = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        best = None
        accepted = None
        variants = ([{"image": selector.image, "mask": selector.mask}] if selector.image else []) + selector.templates
        for variant in variants:
            template_rgb = self.load(variant["image"])
            template = cv2.cvtColor(template_rgb, cv2.COLOR_RGB2GRAY)
            mask = None
            if variant.get("mask"):
                mask = np.where(self.load(variant["mask"], "L") >= 128, 255, 0).astype(np.uint8)
                if mask.shape != template.shape or np.count_nonzero(mask) < 16:
                    raise ValueError("遮罩需与模板尺寸一致，白色有效区域至少 16 像素")
            if min(template.shape) < 4 or float((template[mask > 0] if mask is not None else template).std()) < 2:
                raise ValueError("模板太小或缺乏图案，请重新截取包含文字 / 边缘的区域")
            for scale in selector.scales:
                tw, th = max(4, round(template.shape[1] * scale)), max(4, round(template.shape[0] * scale))
                if tw > width or th > height:
                    continue
                interpolation = cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC
                scaled = cv2.resize(template, (tw, th), interpolation=interpolation)
                scaled_mask = cv2.resize(mask, (tw, th), interpolation=cv2.INTER_NEAREST) if mask is not None else None
                active = scaled[scaled_mask > 0] if scaled_mask is not None else scaled.ravel()
                if active.size < 16 or float(active.std()) < 2:
                    continue
                scores = cv2.matchTemplate(frame, scaled, cv2.TM_CCOEFF_NORMED, mask=scaled_mask)
                scores = np.where(np.isfinite(scores), np.clip(scores, -1, 1), -2)
                differences = None
                if selector.color_tolerance is not None:
                    scaled_rgb = cv2.resize(template_rgb, (tw, th), interpolation=interpolation).astype(np.float32)
                    sqdiff = cv2.matchTemplate(rgb.astype(np.float32), scaled_rgb, cv2.TM_SQDIFF, mask=scaled_mask)
                    count = (np.count_nonzero(scaled_mask) if scaled_mask is not None else tw * th) * 3
                    differences = np.sqrt(np.maximum(0, sqdiff) / count)
                def candidate(values):
                    _, score, _, point = cv2.minMaxLoc(values)
                    if score < -1:
                        return None
                    x, y = point[0] + ox, point[1] + oy
                    return Match(x + tw // 2 + selector.offset_x, y + th // 2 + selector.offset_y,
                                 float(score), (x, y, tw, th), float(scale), variant["image"],
                                 color_difference=float(differences[point[1], point[0]]) if differences is not None else None)
                found = candidate(scores)
                if found and (best is None or found.score > best.score):
                    best = found
                if differences is not None:
                    scores = np.where(np.isfinite(differences) & (differences <= selector.color_tolerance), scores, -2)
                found = candidate(scores)
                if found and found.score >= selector.threshold and (accepted is None or found.score > accepted.score):
                    accepted = found
        if best is None:
            self.last_diagnostic["reason"] = "当前模板倍率无法放入搜索区域，或有效区域缺乏可匹配图案"
        return self.finish(accepted, best, selector, screen.size)

    def finish(self, accepted, best, selector, size):
        self.last_diagnostic["candidate"] = asdict(accepted or best) if (accepted or best) else None
        if accepted and not (0 <= accepted.x < size[0] and 0 <= accepted.y < size[1]):
            self.last_diagnostic["reason"] = "点击偏移后的坐标超出客户区"
            return None
        self.last_diagnostic["matched"] = accepted is not None
        if accepted:
            self.last_diagnostic["reason"] = "已匹配"
        elif best:
            self.last_diagnostic["reason"] = "候选匹配度低于阈值" if best.score < selector.threshold else "候选颜色差异超过容差"
        return accepted

    def match_text(self, rgb, selector, ox, oy, size):
        # RapidOCR accepts BGR arrays. Test providers return the same row data.
        result = (self.ocr or ocr_engine())(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
        if isinstance(result, tuple):
            rows = result[0]
        else:
            rows = zip(result.boxes, result.txts, result.scores) if result.boxes is not None and result.txts is not None else []
        expected = normalized_text(selector.text)
        best = accepted = None
        recognized = []
        for points, text, confidence in rows if rows is not None else []:
            score = float(confidence)
            if not np.isfinite(score):
                continue
            score = max(0., min(1., score))
            recognized.append({"text": text, "score": score})
            actual = normalized_text(text)
            matches = expected == actual if selector.text_match == "exact" else expected in actual
            if not matches:
                continue
            points = np.asarray(points)
            x, y = np.floor(points.min(axis=0)).astype(int)
            right, bottom = np.ceil(points.max(axis=0)).astype(int)
            x, y, right, bottom = max(0, x), max(0, y), min(rgb.shape[1], right), min(rgb.shape[0], bottom)
            if right <= x or bottom <= y:
                continue
            found = Match(int(ox + (x + right) // 2 + selector.offset_x), int(oy + (y + bottom) // 2 + selector.offset_y),
                          score, (int(ox + x), int(oy + y), int(right - x), int(bottom - y)), method="ocr", text=text)
            if best is None or found.score > best.score:
                best = found
            if found.score >= selector.threshold and (accepted is None or found.score > accepted.score):
                accepted = found
        self.last_diagnostic.update(recognized=recognized[:100], reason="未识别到目标文字")
        return self.finish(accepted, best, selector, size)


def coordinate(selector: Selector, size: tuple[int, int]):
    width, height = size
    x = round(selector.x * (width - 1)) if selector.normalized else round(selector.x)
    y = round(selector.y * (height - 1)) if selector.normalized else round(selector.y)
    x += selector.offset_x
    y += selector.offset_y
    if not (0 <= x < width and 0 <= y < height):
        raise ValueError(f"控件 {selector.name} 的坐标超出目标应用客户区 {width}×{height}")
    return x, y
