const test = require('node:test');
const assert = require('node:assert/strict');

const DCCategoryPicker = require('../panel/js/category-picker.js');

const CATS = ['Alex Beck', 'CJ Webber', 'Mark Mei', 'Morgan ( MAX )', 'Parker'];

// ---- buildRows: empty query ----

test('empty query with no recents lists all categories A-Z', () => {
  const rows = DCCategoryPicker.buildRows(['Parker', 'Alex Beck', 'Mark Mei'], [], '');
  assert.deepEqual(rows, [
    { type: 'category', name: 'Alex Beck', recent: false },
    { type: 'category', name: 'Mark Mei', recent: false },
    { type: 'category', name: 'Parker', recent: false },
  ]);
});

test('empty query floats recents on top under a header, no duplicates', () => {
  const rows = DCCategoryPicker.buildRows(CATS, ['Mark Mei', 'Parker'], '');
  assert.deepEqual(rows, [
    { type: 'recent-header' },
    { type: 'category', name: 'Mark Mei', recent: true },
    { type: 'category', name: 'Parker', recent: true },
    { type: 'divider' },
    { type: 'category', name: 'Alex Beck', recent: false },
    { type: 'category', name: 'CJ Webber', recent: false },
    { type: 'category', name: 'Morgan ( MAX )', recent: false },
  ]);
});

test('recents pointing at deleted categories are dropped', () => {
  const rows = DCCategoryPicker.buildRows(CATS, ['Ghost Client', 'Mark Mei'], '');
  const recentNames = rows.filter((r) => r.recent).map((r) => r.name);
  assert.deepEqual(recentNames, ['Mark Mei']);
});

test('all recents stale means no header and no divider', () => {
  const rows = DCCategoryPicker.buildRows(CATS, ['Ghost Client'], '');
  assert.ok(!rows.some((r) => r.type === 'recent-header'));
  assert.ok(!rows.some((r) => r.type === 'divider'));
});

test('empty query never offers a create row', () => {
  const rows = DCCategoryPicker.buildRows(CATS, [], '');
  assert.ok(!rows.some((r) => r.type === 'create'));
});

// ---- buildRows: filtering ----

test('typing filters case-insensitively by substring, A-Z, no recent grouping', () => {
  const rows = DCCategoryPicker.buildRows(CATS, ['Parker'], 'mA');
  assert.deepEqual(rows, [
    { type: 'category', name: 'Mark Mei', recent: false },
    { type: 'category', name: 'Morgan ( MAX )', recent: false },
    { type: 'create', name: 'mA' },
  ]);
});

test('create row is suppressed on an exact case-insensitive match', () => {
  const rows = DCCategoryPicker.buildRows(CATS, [], 'mark mei');
  assert.ok(!rows.some((r) => r.type === 'create'));
  assert.deepEqual(rows, [{ type: 'category', name: 'Mark Mei', recent: false }]);
});

test('no matches leaves only the create row', () => {
  const rows = DCCategoryPicker.buildRows(CATS, [], 'zzz');
  assert.deepEqual(rows, [{ type: 'create', name: 'zzz' }]);
});

test('create row trims the query', () => {
  const rows = DCCategoryPicker.buildRows(CATS, [], '  New Client  ');
  const create = rows.find((r) => r.type === 'create');
  assert.equal(create.name, 'New Client');
});

test('whitespace-only query behaves like an empty query', () => {
  const rows = DCCategoryPicker.buildRows(CATS, [], '   ');
  assert.ok(!rows.some((r) => r.type === 'create'));
  assert.equal(rows.filter((r) => r.type === 'category').length, CATS.length);
});

// ---- buildRows: empty library ----

test('no categories and no query shows the empty hint row', () => {
  assert.deepEqual(DCCategoryPicker.buildRows([], [], ''), [{ type: 'empty' }]);
});

test('no categories with a query shows just the create row', () => {
  assert.deepEqual(DCCategoryPicker.buildRows([], [], 'Titles'),
    [{ type: 'create', name: 'Titles' }]);
});

// ---- selectableIndices / moveHighlight ----

test('selectableIndices skips headers, dividers, and the empty row', () => {
  const rows = DCCategoryPicker.buildRows(CATS, ['Mark Mei'], '');
  const sel = DCCategoryPicker.selectableIndices(rows);
  sel.forEach((i) => {
    assert.ok(rows[i].type === 'category' || rows[i].type === 'create');
  });
  assert.equal(sel.length, CATS.length); // no duplicates
  assert.equal(DCCategoryPicker.selectableIndices([{ type: 'empty' }]).length, 0);
});

test('moveHighlight clamps at both ends and handles empty lists', () => {
  assert.equal(DCCategoryPicker.moveHighlight(0, -1, 3), 0);
  assert.equal(DCCategoryPicker.moveHighlight(2, 1, 3), 2);
  assert.equal(DCCategoryPicker.moveHighlight(0, 1, 3), 1);
  assert.equal(DCCategoryPicker.moveHighlight(-1, 1, 3), 0);
  assert.equal(DCCategoryPicker.moveHighlight(0, 1, 0), -1);
});

// ---- recents prefs helpers (state.js) ----

const DCState = require('../panel/js/state.js');

test('defaultPrefs whitelists recentCategories for both scopes', () => {
  assert.deepEqual(DCState.defaultPrefs().recentCategories, { library: [], assets: [] });
});

test('categoryScope maps asset flows to assets and the rest to library', () => {
  assert.equal(DCState.categoryScope('addAssets'), 'assets');
  assert.equal(DCState.categoryScope('addShape'), 'assets');
  assert.equal(DCState.categoryScope('stash'), 'library');
  assert.equal(DCState.categoryScope('addAep'), 'library');
});

test('recentCategories tolerates prefs saved before the key existed', () => {
  assert.deepEqual(DCState.recentCategories({}, 'library'), []);
  assert.deepEqual(DCState.recentCategories({ recentCategories: { library: ['A'] } }, 'assets'), []);
  assert.deepEqual(DCState.recentCategories({ recentCategories: { library: ['A'] } }, 'library'), ['A']);
});

test('pushRecentCategory unshifts, dedupes case-insensitively, caps at 4', () => {
  const prefs = DCState.defaultPrefs();
  ['A', 'B', 'C', 'D'].forEach((n) => DCState.pushRecentCategory(prefs, 'library', n));
  assert.deepEqual(prefs.recentCategories.library, ['D', 'C', 'B', 'A']);
  DCState.pushRecentCategory(prefs, 'library', 'a');
  assert.deepEqual(prefs.recentCategories.library, ['a', 'D', 'C', 'B']);
  DCState.pushRecentCategory(prefs, 'library', 'E');
  assert.deepEqual(prefs.recentCategories.library, ['E', 'a', 'D', 'C']);
  assert.deepEqual(prefs.recentCategories.assets, []);
});

test('pushRecentCategory repairs a malformed recentCategories object', () => {
  const prefs = { recentCategories: null };
  DCState.pushRecentCategory(prefs, 'assets', 'Logos');
  assert.deepEqual(prefs.recentCategories.assets, ['Logos']);
});
