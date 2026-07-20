# Rail Position Setting — Design

**Date:** 2026-07-20
**Status:** Approved

## Problem

The nav rail is hard-coded to the panel's left edge (`#app` flex row, `#rail`
first). When the panel is docked on the right side of an AE workspace, the
rail sits on the content's workspace-facing side; users should be able to
move it to the right edge. There is no setting for this.

## Decision

### 1. Pref (`panel/js/state.js`)

- New pref `railSide: 'left' | 'right'`, default `'left'`, in
  `defaultPrefs()` (the `loadPrefs` copy loop then round-trips it for free).
- `normalizeRailSide(v)` returns `'right'` only for `'right'`, else
  `'left'` — same guard pattern as `normalizeFolderLayout`.

### 2. Shell (`panel/js/shell.js`)

- `applyRailSide()` toggles class `rail-right` on `els.app` from
  `DCState.normalizeRailSide(prefs.railSide)`; called from
  `applyPrefsToControls()` so init and cross-panel prefs broadcasts both
  apply it (no new sync wiring — `persistPrefs` already broadcasts and
  `onRemoteChange('prefs')` already re-applies controls).
- `onRailSideChange(side)`: normalize → store → `persistPrefs()` →
  `applyRailSide()` → sync the control's pressed state. Applies live while
  the Settings modal stays open.

### 3. CSS (`panel/css/style.css`)

All flipping is CSS on the `rail-right` class — no DOM moves, so `rail.js`
keyboard/ARIA behavior and DCDensity width measurement are untouched:

- `#app.rail-right { flex-direction: row-reverse; }`
- `#app.rail-right #rail` — divider flips: `border-right: none;
  border-left: 1px solid var(--border);`
- `#app.rail-right .rail-btn.active::after` — gold edge marker flips:
  `left: auto; right: 0;` with mirrored `border-radius: 1px 0 0 1px`.

Tooltips already clamp to the viewport (`DCTooltip.clampPosition`), so they
need no changes.

### 4. Settings modal control (`panel/index.html`, `panel/js/main.js`)

- New form-group "Rail position" in `#settings-modal`: a two-button
  segmented control (`#rail-side-switch`, buttons with `data-side="left"` /
  `data-side="right"` and `aria-pressed`), styled like the existing view
  switch.
- `main.js` registers the two buttons → `DCShell.onRailSideChange`, and the
  els map gains `railSideSwitch`.
- Standalone panels (`body.mode-*`) hide the rail entirely, so the form
  row is hidden there via the existing `body.mode-*` CSS pattern.

## Testing

- `tests/state.railside.test.js`: default is `'left'`; `normalizeRailSide`
  guards junk; saved value round-trips through `loadPrefs`/`savePrefs`.
- `tests/shell.railside.test.js` (existing DOM-stub shell test pattern):
  `applyPrefsToControls` sets/clears `rail-right` on `#app` per pref;
  `onRailSideChange` persists, applies, and normalizes junk input.
- `tests/rail-side-css.test.js` (existing CSS-contract pattern): the
  `row-reverse` rule, the border flip, and the active-marker flip exist
  under `#app.rail-right`; the settings row is hidden in standalone modes.

## Out of Scope

- Top/bottom rail placement, drag-to-dock.
- `panel/_harness.html` is a gitignored dev mirror in the main working
  tree; its matching markup edit happens there directly, not on this branch.
