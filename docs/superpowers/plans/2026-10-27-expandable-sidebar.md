# Expandable Sidebar Implementation Plan

> Superseded by [Remove Desktop Sidebar](2026-10-27-remove-sidebar.md) at the user’s request.

> Superseded by [Capture Strip](2026-10-27-capture-strip.md): the main workbench is now the sole full editor.

User approved one window with a compact recording mode and a freely resizable editor, separate remembered geometry, hide/restore around capture, collapsible parameters/results. Remove the target-information block and bottom navigation/status shown in the screenshot.

- [x] Add failing tests for separate mode geometry, maximize restoration, screen recovery and serialized detach/resize/attach ordering.
- [x] Implement a restricted native mode route and a testable window-layout controller; persist geometry per mode in the app profile, respecting remember-bounds preferences.
- [x] Remove the requested chrome. Make the editor fill the larger window, put parameters into a collapsible inspector, and collapse execution results until opened or failed.
- [x] Update isolated Electron smoke tests for removed controls, native resizing, tab/caret/undo preservation and responsive layouts.
- [x] Run focused tests, full checks/UI verification, inspect screenshots and document the workflow. Preserve existing user controls and packaging work; do not build an installer.

## Verification — 2026-10-27

- `npm run test:all`: 149 Node and 370 Python tests passed (519 total).
- `npm run test:ui`: complete isolated UI suite passed; verified native mode sizes, independent geometry and maximize restoration, draft/caret/undo preservation, inspector, inline previews, collapsed results and removed chrome.
- Real Win32 geometry smoke passed against a disposable STATIC window: paired movement, independent editor movement, pairing restoration and unchanged target size/styles. Full native recording startup was not covered successfully because the current foreground restrictions prevented activating the disposable target; no input was sent to the user's application.
- An independent review found and verified the fix for pairing failure leaving the editor in a narrow window. Six native layout regression tests pass.
- Demo: `artifacts/smoke/sidebar-expanded-python.png`, `sidebar-editor-preview.png`, `sidebar-recording-preview.png`.
- No installer build or release; existing packaging changes, user controls and templates preserved.
