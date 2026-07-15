# Multi-Panel DropComp — Design

**Date:** 2026-07-15
**Status:** Approved by Ziscol (brainstorming session)
**Target version:** 2.9.0

## Problem

DropComp is a single CEP panel with four tabs (Library, Assets, Tools, Scripts).
Real work needs two sections at once — e.g. while using Tools, importing a comp
means switching to Library, searching, importing, and switching back. Tab
switching is the friction.

## Requirements (from brainstorming)

- All four sections available as **independent, dockable AE panels**.
- The existing all-in-one tabbed panel **stays unchanged** (five menu entries total).
- **Live sync**: a mutation in one open panel is reflected in every other open
  DropComp panel immediately.
- No quick-import overlay or other in-panel shortcuts — panels are the whole scope.

## Approach

One extension bundle, five `<Extension>` entries, one shared `panel/index.html`.
Each panel decides its mode at boot from `CSInterface.getExtensionID()`.
(Rejected: per-panel HTML entry points — 5× markup drift with no bundler;
responsive split view — not actually independent panels.)

## Design

### Manifest (`CSXS/manifest.xml`)

| Extension ID | Menu label | Default size |
|---|---|---|
| `com.DropComp.ext` (unchanged) | DropComp | 400×600 |
| `com.DropComp.library` | DropComp Library | 400×600 |
| `com.DropComp.assets` | DropComp Assets | 400×600 |
| `com.DropComp.tools` | DropComp Tools | 340×420 |
| `com.DropComp.scripts` | DropComp Scripts | 360×500 |

All five share `MainPath ./panel/index.html`, `ScriptPath ./jsx/hostscript.jsx`,
and the same CEF command-line flags (`--enable-nodejs`, `--mixed-context`).
Keeping `com.DropComp.ext` unchanged preserves existing users' saved workspaces.
New panels appear in Window > Extensions after the AE restart that follows a
normal self-update.

### Panel modes

New pure function `DCState.panelModeFromExtensionId(id)` →
`'full' | 'library' | 'assets' | 'tools' | 'scripts'`; unknown IDs → `'full'`
(fail-safe). `main.js` reads the extension ID once at boot and passes the mode
to `DCShell.init`.

Standalone-mode behavior:

- Tab bar hidden via a `mode-<name>` class on `<body>` (pure CSS).
- `setActiveTab(mode)` is pinned; **standalone panels never persist `activeTab`**
  (localStorage is shared — a standalone panel must not stomp the main panel's
  remembered tab).
- Header app-name shows the section (e.g. "DropComp Tools") so docked panels
  are identifiable.
- Background update check + gold update chip run **only in full mode**.
  Settings → Check for Updates still works in every panel.
- **Tools mode skips the library check entirely** — it boots straight to the
  tools UI even with no library configured or the drive missing.
  Library/Assets/Scripts standalone panels reuse the existing welcome /
  drive-missing screens unchanged.

`hostscript.jsx` is evaluated once per open panel into AE's single shared
ExtendScript engine. It must stay idempotent under re-evaluation; verify during
implementation that a re-eval resets no state.

### Live sync (`panel/js/sync.js`, ~60 lines)

CEP cross-extension event bus (`CSInterface.dispatchEvent` /
`addEventListener`), one event type `com.dropcomp.changed`, JSON payload
`{ kind, sender }`:

- `kind: 'library' | 'assets' | 'scripts'` — broadcast from the success
  callback of every mutation (add comp/AEP, add assets, add selected image,
  rename, delete, category ops, script save/delete).
- `kind: 'path'` — library folder changed; receiving panels re-run
  `verifyAndLoad()`.
- `kind: 'prefs'` — sort/view/display prefs changed; receiving panels re-apply
  controls and re-render.

Receive logic: ignore own events (`sender === my extension ID`); if the
affected section is visible → refresh; if hidden/cached → `resetLoaded()` so
the next visit re-reads disk. Mutations are user-initiated and rare — no
debouncing.

Interface: `DCSync.init(onRemoteChange)` and `DCSync.broadcast(kind)` only.

### Prefs

All panels share one localStorage: one set of view/sort/display prefs, kept
consistent by `prefs` events. Only `activeTab` needs guarding (above). Early in
implementation, verify with a live check that localStorage is in fact shared
across the five extensions; if it were not, everything still works — prefs
would just be per-panel.

## Error handling

- Unknown extension ID → full mode (never a bricked panel).
- Malformed sync payload → ignored (try/catch around JSON.parse; no rethrow).
- Sync events arriving before a panel finishes booting → module `resetLoaded()`
  flags are safe to set at any time; refresh calls are gated on the app screen
  being visible.
- No library configured: tools mode unaffected; other modes show the existing
  welcome screen.

## Testing

- Unit (existing node harness): `panelModeFromExtensionId` for all five IDs +
  unknown; `sync.js` payload encode/decode + routing decisions with a fake
  CSInterface; "standalone never persists activeTab".
- Version-sync test extended to all five `<Extension>` version attributes.
- Manual pass in AE: open all five panels; add a comp from the main panel →
  standalone Library updates live; Tools panel boots with no library; restart
  AE → panels persist in the workspace.

## Release

- Version 2.9.0, normal 5-step release (zip + zxp).
- README: short "Multiple panels" section.
- Release notes: new panels appear under Window > Extensions after restarting
  AE; each open panel is its own Chromium instance (~50 MB), you only pay for
  panels you open.

## File impact (all within size contracts)

- `CSXS/manifest.xml` — +4 extension entries.
- `panel/js/state.js` — +`panelModeFromExtensionId` (~15 lines).
- `panel/js/sync.js` — new (~60 lines).
- `panel/js/shell.js` — mode pinning, broadcast calls (~30 lines).
- `panel/js/main.js` — mode detection at boot (~15 lines).
- `panel/index.html` / `css/style.css` — `mode-*` classes, header title.
- `tests/` — new unit tests + version-sync extension.
