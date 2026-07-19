# Library Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Virtual named sections ("Client X") in the DropComp Library — one comp on disk can appear in its home category folder and in any number of pinned sections, persisted in `<library>/.dropcomp_sections.json`.

**Architecture:** New `panel/js/sections.js` (`DCSections`) holds a pure model core plus a thin Node-fs shim. `library.js` owns the flows (add/remove/rename/delete, prune, id migration), `render.js` paints virtual groups pinned above category groups, `shell.js`/`main.js` route the new actions. Spec: `docs/superpowers/specs/2026-07-19-library-sections-design.md`.

**Tech Stack:** CEP panel JS (ES3-style `var` IIFE modules with `module.exports` guard), node:test + assert/strict, no external deps.

## Global Constraints

- Panel JS files use `var` + IIFE + `module.exports` guard (see `state.js`); tests may use `const`.
- Test command: `npm test` (runs `node --test "tests/**/*.test.js"`). Baseline on `feature/nav-rail`: 383 pass, 0 fail. Every task ends green.
- Conventional commits (`feat`/`fix`/`docs`/`test` + scope). Stage files explicitly — NEVER `git add -A` (parallel sessions share this repo).
- **All work happens in a fresh worktree** because the main checkout is owned by another session (currently on `feature/make-modular`). Do not touch the main checkout's branch state.
- The sections file is `<libraryPath>/.dropcomp_sections.json`, format `{"version":1,"sections":{"Name":["uniqueId",...]}}`.
- Collapse keys for virtual sections are `'sec:' + name` inside the existing `prefs.collapsed` array; category keys stay raw names.
- Virtual section DOM uses `data-section`, never `data-category` (drag-to-move targets `dataset.category`).
- UI copy: "Add to Section…", "Remove from Section", "Rename section", "Delete section (comps stay)".
- New module target: well under 400 lines.

---

### Task 1: Worktree, branch, and docs commit

**Files:**
- Create: worktree at `../dropcomp-sections`, branch `feature/library-sections` off `feature/nav-rail`
- Copy in: `docs/superpowers/specs/2026-07-19-library-sections-design.md` and `docs/superpowers/plans/2026-07-19-library-sections.md` (both sit **untracked in the main working tree** at `/Users/ziscol/Ziscol Media Projects/dropcomp/` — untracked files do not appear in new worktrees)

**Interfaces:**
- Produces: a clean isolated checkout all later tasks run in. All later paths are relative to the worktree root.

- [ ] **Step 1: Create the worktree**

```bash
cd "/Users/ziscol/Ziscol Media Projects/dropcomp"
git worktree add ../dropcomp-sections -b feature/library-sections feature/nav-rail
```

Expected: `Preparing worktree (new branch 'feature/library-sections')`, `HEAD is now at b00d367 ...`

- [ ] **Step 2: Copy the spec and plan into the worktree**

```bash
cp "docs/superpowers/specs/2026-07-19-library-sections-design.md" "../dropcomp-sections/docs/superpowers/specs/"
cp "docs/superpowers/plans/2026-07-19-library-sections.md" "../dropcomp-sections/docs/superpowers/plans/"
```

- [ ] **Step 3: Baseline test run**

```bash
cd "../dropcomp-sections" && npm test 2>&1 | tail -3
```

Expected: `# pass 383`, `# fail 0`

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-07-19-library-sections-design.md docs/superpowers/plans/2026-07-19-library-sections.md
git commit -m "docs(sections): add library sections spec and implementation plan"
```

---

### Task 2: DCSections pure model core

**Files:**
- Create: `panel/js/sections.js`
- Test: `tests/sections.test.js`

**Interfaces:**
- Produces (all exported on `DCSections`; mutators mutate `model` in place and return a changed/ok flag, matching how `usageMeta` is handled elsewhere):
  - `emptyModel() -> {version: 1, sections: {}}`
  - `parse(raw: string|null) -> {model, corrupt: boolean}`
  - `serialize(model) -> string` (2-space JSON)
  - `sectionNames(model) -> string[]` (localeCompare-sorted)
  - `add(model, name, id) -> boolean` (false if already present)
  - `remove(model, name, id) -> boolean`
  - `removeEverywhere(model, id) -> boolean`
  - `renameSection(model, oldName, newName) -> {ok, changed?, error?}`
  - `deleteSection(model, name) -> boolean`
  - `migrateId(model, oldId, newId) -> boolean`
  - `prune(model, validIds: string[]) -> boolean`
  - `buildGroups(model, comps, sortFn, hideEmpty) -> [{category, virtual: true, items}]`
  - `collapseKey(name) -> 'sec:' + name`

- [ ] **Step 1: Write the failing tests**

Create `tests/sections.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const DCSections = require('../panel/js/sections.js');

function model(sections) { return { version: 1, sections: sections || {} }; }

test('parse returns an empty model for null/empty input without corruption', () => {
  assert.deepEqual(DCSections.parse(null), { model: model(), corrupt: false });
  assert.deepEqual(DCSections.parse(''), { model: model(), corrupt: false });
});

test('parse round-trips a serialized model', () => {
  const m = model({ 'Client X': ['a_1', 'b_2'] });
  assert.deepEqual(DCSections.parse(DCSections.serialize(m)), { model: m, corrupt: false });
});

test('parse flags malformed JSON and wrong shapes as corrupt', () => {
  assert.equal(DCSections.parse('{nope').corrupt, true);
  assert.equal(DCSections.parse('[]').corrupt, true);
  assert.equal(DCSections.parse('{"version":1}').corrupt, true);
  assert.equal(DCSections.parse('{"version":1,"sections":[]}').corrupt, true);
});

test('parse drops non-array sections and non-string ids but keeps the rest', () => {
  const r = DCSections.parse('{"version":1,"sections":{"Good":["a",7],"Bad":"x"}}');
  assert.deepEqual(r, { model: model({ Good: ['a'] }), corrupt: false });
});

test('sectionNames sorts alphabetically', () => {
  assert.deepEqual(
    DCSections.sectionNames(model({ Zeta: [], Alpha: [] })),
    ['Alpha', 'Zeta']
  );
});

test('add creates the section on first use and rejects duplicates', () => {
  const m = model();
  assert.equal(DCSections.add(m, 'Client X', 'a_1'), true);
  assert.equal(DCSections.add(m, 'Client X', 'a_1'), false);
  assert.deepEqual(m.sections, { 'Client X': ['a_1'] });
});

test('remove deletes only the targeted id and reports misses', () => {
  const m = model({ 'Client X': ['a_1', 'b_2'] });
  assert.equal(DCSections.remove(m, 'Client X', 'a_1'), true);
  assert.equal(DCSections.remove(m, 'Client X', 'nope'), false);
  assert.equal(DCSections.remove(m, 'Ghost', 'a_1'), false);
  assert.deepEqual(m.sections['Client X'], ['b_2']);
});

test('removeEverywhere clears an id from all sections', () => {
  const m = model({ A: ['x_1', 'y_2'], B: ['x_1'], C: ['z_3'] });
  assert.equal(DCSections.removeEverywhere(m, 'x_1'), true);
  assert.equal(DCSections.removeEverywhere(m, 'x_1'), false);
  assert.deepEqual(m.sections, { A: ['y_2'], B: [], C: ['z_3'] });
});

test('renameSection moves membership and rejects collisions', () => {
  const m = model({ Old: ['a_1'], Taken: [] });
  assert.equal(DCSections.renameSection(m, 'Old', 'Taken').ok, false);
  assert.equal(DCSections.renameSection(m, 'Ghost', 'New').ok, false);
  assert.deepEqual(DCSections.renameSection(m, 'Old', 'Old'), { ok: true, changed: false });
  assert.deepEqual(DCSections.renameSection(m, 'Old', 'Fresh'), { ok: true, changed: true });
  assert.deepEqual(m.sections, { Taken: [], Fresh: ['a_1'] });
});

