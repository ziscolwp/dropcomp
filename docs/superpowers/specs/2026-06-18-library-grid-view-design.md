# Library / Assets View Switch (3-way) — Design Spec

**Date:** 2026-06-18
**Branch:** `feature/library-grid-view`
**Status:** Approved — ready for implementation plan

## Problem

Browsing large collections in the Library and Assets tabs is awkward. Both tabs
already render a responsive CSS grid driven by a thumbnail-size slider
(`#thumb-slider`, 90–240 → `--thumb-min`), but the comfortable default shows only
2–3 columns at the 400px panel width, so scanning hundreds of items means a lot of
scrolling. An earlier build had an explicit view choice (a now-removed
`dropcomp_view: 'list'` pref, still stripped by `loadPrefs`); users remember that
flexibility and want it back — and better.

## Goal

Add a **3-way view switch** — **Comfortable grid / Dense grid / List** — to the
Library and Assets tabs, remembered **per tab**, so users can pick the density that
suits how they browse comps vs assets.

Non-goals: virtualization (only if measurement proves it necessary), changes to the
Scripts/Tools tabs, any version bump, any change to the header / update-chip / modal
regions (owned by the parallel self-updater branch).

## Decisions (confirmed with user)

| Question | Decision |
|---|---|
| What "grid view" means | 3-way switch: Comfortable / Dense / List |
| Scope | Library **and** Assets (they share `#library` + `DCRender`) |
| Control location | Segmented control (3 icon buttons) in the toolbar |
| Persistence | **Per tab** — separate pref for Library and Assets |
| Slider in Dense/List | **Hidden** (size is meaningless/self-defined; no dead controls) |
| Dense text | **Hidden** — contact-sheet feel |
| Default | **Comfortable** — no visible change until the user opts in |

## Architecture

CSS-driven modes plus one new row builder. `viewMode` toggles a class on the
`#library` container; Comfortable and Dense are expressed almost entirely in CSS
over the existing card DOM, and only List introduces new markup.

### 1. State / prefs (`panel/js/state.js`)

`defaultPrefs()` gains two keys, mirroring the existing `collapsed` /
`collapsedAssets` per-tab pattern:

```js
viewMode: 'comfortable',        // Library tab
viewModeAssets: 'comfortable',  // Assets tab
```

New pure, unit-tested helpers (exported on `DCState`):

- `normalizeViewMode(v)` → returns `v` if it is one of the known modes, else
  `'comfortable'`. Guards against corrupt/old stored values reaching the DOM.
- `viewClass(v)` → `'view-comfortable' | 'view-compact' | 'view-list'`
  (runs input through `normalizeViewMode` first).
- `VIEW_MODES` → `['comfortable', 'compact', 'list']` (single source of truth).

Note: internal mode id for Dense is `'compact'` (keeps CSS class names short and
matches the existing `grid--s/m/l` density vocabulary); the UI label is "Dense".

Legacy migration: the existing `loadPrefs` legacy branch (only runs when no
`dropcomp_prefs` exists yet) already removes `dropcomp_view`. Before removing it,
map `dropcomp_view === 'list'` → `prefs.viewMode = 'list'`, literally restoring the
old list preference for anyone who set it long ago. `viewModeAssets` stays default.

`loadPrefs` already merges only known keys over defaults and ignores unknown saved
keys, so the new keys round-trip for free; values are normalized at apply time in
the shell.

### 2. The control (`panel/index.html`, toolbar region only)

A segmented control added to `#toolbar` **row 2, right-aligned, immediately before
`#thumb-slider`** — grouping all "how it looks" controls together and away from the
crowded top row:

```html
<div id="view-switch" class="seg" role="group" aria-label="View">
  <button class="seg-btn" data-view="comfortable" data-tip="Comfortable grid"
          aria-label="Comfortable grid" aria-pressed="true">…grid icon…</button>
  <button class="seg-btn" data-view="compact" data-tip="Dense grid"
          aria-label="Dense grid" aria-pressed="false">…dense icon…</button>
  <button class="seg-btn" data-view="list" data-tip="List"
          aria-label="List" aria-pressed="false">…list icon…</button>
</div>
```

Icons are inline 24×24 stroke SVGs (consistent with the existing sort/favorites/
display buttons, which use inline SVG): a 2×2 grid, a denser 3×3 grid, and stacked
list rows.

### 3. The three modes (CSS, `panel/css/style.css`, grid/list region only)

`#library` carries exactly one of `view-comfortable` / `view-compact` /
`view-list`. The existing `grid--s/m/l` classes (slider-derived) keep applying and
remain meaningful only in Comfortable.

| Mode | Container | Cells | Slider | Text |
|---|---|---|---|---|
| Comfortable | `.grid` | `minmax(var(--thumb-min), 1fr)` (today) | visible & active | per Show names / Show info |
| Dense | `.grid` | `#library.view-compact .grid` overrides to `minmax(~72px, 1fr)`, tighter gap, hover chrome hidden | hidden | `.card-info` hidden via CSS |
| List | `.list` | flex column of `.card.card--row` | hidden | always shown |

Dense never mutates `thumbMin` — it overrides the grid template in CSS, so returning
to Comfortable preserves the user's slider size.

List row layout: small fixed thumb (or ext-badge for non-renderable assets) on the
left, name + meta in the middle, inline action buttons on the right. Reuses the
existing card-action button visual language.

### 4. Rendering (`panel/js/render.js`)

`buildSection(group, prefs, usageMeta, busts, kind, viewMode)` gains the effective
`viewMode` argument:

- `viewMode === 'list'` → container is `el('div', 'list')`, children built by new
  `buildRow(item, usage, prefs, kind, bust)`.
