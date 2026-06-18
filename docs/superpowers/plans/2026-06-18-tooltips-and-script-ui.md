# Tooltips + In-Panel Script UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fast theme-matched hover/focus tooltips across the panel, and let adaptable scripts run as native in-panel HTML forms (via a `DC_PARAMS` global) instead of floating ScriptUI windows.

**Architecture:** A standalone `DCTooltip` controller shows one styled box driven by `data-tip` attributes. Script entries gain an optional `params` array; a new `DCScriptsForm` module renders those as builder rows (editor) and an inline run-form (list), and two new ES3 host functions inject the collected values as `$.global.DC_PARAMS` before `evalFile` — the user's file is never modified.

**Tech Stack:** CEP/Chromium panel JS (IIFE `DCxxx` globals, `var`/function style, ES5-safe), ExtendScript ES3 host (`jsx/*.jsx`), zero-dep `node --test`, CSS custom-property tokens.

## Global Constraints

- **ES3 only in `jsx/*.jsx`** — no `const`/`let`, no `=>`, no template literals, no `.map/.filter/.forEach/.reduce/.some/.every`, no `Object.keys`, no `Array.isArray`. (Enforced by `tests/jsx.es3.test.js`.)
- **Every top-level function in `jsx/*.jsx` must be exported to `$.global`** as `$.global.fn = fn;`. (Enforced by `tests/jsx.exports.test.js`.)
- **Panel JS style:** IIFE module returning a `DCxxx` global, `'use strict'`, `var` + function expressions (match existing files; no arrow/const/let needed even though Chromium allows them).
- **Files < 400 lines** (user contract). `scripts.js` is at 353 — new form UI goes in a separate `scripts-form.js`.
- **Colors via CSS tokens only** (`var(--bg-raised)`, `var(--border-strong)`, `var(--text)`, `var(--gold)`, `var(--radius)`, etc.). No raw hex.
- **Tooltip layer `z-index: 4000`** (above toast=3000, spinner=2000, modal=1000).
- **Tooltip content is text-only** — `textContent`/DOM nodes, **never `innerHTML`** (script names/descriptions/paths are user data).
- **Registry backward-compatible** — an entry with no `params` behaves exactly as today (one-click Run).
- **Param transport is injection-safe** — panel emits `JSON.stringify(values)`; host inlines it after `=` in a temp wrapper (JSON ⊂ ES3 literal syntax).
- **Version bump 2.3.0 → 2.4.0.**
- **`npm test` green** (run `npm test` from repo root) after every task that touches testable logic.
- **Branch:** all work on `feature/tooltips-and-script-ui` (already created). Commit after every task.

---

### Task 1: Tooltip pure helpers (`clampPosition`, `buildScriptTip`)

**Files:**
- Create: `panel/js/tooltip.js`
- Test: `tests/tooltip.test.js`

**Interfaces:**
- Produces: `DCTooltip.clampPosition(anchorRect, tipSize, viewport, margin) -> {x:number, y:number, placement:'above'|'below'}` where `anchorRect={left,top,bottom,width,height}`, `tipSize={w,h}`, `viewport={w,h}`. And `DCTooltip.buildScriptTip(entry, usage) -> {title:string, body:string}` (body lines joined by `\n`).

- [ ] **Step 1: Write the failing test** — create `tests/tooltip.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../panel/js/tooltip.js');

test('clampPosition places below by default, centered on the anchor', () => {
  const r = T.clampPosition(
    { left: 100, top: 100, bottom: 120, width: 40, height: 20 },
    { w: 80, h: 30 }, { w: 400, h: 600 }, 6
  );
  assert.equal(r.placement, 'below');
  assert.equal(r.y, 126); // bottom + margin
  assert.equal(r.x, 80);  // 100 + 40/2 - 80/2
});

test('clampPosition flips above when there is no room below', () => {
  const r = T.clampPosition(
    { left: 10, top: 560, bottom: 590, width: 40, height: 20 },
    { w: 80, h: 40 }, { w: 400, h: 600 }, 6
  );
  assert.equal(r.placement, 'above');
  assert.equal(r.y, 514); // 560 - 40 - 6
});

test('clampPosition clamps x within the viewport margins', () => {
  const left = T.clampPosition({ left: 0, top: 50, bottom: 70, width: 10, height: 20 }, { w: 80, h: 30 }, { w: 400, h: 600 }, 6);
  assert.equal(left.x, 6);
  const right = T.clampPosition({ left: 395, top: 50, bottom: 70, width: 10, height: 20 }, { w: 80, h: 30 }, { w: 400, h: 600 }, 6);
  assert.equal(right.x, 314); // 400 - 80 - 6
});

test('buildScriptTip: file entry shows description, path, run count', () => {
  const t = T.buildScriptTip({ name: 'My Tool', description: 'does X', source: 'file', path: '/a/b.jsx' }, { runCount: 2 });
  assert.equal(t.title, 'My Tool');
  assert.match(t.body, /does X/);
  assert.match(t.body, /File: \/a\/b\.jsx/);
  assert.match(t.body, /Run 2 times/);
});

test('buildScriptTip: snippet entry previews up to 5 body lines', () => {
  const body = ['1','2','3','4','5','6','7'].join('\n');
  const t = T.buildScriptTip({ name: 'Snip', source: 'snippet', body }, { runCount: 1 });
  assert.match(t.body, /Snippet/);
  assert.match(t.body, /1\n2\n3\n4\n5\n…/);
  assert.match(t.body, /Run 1 time$/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../panel/js/tooltip.js'`.

- [ ] **Step 3: Write the minimal implementation** — create `panel/js/tooltip.js` with ONLY the pure helpers + node export (the DOM controller is added in Task 2):

