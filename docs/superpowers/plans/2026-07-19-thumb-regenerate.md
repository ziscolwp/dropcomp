# Regenerate Thumbnail + Full-Res Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-click background thumbnail regeneration on every comp card, and full-resolution capture in both jsx capture paths.

**Architecture:** UI-side, a new `generate` hover action in both card builders reuses the existing `onCardAction('generate')` → `generateThumb()` pipeline untouched. Jsx-side, `saveVerifiedThumb` and `setThumbFromActiveComp` force `resolutionFactor = [1,1]` around capture and restore in `finally`.

**Tech Stack:** Panel JS (ES5-style modules), ExtendScript ES3, `node:test` (vm fake-AE harness + DOM-stub render tests).

## Global Constraints

- Branch: `feature/thumb-regenerate` (created off feature/nav-rail; spec committed).
- Spec: `docs/superpowers/specs/2026-07-19-thumb-regenerate-design.md`.
- ExtendScript is ES3: `var` only, no arrow functions, no const/let (checked by `tests/jsx.es3.test.js`).
- Never `git add -A` — stage exact paths (parallel sessions share this tree).
- Test runner: `npm test` → `node --test "tests/**/*.test.js"`; single file: `node --test tests/<file>`.
- Do not modify `panel/_harness.html` — the buttons come from shared `render.js`.

---

### Task 1: Regenerate hover action in grid and list cards

**Files:**
- Create: `tests/render.regenerate.test.js`
- Modify: `panel/js/icons.js` (add `refresh` icon to the `DCIcons` object)
- Modify: `panel/js/render.js:81-82` (buildCard actions) and `panel/js/render.js:215-216` (buildRow actions)

**Interfaces:**
- Consumes: `iconBtn(action, title, svg)` helper in render.js; `ICONS` alias of `DCIcons`; existing dispatch `onCardAction('generate', …)` in library.js (unchanged).
- Produces: comp cards (grid + list) contain `<button class="card-action" data-action="generate" title="Regenerate thumbnail">`. No later task depends on this.

- [ ] **Step 1: Write the failing test**

Create `tests/render.regenerate.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

global.DCState = require('../panel/js/state.js');
global.DCIcons = {
  chevron: '<svg></svg>',
  photoOff: '<svg class="photo-off"></svg>',
  star: '<svg></svg>',
  starFilled: '<svg></svg>',
  pencil: '<svg></svg>',
  camera: '<svg></svg>',
  folder: '<svg></svg>',
  trash: '<svg></svg>',
  download: '<svg></svg>',
  bookmark: '<svg></svg>',
  bookmarkFilled: '<svg></svg>',
  refresh: '<svg class="refresh"></svg>'
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
    showNames: false,
    showMeta: false,
    collapsed: [],
    collapsedAssets: [],
    folderColumns: false
  }, overrides || {});
}

function findByAction(node, action, out) {
  out = out || [];
  if (node.dataset && node.dataset.action === action) out.push(node);
  (node.childNodes || []).forEach((c) => findByAction(c, action, out));
  return out;
}

function compGroups(comp) {
  return [{ category: 'ClientA', items: [comp] }];
}

test('grid comp cards with a thumbnail get a Regenerate hover action', () => {
  const container = makeNode('main');
  const comp = { uniqueId: 'c1', category: 'ClientA', name: 'UI card', thumbPath: '/lib/ClientA/c1/comp.png' };
  DCRender.render(container, compGroups(comp), prefs(), {}, {}, 'empty');

  const gens = findByAction(container, 'generate');
  assert.equal(gens.length, 1, 'exactly one generate control on a thumbed card');
  assert.equal(gens[0].tagName, 'BUTTON');
  assert.equal(gens[0].title, 'Regenerate thumbnail');
  assert.ok(String(gens[0].className).indexOf('card-action') !== -1, 'lives in the hover action row');
});

test('grid comp cards without a thumbnail keep the chip and gain the hover action', () => {
  const container = makeNode('main');
  const comp = { uniqueId: 'c2', category: 'ClientA', name: 'No thumb', thumbPath: null };
  DCRender.render(container, compGroups(comp), prefs(), {}, {}, 'empty');

  const gens = findByAction(container, 'generate');
  const classes = gens.map((n) => String(n.className));
  assert.ok(classes.some((c) => c.indexOf('generate-chip') !== -1), 'placeholder chip still present');
  assert.ok(classes.some((c) => c.indexOf('card-action') !== -1), 'hover action also present');
});

test('list view comp rows get the Regenerate action', () => {
  const container = makeNode('main');
  const comp = { uniqueId: 'c3', category: 'ClientA', name: 'Rowed', thumbPath: '/lib/ClientA/c3/comp.png' };
  DCRender.render(container, compGroups(comp), prefs({ viewMode: 'list' }), {}, {}, 'empty');

  const gens = findByAction(container, 'generate');
  assert.equal(gens.length, 1, 'list rows expose regenerate');
  assert.equal(gens[0].title, 'Regenerate thumbnail');
});

test('asset cards never get a generate action (grid and list)', () => {
  const grid = makeNode('main');
  const asset = { uniqueId: 'a1', category: 'Icons', name: 'logo.svg', ext: 'svg', filePath: '/lib/assets/logo.svg' };
  DCRender.render(grid, [{ category: 'Icons', items: [asset] }], prefs(), {}, {}, 'empty', 'asset');
  assert.equal(findByAction(grid, 'generate').length, 0, 'no generate on asset grid cards');

  const list = makeNode('main');
  DCRender.render(list, [{ category: 'Icons', items: [asset] }], prefs({ viewModeAssets: 'list' }), {}, {}, 'empty', 'asset');
  assert.equal(findByAction(list, 'generate').length, 0, 'no generate on asset rows');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/render.regenerate.test.js`
