"""Extract the tested portable payload and add installation-only support files."""
from pathlib import Path
import json
import shutil
import zipfile
from importlib.util import module_from_spec, spec_from_file_location
from scripts.release_payload import assert_clean_archive, assert_clean_payload

ROOT = Path(__file__).resolve().parents[1]


def main():
    stage = ROOT/'.runtime'/'installer-build'/'payload'
    if stage.exists():
        if stage.resolve() != ROOT.resolve()/'.runtime'/'installer-build'/'payload':
            raise RuntimeError('Refusing redirected installer staging directory')
        shutil.rmtree(stage)
    stage.mkdir(parents=True)
    version = json.loads((ROOT/'package.json').read_text(encoding='utf-8'))['version']
    with zipfile.ZipFile(ROOT/'dist'/'latest'/f'echo-test-{version}-portable-x64.zip') as archive:
        assert_clean_archive(archive)
        if not all((stage/name).resolve().is_relative_to(stage.resolve()) for name in archive.namelist()):
            raise RuntimeError('Unexpected path in portable archive')
        archive.extractall(stage)
    payload = stage/'echo-test'
    shutil.copy2(ROOT/'electron'/'assets'/'studio.ico',payload/'electron'/'assets'/'studio.ico')
    shutil.copy2(ROOT/'scripts'/'installer-guard.py',payload/'scripts'/'installer-guard.py')
    assert_clean_payload(payload)
    spec = spec_from_file_location('installer_environment', ROOT/'scripts/installer-environment.py')
    environment = module_from_spec(spec)
    spec.loader.exec_module(environment)
    environment.prepare(payload, stage.parent)
    print(payload)


if __name__ == '__main__':
    main()
