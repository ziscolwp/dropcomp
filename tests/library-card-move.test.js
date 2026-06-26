const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const librarySrc = fs.readFileSync(path.join(__dirname, '..', 'panel', 'js', 'library.js'), 'utf8');

function makeCalls() {
  return {
    acquire: [],
    release: 0,
    bridge: [],
    renders: [],
    spinner: [],
    toasts: [],
  };
}

function makeContext(calls) {
  const comps = [
    {
      name: 'Misfiled Title',
      uniqueId: 'Misfiled_Title_1700000000000',
      category: 'Wrong Folder',
      aepPath: '/Library/Wrong Folder/Misfiled_Title_1700000000000/Misfiled_Title.aep',
    },
  ];
  return {
    localStorage: { getItem() { return null; }, setItem() {} },
    DCShell: {
      getLibraryPath() { return '/Library'; },
      getPrefs() {
        return {
          activeTab: 'library',
          favoritesOnly: false,
          sort: 'name',
          collapsed: [],
          viewMode: 'comfortable',
          folderColumns: true,
          showNames: true,
          showMeta: true,
        };
      },
      getEls() {
        return {
          search: { value: '' },
          library: {},
        };
      },
    },
    DCUI: {
      spinner(show) { calls.spinner.push(show); },
      toast(msg, isErr) { calls.toasts.push({ msg, isErr }); },
      isError(result) {
        return typeof result === 'string' && result.indexOf('Error') === 0;
      },
    },
    DCBridge: {
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
        if (fnName === 'getStashedComps') cb(JSON.stringify(comps));
        else if (fnName === 'moveStashedComp') cb('{"ok":true}');
      },
    },
    DCState: {
      loadUsageMeta() { return {}; },
      saveUsageMeta() {},
      cleanupStaleMetadata(usageMeta) { return { removed: 0, usageMeta }; },
      filterComps(items) { return items; },
      groupByCategory(items) { return [{ category: items[0].category, items }]; },
      sortComps(items) { return items; },
      getUsage() { return { lastUsed: 0, useCount: 0, isFavorite: false }; },
    },
    DCRender: {
      render(container, groups) { calls.renders.push(groups); },
    },
  };
}

function loadLibrary(calls) {
  const context = makeContext(calls);
  vm.createContext(context);
  vm.runInContext(librarySrc, context);
  return context.DCLibrary;
}

test('moving a library card to another folder calls host move and reloads', () => {
  const calls = makeCalls();
  const DCLibrary = loadLibrary(calls);

  DCLibrary.init();
  DCLibrary.load();
  DCLibrary.moveToCategory('Misfiled_Title_1700000000000', 'Wrong Folder', 'Correct Folder');

  const moveCall = calls.bridge.find((entry) => entry.fnName === 'moveStashedComp');
  assert.ok(moveCall, 'moveStashedComp was not called');
  assert.deepEqual(Array.prototype.slice.call(moveCall.args), [
    '/Library',
    'Wrong Folder',
    'Misfiled_Title_1700000000000',
    'Correct Folder',
  ]);
  assert.equal(calls.bridge.filter((entry) => entry.fnName === 'getStashedComps').length, 2);
  assert.deepEqual(calls.toasts[calls.toasts.length - 1], { msg: 'Moved to Correct Folder.', isErr: false });
});
