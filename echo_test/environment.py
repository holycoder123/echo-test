"""Inspect local runtime files without starting OCR inference or downloading models."""
import importlib.metadata
import importlib.util
from pathlib import Path
import platform
import struct
import sys


def runtime_info(root, adb):
    def version(name):
        try:
            return importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            return ''

    root = Path(root)
    python = Path(sys.executable)
    rapid = importlib.util.find_spec('rapidocr')
    models = Path(rapid.origin).parent/'models' if rapid and rapid.origin else None
    files = sorted(str(p) for p in models.glob('*.onnx') if p.is_file() and p.stat().st_size > 0) if models else []
    ocr = {'engine': 'RapidOCR', 'version': version('rapidocr'), 'runtime_version': version('onnxruntime'),
           'model_directory': str(models) if models else '', 'model_count': len(files)}
    ocr['ready'] = bool(ocr['version'] and ocr['runtime_version'] and len(files) >= 3)
    android = {'path': '', 'source': '', 'version': '', 'error': ''}
    try:
        android['path'] = adb.resolve()
        android['source'] = 'bundled' if Path(android['path']).resolve() == (root/'runtime/android/platform-tools/adb.exe').resolve() else 'external'
        android['version'] = adb.run(['version']).splitlines()[0]
    except Exception as error:
        android['error'] = str(error)
    return {'python': {'path': str(python), 'version': platform.python_version(), 'bits': struct.calcsize('P')*8,
                       'source': 'bundled' if python.resolve() == (root/'runtime/python/python.exe').resolve() else 'external'},
            'ocr': ocr, 'adb': android}
