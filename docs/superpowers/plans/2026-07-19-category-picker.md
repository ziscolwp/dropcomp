# Category Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the category modal's native `<select>` + "Or create new" text input with a single command-palette-style picker: one input, an always-visible filtered list, recents on top, and a pinned Create row.

**Architecture:** New `DCCategoryPicker` module (vanilla JS module pattern like `rail.js`) owns the input + list. All ordering/filter logic lives in pure functions so it unit-tests without DOM. `ui.js` delegates rendering; `shell.js` reads one value and records recents into prefs via new pure helpers in `state.js`.

**Tech Stack:** Vanilla ES5-style JS (CEP 8 Chromium — no arrow functions, no template literals, no `let`/`const` in panel code), `node --test` + regex-over-file tests, plain CSS with existing custom properties.

**Spec:** `docs/superpowers/specs/2026-07-19-category-picker-design.md`

## Global Constraints

- Work happens in worktree `/Users/ziscol/Ziscol Media Projects/dropcomp-catpicker` on branch `feature/category-picker`. Never touch the main working tree (another session owns it).
- Panel JS is ES5-flavored: `var`, `function () {}`, string concat. Test files use modern JS (`const`, arrows) — match `tests/rail.test.js`.
- Every module ends with the CommonJS guard: `if (typeof module !== 'undefined' && module.exports) { module.exports = DCX; }`
- Run tests with `npm test` from the worktree root. The full suite (383 tests) must stay green after every task.
- All list rendering uses `textContent` / `document.createElement` — category names are user data, never `innerHTML` them.
- Commit messages: conventional prefixes (`feat(panel): …`, `test: …`), imperative mood, and end with the Claude co-author trailer.
- `panel/_harness.html` is gitignored and does not exist in this worktree — do NOT try to edit it. Mirroring the modal markup there is an integration-time step in the main tree (noted in Task 5).
- The global `keydown` handler in `main.js:150-156` already routes Enter → `DCShell.confirmCategoryModal` while the category modal is open. The picker must NOT add its own Enter handling (it would double-confirm).

---

### Task 1: Pure row-model logic (`buildRows` + highlight helpers)

**Files:**
- Create: `panel/js/category-picker.js` (pure functions only in this task)
- Create: `tests/category-picker.test.js`

**Interfaces:**
- Produces: `DCCategoryPicker.buildRows(categories, recents, query)` → array of row objects:
  - `{ type: 'recent-header' }`, `{ type: 'category', name: 'X', recent: true|false }`, `{ type: 'divider' }`, `{ type: 'create', name: '<trimmed query>' }`, `{ type: 'empty' }`
- Produces: `DCCategoryPicker.selectableIndices(rows)` → array of indices of rows with type `'category'` or `'create'`
- Produces: `DCCategoryPicker.moveHighlight(current, delta, count)` → clamped index (no wrap), returns 0 for count > 0 with current -1, returns -1 when count is 0

Row-model rules (from spec):
- Empty query, recents present: recent-header, then recents (in stored order, filtered to names present in `categories`), then divider, then remaining categories A–Z (`localeCompare`), recents not duplicated.
- Empty query, no recents: categories A–Z only (no header/divider).
- Non-empty query: no recent grouping — all categories whose name contains the query case-insensitively, A–Z. Create row appended iff the trimmed query has no exact case-insensitive match in `categories`.
- Empty query never shows a Create row.
- `categories` empty and query empty: single `{ type: 'empty' }` row.
- `categories` empty and query non-empty: just the Create row.

- [ ] **Step 1: Write the failing tests**

