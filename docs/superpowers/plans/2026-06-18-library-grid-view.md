# Library / Assets 3-Way View Switch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-tab Comfortable / Dense / List view switch to the Library and Assets tabs so large collections are easy to scan.

**Architecture:** A `viewMode` pref (per tab) toggles a `view-*` class on `#library`. Comfortable = today's grid; Dense is pure CSS over the existing cards; List adds one new `buildRow()` in render.js. `DCRender.render` derives the effective mode from `prefs` + `kind`, so the Library/Assets controllers need no changes. A segmented control in the toolbar drives it through the existing shell.

**Tech Stack:** Vanilla ES5 browser JS (IIFE modules, `var`), CSS custom properties, `node --test` (zero deps), CEP/Chromium host.

## Global Constraints

- Panel JS is **ES5 browser style**: `var`, IIFE modules (`var DCFoo = (function(){…}())`), no `const`/`let`/arrow funcs. Match the surrounding file exactly.
- **Zero test dependencies**: tests run under `node --test "tests/**/*.test.js"`. Add no packages.
- **Every file stays < 400 lines.**
- **Do NOT change the version** anywhere (`package.json`, `CSXS/manifest.xml`, `panel/js/update.js`).
- **Never `git add -A`** — stage explicit paths only. Confirm `git branch --show-current` is `feature/library-grid-view` before every commit.
- `index.html` edits limited to the **toolbar region**; `style.css` edits limited to the **grid/list region** (append + the one collapse-rule edit). Do **not** touch the header / update-chip / modal markup (parallel branch owns those).
- Commit messages use conventional prefixes and end with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Internal mode ids: `'comfortable' | 'compact' | 'list'` (UI label for `compact` is "Dense").

---

### Task 1: View-mode prefs + pure helpers (`state.js`)

**Files:**
- Modify: `panel/js/state.js` (`defaultPrefs` ~106-109, `loadPrefs` legacy branch ~122-124, exports ~161-183)
- Test: `tests/state.prefs.test.js` (update 2 existing tests, add 3 new)

**Interfaces:**
- Produces:
  - `DCState.defaultPrefs()` → now includes `viewMode: 'comfortable'`, `viewModeAssets: 'comfortable'`
  - `DCState.VIEW_MODES` → `['comfortable','compact','list']`
  - `DCState.normalizeViewMode(v)` → `string` (valid mode, else `'comfortable'`)
  - `DCState.viewClass(v)` → `'view-comfortable' | 'view-compact' | 'view-list'`

- [ ] **Step 1: Update the `defaultPrefs shape` test to expect the two new keys**

In `tests/state.prefs.test.js`, replace the existing `defaultPrefs shape` test body:
```js
test('defaultPrefs shape', () => {
  assert.deepEqual(DCState.defaultPrefs(), {
    thumbMin: 130, sort: 'recent', showNames: true, showMeta: true,
    favoritesOnly: false, collapsed: [], activeTab: 'library', collapsedAssets: [],
    viewMode: 'comfortable', viewModeAssets: 'comfortable'
  });
});
```

- [ ] **Step 2: Extend the legacy-migration test to assert the list view is restored**

Replace the existing `loadPrefs migrates legacy compact density once...` test body:
```js
test('loadPrefs migrates legacy compact density once, removing old keys', () => {
  const s = mockStorage({ dropcomp_view: 'list', dropcomp_density: 'compact' });
  const prefs = DCState.loadPrefs(s);
  assert.equal(prefs.thumbMin, 100);
  assert.equal(prefs.viewMode, 'list');
  assert.equal(s.getItem('dropcomp_view'), null);
  assert.equal(s.getItem('dropcomp_density'), null);
});
```

- [ ] **Step 3: Add three new tests (normalize, viewClass, per-tab round-trip)**

