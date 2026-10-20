from pathlib import Path
import argparse
import sys


class StartupPermissionError(RuntimeError):
    """An elevation failure, not a dependency installation failure."""


def main():
    parser = argparse.ArgumentParser(description="EchoTest 桌面自动化测试工作台")
    parser.add_argument("--case", type=Path, help="打开指定 JSON 用例")
    parser.add_argument("--run", action="store_true", help="命令行执行，需明确指定 --case 和 --window")
    parser.add_argument("--window", type=int, help="目标目标窗口句柄")
    parser.add_argument("--list-windows", action="store_true", help="列出当前可用应用窗口")
    parser.add_argument("--iterations", type=int, default=1)
    permission = parser.add_mutually_exclusive_group()
    permission.add_argument("--admin", dest="admin", action="store_true", help="请求管理员权限启动桌面工作台（默认）")
    permission.add_argument("--no-admin", dest="admin", action="store_false", help="本次启动不主动请求管理员权限")
    mcp_mode = parser.add_mutually_exclusive_group()
    mcp_mode.add_argument("--mcp", dest="mcp", action="store_true", help="启用本机 MCP 接口（默认启用）")
    mcp_mode.add_argument("--no-mcp", dest="mcp", action="store_false", help="本次启动关闭 MCP 接口")
    parser.set_defaults(mcp=None, admin=None)
    args = parser.parse_args()
    from echo_test.backend import list_game_windows, WindowsBackend, is_admin
    if args.list_windows:
        import json
        from dataclasses import asdict
        print(json.dumps([asdict(w) for w in list_game_windows()], ensure_ascii=False, indent=2))
        return 0
    if args.run:
        if args.case is None or args.window is None:
            parser.error("命令行执行必须指定 --case 和 --window")
        from echo_test.models import load_project
        from echo_test.engine import Runner
        windows = [w for w in list_game_windows() if w.handle == args.window]
        if len(windows) != 1:
            parser.error("指定窗口不在当前可用窗口列表中")
        case = args.case.resolve()
        from echo_test.control_library import ControlLibrary
        library = ControlLibrary(Path(__file__).resolve().parent)
        project = library.import_project(load_project(case), case.parent, case)
        runner = Runner(WindowsBackend(windows[0]), library.resolve_project(project, case.parent), case.parent,
                        Path(__file__).parent / "reports", lambda event: print(event, flush=True))
        result = runner.run(args.iterations)
        return 0 if result["status"] == "passed" else 1
    from echo_test.startup_preferences import startup_preferences
    preferences = startup_preferences()
    explicit_admin = args.admin is True
    explicit_mcp = args.mcp is True
    explicit_no_mcp = args.mcp is False
    if args.admin is None: args.admin = preferences['admin']
    if args.mcp is None: args.mcp = preferences['mcp']
    import subprocess
    root = Path(__file__).resolve().parent
    if args.mcp:
        from echo_test.mcp_startup import check_mcp_startup, wait_for_mcp
        existing = check_mcp_startup(root)
        if existing["already_enabled"]:
            if args.admin:
                from echo_test.backend import elevation
                if elevation(existing["pid"]) is not True:
                    from echo_test.mcp_startup import McpStartupError
                    raise McpStartupError("已有工作台启用了 MCP，但未确认具有管理员权限。请先保存用例并正常关闭主窗口，再使用管理员启动入口。")
            print("现有工作台 MCP 已启用，可以继续连接。", flush=True)
            return 0
    electron = root / "node_modules" / "electron" / "dist" / "electron.exe"
    if not electron.exists():
        raise RuntimeError("请先运行 install_dependencies.cmd 安装桌面应用依赖")
    command = [str(electron), str(root)]
    if args.mcp:
        command.append("--enable-mcp")
        if explicit_mcp: command.append("--force-mcp")
    elif explicit_no_mcp:
        command.append("--disable-mcp")
    if explicit_admin:
        command.append('--force-admin')
    if not args.admin:
        command.append("--no-admin")
    if args.case:
        command.extend(["--case", str(args.case.resolve())])
    if args.admin and not is_admin():
        import ctypes
        from ctypes import wintypes
        launch=ctypes.windll.shell32.ShellExecuteW
        launch.argtypes=[wintypes.HWND,wintypes.LPCWSTR,wintypes.LPCWSTR,wintypes.LPCWSTR,wintypes.LPCWSTR,ctypes.c_int]
        launch.restype=ctypes.c_ssize_t
        status=launch(None,"runas",str(electron),subprocess.list2cmdline(command[1:]),str(root),1)
        if status<=32:
            raise StartupPermissionError("管理员启动未完成，可能已取消 Windows 权限确认。工作台未启动。")
    else:
        subprocess.Popen(command, cwd=root)
    if args.mcp:
        wait_for_mcp(root)
        print("工作台 MCP 已启用，可以连接 Codex。", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        import traceback
        traceback.print_exc()
        if not sys.stdout or not sys.stdout.isatty():
            import ctypes
            from echo_test.mcp_startup import McpStartupError
            detail = str(error) if isinstance(error, (McpStartupError, StartupPermissionError)) else str(error) + "\n请先运行 install_dependencies.cmd"
            ctypes.windll.user32.MessageBoxW(None, detail, "EchoTest启动失败", 0x10)
        raise SystemExit(1)