```js
// DropComp tooltip - one fast, theme-matched hover/focus tip for the whole panel,
// replacing the slow native title tooltip. Text-only (textContent), never innerHTML,
// because script names/descriptions/paths are user data.
var DCTooltip = (function () {
  'use strict';

  var SHOW_DELAY = 300; // ms hover before showing; focus shows immediately
  var MARGIN = 6;       // viewport edge gap (px)

  // Decide where the tip box goes relative to its anchor, clamped to the viewport.
  function clampPosition(anchorRect, tipSize, viewport, margin) {
    margin = (margin == null) ? MARGIN : margin;
    var placement = 'below';
    var y = anchorRect.bottom + margin;
    if (y + tipSize.h + margin > viewport.h) {
      var above = anchorRect.top - tipSize.h - margin;
      if (above >= margin) { y = above; placement = 'above'; }
    }
    var x = anchorRect.left + (anchorRect.width / 2) - (tipSize.w / 2);
    var maxX = viewport.w - tipSize.w - margin;
    if (x > maxX) x = maxX;
    if (x < margin) x = margin;
    var maxY = viewport.h - tipSize.h - margin;
    if (y > maxY) y = maxY;
    if (y < margin) y = margin;
    return { x: x, y: y, placement: placement };
  }

  // Build the rich tip for a script row: {title, body}, body lines joined with '\n'.
  function buildScriptTip(entry, usage) {
    entry = entry || {};
    var lines = [];
    if (entry.description) lines.push(String(entry.description));
    if (entry.source === 'file') {
      lines.push('File: ' + (entry.path || '(no path)'));
    } else {
      lines.push('Snippet');
      var body = String(entry.body || '');
      if (body) {
        var rows = body.split('\n');
        var preview = rows.slice(0, 5).join('\n');
        if (rows.length > 5) preview += '\n…';
        lines.push(preview);
      }
    }
    if (usage && usage.runCount) {
      lines.push('Run ' + usage.runCount + (usage.runCount === 1 ? ' time' : ' times'));
    }
    return { title: String(entry.name || ''), body: lines.join('\n') };
  }

  return {
    init: function () {}, // replaced by the controller in Task 2
    clampPosition: clampPosition,
    buildScriptTip: buildScriptTip
  };
}());
if (typeof module !== 'undefined' && module.exports) { module.exports = DCTooltip; }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS (all 5 new tooltip tests green; existing suite unaffected).

- [ ] **Step 5: Commit**

```bash
git add panel/js/tooltip.js tests/tooltip.test.js
git commit -m "$(printf 'feat(tooltip): pure positioning + script-tip helpers\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: Tooltip controller (DOM) + wiring + styles

**Files:**
- Modify: `panel/js/tooltip.js` (replace the `init` stub with the real controller)
- Modify: `panel/index.html` (load `tooltip.js`)
- Modify: `panel/js/main.js` (call `DCTooltip.init()`)
- Modify: `panel/css/style.css` (append `#dc-tooltip` styles)

**Interfaces:**
- Consumes: `DCTooltip.clampPosition`, `DCTooltip.buildScriptTip` (Task 1).
- Produces: `DCTooltip.init()` — wires delegated listeners; reads `data-tip` (body) and optional `data-tip-title` (bold first line) off any element.

- [ ] **Step 1: Add the controller** — in `panel/js/tooltip.js`, insert these functions inside the IIFE *above* the `return`, and replace `init: function () {}` in the returned object with `init: init`:

```js
  var el = null;      // floating tip element
  var timer = null;
  var current = null; // element currently driving the tip

  function ensureEl() {
    if (el) return el;
    el = document.createElement('div');
    el.id = 'dc-tooltip';
    el.setAttribute('role', 'tooltip');
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    return el;
  }

  function setContent(node, title, body) {
    node.textContent = '';
    if (title) {
      var t = document.createElement('div');
      t.className = 'dc-tip-title';
      t.textContent = title;
      node.appendChild(t);
    }
    var lines = String(body == null ? '' : body).split('\n');
    for (var i = 0; i < lines.length; i++) {
      var ln = document.createElement('div');
      ln.textContent = lines[i];
      node.appendChild(ln);
    }
  }

  function owner(e) {
    return (e.target && e.target.closest) ? e.target.closest('[data-tip], [data-tip-title]') : null;
  }

  function show(target) {
    var title = target.getAttribute('data-tip-title') || '';
    var body = target.getAttribute('data-tip') || '';
    if (!title && !String(body).trim()) return;
    var node = ensureEl();
    setContent(node, title, body);
    var size = { w: node.offsetWidth, h: node.offsetHeight }; // measured while hidden
    var rect = target.getBoundingClientRect();
    var pos = clampPosition(rect, size, { w: window.innerWidth, h: window.innerHeight }, MARGIN);
    node.style.left = Math.round(pos.x) + 'px';
    node.style.top = Math.round(pos.y) + 'px';
    node.setAttribute('data-placement', pos.placement);
    node.classList.add('show');
    node.setAttribute('aria-hidden', 'false');
    current = target;
  }

  function hide() {
    if (timer) { clearTimeout(timer); timer = null; }
    current = null;
    if (!el) return;
    el.classList.remove('show');
    el.setAttribute('aria-hidden', 'true');
  }

  function scheduleShow(target, immediate) {
    if (timer) clearTimeout(timer);
    if (immediate) { show(target); return; }
    timer = setTimeout(function () { show(target); }, SHOW_DELAY);
  }

  function onOver(e) { var t = owner(e); if (t && t !== current) scheduleShow(t, false); }
  function onOut(e) { if (owner(e)) hide(); }
  function onFocus(e) { var t = owner(e); if (t) scheduleShow(t, true); }

  function init() {
    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointerout', onOut, true);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('focusin', onFocus, true);
    document.addEventListener('focusout', hide, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); }, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide, true);
  }
```

- [ ] **Step 2: Verify the pure tests still pass** (requiring the file under node must not touch `document` at load time)

Run: `npm test`
Expected: PASS — the IIFE only *defines* DOM functions; none run at require time.

- [ ] **Step 3: Load the script** — in `panel/index.html`, add after the `render.js` tag (line ~277):

```html
<script src="js/tooltip.js"></script>
```

- [ ] **Step 4: Initialize it** — in `panel/js/main.js`, after the `DCScripts.init()` line (~50), add:

```js
  if (typeof DCTooltip !== 'undefined') DCTooltip.init();
```

- [ ] **Step 5: Add styles** — append to `panel/css/style.css`:

```css
/* ---- tooltip ---- */
#dc-tooltip {
  position: fixed; left: 0; top: 0; z-index: 4000; pointer-events: none;
  max-width: 240px; padding: 6px 8px; font-size: 12px; line-height: 1.35;
  color: var(--text); background: var(--bg-raised);
  border: 1px solid var(--border-strong); border-radius: var(--radius);
  box-shadow: 0 4px 14px rgba(0,0,0,0.4);
  opacity: 0; visibility: hidden; transition: opacity 0.12s ease;
  white-space: pre-wrap; word-break: break-word;
}
#dc-tooltip.show { opacity: 1; visibility: visible; }
#dc-tooltip .dc-tip-title { font-weight: 600; margin-bottom: 2px; }
```

