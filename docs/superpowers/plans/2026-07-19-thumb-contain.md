# Whole-Graphic Library Thumbnails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the entire comp graphic in library card thumbnails by switching `object-fit` from `cover` to `contain` in grid and list views.

**Architecture:** Display-only CSS change in `panel/css/style.css`, guarded by a CSS contract test following the repo's established read-the-stylesheet test pattern. No ExtendScript, no JS, no thumbnail regeneration.

**Tech Stack:** Plain CSS; `node:test` contract tests.

## Global Constraints

- Branch: `feature/thumb-contain` (already created, spec committed).
- Spec: `docs/superpowers/specs/2026-07-19-thumb-contain-design.md`.
- Do NOT touch `.card--asset .card-thumb img` (keeps `contain` + 10px padding).
- Never `git add -A` — stage exact paths (parallel sessions share this tree).
- Test runner: `npm test` → `node --test "tests/**/*.test.js"`.

---

### Task 1: Contain-fit thumbnails with CSS contract test

**Files:**
- Create: `tests/library-thumb-css.test.js`
- Modify: `panel/css/style.css:260` and `panel/css/style.css:635`

**Interfaces:**
- Consumes: `panel/css/style.css` selectors `.card-thumb img` and `#library.view-list .card--row .card-thumb img` (both currently declare `object-fit: cover`).
- Produces: both selectors declare `object-fit: contain`; no later task depends on this.

- [ ] **Step 1: Write the failing test**

Create `tests/library-thumb-css.test.js`:

```js
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const css = fs.readFileSync(path.join(__dirname, '..', 'panel', 'css', 'style.css'), 'utf8');

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(escaped + '\\s*\\{([^}]*)\\}', 'm').exec(css);
  return match ? match[1] : '';
}

test('grid card thumbs show the whole comp graphic', () => {
  const body = ruleBody('.card-thumb img');

  assert.notEqual(body, '', 'expected a .card-thumb img rule');
  assert.match(body, /object-fit\s*:\s*contain/i);
  assert.doesNotMatch(body, /object-fit\s*:\s*cover/i);
});

test('list view row thumbs show the whole comp graphic', () => {
  const body = ruleBody('#library.view-list .card--row .card-thumb img');

  assert.notEqual(body, '', 'expected a list-view thumb rule');
  assert.match(body, /object-fit\s*:\s*contain/i);
  assert.doesNotMatch(body, /object-fit\s*:\s*cover/i);
});

test('asset card thumbs keep their padded contain treatment', () => {
  const body = ruleBody('.card--asset .card-thumb img');

  assert.notEqual(body, '', 'expected an asset thumb rule');
  assert.match(body, /object-fit\s*:\s*contain/i);
  assert.match(body, /padding\s*:\s*10px/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/library-thumb-css.test.js`
Expected: FAIL — the two comp-thumb tests fail on `object-fit: cover`; the asset test passes.

- [ ] **Step 3: Flip the two declarations**

In `panel/css/style.css` line 260, change:

```css
.card-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
```

to:

```css
.card-thumb img { width: 100%; height: 100%; object-fit: contain; display: block; }
```

In `panel/css/style.css` line 635, change:

```css
#library.view-list .card--row .card-thumb img { object-fit: cover; padding: 0; }
```

to:

```css
#library.view-list .card--row .card-thumb img { object-fit: contain; padding: 0; }
```

- [ ] **Step 4: Run the new test to verify it passes**

Run: `node --test tests/library-thumb-css.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all tests pass (459+ before this change; +3 new).

- [ ] **Step 6: Commit**

```bash
git add tests/library-thumb-css.test.js panel/css/style.css
git commit -m "feat(library): letterbox non-16:9 comp thumbnails instead of cropping"
```