- otherwise → container is `el('div', 'grid')`, children built by the existing
  `buildCard` / `buildAssetCard` (Dense is handled purely by CSS).

`render(...)` passes `viewMode` through to `buildSection`.

`buildRow(item, usage, prefs, kind, bust)`:
- root `el('article', 'card card--row' + (usage.isFavorite ? ' has-fav' : ''))`
  with `dataset.uniqueId` / `dataset.category` and the same title — **keeping the
  `.card` class means main.js's existing delegation and dblclick-to-import work
  with zero changes**.
- branches on `kind` for comp-vs-asset thumbnail, meta line
  (`formatMetaLine` vs `formatAssetMetaLine`), and action set (comps get
  `setThumb` + `generate`; assets do not), mirroring the two card builders.

### 5. Shell wiring (`panel/js/shell.js`)

- `viewKey()` → returns `'viewModeAssets'` when the active tab is Assets, else
  `'viewMode'`.
- `currentViewMode()` → `DCState.normalizeViewMode(prefs[viewKey()])`.
- `applyView()` → sets the single `view-*` class on `#library` (via
  `DCState.viewClass`), toggles `#thumb-slider` visibility (hidden unless
  Comfortable), and syncs `aria-pressed` + an `active` class on the three segments.
- `onViewChange(mode)` → ignore on Tools/Scripts tabs; set `prefs[viewKey()]`,
  persist, `applyView()`, `activeModule().rerender()`.
- `applyPrefsToControls()` and `setActiveTab()` both call `applyView()` so booting
  and switching Library⇄Assets reflect each tab's own remembered mode.
- The render call sites in `library.js` / `assets.js` pass `currentViewMode()`
  through to `DCRender.render`. (Minimal change — `library.js` is near the 400-line
  limit, so the logic lives in shell/render, not there.)

### 6. Event binding (`panel/js/main.js`)

- Add `viewSwitch: $('view-switch')` to the `els` map.
- One delegated listener: clicks within `#view-switch` resolve
  `closest('[data-view]')` and call `DCShell.onViewChange(btn.dataset.view)`.

## Data flow

```
user clicks a segment
  → main.js delegated handler reads data-view
  → DCShell.onViewChange(mode)
      → prefs[viewKey()] = mode
      → DCState.savePrefs(localStorage, prefs)   // dropcomp_prefs
      → applyView()                              // #library class, slider vis, aria
      → activeModule().rerender()
          → DCRender.render(..., currentViewMode())
              → buildSection picks .grid+cards or .list+rows
tab switch (Library⇄Assets)
  → DCShell.setActiveTab → applyView() reflects that tab's own viewMode
```

## Error / edge handling

- Corrupt or unknown stored `viewMode` → `normalizeViewMode` clamps to
  `comfortable` (never breaks layout).
- Empty collection → existing placeholder path is unchanged (render returns early
  before building any container).
- Rapid mode switching → each `onViewChange` is an idempotent class swap +
  rerender; no async, no locks needed.
- List mode + asset with no renderable thumbnail → ext-badge, same as the grid card.

## Performance

The current renderer paints all cards into the DOM (no windowing); images are
`loading="lazy"`. Dense reduces per-card chrome and List rows are simpler than
cards, so neither increases node cost materially. Plan: regenerate
`panel/_harness.html` with a large mock set (~600 items across categories), then
measure initial render and scroll smoothness in all three modes. **Only** if a mode
janks will virtualization be reconsidered (separate follow-up; out of scope here).

## Files touched

| File | Change | Notes |
|---|---|---|
| `panel/js/state.js` | +2 prefs, +3 helpers, +legacy map | 185 → ~210 |
| `panel/js/render.js` | +`buildRow`, `buildSection` viewMode branch | 180 → ~225 |
| `panel/js/shell.js` | +`viewKey`/`currentViewMode`/`applyView`/`onViewChange`, hooks | 196 → ~225 |
| `panel/js/library.js` | pass `currentViewMode()` to render | minimal (near 400 limit) |
| `panel/js/assets.js` | pass `currentViewMode()` to render | minimal |
| `panel/js/main.js` | +els ref, +delegated listener | small |
| `panel/index.html` | segmented control in toolbar row 2 | toolbar region only |
| `panel/css/style.css` | `.seg`, `view-compact`, `view-list`, `.card--row` | grid/list region only |

All files remain < 400 lines.

## Test plan

Unit (`node --test`, `tests/state.*.test.js`):
- `defaultPrefs` shape includes `viewMode` + `viewModeAssets` = `'comfortable'`.
- `normalizeViewMode`: passes valid modes; clamps unknown/`undefined`/`null` →
  `'comfortable'`.
- `viewClass`: maps each mode → correct class; junk → `view-comfortable`.
- per-tab save/load roundtrip (set `viewModeAssets='list'`, reload, assert).
- legacy `dropcomp_view: 'list'` → `viewMode === 'list'`, old key removed.

UI (`panel/_harness.html` + mock CEP bridge):
- Regenerate harness from `panel/index.html` (gitignored / may be stale).
- Seed ~600 mock items; screenshot Comfortable, Dense, List for both tabs.
- Verify slider hides in Dense/List, segmented `aria-pressed` tracks state,
  per-tab memory survives a tab switch, and layout is correct within 400px.

## Risks / mitigations

- **Shared files with the parallel branch** (`index.html`, `style.css`): edits are
  confined to the toolbar/display region and the grid/list CSS block; expect a
  rebase at merge. No edits to header/update-chip/modals.
- **`library.js` near 400 lines**: keep new logic in shell/render; library.js only
  forwards `currentViewMode()`.
- **main.js delegation**: list rows keep the `.card` class, so no delegation/
  dblclick changes — lowest-risk integration point.
