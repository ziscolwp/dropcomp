const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(
  path.join(__dirname, '..', 'panel', 'css', 'style.css'), 'utf8');

// Collapse whitespace so multi-line rules match as single strings.
const flat = css.replace(/\s+/g, ' ');

test('folder-columns lays the library out as a multi-column grid', () => {
  const m = flat.match(/#library\.folders-cols:not\(\.view-list\)\s*\{([^}]*)\}/);
  assert.ok(m, 'expected a #library.folders-cols:not(.view-list) rule');
  assert.match(m[1], /display:\s*grid/);
  assert.match(m[1], /grid-template-columns:\s*repeat\(auto-fill/);
});

test('folder-columns is scoped away from list view so rows are never squeezed', () => {
  // Every folders-cols layout selector must exclude list view.
  const selectors = flat.match(/#library\.folders-cols[^{]*\{/g) || [];
  assert.ok(selectors.length > 0, 'expected at least one folders-cols rule');
  selectors.forEach(sel => assert.match(sel, /:not\(\.view-list\)/));
});

test('the empty-state placeholder spans all folder columns', () => {
  assert.match(flat, /#library\.folders-cols:not\(\.view-list\)\s*\.placeholder\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
});
