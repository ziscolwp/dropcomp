const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'panel', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'panel', 'css', 'style.css'), 'utf8');
const DCRail = require('../panel/js/rail.js');

function buttonTag(id) {
  const match = html.match(new RegExp('<button[^>]*id="' + id + '"[^>]*>'));
  assert.ok(match, 'button #' + id + ' missing from index.html');
  return match[0];
}

function cssBlock(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(escaped + '\\s*\\{([^}]*)\\}'));
  assert.ok(match, selector + ' rule missing from style.css');
  return match[1];
}

// ---- markup ----

test('the horizontal tab row is gone', () => {
  assert.ok(!html.includes('id="tabs"'), 'old #tabs nav must be removed');
});

test('the rail is a vertical tablist with the four destinations in order', () => {
  assert.match(html, /<div id="rail-tabs" role="tablist" aria-orientation="vertical"/);
  const order = ['tab-library', 'tab-assets', 'tab-tools', 'tab-scripts', 'settings-btn']
    .map((id) => html.indexOf('id="' + id + '"'));
  order.forEach((idx) => assert.ok(idx !== -1));
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i - 1] < order[i], 'rail destinations out of order at position ' + i);
  }
});

test('each rail tab carries tab semantics, a label, and a tooltip', () => {
  const controls = { 'tab-library': 'library', 'tab-assets': 'library', 'tab-tools': 'tools', 'tab-scripts': 'scripts' };
  const labels = { 'tab-library': 'Library', 'tab-assets': 'Assets', 'tab-tools': 'Tools', 'tab-scripts': 'Scripts' };
  for (const id of Object.keys(controls)) {
    const tag = buttonTag(id);
    assert.match(tag, /role="tab"/, id + ' needs role="tab"');
    assert.ok(tag.includes('aria-controls="' + controls[id] + '"'), id + ' aria-controls');
    assert.ok(tag.includes('aria-label="' + labels[id] + '"'), id + ' aria-label');
    assert.ok(tag.includes('data-tip="' + labels[id] + '"'), id + ' tooltip');
  }
});

test('exactly one rail tab boots selected and tabbable', () => {
  assert.equal((html.match(/aria-selected="true"/g) || []).length, 1);
  const lib = buttonTag('tab-library');
  assert.match(lib, /aria-selected="true"/);
  for (const id of ['tab-assets', 'tab-tools', 'tab-scripts']) {
    assert.match(buttonTag(id), /tabindex="-1"/, id + ' must start out of the tab order');
  }
});

test('settings is a bottom rail action, not a fifth tab', () => {
  const tag = buttonTag('settings-btn');
  assert.ok(!/role="tab"/.test(tag), 'settings must not be a tab');
  assert.match(tag, /aria-label="Settings"/);
  assert.match(tag, /data-tip="Settings"/);
  assert.match(tag, /rail-settings/);
  const railTabsEnd = html.indexOf('</div>', html.indexOf('id="rail-tabs"'));
  assert.ok(html.indexOf('id="settings-btn"') > railTabsEnd, 'settings sits outside the tablist');
});

test('every rail icon is an inline svg with a viewBox', () => {
  const rail = html.slice(html.indexOf('<nav id="rail"'), html.indexOf('</nav>'));
  const svgs = rail.match(/<svg[^>]*>/g) || [];
  assert.equal(svgs.length, 5, 'five rail icons expected');
  svgs.forEach((svg) => assert.match(svg, /viewBox="0 0 24 24"/));
});

// ---- layout css ----

test('the rail is 40px wide with a 1px divider and the content flexes', () => {
  const rail = cssBlock('#rail');
  assert.match(rail, /flex:\s*0 0 40px/);
  assert.match(rail, /border-right:\s*1px solid/);
  const main = cssBlock('#main');
  assert.match(main, /flex:\s*1/);
  assert.match(main, /min-width:\s*0/);
});

test('rail targets are 36px tall and full-bleed; the active tile is 32px round-6', () => {
  assert.match(cssBlock('.rail-btn'), /height:\s*36px/);
  const tile = cssBlock('.rail-btn::before');
  assert.match(tile, /width:\s*32px/);
  assert.match(tile, /height:\s*32px/);
  assert.match(tile, /border-radius:\s*6px/);
});

test('the active tab shows a 2px gold edge marker', () => {
  const marker = cssBlock('.rail-btn.active::after');
  assert.match(marker, /left:\s*0/);
  assert.match(marker, /width:\s*2px/);
  assert.match(marker, /background:\s*var\(--gold\)/);
});

test('keyboard focus keeps a visible gold ring on rail buttons', () => {
  const focus = cssBlock('.rail-btn:focus-visible');
  assert.match(focus, /outline:\s*2px solid var\(--gold\)/);
});

// ---- keyboard behavior ----

test('arrows move vertically with wrap; Home/End jump; other keys pass through', () => {
  assert.equal(DCRail.targetIndex('ArrowDown', 0, 4), 1);
  assert.equal(DCRail.targetIndex('ArrowDown', 3, 4), 0);
  assert.equal(DCRail.targetIndex('ArrowUp', 0, 4), 3);
  assert.equal(DCRail.targetIndex('ArrowUp', 2, 4), 1);
  assert.equal(DCRail.targetIndex('Home', 2, 4), 0);
  assert.equal(DCRail.targetIndex('End', 0, 4), 3);
  assert.equal(DCRail.targetIndex('Enter', 1, 4), null);
  assert.equal(DCRail.targetIndex('Tab', 1, 4), null);
  assert.equal(DCRail.targetIndex('a', 1, 4), null);
  assert.equal(DCRail.targetIndex('ArrowDown', 0, 0), null);
});

