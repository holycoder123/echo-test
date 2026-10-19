"""Extract the tested portable payload and add installation-only support files."""
from pathlib import Path
import shutil
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    stage = ROOT/'.runtime'/'installer-build'/'payload'
    if stage.exists():
        if stage.resolve() != ROOT.resolve()/'.runtime'/'installer-build'/'payload':
            raise RuntimeError('Refusing redirected installer staging directory')
        shutil.rmtree(stage)
    stage.mkdir(parents=True)
    with zipfile.ZipFile(ROOT/'dist'/'nycs-test-studio-win-x64.zip') as archive:
        if not all((stage/name).resolve().is_relative_to(stage.resolve()) for name in archive.namelist()):
            raise RuntimeError('Unexpected path in portable archive')
        archive.extractall(stage)
    payload = stage/'nycs-test-studio'
    shutil.copy2(ROOT/'electron'/'assets'/'studio.ico',payload/'electron'/'assets'/'studio.ico')
    shutil.copy2(ROOT/'scripts'/'installer-guard.py',payload/'scripts'/'installer-guard.py')
    print(payload)


if __name__ == '__main__':
    main()
