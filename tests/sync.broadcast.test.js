const test = require('node:test');
const assert = require('node:assert/strict');

function freshAssetsModule() {
  const modulePath = require.resolve('../panel/js/assets.js');
  delete require.cache[modulePath];
  return require(modulePath);
}

function makeClassList() {
  return { add() {}, remove() {}, toggle() {}, contains() { return false; } };
}

function installGlobals(broadcasts) {
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
    openCategoryModal() {},
    closeModal() {},
    spinner() {},
    toast() {},
    isError(result) { return typeof result === 'string' && result.indexOf('Error') === 0; },
  };
  global.DCBridge = {
    acquire() { return true; },
    release() {},
    parseJson(result) { try { return JSON.parse(result); } catch (e) { return null; } },
    call(fnName, args, cb) {
      if (fnName === 'pickAssetFiles') cb('{"ok":true,"paths":["/tmp/a.png"]}');
      else if (fnName === 'addAssetFiles') cb('{"ok":true,"added":1,"skipped":[]}');
      else if (fnName === 'getAssets') cb('[]');
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
  global.DCSync = { broadcast(kind) { broadcasts.push(kind); } };
}

function cleanupGlobals() {
  delete global.localStorage;
  delete global.DCShell;
  delete global.DCUI;
  delete global.DCBridge;
  delete global.DCState;
  delete global.DCRender;
  delete global.DCSync;
}

test('adding assets broadcasts an assets change to other panels', () => {
  const broadcasts = [];
  installGlobals(broadcasts);
  try {
    const DCAssets = freshAssetsModule();
    DCAssets.addFlow();                // stages pendingPaths via pickAssetFiles
    DCAssets.confirmCategory('Logos'); // addAssetFiles succeeds -> reload + broadcast
    assert.deepEqual(broadcasts, ['assets']);
  } finally {
    cleanupGlobals();
  }
});

test('a plain refresh never broadcasts', () => {
  const broadcasts = [];
  installGlobals(broadcasts);
  try {
    const DCAssets = freshAssetsModule();
    DCAssets.refresh();
    assert.deepEqual(broadcasts, []);
  } finally {
    cleanupGlobals();
  }
});
