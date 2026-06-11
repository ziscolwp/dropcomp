const test = require('node:test');
const assert = require('node:assert/strict');
const DCState = require('../panel/js/state.js');

const comps = [
  { name: 'Beta', uniqueId: 'Beta_1700000000002', category: 'Titles' },
  { name: 'Alpha', uniqueId: 'Alpha_1700000000001', category: 'Titles' },
  { name: 'Gamma', uniqueId: 'Gamma_1700000000003', category: 'Icons' }
];
const usage = {
  Beta_1700000000002: { lastUsed: 50, useCount: 1, isFavorite: true },
  Gamma_1700000000003: { lastUsed: 99, useCount: 7, isFavorite: false }
};

function names(arr) { return arr.map(c => c.name); }

test('sort by name', () => {
  assert.deepEqual(names(DCState.sortComps(comps, 'name', usage)), ['Alpha', 'Beta', 'Gamma']);
});

test('sort by recently used puts never-used last, ties broken by name', () => {
  assert.deepEqual(names(DCState.sortComps(comps, 'recent', usage)), ['Gamma', 'Beta', 'Alpha']);
});

test('sort by most used', () => {
  assert.deepEqual(names(DCState.sortComps(comps, 'mostUsed', usage)), ['Gamma', 'Beta', 'Alpha']);
});

test('sort by date added (newest first, uniqueId fallback)', () => {
  assert.deepEqual(names(DCState.sortComps(comps, 'dateAdded', usage)), ['Gamma', 'Beta', 'Alpha']);
});

test('sortComps does not mutate the input', () => {
  const before = names(comps);
  DCState.sortComps(comps, 'name', usage);
  assert.deepEqual(names(comps), before);
});

test('filter by search is case-insensitive', () => {
  assert.deepEqual(names(DCState.filterComps(comps, { search: 'alPH' })), ['Alpha']);
  assert.equal(DCState.filterComps(comps, { search: 'zzz' }).length, 0);
});

test('filter favoritesOnly uses usage metadata', () => {
  assert.deepEqual(
    names(DCState.filterComps(comps, { favoritesOnly: true, usageMeta: usage })),
    ['Beta']
  );
});

test('groupByCategory returns alphabetical sections', () => {
  const groups = DCState.groupByCategory(comps);
  assert.deepEqual(groups.map(g => g.category), ['Icons', 'Titles']);
  assert.equal(groups[1].items.length, 2);
});

test('getUsage returns a zero record for unknown ids', () => {
  assert.deepEqual(DCState.getUsage(usage, 'nope'), { lastUsed: 0, useCount: 0, isFavorite: false });
  assert.deepEqual(DCState.getUsage(null, 'nope'), { lastUsed: 0, useCount: 0, isFavorite: false });
});
