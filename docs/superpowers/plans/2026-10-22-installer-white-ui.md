# Installer White UI Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the independent native drawing task; integrate and verify in this session. Track work below.

**Goal:** Ship the approved white installer preview as a functioning native NSIS wizard.

**Architecture:** Keep installation and uninstallation in NSIS. Generate resource-only dialog templates with Python; a small C DLL handles chrome and owner-drawn controls. Build tools are private, version/hash pinned and never required on the installed machine.

**Tech Stack:** NSIS 3.13, TinyCC 0.9.27 (Win32 C), Win32/GDI, Python stdlib.

---

### Task 1: Build assets and native chrome

- [x] Add `tests/test_installer_ui.py`: expect generated main/progress dialogs to contain NSIS-required IDs, working button/navigation geometry and Segoe UI font; run before implementation to establish missing behavior.
- [x] Add `scripts/installer-ui/resources.py` to generate complete DLGTEMPLATEEX resources (IDs 105 and 106) and update copies of the verified NSIS modern UI executable using Windows resource APIs. Preserve other original dialog resources.
- [x] Add `scripts/installer-ui/native.c`: exports `EchoSetupAttach(HWND,LPCWSTR,LPCWSTR,int)` and `EchoSetupStep(int)` (cdecl). Paint white chrome, branded title, four steps, footer and owner-drawn buttons. Handle close/drag/keyboard/focus, scale with DPI. No installation actions in DLL.
- [x] Add `scripts/build-installer-ui.ps1`: acquire pinned TinyCC, verify SHA-256, compile x86 DLL, generate resource exe; outputs under `.runtime/installer-build/ui`.
- [x] Verify actual UI DLL exports and generated dialogs, and compile a small NSIS fixture before building the full payload.

### Task 2: Connect real wizard

- [x] Add `scripts/installer-ui/pages.nsh`: custom welcome/options/finish pages using nsDialogs. Install path validation must reject relative, drive/share roots and Windows system directories before extraction; back navigation retains path and checkbox values.
- [x] Modify `scripts/installer.nsi`: integrate generated UI; replace standard welcome/directory/components/finish with approved pages; keep native instfiles progress and all data-preservation checks. Add optional MCP shortcut. Completion launch is explicit user choice, disabled for /TESTINSTALL and silent mode.
- [x] Modify `scripts/build-installer.ps1`: prepare UI assets before compiling; avoid local NSIS long path failures using a temporary free drive mapping released in finally.
- [x] Verify real controls in an isolated native test process (no main installation or shortcut changes), including invalid directory rejection, back/persist, native close cancellation and log toggle.

### Task 3: Package and verify

- [x] Export a clean copy of tagged source into a fresh `.runtime` build, overlay only implementation files, copy verified local dependencies, and mark local build metadata. Exclude local user cases, controls and drafts.
- [x] Copy the compiled `dist/echo-test-1.1.0-setup-white-x64.exe` and write its SHA-256 file after final lifecycle verification, preserving original 1.1.0 output.
- [x] Run installer fixture install, upgrade, offline runtime check and uninstall, preserving test cases/controls/reports/recordings and removing only program files.
- [x] Run source tests appropriate to build scripts, inspect actual UI screenshots at the desktop's actual 100% DPI; document that 150% requires a separate desktop session, self-review and independent review.
- [x] Update `docs/installer.md`, check changed files, mark this plan complete and provide local artifact links. Do not publish or touch existing local user modifications.

## Verification evidence

- Final local installer: `dist/echo-test-1.1.0-setup-white-x64.exe` (257,845,295 bytes), SHA-256 `5d819d32745d81e75cae2a5dfc5494782a32eafa8e2e967d103da33a809bcf8b`.
- `artifacts/white-installer-ui.json`: actual 96-DPI navigation, options persistence, invalid-directory checks, queued Tab and cancellation passed.
- `artifacts/white-installer-flow.json`: fresh directory, real extraction, visible Finish, blocked test auto-launch, real uninstall and retained reports passed.
- `artifacts/white-installer-lifecycle.json`: silent install, upgrade, offline OCR/UI/MCP and preserved cases/controls/assets/reports/recordings passed. MCP smoke needed its canonical installation path because SUBST and fs.realpath spell the same directory differently; initial alias-only comparison timed out. The authenticated handshake and explicit-disable checks then passed with canonical invocation, followed by real uninstall.
- `artifacts/white-installer-payload-final.json`: all implementation hashes match packaged source, empty control library, no local cases or compiler cache.
- Python suite: 277 tests passed. Native resource contracts, ABI, paint/color forwarding, actual desktop screenshot and independent review passed. PowerShell parser and Python compilation checks passed. No claim of 150% DPI validation; that requires a matching desktop session.
- Original installer remains present. No publishing or version change performed.
