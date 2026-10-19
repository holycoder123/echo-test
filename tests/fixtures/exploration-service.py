"""Isolated JSON-line service for MCP integration; never calls desktop APIs."""
from pathlib import Path
import sys
import threading
from types import SimpleNamespace

source = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(source), str(source / "tests")]
from test_exploration import ExplorationBackend
from echo_test import service as native
from echo_test.backend import GameWindow

native.ROOT = Path(sys.argv[1])
service = native.Service.__new__(native.Service)
service.running = False
service.recorder = None
service.worker = None
service.stop_event = threading.Event()
service.toolbar_pair = SimpleNamespace(detach=lambda: None)
service.base_dir = native.ROOT / "editor"
service.case_path = service.base_dir / "draft.echo.json"
service.pending_recording = {"preserved": True}
game = GameWindow(1234, "Isolated MCP test window", 99)
backend = ExplorationBackend()

def make_backend(window, stop=None):
    if stop is not None:
        backend.stop = stop
    return backend

native.WindowsBackend = make_backend
native.list_game_windows = lambda **kwargs: [game]
native.is_admin = lambda: False
native.Service = lambda: service
native.main()
