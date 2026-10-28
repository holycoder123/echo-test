"""Build and validate a clean distribution without copying a developer workspace."""
import json
from pathlib import Path, PurePosixPath
import shutil

APPLICATION_DIRECTORIES = ('electron', 'echo_test', 'scripts', 'docs', 'runtime', 'node_modules', 'tests')
APPLICATION_FILES = (
    'app.py', 'README.md', 'package.json', 'package-lock.json',
    'requirements.txt', 'requirements-portable.lock',
    'start.cmd', 'start_admin.cmd', 'start_admin_mcp.cmd', 'start_no_mcp.cmd',
    'install_dependencies.cmd', 'build_portable.cmd', 'build_installer.cmd',
    'verify_portable.cmd', 'mcp_info.cmd',
)
LOCAL_DIRECTORIES = frozenset({
    '.runtime', 'artifacts', 'reports', 'recordings', 'logs', '.git', '.agents', '.codex',
    '__pycache__', '.drafts', '.cache', 'cache', 'code cache', 'gpucache', 'user data', 'userdata',
})
LOCAL_FILES = frozenset({
    '.workbench-state.json', '.workbench-close.json', '.embed-recovery.json',
    'workbench-state.json', 'workbench-close.json', 'embed-recovery.json',
    'mcp-connection.json', 'recent.json', 'case-library.json',
})
EMPTY_CONTROLS = {'schema_version': 1, 'categories': [], 'entries': [], 'imports': {}, 'deleted_ids': []}
WORKSPACE_SEEDS = {
    'test_cases/README.md': '# 测试用例\n\n此目录初始不包含用例。通过 EchoTest 新建或录制后保存到这里，图片模板保存在 assets 子目录。\n',
    'test_cases/assets/.gitkeep': '',
    'projects/README.md': '# 本地项目\n\n此目录初始为空。用例请在 EchoTest 中创建和保存；仓库不附带预置用例或控件。\n',
    'control_library/controls.json': json.dumps(EMPTY_CONTROLS, ensure_ascii=False, indent=2) + '\n',
}


def local_name(name):
    name = name.lower()
    return (name in LOCAL_DIRECTORIES or name in LOCAL_FILES or name == '.env'
            or name.startswith('.env.') or name.endswith(('.pyc', '.pyo', '.log', '.jsonl')))


def excluded(directory, names):
    return [name for name in names if local_name(name)]


def copy_payload(root, stage):
    root, stage = Path(root), Path(stage)
    for name in APPLICATION_DIRECTORIES:
        shutil.copytree(root/name, stage/name, ignore=excluded)
    for name in APPLICATION_FILES:
        shutil.copy2(root/name, stage/name)
    # Generate fresh workspace metadata; never read the user's cases or controls.
    for name, text in WORKSPACE_SEEDS.items():
        file = stage/name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(text, encoding='utf-8')
    assert_clean_payload(stage)


def validate_names(names):
    for name in names:
        parts = PurePosixPath(name).parts
        if not parts or PurePosixPath(name).is_absolute() or '..' in parts or '\\' in name:
            raise ValueError(f'Invalid distribution path: {name}')
        if any(local_name(part) for part in parts):
            raise ValueError(f'Local execution data in distribution: {name}')
        if parts[0] in {'test_cases', 'projects', 'control_library'} and name not in WORKSPACE_SEEDS:
            raise ValueError(f'User workspace data in distribution: {name}')


def assert_clean_payload(stage):
    stage = Path(stage)
    validate_names(file.relative_to(stage).as_posix() for file in stage.rglob('*') if file.is_file())
    for name, text in WORKSPACE_SEEDS.items():
        if (stage/name).read_text(encoding='utf-8') != text:
            raise ValueError(f'Workspace must start empty: {name}')


def assert_clean_archive(archive):
    names = archive.namelist()
    prefix = 'echo-test/'
    if not all(name.startswith(prefix) for name in names):
        raise ValueError('Unexpected distribution archive root')
    validate_names(name[len(prefix):] for name in names if not name.endswith('/'))
    for name, text in WORKSPACE_SEEDS.items():
        if archive.read(prefix+name).decode('utf-8').replace('\r\n', '\n') != text:
            raise ValueError(f'Workspace must start empty: {name}')
