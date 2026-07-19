# Category Picker Redesign — Design

**Date:** 2026-07-19
**Branch:** `feature/category-picker` (worktree `dropcomp-catpicker`, based on `feature/nav-rail`)
**Status:** Approved by Ziscol

## Problem

The shared category modal (`#category-modal` in `panel/index.html`) uses a native
`<select>` for "Existing category" plus a separate "Or create new" text input. The
native select renders the OS dropdown, which looks out of place in the dark CEP
panel, overflows the modal, offers no search, and scales poorly — the category
list (client names) is already 13+ entries. The two-field pattern also splits one
decision ("which category?") across two controls, with a non-obvious precedence
rule (text input wins).

The modal is shared by five flows:

| Caller | Mode | Title |
|---|---|---|
| `library.js:107` | `stash` | Add Composition |
| `library.js:117` | `addAep` | Add AE Project to Library |
| `assets.js:177,206` | `addAssets` | Add Assets |
| `assets.js:218` | `addAssets` | Add Selected Image |
| `assets.js:230` | `addShape` | Save Shape to Assets |

All five get the new picker.

## UX / Behavior

One labeled **Category** field replaces both controls:

- A text input with a filtered list **always visible** below it (command-palette
  style). The list has `max-height` ≈ 160px and scrolls internally; nothing ever
  renders outside the modal.
- On open: input focused and empty. List shows up to 4 **Recent** categories
  under a subtle "Recent" divider, then all remaining categories A–Z (recents are
  not duplicated in the A–Z section).
- Typing filters case-insensitively (substring match) across all categories.
- When the input text has no exact case-insensitive match, a pinned
  **＋ Create "«text»"** row appears at the bottom of the list.
- Exactly one row is highlighted at all times (first row by default; the Create
  row if it is the only row). ↑/↓ move the highlight; Enter or the **Add** button
  confirms the highlighted row; single click selects a row; double-click
  confirms it.
- Empty library: list area shows the hint "No categories yet — type a name to
  create one." (replaces the old disabled "No existing categories" select state).
- Esc / Cancel close the modal exactly as today.
- Validation is unchanged and stays in `shell.js` `confirmCategoryModal`:
  `DCValidate.validateName` plus the reserved "Assets" rule for library flows.

## Architecture

New module **`panel/js/category-picker.js`** exposing `DCCategoryPicker`
(module pattern, mirrors `rail.js` / `tooltip.js`; CommonJS export guard for
tests):

- `init(els, hooks)` — bind elements and callbacks. `hooks.onConfirm` is wired
  to `DCShell.confirmCategoryModal` in `main.js`; `hooks.getRecents(scope)`
  returns the recent list from prefs (provided by `DCShell`, which owns prefs —
  `ui.js` never touches them). Handles input, keyboard, and click/double-click
  events.
- `open(categories, scope)` — fetch recents via `hooks.getRecents(scope)`,
  render rows, clear input, focus it. `ui.js` maps mode → scope
  (`stash`/`addAep` → `'library'`, else `'assets'`).
- `value()` — the committed choice: the highlighted existing category name, or
  the trimmed input text when the Create row is highlighted. Returns `''` when
  there is nothing to choose.
- `buildRows(categories, recents, query)` — **pure function** returning the row
  model (`[{type: 'recent-header'|'category'|'divider'|'create', name}]`);
  all ordering/filter/create logic lives here so it unit-tests without DOM.

Integration changes:

- `ui.js` `openCategoryModal(mode, title, categories)` delegates rendering to
  `DCCategoryPicker.open(categories, scope)`. `catMode` handling is unchanged.
- `shell.js` `confirmCategoryModal` reads `DCCategoryPicker.value()` instead of
  merging two fields; on successful confirm it records the category as recent.
- `index.html` / `_harness.html`: replace the two `.form-group`s with the new
  markup (input `#category-picker-input`, list `#category-picker-list`) and add
  the `category-picker.js` script tag immediately before `ui.js` in the script
  list. `main.js` element map gains the new ids and drops
  `existing-category-select` / `new-category-input`.
- CSS: new rules in the panel stylesheet — dark-theme list, hover state, gold
  accent (existing accent variable) for the highlighted row, muted "Recent"
  header/divider, distinct Create row with the ＋ glyph.

## Recents Data

- `state.js` `defaultPrefs` gains `recentCategories: { library: [], assets: [] }`
  (whitelisted so `loadPrefs` merges it).
- Scope: `stash`/`addAep` → `library`; `addAssets`/`addShape` → `assets` —
  the two flows have different category sets on disk.
- On successful confirm: unshift the chosen name into its scope, case-insensitive
  dedupe, cap at 4, `savePrefs` (existing try/catch swallows storage failures).
- At open time, recents not present in the current `categories` array are
  filtered out (stale folders disappear silently; prefs are not rewritten).

## Error Handling

No new error paths. Validation errors keep surfacing via `DCUI.toast`. Storage
failures are already swallowed by `savePrefs`. An empty `value()` fails
`validateName` and toasts, same as an empty text input today.

## Testing

- New `tests/category-picker.test.js`:
  - `buildRows`: recents-first ordering, A–Z remainder, no duplication,
    case-insensitive filtering, create-row present iff no exact match,
    create-row suppressed on exact match (any case), empty-categories state,
    stale-recent exclusion.
  - Recents recording: unshift/dedupe/cap-4 behavior.
  - Wiring assertions in the existing suite's style (ids present in
    `index.html` and `_harness.html`, script tag order, old ids gone).
- Update existing tests referencing `existing-category-select` /
  `new-category-input`.
- Entire suite (383 tests + new) must pass via the repo's `npm test`.
- Manual AE click-test checklist (post-merge): each of the five flows opens the
  picker, filter works, create works, recents float up, keyboard nav works.

## Out of Scope

- Restyling the rest of the modal chrome (buttons, title) beyond what the new
  field needs — the broader 3.0 Figma redesign owns that.
- Category management (rename/delete from within the picker).
- Recents syncing across machines.
