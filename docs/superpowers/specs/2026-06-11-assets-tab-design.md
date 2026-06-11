# DropComp 2.1 — Assets Tab (Phase 2) Design

Date: 2026-06-11
Status: approved for planning (decisions made autonomously per user's written brief; defaults flagged below)

## 1. Goal

A second library, parallel to the comp library, for reusable graphic files (icons, logos,
PNGs, textures, mouse/person cursors). Reference UX: CompBuddy 2.0 "Other > IconKit" —
a grid of small image thumbnails with names, search, +Add, refresh. The Assets tab gets
the same search / categories / favorites / sorting / size-slider UX the Library tab has,
reusing the existing state/render modules.

User requirements (from the brief):
1. Assets live inside the existing DropComp library folder, in their own area, organized
   by category folders like comps are.
2. "Add asset" picks one or MORE image files from disk; they are copied into the chosen
   category. The file itself is the thumbnail — no AE capture.
3. Grid shows thumbnails + names with search, categories, favorites, sorting, size slider.
4. Click/double-click imports into the open AE project and drops it into the active comp
   at the playhead, like comps do.
5. Rename / delete / reveal-in-Finder per asset, same as comps.

## 2. Approaches considered

**A. Parallel modules (chosen).** Assets get their own disk area, their own index file,
their own host module (`jsx/assets.jsx`, loaded like `relink.jsx`), and their own panel
feature module. The proven comp pipeline is untouched; shared pure logic (sort, filter,
group, usage, prefs) is reused via the existing parameterized DCState functions.

**B. Unified item model.** Extend the v2 comp index with a `type: 'comp' | 'asset'`
field and make each tab a filter. Rejected: it couples a new, simpler entity (one image
file) to the comp entity (folder + aep + thumb + footage + capture), forces a migration
of the working v2 index, and raises regression risk on the just-shipped pipeline for no
user-visible gain.

**C. Assets as pseudo-comps** (item folders with placeholder metadata). Rejected: deep
folder nesting for single files makes the on-disk area unpleasant to browse by hand,
which defeats requirement 1's spirit (a simple, human-manageable folder of images).

## 3. On-disk layout

```
<library>/                          ← existing comp library root (on MAIN DIRVE)
  <Comp Category>/<Name_ts>/...     ← unchanged
  Assets/                           ← reserved assets root, created on first add
    .dropcomp_assets_index.json     ← assets index (v1)
    Icons/
      mouse-pointer.png
      arrow_2.png                   ← collision auto-suffix
    Logos/
      client-x.psd
```

- An asset is **one image file directly in its category folder**. No per-item folders,
  no sidecar metadata — the folder stays human-manageable in Finder.
- `uniqueId = '<Category>/<filename>'` (e.g. `Icons/arrow.png`). Stable across index
  rebuilds; rename migrates the usage-metadata key (existing `migrateMetadataKey`).
  Comp uniqueIds never contain `/`, so the two id spaces cannot collide, but comp and
  asset usage metadata are still stored under **separate localStorage keys** because
  `cleanupStaleMetadata` runs per-list and would otherwise wipe the other tab's keys.

**Reserved name `Assets`:**
- `rebuildLibraryIndex` (comps) skips the top-level `Assets` folder explicitly.
- Comp category validation rejects creating a category named `Assets` (case-insensitive),
  panel and host side. Verified: the live library has no existing category by that name.

**Supported formats** (AE-importable stills): `png jpg jpeg gif bmp tif tiff tga psd ai eps`.
- Browser-renderable (`png jpg jpeg gif bmp`): the file itself is the `<img>` thumbnail.
- Not Chromium-renderable (`tif tiff tga psd ai eps`): placeholder tile with an uppercase
  extension badge (e.g. `PSD`). Still fully importable. (Default chosen: accepting these
  formats beats silently rejecting a .psd logo; flagged for user review.)
- SVG and WebP are excluded — AE cannot import them as footage.

## 4. Assets index

`<library>/Assets/.dropcomp_assets_index.json`:

```json
{ "version": 1, "lastUpdated": 1760000000000,
  "assets": [ { "name": "arrow", "category": "Icons", "uniqueId": "Icons/arrow.png",
                "filePath": "/Volumes/.../Assets/Icons/arrow.png", "ext": "png",
                "sizeBytes": 24576, "addedAt": 1760000000000 } ] }
```

- `name` = filename without extension (the filename IS the display name — no metadata file).
- `addedAt` = copy time on add; on rebuild it falls back to the file's modified date
  (original add-date is not preserved across a manual rebuild — acceptable).
- `getAssets` reads the index when valid, otherwise rebuilds by scanning `Assets/*/`
  for supported extensions (skips dot-files).

## 5. Host side — new `jsx/assets.jsx` (ES3)

`hostscript.jsx` is at 737/800 lines, so asset functions live in a new module loaded the
same way as `relink.jsx`: `loadHostModules` evalFiles **both** files and verifies one
marker export from each (`$.global.collectMissingFootage`, `$.global.getAssets`);
`ensureHostModules` checks both. Every top-level function exports to `$.global`
(the `$.evalFile` local-scope gotcha — `tests/jsx.exports.test.js` is generalized to
cover both modules).

Functions (JSON `{ok,...}` protocol except `importAsset`, which uses the text protocol
to mirror `importComp` exactly):

| Function | Behavior |
|---|---|
| `getAssets(libraryPath)` | Index if valid, else rebuild. Returns JSON array (`[]` when Assets/ absent). |
| `rebuildAssetsIndex(libraryPath)` | Rescan `Assets/*/`, write index, return JSON array. |
| `pickAssetFiles()` | `File.openDialog(..., multiSelect=true)`. Returns `{ok, paths: [...]}` or `{ok:false, cancelled:true}`. |
| `addAssetFiles(libraryPath, category, pathsJson)` | Creates `Assets/<category>/` on demand; copies each file; filename collision → `name_2.ext`, `name_3.ext`…; unsupported extension → skipped and reported. Returns `{ok, added, skipped: [names]}`. |
| `renameAsset(libraryPath, category, fileName, newName)` | Host-side re-validation (mirrors DCValidate, ES3); renames file keeping its extension; collision check; patches index. Returns `{ok, newUniqueId}`. Asset names keep spaces/dashes — no `safeName` munging, since the filename is the display name. |
| `deleteAsset(libraryPath, category, fileName)` | Removes the file + index entry. Returns `{ok}`. |
| `importAsset(filePath)` | Text protocol. Dedupe: if a FootageItem with the same file path already exists in the project, reuse it; else `importFile` with `ImportAsType.FOOTAGE` under `beginSuppressDialogs` (PSD/AI import merged, no dialogs). The footage item is placed in a single reusable `Assets [DropComp]` project folder. If a comp is active: `layers.add(footage)`, `startTime = comp.time`, layer selected (identical to comp import). |

## 6. Panel side

### 6.1 Prerequisite refactor — split actions.js (455 lines, already marked)

Feature-based split; pure refactor commit(s) before the feature lands:

| Module | Owns | ~Lines |
|---|---|---|
| `ui.js` (DCUI) | els registry, toast, spinner, screen switcher, isError, modal open/close/closeAll, category-modal population (parameterized: title + category list) | ~110 |
| `shell.js` (DCShell) | boot / verifyAndLoad / selectLibraryFolder / settings, prefs load/persist, grid-size, **tab switching**, toolbar handlers (search/sort/favorites/display/slider) delegating rerender to the active tab's module | ~170 |
| `library.js` (DCLibrary) | all comp flows, unchanged behavior (load, stash, addAep, import w/ self-heal retry, rename, delete, thumbs, relink, reveal) + comp usage meta | ~270 |
| `assets.js` (DCAssets) | asset flows (below) + assets usage meta | ~200 |

`actions.js` is deleted; `main.js` rewires to the new modules. Behavior is byte-identical
during the split (the deferred review minors — closeModal-before-acquire, usage increment
timing — are NOT fixed mid-refactor; they stay on the deferred list, except the new
assets code which does it right from the start: **usage increments only on successful
import**, modal closes only after `acquire`).

### 6.2 Asset flows (DCAssets)

- `loadAssets` → `getAssets`, stale-usage cleanup against asset list (reuses
  `cleanupStaleMetadata`), rerender.
- `addAssetsFlow` → `pickAssetFiles` → category modal (mode `addAssets`, categories from
  asset list) → `addAssetFiles` → toast `"N assets added"` + per-name skipped warning →
  reload.
- `importAsset(uniqueId)` → op-lock, `importAsset(filePath)`; on `not found` + first try:
  rebuild index, retry once (mirrors comp self-heal); usage increment **on success**.
- `renameFlow` / `confirmRename` → rename modal (shared), `renameAsset`, migrate usage key.
- `deleteFlow` / `confirmDelete` → delete modal (shared), `deleteAsset`.
- `reveal` → `revealInFinder` on the category folder (file-level reveal selects the
  folder containing the asset; ExtendScript cannot select a single file in Finder).
- `toggleFavorite` → assets usage map (separate storage key `dropcomp_assets_metadata`).

### 6.3 Tabs & toolbar

- `#tab-assets` enabled; clicking switches tabs; active tab persisted as `prefs.activeTab`
  (`'library' | 'assets'`, default `'library'`). Old saved prefs lack the new keys and
  fall back to defaults via the existing `loadPrefs` merge — no migration needed.
- Toolbar contextual visibility via a container class (`#app.assets-active`):
  comp-only controls (Add Selected Comp, Add .aep, relink) hide; an `Add Assets`
  gold button shows. Search placeholder swaps to "Search assets...".
- Shared controls (search, sort, favorites, display menu, slider) apply to the active
  tab; the search query intentionally persists across tab switches (simplest; flagged).
- Collapsed sections per tab: `prefs.collapsed` (comps) / `prefs.collapsedAssets`.
- The favorites filter state (`prefs.favoritesOnly`) is shared across tabs (one toggle).

### 6.4 State module additions (state.js, ~157 → ~195 lines)

- `loadUsageMeta(storage, key?)` / `saveUsageMeta(storage, meta, key?)` — optional key
  parameter, default unchanged (backwards compatible).
- `formatAssetMetaLine(asset)` → `"PNG · 24 KB"` (`formatBytes` helper: B/KB/MB).
- `defaultPrefs()` gains `activeTab: 'library'`, `collapsedAssets: []`.
- Everything else (sort/filter/group/getUsage/migrateMetadataKey) is reused as-is —
  assets are `{name, category, uniqueId, addedAt}`-shaped just like comps.

### 6.5 Render module (render.js, ~121 → ~190 lines)

- `render(container, groups, prefs, usageMeta, busts, emptyMessage, kind)` — `kind`
  defaults to `'comp'` (existing callers unchanged).
- Asset cards: `<img>` thumbnail (`object-fit: contain` on a subtle dark well — icons
  with transparency read better contained than cropped) or extension-badge placeholder
  for non-renderable formats; actions favorite / rename / reveal / delete (no
  setThumb/generate); the same hover Import bar; name + `EXT · size` meta line.
- Thumbnail URLs use the same encode helper as comp thumbs (extracted, not duplicated).

### 6.6 CSS (style.css, ~250 → ~290 lines)

`.card--asset` img contain + padding; `.ext-badge`; `#app.assets-active` visibility
rules; tab styles already exist.

## 7. Error handling & edge cases

- No open project on import → same error toast as comps.
- Asset file deleted on disk but indexed → import fails `not found` → auto-rebuild +
  single retry, else "item missing on disk — library re-indexed" (comp pattern).
- Drive unplugged → existing shared drive-missing screen (same library path).
- Add: zero valid files picked → "No supported image files selected." with the
  supported-extension list; partial → added count + skipped names.
- Rename collision → `{ok:false}` error toast, modal stays closed, nothing renamed.
- `Assets/` absent → empty tab with "No assets yet. Click Add Assets to add images."
- Index corruption → `getAssets` falls back to rebuild (comp pattern).

## 8. Testing

TDD for pure panel modules (`npm test`, node test runner):
- `state.assets.test.js` — formatBytes/formatAssetMetaLine, new pref defaults +
  merge of stale saved prefs, usage-key parameterization (comp key untouched by
  asset writes), sort/filter/cleanup over asset-shaped lists.
- `jsx.exports.test.js` — generalized: every top-level function in **each** loaded
  module (relink.jsx, assets.jsx) exports to `$.global`; `loadHostModules` verifies
  a marker from each module.
- `jsx.es3.test.js` — static guard for both jsx modules + hostscript: no `const`/`let`,
  no arrow functions, no template literals (regex-based; cheap insurance for the
  ES3-only constraint).
- `assets.validation.parity.test.js` — `renameAsset` carries the DCValidate
  invalid-chars + reserved-names checks (mirrors safename.parity technique).
- Manual AE checklist (panel reload after symlinked-repo changes): add multi-file,
  thumbnails render, PSD badge, import at playhead, dedupe on second import, rename,
  delete, reveal, favorites/search/sort/slider, tab persistence, drive-missing.

## 9. File-size contract check (projected)

ui.js ~110, shell.js ~170, library.js ~270, assets.js ~200, state.js ~195,
render.js ~190, main.js ~150 — all < 400. hostscript.jsx 737 + ~15 (loader generalization,
Assets skip, category guard) < 800; assets.jsx ~250 < 800. style.css ~290.

## 10. Decisions flagged for user review (defaults chosen to keep moving)

1. Non-renderable formats (psd/ai/eps/tga/tif) are accepted with a badge placeholder
   instead of rejected. Could later add AE-side preview generation.
2. Asset filenames keep spaces/dashes on rename (no `safeName` underscores) — the
   filename is the display name.
3. Search query and favorites filter are shared across tabs; collapsed state is per-tab.
4. Imported assets group under one `Assets [DropComp]` project folder and re-imports
   reuse the existing footage item instead of duplicating it.
5. Reveal selects the asset's category folder (ExtendScript can't select a single file).
