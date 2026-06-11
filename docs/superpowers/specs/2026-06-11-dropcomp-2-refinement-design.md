# DropComp 2.0 — Refinement Design

**Date:** 2026-06-11
**Status:** Approved by ziscol (design review in chat)
**Target:** After Effects CEP panel, AE 15.0+ (developed against AE 26.x, macOS)

## Background

DropComp is a CEP extension that manages a library of reusable compositions. Each
library item is a folder `<Library>/<Category>/<SafeName>_<timestamp>/` containing a
self-contained `.aep`, a `comp.png` thumbnail, `metadata.json`, and a `(Footage)/`
subfolder. The panel stashes selected comps into the library and imports them back
into the active project. The library lives on an external drive
(`/Volumes/MAIN DIRVE/Assets/EDITING TEMPLATE ( DropComp )`); the path is stored in
`~/Documents/DropComp/library_path.txt`.

Current install: `~/Library/Application Support/Adobe/CEP/extensions/DropComp/`
(v1.1.0, no version control).

## Problems being solved

1. **UI is broken and inflexible.** Fixed 130px grid breaks at narrow/wide panel
   sizes; four-button view cluster (grid/list/comfortable/compact) is confusing;
   no thumbnail size control, no sorting, dated styling.
2. **Rename corrupts the library.** `renameStashedComp()` renames the `.aep` on disk
   but the index keeps the stale `aepPath`, so Import fails until a manual refresh.
   The folder name is never updated, so Finder no longer matches the panel.
3. **No thumbnails for external templates.** AEPs added from outside (downloaded
   templates) have no `comp.png`. The only workaround is manually opening the
   project and re-stashing. There is no way to add an external `.aep` from the panel
   at all.
4. **Data-loss bug (found in review).** Stashing from a never-saved project leaves
   the user inside the reduced temp project and deletes the only backup of their
   work (`stashSelectedComp` finally-block).
5. **HTML injection (found in review).** Comp names are concatenated into
   `innerHTML` unescaped; names containing `"`, `<`, etc. break grid rendering.

## Decisions already made (with ziscol)

- **Look:** Direction B — modern asset-manager style (CompBuddy 2.0 reference):
  dark, rounded cards, hover actions on thumbnails, metadata lines, header with
  tabs. **Accent: keep DropComp gold `#FFD700`** on near-black.
- **Front-end:** full rebuild of `index.html` + CSS + panel JS. ExtendScript keeps
  its working functions and gets targeted fixes/additions.
- **Thumbnail engine:** silent import-and-capture in the current project (no
  project close/reopen).
- **Code home:** `~/Ziscol Media Projects/dropcomp/` with git; install/dev-link
  scripts to the CEP extensions folder (Smart Grab pattern).
- **Declined:** batch "generate all missing thumbnails on refresh" (user only wants
  per-item Generate + Add-AEP auto-thumb + set-from-current-frame).
- **Removed feature:** separate list view and density modes — replaced by the
  thumbnail size slider plus display toggles.

## Out of scope (phase 2, separate conversation)

- **Assets tab** — a parallel library for images/icons/textures with thumbnails.
  This design only ships the tab bar scaffold with "Assets · soon" disabled stub.

---

## 1. Project setup

```
~/Ziscol Media Projects/dropcomp/
├── CSXS/manifest.xml          # bundle id com.DropComp.ext (unchanged), v2.0.0
├── panel/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── CSInterface.js     # Adobe vendored lib (unchanged)
│       ├── main.js            # bootstrap + event wiring
│       ├── state.js           # prefs, filters, sort, grouping (pure where possible)
│       ├── render.js          # DOM building (no innerHTML for dynamic strings)
│       ├── actions.js         # stash/import/rename/delete/add-aep flows
│       ├── bridge.js          # evalScript wrapper, escaping, locking
│       └── validate.js        # name validation (pure)
├── jsx/hostscript.jsx         # ExtendScript (ES3)
├── tests/                     # node unit tests for pure modules
├── docs/superpowers/specs/    # this file
├── install.command            # copy into CEP extensions dir
├── dev-link.command           # symlink for development
└── README.md
```

- Each panel JS file stays under 400 lines (split further by concern if needed).
  `hostscript.jsx` stays a single file but under 800 lines; if it grows past that,
  split via `$.evalFile`.
- Manifest: same extension/bundle id so settings and library path carry over;
  version 2.0.0; panel geometry unchanged (400×600 default).
- Before first install of 2.0: zip the existing extension folder to
  `~/Documents/DropComp/backup-v1.1.0.zip`.
- ES level: panel JS may use modern JS (CEP 12 = Chromium 99); ExtendScript stays ES3.

