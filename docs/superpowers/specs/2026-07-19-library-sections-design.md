# Library Sections (virtual client groups) — Design

Date: 2026-07-19
Status: Approved by Ziscol (brainstorming session)
Branch target: on top of `feature/nav-rail` line

## Problem

Comps made for a specific client are scattered across the Library's category
folders. Favorites are a single flat bucket, so "everything I built for
Client X" has to be remembered, not browsed. Ziscol wants named sections he
can jump between per client.

## Approved decisions

1. **Virtual links, not copies.** Adding a comp to a section does NOT
   duplicate the .aep. One comp on disk can appear in its home category and
   in any number of sections. Any edit shows everywhere (it is the same item).
2. **Pinned section groups.** Sections render like normal category sections
   but pinned above them in the same scrollable Library list. No new
   navigation surface. Keep friction at zero.
3. **Membership persists in the library folder** (not localStorage), so
   sections survive extension updates/reinstalls and travel with the library
   directory.

## Data model

New sidecar file at the library root, next to `.dropcomp_index.json`:

```
<libraryPath>/.dropcomp_sections.json
```

```json
{
  "version": 1,
  "sections": {
    "Client X": ["step_animation_1720900000000", "logo_pop_1720900011111"]
  }
}
```

- Keys are section display names; values are arrays of comp `uniqueId`s.
- Sections render alphabetically; items inside a section obey the active
  Library sort (`prefs.sort`), same as category groups.
- Read/write from the panel via Node `fs` (same mechanism `updater-fs.js`
  already uses). No ExtendScript round-trip.
- **Corruption guard:** if the file exists but fails to parse, rename it to
  `.dropcomp_sections.corrupt-<timestamp>.json`, start with an empty model,
  and toast a warning. Never silently overwrite a user's unparseable file.
- Concurrent writes from two panels are theoretically possible but mutations
  are user-driven one panel at a time, and every mutation broadcasts a
  reload (DCSync), so divergence windows are negligible. Accepted risk.

## UI behavior

### Adding
- Library comp cards (grid and list rows) get one new icon button in the
  existing `card-actions` row in `render.js` (alongside favorite / rename /
  setThumb / reveal / delete): **"Add to Section…"** (bookmark/tag icon).
- Clicking it opens the existing category modal pattern
  (`DCUI.openCategoryModal`) with a new mode `'section'`: pick an existing
  section or type a new name. Typing a name that already exists simply adds
  to that section. Creating a section happens implicitly here — there is no
  separate "new section" button.
- Section names validate through `DCValidate.validateName`. Adding an item
  already in the section is a no-op with a friendly toast.

### Rendering
- Section groups are prepended (pinned) above category groups in
  `DCLibrary.rerender()`. Headers show a small pin/tag badge to distinguish
  them from category folders.
- Groups carry `virtual: true` through to `DCRender`; virtual section DOM
  uses `data-section="<name>"` instead of `data-category` so the existing
  drag-to-move logic (`canDropOn` checks `dataset.category`) never treats a
  virtual section as a move target. Dragging cards onto sections is out of
  scope for v1.
- Collapse/expand reuses `prefs.collapsed` with a `sec:` key prefix
  (`sec:Client X`) so a section and a category sharing a name cannot clash.
- Search and the Favorites toggle filter section contents exactly like
  category contents.
- **Empty sections:** rendered with a "No items" hint when no search/filter
  is active (the user made them deliberately; they must stay visible and
  manageable). While a search or Favorites filter is active, empty sections
  are hidden as noise.

### Inside a section
- Cards in a virtual section swap the bookmark button for
  **"Remove from Section"** — removes the link only; the comp and its home
  category are untouched. All other card actions (import, favorite, rename,
  thumbnail, reveal, delete) behave identically to the home card.

### Section headers
- Rename (reuses the shared rename modal; renaming to an existing section
  name errors with a toast) and Delete (removes the grouping only — never
  touches comps; confirm via the existing delete modal pattern).

## Lifecycle & consistency

- **Comp deleted** (`confirmDelete` success): the id is removed from every
  section, mirroring how usage metadata is handled.
- **Comp renamed** (`confirmRename` success): rename changes `uniqueId`;
  migrate the id in all sections exactly like
  `DCState.migrateMetadataKey` does for usage metadata.
- **Load-time prune:** on library load, section entries whose `uniqueId` is
  no longer in the index are dropped (mirrors `cleanupStaleMetadata`).
  Persist only if something was actually pruned.
- **Multi-panel:** every section mutation broadcasts `DCSync.broadcast('library')`;
  `DCLibrary.load()` re-reads `.dropcomp_sections.json` alongside the index,
  so other open panels converge on the next paint.

## Module design

- New `panel/js/sections.js` (`DCSections`) — target well under 400 lines:
  - Pure core (unit-testable, no I/O): `parse(raw)`, `serialize(model)`,
    `add(model, name, id)`, `remove(model, name, id)`, `removeEverywhere(model, id)`,
    `renameSection(model, old, next)`, `deleteSection(model, name)`,
    `migrateId(model, oldId, newId)`, `prune(model, validIds)`,
    `buildGroups(model, compsById, sortFn)`, `collapseKey(name)`.
  - Thin fs shim: `load(libPath)`, `save(libPath, model)` with the
    corruption guard above.
- Wiring (small diffs, no new concepts):
  - `library.js`: load/prune on `load()`, mutation entry points, card action
    routing (`addToSection`, `removeFromSection`), section header actions.
  - `render.js`: virtual group rendering, badge, `data-section`, swapped
    card action.
  - `ui.js` / `main.js` / `index.html` + `_harness.html`: `'section'` mode for
    the category modal, new icon, event wiring (mirror to harness like the
    nav-rail work did).

## Error handling

- Missing/unreadable sections file → empty model, feature simply dormant.
- Write failure → error toast, in-memory state kept so the user can retry.
- All mutations follow the existing `DCBridge.acquire`/`release` + spinner
  discipline only where a host call is involved; pure JSON writes need no
  bridge lock (they don't touch ExtendScript), just the DCSync broadcast.

## Testing

Node test suite (existing runner, flat files in `tests/`):

- `tests/sections.test.js` — pure core: parse fallback + corruption verdict,
  add/remove/no-op semantics, removeEverywhere, renameSection collision,
  deleteSection, migrateId, prune, buildGroups ordering (alphabetical
  sections, sorted items, virtual flag), collapse key prefixing.
- `tests/render.sections.test.js` — virtual group DOM: `data-section` (not
  `data-category`), badge presence, swapped card action, empty-section hint
  visibility rule.
- Update `library-card-actions-css.test.js` and panel wiring tests if their
  selectors/regexes are affected.
- Manual AE checklist addition: create section, add comp, see it in two
  places, import from the section, remove link, delete comp clears the link,
  second panel converges after mutation.

## Out of scope (v1)

- Drag-a-card-onto-a-section to add (drag currently means *move*;
  overloading it invites mistakes).
- Client filter chips/dropdown.
- Physical duplicate-to-folder copies (explicitly rejected).
- Section membership for Assets-tab items (comps only for now).
