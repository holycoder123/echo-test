"""Read only launcher preferences; Electron remains the settings authority."""
import json
import os
from pathlib import Path


def startup_preferences(directory=None):
    result = {'admin': True, 'mcp': True}
    directory = Path(directory) if directory is not None else Path(os.environ.get('APPDATA', Path.home() / 'AppData' / 'Roaming')) / 'echo-test'
    try:
        data = json.loads((directory / 'settings.json').read_text(encoding='utf-8'))
        for name, section, key in [('admin', 'startup', 'admin'), ('mcp', 'mcp', 'enabled')]:
            value = data.get(section, {}).get(key)
            if type(value) is bool:
                result[name] = value
    except (OSError, ValueError, AttributeError, TypeError):
        pass
    return result