- [ ] **Step 6: Verify in the browser harness** — start the preview on `panel/` and open `_harness.html` (a 380px mock-CEP harness). Hover a Tools button; confirm a dark styled box appears after ~300ms and disappears on mouse-out; Tab to a button and confirm it shows immediately on focus. Capture a screenshot.

Expected: styled tip box visible near the hovered control, not the slow OS tooltip.

- [ ] **Step 7: Commit**

```bash
git add panel/js/tooltip.js panel/index.html panel/js/main.js panel/css/style.css
git commit -m "$(printf 'feat(tooltip): delegated hover/focus controller + styles\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: Migrate `title` → `data-tip` (Tools, toolbar, header, script rows)

**Files:**
- Modify: `panel/index.html` (static buttons)
- Modify: `panel/js/scripts.js` (dynamic rows/actions)

**Interfaces:**
- Consumes: `DCTooltip` reads `data-tip` / `data-tip-title`; `DCTooltip.buildScriptTip` (Task 1).

- [ ] **Step 1: Migrate static controls in `panel/index.html`** — for every control that has a `title="…"`, rename the attribute to `data-tip="…"` and keep any existing `aria-label`. Where there is no `aria-label`, add one equal to the tip text. Apply to: `#settings-btn`, `#update-chip`, `#sort-select`, `#favorites-btn`, `#relink-btn`, `#display-btn`, `#add-aep-btn`, `#thumb-slider`, the 9 `.anchor-cell` buttons, the 4 `create` buttons, the 6 `align` + 2 `distribute` + 1 `reset` `.tool-icon`s, the 4 pre-comp buttons, `#script-sort`, `#script-fav-btn`, `#script-new-snippet`, `#script-add-file`. Then upgrade these terse ones to full sentences (set both `data-tip` and `aria-label`):

| Selector / current | New `data-tip` |
|---|---|
| `data-tool="create" data-arg="null"` ("Add a null object") | `Add a null object to parent layers to` |
| `data-arg="adjustment"` | `Add an adjustment layer above the selection` |
| `data-arg="solid"` | `Add a full-frame solid layer` |
| `data-arg="camera"` | `Add a camera and convert layers to 3D as needed` |

(The rest already read as full phrases — keep their text, just rename the attribute.)

- [ ] **Step 2: Verify no native `title` remains on controls** —

Run: `grep -n 'title="' panel/index.html`
Expected: no matches on `<button>/<input>/<select>` controls (the `<title>DropComp</title>` document title is fine).

- [ ] **Step 3: Set tips on dynamic script rows** — in `panel/js/scripts.js`:

  (a) In `iconBtn(action, title, svg, extraClass)` replace the `b.title = title;` line with:
```js
    b.setAttribute('data-tip', title);
```
  (keep the existing `b.setAttribute('aria-label', title);`).

  (b) In `buildRow(s)`, replace `run.title = 'Run "' + s.name + '"';` with:
```js
    run.setAttribute('data-tip', 'Run "' + s.name + '"');
```
  and replace `typeIcon.title = s.source === 'file' ? 'External file' : 'Snippet';` with:
```js
    typeIcon.setAttribute('data-tip', s.source === 'file' ? 'External file' : 'Snippet');
```

  (c) In `buildRow(s)`, immediately after `row.dataset.id = s.uniqueId;`, add the rich row tip:
```js
    var tip = DCTooltip.buildScriptTip(s, usage);
    row.setAttribute('data-tip-title', tip.title);
    row.setAttribute('data-tip', tip.body);
```

- [ ] **Step 4: Run the test suite** (no logic changed, but confirm nothing broke)

Run: `npm test`
Expected: PASS (unchanged green suite).

- [ ] **Step 5: Verify in the harness** — open `_harness.html`, go to the Scripts tab (mock registry), hover a script row name → tip shows name + description + path/preview; hover the Run button → shows `Run "<name>"`. Screenshot.

- [ ] **Step 6: Commit**

```bash
git add panel/index.html panel/js/scripts.js
git commit -m "$(printf 'feat(tooltip): drive Tools/Scripts tips via data-tip\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 4: Script param model (`scripts-core.js`)

**Files:**
- Modify: `panel/js/scripts-core.js`
- Test: `tests/scripts-core.test.js`

**Interfaces:**
- Produces:
  - `DCScriptsCore.validateParams(params) -> {valid:boolean, error?:string}`
  - `DCScriptsCore.normalizeParams(params) -> Array` (coerces defaults, fills labels)
  - `DCScriptsCore.coerceValue(param, raw) -> value` (typed per `param.type`)
  - `DCScriptsCore.buildValuesJson(params, rawValues) -> string` (JSON; `rawValues` is `{key: rawInputValue}`)
  - `makeEntry` now carries `params` (normalized) and `opensWindow`; `validateEntry` now runs `validateParams`.

- [ ] **Step 1: Write the failing tests** — append to `tests/scripts-core.test.js`:

```js
test('validateParams accepts a well-formed list and rejects bad keys/types', () => {
  assert.equal(C.validateParams(null).valid, true);
  assert.equal(C.validateParams([]).valid, true);
  assert.equal(C.validateParams([{ key: 'spacing', type: 'slider', min: 0, max: 100 }]).valid, true);
  assert.equal(C.validateParams([{ key: '1bad', type: 'text' }]).valid, false);      // key must start with letter/_
  assert.equal(C.validateParams([{ key: 'a', type: 'text' }, { key: 'a', type: 'text' }]).valid, false); // dup
  assert.equal(C.validateParams([{ key: 'x', type: 'nope' }]).valid, false);          // unknown type
  assert.equal(C.validateParams([{ key: 'x', type: 'slider', min: 5, max: 5 }]).valid, false); // min<max
  assert.equal(C.validateParams([{ key: 'x', type: 'select', options: [] }]).valid, false);    // needs options
});

test('coerceValue converts raw input strings to typed values', () => {
  assert.equal(C.coerceValue({ type: 'text' }, 'hi'), 'hi');
  assert.equal(C.coerceValue({ type: 'number' }, '4.5'), 4.5);
  assert.equal(C.coerceValue({ type: 'slider', min: 0, max: 10 }, '99'), 10); // clamped
  assert.equal(C.coerceValue({ type: 'checkbox' }, 'true'), true);
  assert.equal(C.coerceValue({ type: 'checkbox' }, false), false);
  assert.equal(C.coerceValue({ type: 'select', options: ['a', 'b'] }, 'b'), 'b');
  assert.equal(C.coerceValue({ type: 'select', options: ['a', 'b'] }, 'zzz'), 'a'); // falls back to first
});

