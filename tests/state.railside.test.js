const test = require('node:test');
const assert = require('node:assert/strict');
const DCState = require('../panel/js/state.js');

function memStorage() {
  const map = {};
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
    setItem(k, v) { map[k] = String(v); },
    removeItem(k) { delete map[k]; },
  };
}

test('normalizeRailSide only ever returns left or right', () => {
  assert.equal(DCState.normalizeRailSide('right'), 'right');
  assert.equal(DCState.normalizeRailSide('left'), 'left');
  for (const junk of ['RIGHT', 'top', '', null, undefined, 42]) {
    assert.equal(DCState.normalizeRailSide(junk), 'left', `junk value: ${junk}`);
  }
});

test('rail defaults to the left edge', () => {
  assert.equal(DCState.loadPrefs(memStorage()).railSide, 'left');
});

test('a chosen rail side round-trips through prefs storage', () => {
  const storage = memStorage();
  const prefs = DCState.loadPrefs(storage);
  prefs.railSide = 'right';
  DCState.savePrefs(storage, prefs);
  assert.equal(DCState.loadPrefs(storage).railSide, 'right');
});
