"""Readable one-way conversion from the low-code plan to an independent script."""
from copy import deepcopy

from .workflow import loop_pairs, loop_values


def generate_python(project):
    project.validate()
    if project.mode == 'python':
        return project.code
    steps = project.steps
    pairs = loop_pairs(steps)
    selectors = {s.name: s for s in project.selectors}
    lines = ['# 由低代码用例生成；此脚本可独立修改，原用例保持不变。',
             '# window、controls、variables、render、assign、run_script 由运行环境提供。', '']

    def target(name):
        selector = selectors[name]
        return f'controls.by_id({selector.library_id!r})' if selector.library_id else f'controls[{name!r}]'

    def emit(text, depth):
        lines.append('    '*depth + text)

    def comment(text, depth):
        for part in str(text).splitlines():
            emit('# '+part, depth)

    def walk(start, end, depth):
        index = start
        emitted = False
        while index < end:
            step = steps[index]
            if step.action == 'loop':
                if step.enabled:
                    values = loop_values(step)
                    comment(step.name, depth)
                    emit(f'for variables[{step.params.get("variable", "i")!r}] in range({values.start}, {values.stop}, {values.step}):', depth)
                    if not walk(index+1, pairs[index], depth+1):
                        emit('pass', depth+1)
                    emitted = True
                index = pairs[index]+1
                continue
            if step.enabled:
                emitted = True
                comment(f'步骤 {index+1}: {step.name}', depth)
                inner = depth
                if step.repeat > 1:
                    emit(f'for _repeat_{index+1} in range({step.repeat}):', depth)
                    inner += 1
                params, action = step.params, step.action
                timeout = f'timeout={step.timeout!r}'
                if action in {'click', 'double_click', 'right_click', 'long_press'}:
                    extra = ''
                    if action == 'double_click':
                        extra = f', count=2, interval={params.get("interval", .12)!r}'
                    elif action == 'right_click':
                        extra = ", button='right'"
                    elif action == 'long_press':
                        extra = f', hold={params.get("duration", 1)!r}, button={params.get("button", "left")!r}'
                    emit(f'window.click({target(step.target)}, {timeout}{extra})', inner)
                elif action == 'drag':
                    emit(f'window.drag({target(step.target)}, {target(step.end_target)}, duration={params.get("duration", 1)!r}, {timeout}, path={params.get("path")!r}, button={params.get("button", "left")!r})', inner)
                elif action == 'scroll':
                    emit(f'window.scroll({target(step.target)}, amount={params.get("amount", -3)!r}, axis={params.get("axis", "vertical")!r}, {timeout})', inner)
                elif action in {'wait_image', 'assert_image', 'assert_absent'}:
                    method = 'assert_absent' if action == 'assert_absent' else 'assert_image'
                    emit(f'window.{method}({target(step.target)}, {timeout})', inner)
                elif action in {'wait_ui', 'assert_ui', 'assert_ui_absent'}:
                    emit(f'window.{action}({target(step.target)}, {timeout})', inner)
                elif action in {'key', 'key_down', 'key_up'}:
                    emit(f'window.{action}({params.get("keys", "ENTER" if action == "key" else "W")!r})', inner)
                elif action == 'text':
                    emit(f'window.text(render({params.get("text", "")!r}))', inner)
                elif action == 'sleep':
                    emit(f'window.sleep({params.get("duration", 1)!r})', inner)
                elif action == 'screenshot':
                    emit('window.screenshot()', inner)
                elif action == 'set_variable':
                    emit(f'assign({params["variable"]!r}, {params.get("value", "")!r})', inner)
                elif action == 'python':
                    emit(f'run_script({params["code"]!r}, timeout={step.timeout!r}, step_name={step.name!r})', inner)
                else:
                    raise ValueError(f'无法生成 Python：{action}')
                if step.delay:
                    emit(f'window.sleep({step.delay!r})', inner)
            index += 1
        return emitted

    if not walk(0, len(steps), 0):
        lines.append('pass')
    return '\n'.join(lines) + '\n'


def python_copy(project):
    result = deepcopy(project)
    result.code = generate_python(project)
    result.mode = 'python'
    result.name = project.name + '（Python 副本）'
    result.script_timeout = 600
    result.validate()
    return result