test('deleteSection removes the grouping only', () => {
  const m = model({ Gone: ['a_1'], Stays: ['b_2'] });
  assert.equal(DCSections.deleteSection(m, 'Gone'), true);
  assert.equal(DCSections.deleteSection(m, 'Gone'), false);
  assert.deepEqual(m.sections, { Stays: ['b_2'] });
});

test('migrateId rewrites a renamed comp id in every section', () => {
  const m = model({ A: ['old_1'], B: ['old_1', 'k_9'] });
  assert.equal(DCSections.migrateId(m, 'old_1', 'new_1'), true);
  assert.equal(DCSections.migrateId(m, 'old_1', 'new_1'), false);
  assert.equal(DCSections.migrateId(m, 'k_9', 'k_9'), false);
  assert.deepEqual(m.sections, { A: ['new_1'], B: ['new_1', 'k_9'] });
});

test('prune drops ids missing from the index and keeps empty sections', () => {
  const m = model({ A: ['live_1', 'dead_2'], B: ['dead_2'] });
  assert.equal(DCSections.prune(m, ['live_1']), true);
  assert.equal(DCSections.prune(m, ['live_1']), false);
  assert.deepEqual(m.sections, { A: ['live_1'], B: [] });
});

test('buildGroups pins alphabetical virtual groups with sorted resolved items', () => {
  const m = model({ Zeta: ['b_2'], Alpha: ['a_1', 'missing_9', 'b_2'] });
  const comps = [
    { uniqueId: 'a_1', name: 'A' },
    { uniqueId: 'b_2', name: 'B' },
  ];
  const groups = DCSections.buildGroups(m, comps, (items) => items.slice().reverse(), false);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].category, 'Alpha');
  assert.equal(groups[0].virtual, true);
  assert.deepEqual(groups[0].items.map((c) => c.uniqueId), ['b_2', 'a_1']);
  assert.deepEqual(groups[1].items.map((c) => c.uniqueId), ['b_2']);
});

test('buildGroups keeps empty sections visible unless hideEmpty', () => {
  const m = model({ Empty: [] });
  assert.equal(DCSections.buildGroups(m, [], null, false).length, 1);
  assert.equal(DCSections.buildGroups(m, [], null, true).length, 0);
});

