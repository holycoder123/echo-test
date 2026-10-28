# Sidebar Case Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Edit the current case next to its target, capture controls into click steps, convert to Python, and preview referenced controls inside editable Python.

**Architecture:** Keep the main renderer as the single document owner. A bounded IPC request/reply session carries versioned snapshots and allowed commands to the existing toolbar window. The toolbar adds an editor pane and the same Monaco component; static Python references are resolved without execution and rendered as view zones.

**Tech Stack:** Electron IPC, plain JavaScript/HTML/CSS, Monaco/Pyright, Python AST, Node tests, unittest and isolated Electron smoke fixtures.

## Task 1: Document session and command controller

Files: create `electron/sidebar-session.cjs`, `electron/renderer/sidebar-controller.js`, `electron/tests/sidebar-session.test.cjs`; modify `electron/main.cjs`, `electron/window-access.cjs`, `electron/renderer/app.js`, `electron/renderer/index.html`, `electron/tests/window-access.test.cjs`.

- [x] Write failing tests for authenticated request/reply, timeout, close cancellation, bounded payloads and stale document revisions. Contract: `snapshot={revision,project,selected,path,dirty,controls,iterations,canReturnSource}`; `command={revision,action,...}`.
- [x] Run `node --test electron/tests/sidebar-session.test.cjs`, observe missing session behavior.
- [x] Add a serial session with `publish`, `request`, `reply`, `close`; permit only the toolbar to request and the main renderer to publish/reply. Reject unknown command names in the controller.
- [x] Publish on document changes/render; support step selection/name/action/target/parameters/enable/delay/timeout/repeat, move/delete/add, name, save/save-as, code, Python copy/source and control insertion. Reuse `createPythonCopy`, `save`, `useControl`, `addStep` and control-bank storage.
- [x] Run session and window-access tests; verify existing role restrictions remain.

## Task 2: Side editor and capture integration

Files: create `electron/renderer/sidebar-editor.js`, `electron/renderer/sidebar-editor.css`, `electron/tests/smoke/sidebar-editor-smoke.cjs`; modify `electron/renderer/game.html`, `electron/renderer/game.js`, `electron/main.cjs`, `electron/toolbar-layout.cjs` if geometry needs adaptation.

- [x] Add a failing UI fixture checking the new editor, shared state, capture cancellation, default click, Python cursor insertion, save, stale revision protection and locked inputs.
- [x] Add an expandable scrolling editor inside the toolbar while retaining existing button IDs and window-pairing behavior. Keep a Python compatibility state for the existing Monaco module.
- [x] Add a restricted screenshot/thumbnail route; hide both surfaces during capture, revalidate the target before accepting a selection, restore on success/error. Save controls through the main owner command.
- [x] Serialize sidebar edits. Preserve focused fields and pending code; show stale-edit errors without discarding the local text. Flush pending code before save, convert or run.
- [x] Run `npm run test:ui`; save `sidebar-editor-preview.png` with demo data only. Check narrow and short toolbar layouts.

## Task 3: Inline Python control previews

Files: create `echo_test/python_control_references.py`, `tests/test_python_control_references.py`; modify `echo_test/service.py`, `electron/renderer/python-ide-entry.js`, `electron/renderer/python-ide.css`, `electron/tests/smoke/python-ide-smoke.cjs`. Main owner integrates IPC method authorization.

- [x] Write failing parser tests for literal IDs/names, aliases, reassignment, shadowing, strings/comments, incomplete syntax, dynamic references and bounded source sizes.
- [x] Run `node scripts/python.cjs -m unittest discover -s tests -p test_python_control_references.py -v` and observe the missing feature.
- [x] Parse with AST only. Return bounded `{line,kind,value}` references; never evaluate user code. Register `editor_control_refs` in the backend.
- [x] Add a per-editor “控件预览” button. Version async requests; resolve current shared controls, load images through `template_preview`, display safe DOM view zones and a large-image preview. Clear zones/listeners on disposal; do not change model or dirty state.
- [x] Add real Monaco smoke assertions that toggling and refreshing previews preserves source, undo history, caret, normal typing and readonly locks. Cover stale async replies and failed/missing controls.

## Task 4: Integration, review and verification

Files: update `scripts/smoke-ui.cjs`, `electron/main.cjs` smoke registration, `package.json` check command, `docs/python-scripts.md`, `docs/user-guide.md`.

- [x] Run the complete `npm run test:all` and `npm run test:ui` after integration. Fix actual failures and re-run only affected checks before final full verification.
- [x] Review specification coverage and have a reviewer inspect both compliance and correctness, especially IPC, capture identity and uncommitted-code preservation.
- [x] Document the new workflows and static-analysis limits. Record verification and demo screenshots. Preserve existing installer work and `control_library/controls.json`; do not compile or publish an installer in this task.

## Verification record — 2026-10-27

- `npm run test:all`: syntax checks, 143 Node tests and 367 Python tests passed (510 total).
- `npm run test:ui`: the complete isolated Electron UI suite passed, including actual Monaco preview toggles, historical control names, image success/failure, enlarged preview, undo and lifecycle checks.
- Final focused two-window UI checks also passed after the structural-field refresh and folding changes: image and coordinate capture add clicks, cancellation changes nothing, Python caret insertion, independent copy/source restoration, save, stale edits preserve drafts, running locks and 300 × 600 layout.
- Independent reviews of the preview parser/editor and sidebar session/editor completed; identified field-selection, newer-draft, save-shortcut and structural-refresh issues were fixed and regression checked.
- Demo captures: `artifacts/smoke/sidebar-editor-preview.png`, `sidebar-editor-narrow.png`, `python-ide-preview.png`. UI fixtures use isolated profiles and in-memory targets; no input was sent to the user's application or Android device.
- Existing installer changes and personal `control_library/controls.json` were preserved. No installer was compiled or version published for this feature.

Parameter-position preview refinement: 143 Node + 370 Python tests (513 total), complete Electron UI smoke, same-line multiple images, Unicode ranges, source expansion, image enlargement and sidebar preview all passed. Demo: `artifacts/smoke/python-inline-control-preview.png`. No installer build.