Expected: FAIL — grid/list comp tests find no `card-action` generate button (the no-thumb test finds only the chip).

- [ ] **Step 3: Implement**

In `panel/js/icons.js`, inside the `DCIcons` object (next to `camera`), add:

```js
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>',
```

In `panel/js/render.js` `buildCard`, before the `setThumb` line:

```js
    actions.appendChild(iconBtn('generate', 'Regenerate thumbnail', ICONS.refresh));
    actions.appendChild(iconBtn('setThumb', 'Set thumbnail from current frame', ICONS.camera));
```

In `panel/js/render.js` `buildRow`, before the `setThumb` line:

```js
    if (!isAsset) actions.appendChild(iconBtn('generate', 'Regenerate thumbnail', ICONS.refresh));
    if (!isAsset) actions.appendChild(iconBtn('setThumb', 'Set thumbnail from current frame', ICONS.camera));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/render.regenerate.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/render.regenerate.test.js panel/js/icons.js panel/js/render.js
git commit -m "feat(library): add one-click Regenerate thumbnail action to comp cards"
```

---

### Task 2: Full-resolution capture in saveVerifiedThumb

**Files:**
- Modify: `tests/thumb-capture.test.js` (makeComp harness + 2 new tests)
- Modify: `jsx/hostscript.jsx:463-496` (`saveVerifiedThumb`)

**Interfaces:**
- Consumes: fake-AE harness in `tests/thumb-capture.test.js` (`loadThumbEngine`, `makePngContent`, `state`).
- Produces: `saveVerifiedThumb(comp, pngFile)` — same signature and return contract; additionally guarantees `comp.resolutionFactor` is `[1,1]` during every `saveFrameToPng` and restored before returning.

- [ ] **Step 1: Extend the harness and write the failing tests**

In `tests/thumb-capture.test.js`, change the `state` line in `loadThumbEngine` to:

```js
  const state = { raceDetected: false, saveCalls: 0, resDuringSave: [] };
```

Replace `makeComp` with:

```js
  function makeComp(renderPlan) {
    // renderPlan: (time, file) -> { content, rate } for the fake writer
    const comp = {
      workAreaStart: 0,
      workAreaDuration: 10,
      resolutionFactor: [3, 3],
    };
    comp.saveFrameToPng = function (time, file) {
      state.saveCalls += 1;
      state.resDuringSave.push(comp.resolutionFactor.join('x'));
      const inFlight = jobs.some(
        (j) => j.path === file.fsName && j.written < j.content.length
      );
      if (inFlight) state.raceDetected = true;
      const plan = renderPlan(time, file);
      disk.set(file.fsName, '');
      jobs.push({ path: file.fsName, content: plan.content, written: 0, rate: plan.rate });
    };
    return comp;
  }
```

Append two tests at the end of the file:

```js
test('saveVerifiedThumb renders at full resolution and restores the original', () => {
  const engine = loadThumbEngine();
  const full = makePngContent(200000);
  const comp = engine.makeComp(() => ({ content: full, rate: 40 }));
  const png = new engine.FakeFile('/lib/cat/item/comp.png');

  const ok = engine.context.saveVerifiedThumb(comp, png);

  assert.equal(ok, true);
  assert.ok(engine.state.resDuringSave.length > 0, 'at least one render must have run');
  engine.state.resDuringSave.forEach((res) =>
    assert.equal(res, '1x1', 'every saveFrameToPng must run at Full resolution')
  );
  assert.deepEqual(comp.resolutionFactor, [3, 3], 'original resolution must be restored');
});

test('saveVerifiedThumb restores resolution even when the writer dies', () => {
  const engine = loadThumbEngine();
  const truncated = makePngContent(100000).slice(0, 500);
  const comp = engine.makeComp(() => ({ content: truncated, rate: 40 }));
  const png = new engine.FakeFile('/lib/cat/item/comp.png');

  const ok = engine.context.saveVerifiedThumb(comp, png);

  assert.equal(ok, false);
  assert.deepEqual(comp.resolutionFactor, [3, 3], 'restore must happen on the failure path too');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/thumb-capture.test.js`
Expected: FAIL — `resDuringSave` entries are `3x3` (existing 5 tests still pass).

