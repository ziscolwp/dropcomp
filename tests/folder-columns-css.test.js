const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(
  path.join(__dirname, '..', 'panel', 'css', 'style.css'), 'utf8');
const flat = css.replace(/\s+/g, ' ');

test('folder columns wrapper lays category sections out as balanced columns', () => {
  const m = flat.match(/#library\s+\.category-columns\s*\{([^}]*)\}/);
  assert.ok(m, 'expected a #library .category-columns rule');
  assert.match(m[1], /column-width:\s*150px/);
  assert.match(m[1], /column-gap:\s*12px/);
});

test('folder columns keep each folder together while balancing the column stack', () => {
  assert.match(flat,
    /#library\s+\.category-columns\s+\.category\s*\{[^}]*break-inside:\s*avoid/,
    'folder sections should not split across columns');
  assert.match(flat,
    /#library\s+\.category-columns\s+\.category\s*\{[^}]*display:\s*inline-block/,
    'folder sections should participate as intact column blocks');
});

test('folder columns stack cards inside each folder column', () => {
  assert.match(flat,
    /#library\s+\.category-columns\s+\.grid\s*\{[^}]*grid-template-columns:\s*1fr/,
    'inner card grids should stack one-per-row inside folder columns');
});

test('compact view does not override stacked cards inside folder columns', () => {
  assert.match(flat,
    /#library\.view-compact\s+\.category-columns\s+\.grid\s*\{[^}]*grid-template-columns:\s*1fr/,
    'dense grid should still keep cards readable inside folder columns');
});
