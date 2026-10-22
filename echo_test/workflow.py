"""Bounded low-code flow planning and shared, non-evaluating variables."""
import json
import keyword
import re

MAX_OPERATIONS = 100000
MAX_DEPTH = 8


def variable_name(value):
    if not isinstance(value, str) or not value.isidentifier() or keyword.iskeyword(value) or len(value) > 100:
        raise ValueError('变量名需要有效标识符（最多 100 字符）')
    return value


def interpolate(text, variables):
    if not isinstance(text, str):
        raise ValueError('变量替换需要文本')
    def replace(match):
        name = match.group(1)
        if name not in variables:
            raise ValueError(f'变量未定义：{name}')
        value = variables[name]
        return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, allow_nan=False)
    return re.sub(r'\$\{([^{}]+)\}', replace, text)


def assignment(value, variables):
    text = interpolate(value, variables)
    try:
        return json.loads(text, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
    except ValueError:
        return text


def loop_values(step):
    params = step.params
    variable_name(params.get('variable', 'i'))
    start, end, stride = (params.get(key, default) for key, default in [('start', 1), ('end', 10), ('step', 1)])
    if any(type(value) is not int or abs(value) > 10**12 for value in (start, end, stride)):
        raise ValueError('循环起止值和步长必须是有限整数，绝对值不超过 10¹²')
    if not stride or (end - start) * stride < 0:
        raise ValueError('循环步长不能为零且方向必须能够到达结束值')
    values = range(start, end + (1 if stride > 0 else -1), stride)
    if len(values) > 1000:
        raise ValueError('单个循环最多执行 1000 次')
    return values


def effective_steps(project):
    if project.mode == 'python':
        from .models import Step
        return [Step('Python 主程序', 'python', timeout=project.script_timeout, delay=0, params={'code': project.code})]
    return project.steps


def loop_pairs(steps):
    stack, pairs = [], {}
    for index, step in enumerate(steps):
        if step.action == 'loop':
            loop_values(step)
            stack.append(index)
            if len(stack) > MAX_DEPTH:
                raise ValueError('循环最多嵌套 8 层')
        elif step.action == 'end_loop':
            if not stack:
                raise ValueError(f'第 {index+1} 步循环结束缺少对应循环')
            pairs[stack.pop()] = index
    if stack:
        raise ValueError(f'第 {stack[-1]+1} 步循环缺少循环结束')
    return pairs


def _plan(project):
    steps = effective_steps(project)
    pairs = loop_pairs(steps)
    counts = {}
    work = 0
    def walk(start, end, multiplier):
        nonlocal work
        index = start
        while index < end:
            step = steps[index]
            if step.action == 'loop':
                if step.enabled:
                    loops = multiplier * len(loop_values(step))
                    work += loops
                    if work > MAX_OPERATIONS:
                        raise ValueError('循环展开后的执行量不能超过 100000（包含空循环）')
                    walk(index+1, pairs[index], loops)
                index = pairs[index]+1
                continue
            if step.enabled:
                counts[index] = multiplier * step.repeat
                work += counts[index]
                if work > MAX_OPERATIONS:
                    raise ValueError('循环展开后的步骤数量不能超过 100000')
            index += 1
    walk(0, len(steps), 1)
    return counts, work


def operation_counts(project):
    return _plan(project)[0]


def workflow_work(project):
    """Total bounded execution work, including loop visits with empty bodies."""
    return _plan(project)[1]


def iter_operations(project, variables, checkpoint=None):
    """Yield leaves lazily; mutation of variables is shared with Python steps."""
    steps = effective_steps(project)
    pairs = loop_pairs(steps)
    repetitions = {}
    def walk(start, end, active):
        index = start
        while index < end:
            if checkpoint:
                checkpoint()
            step = steps[index]
            if step.action == 'loop':
                if step.enabled:
                    name = step.params.get('variable', 'i')
                    for value in loop_values(step):
                        if checkpoint:
                            checkpoint()
                        variables[name] = value
                        yield from walk(index+1, pairs[index], {**active, name: value})
                index = pairs[index]+1
                continue
            if step.enabled:
                for _ in range(step.repeat):
                    repetitions[index] = repetitions.get(index, 0)+1
                    yield index, step, repetitions[index], dict(active)
            index += 1
    yield from walk(0, len(steps), {})
