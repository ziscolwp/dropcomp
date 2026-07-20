# Rail Position Setting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Rail position — Left / Right" control in the Settings modal that moves the nav rail to either panel edge, persisted and synced across panels.

**Architecture:** One new pref (`railSide`) in DCState, applied by DCShell as a `rail-right` class on `#app`; all visual flipping is pure CSS (`row-reverse` + divider/marker mirrors), so `rail.js`, DCDensity, and ARIA behavior are untouched. Cross-panel sync rides the existing prefs broadcast.

**Tech Stack:** Vanilla ES5 panel JS (IIFE modules with `module.exports` guard), `node --test` with string-contract and stub-globals test patterns.

## Global Constraints

- Panel JS is ES5 (`var`, IIFE modules) — no arrow functions, `let`/`const`, or template literals in `panel/js/*`.
- Tests run with `npm test` (`node --test "tests/**/*.test.js"`); baseline is 481 passing.
- Conventional commit prefixes (`feat`, `test`, `docs`); never `git add -A`.
- Spec: `docs/superpowers/specs/2026-07-20-rail-position-design.md`.
- Worktree: `/Users/ziscol/Ziscol Media Projects/dropcomp-railside` (branch `feature/rail-position`).

---

### Task 1: `railSide` pref in DCState

**Files:**
- Modify: `panel/js/state.js` (`defaultPrefs()` ~line 136, exports block ~line 260)
- Test: `tests/state.railside.test.js`

**Interfaces:**
- Produces: `DCState.normalizeRailSide(v)` → `'left' | 'right'` (only the exact string `'right'` maps to `'right'`); `defaultPrefs().railSide === 'left'`. Task 2 depends on both.

- [ ] **Step 1: Write the failing test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const DCState = require('../panel/js/state.js');

function memStorage() {
  const map = {};
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
    setItem(k, v) { map[k] = String(v); },
    removeItem(k) { delete map[k]; },
  };
}

test('normalizeRailSide only ever returns left or right', () => {
  assert.equal(DCState.normalizeRailSide('right'), 'right');
  assert.equal(DCState.normalizeRailSide('left'), 'left');
  for (const junk of ['RIGHT', 'top', '', null, undefined, 42]) {
    assert.equal(DCState.normalizeRailSide(junk), 'left', `junk value: ${junk}`);
  }
});

test('rail defaults to the left edge', () => {
  assert.equal(DCState.loadPrefs(memStorage()).railSide, 'left');
});