Create `tests/category-picker.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const DCCategoryPicker = require('../panel/js/category-picker.js');

const CATS = ['Alex Beck', 'CJ Webber', 'Mark Mei', 'Morgan ( MAX )', 'Parker'];

// ---- buildRows: empty query ----

test('empty query with no recents lists all categories A-Z', () => {
  const rows = DCCategoryPicker.buildRows(['Parker', 'Alex Beck', 'Mark Mei'], [], '');
  assert.deepEqual(rows, [
    { type: 'category', name: 'Alex Beck', recent: false },
    { type: 'category', name: 'Mark Mei', recent: false },
    { type: 'category', name: 'Parker', recent: false },
  ]);
});

test('empty query floats recents on top under a header, no duplicates', () => {
  const rows = DCCategoryPicker.buildRows(CATS, ['Mark Mei', 'Parker'], '');
  assert.deepEqual(rows, [
    { type: 'recent-header' },
    { type: 'category', name: 'Mark Mei', recent: true },
    { type: 'category', name: 'Parker', recent: true },
    { type: 'divider' },
    { type: 'category', name: 'Alex Beck', recent: false },
    { type: 'category', name: 'CJ Webber', recent: false },
    { type: 'category', name: 'Morgan ( MAX )', recent: false },
  ]);
});

test('recents pointing at deleted categories are dropped', () => {
  const rows = DCCategoryPicker.buildRows(CATS, ['Ghost Client', 'Mark Mei'], '');
  const recentNames = rows.filter((r) => r.recent).map((r) => r.name);
  assert.deepEqual(recentNames, ['Mark Mei']);
});

test('all recents stale means no header and no divider', () => {
  const rows = DCCategoryPicker.buildRows(CATS, ['Ghost Client'], '');
  assert.ok(!rows.some((r) => r.type === 'recent-header'));
  assert.ok(!rows.some((r) => r.type === 'divider'));
});

test('empty query never offers a create row', () => {
  const rows = DCCategoryPicker.buildRows(CATS, [], '');
  assert.ok(!rows.some((r) => r.type === 'create'));
});

// ---- buildRows: filtering ----

test('typing filters case-insensitively by substring, A-Z, no recent grouping', () => {
  const rows = DCCategoryPicker.buildRows(CATS, ['Parker'], 'mA');
  assert.deepEqual(rows, [
    { type: 'category', name: 'Mark Mei', recent: false },
    { type: 'category', name: 'Morgan ( MAX )', recent: false },
    { type: 'create', name: 'mA' },
  ]);
});

test('create row is suppressed on an exact case-insensitive match', () => {
  const rows = DCCategoryPicker.buildRows(CATS, [], 'mark mei');
  assert.ok(!rows.some((r) => r.type === 'create'));
  assert.deepEqual(rows, [{ type: 'category', name: 'Mark Mei', recent: false }]);
});

test('no matches leaves only the create row', () => {
  const rows = DCCategoryPicker.buildRows(CATS, [], 'zzz');
  assert.deepEqual(rows, [{ type: 'create', name: 'zzz' }]);
});

test('create row trims the query', () => {
  const rows = DCCategoryPicker.buildRows(CATS, [], '  New Client  ');
  const create = rows.find((r) => r.type === 'create');
  assert.equal(create.name, 'New Client');
});

test('whitespace-only query behaves like an empty query', () => {
  const rows = DCCategoryPicker.buildRows(CATS, [], '   ');
  assert.ok(!rows.some((r) => r.type === 'create'));
  assert.equal(rows.filter((r) => r.type === 'category').length, CATS.length);
});

// ---- buildRows: empty library ----

test('no categories and no query shows the empty hint row', () => {
  assert.deepEqual(DCCategoryPicker.buildRows([], [], ''), [{ type: 'empty' }]);
});

test('no categories with a query shows just the create row', () => {
  assert.deepEqual(DCCategoryPicker.buildRows([], [], 'Titles'),
    [{ type: 'create', name: 'Titles' }]);
});

// ---- selectableIndices / moveHighlight ----

test('selectableIndices skips headers, dividers, and the empty row', () => {
  const rows = DCCategoryPicker.buildRows(CATS, ['Mark Mei'], '');
  const sel = DCCategoryPicker.selectableIndices(rows);
  sel.forEach((i) => {
    assert.ok(rows[i].type === 'category' || rows[i].type === 'create');
  });
  assert.equal(sel.length, CATS.length); // no duplicates
  assert.equal(DCCategoryPicker.selectableIndices([{ type: 'empty' }]).length, 0);
});

test('moveHighlight clamps at both ends and handles empty lists', () => {
  assert.equal(DCCategoryPicker.moveHighlight(0, -1, 3), 0);
  assert.equal(DCCategoryPicker.moveHighlight(2, 1, 3), 2);
  assert.equal(DCCategoryPicker.moveHighlight(0, 1, 3), 1);
  assert.equal(DCCategoryPicker.moveHighlight(-1, 1, 3), 0);
  assert.equal(DCCategoryPicker.moveHighlight(0, 1, 0), -1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/category-picker.test.js` (from the worktree root)
Expected: FAIL — `Cannot find module '../panel/js/category-picker.js'`.

- [ ] **Step 3: Implement the pure functions**

