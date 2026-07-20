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
