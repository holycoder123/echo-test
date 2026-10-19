"""Read the official Tcl/Tk MSI and extract its cabinet without installing anything."""
import ctypes as ct
from ctypes import wintypes as wt
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
msi = ct.WinDLL('msi')
msi.MsiOpenDatabaseW.argtypes = [wt.LPCWSTR, ct.c_void_p, ct.POINTER(wt.UINT)]
msi.MsiDatabaseOpenViewW.argtypes = [wt.UINT, wt.LPCWSTR, ct.POINTER(wt.UINT)]
msi.MsiViewExecute.argtypes = [wt.UINT, wt.UINT]
msi.MsiViewFetch.argtypes = [wt.UINT, ct.POINTER(wt.UINT)]
msi.MsiRecordGetStringW.argtypes = [wt.UINT, wt.UINT, wt.LPWSTR, ct.POINTER(wt.DWORD)]
msi.MsiRecordReadStream.argtypes = [wt.UINT, wt.UINT, ct.c_void_p, ct.POINTER(wt.DWORD)]
msi.MsiCloseHandle.argtypes = [wt.UINT]


def check(code):
    if code:
        raise RuntimeError(f'MSI read error {code}')


def record_string(record, field):
    size = wt.DWORD(0)
    code = msi.MsiRecordGetStringW(record, field, None, ct.byref(size))
    if code not in (0, 234):
        check(code)
    size.value += 1
    buffer = ct.create_unicode_buffer(size.value)
    check(msi.MsiRecordGetStringW(record, field, buffer, ct.byref(size)))
    return buffer.value


def query(database, sql, fields):
    view = wt.UINT()
    check(msi.MsiDatabaseOpenViewW(database, sql, ct.byref(view)))
    try:
        check(msi.MsiViewExecute(view, 0))
        rows = []
        while True:
            record = wt.UINT()
            code = msi.MsiViewFetch(view, ct.byref(record))
            if code == 259:
                return rows
            check(code)
            try:
                rows.append(tuple(record_string(record, field) for field in range(1, fields+1)))
            finally:
                msi.MsiCloseHandle(record)
    finally:
        msi.MsiCloseHandle(view)


def main():
    cache = ROOT/'.runtime'/'portable-build'
    source = cache/'tcltk.msi'
    extracted = cache/'tk-cabinet'
    extracted.mkdir(exist_ok=True)
    database = wt.UINT()
    check(msi.MsiOpenDatabaseW(str(source), None, ct.byref(database)))
    try:
        directories = {name:(parent,default) for name,parent,default in query(database,'SELECT `Directory`, `Directory_Parent`, `DefaultDir` FROM `Directory`',3)}
        components = dict(query(database,'SELECT `Component`, `Directory_` FROM `Component`',2))
        files = query(database,'SELECT `File`, `Component_`, `FileName` FROM `File`',3)
        view = wt.UINT()
        check(msi.MsiDatabaseOpenViewW(database,"SELECT `Data` FROM `_Streams` WHERE `Name`='cab1.cab'",ct.byref(view)))
        try:
            check(msi.MsiViewExecute(view,0))
            record = wt.UINT()
            check(msi.MsiViewFetch(view,ct.byref(record)))
            try:
                with (cache/'tk.cab').open('wb') as output:
                    while True:
                        buffer = ct.create_string_buffer(65536)
                        size = wt.DWORD(len(buffer))
                        check(msi.MsiRecordReadStream(record,1,buffer,ct.byref(size)))
                        if not size.value:
                            break
                        output.write(buffer.raw[:size.value])
            finally:
                msi.MsiCloseHandle(record)
        finally:
            msi.MsiCloseHandle(view)
    finally:
        msi.MsiCloseHandle(database)
    subprocess.run([str(Path(os.environ['SystemRoot'])/'System32'/'expand.exe'),'-F:*',str(cache/'tk.cab'),str(extracted)],check=True,creationflags=subprocess.CREATE_NO_WINDOW,stdout=subprocess.DEVNULL)
    destination = ROOT/'runtime'/'python'
    def folder(name):
        parent, default = directories[name]
        part = default.split(':')[0].split('|')[-1]
        prefix = folder(parent) if parent else Path()
        return prefix if not parent or part in ('.','SourceDir') else prefix/part
    for key, component, filename in files:
        relative = folder(components[component])/filename.split('|')[-1]
        target = destination/relative
        if not target.resolve().is_relative_to(destination.resolve()):
            raise RuntimeError('Unexpected path in Tcl/Tk MSI')
        target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(extracted/key,target)
    print(f'Vendored {len(files)} Tcl/Tk files from the official MSI without installation.')


if __name__ == '__main__':
    main()