Create `panel/js/category-picker.js`:

```js
var DCCategoryPicker = (function () {
  'use strict';

  function sortAZ(names) {
    return names.slice().sort(function (a, b) { return a.localeCompare(b); });
  }

  function buildRows(categories, recents, query) {
    var q = String(query || '').trim();
    var rows = [];
    if (q === '') {
      var live = (recents || []).filter(function (r) { return categories.indexOf(r) !== -1; });
      if (categories.length === 0) return [{ type: 'empty' }];
      if (live.length > 0) {
        rows.push({ type: 'recent-header' });
        live.forEach(function (name) { rows.push({ type: 'category', name: name, recent: true }); });
        rows.push({ type: 'divider' });
      }
      sortAZ(categories).forEach(function (name) {
        if (live.indexOf(name) === -1) rows.push({ type: 'category', name: name, recent: false });
      });
      return rows;
    }
    var qLower = q.toLowerCase();
    var exact = false;
    sortAZ(categories).forEach(function (name) {
      var lower = name.toLowerCase();
      if (lower === qLower) exact = true;
      if (lower.indexOf(qLower) !== -1) rows.push({ type: 'category', name: name, recent: false });
    });
    if (!exact) rows.push({ type: 'create', name: q });
    return rows;
  }

  function selectableIndices(rows) {
    var out = [];
    rows.forEach(function (row, i) {
      if (row.type === 'category' || row.type === 'create') out.push(i);
    });
    return out;
  }

  function moveHighlight(current, delta, count) {
    if (count <= 0) return -1;
    if (current < 0) return 0;
    var next = current + delta;
    if (next < 0) return 0;
    if (next > count - 1) return count - 1;
    return next;
  }

  return {
    buildRows: buildRows,
    selectableIndices: selectableIndices,
    moveHighlight: moveHighlight
  };
}());
if (typeof module !== 'undefined' && module.exports) { module.exports = DCCategoryPicker; }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/category-picker.test.js`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add panel/js/category-picker.js tests/category-picker.test.js
git commit -m "feat(panel): add category picker row-model logic

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Recents helpers in `state.js`

**Files:**
- Modify: `panel/js/state.js` (defaultPrefs at :136, export block at :232)
- Test: `tests/category-picker.test.js` (append)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `DCState.categoryScope(mode)` → `'assets'` for modes `'addAssets'`/`'addShape'`, else `'library'`.
- Produces: `DCState.recentCategories(prefs, scope)` → array (safe on missing/malformed prefs).
- Produces: `DCState.pushRecentCategory(prefs, scope, name)` → mutates `prefs.recentCategories[scope]`: unshift, case-insensitive dedupe, cap 4.
- Produces: `defaultPrefs()` gains `recentCategories: { library: [], assets: [] }` (this whitelists the key for the `loadPrefs` merge).

- [ ] **Step 1: Write the failing tests**

Append to `tests/category-picker.test.js`:

```js
// ---- recents prefs helpers (state.js) ----

const DCState = require('../panel/js/state.js');

test('defaultPrefs whitelists recentCategories for both scopes', () => {
  assert.deepEqual(DCState.defaultPrefs().recentCategories, { library: [], assets: [] });
});

test('categoryScope maps asset flows to assets and the rest to library', () => {
  assert.equal(DCState.categoryScope('addAssets'), 'assets');
  assert.equal(DCState.categoryScope('addShape'), 'assets');
  assert.equal(DCState.categoryScope('stash'), 'library');
  assert.equal(DCState.categoryScope('addAep'), 'library');
});

test('recentCategories tolerates prefs saved before the key existed', () => {
  assert.deepEqual(DCState.recentCategories({}, 'library'), []);
  assert.deepEqual(DCState.recentCategories({ recentCategories: { library: ['A'] } }, 'assets'), []);
  assert.deepEqual(DCState.recentCategories({ recentCategories: { library: ['A'] } }, 'library'), ['A']);
});

test('pushRecentCategory unshifts, dedupes case-insensitively, caps at 4', () => {
  const prefs = DCState.defaultPrefs();
  ['A', 'B', 'C', 'D'].forEach((n) => DCState.pushRecentCategory(prefs, 'library', n));
  assert.deepEqual(prefs.recentCategories.library, ['D', 'C', 'B', 'A']);
  DCState.pushRecentCategory(prefs, 'library', 'a');
  assert.deepEqual(prefs.recentCategories.library, ['a', 'D', 'C', 'B']);
  DCState.pushRecentCategory(prefs, 'library', 'E');
  assert.deepEqual(prefs.recentCategories.library, ['E', 'a', 'D', 'C']);
  assert.deepEqual(prefs.recentCategories.assets, []);
});

test('pushRecentCategory repairs a malformed recentCategories object', () => {
  const prefs = { recentCategories: null };
  DCState.pushRecentCategory(prefs, 'assets', 'Logos');
  assert.deepEqual(prefs.recentCategories.assets, ['Logos']);
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node --test tests/category-picker.test.js`
Expected: FAIL — `DCState.categoryScope is not a function` (and the defaultPrefs assertion fails).

