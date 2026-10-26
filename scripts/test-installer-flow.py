"""Verify the real four-page installer, then silently uninstall its isolated fixture.

Windows only. Requires the sibling test-installer-ui.py Win32 helpers. The target
must be fresh and below this project's .runtime/installer-build directory.
"""

import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import time
import traceback


PROJECT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "installer_ui_qa", PROJECT / "scripts" / "test-installer-ui.py")
qa = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(qa)


class FlowInstaller(qa.Installer):
    def __init__(self, installer, target):
        startup = subprocess.STARTUPINFO()
        startup.dwFlags = subprocess.STARTF_USESHOWWINDOW
        startup.wShowWindow = 0
        # /D= must remain last and unquoted, including paths containing spaces.
        command = subprocess.list2cmdline([str(installer)])
        command += " /TESTINSTALL /NOSHORTCUTS /D=" + str(target)
        self.process = subprocess.Popen(command, startupinfo=startup, cwd=PROJECT)
        self.pids = {self.process.pid}
        self.handles = {}
        self.root = None


def uninstall(target):
    uninstaller = target / "Uninstall.exe"
    if not uninstaller.is_file():
        raise AssertionError("Fixture uninstaller is missing")
    env = os.environ.copy()
    env["ECHO_INSTALLER_FLOW_UNINSTALLER"] = str(uninstaller)
    powershell = (Path(env.get("SystemRoot", r"C:\Windows")) / "System32"
                  / "WindowsPowerShell" / "v1.0" / "powershell.exe")
    command = (
        "$ErrorActionPreference='Stop'; "
        "$flow=Start-Process -FilePath $env:ECHO_INSTALLER_FLOW_UNINSTALLER "
        "-ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru; exit $flow.ExitCode"
    )
    result = subprocess.run(
        [str(powershell), "-NoProfile", "-NonInteractive", "-Command", command],
        env=env, cwd=PROJECT, creationflags=subprocess.CREATE_NO_WINDOW, timeout=180,
        capture_output=True, text=True, errors="replace")
    if result.returncode:
        raise AssertionError("Silent fixture uninstall failed (%s): %s" % (
            result.returncode, result.stderr.strip()))
    qa.wait_for(lambda: not (target / "runtime" / "python" / "python.exe").exists(),
                "fixture program removed", timeout=15)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("installer", type=Path)
    parser.add_argument("--target", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path, help="JSON report path")
    args = parser.parse_args()
    installer = args.installer.resolve()
    # Preserve a supplied SUBST drive spelling for NSIS's MAX_PATH-sensitive files.
    target = args.target.absolute()
    resolved_target = target.resolve()
    report_path = args.report.resolve()
    allowed = (PROJECT / ".runtime" / "installer-build").resolve()
    if not resolved_target.is_relative_to(allowed) or resolved_target == allowed:
        parser.error("--target must be a fresh child of .runtime/installer-build")
    if target.exists():
        parser.error("--target already exists; preserve it and use a fresh directory")
    if report_path.is_relative_to(resolved_target):
        parser.error("--report must be outside the installation target")
    if not installer.is_file() or installer.suffix.lower() != ".exe":
        parser.error("installer must be an existing .exe")
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report = {"passed": False, "installer": str(installer), "target": str(target),
              "resolvedTarget": str(resolved_target), "checks": {}, "screenshots": {},
              "captureNote": "Offscreen PrintWindow captures can omit native Static text."}
    before_registry = qa.registry_state()
    wizard = None
    uninstalled = False

    def screenshot(root, label):
        try:
            path = report_path.with_name(report_path.stem + "-" + label + ".png")
            report["screenshots"][label] = qa.capture(root, path)
        except Exception as error:
            report.setdefault("captureErrors", {})[label] = str(error)

    try:
        assert before_registry["EchoTest-InstallerTest"] is None, (
            "Existing installer-test registration must be preserved; uninstall it first")
        if hasattr(qa.U, "SetProcessDpiAwarenessContext"):
            qa.bind(qa.U, "SetProcessDpiAwarenessContext", qa.W.BOOL, qa.W.HANDLE)(
                qa.C.c_void_p(-4))
        wizard = FlowInstaller(installer, target)
        root = qa.wait_for(wizard.locate, "installer welcome", timeout=30)
        dpi = (qa.bind(qa.U, "GetDpiForWindow", qa.W.UINT, qa.W.HWND)(root)
               if hasattr(qa.U, "GetDpiForWindow") else 96)
        scaled = lambda value: (value * dpi + 48) // 96
        qa.wait_for(lambda: qa.find_text(root, "欢迎使用 EchoTest"), "welcome heading")
        report["checks"]["welcomeDisplayed"] = True
        screenshot(root, "welcome")
        qa.click(wizard.button(1))
        qa.wait_for(lambda: qa.find_text(root, "准备好你的工作台"), "options heading")
        edits = [item["hwnd"] for item in qa.controls(root) if item["class"] == "Edit"]
        assert len(edits) == 1, "Expected one installation directory edit"
        assert Path(qa.window_text(edits[0])).resolve() == resolved_target, (
            "Wizard did not use the isolated /D= target")
        assert not qa.find_text(root, "创建 MCP 启动快捷方式", "Button"), "Removed MCP shortcut option is still visible"
        report["checks"]["mcpShortcutOptionAbsent"] = True
        for label in ("创建桌面快捷方式",):
            checkbox = qa.find_text(root, label, "Button")
            assert checkbox and not qa.U.IsWindowEnabled(checkbox), (
                "/NOSHORTCUTS must disable " + label)
            assert qa.send(checkbox, 0x00F0) == 0, "/NOSHORTCUTS checkbox must be unchecked"
        report["checks"]["shortcutsDisabled"] = True
        screenshot(root, "options")
        qa.click(wizard.button(1))
        deadline = time.monotonic() + 240
        progress_observed = False
        while time.monotonic() < deadline:
            wizard.windows()
            if wizard.exited() or not qa.U.IsWindow(root):
                raise AssertionError("Installer exited unexpectedly before the finish page")
            current = qa.controls(root)
            assert not any("请输入有效的安装文件夹。" in item["text"] for item in current), (
                "Valid fresh installation directory was rejected")
            progress = next((item for item in current
                             if item["class"] == "msctls_progress32"), None)
            if progress:
                if not progress_observed:
                    page = qa.U.GetParent(progress["hwnd"])
                    percentage = qa.U.GetDlgItem(page, 3305)
                    toggle = qa.U.GetDlgItem(page, 3310)
                    assert percentage and toggle, "Preview percentage or detail toggle is missing"
                    assert qa.window_text(percentage).endswith("%"), "Real percentage is missing"
                    for identity in (1006, 1016, 1027):
                        assert not qa.U.IsWindowVisible(qa.U.GetDlgItem(page, identity)), (
                            "Native details must initially be collapsed")
                    report["checks"]["percentageAndCollapsedDetails"] = True
                    screenshot(root, "progress")
                    qa.click(toggle)
                    qa.wait_for(lambda: qa.client_size(root) == (scaled(736), scaled(720)), "expanded detail layout")
                    report["checks"]["detailDisclosureExpandsWindow"] = True
                    screenshot(root, "details")
                progress_observed = True
                report["lastProgressPosition"] = qa.send(progress["hwnd"], 0x0408)
            if any("一切就绪，开始测试" in item["text"] for item in current):
                break
            time.sleep(0.1)
        else:
            raise AssertionError("Installer did not reach finish within 240 seconds")
        assert progress_observed, "Real extraction progress control was never observed"
        report["checks"]["realExtractionProgress"] = True
        report["checks"]["freshDirectoryAccepted"] = True
        launch = qa.find_text(root, "完成后启动 EchoTest", "Button")
        assert launch and not qa.U.IsWindowEnabled(launch), "TESTINSTALL launch checkbox enabled"
        assert qa.send(launch, 0x00F0) == 0, "TESTINSTALL launch checkbox checked"
        finish = wizard.button(1)
        assert finish and qa.U.IsWindowVisible(finish), "Finish button is hidden"
        assert qa.U.IsWindowEnabled(finish), "Finish button is disabled"
        assert qa.client_size(root) == (scaled(736), scaled(600)), "Finish did not restore the compact window"
        report["finishControls"] = qa.control_diagnostics(root)
        finish_page = next(item for item in report["finishControls"]
                           if item["class"] == "#32770")
        assert finish_page["boundsInClient"] == [0, scaled(132), scaled(736), scaled(396)], (
            "Expanded progress leaked into the Finish layout")
        report["checks"]["finishAfterExpandedDetailsRestoresLayout"] = True
        report["checks"]["finishVisibleEnabledAndLaunchBlocked"] = True
        screenshot(root, "finish")
        qa.click(finish)
        qa.wait_for(wizard.exited, "Finish closes installer", timeout=15)
        assert (target / "runtime" / "python" / "python.exe").is_file(), (
            "Interactive installation did not extract the Python runtime")
        report["checks"]["interactiveInstallAndFinish"] = True
        installed_registry = qa.registry_state()
        assert installed_registry["EchoTest"] == before_registry["EchoTest"], (
            "TESTINSTALL modified production uninstall registration")
        assert installed_registry["EchoTest-InstallerTest"] is not None, (
            "Interactive installation did not create isolated test registration")
        report["checks"]["isolatedTestRegistration"] = True
        marker = target / "reports" / "installer-flow-preservation.txt"
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker_text = "Preserve this installer UI regression evidence.\n"
        marker.write_text(marker_text, encoding="utf-8")
        uninstall(target)
        uninstalled = True
        assert not (target / "node_modules" / "electron" / "dist" / "electron.exe").exists(), (
            "Uninstall left the Electron program behind")
        assert marker.read_text("utf-8") == marker_text, "Uninstall removed user reports"
        assert qa.registry_state() == before_registry, "Uninstall did not restore registry state"
        report["checks"]["uninstallRemovesProgramPreservesUserData"] = True
        report["checks"]["uninstallRegistryUnchanged"] = True
        report["passed"] = True
    except Exception as error:
        report["error"] = str(error)
        report["traceback"] = traceback.format_exc()
        if wizard and wizard.root and qa.U.IsWindow(wizard.root):
            try:
                report["failureControls"] = qa.control_diagnostics(wizard.root)
            except Exception as diagnostics_error:
                report["diagnosticsError"] = str(diagnostics_error)
            screenshot(wizard.root, "failure")
    finally:
        if wizard:
            try:
                wizard.close()
            except Exception as close_error:
                report["passed"] = False
                report["closeError"] = str(close_error)
        if not uninstalled and (target / "Uninstall.exe").is_file():
            try:
                uninstall(target)
                report["failureCleanupUninstalled"] = True
            except Exception as cleanup_error:
                report["failureCleanupError"] = str(cleanup_error)
        report["checks"]["finalRegistryUnchanged"] = qa.registry_state() == before_registry
        if not report["checks"]["finalRegistryUnchanged"]:
            report["passed"] = False
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), "utf-8")
    print(json.dumps({"passed": report["passed"], "report": str(report_path),
                      "error": report.get("error")}, ensure_ascii=False))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
