"""Discover saved cases without treating reports or raw recordings as cases."""
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from .models import load_project


class CaseLibrary:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.directory = self.root / "test_cases"
        self.directory.mkdir(parents=True, exist_ok=True)

    def candidates(self):
        for root in (self.directory, self.root / "projects"):
            if not root.exists():
                continue
            for folder, directories, filenames in os.walk(root, followlinks=False):
                directories[:] = [name for name in directories if name not in {"assets", ".drafts"}
                                  and not Path(folder, name).is_symlink()
                                  and not getattr(Path(folder, name), "is_junction", lambda: False)()]
                for name in filenames:
                    if name.lower().endswith(".json"):
                        yield Path(folder, name)

    def list(self, known=()):
        entries, seen = [], set()
        for candidate in [*self.candidates(), *(Path(path) for path in known if isinstance(path, str))]:
            path = candidate.resolve()
            key = os.path.normcase(str(path))
            if key in seen or not path.is_file():
                continue
            seen.add(key)
            explicit = path.name.lower().endswith(".nycs.json")
            try:
                stat = path.stat()
                if stat.st_size > 10 * 1024 * 1024:
                    raise ValueError("用例文件超过 10 MB")
                data = json.loads(path.read_text(encoding="utf-8-sig"))
                if not explicit and not (isinstance(data, dict) and isinstance(data.get("steps"), list)
                                         and isinstance(data.get("selectors"), list) and "name" in data):
                    continue
                project = load_project(path)
                name, steps, selectors, error = str(project.name), len(project.steps), len(project.selectors), ""
            except (ValueError, OSError, TypeError, KeyError, AttributeError) as failure:
                if not explicit:
                    continue
                name, steps, selectors, error = path.name, 0, 0, str(failure)
                try:
                    stat = path.stat()
                except OSError:
                    continue
            try:
                location = path.relative_to(self.root).as_posix()
            except ValueError:
                location = str(path)
            entries.append({"path": str(path), "location": location, "name": name,
                            "steps": steps, "selectors": selectors, "error": error,
                            "modified": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat()})
        entries.sort(key=lambda item: (item["modified"], item["path"]), reverse=True)
        return {"directory": str(self.directory), "entries": entries}