Append to `tests/state.prefs.test.js`:
```js
test('normalizeViewMode passes known modes and clamps the rest', () => {
  ['comfortable', 'compact', 'list'].forEach(m =>
    assert.equal(DCState.normalizeViewMode(m), m));
  [undefined, null, '', 'grid', 'LIST', 0].forEach(bad =>
    assert.equal(DCState.normalizeViewMode(bad), 'comfortable'));
});

test('viewClass maps modes to CSS classes and clamps junk', () => {
  assert.equal(DCState.viewClass('comfortable'), 'view-comfortable');
  assert.equal(DCState.viewClass('compact'), 'view-compact');
  assert.equal(DCState.viewClass('list'), 'view-list');
  assert.equal(DCState.viewClass('bogus'), 'view-comfortable');
});

test('per-tab view modes round-trip independently', () => {
  const s = mockStorage();
  const p = DCState.defaultPrefs();
  p.viewMode = 'list';
  p.viewModeAssets = 'compact';
  DCState.savePrefs(s, p);
  const loaded = DCState.loadPrefs(s);
  assert.equal(loaded.viewMode, 'list');
  assert.equal(loaded.viewModeAssets, 'compact');
});
```

- [ ] **Step 4: Run the tests, confirm the new/updated ones FAIL**

Run: `cd "/Users/ziscol/Ziscol Media Projects/dropcomp-gridview" && npm test`
Expected: failures in `defaultPrefs shape` (missing keys), `normalizeViewMode`/`viewClass` (`DCState.normalizeViewMode is not a function`), per-tab round-trip, and the legacy test (`prefs.viewMode` undefined).

- [ ] **Step 5: Add the two keys to `defaultPrefs`**

In `panel/js/state.js`, replace the `defaultPrefs` body:
```js
  function defaultPrefs() {
    return { thumbMin: 130, sort: 'recent', showNames: true, showMeta: true,
      favoritesOnly: false, collapsed: [], activeTab: 'library', collapsedAssets: [],
      viewMode: 'comfortable', viewModeAssets: 'comfortable' };
  }
```

- [ ] **Step 6: Map the legacy `dropcomp_view: 'list'` before removing it**

In `panel/js/state.js` `loadPrefs`, in the legacy `else` branch, add the middle line:
```js
      if (storage.getItem('dropcomp_density') === 'compact') prefs.thumbMin = 100;
      if (storage.getItem('dropcomp_view') === 'list') prefs.viewMode = 'list';
      storage.removeItem('dropcomp_view');
      storage.removeItem('dropcomp_density');
```

- [ ] **Step 7: Add the helpers and `VIEW_MODES` constant**

In `panel/js/state.js`, add just above `function getUsage(` (around line 52):
```js
  var VIEW_MODES = ['comfortable', 'compact', 'list'];

  function normalizeViewMode(v) {
    return VIEW_MODES.indexOf(v) !== -1 ? v : 'comfortable';
  }

  function viewClass(v) {
    return 'view-' + normalizeViewMode(v);
  }
```

- [ ] **Step 8: Export the helpers**

In the `return { … }` object of `panel/js/state.js`, add:
```js
    normalizeViewMode: normalizeViewMode,
    viewClass: viewClass,
    VIEW_MODES: VIEW_MODES,
```

- [ ] **Step 9: Run the full suite, confirm GREEN**

Run: `cd "/Users/ziscol/Ziscol Media Projects/dropcomp-gridview" && npm test`
Expected: all tests pass (no regressions).

- [ ] **Step 10: Commit**

