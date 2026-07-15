const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

function freshAssetsModule() {
  const modulePath = require.resolve('../panel/js/assets.js');
  delete require.cache[modulePath];
  return require(modulePath);
}

function makeClassList() {
  return { add() {}, remove() {}, toggle() {}, contains() { return false; } };
}

function installGlobals(world) {
  global.localStorage = {};
  global.DCShell = {
    setActiveTab() {},
    getLibraryPath() { return '/Library'; },
    getPrefs() {
      return { activeTab: 'assets', favoritesOnly: false, sort: 'name', collapsedAssets: [] };
    },
    getEls() {
      return {
        categoryModal: { classList: makeClassList() },
        search: { value: '' },
        library: {},
      };
    },
  };
  global.DCUI = {
    openCategoryModal(mode, title) { world.modals.push({ mode, title }); },
    closeModal() {},
    spinner() {},
    toast(msg, isErr) { world.toasts.push({ msg, isErr: !!isErr }); },
    isError(result) { return typeof result === 'string' && result.indexOf('Error') === 0; },
  };
  global.DCBridge = {
    acquire() { return true; },
    release() {},
    busyWith() { return ''; },
    parseJson(result) { try { return JSON.parse(result); } catch (e) { return null; } },
    call(fnName, args, cb) {
      world.calls.push({ fnName, args });
      cb(world.responses[fnName]);
    },
  };
  global.DCState = {
    ASSETS_USAGE_KEY: 'dropcomp_assets_metadata',
    loadUsageMeta() { return {}; },
    cleanupStaleMetadata(usageMeta) { return { removed: 0, usageMeta }; },
    filterComps(items) { return items; },
    groupByCategory() { return []; },
    sortComps(items) { return items; },
  };
  global.DCRender = { render() {} };
  global.DCSync = { broadcast(kind) { world.broadcasts.push(kind); } };
}

function cleanupGlobals() {
  ['localStorage', 'DCShell', 'DCUI', 'DCBridge', 'DCState', 'DCRender', 'DCSync']
    .forEach((k) => { delete global[k]; });
}

function makeWorld(responses) {
  return { calls: [], modals: [], toasts: [], broadcasts: [], responses: Object.assign({
    getShapeSelectionInfo: '{"ok":true,"count":2,"skipped":0,"name":"Star"}',
    addShapeFromSelection: '{"ok":true,"name":"Star","count":2,"skipped":0,"thumbOk":true}',
    getAssets: '[]',
  }, responses || {}) };
}

test('addShapeFlow validates via the host then opens the category modal', () => {
  const world = makeWorld();
  installGlobals(world);
  try {
    const DCAssets = freshAssetsModule();
    DCAssets.addShapeFlow();
    assert.equal(world.calls[0].fnName, 'getShapeSelectionInfo');
    assert.deepEqual(world.modals, [{ mode: 'addShape', title: 'Save Shape to Assets' }]);
  } finally { cleanupGlobals(); }
});

test('addShapeFlow surfaces host validation errors and opens no modal', () => {
  const world = makeWorld({
    getShapeSelectionInfo: '{"ok":false,"error":"Select one or more shape layers first."}',
  });
  installGlobals(world);
  try {
    const DCAssets = freshAssetsModule();
    DCAssets.addShapeFlow();
    assert.equal(world.modals.length, 0);
    assert.equal(world.toasts.length, 1);
    assert.equal(world.toasts[0].isErr, true);
  } finally { cleanupGlobals(); }
});

test('confirmShapeCategory saves the shape and broadcasts to other panels', () => {
  const world = makeWorld();
  installGlobals(world);
  try {
    const DCAssets = freshAssetsModule();
    DCAssets.addShapeFlow();
    DCAssets.confirmShapeCategory('Shapes');
    const saveCall = world.calls.find((c) => c.fnName === 'addShapeFromSelection');
    assert.deepEqual(saveCall.args, ['/Library', 'Shapes']);
    assert.deepEqual(world.broadcasts, ['assets']);
  } finally { cleanupGlobals(); }
});

test('confirmShapeCategory without a pending shape just closes the modal', () => {
  const world = makeWorld();
  installGlobals(world);
  try {
    const DCAssets = freshAssetsModule();
    DCAssets.confirmShapeCategory('Shapes');
    assert.equal(world.calls.find((c) => c.fnName === 'addShapeFromSelection'), undefined);
    assert.deepEqual(world.broadcasts, []);
  } finally { cleanupGlobals(); }
});

// ---- wiring -----------------------------------------------------------------

test('the Add Shape button exists and is wired up', () => {
  const html = read('panel/index.html');
  const mainJs = read('panel/js/main.js');
  const css = read('panel/css/style.css');
  assert.match(html, /id="add-shape-btn"/, 'button markup exists');
  assert.match(html, /add-shape-btn[^>]*data-tip="[^"]*shape[^"]*Assets/i, 'tooltip explains the action');
  assert.match(mainJs, /addShapeBtn/, 'main.js grabs the button');
  assert.match(mainJs, /DCAssets\.addShapeFlow/, 'click routes to addShapeFlow');
  assert.match(css, /#add-shape-btn\s*\{\s*display:\s*none;/, 'hidden outside the Assets tab');
  assert.match(css, /#app\.assets-active\s+#add-shape-btn/, 'shown on the Assets tab');
});

// Field report: icon-only toolbar buttons read as blank squares - every asset
// toolbar action must carry a visible text label, not just a hover tooltip.
test('asset toolbar buttons have visible text labels', () => {
  const html = read('panel/index.html');
  const css = read('panel/css/style.css');
  const buttonMarkup = (id) => {
    const start = html.indexOf(`id="${id}"`);
    assert.notEqual(start, -1, `${id} exists`);
    return html.slice(start, html.indexOf('</button>', start));
  };
  assert.match(buttonMarkup('add-selected-image-btn'), /<span[^>]*>Image<\/span>/, 'Image label visible');
  assert.match(buttonMarkup('add-shape-btn'), /<span[^>]*>Shape<\/span>/, 'Shape label visible');
  // narrow docked panels collapse back to icon-only (tooltips still explain)
  assert.match(css, /@media[^{]*max-width[^{]*\{[^]*?#add-shape-btn span\s*\{\s*display:\s*none/,
    'labels collapse on narrow panels');
});

test('shell routes the addShape modal mode to DCAssets', () => {
  const shellJs = read('panel/js/shell.js');
  assert.match(shellJs, /mode === 'addShape'/, 'shell recognises the addShape mode');
  assert.match(shellJs, /DCAssets\.confirmShapeCategory/, 'shell dispatches to confirmShapeCategory');
});