test('buildValuesJson coerces by param and uses defaults for missing keys', () => {
  const params = [
    { key: 'n', type: 'number', default: 1 },
    { key: 'flag', type: 'checkbox', default: false },
    { key: 'mode', type: 'select', options: ['add', 'sub'], default: 'add' }
  ];
  const json = C.buildValuesJson(params, { n: '7', flag: true });
  assert.equal(json, '{"n":7,"flag":true,"mode":"add"}');
});

test('normalizeParams fills labels and coerces defaults to the right type', () => {
  const out = C.normalizeParams([
    { key: 'n', type: 'number', default: '3' },
    { key: 'flag', type: 'checkbox', default: 'true' },
    { key: 'pick', type: 'select', options: ['a', 'b'], default: 'zzz' }
  ]);
  assert.equal(out[0].label, 'n');
  assert.equal(out[0].default, 3);
  assert.equal(out[1].default, true);
  assert.equal(out[2].default, 'a');
});

test('makeEntry carries normalized params and opensWindow', () => {
  const e = C.makeEntry({ name: 'X', source: 'snippet', body: 'a', opensWindow: true,
    params: [{ key: 'n', type: 'number', default: '2' }] }, 5);
  assert.equal(e.opensWindow, true);
  assert.equal(e.params.length, 1);
  assert.equal(e.params[0].default, 2);
});