```bash
cd "/Users/ziscol/Ziscol Media Projects/dropcomp-gridview"
git branch --show-current   # must print: feature/library-grid-view
git add panel/js/state.js tests/state.prefs.test.js
git commit -m "feat(library): add per-tab viewMode prefs and helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: List renderer + view-aware sections (`render.js`)

**Files:**
- Modify: `panel/js/render.js` (`buildSection` ~143-165, `render` ~167-176; add `buildRow`)

**Interfaces:**
- Consumes: `DCState.normalizeViewMode`, `DCState.formatMetaLine`, `DCState.formatAssetMetaLine`, `DCState.getUsage`; module-locals `el`, `iconBtn`, `thumbUrl`, `showThumbFallback`, `ICONS`, `RENDERABLE_EXTS`.
- Produces: `DCRender.render(container, groups, prefs, usageMeta, busts, emptyMessage, kind)` — **unchanged signature**; now picks grid vs list internally from `prefs.viewMode`/`prefs.viewModeAssets`.

There is no `render.test.js` (render.js touches `document`/globals and is not node-requirable); this task is verified by the harness in Task 6 plus "existing suite stays green" + a syntax check.

- [ ] **Step 1: Add `buildRow` (list item; root keeps the `.card` class so main.js delegation works)**

In `panel/js/render.js`, add immediately after `buildAssetCard` (after line 141):
```js
  function buildRow(item, usage, prefs, kind, bust) {
    var isAsset = kind === 'asset';
    var card = el('article', 'card card--row' + (usage.isFavorite ? ' has-fav' : ''));
    card.dataset.uniqueId = item.uniqueId;
    card.dataset.category = item.category;
    card.title = item.name + '\nDouble-click to import';

    var thumbWrap = el('div', 'card-thumb');
    var renderable = isAsset ? RENDERABLE_EXTS[item.ext] : item.thumbPath;
    if (renderable) {
      var img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = '';
      img.src = thumbUrl(isAsset ? item.filePath : item.thumbPath,
        isAsset ? (item.addedAt || null) : bust);
      img.onerror = function () { showThumbFallback(img); };
      thumbWrap.appendChild(img);
    } else {
      var ph = el('div', 'thumb-placeholder');
      if (isAsset) ph.appendChild(el('span', 'ext-badge', String(item.ext || '?').toUpperCase()));
      else ph.innerHTML = ICONS.photoOff;
      thumbWrap.appendChild(ph);
    }
    card.appendChild(thumbWrap);

    var main = el('div', 'row-main');
    main.appendChild(el('div', 'card-name', item.name));
    var meta = isAsset ? DCState.formatAssetMetaLine(item) : DCState.formatMetaLine(item);
    if (meta) main.appendChild(el('div', 'card-meta', meta));
    card.appendChild(main);

    var actions = el('div', 'row-actions');
    actions.appendChild(iconBtn('import', 'Import', ICONS.download));
    actions.appendChild(iconBtn('favorite', 'Favorite',
      usage.isFavorite ? ICONS.starFilled : ICONS.star,
      usage.isFavorite ? 'fav-on' : ''));
    actions.appendChild(iconBtn('rename', 'Rename', ICONS.pencil));
    if (!isAsset) actions.appendChild(iconBtn('setThumb', 'Set thumbnail from current frame', ICONS.camera));
    actions.appendChild(iconBtn('reveal', 'Reveal in Finder', ICONS.folder));
    actions.appendChild(iconBtn('delete', 'Delete', ICONS.trash));
    card.appendChild(actions);
    return card;
  }
```

- [ ] **Step 2: Make `buildSection` branch on `viewMode`**

In `panel/js/render.js`, replace `buildSection` (lines 143-165) with:
```js
  function buildSection(group, prefs, usageMeta, busts, kind, viewMode) {
    var collapsedList = kind === 'asset' ? prefs.collapsedAssets : prefs.collapsed;
    var collapsed = collapsedList.indexOf(group.category) !== -1;
    var section = el('section', 'category' + (collapsed ? ' collapsed' : ''));
    section.dataset.category = group.category;

    var header = el('header', 'category-header');
    header.dataset.action = 'toggleSection';
    header.innerHTML = ICONS.chevron;
    header.appendChild(el('span', 'category-name', group.category));
    header.appendChild(el('span', 'category-count', String(group.items.length)));
    section.appendChild(header);

    var isList = viewMode === 'list';
    var container = el('div', isList ? 'list' : 'grid');
    group.items.forEach(function (item) {
      var usage = DCState.getUsage(usageMeta, item.uniqueId);
      if (isList) {
        container.appendChild(buildRow(item, usage, prefs, kind, busts[item.uniqueId]));
      } else {
        container.appendChild(kind === 'asset'
          ? buildAssetCard(item, usage, prefs)
          : buildCard(item, usage, prefs, busts[item.uniqueId]));
      }
    });
    section.appendChild(container);
    return section;
  }
```

- [ ] **Step 3: Derive the effective `viewMode` in `render` and pass it down**

In `panel/js/render.js`, replace `render` (lines 167-176) with:
```js
  function render(container, groups, prefs, usageMeta, busts, emptyMessage, kind) {
    container.innerHTML = '';
    if (groups.length === 0) {
      container.appendChild(el('div', 'placeholder', emptyMessage));
      return;
    }
    var viewMode = DCState.normalizeViewMode(
      kind === 'asset' ? prefs.viewModeAssets : prefs.viewMode);
    groups.forEach(function (g) {
      container.appendChild(buildSection(g, prefs, usageMeta, busts, kind, viewMode));
    });
  }