## 2. UI design

Reference mockup approved in chat (gold on `#161616`, rounded 8–10px corners).

**Header** — logo glyph, "DropComp" + gold "2.0" chip, settings gear (right).
Below: tab bar — `Library` (active, gold underline) and `Assets · soon`
(disabled, no-op; tooltip "Coming in 2.1").

**Toolbar (Library tab)**
- Row 1: search field (flex), sort menu (`Recently used` / `Most used` / `Name` /
  `Date added`), favorites star toggle, display menu (checkboxes: Show names,
  Show metadata). `Recently used`/`Most used` read the existing per-item usage
  stats in localStorage (never-used items sort last); `Date added` uses
  `metadata.addedAt`, falling back to the timestamp tail of the uniqueId for
  legacy items.
- Row 2: gold primary button **Add Selected Comp**; secondary icon button
  **Add .aep from disk**; thumbnail size slider (range 90–240px min column width,
  persisted).

**Category sections** — replace the dropdown filter. Each category renders as a
collapsible section: chevron + name + gold count chip. Collapse state persisted
per category. Sections sorted alphabetically; items within a section follow the
active sort. Search filters across all sections (sections with no matches hide).
Favorites filter hides non-favorited items.

**Cards** — rounded card: 16:9 thumbnail (`object-fit: cover`, `loading="lazy"`,
cache-busted with `?t=<mtime>` after regeneration), name (1 line, ellipsis,
title attr), metadata line `1920×1080 · 6.0s · 30fps` (hidden when unknown or
toggled off). Hover: gold border, action icons top-right (favorite/rename/delete),
gold **Import** bar over the bottom of the thumbnail. Double-click anywhere
imports. Cards without a thumbnail show a placeholder + gold **Generate** chip.
Card context (small overflow icon or right-click): **Set thumbnail from current
frame**, **Reveal in Finder**.

**Grid** — `repeat(auto-fill, minmax(var(--thumb-min), 1fr))`; `--thumb-min` driven
by the slider. Works from ~240px-wide docked strip to full-screen floating panel.

**Modals** (restyled to new theme): add-category (existing/new), rename, delete
confirm, settings. Esc closes, Enter confirms. Settings modal: current path,
Change Folder, Refresh Library, **Open Library in Finder**, version line.

**States** — welcome screen (no path set), empty library, no search results,
loading spinner, toasts (success gold / error red).

**Persisted prefs (localStorage)** — `dropcomp_prefs` JSON: thumbMin, sort,
showNames, showMeta, favoritesOnly, collapsedCategories[]. Legacy keys
(`dropcomp_view`, `dropcomp_density`) read once for defaults, then removed.
`dropcomp_metadata` (per-item favorites/usage) format unchanged.

## 3. Rename fix

`renameStashedComp(libraryPath, category, uniqueId, newName)` becomes a
transaction. Folder naming scheme stays `<safeName>_<timestamp>`; the timestamp is
parsed from the tail of the old uniqueId and preserved.

Order (each step reverts prior steps on failure):
1. Validate name (panel-side validate.js + host-side re-check). Compute
   `newUniqueId = safeNewName + "_" + timestamp`. Abort if target folder exists.
2. Rename folder → on failure abort with error.
3. Rename `.aep` inside → on failure rename folder back, abort.
4. Rewrite `metadata.json` (displayName) → on failure revert 2–3, abort.
5. Update index entry: `name`, `uniqueId`, `aepPath`, `thumbPath` (this was the
   bug — paths were never updated). On failure: full `rebuildLibraryIndex()`.
6. Return new uniqueId to the panel; panel migrates the localStorage metadata key
   (favorites/usage) from old to new uniqueId.

Result: Finder folder, AEP file, panel name, and index always agree.

## 4. Thumbnail + metadata engine

### New hostscript: `captureCompInfo(aepPath, targetPngPath, preferredName)`

Runs inside the **current open project** (requires one to be open — any state):
1. `beginUndoGroup`, `importFile` the AEP.
2. Find main comp: exact `preferredName` match → partial match → first comp
   (recursive through imported folder).
3. `saveFrameToPng` at `workAreaStart + workAreaDuration/2`; verify the PNG exists
   and is > 1 KB; if not, retry at `workAreaStart`, then at 25% of duration; keep
   the first verified result.
4. Read `width, height, duration, frameRate, name` from the main comp.
5. Remove the imported folder item, `endUndoGroup`.
6. Return JSON `{ok, width, height, duration, frameRate, compName, thumbOk}` or
   `{ok:false, error}`.

Used by three flows:

