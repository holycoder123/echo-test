# Window API and Python editor completion

**Goal:** Make `window` the primary Python automation API and offer function selection in every editable Python textarea.

**Architecture:** Keep the current isolated Python runtime and lazy control references. Inject `window` plus a compatible `game` alias. Generate and document `window` calls. Add a local completion catalog and textarea overlay, without a network service or new runtime dependency.

- [x] Backend tests first: primary window API, snippet globals, aliases and generated code; update runtime, generation and API documentation.
- [x] Editor tests first: detect `window.` and filtered prefixes outside Python strings/comments; offer all supported public methods with signatures and explanations; accept with Enter/Tab or click and preserve arguments; Escape dismisses; Ctrl+Space invokes; read-only/disabled editors never change.
- [x] Integrate across Python cases, inline steps and expanded script dialog. Keep normal Tab indentation and browser window methods unaffected. Close overlays when editors disappear, selection moves, scrolling or execution locks editing.
- [x] Update default snippets/help and add isolated UI smoke for all three editing surfaces. Run complete unit suites and UI smoke; inspect completion screenshot; review before completion.
