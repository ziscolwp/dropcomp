# Shape Assets — capture AE shape layers into the Assets tab

**Date:** 2026-07-15
**Branch:** `feature/shape-import` (stacked on `feature/multi-panel`)
**Status:** Approved (approach + branch base confirmed by Ziscol)

## Goal

Let the user select one or more **shape layers** in the active After Effects
comp and save them into the DropComp Assets tab, alongside images and SVGs.
Importing a saved shape later pastes the layers back into whatever comp is
active — as fully editable shape layers (paths, fills, strokes, effects,
keyframes, expressions intact).

## Approach (decided)

**AEP snapshot.** AE scripting has no API to serialize a shape layer to a
portable file; the only lossless container is a project file. DropComp's
Library stash flow already proves the mechanism: save project → save-as temp
.aep → `reduceProject()` → copy the tiny .aep out → reopen the original.
Shapes ride the same machinery with one twist — the selected shape layers are
first copied into a throwaway comp inside the temp project, and that comp is
what gets reduced and saved.

JSON serialization of the shape property tree was rejected: lossy (gradients,
keyframe eases, expressions, layer styles) and a large maintenance surface.

## Storage layout

```
<Library>/Assets/<Category>/
  MyShape.aep            ← self-contained project holding one comp of shape layers
  .thumb_MyShape.aep.png ← rendered PNG thumbnail sidecar (dot-file: never indexed)
```

- Shape assets are flat files in the existing Assets categories — same index
  (`.dropcomp_assets_index.json`), same rename/delete/favorite/sync flows.
- `aep` joins `DC_ASSET_EXTS`. An asset entry with `ext === 'aep'` is a shape
  asset. Entries gain an optional `thumbPath` field pointing at the sidecar.
- The sidecar is named `.thumb_<full aep filename>.png` so rename/delete can
  derive it mechanically. Dot-files are already skipped by
  `assetEntryFromFile`, so sidecars never appear as assets themselves.

## Capture flow

Panel (`assets.js`):
1. New toolbar button **Add Shape** (visible on the Assets tab, next to
   *Add Selected Image*) → `DCAssets.addShapeFlow()`.