- [ ] **Step 3: Implement in `jsx/hostscript.jsx`**

Replace `saveVerifiedThumb` (ES3, keep every existing behavior; the loop body is unchanged, only indented into the new `try`):

```jsx
function saveVerifiedThumb(comp, pngFile) {
    var start = comp.workAreaStart;
    var dur = comp.workAreaDuration;
    var times = [start + dur / 2, start, start + dur * 0.25];
    // a stale file at the target path is indistinguishable from our render's
    // output - clear it up front, or bail rather than verify the wrong file
    try { if (pngFile.exists && !pngFile.remove()) return false; } catch (e0) { return false; }
    // saveFrameToPng renders at the comp's current resolution - a comp left at
    // Half/Third bakes a soft thumbnail, so force Full and restore after
    var prevRes = null;
    try { prevRes = comp.resolutionFactor; comp.resolutionFactor = [1, 1]; } catch (eRes) { prevRes = null; }
    try {
        var budget = 24000; // hard cap - evalScript blocks AE's UI thread
        for (var i = 0; i < times.length; i++) {
            var launched = false;
            try {
                comp.saveFrameToPng(times[i], pngFile);
                launched = true;
            } catch (e1) { }
            if (launched) {
                var w = watchPngWrite(pngFile, Math.min(budget, i === 0 ? 9000 : 4000));
                budget -= w.waited;
                while (w.state === 'pending' && budget > 0) {
                    // still rendering or writing: never delete or re-render over
                    // a live writer - two writers on one path is what produced
                    // the corrupt thumbnails
                    w = watchPngWrite(pngFile, Math.min(budget, 3000));
                    budget -= w.waited;
                }
                if (w.state === 'complete') return true;
                if (w.state === 'pending') return false; // budget spent, writer may be alive: hands off
            }
            // the render call threw, or the write died: scrub any partial file so
            // the index/panel never picks up a truncated png, then try another frame
            try { if (pngFile.exists && !pngFile.remove()) return false; } catch (e2) { return false; }
            if (budget <= 0) return false;
        }
        return false;
    } finally {
        try { if (prevRes) comp.resolutionFactor = prevRes; } catch (eRestore) { }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/thumb-capture.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/thumb-capture.test.js jsx/hostscript.jsx
git commit -m "fix(capture): force Full resolution in saveVerifiedThumb and restore after"
```

---

### Task 3: Full-resolution capture in setThumbFromActiveComp

**Files:**
- Modify: `tests/thumb-capture.test.js` (1 new source-contract test)
- Modify: `jsx/import-capture.jsx` (`setThumbFromActiveComp`)

**Interfaces:**
- Consumes: `sectionBetween(captureSrc, …)` helper already in the test file; `watchPngWrite` (unchanged).
- Produces: `setThumbFromActiveComp` — same signature/JSON contract; captures at `comp.time` with `resolutionFactor` forced to `[1,1]` and restored.

- [ ] **Step 1: Write the failing test**

Append to `tests/thumb-capture.test.js`:

```js
test('setThumbFromActiveComp forces Full resolution and restores it', () => {
  const body = sectionBetween(captureSrc, 'function setThumbFromActiveComp', '// ---- exports');
  assert.match(
    body,
    /resolutionFactor\s*=\s*\[1,\s*1\]/,
    'must force Full resolution before saveFrameToPng'
  );
  assert.match(
    body,
    /finally\s*\{[\s\S]*?resolutionFactor/,
    'must restore the original resolution in a finally'
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/thumb-capture.test.js`
Expected: FAIL — "must force Full resolution before saveFrameToPng".

- [ ] **Step 3: Implement in `jsx/import-capture.jsx`**

In `setThumbFromActiveComp`, replace:

```jsx
        var png = new File(compFolder.fsName + '/comp.png');
        if (png.exists && !png.remove()) return jerr('Could not replace the existing thumbnail.');
        comp.saveFrameToPng(comp.time, png);
        var w = watchPngWrite(png, 8000);
```

with:

```jsx
        var png = new File(compFolder.fsName + '/comp.png');
        if (png.exists && !png.remove()) return jerr('Could not replace the existing thumbnail.');
        // capture the user's chosen frame, but never at a reduced viewer resolution
        var prevRes = null;
        try { prevRes = comp.resolutionFactor; comp.resolutionFactor = [1, 1]; } catch (eRes) { prevRes = null; }
        var w;
        try {
            comp.saveFrameToPng(comp.time, png);
            w = watchPngWrite(png, 8000);
        } finally {
            try { if (prevRes) comp.resolutionFactor = prevRes; } catch (eRestore) { }
        }
```

- [ ] **Step 4: Run test + full suite**

Run: `node --test tests/thumb-capture.test.js`
Expected: PASS (8 tests).
Run: `npm test`
Expected: all pass (462 existing + 7 new = 469).

- [ ] **Step 5: Commit**

```bash
git add tests/thumb-capture.test.js jsx/import-capture.jsx
git commit -m "fix(capture): force Full resolution for camera-set thumbnails too"
```
