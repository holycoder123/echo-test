"""Bounded report discovery and deletion restricted to this workspace's reports."""
import json
import os
from pathlib import Path
import re
import shutil


class ReportLibrary:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.directory = self.root / 'reports'

    @staticmethod
    def _redirected(path):
        return path.is_symlink() or getattr(path, 'is_junction', lambda: False)() or path.resolve() != path

    def _check_root(self):
        if self._redirected(self.directory):
            raise ValueError('报告目录不能使用重定向路径')

    def _report(self, identifier):
        if not isinstance(identifier, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', identifier):
            raise ValueError('无效的报告编号')
        path = self.directory / identifier
        if self._redirected(path):
            raise ValueError('报告目录不能使用重定向路径')
        if path.exists() and not path.is_dir():
            raise ValueError('报告路径不是目录')
        return path

    def list(self):
        self._check_root()
        records = []
        if not self.directory.exists():
            return records
        for candidate in sorted(self.directory.iterdir(), reverse=True):
            if len(records) >= 100:
                break
            try:
                directory = self._report(candidate.name)
                result = directory / 'result.json'
                if not result.is_file() or self._redirected(result) or result.stat().st_size > 10 * 1024 * 1024:
                    continue
                data = json.loads(result.read_text(encoding='utf-8'))
                if isinstance(data, dict):
                    records.append({**data, 'id': candidate.name})
            except (ValueError, OSError, TypeError):
                continue
        return records

    def delete(self, identifiers):
        if not isinstance(identifiers, list) or not 1 <= len(identifiers) <= 1000:
            raise ValueError('请选择 1 ~ 1000 份报告')
        self._check_root()
        paths = []
        for identifier in identifiers:
            path = self._report(identifier)
            if path not in paths and path.exists():
                paths.append(path)
        # Validate the entire batch before recursively deleting anything.
        for path in paths:
            if not (path / 'result.json').is_file():
                raise ValueError('报告不存在或尚未生成结果')
            for directory, folders, files in os.walk(path, followlinks=False):
                for name in folders + files:
                    if self._redirected(Path(directory) / name):
                        raise ValueError('报告包含重定向路径，请先检查报告目录')
        deleted = []
        for path in paths:
            if path.parent != self.directory or not path.resolve().is_relative_to(self.directory):
                raise ValueError('报告目录超出工作区')
            shutil.rmtree(path)
            deleted.append(path.name)
        return {'deleted': len(deleted), 'ids': deleted}
