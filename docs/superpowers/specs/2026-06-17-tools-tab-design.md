# DropComp 2.2 — Tools Tab Design

Date: 2026-06-17
Status: approved for planning (design approved by user; defaults flagged in §11)

## 1. Goal

A third tab — `Library | Assets | Tools` — that puts common After Effects layer
utilities one click away inside DropComp, so the user can undock standalone tool
panels and reclaim AE real-estate. Reference UX: CompBuddy 2.0 "Tools" tab. DropComp
keeps its own dark/gold theme (not CompBuddy's red).

Unlike Library/Assets (data-driven card grids backed by a library folder + index),
the Tools tab is a **static control surface**: grouped buttons that fire AE operations
on the active comp / selected layers. No library folder, no index, no localStorage state.

### 1.1 Scope (v1)

In, per the approved scope ("all but captions"):

1. **Anchor 3×3 grid** — snap selected layers' anchor point to a bounding-box position.
2. **Layer creators** — Null, Adjustment, Solid, Camera.
3. **Align & sequence** — align/distribute selected layers in the frame (button row),
   plus Num/Step "sequence in time".
4. **Pre-comp tools** — PreComp, Decompose, Multi PreComp, Independent.

### 1.2 Out of scope (deferred to its own spec)

- **Auto Captions / Import SRT.** It carries the most edge cases (encodings, timecode
  formats, overlapping cues, caption styling/position) and gets its own design pass as a
  fast-follow so it cannot drag this build's reliability down. The Tools view is laid out
  so a captions section slots in later without rework.

## 2. Approaches considered

**A. Third tab + lightly generalized tab system (chosen).** Add a `Tools` tab and
generalize tab switching so a tab is either a *card view* (Library/Assets: toolbar + grid)
or a *custom view* (Tools: a bespoke control surface). Tools is the first custom view; the
**Scripts tab planned next** drops into the same mechanism without a second refactor. AE
operations live in a new `jsx/tools.jsx`; pure geometry lives in a new node-testable
`panel/js/tools-core.js`; DOM wiring in `panel/js/tools.js`.

**B. Third tab, minimal special-casing.** Hard-code a `tools` branch only where strictly
needed. Rejected: ships marginally faster now but forces re-plumbing when the Scripts tab
arrives — paying twice for the same generalization.

**C. Slide-down Tools drawer (not a tab).** Rejected: doesn't match the reference image,
crowds the 400×600 panel, and doesn't scale as tools grow.

## 3. Tab system generalization

Today `setActiveTab` toggles `library`/`assets`, flips `#app.assets-active`, and calls
`activeModule().ensureLoaded()` where every module is a card module
(`ensureLoaded`/`rerender`/`onCardAction`). Tools breaks that assumption, so:

- `prefs.activeTab` widens to `'library' | 'assets' | 'tools'` (default `'library'`).
  Old saved prefs lack the value → existing `loadPrefs` merge falls back to default; no
  migration. Persisting `'tools'` is fine — if a future build drops the tab, the same
  merge falls back.
- A tab descriptor map: `{ library: {kind:'cards', module:DCLibrary}, assets:
  {kind:'cards', module:DCAssets}, tools: {kind:'custom', module:DCTools} }`.
- `setActiveTab(tab)`: set `prefs.activeTab`; toggle the three tab buttons' `.active`;
  toggle `#app.tools-active` (hides `#toolbar`+`#library`, shows `#tools` — card chrome
  hides wholesale on Tools). The existing `#app.assets-active` class is unchanged and
  keeps swapping comp/asset toolbar buttons *within* the card view. For `kind==='cards'`
  call `module.ensureLoaded()`; for `'custom'` call `module.ensureMounted()` (idempotent
  one-time wiring).
- Card-only toolbar handlers (`onSearch`/`onSortChange`/`onFavoritesToggle`/
  `onDisplayChange`/`onSlider`) guard on the active kind and no-op for a custom view.
  (Defensive only — those controls live inside the hidden `#toolbar`, so they cannot be
  triggered while Tools is active.)
- Modal routing (`confirmRename`/`confirmDelete`/`confirmCategoryModal`/`closeAllModals`)
  is unchanged: Tools owns no modals.
- `#tab-tools` is enabled from the start (no drive/library dependency — tools act on the
  open project, not the library folder, so they work even before a library path is set).

## 4. Host side — new `jsx/tools.jsx` (ES3)

Loaded by the existing `loadHostModules` mechanism: add `tools.jsx` to `DC_MODULE_FILES`
and a marker (`'tlCreateLayer'`) to `DC_MODULE_MARKERS`; `ensureHostModules` already loops
the marker list. Every top-level function exports to `$.global` (the `$.evalFile`
local-scope gotcha — covered by the generalized `jsx.exports.test.js`).

**Conventions for every function:** wrap in one `app.beginUndoGroup(...)` /
`app.endUndoGroup()` (single Ctrl+Z reverts the whole operation); guard preconditions and
return a JSON `{ "ok": false, "error": "..." }` (via the shared `jerr`) on failure;
return `{ "ok": true, ... }` on success. `activeComp()` helper returns the active CompItem
or null. `selectedAV()` returns selected AVLayers (excludes cameras/lights where the op
requires AVLayers).

| Function | Behavior | Guards |
|---|---|---|
| `tlSetAnchor(posIndex)` | For each selected layer: read `sourceRectAtTime(comp.time,false)`, move `anchorPoint` to the grid fraction (§5), shift `position` to compensate so the layer does not visually move (accounts for scale; rotation/3D flagged §11). | comp + ≥1 layer |
| `tlCreateLayer(kind)` | `kind ∈ null\|adjustment\|solid\|camera`. Create at top, `startTime = comp.time`, the new layer selected and others deselected. Solid/Adjustment = comp-sized; Solid color neutral gray `[.5,.5,.5]`, no Solid Settings dialog; Adjustment = comp-sized solid with `adjustmentLayer=true`; Camera = `addCamera('Camera 1',[w/2,h/2])`. | comp |
| `tlAlign(mode)` | `mode ∈ left\|center\|right\|top\|middle\|bottom`. Reference bounds = selection bounds when ≥2 layers selected, else comp bounds. Shift each layer's `position` so the chosen edge/center aligns. | comp + ≥1 layer |
| `tlDistribute(axis)` | `axis ∈ horizontal\|vertical`. Even-space selected layers' centers between the two extreme layers. | comp + ≥3 layers |
| `tlReset()` | Recenter selected layers' `position` to comp center (scale/rotation untouched). Default semantics — flagged §11. | comp + ≥1 layer |
| `tlSequence(num, stepFrames)` | ≥2 layers selected → sequence them in stacking order, each `stepFrames` after the previous (Num ignored). Exactly 1 selected → duplicate it `num` times, each `stepFrames` after the previous. `stepFrames` → seconds via `comp.frameDuration`. | comp + ≥1 layer |
| `tlPreComp()` | `comp.layers.precompose(indices, name, true)` (move all attributes), open the new comp in the viewer. | comp + ≥1 layer |
| `tlMultiPreComp()` | Snapshot selected indices; precompose each individually (move all attributes) into its own comp. Process indices descending so shifting indices stay valid. | comp + ≥1 layer |
| `tlDecompose()` | Move a precomp's inner layers up into the current comp. Uses `AVLayer.copyToComp()` (AE 2022+); copied layers are parented to a new null that carries the precomp layer's `position/scale/rotation/opacity/startTime` so the visual result is preserved; original precomp layer removed. On AE < 2022 → `{ok:false,error:'Decompose needs After Effects 2022 or newer.'}`. Limitations flagged §11. | comp + exactly 1 layer whose `source` is a CompItem + AE ≥ 2022 |
| `tlIndependent()` | For each selected layer whose `source` is a CompItem: `source.duplicate()` then `layer.replaceSource(dup,false)`, so editing this instance no longer affects the other copies. | comp + ≥1 layer with a CompItem source |

`posIndex`/`num`/`stepFrames` arrive as strings (the `DCBridge` eval protocol stringifies
all args); each function coerces and validates (`parseInt`, finite, in range) and returns
`jerr` on bad input rather than throwing.

## 5. Pure geometry — new `panel/js/tools-core.js` (`DCToolsCore`)

A DOM-free, node-exported module (like `DCState`) holding the small testable functions,
mirrored host-side in `tools.jsx`. Kept separate from `DCState` (comp/asset state) for
feature cohesion and to keep `DCState` under the split threshold.

- `anchorFraction(posIndex)` → `[fx, fy]` with `fx,fy ∈ {0,.5,1}` for grid index `0..8`
  (row-major: 0=top-left … 8=bottom-right).
- `sequenceTimes(baseTime, count, stepFrames, frameDuration)` → array of start times
  (`baseTime + i*stepFrames*frameDuration`), with float results rounded to AE frame
  precision to avoid drift.
- `distributeCenters(sortedCenters)` → evenly spaced centers between the first and last
  (returns the interior coordinates; endpoints fixed).
- `alignTarget(mode, refBounds, layerRect)` → the position delta that snaps `layerRect`'s
  edge/center to `refBounds` for the given mode.

`tools.jsx` re-implements the same four in ES3; a parity test (§8) guards the mirror.

## 6. Panel side — new `panel/js/tools.js` (`DCTools`)

DOM controller (not node-tested). `ensureMounted()` wires the Tools view's buttons once;
subsequent tab switches are no-ops. Each control calls through the existing `DCBridge`
single-op lock so a tool can't fire while another op (or a library load) is mid-flight:

```
function run(label, fn, args) {
  if (!DCBridge.acquire(label)) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
  DCBridge.call(fn, args, function (result) {
    DCBridge.release();
    var r = DCBridge.parseJson(result);
    if (r && r.ok) DCUI.toast(successMsg(fn, r), false);
    else DCUI.toast((r && r.error) || result, true);
  });
}
```

- Anchor grid: 9 cells, each `run('anchor','tlSetAnchor',[index])`.
- Create buttons: `run('create','tlCreateLayer',[kind])`.
- Align row: 6 align buttons + distribute + reset, each a `run(...)`.
- Num/Step: two `<input type="number">`; Sequence button reads + clamps them
  (Num ≥ 1, Step integer; `DCToolsCore` validates) then `run('sequence','tlSequence',
  [num, step])`. Values are view-local (not persisted in v1; flagged §11).
- Pre-comp buttons: one `run(...)` each.

No favorites/search/sort/slider apply to Tools (those live in the hidden card toolbar).

## 7. Reliability (the "doesn't break" goal)

- **Atomic undo:** every op is one undo group → one Ctrl+Z fully reverts it.
- **Guarded:** no comp / no selection / wrong selection → a specific toast, never a silent
  no-op or a thrown ExtendScript error. Each guard message names what's needed
  ("Select at least one layer", "Select a single precomp layer", "Select 3+ layers to
  distribute", "Decompose needs After Effects 2022 or newer").
- **Serialized:** the `DCBridge` lock prevents overlapping host calls.
- **No partial state:** multi-layer ops (sequence, multi-precomp, independent) complete
  inside the single undo group; any thrown error ends the group and returns `jerr` so the
  user can undo cleanly.

## 8. Testing

`npm test` (node test runner, zero deps) for pure logic + static guards:

- `tools.core.test.js` — `anchorFraction` (all 9 indices), `sequenceTimes` (offsets,
  rounding, count), `distributeCenters` (even spacing, n<3 no-op), `alignTarget` (each
  mode vs comp and vs selection bounds).
- `tools.core.parity.test.js` — the four `DCToolsCore` functions match their `tools.jsx`
  ES3 mirrors (string/closed-form comparison, mirroring `safename.parity.test.js`).
- `jsx.exports.test.js` — generalized to assert every top-level fn in `tools.jsx` exports
  to `$.global`, and `loadHostModules` verifies the `tlCreateLayer` marker.
- `jsx.es3.test.js` — extended to cover `tools.jsx` (no `const`/`let`, arrows, template
  literals).
- `state.prefs.test.js` — `activeTab` default + merge of `'tools'`; stale-pref fallback.
- **Manual AE checklist** (appended to the plan; panel reload after symlinked-repo edits):
  anchor on a scaled layer (no visual jump), each creator at playhead, align to comp (1
  layer) vs selection (multi), distribute 3+, sequence multi + duplicate-one, precomp +
  open, multi-precomp index integrity, decompose visual match on AE 2022+ and the graceful
  message on older, independent un-shares one of two instances. Behavior-level tests for
  AE ops are manual (they need the AE host); pure geometry and ES3/export invariants are
  automated.

## 9. UI / CSS (`style.css`)

- `#app.tools-active` hides `#toolbar`,`#library`; shows `#tools`. Without it (default)
  the card view shows as today; the existing `#app.assets-active` still swaps comp/asset
  toolbar buttons within the card view.
- `#tools` is a scrollable column of cards reusing existing tokens (`--bg-raised`,
  `--bg-inset`, `--border`, `--gold`). New classes: `.tool-card`, `.anchor-grid`/
  `.anchor-cell(.on)`, `.tool-btn` (icon + label), `.tool-icon-btn`, `.tool-group-label`
  (small-caps, `--text-dim`). Icons are inline SVG matching the existing header/toolbar
  SVG style (24×24, `stroke=currentColor`), not an icon font.

## 10. File-size contract check (projected)

`tools.jsx` ~320 (< 800); `tools-core.js` ~70; `tools.js` ~190; `shell.js` 178 → ~205;
`state.js` ~177 (+ small pref change); `index.html` + ~35 (tab button + `#tools` markup);
`style.css` ~+70; `main.js` ~150 (+ tab wire). All < 400 except `tools.jsx` (< 800).
`hostscript.jsx` stays at 755 — new ops do **not** go there (its split-TODO is unrelated
and out of scope for this PR).

## 11. Decisions flagged for user review (defaults chosen to keep moving)

1. **Independent = un-share source** (duplicate a shared precomp's source for the selected
   instance). Confirmed in brainstorming.
2. **Reset button = recenter selected layers to comp center** (scale/rotation untouched).
   The reference icon was a circular arrow with no defined behavior; this is the most
   useful safe default. Alternatives: reset full transform, or reset the Num/Step fields.
3. **Sequence dual behavior:** ≥2 layers → sequence the selection; exactly 1 → duplicate
   it Num times, Step frames apart. Step is in **frames**.
4. **Decompose** requires **AE 2022+** (`copyToComp`); on older versions it shows a clear
   message instead of acting. Effects/masks/blend modes on the precomp layer are not
   transferred onto the carrier null (transform + timing are) — documented limitation.
5. **Anchor** compensates for scale; rotation and 3D layers are best-effort (the common
   2D, unrotated case is exact).
6. **Solid** = comp-sized, neutral gray, no Solid Settings dialog. **Null** does not
   auto-parent the selection. New layers start at the playhead (`comp.time`).
7. **Align reference** = selection bounds when 2+ layers are selected, else comp bounds.
8. Num/Step values are not persisted across panel reloads in v1.
