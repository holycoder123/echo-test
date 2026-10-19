"""Locations for project-local runtime state, independent of the shell cwd."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def runtime_file(name, root=ROOT):
    directory = Path(root) / ".runtime"
    directory.mkdir(parents=True, exist_ok=True)
    return directory / name


def workbench_snapshot(root=ROOT):
    # Older running versions still write their state at the project root.
    root = Path(root)
    for candidate in (root / ".runtime" / "workbench-state.json",
                      root / ".workbench-state.json",
                      root / ".runtime" / "embed-recovery.json",
                      root / ".embed-recovery.json"):
        if candidate.exists():
            return candidate
    return None
