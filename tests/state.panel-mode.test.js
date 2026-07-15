const test = require('node:test');
const assert = require('node:assert/strict');
const DCState = require('../panel/js/state.js');

test('panelModeFromExtensionId maps the four standalone ids', () => {
  assert.equal(DCState.panelModeFromExtensionId('com.DropComp.library'), 'library');
  assert.equal(DCState.panelModeFromExtensionId('com.DropComp.assets'), 'assets');
  assert.equal(DCState.panelModeFromExtensionId('com.DropComp.tools'), 'tools');
  assert.equal(DCState.panelModeFromExtensionId('com.DropComp.scripts'), 'scripts');
});

test('main and unknown extension ids fall back to full', () => {
  assert.equal(DCState.panelModeFromExtensionId('com.DropComp.ext'), 'full');
  assert.equal(DCState.panelModeFromExtensionId('com.Other.panel'), 'full');
  assert.equal(DCState.panelModeFromExtensionId(undefined), 'full');
  assert.equal(DCState.panelModeFromExtensionId(''), 'full');
});

test('panelModeTitle labels each mode, defaulting to DropComp', () => {
  assert.equal(DCState.panelModeTitle('full'), 'DropComp');
  assert.equal(DCState.panelModeTitle('library'), 'DropComp Library');
  assert.equal(DCState.panelModeTitle('assets'), 'DropComp Assets');
  assert.equal(DCState.panelModeTitle('tools'), 'DropComp Tools');
  assert.equal(DCState.panelModeTitle('scripts'), 'DropComp Scripts');
  assert.equal(DCState.panelModeTitle('nonsense'), 'DropComp');
});

function fakeStorage() {
  const store = {};
  return {
    getItem(k) { return k in store ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
    dump() { return store; },
  };
}

test('savePrefsForMode in full mode persists activeTab as-is', () => {
  const storage = fakeStorage();
  const prefs = DCState.defaultPrefs();
  prefs.activeTab = 'tools';
  DCState.savePrefsForMode(storage, prefs, 'full');
  assert.equal(JSON.parse(storage.dump().dropcomp_prefs).activeTab, 'tools');
});

test('savePrefsForMode in a standalone mode preserves the stored activeTab', () => {
  const storage = fakeStorage();
  // the main panel saved activeTab = 'scripts' after this standalone panel booted
  const mainPrefs = DCState.defaultPrefs();
  mainPrefs.activeTab = 'scripts';
  DCState.savePrefs(storage, mainPrefs);

  // the standalone panel holds a stale activeTab but changed the sort
  const standalonePrefs = DCState.defaultPrefs();
  standalonePrefs.activeTab = 'library';
  standalonePrefs.sort = 'name';
  DCState.savePrefsForMode(storage, standalonePrefs, 'library');

  const saved = JSON.parse(storage.dump().dropcomp_prefs);
  assert.equal(saved.activeTab, 'scripts', 'standalone save must not clobber activeTab');
  assert.equal(saved.sort, 'name', 'the real change must still persist');
});

test('savePrefsForMode in a standalone mode with empty storage keeps the default tab', () => {
  const storage = fakeStorage();
  const prefs = DCState.defaultPrefs();
  prefs.activeTab = 'assets';
  DCState.savePrefsForMode(storage, prefs, 'assets');
  assert.equal(JSON.parse(storage.dump().dropcomp_prefs).activeTab, 'library');
});
