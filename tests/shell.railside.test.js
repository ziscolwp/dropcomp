const test = require('node:test');
const assert = require('node:assert/strict');

function freshShell() {
  const p = require.resolve('../panel/js/shell.js');
  delete require.cache[p];
  return require(p);
}

function memStorage() {
  const map = {};
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
    setItem(k, v) { map[k] = String(v); },
    removeItem(k) { delete map[k]; },
  };
}

function recordClassList() {
  const set = new Set();
  return {
    add(c) { set.add(c); },
    remove(c) { set.delete(c); },
    toggle(c, on) {
      if (on === undefined) on = !set.has(c);
      if (on) set.add(c); else set.delete(c);
      return on;
    },
    contains(c) { return set.has(c); },
  };
}

function segBtn(side) {
  return {
    attrs: { 'data-side': side },
    classList: recordClassList(),
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; },
    setAttribute(n, v) { this.attrs[n] = String(v); },
  };
}

function makeEls() {
  const left = segBtn('left');
  const right = segBtn('right');
  return {
    app: { classList: recordClassList() },
    sortSelect: { value: '' },
    thumbSlider: { value: 0, classList: recordClassList() },
    showNamesCb: { checked: false },
    showMetaCb: { checked: false },
    favoritesBtn: { classList: recordClassList() },
    library: { classList: recordClassList() },
    railSideSwitch: { left, right, querySelectorAll() { return [left, right]; } },
  };
}

function installGlobals() {
  global.DCState = require('../panel/js/state.js');
  global.localStorage = memStorage();
  global.document = { documentElement: { style: { setProperty() {} } } };
}

function cleanupGlobals() {
  delete global.DCState;
  delete global.localStorage;
  delete global.document;
}

test('init leaves the rail on the left by default', () => {
  installGlobals();
  try {
    const DCShell = freshShell();
    const els = makeEls();
    DCShell.init(els, 'full');
    assert.equal(els.app.classList.contains('rail-right'), false);
    assert.equal(els.railSideSwitch.left.attrs['aria-pressed'], 'true');
    assert.equal(els.railSideSwitch.right.attrs['aria-pressed'], 'false');
  } finally { cleanupGlobals(); }
});

test('init applies a remembered right-hand rail', () => {
  installGlobals();
  try {
    const prefs = global.DCState.loadPrefs(global.localStorage);
    prefs.railSide = 'right';
    global.DCState.savePrefs(global.localStorage, prefs);
    const DCShell = freshShell();
    const els = makeEls();
    DCShell.init(els, 'full');
    assert.equal(els.app.classList.contains('rail-right'), true);
    assert.equal(els.railSideSwitch.right.attrs['aria-pressed'], 'true');
    assert.equal(els.railSideSwitch.left.attrs['aria-pressed'], 'false');
  } finally { cleanupGlobals(); }
});

test('onRailSideChange applies, persists, and syncs the control', () => {
  installGlobals();
  try {
    const DCShell = freshShell();
    const els = makeEls();
    DCShell.init(els, 'full');
    DCShell.onRailSideChange('right');
    assert.equal(els.app.classList.contains('rail-right'), true);
    assert.equal(els.railSideSwitch.right.classList.contains('active'), true);
    assert.equal(els.railSideSwitch.left.classList.contains('active'), false);
    assert.equal(global.DCState.loadPrefs(global.localStorage).railSide, 'right');
  } finally { cleanupGlobals(); }
});

test('onRailSideChange normalizes junk back to the left edge', () => {
  installGlobals();
  try {
    const DCShell = freshShell();
    const els = makeEls();
    DCShell.init(els, 'full');
    DCShell.onRailSideChange('right');
    DCShell.onRailSideChange('diagonal');
    assert.equal(els.app.classList.contains('rail-right'), false);
    assert.equal(global.DCState.loadPrefs(global.localStorage).railSide, 'left');
  } finally { cleanupGlobals(); }
});
