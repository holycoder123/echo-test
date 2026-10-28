# Capture Strip Implementation Plan

> Superseded by [Remove Desktop Sidebar](2026-10-27-remove-sidebar.md) at the user’s request.

**Goal:** Keep one full editor in the workbench and a lightweight capture strip beside the target.

**Architecture:** The workbench owns all document changes. The strip consumes revisioned snapshots, appends a default click and offers a guarded undo. It never edits a second document. Low-code insertion defaults to after the selected step, with an explicit end option; Python insertion always appends to the end of the code. Capture temporarily enlarges the screenshot picker, then restores the strip bounds and pairing.

**Tech Stack:** Electron, vanilla JavaScript, existing Python backend and Monaco editor.

Approved in conversation: replace the duplicated sidebar editor with capture/record/stop, destination identity, insertion position, feedback/undo and an entry to the main editor. Keep Python conversion and image previews in the main editor. Do not package or publish.

- [x] Add controller tests for insertion at the end, guarded undo, Python append and opening the main editor. Run them red before implementing.
- [x] Add controller capture transactions and open-editor/undo commands. Keep target and document revision checks around asynchronous capture.
- [x] Replace the sidebar editor UI with a compact capture strip: current case, insertion option, record, two capture buttons, existing control insertion, last insertion feedback, undo and main editor entry. Remove the separate run target and embedded IDE.
- [x] Default the native window to compact recording geometry. Enlarge only the screenshot picker and restore on accept/cancel. Keep native geometry tests.
- [x] Update real two-window UI smoke coverage for capture/cancel/undo/stale revision/Python append, long names, small windows, record/run locks and workbench navigation. Preserve main editor preview tests.
- [x] Run automated and UI suites, inspect screenshots, fix visible issues, update the user guide. Leave changes local for acceptance.

Undo only removes the last insertion while its document revision remains current; saved shared controls remain available. Any subsequent workbench edit invalidates undo to prevent overwriting user work. Capture cancellation creates no control or step. Workbench navigation remains available during execution; capture and insertion are locked.


Verification completed:
- `npm run test:all`: 150 Node tests + 370 Python tests passed.
- `npm run test:ui`: complete isolated two-window suite passed, including main Python inline previews.
- Native disposable Win32 target: movement/pairing/detach/restore and closing the expanded picker then reopening compact all passed. No user application input was sent.
- UI screenshots inspected at 320 × 650 and 300 × 400; long names wrap/clamp, no horizontal overflow, screenshot selection preserves image aspect ratio, and recording/execution stop buttons remain visible at minimum size.
- Independent review found one picker-close lifecycle bug; fixed with a failing-then-passing regression and native reopen test.
- Whitespace diff check passed. No installer build, commit or publication performed.

Screenshots: `artifacts/smoke/capture-strip-lowcode.png`, `capture-strip-small.png`, `capture-picker-preview.png`.