- [ ] **Step 3: Implement in `state.js`**

In `defaultPrefs()` (state.js:136), add the key to the returned object:

```js
  function defaultPrefs() {
    return { thumbMin: 130, sort: 'recent', showNames: true, showMeta: true,
      favoritesOnly: false, collapsed: [], activeTab: 'library', collapsedAssets: [],
      viewMode: 'comfortable', viewModeAssets: 'comfortable',
      folderLayout: 'columns', folderLayoutVersion: FOLDER_LAYOUT_VERSION, folderColumns: true,
      recentCategories: { library: [], assets: [] } };
  }
```

Add the three functions directly above the `return {` export block (state.js:232):

```js
  function categoryScope(mode) {
    return (mode === 'addAssets' || mode === 'addShape') ? 'assets' : 'library';
  }

  function recentCategories(prefs, scope) {
    var rc = prefs && prefs.recentCategories;
    return (rc && Array.isArray(rc[scope])) ? rc[scope] : [];
  }

  function pushRecentCategory(prefs, scope, name) {
    var list = recentCategories(prefs, scope).filter(function (n) {
      return n.toLowerCase() !== name.toLowerCase();
    });
    list.unshift(name);
    if (!prefs.recentCategories || typeof prefs.recentCategories !== 'object') {
      prefs.recentCategories = { library: [], assets: [] };
    }
    prefs.recentCategories[scope] = list.slice(0, 4);
    return prefs;
  }
```

Add to the export object (keep alphabetical-ish grouping with the other prefs helpers):

```js
    categoryScope: categoryScope,
    recentCategories: recentCategories,
    pushRecentCategory: pushRecentCategory,
```

- [ ] **Step 4: Run the full suite**

Run: `npm test 2>&1 | tail -5`
Expected: all tests PASS (383 + new). The `loadPrefs` merge and `savePrefsForMode` need no changes — the new key rides the existing whitelist merge.

- [ ] **Step 5: Commit**

```bash
git add panel/js/state.js tests/category-picker.test.js
git commit -m "feat(panel): add scoped recent-category prefs helpers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Modal markup + CSS

**Files:**
- Modify: `panel/index.html` (modal at :276-292, script tags at :361-382)
- Modify: `panel/css/style.css` (after the `.form-group` block ending ~:310)
- Test: `tests/category-picker.test.js` (append)

**Interfaces:**
- Produces: DOM ids `category-picker-input` and `category-picker-list` (Task 4's `els` map and module depend on these exact ids).
- Produces: `<script src="js/category-picker.js"></script>` loaded before `js/ui.js`.
- Removes: ids `existing-category-select` and `new-category-input` (Task 4 removes their JS references).

- [ ] **Step 1: Write the failing tests**

Append to `tests/category-picker.test.js`:

```js
// ---- markup + css wiring ----

const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'panel', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'panel', 'css', 'style.css'), 'utf8');

test('the old two-field category controls are gone', () => {
  assert.ok(!html.includes('existing-category-select'));
  assert.ok(!html.includes('new-category-input'));
});

test('the category modal has the picker input and always-visible list', () => {
  assert.match(html, /<input type="text" id="category-picker-input"[^>]*autocomplete="off"/);
  assert.match(html, /<ul id="category-picker-list" role="listbox"/);
  const modal = html.slice(html.indexOf('id="category-modal"'), html.indexOf('id="rename-modal"'));
  assert.ok(modal.includes('category-picker-input'), 'input must live inside the category modal');
  assert.ok(modal.includes('category-picker-list'), 'list must live inside the category modal');
});

