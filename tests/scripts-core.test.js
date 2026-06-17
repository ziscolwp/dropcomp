const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../panel/js/scripts-core.js');

test('newUniqueId slugifies the name and appends the timestamp', () => {
  assert.equal(C.newUniqueId('My Cool Script!', 1000), 'my_cool_script_1000');
  assert.equal(C.newUniqueId('   ', 5), 'script_5');
  assert.equal(C.newUniqueId('', 7), 'script_7');
  assert.match(C.newUniqueId('a'.repeat(80), 1), /^a{40}_1$/); // capped at 40
});

test('makeEntry normalises a snippet entry', () => {
  const e = C.makeEntry({ name: '  Fade In ', description: ' does X ', category: '', source: 'snippet', body: 'alert(1)' }, 100);
  assert.equal(e.name, 'Fade In');
  assert.equal(e.description, 'does X');
  assert.equal(e.category, 'Uncategorized');
  assert.equal(e.source, 'snippet');
  assert.equal(e.body, 'alert(1)');
  assert.equal(e.path, null);
  assert.equal(e.addedAt, 100);
  assert.deepEqual(e.tags, []);
  assert.equal(e.uniqueId, 'fade_in_100');
});

test('makeEntry normalises a file entry and drops the body', () => {
  const e = C.makeEntry({ name: 'Panel', category: 'Anim', source: 'file', path: '/x/y.jsx', body: 'ignored' }, 1);
  assert.equal(e.source, 'file');
  assert.equal(e.path, '/x/y.jsx');
  assert.equal(e.body, null);
  assert.equal(e.category, 'Anim');
});

test('makeEntry keeps an existing uniqueId/addedAt on edit', () => {
  const e = C.makeEntry({ uniqueId: 'keep_1', name: 'X', source: 'snippet', body: 'a', addedAt: 42 }, 999);
  assert.equal(e.uniqueId, 'keep_1');
  assert.equal(e.addedAt, 42);
});

test('validateEntry enforces name, length, and source-specific fields', () => {
  assert.equal(C.validateEntry({ name: '', source: 'snippet', body: 'a' }).valid, false);
  assert.equal(C.validateEntry({ name: 'x'.repeat(121), source: 'snippet', body: 'a' }).valid, false);
  assert.equal(C.validateEntry({ name: 'ok', source: 'file', path: '' }).valid, false);
  assert.equal(C.validateEntry({ name: 'ok', source: 'file', path: '/a.jsx' }).valid, true);
  assert.equal(C.validateEntry({ name: 'ok', source: 'snippet', body: '   ' }).valid, false);
  assert.equal(C.validateEntry({ name: 'ok', source: 'snippet', body: 'code' }).valid, true);
});

test('parseRegistry is defensive: missing, corrupt, error-envelope, junk entries', () => {
  assert.deepEqual(C.parseRegistry('{"version":1,"scripts":[]}').scripts, []);
  assert.deepEqual(C.parseRegistry('not json').scripts, []);
  assert.deepEqual(C.parseRegistry('{"ok":false,"error":"x"}').scripts, []);
  assert.deepEqual(C.parseRegistry(null).scripts, []);
  const r = C.parseRegistry('{"scripts":[{"uniqueId":"a_1","name":"A"},{"name":"no id"},{"uniqueId":"b_2"}]}');
  assert.equal(r.scripts.length, 1); // only the entry with both id and name survives
  assert.equal(r.scripts[0].uniqueId, 'a_1');
});

test('serializeRegistry round-trips through parseRegistry', () => {
  const scripts = [{ uniqueId: 'a_1', name: 'A', source: 'snippet', body: 'x' }];
  const raw = C.serializeRegistry(scripts);
  assert.deepEqual(C.parseRegistry(raw).scripts, scripts);
  assert.equal(C.parseRegistry(raw).version, C.REGISTRY_VERSION);
});

test('upsert inserts then replaces by uniqueId', () => {
  let arr = [];
  arr = C.upsert(arr, { uniqueId: 'a_1', name: 'A' });
  assert.equal(arr.length, 1);
  arr = C.upsert(arr, { uniqueId: 'b_2', name: 'B' });
  assert.equal(arr.length, 2);
  arr = C.upsert(arr, { uniqueId: 'a_1', name: 'A2' });
  assert.equal(arr.length, 2);
  assert.equal(arr[0].name, 'A2');
});

test('removeById removes only the matching entry', () => {
  const arr = [{ uniqueId: 'a_1', name: 'A' }, { uniqueId: 'b_2', name: 'B' }];
  const out = C.removeById(arr, 'a_1');
  assert.equal(out.length, 1);
  assert.equal(out[0].uniqueId, 'b_2');
});

test('filterScripts matches name/description/category and favorites', () => {
  const scripts = [
    { uniqueId: 'a_1', name: 'Fade', description: 'opacity', category: 'Anim' },
    { uniqueId: 'b_2', name: 'Slide', description: 'move', category: 'Layout' }
  ];
  assert.equal(C.filterScripts(scripts, { search: 'fade' }).length, 1);
  assert.equal(C.filterScripts(scripts, { search: 'opacity' }).length, 1);
  assert.equal(C.filterScripts(scripts, { search: 'layout' }).length, 1);
  assert.equal(C.filterScripts(scripts, { search: 'zzz' }).length, 0);
  const usage = { a_1: { isFavorite: true } };
  assert.equal(C.filterScripts(scripts, { favoritesOnly: true, usageMeta: usage }).length, 1);
});

test('sortScripts orders by name, recent, mostUsed, dateAdded', () => {
  const scripts = [
    { uniqueId: 'a', name: 'Beta', addedAt: 1 },
    { uniqueId: 'b', name: 'Alpha', addedAt: 3 },
    { uniqueId: 'c', name: 'Gamma', addedAt: 2 }
  ];
  const usage = { a: { lastRun: 5, runCount: 1 }, b: { lastRun: 1, runCount: 9 }, c: { lastRun: 9, runCount: 2 } };
  assert.deepEqual(C.sortScripts(scripts, 'name', usage).map(s => s.name), ['Alpha', 'Beta', 'Gamma']);
  assert.deepEqual(C.sortScripts(scripts, 'recent', usage).map(s => s.uniqueId), ['c', 'a', 'b']);
  assert.deepEqual(C.sortScripts(scripts, 'mostUsed', usage).map(s => s.uniqueId), ['b', 'c', 'a']);
  assert.deepEqual(C.sortScripts(scripts, 'dateAdded', usage).map(s => s.uniqueId), ['b', 'c', 'a']);
});

test('groupByCategory and categories sort alphabetically with a default bucket', () => {
  const scripts = [
    { uniqueId: 'a', name: 'A', category: 'Zebra' },
    { uniqueId: 'b', name: 'B' },
    { uniqueId: 'c', name: 'C', category: 'Alpha' }
  ];
  const groups = C.groupByCategory(scripts);
  assert.deepEqual(groups.map(g => g.category), ['Alpha', 'Uncategorized', 'Zebra']);
  assert.deepEqual(C.categories(scripts), ['Alpha', 'Uncategorized', 'Zebra']);
});
