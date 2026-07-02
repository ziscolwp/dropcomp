const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const core = require('../panel/js/scripts-core.js');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// ---- core: collapsed-category set --------------------------------------------

test('toggleCollapsed adds a category that is not collapsed yet', () => {
  assert.deepEqual(core.toggleCollapsed(['Color'], 'Text'), ['Color', 'Text']);
});

test('toggleCollapsed removes a category that is already collapsed', () => {
  assert.deepEqual(core.toggleCollapsed(['Color', 'Text'], 'Text'), ['Color']);
});

test('toggleCollapsed tolerates a missing list', () => {
  assert.deepEqual(core.toggleCollapsed(null, 'Text'), ['Text']);
});

test('toggleCollapsed does not mutate the input list', () => {
  const input = ['Color'];
  core.toggleCollapsed(input, 'Text');
  assert.deepEqual(input, ['Color']);
});

// ---- panel wiring -------------------------------------------------------------

test('script category headers are collapsible', () => {
  const src = read('panel/js/scripts.js');
  assert.match(src, /toggleCollapsed/, 'scripts.js uses the core collapse helper');
  assert.match(src, /dataset\.action = 'toggleCat'/, 'category header carries the toggle action');
  assert.match(src, /section\.dataset\.category = /, 'section knows its category for toggling');
  assert.match(src, /ICON\.chevron/, 'header shows the shared chevron glyph');
  assert.match(src, /'toggleCat'/, 'list click handler routes the toggle action');
  assert.match(src, /dropcomp_scripts_view/, 'collapsed set persists across sessions');
});

test('collapsed script categories hide their rows via CSS', () => {
  const css = read('panel/css/style.css');
  assert.match(css, /\.script-category\.collapsed \.script-row\s*\{\s*display:\s*none;/,
    'collapsed sections hide rows');
  assert.match(css, /\.script-category\.collapsed[^{]*\.chev[^{]*\{[^}]*rotate\(-90deg\)/,
    'chevron flips when collapsed');
});

test('script category headers stay visible while scrolling a long list', () => {
  const css = read('panel/css/style.css');
  const m = /\.script-cat-header\s*\{([^}]*)\}/.exec(css);
  assert.ok(m, '.script-cat-header rule exists');
  assert.match(m[1], /position:\s*sticky/, 'header is sticky');
  assert.match(m[1], /background:/, 'sticky header paints over the rows beneath it');
  assert.match(m[1], /cursor:\s*pointer/, 'header is clickable');
});
