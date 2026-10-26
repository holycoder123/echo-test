"""Bounded UI Automator hierarchy snapshots and exact native selectors."""
import re
import xml.etree.ElementTree as ET

STRING_FIELDS = ('resource_id', 'text', 'description', 'class_name', 'package')
ATTRIBUTES = {'resource_id': 'resource-id', 'text': 'text', 'description': 'content-desc',
              'class_name': 'class', 'package': 'package'}


def validate_query(query):
    if not isinstance(query, dict) or set(query)-set(STRING_FIELDS)-{'clickable', 'enabled', 'index'}:
        raise ValueError('安卓 UI 定位条件无效')
    for key in STRING_FIELDS:
        if key in query and (not isinstance(query[key], str) or len(query[key]) > 4096):
            raise ValueError('安卓 UI 属性需要不超过 4096 字符的文本')
    if not any(query.get(key, '').strip() for key in STRING_FIELDS):
        raise ValueError('安卓 UI 定位至少填写 ID、文字、描述、类名或包名中的一项')
    for key in ('clickable', 'enabled'):
        if key in query and type(query[key]) is not bool:
            raise ValueError('安卓 UI 状态条件必须为布尔值')
    if 'index' in query and (type(query['index']) is not int or not 1 <= query['index'] <= 5000):
        raise ValueError('安卓 UI 匹配序号需为 1 ~ 5000')


def parse_hierarchy(data, natural_size):
    if not data or len(data) > 8*1024*1024:
        raise ValueError('安卓控件树为空、过大或包含不支持的 XML 声明')
    try:
        source = data.decode('utf-8-sig')
    except UnicodeDecodeError as error:
        raise ValueError('安卓控件树必须为 UTF-8 XML') from error
    if '\x00' in source or re.search(r'<!\s*(?:DOCTYPE|ENTITY)', source, re.I):
        raise ValueError('安卓控件树包含不支持的 XML 声明')
    try:
        root = ET.fromstring(source)
    except ET.ParseError as error:
        raise ValueError('无法解析安卓控件树') from error
    rotation = root.get('rotation', '0')
    if root.tag != 'hierarchy' or rotation not in {'0', '1', '2', '3'}:
        raise ValueError('不支持的安卓控件树格式')
    width, height = natural_size
    if int(rotation) % 2:
        width, height = height, width
    nodes = []
    stack = [(child, None, 0) for child in reversed(list(root))]
    while stack:
        element, parent, depth = stack.pop()
        if len(nodes) >= 5000 or depth > 128:
            raise ValueError('安卓控件树超过 5000 个节点或 128 层')
        if element.tag != 'node':
            raise ValueError('不支持的安卓控件节点')
        node = {key: element.get(attr, '')[:4096] for key, attr in ATTRIBUTES.items()}
        bounds = re.fullmatch(r'\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]', element.get('bounds', ''))
        if not bounds:
            raise ValueError('安卓控件边界格式无效')
        x1, y1, x2, y2 = map(int, bounds.groups())
        x1, y1, x2, y2 = max(0, x1), max(0, y1), min(width, x2), min(height, y2)
        node.update(id=len(nodes), parent=parent, depth=depth, bounds=[x1, y1, max(0, x2-x1), max(0, y2-y1)],
                    visible=x2>x1 and y2>y1 and element.get('visible-to-user', 'true') == 'true')
        for key in ('clickable', 'enabled', 'checkable', 'checked', 'selected', 'scrollable'):
            node[key] = element.get(key, 'false') == 'true'
        nodes.append(node)
        stack.extend((child, node['id'], depth+1) for child in reversed(list(element)))
    return {'width':width, 'height':height, 'rotation':int(rotation), 'nodes':nodes}


def candidates(snapshot, query):
    validate_query(query)
    return [node for node in snapshot['nodes'] if node['visible'] and all(
        node.get(key) == value for key, value in query.items() if key != 'index' and value != '')]


def locate(snapshot, query):
    found = candidates(snapshot, query)
    if 'index' in query:
        return (found[query['index']-1] if len(found) >= query['index'] else None), len(found)
    if len(found) > 1:
        raise ValueError(f'安卓 UI 控件匹配到 {len(found)} 个节点，请增加条件或指定匹配序号')
    return (found[0] if found else None), len(found)


def selector_for(snapshot, node_id):
    node = next((n for n in snapshot['nodes'] if n['id'] == node_id and n['visible']), None)
    if node is None:
        raise ValueError('所选安卓控件不存在或不可见')
    query = {'package':node['package']} if node['package'] else {}
    primary = next((key for key in ('resource_id', 'description', 'text', 'class_name') if node[key]), None)
    if primary:
        query[primary] = node[primary]
    for key in ('class_name', 'description', 'text'):
        if len(candidates(snapshot, query)) <= 1:
            break
        if node[key]:
            query[key] = node[key]
    found = candidates(snapshot, query)
    if len(found) > 1:
        query['index'] = next(i+1 for i, n in enumerate(found) if n['id'] == node_id)
    return query
