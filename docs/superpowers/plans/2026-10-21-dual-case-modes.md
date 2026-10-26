# Dual case modes implementation plan

**Goal:** Add low-code loops and variables, Python case editing with control parameters, generated-code preview, and independent Python copies.

**Architecture:** Keep the existing JSON steps and shared controls. Old cases default to `mode: "lowcode"`. Python cases store `code` and `script_timeout` and execute through the existing isolated worker. Low-code loops use paired `loop` / `end_loop` steps to retain existing step indices and recording compatibility. Both modes use the same backend input, cancellation, image recognition and reports.

**Tech stack:** Electron renderer JavaScript, Python dataclasses, unittest and Node test runner.

- [x] Backend: tests first for mode round-trip, inclusive ascending/descending loops, nested loops, variable interpolation, invalid structures and cancellation. Implement `variable`, `start`, `end`, `step` loop parameters and `set_variable` with `variable`, `value`. Limit nesting and expanded operations. Default absent variables fail clearly. Preserve legacy behavior.
- [x] Python worker: tests first for `controls[name]`, `controls.by_id(id)` as lazy references and custom-function arguments. Add code generation with proper literal escaping and operation parity, including delays/repeats/drag paths. Test generated scripts against original low-code calls. Python copies contain independent code and selectors, never overwrite source case files.
- [x] Renderer: add mode indicator, new Python case, loop groups and variable inputs. Add readonly code preview and Python copy action. Python editor has searchable shared controls and inserts stable references at cursor. All mutations lock while running; preserve dirty content and imports. Test mode actions and conversion independence.
- [x] Integrate service methods `generate_python` returning `{code}` and `python_copy` returning `{project}`. Resolve latest controls before conversion; preserve project file paths for low-code editing and reset file identity for copies.
- [x] Update MCP schemas, run progress for loops and Python cases, and saved-case control references.
- [x] Run targeted tests, `npm run test:all`, and isolated `npm run test:ui`. Add a dual-mode smoke test without real application input, inspect screenshots, fix failures and document usage.

Approved scope follows the user's acceptance of the dual-mode recommendation. Work is on `codex/dual-case-modes`; existing uncommitted control-picker changes are preserved. No publishing is requested.