test('category-picker.js loads before ui.js', () => {
  const picker = html.indexOf('js/category-picker.js');
  const ui = html.indexOf('js/ui.js');
  assert.ok(picker !== -1, 'category-picker.js script tag missing');
  assert.ok(picker < ui, 'category-picker.js must load before ui.js');
});

test('the picker list is height-capped and scrolls internally', () => {
  const block = css.match(/#category-picker-list\s*\{([^}]*)\}/);
  assert.ok(block, '#category-picker-list rule missing');
  assert.match(block[1], /max-height:\s*160px/);
  assert.match(block[1], /overflow-y:\s*auto/);
});

test('highlight and create rows use the gold accent', () => {
  const hl = css.match(/#category-picker-list li\.highlight\s*\{([^}]*)\}/);
  assert.ok(hl, 'highlight rule missing');
  assert.match(hl[1], /var\(--gold/);
  const create = css.match(/#category-picker-list li\.cp-create\s*\{([^}]*)\}/);
  assert.ok(create, 'create-row rule missing');
  assert.match(create[1], /var\(--gold\)/);
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node --test tests/category-picker.test.js`
Expected: the five new tests FAIL (old ids still present, no new markup/CSS).

- [ ] **Step 3: Replace the modal markup**

In `panel/index.html`, replace lines 279-286 (the two `.form-group` divs) so the modal reads:

```html
<div id="category-modal" class="modal-overlay hidden">
  <div class="modal-box">
    <h3 id="category-modal-title">Add Composition</h3>
    <div class="form-group">
      <label for="category-picker-input">Category</label>
      <input type="text" id="category-picker-input" placeholder="Search or create..." autocomplete="off" spellcheck="false">
      <ul id="category-picker-list" role="listbox" aria-label="Categories"></ul>
    </div>
    <div class="modal-buttons">
      <button class="btn-dark" id="cancel-category-btn">Cancel</button>
      <button class="btn-gold" id="confirm-category-btn">Add</button>
    </div>
  </div>
</div>
```

In the script block (index.html:361-382), insert directly above the `ui.js` tag:

```html
<script src="js/category-picker.js"></script>
```

- [ ] **Step 4: Add the CSS**

In `panel/css/style.css`, directly after the `.form-group select:focus, .form-group input:focus` rule (:310), add:

```css
#category-picker-list {
  list-style: none; margin: 6px 0 0; padding: 4px;
  max-height: 160px; overflow-y: auto;
  background: var(--bg-inset); border: 1px solid var(--border-strong); border-radius: var(--radius);
}
#category-picker-list li { padding: 6px 8px; border-radius: 4px; font-size: 12px; color: var(--text); }
#category-picker-list li.cp-selectable { cursor: pointer; }
#category-picker-list li.cp-selectable:hover { background: var(--bg-raised); }
#category-picker-list li.highlight { background: var(--gold-bg); color: var(--gold); }
#category-picker-list li.highlight:hover { background: var(--gold-bg); }
#category-picker-list li.cp-recent-header {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
  color: var(--text-dim); padding: 4px 8px 2px;
}
#category-picker-list li.cp-divider { border-top: 1px solid var(--border-strong); margin: 4px 0; padding: 0; height: 0; }
#category-picker-list li.cp-create { color: var(--gold); }
#category-picker-list li.cp-empty { color: var(--text-dim); font-style: italic; }
```

- [ ] **Step 5: Run the full suite**

Run: `npm test 2>&1 | tail -5`
Expected: all PASS. (No JS references the new ids yet; the old ids are only referenced by `main.js`/`ui.js`/`shell.js`, which Task 4 rewires — the suite must still pass here because no test requires those DOM nodes to exist. If a failure appears naming `existing-category-select`, stop and re-read the failing test before proceeding.)

- [ ] **Step 6: Commit**

```bash
git add panel/index.html panel/css/style.css tests/category-picker.test.js
git commit -m "feat(panel): swap category modal markup to single picker field

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: DOM wiring — picker module, `ui.js`, `shell.js`, `main.js`

**Files:**
- Modify: `panel/js/category-picker.js` (add stateful DOM section)
- Modify: `panel/js/ui.js` (`openCategoryModal` at :32-53)
- Modify: `panel/js/shell.js` (`confirmCategoryModal` at :204-219, export block at :313)
- Modify: `panel/js/main.js` (els map entries `existingCategorySelect`/`newCategoryInput`, init calls ~:58, no keydown changes)
- Test: `tests/category-picker.test.js` (append)

**Interfaces:**
- Consumes: `buildRows` / `selectableIndices` / `moveHighlight` (Task 1), `DCState.categoryScope` / `recentCategories` / `pushRecentCategory` (Task 2), ids `category-picker-input` / `category-picker-list` (Task 3).
- Produces: `DCCategoryPicker.init(els, hooks)` — `hooks = { onConfirm: fn, getRecents: fn(scope) → array }`.
- Produces: `DCCategoryPicker.open(categories, scope)` — renders, clears + focuses the input.
- Produces: `DCCategoryPicker.value()` → highlighted category name, trimmed input for the Create row, `''` when nothing selectable.
- Produces: `DCShell.recentCategories(scope)` → recents from live prefs (wired as `hooks.getRecents`).

- [ ] **Step 1: Write the failing wiring tests**

Append to `tests/category-picker.test.js` (source-level assertions, matching the suite's regex conventions — the DOM behavior itself is covered by the pure functions plus the manual AE checklist):

```js
// ---- integration wiring ----

const uiSrc = fs.readFileSync(path.join(__dirname, '..', 'panel', 'js', 'ui.js'), 'utf8');
const shellSrc = fs.readFileSync(path.join(__dirname, '..', 'panel', 'js', 'shell.js'), 'utf8');
const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'panel', 'js', 'main.js'), 'utf8');
const pickerSrc = fs.readFileSync(path.join(__dirname, '..', 'panel', 'js', 'category-picker.js'), 'utf8');

test('ui.js delegates the category modal to the picker', () => {
  assert.match(uiSrc, /DCCategoryPicker\.open\(categories,\s*DCState\.categoryScope\(mode\)\)/);
  assert.ok(!uiSrc.includes('existingCategorySelect'));
  assert.ok(!uiSrc.includes('newCategoryInput'));
});

test('shell.js reads the picker value and records the recent', () => {
  assert.match(shellSrc, /DCCategoryPicker\.value\(\)/);
  assert.match(shellSrc, /DCState\.pushRecentCategory\(prefs,\s*DCState\.categoryScope\(mode\),\s*v\.name\)/);
  assert.ok(!shellSrc.includes('newCategoryInput'));
});

test('main.js wires the picker with confirm and recents hooks', () => {
  assert.match(mainSrc, /DCCategoryPicker\.init\(els,\s*\{\s*onConfirm:\s*DCShell\.confirmCategoryModal,\s*getRecents:\s*DCShell\.recentCategories\s*\}\)/);
  assert.match(mainSrc, /categoryPickerInput:\s*\$\('category-picker-input'\)/);
  assert.match(mainSrc, /categoryPickerList:\s*\$\('category-picker-list'\)/);
  assert.ok(!mainSrc.includes('existing-category-select'));
  assert.ok(!mainSrc.includes('new-category-input'));
});

test('the picker module never handles Enter (global handler owns it)', () => {
  assert.ok(!pickerSrc.includes("'Enter'"), 'Enter in the picker would double-confirm via main.js keydown');
});

test('the picker renders rows with textContent, never innerHTML', () => {
  assert.ok(!pickerSrc.includes('innerHTML +='));
  assert.ok(!/innerHTML\s*=\s*[^'"]/.test(pickerSrc.replace(/innerHTML = ''/g, '')));
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node --test tests/category-picker.test.js`
Expected: the five new wiring tests FAIL.

- [ ] **Step 3: Add the stateful DOM section to `category-picker.js`**

Rework the module so the pure functions stay exported and the DOM state lives alongside (full file below — replace the existing content):

```js
var DCCategoryPicker = (function () {
  'use strict';

  var els = null;
  var hooks = null;
  var allCategories = [];
  var rows = [];
  var selectable = [];
  var highlight = -1; // index into `selectable`

  // ---- pure row-model logic ----

  function sortAZ(names) {
    return names.slice().sort(function (a, b) { return a.localeCompare(b); });
  }

  function buildRows(categories, recents, query) {
    var q = String(query || '').trim();
    var out = [];
    if (q === '') {
      var live = (recents || []).filter(function (r) { return categories.indexOf(r) !== -1; });
      if (categories.length === 0) return [{ type: 'empty' }];
      if (live.length > 0) {
        out.push({ type: 'recent-header' });
        live.forEach(function (name) { out.push({ type: 'category', name: name, recent: true }); });
        out.push({ type: 'divider' });
      }
      sortAZ(categories).forEach(function (name) {
        if (live.indexOf(name) === -1) out.push({ type: 'category', name: name, recent: false });
      });
      return out;
    }
    var qLower = q.toLowerCase();
    var exact = false;
    sortAZ(categories).forEach(function (name) {
      var lower = name.toLowerCase();
      if (lower === qLower) exact = true;
      if (lower.indexOf(qLower) !== -1) out.push({ type: 'category', name: name, recent: false });
    });
    if (!exact) out.push({ type: 'create', name: q });
    return out;
  }

  function selectableIndices(rowList) {
    var out = [];
    rowList.forEach(function (row, i) {
      if (row.type === 'category' || row.type === 'create') out.push(i);
    });
    return out;
  }

  function moveHighlight(current, delta, count) {
    if (count <= 0) return -1;
    if (current < 0) return 0;
    var next = current + delta;
    if (next < 0) return 0;
    if (next > count - 1) return count - 1;
    return next;
  }

  // ---- DOM ----

  function rowLabel(row) {
    if (row.type === 'create') return '＋ Create "' + row.name + '"';
    if (row.type === 'recent-header') return 'Recent';
    if (row.type === 'empty') return 'No categories yet — type a name to create one.';
    return row.name;
  }

  function render() {
    els.categoryPickerList.innerHTML = '';
    rows.forEach(function (row, i) {
      var li = document.createElement('li');
      li.className = 'cp-' + row.type;
      if (row.type === 'category' || row.type === 'create') {
        li.className += ' cp-selectable';
        li.setAttribute('role', 'option');
        var selIdx = selectable.indexOf(i);
        if (selIdx === highlight) {
          li.className += ' highlight';
          li.setAttribute('aria-selected', 'true');
        } else {
          li.setAttribute('aria-selected', 'false');
        }
        li.dataset.selIndex = String(selIdx);
      }
      if (row.type !== 'divider') li.textContent = rowLabel(row);
      els.categoryPickerList.appendChild(li);
    });
    var hlEl = els.categoryPickerList.querySelector('li.highlight');
    if (hlEl && hlEl.scrollIntoView) hlEl.scrollIntoView({ block: 'nearest' });
  }

  function rebuild() {
    var recents = hooks.getRecents ? hooks.getRecents(currentScope) : [];
    rows = buildRows(allCategories, recents, els.categoryPickerInput.value);
    selectable = selectableIndices(rows);
    highlight = selectable.length > 0 ? 0 : -1;
    render();
  }

  var currentScope = 'library';

  function init(elements, pickerHooks) {
    els = elements;
    hooks = pickerHooks || {};
    els.categoryPickerInput.addEventListener('input', rebuild);
    els.categoryPickerInput.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        highlight = moveHighlight(highlight, e.key === 'ArrowDown' ? 1 : -1, selectable.length);
        render();
      }
    });
    els.categoryPickerList.addEventListener('click', function (e) {
      var li = e.target.closest('li.cp-selectable');
      if (!li) return;
      highlight = parseInt(li.dataset.selIndex, 10);
      render();
    });
    els.categoryPickerList.addEventListener('dblclick', function (e) {
      var li = e.target.closest('li.cp-selectable');
      if (!li) return;
      highlight = parseInt(li.dataset.selIndex, 10);
      if (hooks.onConfirm) hooks.onConfirm();
    });
  }

  function open(categories, scope) {
    allCategories = categories.slice();
    currentScope = scope;
    els.categoryPickerInput.value = '';
    rebuild();
    els.categoryPickerInput.focus();
  }

  function value() {
    if (highlight < 0 || highlight >= selectable.length) return '';
    var row = rows[selectable[highlight]];
    return row.name;
  }

  return {
    buildRows: buildRows,
    selectableIndices: selectableIndices,
    moveHighlight: moveHighlight,
    init: init,
    open: open,
    value: value
  };
}());
if (typeof module !== 'undefined' && module.exports) { module.exports = DCCategoryPicker; }
```

- [ ] **Step 4: Rewire `ui.js`**

Replace `openCategoryModal` (ui.js:32-53) with:

```js
  function openCategoryModal(mode, title, categories) {
    catMode = mode;
    els.categoryModalTitle.textContent = title;
    els.categoryModal.classList.remove('hidden');
    DCCategoryPicker.open(categories, DCState.categoryScope(mode));
  }
```

(The modal must be visible before `open` runs so `focus()` lands. The empty-categories case is now the module's `empty` row — the old disabled-select branch disappears entirely.)

- [ ] **Step 5: Rewire `shell.js`**

Replace the first two lines of `confirmCategoryModal`'s body and add the recents recording after validation (shell.js:204-219):

```js
  function confirmCategoryModal() {
    var mode = DCUI.categoryModalMode();
    var categoryName = DCCategoryPicker.value();
    var v = DCValidate.validateName(categoryName, 'Category name');
    if (!v.valid) { DCUI.toast(v.error, true); return; }
    // asset-tab flows may reuse the name "assets"; only library categories
    // collide with the reserved top-level Assets folder
    var isAssetsFlow = mode === 'addAssets' || mode === 'addShape';
    if (!isAssetsFlow && v.name.toLowerCase() === 'assets') {
      DCUI.toast('"Assets" is reserved for the Assets tab.', true);
      return;
    }
    DCState.pushRecentCategory(prefs, DCState.categoryScope(mode), v.name);
    persistPrefs();
    if (mode === 'addAssets' && hasAssets()) DCAssets.confirmCategory(v.name);
    else if (mode === 'addShape' && hasAssets()) DCAssets.confirmShapeCategory(v.name);
    else DCLibrary.confirmCategory(mode, v.name);
  }
```

Add the recents accessor next to `getPrefs` (shell.js:33) and export it in the return block (shell.js:313):

```js
  function recentCategories(scope) { return DCState.recentCategories(prefs, scope); }
```

```js
    recentCategories: recentCategories,
```

(Recording happens at dispatch, before the async disk op — a category whose disk op later fails is invisible anyway because `buildRows` filters recents against the live category list.)

- [ ] **Step 6: Rewire `main.js`**

In the els map, replace:

```js
    existingCategorySelect: $('existing-category-select'),
    newCategoryInput: $('new-category-input'),
```

with:

```js
    categoryPickerInput: $('category-picker-input'),
    categoryPickerList: $('category-picker-list'),
```

After `DCShell.init(els, panelMode);`, add:

```js
  DCCategoryPicker.init(els, { onConfirm: DCShell.confirmCategoryModal, getRecents: DCShell.recentCategories });
```

Leave the document-level keydown handler (main.js:150-156) untouched — it already sends Enter to `confirmCategoryModal` while the modal is open, which now confirms the highlighted row.

- [ ] **Step 7: Run the full suite**

Run: `npm test 2>&1 | tail -5`
Expected: everything PASSES — including `tests/sync.broadcast.test.js`, `tests/assets.add-shape.test.js`, `tests/assets.dragdrop.test.js`, which stub `DCUI.openCategoryModal` with the unchanged `(mode, title, categories)` signature. If one of those fails, the stub likely also fakes the removed els entries — fix the stub, not the signature.

- [ ] **Step 8: Commit**

```bash
git add panel/js/category-picker.js panel/js/ui.js panel/js/shell.js panel/js/main.js tests/category-picker.test.js
git commit -m "feat(panel): wire the category picker into all five modal flows

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Full verification + integration notes

**Files:**
- No code changes expected; fixes only if verification finds problems.

- [ ] **Step 1: Run the complete suite one final time**

Run: `npm test 2>&1 | tail -8`
Expected: 0 failures, total count = 383 + the new tests. Paste the tail output into the completion report — no success claims without it.

- [ ] **Step 2: Static sanity pass**

Run: `grep -rn "existing-category-select\|new-category-input\|existingCategorySelect\|newCategoryInput" panel/ tests/`
Expected: zero matches. Any hit is a missed reference — fix it and re-run the suite.

- [ ] **Step 3: Record integration notes**

Do NOT merge, push, or touch the main working tree. Report back with:
- Branch `feature/category-picker` in worktree `dropcomp-catpicker`, commits from Tasks 1-4.
- Pending integration steps (owner: main session, at merge time):
  1. Mirror the new modal markup + script tag into `panel/_harness.html` in the main tree (gitignored dev harness — not part of this branch).
  2. Manual AE click-test checklist: each of the five flows (Add Composition, Add AE Project, Add Assets, Add Selected Image, Save Shape) opens the picker; filter narrows; Create row appears and creates; recents float up on reopen and are scoped library vs assets; ↑/↓ + Enter work; double-click confirms; Esc/Cancel close; empty-library hint shows.