test('validateEntry rejects an entry whose params are invalid', () => {
  const r = C.validateEntry({ name: 'X', source: 'snippet', body: 'a', params: [{ key: '1', type: 'text' }] });
  assert.equal(r.valid, false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `C.validateParams is not a function` (and siblings).

- [ ] **Step 3: Implement** — in `panel/js/scripts-core.js`, add these helpers (place above the `return`), and wire `params`/`opensWindow` into `makeEntry` and `validateEntry`:

```js
  var PARAM_TYPES = ['text', 'number', 'slider', 'checkbox', 'select'];
  var PARAM_KEY_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

  function validateParams(params) {
    if (params == null) return { valid: true };
    var seen = {};
    for (var i = 0; i < params.length; i++) {
      var p = params[i] || {};
      var label = p.label || p.key || '';
      if (!p.key || !PARAM_KEY_RE.test(p.key)) {
        return { valid: false, error: 'Input "' + (p.key || '') + '": key must start with a letter or _ and use only letters, numbers, or _.' };
      }
      if (seen[p.key]) return { valid: false, error: 'Duplicate input key "' + p.key + '".' };
      seen[p.key] = true;
      if (PARAM_TYPES.indexOf(p.type) === -1) {
        return { valid: false, error: 'Input "' + label + '": choose a type.' };
      }
      if (p.type === 'slider') {
        if (typeof p.min !== 'number' || typeof p.max !== 'number') return { valid: false, error: 'Input "' + label + '": slider needs numeric min and max.' };
        if (p.min >= p.max) return { valid: false, error: 'Input "' + label + '": min must be less than max.' };
        if (p.step != null && !(p.step > 0)) return { valid: false, error: 'Input "' + label + '": step must be greater than 0.' };
      }
      if (p.type === 'select' && (!p.options || p.options.length === 0)) {
        return { valid: false, error: 'Input "' + label + '": add at least one option.' };
      }
    }
    return { valid: true };
  }

  function coerceValue(param, raw) {
    var t = param.type;
    if (t === 'checkbox') return (raw === true || raw === 'true' || raw === 'on' || raw === 1 || raw === '1');
    if (t === 'number' || t === 'slider') {
      var n = parseFloat(raw);
      if (isNaN(n)) n = (typeof param.default === 'number') ? param.default : 0;
      if (typeof param.min === 'number' && n < param.min) n = param.min;
      if (typeof param.max === 'number' && n > param.max) n = param.max;
      return n;
    }
    if (t === 'select') {
      var v = String(raw);
      if (param.options && param.options.indexOf(v) === -1) return param.options[0];
      return v;
    }
    return String(raw == null ? '' : raw);
  }

  function buildValuesJson(params, rawValues) {
    var out = {};
    params = params || [];
    for (var i = 0; i < params.length; i++) {
      var p = params[i];
      var raw = (rawValues && (p.key in rawValues)) ? rawValues[p.key] : p['default'];
      out[p.key] = coerceValue(p, raw);
    }
    return JSON.stringify(out);
  }

  function normalizeParams(params) {
    var out = [];
    params = params || [];
    for (var i = 0; i < params.length; i++) {
      var p = params[i] || {};
      var np = { key: p.key, label: p.label || p.key, type: p.type };
      if (p.type === 'number' || p.type === 'slider') {
        if (p.min != null) np.min = (typeof p.min === 'number') ? p.min : parseFloat(p.min);
        if (p.max != null) np.max = (typeof p.max === 'number') ? p.max : parseFloat(p.max);
        if (p.step != null) np.step = (typeof p.step === 'number') ? p.step : parseFloat(p.step);
        var dn = parseFloat(p['default']);
        np['default'] = isNaN(dn) ? 0 : dn;
      } else if (p.type === 'checkbox') {
        np['default'] = (p['default'] === true || p['default'] === 'true' || p['default'] === 1 || p['default'] === '1');
      } else if (p.type === 'select') {
        np.options = p.options || [];
        np['default'] = (np.options.indexOf(p['default']) !== -1) ? p['default'] : (np.options[0] || '');
      } else {
        np['default'] = String(p['default'] == null ? '' : p['default']);
      }
      out.push(np);
    }
    return out;
  }
```

  In `makeEntry`, add two fields to the returned object (after `tags`):
```js
      tags: input.tags || [],
      params: input.params ? normalizeParams(input.params) : [],
      opensWindow: !!input.opensWindow
```

  In `validateEntry`, just before `return { valid: true };`, add:
```js
    var pv = validateParams(input.params);
    if (!pv.valid) return pv;
```

  Add the four new names to the returned object:
```js
    validateParams: validateParams,
    normalizeParams: normalizeParams,
    coerceValue: coerceValue,
    buildValuesJson: buildValuesJson,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS (new + all existing scripts-core tests green; the existing `makeEntry`/`serializeRegistry` tests still pass — they assert fields, not whole-object equality).

- [ ] **Step 5: Commit**

```bash
git add panel/js/scripts-core.js tests/scripts-core.test.js
git commit -m "$(printf 'feat(scripts): param model - validate, coerce, normalize, values JSON\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 5: Host run-with-params (`jsx/scripts.jsx`, ES3)

**Files:**
- Modify: `jsx/scripts.jsx`
- Modify: `tests/jsx.exports.test.js`

**Interfaces:**
- Produces (host `$.global`): `scRunFileWithParams(path, valuesJson)`, `scRunSnippetWithParams(body, valuesJson)`, plus helpers `scValidParamsJson(s)`, `scWriteTemp(src)`. Each returns `'{"ok":true}'` or a `jerr(...)`/`scErr(...)` JSON string.
- Consumes (existing host globals): `jerr`, `jsonEscape`, `writeTextFile`, `scErr`, `SC_TMP_SEQ`.

- [ ] **Step 1: Add the export-coverage guard first (failing test)** — in `tests/jsx.exports.test.js`, extend the two arrays so `scripts.jsx` is checked and `scRunFile` is asserted as a loader marker:

```js
const LOADED_MODULES = ['relink.jsx', 'assets.jsx', 'tools.jsx', 'scripts.jsx'];
const MARKERS = ['collectMissingFootage', 'getAssets', 'tlCreateLayer', 'scRunFile'];
```

- [ ] **Step 2: Run tests to verify the export guard passes for existing code but will guard new code** —

Run: `npm test`
Expected: PASS — every existing top-level function in `scripts.jsx` is already `$.global`-exported, and `scRunFile` is already in `hostscript.jsx`'s `DC_MODULE_MARKERS`. (This step locks the guard in before adding new functions.)

- [ ] **Step 3: Implement the host functions** — in `jsx/scripts.jsx`, add before the final lines (after `scRunSnippet`'s export is fine):

```js
// Shared temp-file writer for evalFile-based runs. Returns the File or null.
function scWriteTemp(src) {
    SC_TMP_SEQ = SC_TMP_SEQ + 1;
    var tmp = new File(Folder.temp.fsName + '/dropcomp_run_' + (new Date().getTime()) + '_' + SC_TMP_SEQ + '.jsx');
    if (!writeTextFile(tmp, src)) return null;
    return tmp;
}
$.global.scWriteTemp = scWriteTemp;

// Minimal guard: params must be a non-empty JSON object string from the panel.
function scValidParamsJson(s) {
    if (s === null || s === undefined) return false;
    s = String(s);
    return s.length > 0 && s.charAt(0) === '{';
}
$.global.scValidParamsJson = scValidParamsJson;

// Run an external file with DropComp-provided params. Sets $.global.DC_PARAMS, then
// evalFiles the real file (never modified). valuesJson is JSON from the panel - a subset
// of ES3 literal syntax - so inlining it after '=' is safe (cannot break out).
function scRunFileWithParams(path, valuesJson) {
    var tmp = null;
    try {
        var f = new File(path);
        if (!f.exists) return jerr('Script file not found:\n' + path);
        if (!scValidParamsJson(valuesJson)) return jerr('Bad parameters.');
        var src = '$.global.DC_PARAMS = ' + valuesJson + ';\n' +
                  '$.evalFile(new File("' + jsonEscape(f.fsName) + '"));\n';
        tmp = scWriteTemp(src);
        if (!tmp) return jerr('Could not write a temporary script file.');
        $.evalFile(tmp);
        try { tmp.remove(); } catch (eR) {}
        return '{"ok":true}';
    } catch (e) {
        if (tmp && tmp.exists) { try { tmp.remove(); } catch (e2) {} }
        return scErr(e);
    }
}
$.global.scRunFileWithParams = scRunFileWithParams;

// Run a snippet with params: prepend the DC_PARAMS assignment to the temp file body.
function scRunSnippetWithParams(body, valuesJson) {
    var tmp = null;
    try {
        if (body === null || body === undefined || String(body) === '') return jerr('Snippet is empty.');
        if (!scValidParamsJson(valuesJson)) return jerr('Bad parameters.');
        var src = '$.global.DC_PARAMS = ' + valuesJson + ';\n' + String(body);
        tmp = scWriteTemp(src);
        if (!tmp) return jerr('Could not write a temporary script file.');
        $.evalFile(tmp);
        try { tmp.remove(); } catch (eR) {}
        return '{"ok":true}';
    } catch (e) {
        if (tmp && tmp.exists) { try { tmp.remove(); } catch (e2) {} }
        return scErr(e);
    }
}
$.global.scRunSnippetWithParams = scRunSnippetWithParams;
```

- [ ] **Step 4: Run tests to verify ES3 + exports both pass**

Run: `npm test`
Expected: PASS — `jsx.es3.test.js` finds no banned syntax in the new code; `jsx.exports.test.js` confirms all four new functions are `$.global`-exported.

- [ ] **Step 5: Commit**

```bash
git add jsx/scripts.jsx tests/jsx.exports.test.js
git commit -m "$(printf 'feat(scripts): host run-with-params via DC_PARAMS temp wrapper\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 6: `DCScriptsForm` module (builder + run-form rendering)

**Files:**
- Create: `panel/js/scripts-form.js`
- Modify: `panel/index.html` (load it; add modal markup)
- Modify: `panel/css/style.css` (form + builder styles)

**Interfaces:**
- Consumes: `DCScriptsCore.buildValuesJson` (Task 4).
- Produces:
  - `DCScriptsForm.renderRunForm(entry, onApply, onCancel) -> HTMLElement` — `onApply(valuesJson:string)`.
  - `DCScriptsForm.renderBuilder(containerEl, params)` — fills the editor's inputs list.
  - `DCScriptsForm.addBuilderRow(containerEl)` — appends one blank builder row.
  - `DCScriptsForm.readBuilder(containerEl) -> params[]` — reads rows into a params array.

- [ ] **Step 1: Create the module** — `panel/js/scripts-form.js`:

```js
// DropComp Scripts - form rendering. Builds the editor's "Inputs" builder rows and the
// inline run-form shown under a script row. Pure DOM glue; the typing/serialization logic
// lives in DCScriptsCore (unit-tested).
var DCScriptsForm = (function () {
  'use strict';

  var TYPES = ['text', 'number', 'slider', 'checkbox', 'select'];

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function q(root, sel) { return root.querySelector(sel); }
  function mkInput(type, val, ph, cls) {
    var i = document.createElement('input');
    i.type = type; if (val != null) i.value = val; if (ph) i.placeholder = ph; if (cls) i.className = cls;
    return i;
  }

  // ---------- inline run-form ----------
  function controlFor(p) {
    var input;
    if (p.type === 'checkbox') { input = mkInput('checkbox'); input.checked = !!p['default']; }
    else if (p.type === 'select') {
      input = document.createElement('select');
      var opts = p.options || [];
      for (var i = 0; i < opts.length; i++) {
        var o = document.createElement('option'); o.value = opts[i]; o.textContent = opts[i];
        if (opts[i] === p['default']) o.selected = true;
        input.appendChild(o);
      }
    } else if (p.type === 'slider') {
      input = mkInput('range'); if (p.min != null) input.min = p.min; if (p.max != null) input.max = p.max;
      if (p.step != null) input.step = p.step; input.value = (p['default'] != null ? p['default'] : p.min);
    } else if (p.type === 'number') {
      input = mkInput('number'); if (p.min != null) input.min = p.min; if (p.max != null) input.max = p.max;
      if (p.step != null) input.step = p.step; input.value = (p['default'] != null ? p['default'] : '');
    } else {
      input = mkInput('text'); input.value = (p['default'] != null ? p['default'] : '');
    }
    input.className = 'script-control';
    return input;
  }

  function renderRunForm(entry, onApply, onCancel) {
    var params = entry.params || [];
    var wrap = el('div', 'script-form');
    var inputs = {};
    for (var i = 0; i < params.length; i++) {
      var p = params[i];
      var field = el('label', 'script-field');
      field.appendChild(el('span', 'script-field-label', p.label || p.key));
      var input = controlFor(p);
      inputs[p.key] = input;
      field.appendChild(input);
      wrap.appendChild(field);
    }
    var btns = el('div', 'script-form-btns');
    var cancel = el('button', 'btn-dark', 'Cancel'); cancel.type = 'button';
    cancel.addEventListener('click', function () { if (onCancel) onCancel(); });
    var apply = el('button', 'btn-gold', 'Apply'); apply.type = 'button';
    apply.addEventListener('click', function () {
      var raw = {};
      for (var k in inputs) {
        if (inputs.hasOwnProperty(k)) raw[k] = (inputs[k].type === 'checkbox') ? inputs[k].checked : inputs[k].value;
      }
      onApply(DCScriptsCore.buildValuesJson(params, raw));
    });
    btns.appendChild(cancel); btns.appendChild(apply);
    wrap.appendChild(btns);
    return wrap;
  }

  // ---------- editor builder ----------
  function builderRow(p) {
    p = p || { type: 'text' };
    var row = el('div', 'builder-row');
    row.dataset.type = p.type || 'text';
    row.appendChild(mkInput('text', p.label || '', 'Label', 'builder-label'));
    row.appendChild(mkInput('text', p.key || '', 'key', 'builder-key'));

    var type = document.createElement('select'); type.className = 'builder-type';
    for (var i = 0; i < TYPES.length; i++) {
      var o = document.createElement('option'); o.value = TYPES[i]; o.textContent = TYPES[i];
      if (TYPES[i] === (p.type || 'text')) o.selected = true;
      type.appendChild(o);
    }
    type.addEventListener('change', function () { row.dataset.type = type.value; });
    row.appendChild(type);

    var num = el('div', 'b-num');
    num.appendChild(mkInput('number', p.min != null ? p.min : '', 'min', 'b-min'));
    num.appendChild(mkInput('number', p.max != null ? p.max : '', 'max', 'b-max'));
    num.appendChild(mkInput('number', p.step != null ? p.step : '', 'step', 'b-step'));
    row.appendChild(num);

    row.appendChild(mkInput('text', (p.options || []).join(', '), 'options, comma separated', 'b-opts-input b-opts'));
    row.appendChild(mkInput('text', p['default'] != null ? p['default'] : '', 'default', 'builder-default'));

    var rm = el('button', 'script-action', ''); rm.type = 'button'; rm.textContent = '✕';
    rm.setAttribute('data-tip', 'Remove input');
    rm.addEventListener('click', function () { if (row.parentNode) row.parentNode.removeChild(row); });
    row.appendChild(rm);
    return row;
  }

  function renderBuilder(container, params) {
    container.innerHTML = '';
    var list = params || [];
    for (var i = 0; i < list.length; i++) container.appendChild(builderRow(list[i]));
  }

  function addBuilderRow(container) { container.appendChild(builderRow({ type: 'text' })); }

  function readBuilder(container) {
    var rows = container.querySelectorAll('.builder-row');
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var type = q(r, '.builder-type').value;
      var p = { key: q(r, '.builder-key').value.trim(), label: q(r, '.builder-label').value.trim(), type: type };
      if (type === 'number' || type === 'slider') {
        var mn = q(r, '.b-min').value, mx = q(r, '.b-max').value, st = q(r, '.b-step').value;
        if (mn !== '') p.min = parseFloat(mn);
        if (mx !== '') p.max = parseFloat(mx);
        if (st !== '') p.step = parseFloat(st);
      }
      if (type === 'select') {
        var raw = q(r, '.b-opts-input').value.split(','), clean = [];
        for (var j = 0; j < raw.length; j++) { var o = raw[j].trim(); if (o) clean.push(o); }
        p.options = clean;
      }
      p['default'] = q(r, '.builder-default').value;
      out.push(p);
    }
    return out;
  }

  return {
    renderRunForm: renderRunForm,
    renderBuilder: renderBuilder,
    addBuilderRow: addBuilderRow,
    readBuilder: readBuilder
  };
}());
```

- [ ] **Step 2: Load the module + add modal markup** — in `panel/index.html`:

  (a) Add the script tag **after** `scripts-core.js` and **before** `scripts.js`:
```html
<script src="js/scripts-form.js"></script>
```

  (b) In `#script-modal`, insert after the `#script-path-group` block and before `.modal-buttons`:
```html
    <div class="form-group" id="script-inputs-group">
      <label>Inputs <span class="label-aside">optional — renders a form in the panel instead of a window</span></label>
      <div id="script-inputs-list"></div>
      <button type="button" id="script-add-input" class="btn-dark btn-sm" data-tip="Add an input control">+ Add input</button>
    </div>
    <label class="checkbox-row" id="script-window-row">
      <input type="checkbox" id="script-opens-window">
      <span>This script opens its own floating window</span>
    </label>
```

- [ ] **Step 3: Add styles** — append to `panel/css/style.css`:

```css
/* ---- script run-form (inline under a row) ---- */
.script-row { flex-wrap: wrap; }
.script-form { flex: 1 0 100%; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; }
.script-field { display: flex; align-items: center; gap: 8px; }
.script-field-label { font-size: 11px; color: var(--text-mid); flex: 0 0 96px; }
.script-control { flex: 1; min-width: 0; background: var(--bg-inset); border: 1px solid var(--border-strong); color: var(--text); border-radius: var(--radius); font-size: 12px; padding: 6px 8px; }
.script-control[type="range"] { padding: 0; }
.script-control[type="checkbox"] { flex: 0 0 auto; width: 16px; height: 16px; }
.script-control:focus { border-color: var(--gold); }
.script-form-btns { display: flex; gap: 8px; justify-content: flex-end; }
.script-form-btns button { padding: 6px 14px; }
.script-row.has-form .script-run { box-shadow: 0 0 0 2px var(--gold-bg); }

/* ---- editor inputs builder ---- */
.label-aside { color: var(--text-dim); font-weight: 400; }
.btn-sm { font-size: 11px; padding: 5px 9px; margin-top: 6px; }
#script-inputs-list { display: flex; flex-direction: column; gap: 6px; }
.builder-row { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; background: var(--bg-inset); border: 1px solid var(--border); border-radius: 6px; padding: 6px; }
.builder-row input, .builder-row select { background: var(--bg); border: 1px solid var(--border-strong); color: var(--text); border-radius: 5px; font-size: 11px; padding: 5px 6px; }
.builder-label { flex: 1 1 70px; min-width: 0; }
.builder-key { flex: 1 1 60px; min-width: 0; }
.builder-type { flex: 0 0 auto; }
.builder-default { flex: 1 1 60px; min-width: 0; }
.b-num { display: none; gap: 4px; }
.b-num input { width: 48px; }
.builder-row[data-type="number"] .b-num, .builder-row[data-type="slider"] .b-num { display: flex; }
.b-opts { display: none; flex: 1 1 100%; }
.builder-row[data-type="select"] .b-opts { display: block; }
.checkbox-row { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-mid); margin-bottom: 12px; text-align: left; }
.checkbox-row input { width: 16px; height: 16px; }
```

- [ ] **Step 4: Run tests** (no logic change; confirm green)

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Verify the module loads in the harness** — open `_harness.html`, open the browser console, and confirm `typeof DCScriptsForm === 'object'` and `typeof DCScriptsForm.renderRunForm === 'function'`. (Wiring into the UI happens in Task 7.)

- [ ] **Step 6: Commit**

```bash
git add panel/js/scripts-form.js panel/index.html panel/css/style.css
git commit -m "$(printf 'feat(scripts): DCScriptsForm builder + inline run-form rendering\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 7: Wire forms into the Scripts controller (`scripts.js`)

**Files:**
- Modify: `panel/js/scripts.js`

**Interfaces:**
- Consumes: `DCScriptsForm.renderRunForm/renderBuilder/addBuilderRow/readBuilder` (Task 6); `scRunFileWithParams`/`scRunSnippetWithParams` (Task 5); `DCScriptsCore` validate/normalize (Task 4).

- [ ] **Step 1: Mount the new editor controls** — in `mount()`, add element refs and the add-input handler. After `els.pathDisplay = ...`:
```js
    els.inputsList = document.getElementById('script-inputs-list');
    els.opensWindow = document.getElementById('script-opens-window');
    document.getElementById('script-add-input').addEventListener('click', function () {
      DCScriptsForm.addBuilderRow(els.inputsList);
    });
```

- [ ] **Step 2: Populate the builder when editing** — in `openEditor(entry)`, before `els.modal.classList.remove('hidden');`, add:
```js
    DCScriptsForm.renderBuilder(els.inputsList, entry.params || []);
    els.opensWindow.checked = !!entry.opensWindow;
```

- [ ] **Step 3: Save params + opensWindow** — in `saveEntry()`, extend the `input` object with two fields (after `addedAt: editing.addedAt`):
```js
      addedAt: editing.addedAt,
      params: DCScriptsForm.readBuilder(els.inputsList),
      opensWindow: els.opensWindow.checked
```

- [ ] **Step 4: Add the form-aware run path** — replace the body of `runScript(s)` so params open the inline form, and factor a shared success message:
```js
  function okMsg(s) {
    return s.opensWindow ? ('Opened "' + s.name + '" in a floating AE window.') : ('Ran "' + s.name + '".');
  }

  function runScript(s) {
    var row = els.list.querySelector('.script-row[data-id="' + s.uniqueId + '"]');
    if (s.params && s.params.length && row) { toggleRunForm(row, s); return; }
    if (!DCBridge.acquire('runScript')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
    var fn = s.source === 'file' ? 'scRunFile' : 'scRunSnippet';
    var arg = s.source === 'file' ? s.path : s.body;
    DCBridge.call(fn, [arg], function (result) {
      DCBridge.release();
      var r = DCBridge.parseJson(result);
      if (r && r.ok) { bumpUsage(s.uniqueId); DCUI.toast(okMsg(s), false); render(); }
      else DCUI.toast((r && r.error) || result || 'Script failed.', true);
    });
  }

  function toggleRunForm(row, s) {
    var existing = row.querySelector('.script-form');
    var open = els.list.querySelector('.script-form');
    if (open) open.parentNode.removeChild(open);
    if (existing) return; // re-click on the same row collapses it
    var form = DCScriptsForm.renderRunForm(s,
      function (valuesJson) { runWithParams(s, valuesJson); },
      function () { var f = row.querySelector('.script-form'); if (f) f.parentNode.removeChild(f); });
    row.appendChild(form);
    var first = form.querySelector('input, select, textarea');
    if (first) first.focus();
  }

  function runWithParams(s, valuesJson) {
    if (!DCBridge.acquire('runScript')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
    var fn = s.source === 'file' ? 'scRunFileWithParams' : 'scRunSnippetWithParams';
    var arg = s.source === 'file' ? s.path : s.body;
    DCBridge.call(fn, [arg, valuesJson], function (result) {
      DCBridge.release();
      var r = DCBridge.parseJson(result);
      if (r && r.ok) {
        bumpUsage(s.uniqueId);
        DCUI.toast(okMsg(s), false);
        var openForm = els.list.querySelector('.script-form');
        if (openForm) openForm.parentNode.removeChild(openForm);
        render();
      } else DCUI.toast((r && r.error) || result || 'Script failed.', true);
    });
  }
```

- [ ] **Step 5: Mark form-capable rows** — in `buildRow(s)`, change the row class line to add `has-form` when the script has params. Replace:
```js
    var row = el('div', 'script-row' + (usage.isFavorite ? ' has-fav' : ''));
```
with:
```js
    var row = el('div', 'script-row' + (usage.isFavorite ? ' has-fav' : '') + (s.params && s.params.length ? ' has-form' : ''));
```

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: PASS (controller is DOM glue; pure logic already covered).

- [ ] **Step 7: Verify end-to-end in the harness** — open `_harness.html`:
  1. New Snippet → name it, paste body `alert(DC_PARAMS.msg);`, add one input `msg`/text/default "hi", Save.
  2. The row shows the gold ring (`has-form`); click Run → inline form appears with a text field defaulting to "hi".
  3. Change it, click Apply → confirm the mock bridge received `scRunSnippetWithParams` with `["alert(DC_PARAMS.msg);","{\"msg\":\"...\"}"]` (check console/network panel of the harness mock).
  Screenshot the expanded inline form.

- [ ] **Step 8: Commit**

```bash
git add panel/js/scripts.js
git commit -m "$(printf 'feat(scripts): inline param form run path + opensWindow labeling\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 8: Version bump to 2.4.0 + README note

**Files:**
- Modify: `package.json`, `CSXS/manifest.xml`, `panel/js/update.js`
- Modify: `README.md`

- [ ] **Step 1: Find every 2.3.0**

Run: `grep -rn "2\.3\.0" package.json CSXS/manifest.xml panel/js/update.js`
Expected: the `version` in `package.json`, the `DCUpdate.VERSION` string in `update.js`, and the `ExtensionBundleVersion` (+ any `Extension`/`csxs` `Version`) in `manifest.xml`.

- [ ] **Step 2: Replace each `2.3.0` with `2.4.0`** in those three files (use exact edits per match from Step 1).

- [ ] **Step 3: Add a README note** — under the Scripts section of `README.md`, add:

```markdown
### Make a script DropComp-driven (in-panel form)

Instead of opening its own floating window, a script can read its inputs from a
form DropComp renders inside the panel. In the script's editor, add Inputs (a key,
type, and default for each), then in the script read them from `DC_PARAMS`:

    var P = $.global.DC_PARAMS || {};   // P.spacing, P.mode, ...
    var spacing = (P.spacing != null) ? P.spacing : 10;

`DC_PARAMS` is set only when DropComp runs the script with a form, so the `|| {}`
guard keeps the script working if you run it the old way too. Third-party panels
you can't edit still run as a floating window — tick "opens its own floating window"
on them so the panel labels them honestly.
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS (if any test asserts the version, update it to 2.4.0).

- [ ] **Step 5: Commit**

```bash
git add package.json CSXS/manifest.xml panel/js/update.js README.md
git commit -m "$(printf 'chore(release): bump to 2.4.0; document DropComp-driven scripts\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 9: Live-AE verification + full review

**Files:** none (verification only; fixes go back into the relevant task's files).

- [ ] **Step 1: Full test run**

Run: `npm test`
Expected: PASS — entire suite green.

- [ ] **Step 2: Live AE — snippet form** — using the live-AE harness (`osascript ... DoScript`, the established pattern), load the panel and:
  - Create a snippet `app.beginUndoGroup('p'); var P=$.global.DC_PARAMS||{}; var s=app.project.activeItem; if(s){ var L=s.selectedLayers; for(var i=0;i<L.length;i++){ L[i].position.setValue([P.x||0, P.y||0]); } } app.endUndoGroup();` with two number inputs `x`,`y`.
  - Select layers, Run → form → Apply. Confirm layers move to (x,y) and `DC_PARAMS` was read. Confirm the temp file in `Folder.temp` is removed.

- [ ] **Step 3: Live AE — file `.jsx` with params** — register a small `.jsx` file that reads `$.global.DC_PARAMS`; Run with a form; confirm it executes and the original file is unchanged on disk.

- [ ] **Step 4: Live AE — windowed script unaffected** — register a script that does `new Window('palette','t').show()` with no inputs and `opensWindow` ticked; Run → confirms it floats and the toast reads "Opened … in a floating AE window."

- [ ] **Step 5: Self-review against the spec** — re-read `docs/superpowers/specs/2026-06-18-tooltips-and-script-ui-design.md` §3–§5 and confirm each requirement maps to a shipped task. Check file sizes:

Run: `wc -l panel/js/scripts.js panel/js/scripts-form.js panel/js/tooltip.js`
Expected: each < 400.

- [ ] **Step 6: Final commit (if any verification fixes were made)**

```bash
git add -A
git commit -m "$(printf 'test(scripts): live-AE verification of DC_PARAMS run paths\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Self-Review

**1. Spec coverage:**
- §3 Tooltips → Tasks 1–3 (helpers, controller+styles, `data-tip` migration). ✓
- §3.4 script-row rich tip → Task 1 `buildScriptTip` + Task 3 row wiring. ✓
- §4 param schema/validation → Task 4. ✓
- §4.3 builder → Task 6 + Task 7 wiring. ✓
- §4.4 inline run form → Task 6 `renderRunForm` + Task 7 `toggleRunForm`. ✓
- §4.5 host injection → Task 5. ✓
- §4.6 script contract / README → Task 8. ✓
- §5 windowed labeling (`opensWindow`) → Task 4 (field) + Task 7 (`okMsg`) + Task 6 (checkbox). ✓
- §6 module table → Tasks 1,4,5,6,7 touch exactly those files. ✓
- §7 file-size → Task 9 Step 5 check; form UI split into `scripts-form.js`. ✓
- §10 tests → Tasks 1,4,5 are TDD; §11 live-AE → Task 9. ✓
- Version bump (Global Constraints) → Task 8. ✓

**2. Placeholder scan:** No "TBD"/"add error handling"/"similar to". All code blocks are complete; `<name>`-style tokens appear only inside generated strings, not as instructions.

**3. Type consistency:** `buildValuesJson(params, rawValues)` defined in Task 4, consumed in Task 6 `renderRunForm`. `renderRunForm(entry, onApply, onCancel)` defined in Task 6, consumed in Task 7 `toggleRunForm`. `readBuilder`/`renderBuilder`/`addBuilderRow` consistent across Tasks 6–7. Host `scRunFileWithParams`/`scRunSnippetWithParams` names match between Task 5 (def) and Task 7 (call). `okMsg`, `runWithParams`, `toggleRunForm` all defined and used within Task 7. ✓