test('collapseKey prefixes to avoid category name clashes', () => {
  assert.equal(DCSections.collapseKey('Client X'), 'sec:Client X');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/sections.test.js`
Expected: FAIL — `Cannot find module '../panel/js/sections.js'`

- [ ] **Step 3: Implement the core**

Create `panel/js/sections.js`:

```js
// DropComp virtual library sections ("client groups"). One comp can appear in
// its home category folder and in any number of named sections; membership
// lives in <library>/.dropcomp_sections.json, never in the comp folders.
// Pure model core here; the Node-fs shim is added in the next task.
var DCSections = (function () {
  'use strict';

  var COLLAPSE_PREFIX = 'sec:';

  function emptyModel() { return { version: 1, sections: {} }; }

  function isValidModel(m) {
    return !!m && typeof m === 'object' &&
      !!m.sections && typeof m.sections === 'object' && !(m.sections instanceof Array) &&
      !(m instanceof Array);
  }

  function parse(raw) {
    if (raw === null || raw === undefined || raw === '') {
      return { model: emptyModel(), corrupt: false };
    }
    var m;
    try { m = JSON.parse(raw); } catch (e) { return { model: emptyModel(), corrupt: true }; }
    if (!isValidModel(m)) return { model: emptyModel(), corrupt: true };
    var clean = emptyModel();
    Object.keys(m.sections).forEach(function (name) {
      var ids = m.sections[name];
      if (ids instanceof Array) {
        clean.sections[name] = ids.filter(function (id) { return typeof id === 'string'; });
      }
    });
    return { model: clean, corrupt: false };
  }

  function serialize(model) { return JSON.stringify(model, null, 2); }

  function has(model, name) {
    return Object.prototype.hasOwnProperty.call(model.sections, name);
  }

  function sectionNames(model) {
    return Object.keys(model.sections).sort(function (a, b) { return a.localeCompare(b); });
  }

  function add(model, name, id) {
    if (!has(model, name)) model.sections[name] = [];
    if (model.sections[name].indexOf(id) !== -1) return false;
    model.sections[name].push(id);
    return true;
  }

  function remove(model, name, id) {
    if (!has(model, name)) return false;
    var i = model.sections[name].indexOf(id);
    if (i === -1) return false;
    model.sections[name].splice(i, 1);
    return true;
  }

  function removeEverywhere(model, id) {
    var changed = false;
    Object.keys(model.sections).forEach(function (name) {
      if (remove(model, name, id)) changed = true;
    });
    return changed;
  }

  function renameSection(model, oldName, newName) {
    if (!has(model, oldName)) return { ok: false, error: 'Section not found.' };
    if (oldName === newName) return { ok: true, changed: false };
    if (has(model, newName)) {
      return { ok: false, error: 'A section named "' + newName + '" already exists.' };
    }
    model.sections[newName] = model.sections[oldName];
    delete model.sections[oldName];
    return { ok: true, changed: true };
  }

  function deleteSection(model, name) {
    if (!has(model, name)) return false;
    delete model.sections[name];
    return true;
  }

  function migrateId(model, oldId, newId) {
    if (oldId === newId) return false;
    var changed = false;
    Object.keys(model.sections).forEach(function (name) {
      var i = model.sections[name].indexOf(oldId);
      if (i !== -1) { model.sections[name][i] = newId; changed = true; }
    });
    return changed;
  }

  function prune(model, validIds) {
    var valid = {};
    (validIds || []).forEach(function (id) { valid[id] = true; });
    var changed = false;
    Object.keys(model.sections).forEach(function (name) {
      var kept = model.sections[name].filter(function (id) { return valid[id] === true; });
      if (kept.length !== model.sections[name].length) {
        model.sections[name] = kept;
        changed = true;
      }
    });
    return changed;
  }

  function collapseKey(name) { return COLLAPSE_PREFIX + name; }

  // comps: the already-filtered comp list. hideEmpty: a search/favorites
  // filter is active, so deliberately-empty sections would read as noise.
  function buildGroups(model, comps, sortFn, hideEmpty) {
    var byId = {};
    comps.forEach(function (c) { byId[c.uniqueId] = c; });
    var groups = [];
    sectionNames(model).forEach(function (name) {
      var items = model.sections[name]
        .map(function (id) { return byId[id]; })
        .filter(function (c) { return !!c; });
      if (items.length === 0 && hideEmpty) return;
      groups.push({ category: name, virtual: true, items: sortFn ? sortFn(items) : items });
    });
    return groups;
  }

  return {
    emptyModel: emptyModel, parse: parse, serialize: serialize,
    sectionNames: sectionNames, add: add, remove: remove,
    removeEverywhere: removeEverywhere, renameSection: renameSection,
    deleteSection: deleteSection, migrateId: migrateId, prune: prune,
    collapseKey: collapseKey, buildGroups: buildGroups
  };
}());
if (typeof module !== 'undefined' && module.exports) { module.exports = DCSections; }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/sections.test.js`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add panel/js/sections.js tests/sections.test.js
git commit -m "feat(sections): add DCSections model core"
```

---

### Task 3: Sections file load/save with corruption quarantine

**Files:**
- Modify: `panel/js/sections.js` (add fs shim before the `return` block; extend the exports object)
- Test: `tests/sections.test.js` (append)

**Interfaces:**
- Consumes: Task 2's `parse`/`serialize`/`emptyModel`.
- Produces:
  - `filePath(libPath) -> libPath + '/.dropcomp_sections.json'`
  - `load(libPath, _fs?) -> {model, corrupt}` — missing file / no Node → empty model, not corrupt; unparseable file → quarantined via rename to `.dropcomp_sections.corrupt-<Date.now()>.json`, returns `corrupt: true`
  - `save(libPath, model, _fs?) -> {ok, persisted, error?}` — no Node → `{ok: true, persisted: false}` (in-memory sections still work in the browser harness); write failure → `{ok: false, error}`
  - `_fs` is an injectable fs for tests, mirroring the `updater-fs.js` pattern.

- [ ] **Step 1: Append the failing tests**

Append to `tests/sections.test.js`:

```js
function stubFs(files) {
  const calls = { writes: [], renames: [] };
  return {
    calls,
    existsSync: (p) => Object.prototype.hasOwnProperty.call(files, p),
    readFileSync: (p) => {
      if (!Object.prototype.hasOwnProperty.call(files, p)) throw new Error('ENOENT');
      return files[p];
    },
    writeFileSync: (p, data) => { files[p] = data; calls.writes.push(p); },
    renameSync: (from, to) => {
      files[to] = files[from];
      delete files[from];
      calls.renames.push({ from, to });
    },
  };
}

test('load returns an empty model when the file is missing', () => {
  const fs = stubFs({});
  assert.deepEqual(DCSections.load('/lib', fs), { model: model(), corrupt: false });
});

test('load parses an existing sections file', () => {
  const fs = stubFs({ '/lib/.dropcomp_sections.json': '{"version":1,"sections":{"C":["a_1"]}}' });
  assert.deepEqual(DCSections.load('/lib', fs), { model: model({ C: ['a_1'] }), corrupt: false });
});

test('load quarantines a corrupt file instead of leaving it to be overwritten', () => {
  const fs = stubFs({ '/lib/.dropcomp_sections.json': '{broken' });
  const r = DCSections.load('/lib', fs);
  assert.equal(r.corrupt, true);
  assert.deepEqual(r.model, model());
  assert.equal(fs.calls.renames.length, 1);
  assert.equal(fs.calls.renames[0].from, '/lib/.dropcomp_sections.json');
  assert.match(fs.calls.renames[0].to, /\/lib\/\.dropcomp_sections\.corrupt-\d+\.json$/);
});

test('save writes serialized json and reports write failures', () => {
  const fs = stubFs({});
  const m = model({ C: ['a_1'] });
  assert.deepEqual(DCSections.save('/lib', m, fs), { ok: true, persisted: true });
  assert.deepEqual(DCSections.parse(fs.readFileSync('/lib/.dropcomp_sections.json')).model, m);

  const failing = stubFs({});
  failing.writeFileSync = () => { throw new Error('disk full'); };
  const r = DCSections.save('/lib', m, failing);
  assert.equal(r.ok, false);
  assert.match(r.error, /disk full/);
});

test('load and save degrade to in-memory when fs is unavailable', () => {
  assert.deepEqual(DCSections.load('/lib', null), { model: model(), corrupt: false });
  assert.deepEqual(DCSections.save('/lib', model(), null), { ok: true, persisted: false });
});
```

Note: `_fs === null` must mean "explicitly unavailable" in tests; only `undefined` falls through to `require('fs')`.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test tests/sections.test.js`
Expected: FAIL — `DCSections.load is not a function`

- [ ] **Step 3: Implement the shim**

Add inside the IIFE in `panel/js/sections.js` (before the `return`), and add `filePath`, `load`, `save` to the exports object:

```js
  var FILE_NAME = '.dropcomp_sections.json';

  function filePath(libPath) { return libPath + '/' + FILE_NAME; }

  // _fs: injectable for tests (updater-fs.js pattern). null = explicitly
  // unavailable; undefined = use Node's fs when the runtime has it.
  function nodeFs(_fs) {
    if (_fs !== undefined) return _fs;
    if (typeof require === 'undefined') return null;
    try { return require('fs'); } catch (e) { return null; }
  }

  function load(libPath, _fs) {
    var fs = nodeFs(_fs);
    if (!fs || !libPath) return { model: emptyModel(), corrupt: false };
    var p = filePath(libPath);
    var raw;
    try {
      if (!fs.existsSync(p)) return { model: emptyModel(), corrupt: false };
      raw = fs.readFileSync(p, 'utf8');
    } catch (e) {
      return { model: emptyModel(), corrupt: false };
    }
    var r = parse(String(raw));
    if (r.corrupt) {
      // quarantine - never leave a file the next save would overwrite
      try { fs.renameSync(p, libPath + '/' + '.dropcomp_sections.corrupt-' + Date.now() + '.json'); } catch (e2) { }
    }
    return r;
  }

  function save(libPath, model, _fs) {
    var fs = nodeFs(_fs);
    if (!fs || !libPath) return { ok: true, persisted: false };
    try {
      fs.writeFileSync(filePath(libPath), serialize(model), 'utf8');
      return { ok: true, persisted: true };
    } catch (e) {
      return { ok: false, error: 'Could not save sections: ' + e.message };
    }
  }
```

- [ ] **Step 4: Run the full suite**

Run: `npm test 2>&1 | tail -3`
Expected: `# fail 0` (383 baseline + new sections tests)

- [ ] **Step 5: Commit**

```bash
git add panel/js/sections.js tests/sections.test.js
git commit -m "feat(sections): add sections file load/save with corruption quarantine"
```

---

### Task 4: Icons + virtual section rendering

**Files:**
- Modify: `panel/js/icons.js` (add `bookmark`, `bookmarkFilled`)
- Modify: `panel/js/render.js` (`buildCard`, `buildRow`, `buildSection`)
- Test: `tests/render.sections.test.js` (new)

**Interfaces:**
- Consumes: `DCSections.collapseKey(name)` (render reads the global; node tests stub it).
- Produces (relied on by Tasks 5–6):
  - Virtual section `<section class="category category--virtual">` with `dataset.section = name`, NO `dataset.category`.
  - Collapse honors `prefs.collapsed` containing `'sec:' + name`.
  - Header: chevron, `span.section-badge` (bookmarkFilled svg), name, count, then `button.category-rename[data-action="renameSection"]` and `button.category-rename.category-delete[data-action="deleteSection"]`.
  - Library cards/rows inside a virtual group: `card.dataset.section = name` and action `removeFromSection` (bookmarkFilled, class `in-section`); cards in normal groups get action `addToSection` (bookmark). Asset cards unchanged.
  - Empty virtual group body: `div.section-empty` with copy `No items — use "Add to Section…" on any comp.`

- [ ] **Step 1: Write the failing tests**

Create `tests/render.sections.test.js` (DOM-stub pattern copied from `tests/render.folder-columns.test.js`):

```js
const test = require('node:test');
const assert = require('node:assert/strict');

global.DCState = require('../panel/js/state.js');
global.DCSections = { collapseKey: (n) => 'sec:' + n };
global.DCIcons = {
  chevron: '<svg></svg>', photoOff: '<svg></svg>', star: '<svg></svg>',
  starFilled: '<svg></svg>', pencil: '<svg></svg>', camera: '<svg></svg>',
  folder: '<svg></svg>', trash: '<svg></svg>', download: '<svg></svg>',
  bookmark: '<svg data-icon="bookmark"></svg>',
  bookmarkFilled: '<svg data-icon="bookmark-filled"></svg>'
};

function makeNode(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    className: '',
    dataset: {},
    attributes: {},
    childNodes: [],
    children: [],
    parentNode: null,
    textContent: '',
    title: '',
    appendChild(child) {
      child.parentNode = node;
      node.childNodes.push(child);
      node.children.push(child);
      return child;
    },
    replaceChild(newChild, oldChild) {
      const i = node.childNodes.indexOf(oldChild);
      if (i !== -1) {
        newChild.parentNode = node;
        node.childNodes[i] = newChild;
        node.children[i] = newChild;
      }
      return oldChild;
    },
    setAttribute(k, v) { node.attributes[k] = String(v); }
  };
  let html = '';
  Object.defineProperty(node, 'innerHTML', {
    get() { return html; },
    set(v) {
      html = String(v);
      if (html === '') {
        node.childNodes = [];
        node.children = [];
      }
    }
  });
  return node;
}

global.document = { createElement: makeNode };
const DCRender = require('../panel/js/render.js');

function prefs(overrides) {
  return Object.assign(DCState.defaultPrefs(), {
    showNames: false, showMeta: false, collapsed: [], collapsedAssets: [],
    folderLayout: 'rows', folderColumns: false
  }, overrides || {});
}

function comp(id, cat) {
  return { uniqueId: id, category: cat, name: id, thumbPath: null };
}

function findAll(node, pred, out) {
  out = out || [];
  if (pred(node)) out.push(node);
  (node.children || []).forEach((c) => findAll(c, pred, out));
  return out;
}

function actionsOf(card) {
  return findAll(card, (n) => n.dataset && n.dataset.action).map((n) => n.dataset.action);
}

function renderGroups(groups, p) {
  const container = makeNode('main');
  DCRender.render(container, groups, p || prefs(), {}, {}, 'empty');
  return container;
}

test('virtual sections carry data-section, never data-category', () => {
  const c = renderGroups([{ category: 'Client X', virtual: true, items: [comp('a_1', 'Anims')] }]);
  const section = c.children[0];
  assert.equal(section.dataset.section, 'Client X');
  assert.equal(section.dataset.category, undefined);
  assert.match(section.className, /category--virtual/);
});

test('category sections are unchanged and their cards offer addToSection', () => {
  const c = renderGroups([{ category: 'Anims', items: [comp('a_1', 'Anims')] }]);
  const section = c.children[0];
  assert.equal(section.dataset.category, 'Anims');
  assert.equal(section.dataset.section, undefined);
  assert.doesNotMatch(section.className, /category--virtual/);
  const card = findAll(section, (n) => n.dataset && n.dataset.uniqueId)[0];
  assert.equal(card.dataset.section, undefined);
  assert.ok(actionsOf(card).includes('addToSection'));
  assert.ok(!actionsOf(card).includes('removeFromSection'));
});

test('cards inside a virtual section swap to removeFromSection and know their section', () => {
  const c = renderGroups([{ category: 'Client X', virtual: true, items: [comp('a_1', 'Anims')] }]);
  const card = findAll(c, (n) => n.dataset && n.dataset.uniqueId)[0];
  assert.equal(card.dataset.section, 'Client X');
  assert.ok(actionsOf(card).includes('removeFromSection'));
  assert.ok(!actionsOf(card).includes('addToSection'));
});

test('virtual headers get badge plus renameSection/deleteSection, not renameCategory', () => {
  const c = renderGroups([{ category: 'Client X', virtual: true, items: [comp('a_1', 'Anims')] }]);
  const actions = findAll(c.children[0], (n) => n.dataset && n.dataset.action).map((n) => n.dataset.action);
  assert.ok(actions.includes('renameSection'));
  assert.ok(actions.includes('deleteSection'));
  assert.ok(!actions.includes('renameCategory'));
  assert.equal(findAll(c.children[0], (n) => n.className === 'section-badge').length, 1);
});

test('virtual collapse honors the sec: prefixed key only', () => {
  const groups = [{ category: 'Client X', virtual: true, items: [comp('a_1', 'Anims')] }];
  let c = renderGroups(groups, prefs({ collapsed: ['sec:Client X'] }));
  assert.match(c.children[0].className, /collapsed/);
  c = renderGroups(groups, prefs({ collapsed: ['Client X'] }));
  assert.doesNotMatch(c.children[0].className, /collapsed/);
});

test('empty virtual sections render the hint body', () => {
  const c = renderGroups([{ category: 'Client X', virtual: true, items: [] }]);
  const hints = findAll(c, (n) => n.className === 'section-empty');
  assert.equal(hints.length, 1);
  assert.match(hints[0].textContent, /Add to Section/);
});

test('list rows follow the same swap rules', () => {
  const groups = [
    { category: 'Client X', virtual: true, items: [comp('a_1', 'Anims')] },
    { category: 'Anims', items: [comp('a_1', 'Anims')] }
  ];
  const c = renderGroups(groups, prefs({ viewMode: 'list' }));
  const cards = findAll(c, (n) => n.dataset && n.dataset.uniqueId);
  assert.ok(actionsOf(cards[0]).includes('removeFromSection'));
  assert.ok(actionsOf(cards[1]).includes('addToSection'));
});

test('asset cards never get section actions', () => {
  const container = makeNode('main');
  DCRender.render(container,
    [{ category: 'Logos', items: [{ uniqueId: 'l_1', category: 'Logos', name: 'L', ext: 'png', filePath: '/x.png' }] }],
    prefs({}), {}, {}, 'empty', 'asset');
  const card = findAll(container, (n) => n.dataset && n.dataset.uniqueId)[0];
  assert.ok(!actionsOf(card).includes('addToSection'));
  assert.ok(!actionsOf(card).includes('removeFromSection'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/render.sections.test.js`
Expected: FAIL — cards lack `addToSection`, sections lack `data-section` etc.

- [ ] **Step 3: Implement icons**

In `panel/js/icons.js`, add to the `I` object after `file` (feather "bookmark", matching the 24×24 stroke-2 language):

```js
    bookmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>',
    bookmarkFilled: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>'
```

(Add a comma after the `file` entry.)

- [ ] **Step 4: Implement render changes**

In `panel/js/render.js`:

4a. `buildCard` — change the signature and add the section action after the favorite button:

```js
  function buildCard(comp, usage, prefs, bust, sectionName) {
```

After the `actions.appendChild(iconBtn('favorite', ...))` call (currently `render.js:72-74`) insert:

```js
    if (sectionName) {
      card.dataset.section = sectionName;
      actions.appendChild(iconBtn('removeFromSection', 'Remove from Section', ICONS.bookmarkFilled, 'in-section'));
    } else {
      actions.appendChild(iconBtn('addToSection', 'Add to Section…', ICONS.bookmark));
    }
```

4b. `buildRow` — change the signature to `function buildRow(item, usage, prefs, kind, bust, sectionName)` and insert the same block after its favorite button append (currently `render.js:198-200`), but guarded for library rows only:

```js
    if (!isAsset) {
      if (sectionName) {
        card.dataset.section = sectionName;
        actions.appendChild(iconBtn('removeFromSection', 'Remove from Section', ICONS.bookmarkFilled, 'in-section'));
      } else {
        actions.appendChild(iconBtn('addToSection', 'Add to Section…', ICONS.bookmark));
      }
    }
```

4c. `buildSection` — replace the opening (currently `render.js:209-229`) with:

```js
  function buildSection(group, prefs, usageMeta, busts, kind, viewMode) {
    var isVirtual = group.virtual === true;
    var collapseId = isVirtual ? DCSections.collapseKey(group.category) : group.category;
    var collapsedList = kind === 'asset' ? prefs.collapsedAssets : prefs.collapsed;
    var collapsed = collapsedList.indexOf(collapseId) !== -1;
    var section = el('section', 'category' + (isVirtual ? ' category--virtual' : '') + (collapsed ? ' collapsed' : ''));
    if (isVirtual) section.dataset.section = group.category;
    else section.dataset.category = group.category;

    var header = el('header', 'category-header');
    header.dataset.action = 'toggleSection';
    header.innerHTML = ICONS.chevron;
    if (isVirtual) {
      var badge = el('span', 'section-badge');
      badge.innerHTML = ICONS.bookmarkFilled;
      header.appendChild(badge);
    }
    header.appendChild(el('span', 'category-name', group.category));
    header.appendChild(el('span', 'category-count', String(group.items.length)));
    if (isVirtual) {
      var renameSecBtn = el('button', 'category-rename');
      renameSecBtn.dataset.action = 'renameSection';
      renameSecBtn.title = 'Rename section';
      renameSecBtn.setAttribute('aria-label', 'Rename section "' + group.category + '"');
      renameSecBtn.innerHTML = ICONS.pencil;
      header.appendChild(renameSecBtn);
      var deleteSecBtn = el('button', 'category-rename category-delete');
      deleteSecBtn.dataset.action = 'deleteSection';
      deleteSecBtn.title = 'Delete section (comps stay)';
      deleteSecBtn.setAttribute('aria-label', 'Delete section "' + group.category + '"');
      deleteSecBtn.innerHTML = ICONS.trash;
      header.appendChild(deleteSecBtn);
    } else if (kind !== 'asset') {
      // library folders are plain disk folders and can be renamed in place;
      // asset categories keep index-coupled ids, so they stay rename-free here
      var renameBtn = el('button', 'category-rename');
      renameBtn.dataset.action = 'renameCategory';
      renameBtn.title = 'Rename folder';
      renameBtn.setAttribute('aria-label', 'Rename folder "' + group.category + '"');
      renameBtn.innerHTML = ICONS.pencil;
      header.appendChild(renameBtn);
    }
    section.appendChild(header);
```

4d. Still in `buildSection`, thread the section name into cards and add the empty hint — replace the container-filling block (currently `render.js:232-244`) with:

```js
    var isList = viewMode === 'list';
    var sectionName = isVirtual ? group.category : null;
    var container = el('div', isList ? 'list' : 'grid');
    if (isVirtual && group.items.length === 0) {
      container.appendChild(el('div', 'section-empty', 'No items — use "Add to Section…" on any comp.'));
    }
    group.items.forEach(function (item) {
      var usage = DCState.getUsage(usageMeta, item.uniqueId);
      if (isList) {
        container.appendChild(buildRow(item, usage, prefs, kind, busts[item.uniqueId], sectionName));
      } else {
        container.appendChild(kind === 'asset'
          ? buildAssetCard(item, usage, prefs)
          : buildCard(item, usage, prefs, busts[item.uniqueId], sectionName));
      }
    });
    section.appendChild(container);
    return section;
  }
```

- [ ] **Step 5: Run the full suite**

Run: `npm test 2>&1 | tail -3`
Expected: `# fail 0`. If `tests/render.folder-columns.test.js` or `tests/render.asset-preview.test.js` fail on a missing `DCSections` global, add `global.DCSections = { collapseKey: (n) => 'sec:' + n };` to their stub blocks.

- [ ] **Step 6: Commit**

```bash
git add panel/js/icons.js panel/js/render.js tests/render.sections.test.js
git commit -m "feat(sections): render pinned virtual sections with add/remove card actions"
```

---

### Task 5: Library flows (add, remove, rename, delete, prune, migrate)

**Files:**
- Modify: `panel/js/library.js`
- Test: `tests/library-sections-flows.test.js` (new)

**Interfaces:**
- Consumes: full `DCSections` API; `DCUI.openCategoryModal('section', ...)`, `DCUI.openRenameModal`/`openDeleteModal`; `DCSync.broadcast('library')`.
- Produces (new `DCLibrary` exports, wired by Task 6):
  - `confirmAddToSection(name: string)` — called by `DCShell.confirmCategoryModal` for mode `'section'`
  - `renameSectionFlow(name)`, `deleteSectionFlow(name)` — header buttons
  - `onCardAction` now accepts `(action, uniqueId, category, section)` and routes `'addToSection'` / `'removeFromSection'`
  - `confirmRename`/`confirmDelete` internally handle section targets first (no new exports)

- [ ] **Step 1: Write the failing tests**

Create `tests/library-sections-flows.test.js` (vm-context pattern copied from `tests/library-card-move.test.js`). Two critical harness rules:

1. The REAL `DCSections` is injected, but with `load`/`save` **bound to an in-memory fs stub**. Without this, flows would hit the real filesystem at `/Library/.dropcomp_sections.json` (root-owned on macOS → save fails with EACCES) and `loadAndBroadcast → load → reloadSections` would wipe in-memory sections mid-test. With the stub, persistence round-trips through the fake file, which is exactly what production does.
2. The bridge stub's comp list is **mutable**: `renameStashedComp` updates the comp's `uniqueId`/`name`, because the flow reloads the index afterward and the load-time prune would otherwise drop the migrated id as stale.

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const librarySrc = fs.readFileSync(path.join(__dirname, '..', 'panel', 'js', 'library.js'), 'utf8');
const RealSections = require('../panel/js/sections.js');

function stubFs(files) {
  return {
    existsSync: (p) => Object.prototype.hasOwnProperty.call(files, p),
    readFileSync: (p) => {
      if (!Object.prototype.hasOwnProperty.call(files, p)) throw new Error('ENOENT');
      return files[p];
    },
    writeFileSync: (p, data) => { files[p] = data; },
    renameSync: (from, to) => { files[to] = files[from]; delete files[from]; },
  };
}

// DCSections with load/save pinned to an in-memory file map
function sectionsWithMemFs() {
  const fsStub = stubFs({});
  return Object.assign({}, RealSections, {
    load: (libPath) => RealSections.load(libPath, fsStub),
    save: (libPath, model) => RealSections.save(libPath, model, fsStub),
  });
}

function makeCalls() {
  return { broadcasts: [], toasts: [], renders: [], modals: [], bridge: [] };
}

function makeContext(calls, comps) {
  const els = {
    search: { value: '' },
    library: {},
    categoryModal: { name: 'categoryModal' },
    renameModal: { name: 'renameModal' },
    deleteModal: { name: 'deleteModal' },
    newNameInput: { value: '' },
    addCompBtn: { disabled: false },
  };
  const context = {
    localStorage: { getItem() { return null; }, setItem() {} },
    Date,
    JSON,
    DCSections: sectionsWithMemFs(),
    DCShell: {
      getLibraryPath() { return '/Library'; },
      getPrefs() {
        return {
          activeTab: 'library', favoritesOnly: false, sort: 'name',
          collapsed: [], viewMode: 'comfortable', folderColumns: true,
          showNames: true, showMeta: true,
        };
      },
      getEls() { return els; },
      persistPrefs() {},
    },
    DCUI: {
      spinner() {},
      toast(msg, isErr) { calls.toasts.push({ msg: String(msg), isErr: !!isErr }); },
      isError(r) { return typeof r === 'string' && r.indexOf('Error') === 0; },
      openCategoryModal(mode, title, names) { calls.modals.push({ mode, title, names }); },
      openRenameModal(owner, name) { calls.modals.push({ owner, name, kind: 'rename' }); },
      openDeleteModal(owner, name) { calls.modals.push({ owner, name, kind: 'delete' }); },
      closeModal() {},
    },
    DCBridge: {
      acquire() { return true; },
      release() {},
      parseJson(r) { try { return JSON.parse(r); } catch (e) { return null; } },
      call(fnName, args, cb) {
        calls.bridge.push({ fnName, args });
        if (fnName === 'getStashedComps') cb(JSON.stringify(comps));
        else if (fnName === 'renameStashedComp') {
          // mirror the host: the item's id and name change on disk, so the
          // reload that follows must serve the renamed comp (else the
          // load-time prune would drop the migrated id as stale)
          comps[0].uniqueId = 'Fresh_1700000000000';
          comps[0].name = 'Fresh';
          cb('{"ok":true,"newUniqueId":"Fresh_1700000000000"}');
        }
        else if (fnName === 'deleteStashedComp') cb('Success');
      },
    },
    DCSync: { broadcast(kind) { calls.broadcasts.push(kind); } },
    DCState: {
      loadUsageMeta() { return {}; },
      saveUsageMeta() {},
      cleanupStaleMetadata(usageMeta) { return { removed: 0, usageMeta }; },
      migrateMetadataKey(meta) { return meta; },
      filterComps(items) { return items; },
      groupByCategory(items) {
        return items.length ? [{ category: items[0].category, items }] : [];
      },
      sortComps(items) { return items; },
      getUsage() { return { lastUsed: 0, useCount: 0, isFavorite: false }; },
    },
    DCValidate: {
      validateName(name) { return { valid: true, name: String(name).trim() }; },
    },
    DCRender: {
      render(container, groups) { calls.renders.push(groups); },
    },
    module: { exports: {} },
    console,
  };
  context.global = context;
  vm.createContext(context);
  vm.runInContext(librarySrc, context);
  return context;
}

function baseComps() {
  return [{
    name: 'Step Anim',
    uniqueId: 'Step_Anim_1700000000000',
    category: 'Anims',
    aepPath: '/Library/Anims/Step_Anim_1700000000000/Step_Anim.aep',
  }];
}

function loaded(calls, comps) {
  const ctx = makeContext(calls, comps || baseComps());
  ctx.DCLibrary.init();
  ctx.DCLibrary.load();
  return ctx;
}

test('addToSection card action opens the section modal with existing names', () => {
  const calls = makeCalls();
  const ctx = loaded(calls);
  ctx.DCLibrary.onCardAction('addToSection', 'Step_Anim_1700000000000', 'Anims');
  ctx.DCLibrary.confirmAddToSection('Client X');
  ctx.DCLibrary.onCardAction('addToSection', 'Step_Anim_1700000000000', 'Anims');
  const modal = calls.modals[calls.modals.length - 1];
  assert.equal(modal.mode, 'section');
  assert.deepEqual(modal.names, ['Client X']);
});

test('confirmAddToSection adds, broadcasts, rerenders, and pins the group', () => {
  const calls = makeCalls();
  const ctx = loaded(calls);
  ctx.DCLibrary.onCardAction('addToSection', 'Step_Anim_1700000000000', 'Anims');
  ctx.DCLibrary.confirmAddToSection('Client X');
  assert.deepEqual(calls.broadcasts, ['library']);
  const groups = calls.renders[calls.renders.length - 1];
  assert.equal(groups[0].category, 'Client X');
  assert.equal(groups[0].virtual, true);
  assert.deepEqual(groups[0].items.map((c) => c.uniqueId), ['Step_Anim_1700000000000']);
  assert.equal(groups[1].category, 'Anims');
});

test('adding twice toasts instead of duplicating', () => {
  const calls = makeCalls();
  const ctx = loaded(calls);
  ctx.DCLibrary.onCardAction('addToSection', 'Step_Anim_1700000000000', 'Anims');
  ctx.DCLibrary.confirmAddToSection('Client X');
  ctx.DCLibrary.onCardAction('addToSection', 'Step_Anim_1700000000000', 'Anims');
  ctx.DCLibrary.confirmAddToSection('Client X');
  assert.equal(calls.broadcasts.length, 1);
  assert.match(calls.toasts[calls.toasts.length - 1].msg, /Already in/);
});

test('removeFromSection unlinks only the section entry', () => {
  const calls = makeCalls();
  const ctx = loaded(calls);
  ctx.DCLibrary.onCardAction('addToSection', 'Step_Anim_1700000000000', 'Anims');
  ctx.DCLibrary.confirmAddToSection('Client X');
  ctx.DCLibrary.onCardAction('removeFromSection', 'Step_Anim_1700000000000', 'Anims', 'Client X');
  const groups = calls.renders[calls.renders.length - 1];
  assert.equal(groups[0].category, 'Client X');
  assert.deepEqual(groups[0].items, []);
  assert.equal(groups[1].category, 'Anims');
  assert.equal(groups[1].items.length, 1);
});

test('deleting a comp clears it from every section', () => {
  const calls = makeCalls();
  const ctx = loaded(calls);
  ctx.DCLibrary.onCardAction('addToSection', 'Step_Anim_1700000000000', 'Anims');
  ctx.DCLibrary.confirmAddToSection('Client X');
  ctx.DCLibrary.onCardAction('delete', 'Step_Anim_1700000000000', 'Anims');
  ctx.DCLibrary.confirmDelete();
  // deletion triggers loadAndBroadcast -> load; comp list still contains the
  // comp in this stub, so assert via the model: the section no longer holds it
  ctx.DCLibrary.onCardAction('addToSection', 'Step_Anim_1700000000000', 'Anims');
  const modal = calls.modals[calls.modals.length - 1];
  assert.deepEqual(modal.names, ['Client X']);
  ctx.DCLibrary.confirmAddToSection('Client X');
  assert.match(calls.toasts[calls.toasts.length - 1].msg, /Added to/);
});

test('renaming a comp migrates its id inside sections', () => {
  const calls = makeCalls();
  const ctx = loaded(calls);
  ctx.DCLibrary.onCardAction('addToSection', 'Step_Anim_1700000000000', 'Anims');
  ctx.DCLibrary.confirmAddToSection('Client X');
  ctx.DCLibrary.onCardAction('rename', 'Step_Anim_1700000000000', 'Anims');
  ctx.DCShell.getEls().newNameInput.value = 'Fresh';
  ctx.DCLibrary.confirmRename();
  // adding the NEW id must report "already in" - membership followed the rename
  ctx.DCLibrary.onCardAction('addToSection', 'Fresh_1700000000000', 'Anims');
  ctx.DCLibrary.confirmAddToSection('Client X');
  assert.match(calls.toasts[calls.toasts.length - 1].msg, /Already in/);
});

test('section rename via header keeps membership and collapse key', () => {
  const calls = makeCalls();
  const ctx = loaded(calls);
  ctx.DCLibrary.onCardAction('addToSection', 'Step_Anim_1700000000000', 'Anims');
  ctx.DCLibrary.confirmAddToSection('Client X');
  ctx.DCLibrary.renameSectionFlow('Client X');
  ctx.DCShell.getEls().newNameInput.value = 'Client Y';
  ctx.DCLibrary.confirmRename();
  const groups = calls.renders[calls.renders.length - 1];
  assert.equal(groups[0].category, 'Client Y');
  assert.equal(groups[0].items.length, 1);
});

test('section delete removes only the grouping', () => {
  const calls = makeCalls();
  const ctx = loaded(calls);
  ctx.DCLibrary.onCardAction('addToSection', 'Step_Anim_1700000000000', 'Anims');
  ctx.DCLibrary.confirmAddToSection('Client X');
  ctx.DCLibrary.deleteSectionFlow('Client X');
  ctx.DCLibrary.confirmDelete();
  const groups = calls.renders[calls.renders.length - 1];
  assert.equal(groups.length, 1);
  assert.equal(groups[0].category, 'Anims');
  assert.equal(groups[0].items.length, 1);
});

test('empty sections hide while searching', () => {
  const calls = makeCalls();
  const ctx = loaded(calls);
  ctx.DCLibrary.onCardAction('addToSection', 'Step_Anim_1700000000000', 'Anims');
  ctx.DCLibrary.confirmAddToSection('Client X');
  ctx.DCLibrary.onCardAction('removeFromSection', 'Step_Anim_1700000000000', 'Anims', 'Client X');
  ctx.DCShell.getEls().search.value = 'step';
  ctx.DCLibrary.rerender();
  const groups = calls.renders[calls.renders.length - 1];
  assert.equal(groups.length, 1);
  assert.equal(groups[0].category, 'Anims');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/library-sections-flows.test.js`
Expected: FAIL — `onCardAction` ignores `addToSection`; `confirmAddToSection` is not a function.

- [ ] **Step 3: Implement library.js wiring**

All edits in `panel/js/library.js`:

3a. Extend the module state (after `var DRAG_MIME = ...`, line 14):

```js
  var sectionsModel = DCSections.emptyModel();
  var pendingSectionAdd = null;
  var renameSectionTarget = null;
  var deleteSectionTarget = null;
```

3b. Add the persistence helper (after `persistUsage`, line 20):

```js
  // Section mutations are pure JSON writes - no host call, so no bridge lock.
  // Broadcast only on user mutations; load-time prunes stay silent (every
  // panel prunes itself on its own load - broadcasting would echo).
  function persistSections(broadcast) {
    var r = DCSections.save(libPath(), sectionsModel);
    if (!r.ok) { DCUI.toast(r.error, true); return false; }
    if (broadcast && typeof DCSync !== 'undefined') DCSync.broadcast('library');
    return true;
  }

  function reloadSections() {
    var sec = DCSections.load(libPath());
    sectionsModel = sec.model;
    if (sec.corrupt) {
      DCUI.toast('Sections file was unreadable and has been quarantined; starting fresh.', true);
    }
  }
```

3c. In `load()` — call `reloadSections();` as the first line of the `getStashedComps` callback, and prune after `allComps` is parsed (right after the `cleanupStaleMetadata` block):

```js
        if (DCSections.prune(sectionsModel, allComps.map(function (c) { return c.uniqueId; }))) {
          persistSections(false);
        }
```

3d. In `refresh()` — same two additions in the `rebuildLibraryIndex` callback.

3e. In `rerender()` — build pinned groups. Replace the `var groups = ...` statement with:

```js
    var groups = DCSections.buildGroups(sectionsModel, filtered, function (items) {
      return DCState.sortComps(items, prefs.sort, usageMeta);
    }, !!(els().search.value || prefs.favoritesOnly)).concat(
      DCState.groupByCategory(filtered).map(function (g) {
        return { category: g.category, items: DCState.sortComps(g.items, prefs.sort, usageMeta) };
      }));
```

3f. Add the flows (after `toggleFavorite`):

```js
  function addToSectionFlow(uniqueId) {
    pendingSectionAdd = uniqueId;
    DCUI.openCategoryModal('section', 'Add to Section', DCSections.sectionNames(sectionsModel));
  }

  function confirmAddToSection(name) {
    var uniqueId = pendingSectionAdd;
    pendingSectionAdd = null;
    DCUI.closeModal(els().categoryModal);
    if (!uniqueId || !findComp(uniqueId)) return;
    if (!DCSections.add(sectionsModel, name, uniqueId)) {
      DCUI.toast('Already in "' + name + '".', false);
      return;
    }
    if (persistSections(true)) DCUI.toast('Added to "' + name + '".', false);
    rerender();
  }

  function removeFromSection(sectionName, uniqueId) {
    if (!sectionName || !DCSections.remove(sectionsModel, sectionName, uniqueId)) return;
    persistSections(true);
    rerender();
  }

  function renameSectionFlow(name) {
    if (!name) return;
    renameTarget = null;
    renameCategoryTarget = null;
    renameSectionTarget = name;
    DCUI.openRenameModal('library', name);
  }

  function confirmSectionRename() {
    var oldName = renameSectionTarget;
    renameSectionTarget = null;
    var newName = els().newNameInput.value.trim();
    DCUI.closeModal(els().renameModal);
    if (!newName || newName === oldName) return;
    var v = DCValidate.validateName(newName, 'Section name');
    if (!v.valid) { DCUI.toast(v.error, true); return; }
    var r = DCSections.renameSection(sectionsModel, oldName, v.name);
    if (!r.ok) { DCUI.toast(r.error, true); return; }
    // keep the section's collapsed state under its new key
    var prefs = DCShell.getPrefs();
    var ci = prefs.collapsed.indexOf(DCSections.collapseKey(oldName));
    if (ci !== -1) { prefs.collapsed.splice(ci, 1, DCSections.collapseKey(v.name)); DCShell.persistPrefs(); }
    if (persistSections(true)) DCUI.toast('Section renamed to "' + v.name + '".', false);
    rerender();
  }

  function deleteSectionFlow(name) {
    if (!name) return;
    deleteTarget = null;
    deleteSectionTarget = name;
    DCUI.openDeleteModal('library', name + ' (section only - comps stay)');
  }

  function confirmSectionDelete() {
    var name = deleteSectionTarget;
    deleteSectionTarget = null;
    DCUI.closeModal(els().deleteModal);
    if (!name || !DCSections.deleteSection(sectionsModel, name)) return;
    if (persistSections(true)) DCUI.toast('Section deleted.', false);
    rerender();
  }
```

3g. Route the shared modals — first lines of `confirmRename()` and `confirmDelete()`:

```js
  function confirmRename() {
    if (renameSectionTarget) { confirmSectionRename(); return; }
    if (renameCategoryTarget) { confirmCategoryRename(); return; }
    ...
```

```js
  function confirmDelete() {
    if (deleteSectionTarget) { confirmSectionDelete(); return; }
    if (!deleteTarget) return;
    ...
```

3h. Comp-rename migration — in `confirmRename`'s success branch, after `DCState.migrateMetadataKey(...)`:

```js
        if (DCSections.migrateId(sectionsModel, t.uniqueId, r.newUniqueId)) persistSections(false);
```

3i. Comp-delete cleanup — in `confirmDelete`'s `result === 'Success'` branch, before `loadAndBroadcast()`:

```js
        if (DCSections.removeEverywhere(sectionsModel, t.uniqueId)) persistSections(false);
```

(`loadAndBroadcast` already fires the `'library'` broadcast — a second one would be redundant.)

3j. Card action routing — `onCardAction` gains the 4th parameter:

```js
  function onCardAction(action, uniqueId, category, section) {
    if (action === 'import') importItem(uniqueId);
    else if (action === 'favorite') toggleFavorite(uniqueId);
    else if (action === 'addToSection') addToSectionFlow(uniqueId);
    else if (action === 'removeFromSection') removeFromSection(section, uniqueId);
    else if (action === 'rename') renameFlow(uniqueId, category);
    ...
```

3k. `clearPending()` — also null the new pending state:

```js
    pendingSectionAdd = null;
    renameSectionTarget = null;
    deleteSectionTarget = null;
```

3l. Exports — add to the returned object:

```js
    confirmAddToSection: confirmAddToSection,
    renameSectionFlow: renameSectionFlow, deleteSectionFlow: deleteSectionFlow,
```

3m. Existing tests that stub `DCLibrary`'s context (`tests/library-card-move.test.js`, `tests/library-rename-category.test.js`) now need `DCSections` in their vm context. Add to each `makeContext`:

```js
    DCSections: require('../panel/js/sections.js'),
```

- [ ] **Step 4: Run the full suite**

Run: `npm test 2>&1 | tail -3`
Expected: `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add panel/js/library.js tests/library-sections-flows.test.js tests/library-card-move.test.js tests/library-rename-category.test.js
git commit -m "feat(sections): wire section flows into the library module"
```

---

### Task 6: Shell/main routing, modal mode, and script includes

**Files:**
- Modify: `panel/js/shell.js`, `panel/js/main.js`, `panel/index.html`, `panel/_harness.html`
- Test: `tests/sections-wiring.test.js` (new)

**Interfaces:**
- Consumes: `DCLibrary.confirmAddToSection`, `DCLibrary.renameSectionFlow`, `DCLibrary.deleteSectionFlow`, `DCSections.collapseKey`, render's `data-section` / `dataset.section` contract.
- Produces: end-to-end click routing; `sections.js` loaded in both HTML shells.

- [ ] **Step 1: Write the failing tests**

Create `tests/sections-wiring.test.js` (source-regex style, like `tests/folder-columns-css.test.js`):

```js
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const indexHtml = read('panel/index.html');
const harnessHtml = read('panel/_harness.html');
const shellSrc = read('panel/js/shell.js');
const mainSrc = read('panel/js/main.js');

test('both html shells load sections.js after state.js and before library.js', () => {
  [indexHtml, harnessHtml].forEach((html) => {
    const stateAt = html.indexOf('js/state.js');
    const sectionsAt = html.indexOf('js/sections.js');
    const libraryAt = html.indexOf('js/library.js');
    assert.ok(sectionsAt !== -1, 'sections.js script tag missing');
    assert.ok(stateAt < sectionsAt && sectionsAt < libraryAt, 'sections.js in wrong order');
  });
});

test('shell routes the section category-modal mode to the library', () => {
  assert.match(shellSrc, /mode === 'section'/);
  assert.match(shellSrc, /DCLibrary\.confirmAddToSection/);
});

test('shell exposes renameSection and deleteSection passthroughs', () => {
  assert.match(shellSrc, /function renameSection\(/);
  assert.match(shellSrc, /DCLibrary\.renameSectionFlow/);
  assert.match(shellSrc, /function deleteSection\(/);
  assert.match(shellSrc, /DCLibrary\.deleteSectionFlow/);
});

test('shell forwards the card section context', () => {
  assert.match(shellSrc, /onCardAction\(action, uniqueId, category, section\)/);
});

test('main routes section header actions and card section datasets', () => {
  assert.match(mainSrc, /renameSection/);
  assert.match(mainSrc, /deleteSection/);
  assert.match(mainSrc, /dataset\.section/);
  assert.match(mainSrc, /DCSections\.collapseKey/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/sections-wiring.test.js`
Expected: FAIL on every assertion.

- [ ] **Step 3: Implement**

3a. `panel/index.html` — after `<script src="js/state.js"></script>` (line 371) add:

```html
<script src="js/sections.js"></script>
```

3b. `panel/_harness.html` — same insertion after its `js/state.js` line (line 367).

3c. `panel/js/shell.js`:

- In `confirmCategoryModal()` (line 204), insert a branch before the final `else`:

```js
    if (mode === 'addAssets' && hasAssets()) DCAssets.confirmCategory(v.name);
    else if (mode === 'addShape' && hasAssets()) DCAssets.confirmShapeCategory(v.name);
    else if (mode === 'section') DCLibrary.confirmAddToSection(v.name);
    else DCLibrary.confirmCategory(mode, v.name);
```

- Replace `onCardAction` (line 298):

```js
  function onCardAction(action, uniqueId, category, section) {
    activeModule().onCardAction(action, uniqueId, category, section);
  }
```

- Next to `renameCategory` (line 304) add:

```js
  // section header affordances only render on virtual Library sections
  function renameSection(name) { DCLibrary.renameSectionFlow(name); }
  function deleteSection(name) { DCLibrary.deleteSectionFlow(name); }
```

- Add `renameSection: renameSection, deleteSection: deleteSection,` to the returned object (after `renameCategory`).

3d. `panel/js/main.js` — replace the library click handler's action routing (lines 126-141):

```js
  els.library.addEventListener('click', function (e) {
    var actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    var action = actionEl.dataset.action;
    if (action === 'toggleSection') {
      var sec = actionEl.closest('.category');
      DCShell.toggleSection(sec.dataset.category || DCSections.collapseKey(sec.dataset.section));
      return;
    }
    if (action === 'renameCategory') {
      DCShell.renameCategory(actionEl.closest('.category').dataset.category);
      return;
    }
    if (action === 'renameSection') {
      DCShell.renameSection(actionEl.closest('.category').dataset.section);
      return;
    }
    if (action === 'deleteSection') {
      DCShell.deleteSection(actionEl.closest('.category').dataset.section);
      return;
    }
    var card = actionEl.closest('.card');
    if (!card) return;
    DCShell.onCardAction(action, card.dataset.uniqueId, card.dataset.category, card.dataset.section);
  });
```

- [ ] **Step 4: Run the full suite**

Run: `npm test 2>&1 | tail -3`
Expected: `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add panel/index.html panel/_harness.html panel/js/shell.js panel/js/main.js tests/sections-wiring.test.js
git commit -m "feat(sections): route section actions through shell and main"
```

---

### Task 7: CSS for badges, header delete, and empty hint

**Files:**
- Modify: `panel/css/style.css`
- Test: `tests/sections-css.test.js` (new)

**Interfaces:**
- Consumes: class names from Task 4 (`.category--virtual`, `.section-badge`, `.category-delete`, `.section-empty`, `.card-action.in-section`).
- Notes: `#library.grid--s` already hides every card action except favorite/delete (`style.css:340`), so the new bookmark button auto-hides at small sizes — no size-rule changes needed.

- [ ] **Step 1: Write the failing tests**

Create `tests/sections-css.test.js`:

```js
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const css = fs.readFileSync(path.join(__dirname, '..', 'panel', 'css', 'style.css'), 'utf8');

test('virtual section badge is styled', () => {
  assert.match(css, /\.section-badge svg/);
});

test('section delete header button gets the danger hover', () => {
  assert.match(css, /\.category-delete:hover/);
});

test('empty section hint is styled', () => {
  assert.match(css, /\.section-empty/);
});

test('in-section card action reads as active', () => {
  assert.match(css, /\.card-action\.in-section/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/sections-css.test.js`
Expected: FAIL on all four.

- [ ] **Step 3: Implement**

In `panel/css/style.css`, after the `.category-rename` block (ends near line 213), add:

```css
/* ---- virtual sections (client groups) ---- */
.category--virtual > .category-header .category-name { color: var(--gold); }
.section-badge { display: inline-flex; align-items: center; color: var(--gold); }
.section-badge svg { width: 11px; height: 11px; }
.category-delete:hover { color: var(--danger); }
.section-empty {
  padding: 10px 12px;
  font-size: 11px;
  color: var(--text-mid);
}
.card-action.in-section { opacity: 1; color: var(--gold); }
```

(If `--danger` is not defined in `:root`, reuse the value already used by `.card-action[data-action="delete"]:hover` at `style.css:275`.)

- [ ] **Step 4: Run the full suite**

Run: `npm test 2>&1 | tail -3`
Expected: `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add panel/css/style.css tests/sections-css.test.js
git commit -m "feat(sections): style virtual section headers and card bookmark action"
```

---

### Task 8: Manual checklist, harness sanity, and finish

**Files:**
- Modify: `docs/superpowers/2026-06-18-manual-ae-checklist.md`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Append the manual AE checklist section**

Add to `docs/superpowers/2026-06-18-manual-ae-checklist.md`:

```markdown
## Library Sections (2026-07-19)

- [ ] Card > bookmark icon > type "Client X" > comp appears pinned in a "Client X" section AND stays in its home folder
- [ ] Bookmark a second comp into "Client X" via the select dropdown (no retype)
- [ ] Import works from the section card; double-click too
- [ ] "Remove from Section" on the section card unlinks it; home copy untouched
- [ ] Section header rename > membership and collapse state survive
- [ ] Section header delete > section gone, comps still in their folders
- [ ] Delete a comp that is in a section > section entry disappears too
- [ ] Rename a comp that is in a section > still listed in the section under the new name
- [ ] Collapse "Client X", relaunch panel > still collapsed; a category with the same name collapses independently
- [ ] Search hides empty sections; clearing search shows them again
- [ ] Second panel open (Library standalone): add to a section in one > other converges
- [ ] Quit AE, corrupt .dropcomp_sections.json by hand, relaunch > warning toast, file quarantined as .corrupt-*, library still loads
```

- [ ] **Step 2: Full suite + line-count check**

```bash
npm test 2>&1 | tail -3
wc -l panel/js/sections.js panel/js/library.js
```

Expected: `# fail 0`; `sections.js` < 400. `library.js` will be ~600 — it already carries the `# TODO: split by concern` marker (400–800 band: allowed, split at next opportunity; do NOT restructure in this feature branch).

- [ ] **Step 3: Harness smoke test**

Open `panel/_harness.html` in a browser (or via the preview MCP — note it serves the MAIN repo dir; use an absolute-path config for the worktree, see memory note). Verify: bookmark icon on cards, add-to-section modal opens, pinned section renders, remove works (in-memory only in the browser — no Node fs there, by design).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/2026-06-18-manual-ae-checklist.md
git commit -m "docs(sections): add sections to the manual AE checklist"
```

- [ ] **Step 5: Finish the branch**

Use superpowers:finishing-a-development-branch. Constraints from memory: one branch integrates at a time; `feature/nav-rail` line is still unmerged and another session owns the main checkout — so push `feature/library-sections` and stop; do NOT merge into `feature/nav-rail` or `main` without Ziscol's go-ahead. Leave the worktree in place until integration.

---

## Self-review notes

- Spec coverage: data model + quarantine (T2/T3), pinned rendering + badge + collapse prefix + drag exclusion + empty rule (T4), add/remove/rename/delete flows + prune + migrate + broadcast (T5), modal mode + routing + script includes (T6), CSS (T7), manual checklist + multi-panel item (T8). Assets-tab exclusion honored (render guard in T4, no assets wiring anywhere).
- The `'library'` DCSync kind is reused for section changes (other panels do a full library reload, which re-reads the sections file) — no new sync kind needed.
- `DCValidate.validateName` guards both the modal path (shell) and the section-rename path (library) — section names can't contain path-hostile characters even though they never touch the filesystem as paths.