function fakeTab(name) {
  return {
    name,
    attrs: {},
    focused: false,
    setAttribute(k, v) { this.attrs[k] = v; },
    focus() { this.focused = true; },
  };
}

function fakeTablist(tabs) {
  const handlers = {};
  return {
    querySelectorAll() { return tabs; },
    addEventListener(type, fn) { handlers[type] = fn; },
    fire(key, target) {
      let prevented = false;
      handlers.keydown({ key, target, preventDefault() { prevented = true; } });
      return prevented;
    },
  };
}

test('keydown roves focus and tabindex without activating', () => {
  const tabs = [fakeTab('library'), fakeTab('assets'), fakeTab('tools'), fakeTab('scripts')];
  const tablist = fakeTablist(tabs);
  DCRail.init(tablist);

  assert.equal(tablist.fire('ArrowDown', tabs[0]), true, 'arrow keydown is consumed');
  assert.equal(tabs[1].focused, true);
  assert.deepEqual(tabs.map((t) => t.attrs.tabindex), ['-1', '0', '-1', '-1']);

  assert.equal(tablist.fire('End', tabs[1]), true);
  assert.equal(tabs[3].focused, true);
  assert.deepEqual(tabs.map((t) => t.attrs.tabindex), ['-1', '-1', '-1', '0']);
});

test('non-navigation keys and outside targets are ignored', () => {
  const tabs = [fakeTab('library'), fakeTab('assets')];
  const tablist = fakeTablist(tabs);
  DCRail.init(tablist);

  assert.equal(tablist.fire('Enter', tabs[0]), false, 'Enter must reach the button (activation)');
  assert.equal(tablist.fire('Tab', tabs[0]), false, 'Tab must exit the rail normally');
  assert.equal(tablist.fire('ArrowDown', { name: 'outsider' }), false, 'non-tab targets ignored');
  assert.equal(tabs[1].focused, false);
});

// ---- shell sync ----

function makeClassEl() {
  const classes = new Set();
  return {
    value: '', checked: false, placeholder: '',
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle(c, on) {
        const next = on === undefined ? !classes.has(c) : !!on;
        next ? classes.add(c) : classes.delete(c);
        return next;
      },
      contains: (c) => classes.has(c),
    },
    classes,
  };
}

function railEls() {
  return {
    app: makeClassEl(), library: makeClassEl(), search: makeClassEl(),
    tabLibrary: makeClassEl(), tabAssets: makeClassEl(), tabTools: makeClassEl(), tabScripts: makeClassEl(),
    sortSelect: makeClassEl(), thumbSlider: makeClassEl(), favoritesBtn: makeClassEl(),
    showNamesCb: makeClassEl(), showMetaCb: makeClassEl(),
    folderLayoutSelect: null, folderColsCb: null, viewSwitch: null,
  };
}

function tabState(els) {
  return ['tabLibrary', 'tabAssets', 'tabTools', 'tabScripts'].map((k) => ({
    active: els[k].classes.has('active'),
    selected: els[k].attrs['aria-selected'],
    tabindex: els[k].attrs.tabindex,
  }));
}

test('setActiveTab keeps exactly one rail tab active, selected, and tabbable', () => {
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  global.localStorage = storage;
  global.document = { documentElement: { style: { setProperty() {} } } };
  global.DCState = require('../panel/js/state.js');
  global.DCLibrary = { ensureLoaded() {}, rerender() {}, resetLoaded() {} };
  global.DCAssets = { ensureLoaded() {}, rerender() {}, resetLoaded() {} };
  global.DCTools = { ensureMounted() {} };
  global.DCScripts = { ensureMounted() {}, resetLoaded() {} };
  try {
    const modulePath = require.resolve('../panel/js/shell.js');
    delete require.cache[modulePath];
    const DCShell = require(modulePath);
    const els = railEls();
    DCShell.init(els, 'full');

    DCShell.setActiveTab('tools', true);
    let state = tabState(els);
    assert.deepEqual(state.map((s) => s.active), [false, false, true, false]);
    assert.deepEqual(state.map((s) => s.selected), ['false', 'false', 'true', 'false']);
    assert.deepEqual(state.map((s) => s.tabindex), ['-1', '-1', '0', '-1']);

    // programmatic change (boot / remote sync path) resynchronizes the rail
    DCShell.setActiveTab('library', true);
    state = tabState(els);
    assert.deepEqual(state.map((s) => s.active), [true, false, false, false]);
    assert.deepEqual(state.map((s) => s.selected), ['true', 'false', 'false', 'false']);
    assert.deepEqual(state.map((s) => s.tabindex), ['0', '-1', '-1', '-1']);

    DCShell.setActiveTab('scripts', true);
    state = tabState(els);
    assert.deepEqual(state.map((s) => s.active), [false, false, false, true]);
    assert.deepEqual(state.map((s) => s.selected), ['false', 'false', 'false', 'true']);
  } finally {
    delete global.localStorage;
    delete global.document;
    delete global.DCState;
    delete global.DCLibrary;
    delete global.DCAssets;
    delete global.DCTools;
    delete global.DCScripts;
  }
});
