const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(
  path.join(__dirname, '..', 'panel', 'css', 'style.css'), 'utf8');
const flat = css.replace(/\s+/g, ' ');

test('folder columns wrapper lays category sections out as multiple columns', () => {
  const m = flat.match(/#library\s+\.category-columns\s*\{([^}]*)\}/);
  assert.ok(m, 'expected a #library .category-columns rule');
  assert.match(m[1], /display:\s*grid/);
  assert.match(m[1], /grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(150px,\s*1fr\)\)/);
});

test('folder columns stack cards inside each folder column', () => {
  assert.match(flat,
    /#library\s+\.category-columns\s+\.grid\s*\{[^}]*grid-template-columns:\s*1fr/,
    'inner card grids should stack one-per-row inside folder columns');
});
