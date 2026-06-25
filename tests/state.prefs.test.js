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
    favoritesOnly: false, collapsed: [], activeTab: 'library', collapsedAssets: [],
    viewMode: 'comfortable', viewModeAssets: 'comfortable', folderColumns: false
  });
});

test('loadPrefs returns defaults on empty storage', () => {
  assert.deepEqual(DCState.loadPrefs(mockStorage()), DCState.defaultPrefs());
});

test('loadPrefs migrates legacy compact density once, removing old keys', () => {
  const s = mockStorage({ dropcomp_view: 'list', dropcomp_density: 'compact' });
  const prefs = DCState.loadPrefs(s);
  assert.equal(prefs.thumbMin, 100);
  assert.equal(prefs.viewMode, 'list');
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

test('resolveActiveTab coerces unknown or unavailable tabs to library', () => {
  assert.equal(DCState.resolveActiveTab('library', true, true), 'library');
  assert.equal(DCState.resolveActiveTab('assets', true, true), 'assets');
  assert.equal(DCState.resolveActiveTab('tools', true, true), 'tools');
  assert.equal(DCState.resolveActiveTab('assets', false, true), 'library');
  assert.equal(DCState.resolveActiveTab('tools', true, false), 'library');
  assert.equal(DCState.resolveActiveTab('bogus', true, true), 'library');
});

test('loadPrefs preserves a saved tools tab', () => {
  const s = mockStorage();
  const p = DCState.defaultPrefs();
  p.activeTab = 'tools';
  DCState.savePrefs(s, p);
  assert.equal(DCState.loadPrefs(s).activeTab, 'tools');
});

test('normalizeViewMode passes known modes and clamps the rest', () => {
  ['comfortable', 'compact', 'list'].forEach(m =>
    assert.equal(DCState.normalizeViewMode(m), m));
  [undefined, null, '', 'grid', 'LIST', 0].forEach(bad =>
    assert.equal(DCState.normalizeViewMode(bad), 'comfortable'));
});

test('viewClass maps modes to CSS classes and clamps junk', () => {
  assert.equal(DCState.viewClass('comfortable'), 'view-comfortable');
  assert.equal(DCState.viewClass('compact'), 'view-compact');
  assert.equal(DCState.viewClass('list'), 'view-list');
  assert.equal(DCState.viewClass('bogus'), 'view-comfortable');
});

test('folderColumns defaults off and round-trips when saved', () => {
  assert.equal(DCState.defaultPrefs().folderColumns, false);
  const s = mockStorage();
  const p = DCState.defaultPrefs();
  p.folderColumns = true;
  DCState.savePrefs(s, p);
  assert.equal(DCState.loadPrefs(s).folderColumns, true);
});

test('loadPrefs keeps folderColumns off for prefs saved before the option existed', () => {
  const s = mockStorage();
  const legacy = DCState.defaultPrefs();
  delete legacy.folderColumns;
  s.setItem('dropcomp_prefs', JSON.stringify(legacy));
  assert.equal(DCState.loadPrefs(s).folderColumns, false);
});

test('per-tab view modes round-trip independently', () => {
  const s = mockStorage();
  const p = DCState.defaultPrefs();
  p.viewMode = 'list';
  p.viewModeAssets = 'compact';
  DCState.savePrefs(s, p);
  const loaded = DCState.loadPrefs(s);
  assert.equal(loaded.viewMode, 'list');
  assert.equal(loaded.viewModeAssets, 'compact');
});
