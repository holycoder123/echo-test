"""Record exact versions and licenses of the vendored runtime."""
import argparse
import hashlib
from importlib import metadata
import json
from pathlib import Path
import platform
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    for field in ['python-version', 'python-sha256', 'node-version', 'node-sha256']:
        parser.add_argument('--' + field, required=True)
    args = parser.parse_args()
    distributions = sorted(metadata.distributions(), key=lambda row: row.metadata['Name'].lower())
    packages = [{'name': row.metadata['Name'], 'version': row.version,
                 'license': row.metadata.get('License-Expression') or row.metadata.get('License', ''),
                 'location': str(Path(row.locate_file('')).relative_to(ROOT))} for row in distributions]
    manifest = {'platform': 'windows-x64', 'python': args.python_version,
                'python_archive_sha256': args.python_sha256, 'node': args.node_version,
                'node_archive_sha256': args.node_sha256,
                'electron': json.loads((ROOT/'package.json').read_text())['devDependencies']['electron'],
                'packages': packages,
                'requirements_sha256': hashlib.sha256((ROOT/'requirements.txt').read_bytes()).hexdigest(),
                'notes': 'Runtime libraries and models are vendored. Their distribution licenses remain in package directories.'}
    (ROOT/'runtime'/'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    (ROOT/'runtime'/'requirements.lock').write_text('\n'.join(row['name']+'=='+row['version'] for row in packages)+'\n', encoding='utf-8')
    (ROOT/'requirements-portable.lock').write_text('\n'.join(row['name']+'=='+row['version'] for row in packages)+'\n', encoding='utf-8')
    redist = ROOT/'runtime'/'redist'/'vc_redist.x64.exe'
    if redist.exists():
        manifest['vc_redist_sha256'] = hashlib.sha256(redist.read_bytes()).hexdigest()
        (ROOT/'runtime'/'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    tk = ROOT/'.runtime'/'portable-build'/'tcltk.msi'
    if tk.exists():
        manifest['tcltk_msi_sha256'] = hashlib.sha256(tk.read_bytes()).hexdigest()
        (ROOT/'runtime'/'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'python': platform.python_version(), 'packages': len(packages), 'executable': sys.executable}))


if __name__ == '__main__':
    main()
