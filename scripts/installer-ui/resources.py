"""Generate native NSIS dialogs without a Windows SDK/resource compiler.

Other NSIS dialogs stay in the verified modern.exe; only the main shell and real
installation progress template are replaced. All installed UI code is native.
"""
import argparse
import ctypes as ct
from ctypes import wintypes as wt
from pathlib import Path
import shutil
import struct

CHILD = 0x40000000
VISIBLE = 0x10000000
TABSTOP = 0x10000


def control(identity, klass, text, rect, style=CHILD | VISIBLE, exstyle=0):
    return dict(id=identity, **{'class': klass}, text=text, rect=rect, style=style, exstyle=exstyle)


def dialog_definitions():
    button = CHILD | VISIBLE | TABSTOP | 0xb
    return {
        105: dict(style=0x82880840, exstyle=0x40000, rect=(0, 0, 392, 320), font='Segoe UI',
                  title='EchoTest', controls=[
                      control(1, 0x80, '下一步', (322, 292, 56, 20), button),
                      control(3, 0x80, '上一步', (274, 292, 42, 20), button),
                      control(2, 0x80, '取消', (226, 292, 42, 20), button),
                      control(3200, 0x80, '关闭', (368, 6, 16, 18), button),
                      control(1018, 0x82, '', (0, 70, 392, 210), CHILD),
                      control(1028, 0x82, '', (0, 0, 0, 0), CHILD),
                  ]),
        106: dict(style=CHILD | 0x440, exstyle=0, rect=(0, 0, 392, 210), font='Segoe UI',
                  title='', controls=[
                      control(3301, 0x82, 'INSTALLING', (20, 16, 352, 12)),
                      control(3302, 0x82, '正在安装 EchoTest', (20, 32, 352, 24)),
                      control(3303, 0x82, '正在准备程序和离线运行环境，请稍候。', (20, 58, 352, 16)),
                      control(1006, 0x82, '', (20, 82, 352, 14), CHILD | VISIBLE | 0x4000),
                      control(1004, 'msctls_progress32', '', (20, 100, 352, 5), CHILD | VISIBLE | 1),
                      control(3304, 0x82, '', (20, 112, 352, 14), CHILD | VISIBLE | 0x4000),
                      control(3305, 0x82, '0%', (320, 82, 52, 22), CHILD | VISIBLE | 2),
                      control(3306, 0x82, '正在检查安装环境', (20, 82, 280, 20)),
                      control(3307, 0x82, '检查安装环境', (34, 136, 320, 16)),
                      control(3308, 0x82, '写入程序与离线运行环境', (34, 153, 320, 16)),
                      control(3309, 0x82, '创建快捷方式并完成配置', (34, 170, 320, 16)),
                      control(3310, 0x80, '查看安装详情', (20, 190, 120, 18), CHILD | VISIBLE | TABSTOP | 0xb),
                      control(1027, 0x80, '查看安装详情', (20, 134, 76, 18), CHILD | VISIBLE | TABSTOP),
                      control(1016, 'SysListView32', '', (20, 156, 352, 48), CHILD | TABSTOP | 0x800000 | 0x4005),
                  ]),
    }


def field(value):
    if isinstance(value, int):
        return struct.pack('<HH', 0xffff, value)
    return (value + '\0').encode('utf-16-le')


def encode_dialog(dialog):
    data = bytearray(struct.pack('<HHIIIHhhhh', 1, 0xffff, 0, dialog['exstyle'],
                                 dialog['style'], len(dialog['controls']), *dialog['rect']))
    data += b'\0\0\0\0'  # no menu, standard dialog class
    data += field(dialog['title'])
    data += struct.pack('<HHBB', 9, 400, 0, 1) + field(dialog['font'])
    for item in dialog['controls']:
        data += bytes((-len(data)) % 4)
        data += struct.pack('<IIIhhhhI', 0, item['exstyle'], item['style'], *item['rect'], item['id'])
        data += field(item['class']) + field(item['text']) + b'\0\0'
    return bytes(data)


def write_ui(source, destination):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if source == destination:
        raise ValueError('UI output must not replace the NSIS compiler asset')
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    kernel = ct.WinDLL('kernel32', use_last_error=True)
    kernel.BeginUpdateResourceW.argtypes = [wt.LPCWSTR, wt.BOOL]
    kernel.BeginUpdateResourceW.restype = wt.HANDLE
    kernel.UpdateResourceW.argtypes = [wt.HANDLE, ct.c_void_p, ct.c_void_p, wt.WORD, ct.c_void_p, wt.DWORD]
    kernel.UpdateResourceW.restype = wt.BOOL
    kernel.EndUpdateResourceW.argtypes = [wt.HANDLE, wt.BOOL]
    kernel.EndUpdateResourceW.restype = wt.BOOL
    handle = kernel.BeginUpdateResourceW(str(destination), False)
    if not handle:
        raise ct.WinError(ct.get_last_error())
    try:
        for identity, dialog in dialog_definitions().items():
            data = encode_dialog(dialog)
            buffer = ct.create_string_buffer(data)
            if not kernel.UpdateResourceW(handle, 5, identity, 1033, buffer, len(data)):
                raise ct.WinError(ct.get_last_error())
    except BaseException:
        kernel.EndUpdateResourceW(handle, True)
        raise
    if not kernel.EndUpdateResourceW(handle, False):
        raise ct.WinError(ct.get_last_error())
    return destination


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    print(write_ui(args.source, args.destination))
    # Reuse the transparent brand mark from the approved preview.
    from PIL import Image
    mark = Path(__file__).resolve().parents[2] / 'docs' / 'brand' / 'mark.png'
    with Image.open(mark) as image:
        image.save(args.destination.with_name('echo-setup-mark.ico'), format='ICO',
                   sizes=[(32, 32), (48, 48), (64, 64)])
