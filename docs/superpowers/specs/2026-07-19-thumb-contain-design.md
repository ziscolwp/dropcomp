# Whole-Graphic Library Thumbnails — Design

**Date:** 2026-07-19
**Status:** Approved

## Problem

Library card thumbnails live in a fixed 16:9 box (`.card-thumb`, `panel/css/style.css`)
whose `img` uses `object-fit: cover`. Comps that are not 16:9 — near-square UI cards
(482×403), banners (816×220), wide counters (857×348) — get zoom-cropped, so the
card shows only the center of the graphic. The saved PNGs are not the problem:
`comp.saveFrameToPng()` captures the entire comp frame at comp resolution, so every
existing thumbnail already contains the full graphic.

## Decision

Display-side fix only, chosen over blurred-fill letterboxing and true-aspect
(masonry) cards for simplicity and grid uniformity:

1. `.card-thumb img`: `object-fit: cover` → `contain`.
   - 16:9 comps fill the 16:9 box exactly as before — zero visual change.
   - Non-16:9 comps letterbox over the existing `--bg-inset` dark background.
   - No padding (the separate `.card--asset .card-thumb img` contain+10px rule
     is untouched).
2. List view (`#library.view-list .card--row .card-thumb img`): same
   `cover` → `contain` so the 52px mini-thumbs show the whole graphic too.
3. No ExtendScript / capture changes. No thumbnail regeneration needed —
   existing libraries benefit immediately.

## Testing

CSS contract test in the existing `tests/style.test.js` pattern (read
`style.css`, assert declarations): both selectors above must declare
`object-fit: contain`. TDD: assert first (fails against `cover`), then flip
the CSS.

## Risk

Minimal — identical technique already shipped for asset cards. Ultra-wide
comps render smaller inside the box; accepted trade-off.
