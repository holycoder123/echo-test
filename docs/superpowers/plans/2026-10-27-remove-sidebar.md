# Remove Desktop Sidebar

The user requested removal of the target-adjacent sidebar. The main workbench remains the only UI for desktop recording, capture, case editing, Python conversion and execution.

- [x] Remove the sidebar BrowserWindow, automatic opening, tray entry, pairing lifecycle, renderer and document relay.
- [x] Remove sidebar settings and IPC permissions. Accept and discard legacy boolean autoToolbar/linkToolbar preferences when reading or importing older settings.
- [x] Open the desktop operation page inside the workbench from the current target card. Keep image/coordinate capture, recording, stop, editing and run controls accessible.
- [x] Preserve the existing main Python editor and inline control previews.
- [x] Replace sidebar UI tests with main-workbench entry/layout checks and native connection tests asserting no extra window and unchanged target geometry.
- [x] Fix action buttons remaining disabled after run completion; verify the failure before the fix and test recovery afterwards.
- [x] Update the user guide, built-in help, README, structure and testing documentation. Leave changes local and do not build an installer.

The prior expandable sidebar and capture-strip plans are superseded by this removal. Native low-level pairing code used by legacy recovery remains independent of the application UI; no workbench code creates or pairs a sidebar.

Verification: `npm run test:all` passed (133 Node and 370 Python tests); `npm run test:ui` passed, including main Python previews and desktop action recovery after execution. Native disposable target connection/reconnection created no extra window and preserved owner, style, size and position. The 1120 × 740 workbench screenshot was inspected. Whitespace check passed with Windows line endings. No installer build, commit or publication.
