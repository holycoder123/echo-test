# Sidebar Case Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Edit the current case next to its target, capture controls into click steps, convert to Python, and preview referenced controls inside editable Python.

**Architecture:** Keep the main renderer as the single document owner. A bounded IPC request/reply session carries versioned snapshots and allowed commands to the existing toolbar window. The toolbar adds an editor pane and the same Monaco component; static Python references are resolved without execution and rendered as view zones.

**Tech Stack:** Electron IPC, plain JavaScript/HTML/CSS, Monaco/Pyright, Python AST, Node tests, unittest and isolated Electron smoke fixtures.

## Task 1: Document session and command controller

Files: create `electron/sidebar-session.cjs`, `electron/renderer/sidebar-controller.js`, `electron/tests/sidebar-session.test.cjs`; modify `electron/main.cjs`, `electron/window-access.cjs`, `electron/renderer/app.js`, `electron/renderer/index.html`, `electron/tests/window-access.test.cjs`.

- [ ] Write failing tests for authenticated request/reply, timeout, close cancellation, bounded payloads and stale document revisions. Contract: `snapshot={revision,project,selected,path,dirty,controls,iterations,canReturnSource}`; `command={revision,action,...}`.
- [ ] Run `node --test electron/tests/sidebar-session.test.cjs`, observe missing session behavior.
- [ ] Add a serial session with `publish`, `request`, `reply`, `close`; permit only the toolbar to request and the main renderer to publish/reply. Reject unknown command names in the controller.
- [ ] Publish on document changes/render; support step selection/name/action/target/parameters/enable/delay/timeout/repeat, move/delete/add, name, save/save-as, code, Python copy/source and control insertion. Reuse `createPythonCopy`, `save`, `useControl`, `addStep` and control-bank storage.
- [ ] Run session and window-access tests; verify existing role restrictions remain.

## Task 2: Side editor and capture integration

Files: create `electron/renderer/sidebar-editor.js`, `electron/renderer/sidebar-editor.css`, `electron/tests/smoke/sidebar-editor-smoke.cjs`; modify `electron/renderer/game.html`, `electron/renderer/game.js`, `electron/main.cjs`, `electron/toolbar-layout.cjs` if geometry needs adaptation.

- [ ] Add a failing UI fixture checking the new editor, shared state, capture cancellation, default click, Python cursor insertion, save, stale revision protection and locked inputs.
- [ ] Add an expandable scrolling editor inside the toolbar while retaining existing button IDs and window-pairing behavior. Keep a Python compatibility state for the existing Monaco module.
- [ ] Add a restricted screenshot/thumbnail route; hide both surfaces during capture, revalidate the target before accepting a selection, restore on success/error. Save controls through the main owner command.
- [ ] Serialize sidebar edits. Preserve focused fields and pending code; show stale-edit errors without discarding the local text. Flush pending code before save, convert or run.
- [ ] Run `npm run test:ui`; save `sidebar-editor-preview.png` with demo data only. Check narrow and short toolbar layouts.

## Task 3: Inline Python control previews

Files: create `echo_test/python_control_references.py`, `tests/test_python_control_references.py`; modify `echo_test/service.py`, `electron/renderer/python-ide-entry.js`, `electron/renderer/python-ide.css`, `electron/tests/smoke/python-ide-smoke.cjs`. Main owner integrates IPC method authorization.

- [ ] Write failing parser tests for literal IDs/names, aliases, reassignment, shadowing, strings/comments, incomplete syntax, dynamic references and bounded source sizes.
- [ ] Run `node scripts/python.cjs -m unittest discover -s tests -p test_python_control_references.py -v` and observe the missing feature.
- [ ] Parse with AST only. Return bounded `{line,kind,value}` references; never evaluate user code. Register `editor_control_refs` in the backend.
- [ ] Add a per-editor “控件预览” button. Version async requests; resolve current shared controls, load images through `template_preview`, display safe DOM view zones and a large-image preview. Clear zones/listeners on disposal; do not change model or dirty state.
- [ ] Add real Monaco smoke assertions that toggling and refreshing previews preserves source, undo history, caret, normal typing and readonly locks. Cover stale async replies and failed/missing controls.

## Task 4: Integration, review and verification

Files: update `scripts/smoke-ui.cjs`, `electron/main.cjs` smoke registration, `package.json` check command, `docs/python-scripts.md`, `docs/user-guide.md`.

- [ ] Run the complete `npm run test:all` and `npm run test:ui` after integration. Fix actual failures and re-run only affected checks before final full verification.
- [ ] Review specification coverage and have a reviewer inspect both compliance and correctness, especially IPC, capture identity and uncommitted-code preservation.
- [ ] Document the new workflows and static-analysis limits. Record verification and demo screenshots. Preserve existing installer work and `control_library/controls.json`; do not compile or publish an installer in this task.
