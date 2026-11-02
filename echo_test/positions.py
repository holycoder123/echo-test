"""Coordinates owned by an operation, independent of the shared control library."""
from copy import deepcopy
import re

POSITION_ACTIONS = {'click', 'double_click', 'right_click', 'long_press', 'drag', 'scroll'}
POSITION_FIELDS = ('x', 'y', 'normalized', 'offset_x', 'offset_y')


def validate_position(value):
    from .models import number
    if not isinstance(value, dict) or set(value) - set(POSITION_FIELDS) or not {'x', 'y'} <= set(value):
        raise ValueError('步骤位置需要 X、Y，可选比例坐标和偏移')
    if type(value.get('normalized', True)) is not bool:
        raise ValueError('比例坐标开关必须是布尔值')
    for key in ('x', 'y'):
        number(value[key], '步骤位置 ' + key.upper(), 0, 1 if value.get('normalized', True) else 100000)
    for key in ('offset_x', 'offset_y'):
        if type(value.get(key, 0)) is not int or abs(value.get(key, 0)) > 100000:
            raise ValueError('步骤位置偏移必须是有效整数')
    return value


def selector_position(selector):
    return {key: getattr(selector, key) for key in POSITION_FIELDS}


def inline_coordinates(project, selectors=None):
    """Convert only explicitly selected coordinate definitions; never modify the input."""
    from .models import referenced_selector_names
    project = deepcopy(project)
    if project.mode == 'python' or any(s.action == 'python' for s in project.steps):
        return project, 0
    mapping = {s.name: s for s in (project.selectors if selectors is None else selectors) if s.kind == 'coordinate'}
    converted, count = set(), 0
    for step in project.steps:
        if step.action not in POSITION_ACTIONS:
            continue
        for key, field in [('target', 'position'), ('end_target', 'end_position')]:
            if key == 'end_target' and step.action != 'drag':
                continue
            name = getattr(step, key)
            if name in mapping:
                step.params[field] = selector_position(mapping[name])
                setattr(step, key, '')
                converted.add(name)
                count += 1
    used = referenced_selector_names(project)
    project.selectors = [s for s in project.selectors if s.name not in converted or s.name in used]
    project.validate()
    return project, count


def legacy_recording_entry(entry):
    """Identify retained recorder artifacts using type, provenance and category together."""
    selector = entry.get('selector', {})
    origin = entry.get('origin_name', '')
    return bool(entry.get('source') != 'manual' and selector.get('kind') == 'coordinate' and not entry.get('category_id')
                and re.fullmatch(r'(?:安卓)?录制位置 \d+(?: \(\d+\))*', origin)
                and re.fullmatch(r'(?:安卓)?录制位置 \d+(?: \(\d+\))*', selector.get('name', '')))