2. Host call `getShapeSelectionInfo()` validates up front and returns
   `{ok, count, name}` (name = first selected shape layer's name) so the user
   gets an immediate, specific error ("Select a shape layer…") before any modal.
3. On ok → category modal (`openCategoryModal('addShape', …)`), reusing the
   existing modal + `confirmCategoryModal` dispatch in shell.js.
4. Confirm → host `addShapeFromSelection(libraryPath, category)` →
   toast + `loadAndBroadcast()` (multi-panel sync for free).

Host (`jsx/shapes.jsx`, new module — assets.jsx is at 352 lines and stays
under the 400-line target by not absorbing this):
1. Guards: project open, project saved at least once (the stash flow's
   save/reopen dance requires a file), active comp, ≥1 selected layer, every
   selected layer is a shape layer (`matchName === 'ADBE Vector Layer'` — the
   codebase gotcha: shape/text layers fail `instanceof AVLayer` checks).
2. `app.project.save()` (persist user edits — same documented behavior as
   Library stash), then `app.project.save(tempAEP)` to retarget.
3. In the temp project: create comp `<name>` with the source comp's
   width/height/pixelAspect/frameRate; duration = max selected layer outPoint
   (min 1s). `layer.copyToComp(tempComp)` bottom-to-top so stacking order is
   preserved; then shift all copied layers so the earliest `startTime` is 0.
4. Thumbnail via existing `saveVerifiedThumb(tempComp, sidecarFile)`.
5. `app.project.reduceProject([tempComp])`, save, copy temp .aep to
   `Assets/<category>/<safeName>.aep` (`uniqueAssetTarget` handles collisions;
   the sidecar copies under the matching final filename).
6. `finally`: reopen the original project, remove the temp file.
7. Update the assets index (entry with `ext:'aep'`, `thumbPath`, `addedAt`).

## Import flow

`importAsset(filePath)` in assets.jsx branches: `ext === 'aep'` →
`importShapeAsset(filePath)` in shapes.jsx. Panel code is unchanged for
import (double-click / Import button already routes through `importAsset`).

Host `importShapeAsset`:
1. Guards: project open, **active comp required** — shapes are layers, there
   is nothing sensible to do without a target comp. Error:
   `"Error: Open a composition first to import a shape."`
2. Advisory `aepPreflight` (reuse aep-compat.jsx) for friendly
   version-mismatch messages.
3. `beginSuppressDialogs` → `importFile` **outside** any undo group (known AE
   undo-corruption gotcha, same as `importComp`) → `beginUndoGroup`.
4. Find the first comp in the imported folder; copy its **shape layers only**
   into the active comp bottom-to-top (`copyToComp`), shift so the earliest
   startTime lands at `activeComp.time`, select them (deselect everything
   else). Non-shape layers are skipped and counted in the success message.
5. Delete the imported folder items — shape layers have no external footage
   dependencies, so removal is safe and the project bin stays clean.
6. `endUndoGroup`; text protocol `Success:/Error:` mirroring `importAsset`.
7. If the .aep contains no comp with shape layers: `"Error: No shape layers
   found in this asset."` (cleanup still runs).

## Index / rename / delete changes (assets.jsx)

- `DC_ASSET_EXTS` += `aep: 1`.
- `assetEntryFromFile`: for `ext === 'aep'`, probe the sibling
  `.thumb_<full aep filename>.png` (e.g. `.thumb_MyShape.aep.png`); set
  `thumbPath` when present (survives full rebuilds).
- `renameAsset`: also rename the sidecar when present.
- `deleteAsset`: also remove the sidecar.
- Side effect (accepted): dropping/picking an external .aep through the
  regular Add Assets flow now indexes it as a shape asset; importing it copies
  the first comp's layers. Layers with footage sources are not copied (only
  the comps' layers ride copyToComp, and the imported items are deleted), so
  `importShapeAsset` copies **shape layers only** and reports how many
  non-shape layers it skipped.

## Rendering (render.js)

- Asset cards / rows: `ext === 'aep'` with `thumbPath` renders the PNG
  (cache-busted by `addedAt`, like images); fallback badge reads **SHAPE**
  instead of the raw extension.

## Module registration

- `hostscript.jsx`: `DC_MODULE_FILES` += `shapes.jsx`, `DC_MODULE_MARKERS` +=
  `addShapeFromSelection` (jsx.exports.test.js enforces the export contract).
- `panel/index.html`: script tag order unchanged except the new button markup.

## Error handling summary

| Condition | Message |
|---|---|
| No project | `Error: Please open a project first.` |
| Project never saved | `Error: Save your project once before saving shapes.` |
| No active comp (capture) | `Error: Select shape layers in an open composition first.` |
| Selection has no shape layer | `Error: Select one or more shape layers first.` |
| Mixed selection | Non-shape layers are skipped; toast reports the skip count. |
| No active comp (import) | `Error: Open a composition first to import a shape.` |
| Version-newer .aep | aep-compat's existing friendly message. |

## Testing (TDD, node:test — no AE required)

- `tests/shapes.jsx.test.js` — source-level tests of shapes.jsx: guards
  ordering, matchName filter, bottom-to-top copy loop, startTime re-basing,
  cleanup in finally, text protocol strings, undo-group pairing (extend
  `undo-groups.test.js` pattern), import-outside-undo-group rule.
- `tests/jsx.exports.test.js` — add module + marker (existing loop covers the
  rest automatically).
- `tests/assets.shape-sidecar.test.js` — assetEntryFromFile thumb probing,
  rename/delete sidecar handling, DC_ASSET_EXTS includes aep.
- `tests/assets.add-shape.test.js` — panel flow: addShapeFlow host-error
  path, modal open, confirm dispatch (`addShape` mode) calling
  `addShapeFromSelection`, success → `loadAndBroadcast` (mirrors
  `assets.add-selected.test.js` + `sync.broadcast.test.js`).
- `tests/render.asset-preview.test.js` — extend: aep + thumbPath renders img;
  aep without thumb shows SHAPE badge.
- Manual AE checklist (post-merge, like SVG/2.8.x features): capture single
  shape, capture multi-layer stack, import into comp at playhead, undo one
  step restores clean state, project bin clean after import, version-mismatch
  message on an older AE if available.

## Out of scope

- Text layers, nulls, solids (shapes only — matchName filter).
- Editing/replacing an existing shape asset in place (delete + re-add).
- Migrating shape assets between Library and Assets tabs.