test('a chosen rail side round-trips through prefs storage', () => {
  const storage = memStorage();
  const prefs = DCState.loadPrefs(storage);
  prefs.railSide = 'right';
  DCState.savePrefs(storage, prefs);
  assert.equal(DCState.loadPrefs(storage).railSide, 'right');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A2 railSide` (from the worktree root)
Expected: FAIL — `normalizeRailSide is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `panel/js/state.js`, next to `normalizeFolderLayout` (~line 117):

```js
  function normalizeRailSide(v) {
    return v === 'right' ? 'right' : 'left';
  }
```

In `defaultPrefs()` add `railSide: 'left',` after `folderColumns: true,`:

```js
      folderLayout: 'columns', folderLayoutVersion: FOLDER_LAYOUT_VERSION, folderColumns: true,
      railSide: 'left',
```

In the exports object add (next to `normalizeFolderLayout`):

```js
    normalizeRailSide: normalizeRailSide,
```

(No `loadPrefs` change needed — its copy loop round-trips every key in `defaultPrefs()`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | tail -4`
Expected: 484 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add tests/state.railside.test.js panel/js/state.js
git commit -m "feat(state): add railSide pref with left-default normalization"
```

### Task 2: DCShell applies and changes the rail side

**Files:**
- Modify: `panel/js/shell.js` (`applyPrefsToControls` ~line 49, new functions after `applyGridSize`, exports ~line 313)
- Test: `tests/shell.railside.test.js`

**Interfaces:**
- Consumes: `DCState.normalizeRailSide`, `defaultPrefs().railSide` (Task 1).
- Produces: `DCShell.onRailSideChange(side)` (persists + applies; junk-safe) and the `rail-right` class contract on `els.app`; internal `applyRailSide()` also runs on init and on cross-panel prefs reloads via `applyPrefsToControls`. Task 4's wiring calls `onRailSideChange`; Task 3's CSS keys off `rail-right`. `els.railSideSwitch` is optional (guarded) — segment buttons carry `data-side`, `.active`, `aria-pressed`.

- [ ] **Step 1: Write the failing test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');

function freshShell() {
  const p = require.resolve('../panel/js/shell.js');
  delete require.cache[p];
  return require(p);
}

function memStorage() {
  const map = {};
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
    setItem(k, v) { map[k] = String(v); },
    removeItem(k) { delete map[k]; },
  };
}

function recordClassList() {
  const set = new Set();
  return {
    add(c) { set.add(c); },
    remove(c) { set.delete(c); },
    toggle(c, on) {
      if (on === undefined) on = !set.has(c);
      if (on) set.add(c); else set.delete(c);
      return on;
    },
    contains(c) { return set.has(c); },
  };
}

function segBtn(side) {
  return {
    attrs: { 'data-side': side },
    classList: recordClassList(),
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; },
    setAttribute(n, v) { this.attrs[n] = String(v); },
  };
}

function makeEls() {
  const left = segBtn('left');
  const right = segBtn('right');
  return {
    app: { classList: recordClassList() },
    sortSelect: { value: '' },
    thumbSlider: { value: 0, classList: recordClassList() },
    showNamesCb: { checked: false },
    showMetaCb: { checked: false },
    favoritesBtn: { classList: recordClassList() },
    library: { classList: recordClassList() },
    railSideSwitch: { left, right, querySelectorAll() { return [left, right]; } },
  };
}

function installGlobals() {
  global.DCState = require('../panel/js/state.js');
  global.localStorage = memStorage();
  global.document = { documentElement: { style: { setProperty() {} } } };
}

function cleanupGlobals() {
  delete global.DCState;
  delete global.localStorage;
  delete global.document;
}

test('init leaves the rail on the left by default', () => {
  installGlobals();
  try {
    const DCShell = freshShell();
    const els = makeEls();
    DCShell.init(els, 'full');
    assert.equal(els.app.classList.contains('rail-right'), false);
    assert.equal(els.railSideSwitch.left.attrs['aria-pressed'], 'true');
    assert.equal(els.railSideSwitch.right.attrs['aria-pressed'], 'false');
  } finally { cleanupGlobals(); }
});

test('init applies a remembered right-hand rail', () => {
  installGlobals();
  try {
    const prefs = global.DCState.loadPrefs(global.localStorage);
    prefs.railSide = 'right';
    global.DCState.savePrefs(global.localStorage, prefs);
    const DCShell = freshShell();
    const els = makeEls();
    DCShell.init(els, 'full');
    assert.equal(els.app.classList.contains('rail-right'), true);
    assert.equal(els.railSideSwitch.right.attrs['aria-pressed'], 'true');
    assert.equal(els.railSideSwitch.left.attrs['aria-pressed'], 'false');
  } finally { cleanupGlobals(); }
});

test('onRailSideChange applies, persists, and syncs the control', () => {
  installGlobals();
  try {
    const DCShell = freshShell();
    const els = makeEls();
    DCShell.init(els, 'full');
    DCShell.onRailSideChange('right');
    assert.equal(els.app.classList.contains('rail-right'), true);
    assert.equal(els.railSideSwitch.right.classList.contains('active'), true);
    assert.equal(els.railSideSwitch.left.classList.contains('active'), false);
    assert.equal(global.DCState.loadPrefs(global.localStorage).railSide, 'right');
  } finally { cleanupGlobals(); }
});

test('onRailSideChange normalizes junk back to the left edge', () => {
  installGlobals();
  try {
    const DCShell = freshShell();
    const els = makeEls();
    DCShell.init(els, 'full');
    DCShell.onRailSideChange('right');
    DCShell.onRailSideChange('diagonal');
    assert.equal(els.app.classList.contains('rail-right'), false);
    assert.equal(global.DCState.loadPrefs(global.localStorage).railSide, 'left');
  } finally { cleanupGlobals(); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -B1 -A3 "onRailSideChange"`
Expected: FAIL — `DCShell.onRailSideChange is not a function` (and the remembered-right test fails on the missing `rail-right` class).

- [ ] **Step 3: Write minimal implementation**

In `panel/js/shell.js`, after `applyGridSize` (~line 74):

```js
  // Rail side is a pure layout class on #app; the CSS mirror does the rest.
  function applyRailSide() {
    var side = DCState.normalizeRailSide(prefs.railSide);
    els.app.classList.toggle('rail-right', side === 'right');
    if (!els.railSideSwitch) return;
    var btns = els.railSideSwitch.querySelectorAll('[data-side]');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-side') === side;
      btns[i].classList.toggle('active', on);
      btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function onRailSideChange(side) {
    prefs.railSide = DCState.normalizeRailSide(side);
    persistPrefs();
    applyRailSide();
  }
```

In `applyPrefsToControls`, add a final line after `applyView();`:

```js
    applyRailSide();
```

In the exports object, after `onDisplayChange: onDisplayChange, onSlider: onSlider, onViewChange: onViewChange,`:

```js
    onRailSideChange: onRailSideChange,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | tail -4`
Expected: 488 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add tests/shell.railside.test.js panel/js/shell.js
git commit -m "feat(shell): apply and persist rail side from prefs"
```

### Task 3: CSS mirror + standalone hide + text segment buttons

**Files:**
- Modify: `panel/css/style.css` (rail section ends ~line 117; `.seg` rules ~line 607)
- Test: `tests/rail-side-css.test.js`

**Interfaces:**
- Consumes: the `rail-right` class contract on `#app` (Task 2).
- Produces: `#rail-side-row` hide rules and `.seg-btn--text` sizing that Task 4's markup uses.

- [ ] **Step 1: Write the failing test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(
  path.join(__dirname, '..', 'panel', 'css', 'style.css'), 'utf8');
const flat = css.replace(/\s+/g, ' ');

test('rail-right flips the app shell into a right-hand rail', () => {
  const m = flat.match(/#app\.rail-right\s*\{([^}]*)\}/);
  assert.ok(m, 'expected an #app.rail-right rule');
  assert.match(m[1], /flex-direction:\s*row-reverse/);
});

test('rail-right moves the rail divider to its inner (left) edge', () => {
  const m = flat.match(/#app\.rail-right\s+#rail\s*\{([^}]*)\}/);
  assert.ok(m, 'expected an #app.rail-right #rail rule');
  assert.match(m[1], /border-right:\s*none/);
  assert.match(m[1], /border-left:\s*1px solid var\(--border\)/);
});

test('rail-right mirrors the gold active marker to the outer edge', () => {
  const m = flat.match(/#app\.rail-right\s+\.rail-btn\.active::after\s*\{([^}]*)\}/);
  assert.ok(m, 'expected a mirrored active-marker rule');
  assert.match(m[1], /left:\s*auto/);
  assert.match(m[1], /right:\s*0/);
  assert.match(m[1], /border-radius:\s*1px 0 0 1px/);
});

test('standalone panels hide the rail-position setting row', () => {
  for (const mode of ['library', 'assets', 'tools', 'scripts']) {
    assert.ok(css.includes(`body.mode-${mode} #rail-side-row`),
      `missing #rail-side-row rule for mode-${mode}`);
  }
});

test('text segment buttons size to their label', () => {
  const m = flat.match(/\.seg-btn--text\s*\{([^}]*)\}/);
  assert.ok(m, 'expected a .seg-btn--text rule');
  assert.match(m[1], /width:\s*auto/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A2 "rail-right"`
Expected: FAIL — `expected an #app.rail-right rule`.

- [ ] **Step 3: Write minimal implementation**

In `panel/css/style.css` after `.rail-settings { margin-top: auto; }` (~line 117):

```css
/* rail on the right (Settings): a pure CSS mirror - DOM and tab order stay
   rail-first, so rail.js keyboard/ARIA behavior is untouched */
#app.rail-right { flex-direction: row-reverse; }
#app.rail-right #rail { border-right: none; border-left: 1px solid var(--border); }
#app.rail-right .rail-btn.active::after { left: auto; right: 0; border-radius: 1px 0 0 1px; }
/* the rail-position setting only means something where a rail exists */
body.mode-library #rail-side-row, body.mode-assets #rail-side-row,
body.mode-tools #rail-side-row, body.mode-scripts #rail-side-row { display: none; }
```

Next to `.seg-btn svg { width: 14px; height: 14px; }` (~line 610):

```css
.seg-btn--text { width: auto; padding: 0 12px; font-size: 12px; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | tail -4`
Expected: 493 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add tests/rail-side-css.test.js panel/css/style.css
git commit -m "feat(ui): mirror the nav rail to the right edge via rail-right class"
```

### Task 4: Settings modal control + wiring

**Files:**
- Modify: `panel/index.html` (`#settings-modal`, ~line 317)
- Modify: `panel/js/main.js` (els map ~line 42, listener block ~line 123)
- Test: `tests/rail-side-wiring.test.js`

**Interfaces:**
- Consumes: `DCShell.onRailSideChange` (Task 2), `#rail-side-row` / `.seg-btn--text` CSS (Task 3).
- Produces: the user-facing control; `els.railSideSwitch` picked up by Task 2's `applyRailSide` on boot.

- [ ] **Step 1: Write the failing test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(
  path.join(__dirname, '..', 'panel', 'index.html'), 'utf8');
const mainSrc = fs.readFileSync(
  path.join(__dirname, '..', 'panel', 'js', 'main.js'), 'utf8');

test('settings modal offers a Left/Right rail position control', () => {
  assert.ok(html.includes('id="rail-side-row"'), 'rail side form row missing');
  assert.ok(html.includes('id="rail-side-switch"'), 'rail side segmented control missing');
  assert.ok(html.includes('data-side="left"'), 'left segment missing');
  assert.ok(html.includes('data-side="right"'), 'right segment missing');
});

test('main.js routes rail side clicks to the shell', () => {
  assert.match(mainSrc, /railSideSwitch:\s*\$\('rail-side-switch'\)/);
  assert.match(mainSrc, /DCShell\.onRailSideChange/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A2 "rail position control"`
Expected: FAIL — `rail side form row missing`.

- [ ] **Step 3: Write minimal implementation**

In `panel/index.html`, inside `#settings-modal` directly after the Library folder `form-group` (`<p id="settings-path" class="mono"></p></div>`):

```html
    <div class="form-group" id="rail-side-row">
      <label>Rail position:</label>
      <div id="rail-side-switch" class="seg" role="group" aria-label="Rail position">
        <button class="seg-btn seg-btn--text active" data-side="left" aria-pressed="true">Left</button>
        <button class="seg-btn seg-btn--text" data-side="right" aria-pressed="false">Right</button>
      </div>
    </div>
```

In `panel/js/main.js`, add to the els map after `viewSwitch: $('view-switch'),`:

```js
    railSideSwitch: $('rail-side-switch'),
```

In the listener block, after the `close-settings-btn` line (~line 123):

```js
  if (els.railSideSwitch) {
    els.railSideSwitch.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-side]');
      if (btn) DCShell.onRailSideChange(btn.dataset.side);
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | tail -4`
Expected: 495 pass, 0 fail (full suite green — no other contract test asserts the settings modal's exact contents).

- [ ] **Step 5: Commit**

```bash
git add tests/rail-side-wiring.test.js panel/index.html panel/js/main.js
git commit -m "feat(settings): add rail position Left/Right control"
```

### Task 5: Full-suite verification

- [ ] **Step 1: Run the entire suite**

Run: `npm test 2>&1 | tail -6`
Expected: 495 pass, 0 fail.

- [ ] **Step 2: Manual AE checklist entry (no commit yet — reported to Ziscol)**

Panel → Settings → Rail position → Right: rail flips instantly, divider and gold marker mirror, tooltips clamp, keyboard Up/Down still cycles tabs; reopen panel: right side remembered; standalone Library panel: no rail row in Settings.

## Post-plan (outside this branch)

`panel/_harness.html` is a gitignored dev mirror living only in the main
working tree — apply the same `#rail-side-row` form-group there manually
after merge (coordinate with the parallel session using that tree).
