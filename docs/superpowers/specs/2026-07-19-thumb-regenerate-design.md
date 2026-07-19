# Regenerate Thumbnail + Full-Resolution Capture — Design

**Date:** 2026-07-19
**Status:** Approved

## Problem

Updating an existing comp's thumbnail requires either importing the comp and
using the camera action, or deleting `comp.png` in Finder to surface the
Generate chip. There is no one-click background regenerate. Separately, both
capture paths honor the comp's resolution setting (`saveFrameToPng` respects
`resolutionFactor`), which produced 14 half/third-resolution thumbnails in the
live library. List-view rows have no generate affordance at all.

## Decision

### 1. Regenerate hover action (panel)

- New `ICONS.refresh` icon (feather-style rotate arrow, stroke like existing
  icons) in `panel/js/icons.js`.
- `buildCard` (grid) and `buildRow` (list) in `panel/js/render.js`: add
  `iconBtn('generate', 'Regenerate thumbnail', ICONS.refresh)` to the actions
  row for comp cards only (not assets), immediately before the camera
  (`setThumb`) button. Unconditional: with an existing thumb it regenerates;
  without one it routes identically to the Generate chip (grid keeps the
  chip; list rows gain their first generate affordance).
- No new dispatch or ExtendScript wiring: `onCardAction` already routes
  `'generate'` → `generateThumb()` (busy-guard, spinner, cache-bust, toast,
  multi-panel broadcast), and `generateThumbForItem` already replaces an
  existing `comp.png`.

### 2. Full-resolution capture (jsx)

- `saveVerifiedThumb` (`jsx/hostscript.jsx`): record `comp.resolutionFactor`,
  set `[1, 1]`, run the existing capture loop, restore the original value in
  a `finally`. Covers auto-generate, AEP import capture, the stash flow
  (which captures the user's live comp before `app.project.save()` — restore
  is mandatory there), and shape sidecars.
- `setThumbFromActiveComp` (`jsx/import-capture.jsx`): same record/force/
  restore around its direct `saveFrameToPng(comp.time, png)` call. The
  user-chosen frame time is unchanged.
- Both sites wrap the `resolutionFactor` assignment in `try` so a host that
  refuses the set degrades to capturing at current resolution instead of
  failing the operation.

## Testing

- `tests/thumb-capture.test.js` (existing vm fake-AE harness): fake comp
  gains `resolutionFactor`; assert it is `[1, 1]` during every
  `saveFrameToPng` call and restored afterward, on success and on simulated
  write failure. Same assertions for the `setThumbFromActiveComp` path.
- New render test (existing `render.*.test.js` pattern): comp cards in grid
  and list include a `[data-action="generate"]` button titled "Regenerate
  thumbnail"; asset cards include none.
- `tests/jsx.es3.test.js` lints the new ExtendScript automatically.

## Out of Scope

Bulk regenerate (per-folder / all-flagged) — deferred by user choice.