```

- [ ] **Step 4: Syntax-check and run the suite**

Run:
```bash
cd "/Users/ziscol/Ziscol Media Projects/dropcomp-gridview"
node --check panel/js/render.js && npm test
```
Expected: `node --check` prints nothing (exit 0); all tests pass (behavior unchanged — default mode is `comfortable`, so the grid path runs exactly as before).

- [ ] **Step 5: Commit**

```bash
cd "/Users/ziscol/Ziscol Media Projects/dropcomp-gridview"
git branch --show-current   # feature/library-grid-view
git add panel/js/render.js
git commit -m "feat(library): render list rows and view-aware sections

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Segmented control + view CSS (`index.html`, `style.css`)

**Files:**
- Modify: `panel/index.html` (toolbar row 2 — insert before `#thumb-slider`, line 83)
- Modify: `panel/css/style.css` (edit collapse rule line 147; append view-switch / dense / list block)

**Interfaces:**
- Produces: `#view-switch` with three `.seg-btn[data-view]` buttons; `.seg`, `#library.view-compact …`, `#library.view-list …`, `.card--row`, `.row-main`, `.row-actions` styles.
- Consumes: design tokens already in `:root`.

Verified visually in Task 6. Per-task gate: `npm test` stays green (no JS change).

- [ ] **Step 1: Insert the segmented control before the thumbnail slider**

In `panel/index.html`, immediately **before** line 83 (`<input type="range" id="thumb-slider" …>`), add:
```html
      <div id="view-switch" class="seg" role="group" aria-label="View">
        <button class="seg-btn active" data-view="comfortable" data-tip="Comfortable grid" aria-label="Comfortable grid" aria-pressed="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect></svg></button>
        <button class="seg-btn" data-view="compact" data-tip="Dense grid" aria-label="Dense grid" aria-pressed="false"><svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="3" y="3" width="4" height="4"></rect><rect x="10" y="3" width="4" height="4"></rect><rect x="17" y="3" width="4" height="4"></rect><rect x="3" y="10" width="4" height="4"></rect><rect x="10" y="10" width="4" height="4"></rect><rect x="17" y="10" width="4" height="4"></rect><rect x="3" y="17" width="4" height="4"></rect><rect x="10" y="17" width="4" height="4"></rect><rect x="17" y="17" width="4" height="4"></rect></svg></button>
        <button class="seg-btn" data-view="list" data-tip="List view" aria-label="List view" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg></button>
      </div>
```

- [ ] **Step 2: Make the collapse rule cover list containers**

In `panel/css/style.css`, replace line 147:
```css
.category.collapsed .grid { display: none; }
```
with:
```css
.category.collapsed .grid, .category.collapsed .list { display: none; }
```

- [ ] **Step 3: Append the view-switch, dense, and list styles**

Append to the **end** of `panel/css/style.css`:
```css
/* ---- view switch (segmented) ---- */
.seg { display: inline-flex; flex: 0 0 auto; background: var(--bg-raised); border-radius: var(--radius); overflow: hidden; }
.seg-btn { width: 28px; height: 30px; padding: 0; border: none; background: transparent; color: var(--text-mid); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.seg-btn + .seg-btn { border-left: 1px solid var(--border); }
.seg-btn svg { width: 14px; height: 14px; }
.seg-btn:hover { background: var(--bg-hover); color: var(--text); }
.seg-btn.active { background: var(--gold-bg); color: var(--gold); }

/* ---- dense grid (contact sheet) ---- */
#library.view-compact .grid { grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); gap: 5px; }
#library.view-compact .card-info { display: none; }
#library.view-compact .card-actions { display: none; }
#library.view-compact .import-bar { left: 3px; right: 3px; bottom: 3px; padding: 2px 0; font-size: 10px; }
#library.view-compact .import-bar svg { width: 9px; height: 9px; }
#library.view-compact .generate-chip { font-size: 9px; padding: 0 6px; }
#library.view-compact .thumb-placeholder svg { width: 12px; height: 12px; }
#library.view-compact .ext-badge { font-size: 9px; padding: 1px 5px; }

/* ---- list view ---- */
#library.view-list .list { display: flex; flex-direction: column; gap: 4px; }
#library.view-list .card--row { display: flex; align-items: center; gap: 10px; padding: 6px 8px; }
#library.view-list .card--row .card-thumb { flex: 0 0 auto; width: 52px; aspect-ratio: 16 / 9; border-radius: 4px; }
#library.view-list .card--row .card-thumb img { object-fit: cover; padding: 0; }
#library.view-list .card--row .row-main { flex: 1; min-width: 0; }
#library.view-list .card--row .card-name { font-size: 12px; }
#library.view-list .card--row .card-meta { font-size: 11px; margin-top: 1px; }
#library.view-list .row-actions { display: flex; gap: 2px; flex: 0 0 auto; }
#library.view-list .row-actions .card-action { position: static; opacity: 1; width: 26px; height: 26px; background: transparent; color: var(--text-mid); border-radius: 6px; }
#library.view-list .row-actions .card-action svg { width: 14px; height: 14px; }
#library.view-list .row-actions .card-action:hover { background: var(--bg-hover); color: var(--text); }
#library.view-list .row-actions .card-action[data-action="delete"]:hover { background: var(--danger); color: #fff; }
#library.view-list .row-actions .card-action.fav-on { color: var(--gold); }
```

