"""Persistent controls shared by every case, with stable IDs and portable snapshots."""
from __future__ import annotations
from copy import deepcopy
from dataclasses import asdict
import hashlib
import io
import json
from pathlib import Path
import re
from uuid import uuid4
from PIL import Image
from .models import Project, Selector, referenced_selector_names
from .case_library import CaseLibrary


class ControlLibrary:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.directory = self.root / 'control_library'
        self.asset_base = self.root / 'test_cases'
        self.assets = self.asset_base / 'assets'
        for directory in (self.directory, self.assets):
            if directory.resolve() != directory:
                raise ValueError('通用控件库目录不能使用重定向路径')
        self.path = self.directory / 'controls.json'
        self.data = {'schema_version': 1, 'categories': [], 'entries': [], 'imports': {}, 'deleted_ids': []}
        self.warnings = []
        if self.path.exists():
            if self.path.stat().st_size > 16 * 1024 * 1024:
                raise ValueError('通用控件库超过 16 MB')
            self.data = json.loads(self.path.read_text(encoding='utf-8'))
            self._validate(self.data)
            normalized = {self.source_key(key): value for key, value in self.data.get('imports', {}).items()}
            if normalized != self.data.get('imports', {}):
                updated = deepcopy(self.data); updated['imports'] = normalized; self._commit(updated)

    def source_key(self, value):
        path = Path(value)
        if not path.is_absolute():
            path = self.root / path
        path = path.resolve()
        try:
            return path.relative_to(self.root).as_posix()
        except ValueError:
            return str(path)

    def source_path(self, value):
        path = Path(value)
        return path if path.is_absolute() else self.root / path

    @staticmethod
    def _name(value, label, maximum=200):
        if not isinstance(value, str) or not value.strip() or len(value.strip()) > maximum:
            raise ValueError(f'{label}需要 1 ~ {maximum} 字')
        return value.strip()

    def _validate(self, data):
        if not isinstance(data, dict) or data.get('schema_version') != 1:
            raise ValueError('不支持的通用控件库版本')
        categories, entries = data.get('categories'), data.get('entries')
        if not isinstance(categories, list) or len(categories) > 200 or not isinstance(entries, list) or len(entries) > 5000:
            raise ValueError('分类或控件数量超出限制')
        ids, names = set(), set()
        for category in categories:
            name = self._name(category.get('name'), '分类名称', 80)
            if name.casefold() in names or not re.fullmatch(r'[a-f0-9]{32}', category.get('id', '')) or category['id'] in ids:
                raise ValueError('分类名称或标识重复 / 无效')
            names.add(name.casefold()); ids.add(category['id'])
        control_ids = set()
        selectors = []
        for entry in entries:
            identifier = entry.get('id', '')
            if not re.fullmatch(r'[a-f0-9]{32}', identifier) or identifier in control_ids:
                raise ValueError('控件标识重复 / 无效')
            if entry.get('category_id', '') not in ids | {''}:
                raise ValueError('控件分类不存在')
            selector = Selector(**entry['selector'])
            if selector.library_id != identifier:
                raise ValueError('控件引用标识不一致')
            self._name(selector.name, '控件名称')
            for asset in selector.asset_paths():
                self.asset_path(asset, required=False)
            control_ids.add(identifier); selectors.append(selector)
        Project(selectors=selectors).validate()
        if not isinstance(data.get('imports', {}), dict) or not isinstance(data.get('deleted_ids', []), list):
            raise ValueError('控件迁移记录无效')

    def _commit(self, data):
        self._validate(data)
        self.directory.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix('.json.tmp')
        if self.path.resolve() != self.path or temporary.resolve() != temporary:
            raise ValueError('通用控件库文件不能使用重定向路径')
        serialized = json.dumps(data, ensure_ascii=False, indent=2)
        if len(serialized.encode('utf-8')) > 16 * 1024 * 1024:
            raise ValueError('通用控件库超过 16 MB')
        temporary.write_text(serialized, encoding='utf-8')
        temporary.replace(self.path)
        self.data = data

    def asset_path(self, image, required=True):
        if not isinstance(image, str) or not re.fullmatch(r'assets/[\w-]+\.png', image):
            raise ValueError('通用控件模板必须位于 assets 目录')
        path = self.asset_base / image
        if path.resolve() != path or (required and not path.is_file()):
            raise ValueError('通用控件模板不存在或使用了重定向路径')
        return path

    def _copy_asset(self, source):
        source = Path(source)
        if not source.is_file() or source.stat().st_size > 16 * 1024 * 1024:
            raise ValueError(f'控件模板不存在或超过 16 MB：{source.name}')
        with Image.open(source) as image:
            if not 1 <= image.width <= 4096 or not 1 <= image.height <= 4096:
                raise ValueError('控件模板尺寸超出限制')
            buffer = io.BytesIO()
            image.save(buffer, format='PNG')
        content = buffer.getvalue()
        name = 'control_' + hashlib.sha256(content).hexdigest()[:24] + '.png'
        destination = self.asset_path('assets/' + name, required=False)
        self.assets.mkdir(parents=True, exist_ok=True)
        if not destination.exists():
            with destination.open('xb') as target:
                target.write(content)
        return 'assets/' + name

    def _store_assets(self, selector, source_dir):
        for owner, key in selector.asset_fields():
            value = owner.get(key, '') if isinstance(owner, dict) else getattr(owner, key)
            if not value:
                continue
            value = self._copy_asset(Path(source_dir) / value)
            if isinstance(owner, dict):
                owner[key] = value
            else:
                setattr(owner, key, value)
        return selector

    @staticmethod
    def _signature(selector):
        value = asdict(selector)
        value.pop('library_id', None)
        value.pop('name', None)
        return json.dumps(value, sort_keys=True, ensure_ascii=False)

    def list(self, query='', category_id=None):
        if not isinstance(query, str) or len(query) > 500:
            raise ValueError('搜索文字最多 500 字')
        categories = deepcopy(self.data['categories'])
        names = {item['id']: item['name'] for item in categories}
        entries = []
        for entry in self.data['entries']:
            if category_id is not None and entry['category_id'] != category_id:
                continue
            selector = entry['selector']
            text = ' '.join([selector['name'], names.get(entry['category_id'], '未分类'), selector.get('text', ''),
                             ' '.join(str(value) for value in selector.get('ui', {}).values()),
                             '安卓 UI android_ui' if selector['kind'] == 'android_ui' else '坐标 coordinate' if selector['kind'] == 'coordinate' else '图片 image OCR 模板 template'])
            if not all(word in text.casefold() for word in query.strip().casefold().split()):
                continue
            entries.append(deepcopy(entry))
        for category in categories:
            category['count'] = sum(entry['category_id'] == category['id'] for entry in self.data['entries'])
        return {'entries': entries, 'categories': categories, 'total': len(self.data['entries']),
                'uncategorized': sum(not entry['category_id'] for entry in self.data['entries']),
                'directory': str(self.directory), 'warnings': deepcopy(self.warnings)}

    def import_project(self, project, source_dir, source_path=None, category_id=''):
        """Migrate definitions once; persisted IDs subsequently resolve to the shared control."""
        project = Project.from_dict(project.to_dict())
        needed = referenced_selector_names(project)
        data = deepcopy(self.data)
        by_id = {entry['id']: entry for entry in data['entries']}
        by_name = {entry['selector']['name']: entry for entry in data['entries']}
        originals = {selector.name: selector for selector in project.selectors}
        source_key = self.source_key(source_path) if source_path else None
        imported = data.setdefault('imports', {}).setdefault(source_key, {}) if source_key else {}
        resolved = {}
        if category_id not in {item['id'] for item in data['categories']} | {''}:
            raise ValueError('控件分类不存在')

        def adopt(name):
            if name in resolved:
                return resolved[name]
            selector = originals[name]
            identifier = selector.library_id or imported.get(name, '')
            if identifier in by_id:
                resolved[name] = by_id[identifier]
                return resolved[name]
            if identifier and identifier in data.get('deleted_ids', []):
                if name not in needed:
                    resolved[name] = None
                    return None
                raise ValueError(f'引用的通用控件已删除：{name}')
            if selector.kind == 'image' and selector.anchor:
                selector.anchor = adopt(selector.anchor)['selector']['name']
            self._store_assets(selector, source_dir)
            duplicate = next((entry for entry in data['entries']
                              if entry.get('origin_name', entry['selector']['name']) == name and self._signature(Selector(**entry['selector'])) == self._signature(selector)), None)
            if duplicate:
                entry = duplicate
            else:
                base, number = selector.name, 2
                while selector.name in by_name:
                    selector.name = f'{base} ({number})'; number += 1
                identifier = identifier or uuid4().hex
                selector.library_id = identifier
                entry = {'id': identifier, 'category_id': category_id, 'origin_name': name, 'selector': asdict(selector)}
                data['entries'].append(entry); by_id[identifier] = entry; by_name[selector.name] = entry
            resolved[name] = entry
            return entry

        for name in originals:
            adopt(name)
        resolved = {name: entry for name, entry in resolved.items() if entry is not None}
        renamed = {name: entry['selector']['name'] for name, entry in resolved.items()}
        project.selectors = list({entry['id']: Selector(**deepcopy(entry['selector'])) for entry in resolved.values()}.values())
        if project.mode == 'python' or any(step.enabled and step.action == 'python' for step in project.steps):
            for original_name, entry in resolved.items():
                if original_name != entry['selector']['name'] and not any(item.name == original_name for item in project.selectors):
                    alias = Selector(**deepcopy(entry['selector'])); alias.name = original_name; project.selectors.append(alias)
        # An existing shared control can gain an anchor absent from an old snapshot.
        def add_anchor(selector):
            if selector.kind == 'image' and selector.anchor:
                anchor = by_name[selector.anchor]
                if not any(item.library_id == anchor['id'] for item in project.selectors):
                    added = Selector(**deepcopy(anchor['selector'])); project.selectors.append(added); add_anchor(added)
        for selector in list(project.selectors):
            add_anchor(selector)
        for step in project.steps:
            step.target = renamed.get(step.target, step.target)
            step.end_target = renamed.get(step.end_target, step.end_target)
        if source_key:
            imported.update({name: entry['id'] for name, entry in resolved.items()})
        project.validate()
        if data != self.data:
            self._commit(data)
        return project

    def migrate(self):
        for entry in CaseLibrary(self.root).list()['entries']:
            path = Path(entry['path'])
            if entry['error']:
                self.warnings.append({'path': str(path), 'message': entry['error']})
                continue
            try:
                from .models import load_project
                project = load_project(path)
                self.import_project(project, path.parent, path)
            except (ValueError, OSError, TypeError, KeyError, AttributeError) as error:
                self.warnings.append({'path': str(path), 'message': str(error)})

    def resolve_project(self, project, source_dir):
        """Use current definitions at execution/save time, retaining script aliases."""
        project = Project.from_dict(project.to_dict())
        by_id = {entry['id']: entry for entry in self.data['entries']}
        by_name = {entry['selector']['name']: entry for entry in self.data['entries']}
        names, selectors, aliases = {}, {}, []
        has_python = project.mode == 'python' or any(step.enabled and step.action == 'python' for step in project.steps)
        for original in project.selectors:
            if not original.library_id:
                selectors[original.name] = original
                continue
            entry = by_id.get(original.library_id)
            if not entry:
                if original.name not in referenced_selector_names(project):
                    continue
                raise ValueError(f'引用的通用控件不存在：{original.name}')
            selector = Selector(**deepcopy(entry['selector']))
            names[original.name] = selector.name
            if has_python and original.name != selector.name:
                alias = deepcopy(selector); alias.name = original.name; aliases.append(alias)
            selectors[selector.name] = selector
        if has_python:
            for entry in self.data['entries']:
                selector = Selector(**deepcopy(entry['selector']))
                selectors.setdefault(selector.name, selector)
        def include_anchor(selector):
            if selector.kind == 'image' and selector.anchor and selector.anchor not in selectors:
                entry = by_name[selector.anchor]
                anchor = Selector(**deepcopy(entry['selector']))
                selectors[anchor.name] = anchor; include_anchor(anchor)
        for selector in list(selectors.values()):
            include_anchor(selector)
        for alias in aliases:
            selectors.setdefault(alias.name, alias)
        for selector in selectors.values():
            if not selector.library_id:
                selector.anchor = names.get(selector.anchor, selector.anchor)
            for owner, key in selector.asset_fields():
                value = owner.get(key, '') if isinstance(owner, dict) else getattr(owner, key)
                if not value:
                    continue
                absolute = str(self.asset_path(value)) if selector.library_id else str((Path(source_dir) / value).resolve())
                if isinstance(owner, dict):
                    owner[key] = absolute
                else:
                    setattr(owner, key, absolute)
        for step in project.steps:
            step.target = names.get(step.target, step.target)
            step.end_target = names.get(step.end_target, step.end_target)
        project.selectors = list(selectors.values()); project.validate()
        return project

    def prune_project(self, project):
        names = referenced_selector_names(project)
        project.selectors = [selector for selector in project.selectors if selector.name in names]
        project.validate()
        return project

    def save(self, selector, category_id='', identifier=None):
        data = deepcopy(self.data)
        if category_id not in {item['id'] for item in data['categories']} | {''}:
            raise ValueError('控件分类不存在')
        selector = Selector(**selector)
        selector.name = self._name(selector.name, '控件名称')
        existing = next((entry for entry in data['entries'] if entry['id'] == identifier), None)
        if identifier and not existing:
            raise ValueError('控件已不存在，请刷新控件库')
        if any(entry['id'] != identifier and entry['selector']['name'] == selector.name for entry in data['entries']):
            raise ValueError('通用控件名称已存在')
        for image in selector.asset_paths():
            self.asset_path(image)
        identifier = identifier or uuid4().hex
        selector.library_id = identifier
        entry = {'id': identifier, 'category_id': category_id, 'origin_name': existing.get('origin_name', existing['selector']['name']) if existing else selector.name, 'selector': asdict(selector)}
        if existing:
            old_name = existing['selector']['name']
            for row in data['entries']:
                if row['selector'].get('anchor') == old_name:
                    row['selector']['anchor'] = selector.name
            data['entries'][data['entries'].index(existing)] = entry
        else:
            data['entries'].append(entry)
        self._commit(data)
        return {'control': deepcopy(entry), **self.list()}

    def delete(self, identifier, current_ids=()):
        entry = next((entry for entry in self.data['entries'] if entry['id'] == identifier), None)
        if not entry:
            raise ValueError('控件已不存在，请刷新控件库')
        if any(row['id'] != identifier and row['selector'].get('anchor') == entry['selector']['name'] for row in self.data['entries']):
            raise ValueError('这个控件仍被用作定位锚点')
        if identifier in current_ids:
            raise ValueError('这个控件仍被当前用例使用，请先修改步骤')
        paths = {*CaseLibrary(self.root).candidates(), *(self.source_path(value) for value in self.data.get('imports', {}))}
        for path in paths:
            if not path.is_file() or path.stat().st_size > 10 * 1024 * 1024:
                continue
            try:
                payload = json.loads(path.read_text(encoding='utf-8-sig'))
                imported = self.data.get('imports', {}).get(self.source_key(path), {})
                try:
                    used_names = referenced_selector_names(Project.from_dict(payload))
                except (ValueError, TypeError, KeyError):
                    used_names = {row.get('name') for row in payload.get('selectors', [])}
                if any(row.get('name') in used_names and (row.get('library_id') == identifier or imported.get(row.get('name')) == identifier) for row in payload.get('selectors', [])):
                    raise ValueError(f'这个控件仍被已保存用例「{payload.get("name", path.stem)}」引用')
            except (OSError, json.JSONDecodeError, AttributeError, TypeError):
                continue
        data = deepcopy(self.data)
        data['entries'] = [row for row in data['entries'] if row['id'] != identifier]
        data.setdefault('deleted_ids', []).append(identifier)
        self._commit(data)
        return self.list()

    def save_category(self, name, identifier=None):
        name = self._name(name, '分类名称', 80)
        data = deepcopy(self.data)
        if name == '未分类' or any(row['name'].casefold() == name.casefold() and row['id'] != identifier for row in data['categories']):
            raise ValueError('分类名称已存在')
        existing = next((row for row in data['categories'] if row['id'] == identifier), None)
        if identifier and not existing:
            raise ValueError('分类已不存在')
        category = {'id': identifier or uuid4().hex, 'name': name}
        if existing:
            data['categories'][data['categories'].index(existing)] = category
        else:
            data['categories'].append(category)
        self._commit(data)
        return {'category': category, **self.list()}

    def delete_category(self, identifier):
        data = deepcopy(self.data)
        if not any(row['id'] == identifier for row in data['categories']):
            raise ValueError('分类已不存在')
        data['categories'] = [row for row in data['categories'] if row['id'] != identifier]
        for entry in data['entries']:
            if entry['category_id'] == identifier:
                entry['category_id'] = ''
        self._commit(data)
        return self.list()
