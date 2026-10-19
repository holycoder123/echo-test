"""Convert recorded physical input into portable, editable low-code steps."""
from __future__ import annotations
from dataclasses import asdict
import math
from .models import Selector, Step, Project, ACTIONS

KEY_NAMES = {8: "BACKSPACE", 9: "TAB", 13: "ENTER", 16: "SHIFT", 17: "CTRL", 18: "ALT", 20: "CAPSLOCK", 27: "ESC", 32: "SPACE", 33: "PAGEUP", 34: "PAGEDOWN", 35: "END", 36: "HOME", 37: "LEFT", 38: "UP", 39: "RIGHT", 40: "DOWN", 45: "INSERT", 46: "DELETE", 160: "LSHIFT", 161: "RSHIFT", 162: "LCTRL", 163: "RCTRL", 164: "LALT", 165: "RALT"}


def key_name(vk):
    if vk in KEY_NAMES:
        return KEY_NAMES[vk]
    if 48 <= vk <= 90:
        return chr(vk)
    if 112 <= vk <= 122:
        return f"F{vk-111}"
    return f"VK_{vk}"


def convert_events(events, name="录制的测试用例"):
    selectors, actions, buttons, keys = [], [], {}, set()
    def position(event):
        return float(event["x"]), float(event["y"])
    def target(event):
        x, y = position(event)
        for selector in selectors:
            if math.hypot(selector.x - x, selector.y - y) < .004:
                return selector.name
        selector = Selector(name=f"录制位置 {len(selectors)+1:02d}", x=round(x, 6), y=round(y, 6))
        selectors.append(selector)
        return selector.name
    for event in sorted(events, key=lambda item: item["t"]):
        if event["kind"] == "key":
            vk = event["vk"]
            if vk in {91, 92, 123}:
                continue
            if event["event"] == "down":
                if vk in keys:
                    continue
                keys.add(vk)
                action = "key_down"
            else:
                if vk not in keys:
                    continue
                keys.discard(vk)
                action = "key_up"
            actions.append((event["t"], event["t"], Step(name=("按下 " if action == "key_down" else "松开 ") + key_name(vk), action=action, params={"keys": key_name(vk)}, delay=0)))
        elif event["event"] == "down":
            buttons[event["button"]] = {"start": event, "path": [position(event)]}
        elif event["event"] == "move":
            for press in buttons.values():
                point = position(event)
                if math.dist(point, press["path"][-1]) > .001:
                    press["path"].append(point)
        elif event["event"] == "up":
            button = event["button"]
            press = buttons.pop(button, None)
            if press is None:
                continue
            start = press["start"]
            duration = max(.01, event["t"] - start["t"])
            path = press["path"] + [position(event)]
            moved = max(math.dist(position(start), p) for p in path) > .008
            first = target(start)
            if moved:
                sampled = path if len(path) <= 4999 else [path[round(i*(len(path)-1)/4998)] for i in range(4999)]
                step = Step(name="拖动控件", action="drag", target=first, end_target=target(event), params={"duration": round(duration, 3), "path": [list(p) for p in sampled], "button": button}, delay=0)
            elif duration >= .6:
                step = Step(name="长按控件", action="long_press", target=first, params={"duration": round(duration, 3), "button": button}, delay=0)
            else:
                action = "right_click" if button == "right" else "click"
                step = Step(name="右键控件" if button == "right" else "点击控件", action=action, target=first, delay=0)
                if button == "middle":
                    # Middle clicks use the generic long-press event with a short hold.
                    step.action = "long_press"
                    step.params = {"duration": duration, "button": "middle"}
                    step.name = "中键点击"
            actions.append((start["t"], event["t"], step))
        elif event["event"] == "wheel":
            actions.append((event["t"], event["t"], Step(name="滚动列表", action="scroll", target=target(event), params={"amount": int(event["amount"]), "axis": event.get("axis", "vertical")}, delay=0)))
    actions.sort(key=lambda item: item[0])
    merged = []
    for start, end, step in actions:
        if merged:
            pstart, pend, previous = merged[-1]
            if previous.action == step.action == "click" and previous.target == step.target and 0 <= start-pend <= .35:
                previous.action, previous.name = "double_click", "双击控件"
                previous.params = {"interval": round(max(.02, start-pend), 3)}
                merged[-1] = (pstart, end, previous)
                continue
            if previous.action == step.action == "scroll" and previous.target == step.target and previous.params.get("axis") == step.params.get("axis") and start-pend <= .15 and previous.params["amount"] * step.params["amount"] > 0 and abs(previous.params["amount"] + step.params["amount"]) <= 100:
                previous.params["amount"] += step.params["amount"]
                merged[-1] = (pstart, end, previous)
                continue
        merged.append((start, end, step))
    for index, (_, end, step) in enumerate(merged):
        step.delay = round(min(600, max(0, merged[index+1][0] - end)), 3) if index+1 < len(merged) else .3
    if keys:
        for vk in sorted(keys):
            merged.append((0, 0, Step(name="松开 " + key_name(vk), action="key_up", params={"keys": key_name(vk)}, delay=0)))
    project = Project(name=name, selectors=selectors, steps=[step for _, _, step in merged])
    project.validate()
    return project
