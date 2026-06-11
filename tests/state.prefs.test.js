const test = require('node:test');
const assert = require('node:assert/strict');
const DCState = require('../panel/js/state.js');

function mockStorage(initial) {
  const data = Object.assign({}, initial);
  return {
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: k => { delete data[k]; },
    _data: data
  };
}

test('defaultPrefs shape', () => {
  assert.deepEqual(DCState.defaultPrefs(), {
    thumbMin: 130, sort: 'recent', showNames: true, showMeta: true,
    favoritesOnly: false, collapsed: []
  });
});

test('loadPrefs returns defaults on empty storage', () => {
  assert.deepEqual(DCState.loadPrefs(mockStorage()), DCState.defaultPrefs());
});

test('loadPrefs migrates legacy compact density once, removing old keys', () => {
  const s = mockStorage({ dropcomp_view: 'list', dropcomp_density: 'compact' });
  const prefs = DCState.loadPrefs(s);
  assert.equal(prefs.thumbMin, 100);
  assert.equal(s.getItem('dropcomp_view'), null);
  assert.equal(s.getItem('dropcomp_density'), null);
});

test('savePrefs/loadPrefs roundtrip, unknown saved keys ignored', () => {
  const s = mockStorage();
  const prefs = DCState.defaultPrefs();
  prefs.thumbMin = 200;
  prefs.collapsed = ['Titles'];
  DCState.savePrefs(s, prefs);
  s.setItem('dropcomp_prefs', JSON.stringify(Object.assign(
    JSON.parse(s.getItem('dropcomp_prefs')), { junk: 1 })));
  const loaded = DCState.loadPrefs(s);
  assert.equal(loaded.thumbMin, 200);
  assert.deepEqual(loaded.collapsed, ['Titles']);
  assert.equal('junk' in loaded, false);
});

test('loadPrefs survives corrupted JSON', () => {
  const s = mockStorage({ dropcomp_prefs: '{not json' });
  assert.deepEqual(DCState.loadPrefs(s), DCState.defaultPrefs());
});

test('usage meta roundtrip and corruption fallback', () => {
  const s = mockStorage();
  DCState.saveUsageMeta(s, { a_1: { lastUsed: 1, useCount: 2, isFavorite: true } });
  assert.equal(DCState.loadUsageMeta(s).a_1.useCount, 2);
  assert.deepEqual(DCState.loadUsageMeta(mockStorage({ dropcomp_metadata: '{bad' })), {});
});

test('cleanupStaleMetadata drops ids that no longer exist', () => {
  const meta = { keep_1: { useCount: 1 }, stale_2: { useCount: 9 } };
  const r = DCState.cleanupStaleMetadata(meta, [{ uniqueId: 'keep_1' }]);
  assert.deepEqual(Object.keys(r.usageMeta), ['keep_1']);
  assert.equal(r.removed, 1);
});

test('migrateMetadataKey moves favorites/usage to the renamed id', () => {
  const meta = { old_1: { isFavorite: true, useCount: 3, lastUsed: 7 } };
  DCState.migrateMetadataKey(meta, 'old_1', 'new_1');
  assert.equal(meta.old_1, undefined);
  assert.equal(meta.new_1.useCount, 3);
});