**Add .aep from disk** — toolbar button → `File.openDialog` (*.aep) → category
modal (reuse add-category modal) → create
`<Library>/<Category>/<safeName>_<now>/`, copy the AEP in as `<safeName>.aep` →
`captureCompInfo` → write `comp.png` + `metadata.json`
(`source: "external"`) → `updateIndexAddComp` → render. The original file on disk
is not touched. Note for user docs: external templates' footage is NOT collected
into `(Footage)/` — the AEP is copied as-is.

**Generate chip** on any card missing a thumb — runs `captureCompInfo` against
that item's AEP, writes `comp.png`, backfills metadata fields, updates index.

**Metadata backfill** — same call updates width/height/duration/frameRate for old
items whenever Generate or Set-thumbnail runs.

### Set thumbnail from current frame

Card action. Requires `app.project.activeItem` to be a CompItem. Calls
`saveFrameToPng(activeComp.time, <item>/comp.png)`, verifies the file, updates
index `thumbPath` if it was null, panel cache-busts the img. This is the manual
override when the auto-grabbed frame is wrong (and the replacement for the old
"open the project and re-stash" ritual).

### Stash flow changes (`stashSelectedComp`)

- **Guard:** if `app.project.file === null`, return
  `"Error: Save your project once before stashing."` — removes the unsaved-backup
  code path entirely (fixes the data-loss bug).
- Capture `width/height/duration/frameRate` from the comp into `metadata.json`.
- Thumbnail uses the same verify-and-retry logic as `captureCompInfo`.
- Everything else (reduceProject, footage copy into `(Footage)/`, restore original
  project) unchanged.

### Data formats

`metadata.json` (per item — superset of v1, all new fields optional):
```json
{
  "displayName": "Comment Pop",
  "mainCompId": 123,
  "mainCompName": "Comment Pop",
  "width": 1080, "height": 1920,
  "duration": 17.8, "frameRate": 60,
  "addedAt": 1718000000000,
  "source": "stash" | "external"
}
```

`.dropcomp_index.json`: `version: 2`; each composition entry gains
`width/height/duration/frameRate` (nullable). Loading a non-v2 index triggers
`rebuildLibraryIndex()` (which now also reads the new metadata fields). v1
libraries therefore migrate by a single automatic rebuild; no user action.

## 5. Robustness fixes

- **HTML safety:** render.js builds cards with `document.createElement` +
  `textContent`/`dataset`; no string-concatenated `innerHTML` for any
  user-controlled value.
- **Index self-heal:** if `importComp` reports the AEP missing, panel triggers
  `rebuildLibraryIndex` and retries the import once before surfacing the error.
- **Kept from v1.1:** `escapeForEvalScript`, operation lock, name validation
  (invalid chars, reserved names, length), stale-metadata cleanup,
  `safeFileOperation` wrapper.
- **Library drive unmounted:** if the library path doesn't exist at load, show a
  clear state ("Library drive not mounted — Reconnect or change folder") instead
  of an empty library.

## 6. Error handling conventions

- Hostscript entry points return `"Error: <message>"` strings or JSON with
  `ok:false` (capture engine); never throw across the bridge.
- Panel surfaces every failure as a toast; no empty catch blocks; console.error
  retains detail.
- All multi-step disk operations follow the revert-on-failure pattern from §3.

## 7. Testing

**Unit (node, `npm test`, TDD red→green→refactor):**
- validate.js — name validation matrix (empty, too long, invalid chars, reserved).
- state.js — sort comparators (4 modes), search filter, favorites filter, category
  grouping, collapsed-state handling, uniqueId timestamp parsing, rename-target
  computation (`newUniqueId`), legacy-pref migration, stale-metadata cleanup.
- Index transforms are exercised via pure JS mirrors where practical.

**Manual checklist in AE (each release):**
stash (saved project), stash guard (unsaved project), add external .aep with
auto-thumb, Generate on thumbless item, set-thumb-from-current-frame, rename →
verify Finder folder + import still works + favorite survives, delete, search,
all 4 sorts, favorites filter, slider min/max at narrow and wide panel widths,
collapse persistence, special-character names (`"quote"`, `<tag>`, emoji),
library drive unmounted state, v1 library auto-migration.

## 8. Compatibility

- Existing library folders work unchanged; metadata line appears only after an
  item is re-stashed, Generated, or thumb-set.
- Same bundle id → AE treats 2.0 as an update; `library_path.txt` untouched.
- Favorites/usage stats survive (key migration on rename).
- Windows paths kept working in code (no mac-only APIs beyond what v1 used:
  `Reveal in Finder` uses `folder.execute()` which is cross-platform).
