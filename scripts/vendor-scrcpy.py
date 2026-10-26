"""Bundle the pinned Apache-2.0 scrcpy server for in-workbench H.264 preview."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import zipfile

ROOT=Path(__file__).resolve().parents[1]
VERSION='3.3.4'
ASSETS={
    'scrcpy-server.jar':('scrcpy-server-v3.3.4','https://github.com/Genymobile/scrcpy/releases/download/v3.3.4/scrcpy-server-v3.3.4','8588238c9a5a00aa542906b6ec7e6d5541d9ffb9b5d0f6e1bc0e365e2303079e'),
    'LICENSE':('LICENSE','https://raw.githubusercontent.com/Genymobile/scrcpy/v3.3.4/LICENSE','5e6597827749877cca06765747bf29ed9205ed5021c6aec1ad42373711bcda05'),
}


def verify(root=ROOT):
    directory=Path(root)/'runtime/android/scrcpy'
    for name,(_,_,digest) in ASSETS.items():
        if hashlib.sha256((directory/name).read_bytes()).hexdigest()!=digest:
            raise ValueError('Bundled scrcpy checksum mismatch: '+name)
    with zipfile.ZipFile(directory/'scrcpy-server.jar') as archive:
        if 'classes.dex' not in archive.namelist():
            raise ValueError('Invalid scrcpy server')
    return {'passed':True,'version':VERSION,'server_sha256':ASSETS['scrcpy-server.jar'][2]}


def vendor(root=ROOT):
    root=Path(root).resolve();directory=root/'runtime/android/scrcpy';cache=root/'.runtime/scrcpy-build'
    if directory.resolve()!=directory or cache.resolve()!=cache:
        raise ValueError('Refusing redirected scrcpy runtime directory')
    cache.mkdir(parents=True,exist_ok=True)
    contents={}
    for name,(cached,url,digest) in ASSETS.items():
        file=cache/cached
        if file.exists():
            data=file.read_bytes()
        else:
            with urllib.request.urlopen(url,timeout=60) as response:data=response.read(4*1024*1024)
        if hashlib.sha256(data).hexdigest()!=digest:
            raise ValueError('scrcpy download checksum mismatch: '+name)
        if not file.exists():file.write_bytes(data)
        contents[name]=data
    directory.mkdir(parents=True,exist_ok=True)
    for name,data in contents.items():
        destination=directory/name
        if destination.is_symlink():raise ValueError('Refusing redirected scrcpy runtime file')
        destination.write_bytes(data)
    manifest={'version':VERSION,'files':{name:{'source_url':url,'sha256':digest} for name,(_,url,digest) in ASSETS.items()}}
    (directory/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    main=root/'runtime/manifest.json'
    if main.exists():
        data=json.loads(main.read_text(encoding='utf-8'));data['android_video']=manifest
        main.write_text(json.dumps(data,indent=2,ensure_ascii=False),encoding='utf-8')
    return verify(root)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--verify-only',action='store_true');args=parser.parse_args()
    print(json.dumps(verify() if args.verify_only else vendor()))
