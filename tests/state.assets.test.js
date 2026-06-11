const test = require('node:test');
const assert = require('node:assert/strict');
const DCState = require('../panel/js/state.js');

function fakeStorage(initial) {
  const map = Object.assign({}, initial);
  return {
    getItem: (k) => (k in map ? map[k] : null),
    setItem: (k, v) => { map[k] = String(v); },
    removeItem: (k) => { delete map[k]; },
    dump: () => map,
  };
}

test('formatBytes renders B / KB / MB', () => {
  assert.equal(DCState.formatBytes(0), '0 B');
  assert.equal(DCState.formatBytes(512), '512 B');
  assert.equal(DCState.formatBytes(24576), '24 KB');
  assert.equal(DCState.formatBytes(2621440), '2.5 MB');
  assert.equal(DCState.formatBytes(undefined), '');
});

test('formatAssetMetaLine joins EXT and size, tolerates missing parts', () => {
  assert.equal(DCState.formatAssetMetaLine({ ext: 'png', sizeBytes: 24576 }), 'PNG · 24 KB');
  assert.equal(DCState.formatAssetMetaLine({ ext: 'psd' }), 'PSD');
  assert.equal(DCState.formatAssetMetaLine({}), '');
});

test('defaultPrefs gains activeTab and collapsedAssets', () => {
  const p = DCState.defaultPrefs();
  assert.equal(p.activeTab, 'library');
  assert.deepEqual(p.collapsedAssets, []);
});

test('loadPrefs backfills new keys from defaults for stale saved prefs', () => {
  const storage = fakeStorage({
    dropcomp_prefs: JSON.stringify({ thumbMin: 200, sort: 'name' }), // pre-2.1 prefs
  });
  const p = DCState.loadPrefs(storage);
  assert.equal(p.thumbMin, 200);
  assert.equal(p.activeTab, 'library');
  assert.deepEqual(p.collapsedAssets, []);
});

test('usage meta key parameter isolates asset usage from comp usage', () => {
  const storage = fakeStorage({});
  DCState.saveUsageMeta(storage, { 'a_123': { useCount: 1 } });
  DCState.saveUsageMeta(storage, { 'Icons/a.png': { useCount: 2 } }, DCState.ASSETS_USAGE_KEY);
  assert.notEqual(DCState.ASSETS_USAGE_KEY, 'dropcomp_metadata');
  assert.deepEqual(DCState.loadUsageMeta(storage), { 'a_123': { useCount: 1 } });
  assert.deepEqual(DCState.loadUsageMeta(storage, DCState.ASSETS_USAGE_KEY), { 'Icons/a.png': { useCount: 2 } });
});

test('sort/filter/cleanup work on asset-shaped items (uniqueId with slash, addedAt)', () => {
  const assets = [
    { name: 'b-arrow', category: 'Icons', uniqueId: 'Icons/b-arrow.png', addedAt: 2000 },
    { name: 'a-mouse', category: 'Icons', uniqueId: 'Icons/a-mouse.png', addedAt: 1000 },
  ];
  const byDate = DCState.sortComps(assets, 'dateAdded', {});
  assert.equal(byDate[0].name, 'b-arrow');
  const filtered = DCState.filterComps(assets, { search: 'mouse' });
  assert.equal(filtered.length, 1);
  const cleaned = DCState.cleanupStaleMetadata({ 'Icons/gone.png': {}, 'Icons/a-mouse.png': {} }, assets);
  assert.equal(cleaned.removed, 1);
  assert.ok(cleaned.usageMeta['Icons/a-mouse.png']);
});
