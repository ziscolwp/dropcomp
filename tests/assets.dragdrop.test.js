const test = require('node:test');
const assert = require('node:assert/strict');

function freshAssetsModule() {
  const modulePath = require.resolve('../panel/js/assets.js');
  delete require.cache[modulePath];
  return require(modulePath);
}

function makeClassList() {
  return {
    add() {},
    remove() {},
    toggle() {},
    contains() { return false; },
  };
}

function installAssetGlobals(calls) {
  global.localStorage = {};
  global.DCShell = {
    setActiveTab(tab) { calls.tabs.push(tab); },
    getLibraryPath() { return '/Library'; },
    getPrefs() {
      return {
        activeTab: 'assets',
        favoritesOnly: false,
        sort: 'name',
        collapsedAssets: [],
      };
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
    openCategoryModal(mode, title, categories) {
      calls.modal = { mode, title, categories };
    },
    closeModal() { calls.closed = true; },
    spinner(show) { calls.spinner.push(show); },
    toast(msg, isErr) { calls.toasts.push({ msg, isErr }); },
    isError(result) {
      return typeof result === 'string' && result.indexOf('Error') === 0;
    },
  };
  global.DCBridge = {
    acquire(name) {
      calls.acquire.push(name);
      return true;
    },
    release() { calls.release += 1; },
    parseJson(result) {
      try { return JSON.parse(result); } catch (e) { return null; }
    },
    call(fnName, args, cb) {
      calls.bridge.push({ fnName, args });
      if (fnName === 'addAssetFiles') cb('{"ok":true,"added":3,"skipped":[]}');
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
  global.DCRender = {
    render() { calls.rendered += 1; },
  };
}

function cleanupAssetGlobals() {
  delete global.localStorage;
  delete global.DCShell;
  delete global.DCUI;
  delete global.DCBridge;
  delete global.DCState;
  delete global.DCRender;
}

function makeCalls() {
  return {
    tabs: [],
    modal: null,
    closed: false,
    spinner: [],
    toasts: [],
    acquire: [],
    release: 0,
    bridge: [],
    rendered: 0,
  };
}

test('dropped image files queue through the existing add-assets category flow', () => {
  const calls = makeCalls();
  installAssetGlobals(calls);
  try {
    const DCAssets = freshAssetsModule();
    const accepted = DCAssets.addDroppedFiles({
      files: [
        { path: '/Users/me/Desktop/title.png' },
        { path: '/Users/me/Desktop/photo.jpg' },
        { path: '/Users/me/Desktop/logo.svg' },
      ],
    });

    assert.equal(accepted, true);
    assert.deepEqual(calls.tabs, ['assets']);
    assert.deepEqual(calls.modal, { mode: 'addAssets', title: 'Add Assets', categories: [] });

    DCAssets.confirmCategory('Imported');
    const addCall = calls.bridge.find((entry) => entry.fnName === 'addAssetFiles');
    assert.ok(addCall, 'addAssetFiles was not called');
    assert.equal(addCall.args[0], '/Library');
    assert.equal(addCall.args[1], 'Imported');
    assert.deepEqual(JSON.parse(addCall.args[2]), [
      '/Users/me/Desktop/title.png',
      '/Users/me/Desktop/photo.jpg',
      '/Users/me/Desktop/logo.svg',
    ]);
  } finally {
    cleanupAssetGlobals();
  }
});

test('drop target prevents file navigation and accepts file URI drops', () => {
  const calls = makeCalls();
  installAssetGlobals(calls);
  try {
    const DCAssets = freshAssetsModule();
    const listeners = {};
    const target = {
      addEventListener(type, fn) { listeners[type] = fn; },
    };

    DCAssets.attachDropTarget(target);

    const dataTransfer = {
      types: ['text/uri-list'],
      files: [],
      getData(type) {
        return type === 'text/uri-list'
          ? 'file:///Users/me/Desktop/icon%20set.svg\n# ignored\nfile:///Users/me/Desktop/card.png'
          : '';
      },
    };
    const dragEvent = {
      dataTransfer,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
    };

    listeners.dragover(dragEvent);
    assert.equal(dragEvent.defaultPrevented, true);
    assert.equal(dragEvent.propagationStopped, true);
    assert.equal(dataTransfer.dropEffect, 'copy');

    const dropEvent = Object.assign({}, dragEvent, {
      defaultPrevented: false,
      propagationStopped: false,
    });
    listeners.drop(dropEvent);
    assert.equal(dropEvent.defaultPrevented, true);
    assert.equal(dropEvent.propagationStopped, true);

    DCAssets.confirmCategory('Vectors');
    const addCall = calls.bridge.find((entry) => entry.fnName === 'addAssetFiles');
    assert.ok(addCall, 'addAssetFiles was not called for URI drop');
    assert.deepEqual(JSON.parse(addCall.args[2]), [
      '/Users/me/Desktop/icon set.svg',
      '/Users/me/Desktop/card.png',
    ]);
  } finally {
    cleanupAssetGlobals();
  }
});