- [ ] **Step 4: Confirm no test regression**

Run: `cd "/Users/ziscol/Ziscol Media Projects/dropcomp-gridview" && npm test`
Expected: all tests pass (markup/CSS only).

- [ ] **Step 5: Commit**

```bash
cd "/Users/ziscol/Ziscol Media Projects/dropcomp-gridview"
git branch --show-current   # feature/library-grid-view
git add panel/index.html panel/css/style.css
git commit -m "feat(library): add view-switch control and dense/list styles

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Apply + persist view mode (`shell.js`)

**Files:**
- Modify: `panel/js/shell.js` (add helpers after `applyGridSize` ~42; hook `applyPrefsToControls` ~33; hook `setActiveTab` ~87; export ~184-195)

**Interfaces:**
- Consumes: `DCState.normalizeViewMode`, `DCState.viewClass`; module-locals `prefs`, `els`, `persistPrefs`, `activeModule`.
- Produces: `DCShell.onViewChange(mode)` (called by main.js). `applyView`, `viewKey`, `currentViewMode` are internal.

Verified in Task 6. Per-task gate: `node --check` + `npm test` green.

- [ ] **Step 1: Add `viewKey`, `currentViewMode`, `applyView`, `onViewChange`**

In `panel/js/shell.js`, add immediately after `applyGridSize` closes (after line 42):
```js
  function viewKey() { return prefs.activeTab === 'assets' ? 'viewModeAssets' : 'viewMode'; }
  function currentViewMode() { return DCState.normalizeViewMode(prefs[viewKey()]); }

  function applyView() {
    var mode = currentViewMode();
    var cls = DCState.viewClass(mode);
    ['view-comfortable', 'view-compact', 'view-list'].forEach(function (c) {
      els.library.classList.toggle(c, c === cls);
    });
    els.thumbSlider.classList.toggle('hidden', mode !== 'comfortable');
    if (els.viewSwitch) {
      var btns = els.viewSwitch.querySelectorAll('[data-view]');
      for (var i = 0; i < btns.length; i++) {
        var on = btns[i].getAttribute('data-view') === mode;
        btns[i].classList.toggle('active', on);
        btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
  }

  function onViewChange(mode) {
    if (prefs.activeTab !== 'library' && prefs.activeTab !== 'assets') return;
    prefs[viewKey()] = DCState.normalizeViewMode(mode);
    persistPrefs();
    applyView();
    activeModule().rerender();
  }
```

- [ ] **Step 2: Call `applyView()` from `applyPrefsToControls`**

In `panel/js/shell.js` `applyPrefsToControls`, add `applyView();` right after the existing `applyGridSize();` line (line 33):
```js
    applyGridSize();
    applyView();
```

- [ ] **Step 3: Call `applyView()` when entering a grid tab**

In `panel/js/shell.js` `setActiveTab`, insert `applyView();` immediately before `activeModule().ensureLoaded();` (line 87):
```js
    els.search.placeholder = isAssets ? 'Search assets...' : 'Search library...';
    applyView();
    activeModule().ensureLoaded();
```

- [ ] **Step 4: Export `onViewChange`**

In the `return { … }` object of `panel/js/shell.js`, add `onViewChange: onViewChange,` (e.g., on the `onDisplayChange, onSlider,` line):
```js
    onDisplayChange: onDisplayChange, onSlider: onSlider, onViewChange: onViewChange,
```

- [ ] **Step 5: Syntax-check and run the suite**

Run:
```bash
cd "/Users/ziscol/Ziscol Media Projects/dropcomp-gridview"
node --check panel/js/shell.js && npm test
```
Expected: `node --check` clean; all tests pass.

- [ ] **Step 6: Commit**

```bash
cd "/Users/ziscol/Ziscol Media Projects/dropcomp-gridview"
git branch --show-current   # feature/library-grid-view
git add panel/js/shell.js
git commit -m "feat(library): apply and persist per-tab view mode in shell

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Wire the control (`main.js`)

**Files:**
- Modify: `panel/js/main.js` (`els` map ~29; add listener after the thumb-slider binding ~68)

**Interfaces:**
- Consumes: `DCShell.onViewChange`; DOM `#view-switch`.
- Produces: click delegation from the segmented control to the shell.

- [ ] **Step 1: Add the element ref**

In `panel/js/main.js` `els` map, add after the `thumbSlider: $('thumb-slider'),` line (line 29):
```js
    thumbSlider: $('thumb-slider'),
    viewSwitch: $('view-switch'),
```

- [ ] **Step 2: Bind the delegated click**

In `panel/js/main.js`, add right after `els.thumbSlider.addEventListener('input', DCShell.onSlider);` (line 68):
```js
  els.viewSwitch.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-view]');
    if (btn) DCShell.onViewChange(btn.dataset.view);
  });
```

- [ ] **Step 3: Syntax-check and run the suite**

Run:
```bash
cd "/Users/ziscol/Ziscol Media Projects/dropcomp-gridview"
node --check panel/js/main.js && npm test
```
Expected: `node --check` clean; all tests pass.

- [ ] **Step 4: Commit**

```bash
cd "/Users/ziscol/Ziscol Media Projects/dropcomp-gridview"
git branch --show-current   # feature/library-grid-view
git add panel/js/main.js
git commit -m "feat(library): wire view-switch clicks to the shell

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Harness verification + perf measurement + screenshots

**Files:**
- Create (gitignored): `panel/_harness.html`
- Modify: `.gitignore` (only if `panel/_harness.html` is not already covered — it is, line present — so no change expected)

**Interfaces:** none (verification only). `_harness.html` is gitignored and never shipped.

The harness links `css/style.css` and `<script src>`s every panel JS, so the Task 1-5 edits are picked up automatically. Only the toolbar markup and mock data need adding.

- [ ] **Step 1: Seed the harness from the released one**

```bash
cd "/Users/ziscol/Ziscol Media Projects/dropcomp-gridview"
cp "/Users/ziscol/Ziscol Media Projects/dropcomp/panel/_harness.html" panel/_harness.html
```

- [ ] **Step 2: Add the segmented control to the harness toolbar**

In `panel/_harness.html`, find the `<input type="range" id="thumb-slider" …>` line and insert the **same `#view-switch` block from Task 3 Step 1** immediately before it.

- [ ] **Step 3: Replace the mock prefs + bridge to serve a large Library/Assets set**

In `panel/_harness.html`, replace the `localStorage.setItem('dropcomp_prefs', …)` line with one that opens on Library and seeds both new keys:
```js
  localStorage.setItem('dropcomp_prefs', JSON.stringify({ activeTab:'library', thumbMin:130, sort:'name', showNames:true, showMeta:true, favoritesOnly:false, collapsed:[], collapsedAssets:[], viewMode:'comfortable', viewModeAssets:'comfortable' }));
```
Then, inside the `<script>` just **before** `function mockHost(script) {`, add generators:
```js
  function mkComps(n){ var c=['Titles','Lower Thirds','Transitions','Backgrounds','Logos']; var a=[]; for(var i=0;i<n;i++){ a.push({ uniqueId:'comp_'+i+'_'+(1000+i), name:'Composition '+(i+1), category:c[i%c.length], aepPath:'/mock/'+i+'.aep', thumbPath:'/mock/t'+i+'.png', width:1920, height:1080, duration:5+(i%10), frameRate:30, addedAt:1000+i }); } return a; }
  function mkAssets(n){ var c=['Icons','Textures','Overlays','Brand']; var e=['png','jpg','svg','ai','mov']; var a=[]; for(var i=0;i<n;i++){ a.push({ uniqueId:c[i%c.length]+'/asset_'+i+'.'+e[i%e.length], name:'Asset '+(i+1), category:c[i%c.length], ext:e[i%e.length], filePath:'/mock/a'+i+'.'+e[i%e.length], sizeBytes:1024*((i%900)+50), addedAt:1000+i }); } return a; }
  var MOCK_COMPS = mkComps(600), MOCK_ASSETS = mkAssets(600);
```
And inside `mockHost`, add two routes before `return '[]';`:
```js
    if (fn === 'getStashedComps') return JSON.stringify(MOCK_COMPS);
    if (fn === 'getAssets') return JSON.stringify(MOCK_ASSETS);
```
(`thumbPath`/`filePath` point at non-existent files, so cards render the photo-off glyph / ext badge — enough to verify density and layout.)

- [ ] **Step 4: Serve the panel and open the harness**

Use the preview tooling to serve the `panel/` directory and open `_harness.html` (e.g., `preview_start`, then navigate to the served `_harness.html`). Confirm it loads with no console errors via `preview_console_logs`.

- [ ] **Step 5: Verify all three modes on the Library tab**

- `preview_screenshot` in **Comfortable** (default): cards with names/meta, slider visible.
- `preview_click` the **Dense** segment → `preview_screenshot`: many small thumbs, no text, slider hidden, `aria-pressed` moved.
- `preview_click` the **List** segment → `preview_screenshot`: one row per item (thumb · name · meta · inline actions), slider hidden.

- [ ] **Step 6: Verify per-tab persistence across a tab switch**

- `preview_click` the **Assets** tab → confirm it shows **Comfortable** (its own default, independent of Library's List).
- `preview_click` Assets **Dense** → `preview_screenshot`.
- `preview_click` back to **Library** → confirm it is still **List** (per-tab memory holds).
- `preview_eval`: `JSON.parse(localStorage.dropcomp_prefs)` → assert `viewMode:'list'`, `viewModeAssets:'compact'`.

- [ ] **Step 7: Measure render performance for ~600 items**

`preview_eval` per mode (example):
```js
(function(){ var t=performance.now(); DCShell.onViewChange('comfortable'); return Math.round(performance.now()-t)+'ms / '+document.querySelectorAll('#library .card').length+' cards'; })()
```
Repeat for `'compact'` and `'list'`. Record the numbers. If any mode exceeds ~150ms render or scrolling visibly janks, note it in the PR as a virtualization follow-up (do **not** build virtualization in this task). If the dense grid does not look meaningfully denser than Comfortable-at-min, lower the `minmax(72px…)` value in `style.css` (e.g., to `64px`), re-commit Task 3, and re-shoot.

- [ ] **Step 8: Save the screenshots for the PR**

Keep the six screenshots (Library ×3, Assets ×2 + the tab-switch shot). They are attached/linked in the PR (Task 7). No commit (harness is gitignored).

---

### Task 7: Full-suite check + open PR (no merge)

**Files:** none (integration).

- [ ] **Step 1: Final full-suite run**

Run: `cd "/Users/ziscol/Ziscol Media Projects/dropcomp-gridview" && npm test`
Expected: all tests pass.

- [ ] **Step 2: Confirm scope is clean (no stray/unrelated files, no version bump)**

```bash
cd "/Users/ziscol/Ziscol Media Projects/dropcomp-gridview"
git fetch origin --quiet
git log --oneline origin/main..HEAD
git diff --stat origin/main..HEAD     # expect only: docs spec/plan, state.js, render.js, index.html, style.css, shell.js, main.js, tests/state.prefs.test.js
git diff origin/main..HEAD -- package.json CSXS/manifest.xml panel/js/update.js   # expect EMPTY
```

- [ ] **Step 3: Push the branch**

```bash
cd "/Users/ziscol/Ziscol Media Projects/dropcomp-gridview"
git branch --show-current   # feature/library-grid-view
git push -u origin feature/library-grid-view
```

- [ ] **Step 4: Open the PR to main (do NOT merge)**

```bash
cd "/Users/ziscol/Ziscol Media Projects/dropcomp-gridview"
gh pr create --base main --head feature/library-grid-view \
  --title "feat(library): 3-way view switch (Comfortable / Dense / List)" \
  --body "$(cat <<'EOF'
## What
Adds a per-tab view switch to the Library and Assets tabs: **Comfortable grid**, **Dense grid** (contact-sheet), and **List**. A segmented control in the toolbar drives it; the choice is remembered per tab in `dropcomp_prefs`.

## Why
Browsing large collections in the 2–3-column comfortable grid means a lot of scrolling. Dense fits many more items per screen; List is a compact scannable layout. Restores (and improves on) the view choice an earlier build had — the legacy `dropcomp_view: 'list'` pref is now migrated to the new List mode.

## How it works
- `state.js`: `viewMode` + `viewModeAssets` prefs (default `comfortable`); pure helpers `normalizeViewMode`/`viewClass`; legacy `dropcomp_view:'list'` migration.
- `render.js`: `render` derives the mode from `prefs`+`kind`; `buildSection` picks grid vs `.list`; new `buildRow` (root keeps `.card` so existing delegation/dblclick work unchanged).
- `shell.js`: `applyView` (sets `#library` class, hides the slider outside Comfortable, syncs the segmented control) + `onViewChange`; re-applied on tab switch for per-tab memory.
- `index.html`/`style.css`: segmented control in the toolbar; dense/list CSS (scoped to `#library.view-*`).
- `main.js`: delegated click wiring.

`library.js`/`assets.js` are unchanged — the mode is derived inside `render`.

## How to test
- Unit: `npm test` (adds viewMode shape, `normalizeViewMode`, `viewClass`, per-tab round-trip, legacy migration).
- UI: open `panel/_harness.html` (gitignored; ~600 mock items) and switch modes on both tabs. Screenshots below.

## Screenshots
<!-- attach the 6 harness screenshots from Task 6 -->

## Status
- [x] Unit tests green (state + prefs)
- [x] Harness-verified: Comfortable / Dense / List on Library and Assets
- [x] Per-tab persistence verified across tab switch
- [x] Render perf measured for ~600 items (see PR comment)
- [x] No version bump; no header/update-chip/modal edits (parallel branch territory)
- [ ] Expect a rebase on `index.html`/`style.css` at merge (shared with the self-updater branch)
- [ ] **Do not merge** until the parallel self-updater feature is ready for the combined release

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Report the PR URL and the perf numbers to the user.**

---

## Self-Review

**Spec coverage:**
- 3-way switch (Comfortable/Dense/List) → Tasks 2, 3.
- Library + Assets scope → render derives by `kind` (Task 2); both tabs verified (Task 6).
- Toolbar segmented control → Task 3 + Task 5.
- Per-tab persistence → Task 1 (keys) + Task 4 (`viewKey`/`applyView`/`onViewChange`); verified Task 6 Step 6.
- Slider hidden outside Comfortable → Task 4 `applyView`.
- Dense = no text → Task 3 CSS (`.card-info { display:none }`).
- Default Comfortable (no change for existing users) → Task 1 `defaultPrefs`.
- Legacy `dropcomp_view:'list'` migration → Task 1 Steps 2, 6.
- Unit tests for pure logic → Task 1.
- Harness + screenshots + perf-first (no premature virtualization) → Task 6.
- < 400 lines, no version bump, explicit-path commits, shared-file discipline → Global Constraints + Task 7 Step 2.

**Placeholder scan:** No TBD/TODO; every code/HTML/CSS step shows the full content; commands have expected output.

**Type/name consistency:** `normalizeViewMode`, `viewClass`, `VIEW_MODES`, `viewMode`, `viewModeAssets`, `onViewChange`, `applyView`, `viewKey`, `currentViewMode`, `#view-switch`, `.seg`/`.seg-btn`, `data-view`, `view-comfortable|view-compact|view-list`, `.card--row`, `.row-main`, `.row-actions`, `buildRow` — used identically across tasks. `render` signature unchanged, so the `library.js`/`assets.js` call sites stay valid.
