# Assets Tab Implementation Plan (DropComp 2.1, Phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Assets tab — a second library of reusable image files (icons, logos, textures) with add/import/rename/delete/reveal and the comp library's search/categories/favorites/sorting/size-slider UX.

**Architecture:** Parallel-module approach per `docs/superpowers/specs/2026-06-11-assets-tab-design.md`. Assets live at `<library>/Assets/<Category>/<file>` with their own JSON index. Host logic goes in a new ES3 module `jsx/assets.jsx` (loaded like relink.jsx, exports to `$.global`). The panel's oversized `actions.js` is split into `ui.js` / `shell.js` / `library.js` first (pure refactor), then `assets.js` is added. DCState/DCRender are reused via small parameterizations.

**Tech Stack:** CEP panel (vanilla JS, IIFE modules), ExtendScript ES3 host, node:test for pure modules.

**Constraints (project-wide):** ExtendScript is ES3 only (no const/let/arrow/Array extras). Panel files < 400 lines, jsx files < 800. `$.fileName` is unset under CEP — modules load via `loadHostModules(extensionRoot)`. The repo is symlinked as the live extension: test in AE by closing/reopening the panel.

---

### Task 0: Branch

- [x] **Step 1: Create feature branch**

```bash
cd "/Users/ziscol/Ziscol Media Projects/dropcomp"
git checkout -b feature/assets-tab
```

---

### Task 1: State module additions (TDD)

**Files:**
- Modify: `panel/js/state.js`
- Test: `tests/state.assets.test.js` (create)

- [x] **Step 1: Write the failing tests**

Create `tests/state.assets.test.js`:

```js
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
```

- [x] **Step 2: Run tests, verify they fail**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: failures (formatBytes/formatAssetMetaLine/ASSETS_USAGE_KEY undefined; defaultPrefs missing keys).

- [x] **Step 3: Implement in state.js**

In `panel/js/state.js`:

1. After `formatMetaLine`, add:

```js
  function formatBytes(n) {
    if (n === undefined || n === null || n === '') return '';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return Math.round(n / 1024) + ' KB';
    return (Math.round((n / 1048576) * 10) / 10) + ' MB';
  }

  function formatAssetMetaLine(asset) {
    var parts = [];
    if (asset && asset.ext) parts.push(String(asset.ext).toUpperCase());
    var size = formatBytes(asset && asset.sizeBytes);
    if (size) parts.push(size);
    return parts.join(' · ');
  }
```

2. Change the keys block and usage functions:

```js
  var PREFS_KEY = 'dropcomp_prefs';
  var USAGE_KEY = 'dropcomp_metadata';
  var ASSETS_USAGE_KEY = 'dropcomp_assets_metadata';
```

```js
  function loadUsageMeta(storage, key) {
    try { return JSON.parse(storage.getItem(key || USAGE_KEY)) || {}; } catch (e) { return {}; }
  }

  function saveUsageMeta(storage, meta, key) {
    try { storage.setItem(key || USAGE_KEY, JSON.stringify(meta)); } catch (e) {}
  }
```

3. `defaultPrefs` becomes:

```js
  function defaultPrefs() {
    return { thumbMin: 130, sort: 'recent', showNames: true, showMeta: true,
      favoritesOnly: false, collapsed: [], activeTab: 'library', collapsedAssets: [] };
  }
```

4. Add to the return object: `formatBytes: formatBytes, formatAssetMetaLine: formatAssetMetaLine, ASSETS_USAGE_KEY: ASSETS_USAGE_KEY,`

- [x] **Step 4: Run tests, verify all pass**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: all pass.

- [x] **Step 5: Commit**

```bash
git add panel/js/state.js tests/state.assets.test.js
git commit -m "feat(panel): asset meta line, parameterized usage keys, tab prefs"
```

---

### Task 2: ES3 static guard test for all jsx modules

**Files:**
- Test: `tests/jsx.es3.test.js` (create)

- [x] **Step 1: Write the test** (covers every `jsx/*.jsx`, so `assets.jsx` is guarded automatically once created)

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const jsxDir = path.join(__dirname, '..', 'jsx');
const files = fs.readdirSync(jsxDir).filter((f) => f.endsWith('.jsx'));

// ExtendScript is ES3: any of these constructs crashes inside After Effects.
for (const f of files) {
  const src = fs.readFileSync(path.join(jsxDir, f), 'utf8');
  test(`${f} contains no ES5+ syntax`, () => {
    assert.doesNotMatch(src, /\b(const|let)\s/, `${f}: const/let found`);
    assert.doesNotMatch(src, /=>/, `${f}: arrow function found`);
    assert.doesNotMatch(src, /`/, `${f}: template literal found`);
    assert.doesNotMatch(src, /\.(map|filter|forEach|reduce|some|every)\s*\(/, `${f}: ES5 array method found`);
    assert.doesNotMatch(src, /Object\.keys/, `${f}: Object.keys found`);
    assert.doesNotMatch(src, /Array\.isArray/, `${f}: Array.isArray found`);
  });
}
```

- [x] **Step 2: Run, verify it passes against current files** (hostscript.jsx and relink.jsx are already clean)

Run: `npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: all pass. If a false positive fires (e.g. `=>` inside a string), tighten the offending regex rather than weakening the rule.

- [x] **Step 3: Commit**

```bash
git add tests/jsx.es3.test.js
git commit -m "test: static ES3 guard for all jsx host modules"
```

---

### Task 3: Host module `jsx/assets.jsx` (+ exports test generalization)

**Files:**
- Create: `jsx/assets.jsx`
- Modify: `tests/jsx.exports.test.js`
- Test: `tests/assets.validation.parity.test.js` (create)

- [x] **Step 1: Generalize the exports test to cover both loadable modules**

Replace the module-reading header and first test of `tests/jsx.exports.test.js` with a loop over both modules, and extend the loader test to require both markers:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', 'jsx', p), 'utf8');
const hostSrc = read('hostscript.jsx');

// hostscript loads these with $.evalFile INSIDE loadHostModules(). Per ES3
// eval semantics, declarations land in that function's local scope and vanish
// when it returns - so every top-level function must be exported to $.global
// explicitly or it is undefined at call time (the collectMissingFootage bug).
const LOADED_MODULES = ['relink.jsx', 'assets.jsx'];
const MARKERS = ['collectMissingFootage', 'getAssets'];

for (const mod of LOADED_MODULES) {
  test(`every top-level function in ${mod} is exported to $.global`, () => {
    const src = read(mod);
    const declared = [...src.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map((m) => m[1]);
    assert.ok(declared.length > 0, `expected top-level functions in ${mod}`);
    for (const name of declared) {
      const exportRe = new RegExp(`\\$\\.global\\.${name}\\s*=\\s*${name}\\s*;`);
      assert.match(src, exportRe, `${name} is declared but never exported to $.global`);
    }
  });
}

test('loadHostModules verifies the exports actually landed before reporting ok', () => {
  const fnBody = hostSrc.slice(
    hostSrc.indexOf('function loadHostModules'),
    hostSrc.indexOf('DC_MODULES_LOADED = true;')
  );
  for (const marker of MARKERS) {
    assert.match(
      fnBody,
      new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `loadHostModules must check ${marker} before setting DC_MODULES_LOADED`
    );
  }
});
```

Keep the existing cross-file test (relink names used by hostscript) unchanged.

- [x] **Step 2: Run tests, verify the new assertions fail** (assets.jsx missing, loader not generalized)

Run: `npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: failures.

- [x] **Step 3: Create `jsx/assets.jsx`** (ES3; uses hostscript globals `readJson`, `writeJson`, `jerr`, `jsonEscape`)

```js
// DropComp assets module (ExtendScript, ES3 only)
// Loaded by hostscript.jsx loadHostModules() via $.evalFile. evalFile runs in
// the caller's LOCAL scope, so every public function must be exported to
// $.global explicitly or it is undefined at call time.
// Uses hostscript globals: readJson, writeJson, jerr, jsonEscape.

var DC_ASSET_EXTS = { png: 1, jpg: 1, jpeg: 1, gif: 1, bmp: 1, tif: 1, tiff: 1, tga: 1, psd: 1, ai: 1, eps: 1 };

function assetExt(fileName) {
    var m = /\.([a-z0-9]+)$/i.exec(String(fileName));
    return m ? m[1].toLowerCase() : '';
}

function isSupportedAsset(fileName) {
    return DC_ASSET_EXTS[assetExt(fileName)] === 1;
}

function assetsRoot(libraryPath) {
    return new Folder(libraryPath + '/Assets');
}

function getAssetsIndexFile(libraryPath) {
    return new File(libraryPath + '/Assets/.dropcomp_assets_index.json');
}

function assetEntryFromFile(categoryName, file) {
    var fileName = decodeURI(file.name);
    if (fileName.charAt(0) === '.') return null;
    if (!isSupportedAsset(fileName)) return null;
    return {
        name: fileName.replace(/\.[a-z0-9]+$/i, ''),
        category: categoryName,
        uniqueId: categoryName + '/' + fileName,
        filePath: file.fsName,
        ext: assetExt(fileName),
        sizeBytes: file.length,
        addedAt: file.modified ? file.modified.getTime() : 0
    };
}

function loadAssetsIndex(libraryPath) {
    var idx = readJson(getAssetsIndexFile(libraryPath));
    return (idx && idx.version === 1 && idx.assets) ? idx.assets : null;
}

function saveAssetsIndex(libraryPath, assets) {
    return writeJson(getAssetsIndexFile(libraryPath), {
        version: 1,
        lastUpdated: new Date().getTime(),
        assets: assets
    });
}

function rebuildAssetsIndex(libraryPath) {
    var root = assetsRoot(libraryPath);
    if (!root.exists) return '[]';
    var assets = [];
    var isFolder = function (f) { return f instanceof Folder; };
    var cats = root.getFiles(isFolder);
    for (var i = 0; i < cats.length; i++) {
        var files = cats[i].getFiles();
        for (var j = 0; j < files.length; j++) {
            if (!(files[j] instanceof File)) continue;
            var entry = assetEntryFromFile(decodeURI(cats[i].name), files[j]);
            if (entry) assets.push(entry);
        }
    }
    saveAssetsIndex(libraryPath, assets);
    return JSON.stringify(assets);
}

function getAssets(libraryPath) {
    if (!assetsRoot(libraryPath).exists) return '[]';
    var assets = loadAssetsIndex(libraryPath);
    if (assets) return JSON.stringify(assets);
    return rebuildAssetsIndex(libraryPath);
}

function pickAssetFiles() {
    var files = File.openDialog('Select image files', undefined, true);
    if (!files) return '{"ok":false,"cancelled":true}';
    if (!(files instanceof Array)) files = [files];
    var out = [];
    for (var i = 0; i < files.length; i++) {
        out.push('"' + jsonEscape(files[i].fsName) + '"');
    }
    return '{"ok":true,"paths":[' + out.join(',') + ']}';
}

function uniqueAssetTarget(catFolder, fileName) {
    var target = new File(catFolder.fsName + '/' + fileName);
    if (!target.exists) return target;
    var m = /^(.*?)(\.[a-z0-9]+)$/i.exec(fileName);
    var base = m ? m[1] : fileName;
    var ext = m ? m[2] : '';
    for (var n = 2; n < 1000; n++) {
        target = new File(catFolder.fsName + '/' + base + '_' + n + ext);
        if (!target.exists) return target;
    }
    return null;
}

function addAssetFiles(libraryPath, categoryName, pathsJson) {
    try {
        var paths = null;
        try { paths = JSON.parse(pathsJson); } catch (ep) { return jerr('Bad file list.'); }
        if (!paths || !paths.length) return jerr('No files selected.');
        var root = assetsRoot(libraryPath);
        if (!root.exists && !root.create()) return jerr('Could not create the Assets folder.');
        var catFolder = new Folder(root.fsName + '/' + categoryName);
        if (!catFolder.exists && !catFolder.create()) return jerr('Could not create the category folder.');

        var assets = loadAssetsIndex(libraryPath) || [];
        var added = 0;
        var skipped = [];
        var now = new Date().getTime();
        for (var i = 0; i < paths.length; i++) {
            var src = new File(paths[i]);
            var srcName = decodeURI(src.name);
            if (!src.exists || !isSupportedAsset(srcName)) { skipped.push(srcName); continue; }
            var target = uniqueAssetTarget(catFolder, srcName);
            if (!target || !src.copy(target)) { skipped.push(srcName); continue; }
            var entry = assetEntryFromFile(categoryName, new File(target.fsName));
            if (entry) { entry.addedAt = now; assets.push(entry); added++; }
        }
        saveAssetsIndex(libraryPath, assets);
        var skippedJson = [];
        for (var s = 0; s < skipped.length; s++) {
            skippedJson.push('"' + jsonEscape(skipped[s]) + '"');
        }
        return '{"ok":true,"added":' + added + ',"skipped":[' + skippedJson.join(',') + ']}';
    } catch (e) {
        return jerr(e.toString());
    }
}

function renameAsset(libraryPath, category, fileName, newName) {
    try {
        // re-check the name host-side (mirrors panel DCValidate; ES3 - no trim())
        newName = String(newName).replace(/^\s+|\s+$/g, '');
        if (!newName) return jerr('Name cannot be empty.');
        if (newName.length > 200) return jerr('Name is too long (max 200 characters).');
        if (/[<>:"\/\\|?*\x00-\x1F]/.test(newName)) return jerr('Name contains invalid characters (< > : " / \\ | ? *).');
        if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(newName)) return jerr('Name uses a reserved system name.');

        var catFolder = new Folder(libraryPath + '/Assets/' + category);
        var file = new File(catFolder.fsName + '/' + fileName);
        if (!file.exists) return jerr('Asset not found on disk.');
        var ext = assetExt(fileName);
        var newFileName = newName + (ext ? '.' + ext : '');
        if (newFileName !== fileName) {
            if (new File(catFolder.fsName + '/' + newFileName).exists) {
                return jerr('An asset with that name already exists in this category.');
            }
            if (!file.rename(newFileName)) return jerr('Could not rename the file on disk.');
        }
        var assets = loadAssetsIndex(libraryPath) || [];
        var oldId = category + '/' + fileName;
        var patched = false;
        for (var i = 0; i < assets.length; i++) {
            if (assets[i].uniqueId === oldId) {
                assets[i].name = newName;
                assets[i].uniqueId = category + '/' + newFileName;
                assets[i].filePath = new File(catFolder.fsName + '/' + newFileName).fsName;
                patched = true;
                break;
            }
        }
        if (patched) saveAssetsIndex(libraryPath, assets);
        else rebuildAssetsIndex(libraryPath);
        return '{"ok":true,"newUniqueId":"' + jsonEscape(category + '/' + newFileName) + '"}';
    } catch (e) {
        return jerr(e.toString());
    }
}

function deleteAsset(libraryPath, category, fileName) {
    try {
        var file = new File(libraryPath + '/Assets/' + category + '/' + fileName);
        if (!file.exists) return jerr('Asset not found on disk.');
        if (!file.remove()) return jerr('Could not delete the file.');
        var assets = loadAssetsIndex(libraryPath) || [];
        var out = [];
        var id = category + '/' + fileName;
        for (var i = 0; i < assets.length; i++) {
            if (assets[i].uniqueId !== id) out.push(assets[i]);
        }
        saveAssetsIndex(libraryPath, out);
        return '{"ok":true}';
    } catch (e) {
        return jerr(e.toString());
    }
}

function findProjectFootageByPath(fsPath) {
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (item instanceof FootageItem && item.mainSource && item.mainSource.file &&
            item.mainSource.file.fsName === fsPath) {
            return item;
        }
    }
    return null;
}

function findOrCreateAssetsBin() {
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (item instanceof FolderItem && item.name === 'Assets [DropComp]') return item;
    }
    return app.project.items.addFolder('Assets [DropComp]');
}

// Text protocol (Success:/Error:) to mirror importComp exactly.
function importAsset(filePath) {
    var suppressing = false;
    try {
        if (!app.project) return 'Error: Please open a project first.';
        var file = new File(filePath);
        if (!file.exists) return 'Error: Asset file not found.';
        var assetName = decodeURI(file.name);

        app.beginSuppressDialogs();
        suppressing = true;
        app.beginUndoGroup('DropComp Import Asset');

        var footage = findProjectFootageByPath(file.fsName);
        var reused = footage !== null;
        if (!footage) {
            var io = new ImportOptions(file);
            if (io.canImportAs(ImportAsType.FOOTAGE)) io.importAs = ImportAsType.FOOTAGE;
            footage = app.project.importFile(io);
            footage.parentFolder = findOrCreateAssetsBin();
        }

        var addedToTimeline = false;
        var activeComp = app.project.activeItem;
        if (activeComp && activeComp instanceof CompItem) {
            try {
                var newLayer = activeComp.layers.add(footage);
                newLayer.startTime = activeComp.time;
                newLayer.selected = true;
                for (var k = 1; k <= activeComp.numLayers; k++) {
                    if (activeComp.layer(k) !== newLayer) activeComp.layer(k).selected = false;
                }
                addedToTimeline = true;
            } catch (eL) {
                addedToTimeline = false;
            }
        }
        app.endUndoGroup();
        app.endSuppressDialogs(false);
        return "Success: '" + assetName + "' " + (reused ? 'reused' : 'imported') +
            (addedToTimeline ? ' and added to timeline.' : '.');
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) { }
        try { if (suppressing) app.endSuppressDialogs(false); } catch (e3) { }
        return 'Error: ' + e.toString();
    }
}

// ---- exports (see header comment) ----
$.global.assetExt = assetExt;
$.global.isSupportedAsset = isSupportedAsset;
$.global.assetsRoot = assetsRoot;
$.global.getAssetsIndexFile = getAssetsIndexFile;
$.global.assetEntryFromFile = assetEntryFromFile;
$.global.loadAssetsIndex = loadAssetsIndex;
$.global.saveAssetsIndex = saveAssetsIndex;
$.global.rebuildAssetsIndex = rebuildAssetsIndex;
$.global.getAssets = getAssets;
$.global.pickAssetFiles = pickAssetFiles;
$.global.uniqueAssetTarget = uniqueAssetTarget;
$.global.addAssetFiles = addAssetFiles;
$.global.renameAsset = renameAsset;
$.global.deleteAsset = deleteAsset;
$.global.findProjectFootageByPath = findProjectFootageByPath;
$.global.findOrCreateAssetsBin = findOrCreateAssetsBin;
$.global.importAsset = importAsset;
```

- [x] **Step 4: Write the rename-validation parity test**

Create `tests/assets.validation.parity.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'jsx', 'assets.jsx'), 'utf8');

// renameAsset must re-check names host-side with the same rules as DCValidate.
test('renameAsset mirrors DCValidate invalid-chars and reserved-name rules', () => {
  const fnBody = src.slice(
    src.indexOf('function renameAsset'),
    src.indexOf('function', src.indexOf('function renameAsset') + 10)
  );
  assert.match(fnBody, /\[<>:"\\\/\\\\\|\?\*/, 'invalid-char check missing in renameAsset');
  assert.match(fnBody, /CON\|PRN\|AUX\|NUL/, 'reserved-name check missing in renameAsset');
  assert.match(fnBody, /length > 200/, 'max-length check missing in renameAsset');
});
```

- [x] **Step 5: Syntax-check and run tests** (loader test still fails — fixed in Task 4; everything else passes)

```bash
cp jsx/assets.jsx /tmp/dc_assets_check.js && node --check /tmp/dc_assets_check.js && rm /tmp/dc_assets_check.js
npm test 2>&1 | grep -E "^# (pass|fail)"
```
Expected: only the loadHostModules-marker test fails.

- [x] **Step 6: Commit**

```bash
git add jsx/assets.jsx tests/jsx.exports.test.js tests/assets.validation.parity.test.js
git commit -m "feat(jsx): assets host module - index, multi-add, rename, delete, dedupe import"
```

---

### Task 4: Hostscript loader generalization + reserved category

**Files:**
- Modify: `jsx/hostscript.jsx` (loadHostModules, ensureHostModules, rebuildLibraryIndex, stashSelectedComp, addExternalAep)

- [x] **Step 1: Generalize the module loader** — replace `loadHostModules` and `ensureHostModules`:

```js
var DC_MODULES_LOADED = false;
var DC_MODULE_FILES = ['relink.jsx', 'assets.jsx'];
var DC_MODULE_MARKERS = ['collectMissingFootage', 'getAssets'];

function loadHostModules(extPath) {
    try {
        if (DC_MODULES_LOADED) return 'ok';
        $.global.DC_EXT_PATH = extPath;
        for (var i = 0; i < DC_MODULE_FILES.length; i++) {
            var moduleFile = new File(extPath + '/jsx/' + DC_MODULE_FILES[i]);
            if (!moduleFile.exists) return 'Error: ' + DC_MODULE_FILES[i] + ' not found at ' + moduleFile.fsName;
            $.evalFile(moduleFile);
            // $.evalFile evaluates in THIS function's scope (ES3 eval semantics),
            // so each module must export its functions to $.global itself - verify
            // that actually landed instead of trusting evalFile's silence.
            if (typeof $.global[DC_MODULE_MARKERS[i]] !== 'function') {
                return 'Error: ' + DC_MODULE_FILES[i] + ' loaded but did not export its functions to $.global.';
            }
        }
        DC_MODULES_LOADED = true;
        return 'ok';
    } catch (e) {
        return 'Error: ' + e.toString();
    }
}

// lazy fallback so an import never dies on a missing module
function ensureHostModules() {
    var present = true;
    for (var i = 0; i < DC_MODULE_MARKERS.length; i++) {
        if (typeof $.global[DC_MODULE_MARKERS[i]] !== 'function') { present = false; break; }
    }
    if (present) return true;
    DC_MODULES_LOADED = false;
    return typeof $.global.DC_EXT_PATH === 'string' &&
        loadHostModules($.global.DC_EXT_PATH) === 'ok';
}
```

- [x] **Step 2: Reserve the Assets folder.** Add helper near `safeNameJsx`:

```js
function isReservedCategory(name) {
    return String(name).toLowerCase() === 'assets';
}
```

In `rebuildLibraryIndex`, inside the category loop, first line:

```js
        if (isReservedCategory(decodeURI(cats[i].name))) continue;
```

In `stashSelectedComp`, right after the `originalProjectFile` guard:

```js
        if (isReservedCategory(categoryName)) return 'Error: "Assets" is reserved for the Assets tab.';
```

In `addExternalAep`, first line of the try block:

```js
        if (isReservedCategory(categoryName)) return jerr('"Assets" is reserved for the Assets tab.');
```

- [x] **Step 3: Syntax-check + full suite**

```bash
cp jsx/hostscript.jsx /tmp/dc_host_check.js && node --check /tmp/dc_host_check.js && rm /tmp/dc_host_check.js
npm test 2>&1 | grep -E "^# (pass|fail)"
```
Expected: all pass (loader marker test now satisfied).

- [x] **Step 4: Commit**

```bash
git add jsx/hostscript.jsx
git commit -m "feat(jsx): load assets module at boot, reserve Assets category for comps"
```

---

### Task 5: Render module — asset cards

**Files:**
- Modify: `panel/js/render.js`

- [x] **Step 1: Extract the thumb URL helper** (currently inline in `buildCard`). Add after `iconBtn`:

```js
  // encodeURI leaves # and ? alone, but either would truncate a file:// URL
  function thumbUrl(path, bust) {
    var encoded = encodeURI(String(path).replace(/\\/g, '/'))
      .replace(/#/g, '%23').replace(/\?/g, '%3F');
    return 'file:///' + encoded + (bust ? '?t=' + bust : '');
  }
```

In `buildCard`, replace the img.src lines with:

```js
      img.src = thumbUrl(comp.thumbPath, bust);
```

- [x] **Step 2: Add the asset card builder** (after `buildCard`):

```js
  var RENDERABLE_EXTS = { png: 1, jpg: 1, jpeg: 1, gif: 1, bmp: 1 };

  function buildAssetCard(asset, usage, prefs) {
    var card = el('article', 'card card--asset' + (usage.isFavorite ? ' has-fav' : ''));
    card.dataset.uniqueId = asset.uniqueId;
    card.dataset.category = asset.category;
    card.title = asset.name + '\nDouble-click to import';

    var thumbWrap = el('div', 'card-thumb');
    if (RENDERABLE_EXTS[asset.ext]) {
      var img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = '';
      img.src = thumbUrl(asset.filePath, null);
      img.onerror = function () { img.style.display = 'none'; };
      thumbWrap.appendChild(img);
    } else {
      var ph = el('div', 'thumb-placeholder');
      ph.appendChild(el('span', 'ext-badge', String(asset.ext || '?').toUpperCase()));
      thumbWrap.appendChild(ph);
    }

    var actions = el('div', 'card-actions');
    actions.appendChild(iconBtn('favorite', 'Favorite',
      usage.isFavorite ? ICONS.starFilled : ICONS.star,
      usage.isFavorite ? 'fav-on' : ''));
    actions.appendChild(iconBtn('rename', 'Rename', ICONS.pencil));
    actions.appendChild(iconBtn('reveal', 'Reveal in Finder', ICONS.folder));
    actions.appendChild(iconBtn('delete', 'Delete', ICONS.trash));
    thumbWrap.appendChild(actions);

    var importBar = el('button', 'import-bar');
    importBar.dataset.action = 'import';
    importBar.innerHTML = ICONS.download;
    importBar.appendChild(el('span', null, 'Import'));
    thumbWrap.appendChild(importBar);
    card.appendChild(thumbWrap);

    if (prefs.showNames || prefs.showMeta) {
      var info = el('div', 'card-info');
      if (prefs.showNames) info.appendChild(el('div', 'card-name', asset.name));
      if (prefs.showMeta) {
        var meta = DCState.formatAssetMetaLine(asset);
        if (meta) info.appendChild(el('div', 'card-meta', meta));
      }
      if (info.childNodes.length) card.appendChild(info);
    }
    return card;
  }
```

- [x] **Step 3: Thread a `kind` parameter through section + render**

`buildSection` becomes:

```js
  function buildSection(group, prefs, usageMeta, busts, kind) {
    var collapsedList = kind === 'asset' ? prefs.collapsedAssets : prefs.collapsed;
    var collapsed = collapsedList.indexOf(group.category) !== -1;
    var section = el('section', 'category' + (collapsed ? ' collapsed' : ''));
    section.dataset.category = group.category;

    var header = el('header', 'category-header');
    header.dataset.action = 'toggleSection';
    header.innerHTML = ICONS.chevron;
    header.appendChild(el('span', 'category-name', group.category));
    header.appendChild(el('span', 'category-count', String(group.items.length)));
    section.appendChild(header);

    var grid = el('div', 'grid');
    group.items.forEach(function (item) {
      var usage = DCState.getUsage(usageMeta, item.uniqueId);
      grid.appendChild(kind === 'asset'
        ? buildAssetCard(item, usage, prefs)
        : buildCard(item, usage, prefs, busts[item.uniqueId]));
    });
    section.appendChild(grid);
    return section;
  }

  function render(container, groups, prefs, usageMeta, busts, emptyMessage, kind) {
    container.innerHTML = '';
    if (groups.length === 0) {
      container.appendChild(el('div', 'placeholder', emptyMessage));
      return;
    }
    groups.forEach(function (g) {
      container.appendChild(buildSection(g, prefs, usageMeta, busts, kind));
    });
  }
```

(Existing callers omit `kind` → comp behavior unchanged.)

- [x] **Step 4: Verify**

```bash
node --check panel/js/render.js && npm test 2>&1 | grep -E "^# (pass|fail)"
```
Expected: clean + all pass.

- [x] **Step 5: Commit**

```bash
git add panel/js/render.js
git commit -m "feat(panel): asset cards - contained thumbs, ext badge, kind-aware sections"
```

---

### Task 6: Split actions.js → ui.js / shell.js / library.js (pure refactor)

**Files:**
- Create: `panel/js/ui.js`, `panel/js/shell.js`, `panel/js/library.js`
- Delete: `panel/js/actions.js`
- Modify: `panel/index.html` (script tags), `panel/js/main.js`

Behavior must be identical after this task; the only intentional change is routing
through the new module boundaries (DCAssets hooks are added in Task 7 — shell
references to `DCAssets` are written now but only exercised once it exists, so
guard them: `typeof DCAssets !== 'undefined'`).

- [x] **Step 1: Create `panel/js/ui.js`** — toast/spinner/screens/modals (modal "owner" tracking is new plumbing for Task 7 but inert for comps-only):

```js
var DCUI = (function () {
  'use strict';

  var els = null;
  var toastTimer = null;
  var catMode = null;
  var renameOwnerName = 'library';
  var deleteOwnerName = 'library';

  function init(elements) { els = elements; }

  function toast(msg, isErr, ms) {
    if (toastTimer) clearTimeout(toastTimer);
    els.toast.textContent = String(msg).replace(/^(Success!|Success:|Error:)\s*/, '');
    els.toast.className = 'show ' + (isErr ? 'error' : 'success');
    toastTimer = setTimeout(function () { els.toast.classList.remove('show'); }, ms || 3000);
  }

  function spinner(show) { els.spinner.classList.toggle('hidden', !show); }

  function show(elName) {
    ['welcome', 'driveMissing', 'app'].forEach(function (k) {
      els[k].classList.toggle('hidden', k !== elName);
    });
  }

  function isError(result) {
    return typeof result === 'string' &&
      (result.indexOf('Error') === 0 || result.indexOf('EvalScript error') === 0);
  }

  function openCategoryModal(mode, title, categories) {
    catMode = mode;
    els.categoryModalTitle.textContent = title;
    els.existingCategorySelect.innerHTML = '';
    if (categories.length === 0) {
      var opt0 = document.createElement('option');
      opt0.value = '';
      opt0.textContent = 'No existing categories';
      els.existingCategorySelect.appendChild(opt0);
      els.existingCategorySelect.disabled = true;
    } else {
      els.existingCategorySelect.disabled = false;
      categories.forEach(function (cat) {
        var opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        els.existingCategorySelect.appendChild(opt);
      });
    }
    els.newCategoryInput.value = '';
    els.categoryModal.classList.remove('hidden');
  }
  function categoryModalMode() { return catMode; }

  function openRenameModal(owner, currentName) {
    renameOwnerName = owner;
    els.renameModal.classList.remove('hidden');
    els.newNameInput.value = currentName;
    els.newNameInput.focus();
    els.newNameInput.select();
  }
  function renameOwner() { return renameOwnerName; }

  function openDeleteModal(owner, displayName) {
    deleteOwnerName = owner;
    els.deleteName.textContent = displayName;
    els.deleteModal.classList.remove('hidden');
  }
  function deleteOwner() { return deleteOwnerName; }

  function closeModal(modal) { modal.classList.add('hidden'); }

  function closeAllModals() {
    [els.categoryModal, els.renameModal, els.deleteModal, els.settingsModal].forEach(closeModal);
    els.displayMenu.classList.add('hidden');
  }

  return {
    init: init, toast: toast, spinner: spinner, show: show, isError: isError,
    openCategoryModal: openCategoryModal, categoryModalMode: categoryModalMode,
    openRenameModal: openRenameModal, renameOwner: renameOwner,
    openDeleteModal: openDeleteModal, deleteOwner: deleteOwner,
    closeModal: closeModal, closeAllModals: closeAllModals
  };
}());
```

- [x] **Step 2: Create `panel/js/shell.js`** — boot, prefs, tabs, toolbar, dispatch:

```js
var DCShell = (function () {
  'use strict';

  var els = null;
  var prefs = null;
  var libraryPath = null;

  function hasAssets() { return typeof DCAssets !== 'undefined'; }

  function init(elements) {
    els = elements;
    prefs = DCState.loadPrefs(localStorage);
    applyPrefsToControls();
  }

  function getEls() { return els; }
  function getPrefs() { return prefs; }
  function getLibraryPath() { return libraryPath; }
  function persistPrefs() { DCState.savePrefs(localStorage, prefs); }

  function activeModule() {
    return (prefs.activeTab === 'assets' && hasAssets()) ? DCAssets : DCLibrary;
  }

  function applyPrefsToControls() {
    els.sortSelect.value = prefs.sort;
    els.thumbSlider.value = prefs.thumbMin;
    els.showNamesCb.checked = prefs.showNames;
    els.showMetaCb.checked = prefs.showMeta;
    els.favoritesBtn.classList.toggle('active', prefs.favoritesOnly);
    applyGridSize();
  }

  function applyGridSize() {
    document.documentElement.style.setProperty('--thumb-min', prefs.thumbMin + 'px');
    var cls = DCState.gridSizeClass(prefs.thumbMin);
    ['grid--s', 'grid--m', 'grid--l'].forEach(function (c) {
      els.library.classList.toggle(c, c === cls);
    });
  }

  function boot() {
    DCBridge.call('getLibraryPath', [], function (savedPath) {
      if (savedPath && savedPath !== 'null') {
        libraryPath = savedPath;
        verifyAndLoad();
      } else {
        DCUI.show('welcome');
      }
    });
  }

  function verifyAndLoad() {
    DCBridge.call('checkLibraryPath', [libraryPath], function (status) {
      if (status === 'ok') {
        DCUI.show('app');
        setActiveTab(prefs.activeTab, true);
      } else {
        els.driveMissingPath.textContent = libraryPath;
        DCUI.show('driveMissing');
      }
    });
  }

  function setActiveTab(tab, skipPersist) {
    prefs.activeTab = (tab === 'assets' && hasAssets()) ? 'assets' : 'library';
    if (!skipPersist) persistPrefs();
    var isAssets = prefs.activeTab === 'assets';
    els.tabLibrary.classList.toggle('active', !isAssets);
    els.tabAssets.classList.toggle('active', isAssets);
    els.app.classList.toggle('assets-active', isAssets);
    els.search.placeholder = isAssets ? 'Search assets...' : 'Search library...';
    activeModule().ensureLoaded();
  }

  function selectLibraryFolder() {
    DCUI.spinner(true);
    DCBridge.call('selectLibraryFolder', [], function (path) {
      DCUI.spinner(false);
      if (path && path !== 'null') {
        libraryPath = path;
        DCLibrary.resetLoaded();
        if (hasAssets()) DCAssets.resetLoaded();
        verifyAndLoad();
      }
    });
  }

  function openSettings() {
    els.settingsPath.textContent = libraryPath || 'No path set.';
    els.settingsModal.classList.remove('hidden');
  }

  function openLibraryInFinder() {
    DCBridge.call('revealInFinder', [libraryPath], function (result) {
      if (result !== 'ok') DCUI.toast(result, true);
    });
  }

  function changeFolder() {
    DCUI.closeModal(els.settingsModal);
    selectLibraryFolder();
  }

  function refreshActive() {
    DCUI.closeModal(els.settingsModal);
    activeModule().refresh();
  }

  function confirmCategoryModal() {
    var mode = DCUI.categoryModalMode();
    var categoryName = els.newCategoryInput.value.trim() || els.existingCategorySelect.value;
    var v = DCValidate.validateName(categoryName, 'Category name');
    if (!v.valid) { DCUI.toast(v.error, true); return; }
    if (mode !== 'addAssets' && v.name.toLowerCase() === 'assets') {
      DCUI.toast('"Assets" is reserved for the Assets tab.', true);
      return;
    }
    if (mode === 'addAssets' && hasAssets()) DCAssets.confirmCategory(v.name);
    else DCLibrary.confirmCategory(mode, v.name);
  }

  function confirmRename() {
    if (DCUI.renameOwner() === 'assets' && hasAssets()) DCAssets.confirmRename();
    else DCLibrary.confirmRename();
  }

  function confirmDelete() {
    if (DCUI.deleteOwner() === 'assets' && hasAssets()) DCAssets.confirmDelete();
    else DCLibrary.confirmDelete();
  }

  function closeAllModals() {
    DCUI.closeAllModals();
    DCLibrary.clearPending();
    if (hasAssets()) DCAssets.clearPending();
  }

  function onSearch() { activeModule().rerender(); }
  function onSortChange() { prefs.sort = els.sortSelect.value; persistPrefs(); activeModule().rerender(); }
  function onFavoritesToggle() {
    prefs.favoritesOnly = !prefs.favoritesOnly;
    els.favoritesBtn.classList.toggle('active', prefs.favoritesOnly);
    persistPrefs();
    activeModule().rerender();
  }
  function onDisplayChange() {
    prefs.showNames = els.showNamesCb.checked;
    prefs.showMeta = els.showMetaCb.checked;
    persistPrefs();
    activeModule().rerender();
  }
  function onSlider() {
    prefs.thumbMin = parseInt(els.thumbSlider.value, 10);
    applyGridSize();
    persistPrefs();
  }

  function onCardAction(action, uniqueId, category) {
    activeModule().onCardAction(action, uniqueId, category);
  }
  function onCardDblClick(uniqueId) { activeModule().importItem(uniqueId); }
  function toggleSection(category) { activeModule().toggleSection(category); }

  return {
    init: init, boot: boot, verifyAndLoad: verifyAndLoad,
    getEls: getEls, getPrefs: getPrefs, getLibraryPath: getLibraryPath, persistPrefs: persistPrefs,
    setActiveTab: setActiveTab, selectLibraryFolder: selectLibraryFolder,
    openSettings: openSettings, openLibraryInFinder: openLibraryInFinder,
    changeFolder: changeFolder, refreshActive: refreshActive,
    confirmCategoryModal: confirmCategoryModal, confirmRename: confirmRename, confirmDelete: confirmDelete,
    closeAllModals: closeAllModals,
    onSearch: onSearch, onSortChange: onSortChange, onFavoritesToggle: onFavoritesToggle,
    onDisplayChange: onDisplayChange, onSlider: onSlider,
    onCardAction: onCardAction, onCardDblClick: onCardDblClick, toggleSection: toggleSection
  };
}());
```

- [x] **Step 3: Create `panel/js/library.js`** — all comp flows, behavior identical to the current actions.js versions, with `els` read from `DCShell.getEls()`, `libraryPath` from `DCShell.getLibraryPath()`, `prefs` from `DCShell.getPrefs()`, toast/spinner/isError from DCUI:

```js
var DCLibrary = (function () {
  'use strict';

  var allComps = [];
  var usageMeta = {};
  var busts = {};
  var pendingAepPath = null;
  var renameTarget = null;
  var deleteTarget = null;
  var loadedOnce = false;

  function init() { usageMeta = DCState.loadUsageMeta(localStorage); }

  function els() { return DCShell.getEls(); }
  function libPath() { return DCShell.getLibraryPath(); }
  function persistUsage() { DCState.saveUsageMeta(localStorage, usageMeta); }

  function ensureLoaded() {
    if (loadedOnce) rerender();
    else load();
  }
  function resetLoaded() { loadedOnce = false; }

  function load() {
    if (!DCBridge.acquire('loading library')) return;
    DCUI.spinner(true);
    DCBridge.call('getStashedComps', [libPath()], function (result) {
      try {
        allComps = (result && result !== '[]') ? JSON.parse(result) : [];
        loadedOnce = true;
        var r = DCState.cleanupStaleMetadata(usageMeta, allComps);
        if (r.removed > 0) { usageMeta = r.usageMeta; persistUsage(); }
        rerender();
      } catch (e) {
        DCUI.toast('Error loading library.', true);
      } finally {
        DCUI.spinner(false);
        DCBridge.release();
      }
    });
  }

  function refresh() {
    if (!DCBridge.acquire('refreshing')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
    DCUI.spinner(true);
    DCBridge.call('rebuildLibraryIndex', [libPath()], function (result) {
      try {
        allComps = (result && result !== '[]') ? JSON.parse(result) : [];
        loadedOnce = true;
        rerender();
        DCUI.toast('Library refreshed.', false);
      } catch (e) {
        DCUI.toast('Error refreshing library.', true);
      } finally {
        DCUI.spinner(false);
        DCBridge.release();
      }
    });
  }

  function rerender() {
    var prefs = DCShell.getPrefs();
    var filtered = DCState.filterComps(allComps, {
      search: els().search.value,
      favoritesOnly: prefs.favoritesOnly,
      usageMeta: usageMeta
    });
    var groups = DCState.groupByCategory(filtered).map(function (g) {
      return { category: g.category, items: DCState.sortComps(g.items, prefs.sort, usageMeta) };
    });
    var msg = allComps.length === 0
      ? 'Your library is empty. Stash a comp or add an .aep.'
      : 'No items match.';
    DCRender.render(els().library, groups, prefs, usageMeta, busts, msg);
  }

  function findComp(uniqueId) {
    for (var i = 0; i < allComps.length; i++) {
      if (allComps[i].uniqueId === uniqueId) return allComps[i];
    }
    return null;
  }

  function categories() {
    var cats = [];
    allComps.forEach(function (c) {
      if (cats.indexOf(c.category) === -1) cats.push(c.category);
    });
    cats.sort();
    return cats;
  }

  function stashFlow() {
    DCUI.openCategoryModal('stash', 'Add Composition', categories());
  }

  function addAepFlow() {
    DCBridge.call('pickAepFile', [], function (result) {
      var r = DCBridge.parseJson(result);
      if (!r) { DCUI.toast('Error: unexpected response.', true); return; }
      if (r.cancelled) return;
      if (!r.ok) { DCUI.toast(r.error, true); return; }
      pendingAepPath = r.path;
      DCUI.openCategoryModal('addAep', 'Add .aep to Library', categories());
    });
  }

  function confirmCategory(mode, categoryName) {
    DCUI.closeModal(els().categoryModal);
    if (mode === 'stash') {
      if (!DCBridge.acquire('stashing')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
      els().addCompBtn.disabled = true;
      DCUI.spinner(true);
      DCBridge.call('stashSelectedComp', [libPath(), categoryName], function (result) {
        DCUI.spinner(false);
        els().addCompBtn.disabled = false;
        DCUI.toast(result, DCUI.isError(result));
        DCBridge.release();
        if (!DCUI.isError(result)) load();
      });
    } else {
      if (!DCBridge.acquire('adding aep')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
      DCUI.spinner(true);
      DCBridge.call('addExternalAep', [libPath(), categoryName, pendingAepPath], function (result) {
        DCUI.spinner(false);
        DCBridge.release();
        var r = DCBridge.parseJson(result);
        if (r && r.ok) {
          DCUI.toast("'" + r.name + "' added" + (r.thumbOk ? '.' : ' (thumbnail failed - use Generate).'), false);
          load();
        } else {
          DCUI.toast((r && r.error) || result, true);
        }
        pendingAepPath = null;
      });
    }
  }

  function importItem(uniqueId, isRetry) {
    var comp = findComp(uniqueId);
    if (!comp) return;
    if (!DCBridge.acquire('importing')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
    var u = DCState.getUsage(usageMeta, uniqueId);
    usageMeta[uniqueId] = { lastUsed: Date.now(), useCount: u.useCount + 1, isFavorite: u.isFavorite };
    persistUsage();
    DCBridge.call('importComp', [comp.aepPath], function (result) {
      DCBridge.release();
      if (DCUI.isError(result) && result.indexOf('not found') !== -1 && !isRetry) {
        DCBridge.call('rebuildLibraryIndex', [libPath()], function (rebuilt) {
          try { allComps = (rebuilt && rebuilt !== '[]') ? JSON.parse(rebuilt) : []; } catch (e) { allComps = []; }
          rerender();
          if (findComp(uniqueId)) importItem(uniqueId, true);
          else DCUI.toast('Error: item missing on disk - library re-indexed.', true);
        });
        return;
      }
      DCUI.toast(result, DCUI.isError(result));
    });
  }

  function toggleFavorite(uniqueId) {
    var u = DCState.getUsage(usageMeta, uniqueId);
    usageMeta[uniqueId] = { lastUsed: u.lastUsed, useCount: u.useCount, isFavorite: !u.isFavorite };
    persistUsage();
    rerender();
  }

  function renameFlow(uniqueId, category) {
    var comp = findComp(uniqueId);
    if (!comp) return;
    renameTarget = { uniqueId: uniqueId, category: category, oldName: comp.name };
    DCUI.openRenameModal('library', comp.name);
  }

  function confirmRename() {
    if (!renameTarget) return;
    var newName = els().newNameInput.value.trim();
    if (!newName || newName === renameTarget.oldName) {
      DCUI.closeModal(els().renameModal);
      renameTarget = null;
      return;
    }
    var v = DCValidate.validateName(newName, 'Name');
    if (!v.valid) { DCUI.toast(v.error, true); return; }
    if (!DCBridge.acquire('renaming')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
    DCUI.closeModal(els().renameModal);
    DCUI.spinner(true);
    var t = renameTarget;
    renameTarget = null;
    DCBridge.call('renameStashedComp', [libPath(), t.category, t.uniqueId, v.name], function (result) {
      DCUI.spinner(false);
      DCBridge.release();
      var r = DCBridge.parseJson(result);
      if (r && r.ok) {
        DCState.migrateMetadataKey(usageMeta, t.uniqueId, r.newUniqueId);
        persistUsage();
        DCUI.toast('Renamed.', false);
        load();
      } else {
        DCUI.toast((r && r.error) || result, true);
      }
    });
  }

  function deleteFlow(uniqueId, category) {
    var comp = findComp(uniqueId);
    if (!comp) return;
    deleteTarget = { uniqueId: uniqueId, category: category };
    DCUI.openDeleteModal('library', comp.name);
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    if (!DCBridge.acquire('deleting')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
    DCUI.closeModal(els().deleteModal);
    DCUI.spinner(true);
    var t = deleteTarget;
    deleteTarget = null;
    DCBridge.call('deleteStashedComp', [libPath(), t.category, t.uniqueId], function (result) {
      DCUI.spinner(false);
      DCBridge.release();
      if (result === 'Success') {
        DCUI.toast('Deleted.', false);
        load();
      } else {
        DCUI.toast(result, true);
      }
    });
  }

  function generateThumb(uniqueId, category) {
    if (!DCBridge.acquire('generating thumbnail')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
    DCUI.spinner(true);
    DCBridge.call('generateThumbForItem', [libPath(), category, uniqueId], function (result) {
      DCUI.spinner(false);
      DCBridge.release();
      var r = DCBridge.parseJson(result);
      if (r && r.ok) {
        busts[uniqueId] = Date.now();
        DCUI.toast(r.thumbOk ? 'Thumbnail generated.' : 'Info updated, but the frame render failed.', !r.thumbOk);
        load();
      } else {
        DCUI.toast((r && r.error) || result, true);
      }
    });
  }

  function setThumb(uniqueId, category) {
    if (!DCBridge.acquire('setting thumbnail')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
    DCUI.spinner(true);
    DCBridge.call('setThumbFromActiveComp', [libPath(), category, uniqueId], function (result) {
      DCUI.spinner(false);
      DCBridge.release();
      var r = DCBridge.parseJson(result);
      if (r && r.ok) {
        busts[uniqueId] = Date.now();
        DCUI.toast('Thumbnail set from current frame.', false);
        load();
      } else {
        DCUI.toast((r && r.error) || result, true);
      }
    });
  }

  function revealItem(uniqueId, category) {
    DCBridge.call('revealInFinder', [libPath() + '/' + category + '/' + uniqueId], function (result) {
      if (result !== 'ok') DCUI.toast(result, true);
    });
  }

  function relinkMissing() {
    if (!DCBridge.acquire('relinking footage')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
    DCUI.spinner(true);
    DCBridge.call('relinkMissingFootage', [libPath()], function (result) {
      DCUI.spinner(false);
      DCBridge.release();
      var r = DCBridge.parseJson(result);
      if (r && r.ok) {
        if (r.missing === 0) {
          DCUI.toast('No missing footage in this project.', false);
        } else if (r.relinked === r.missing) {
          DCUI.toast('Relinked all ' + r.relinked + ' missing file' + (r.relinked === 1 ? '' : 's') + '. Save your project.', false, 5000);
        } else {
          var names = (r.notFound || []).slice(0, 3).join(', ');
          var more = (r.notFound || []).length > 3 ? ' +' + (r.notFound.length - 3) + ' more' : '';
          DCUI.toast('Relinked ' + r.relinked + ' of ' + r.missing +
            (r.relinked > 0 ? ' - save your project.' : '.') +
            (names ? ' Not found: ' + names + more : ''), r.relinked === 0, 7000);
          console.warn('DropComp relink - not found:', r.notFound);
        }
      } else {
        DCUI.toast((r && r.error) || result, true);
      }
    });
  }

  function toggleSection(category) {
    var prefs = DCShell.getPrefs();
    var i = prefs.collapsed.indexOf(category);
    if (i === -1) prefs.collapsed.push(category);
    else prefs.collapsed.splice(i, 1);
    DCShell.persistPrefs();
    rerender();
  }

  function onCardAction(action, uniqueId, category) {
    if (action === 'import') importItem(uniqueId);
    else if (action === 'favorite') toggleFavorite(uniqueId);
    else if (action === 'rename') renameFlow(uniqueId, category);
    else if (action === 'delete') deleteFlow(uniqueId, category);
    else if (action === 'generate') generateThumb(uniqueId, category);
    else if (action === 'setThumb') setThumb(uniqueId, category);
    else if (action === 'reveal') revealItem(uniqueId, category);
  }

  function clearPending() {
    renameTarget = null;
    deleteTarget = null;
  }

  return {
    init: init, load: load, refresh: refresh, rerender: rerender,
    ensureLoaded: ensureLoaded, resetLoaded: resetLoaded,
    stashFlow: stashFlow, addAepFlow: addAepFlow, confirmCategory: confirmCategory,
    importItem: importItem, confirmRename: confirmRename, confirmDelete: confirmDelete,
    relinkMissing: relinkMissing, toggleSection: toggleSection,
    onCardAction: onCardAction, clearPending: clearPending
  };
}());
```

- [x] **Step 4: Rewrite `panel/js/main.js`** (els gains `tabLibrary`, `tabAssets`, `addAssetsBtn`; routing goes through DCShell):

```js
(function () {
  'use strict';

  var csInterface = new CSInterface();
  DCBridge.init(csInterface);

  function $(id) { return document.getElementById(id); }

  var els = {
    welcome: $('welcome-overlay'),
    driveMissing: $('drive-missing'),
    driveMissingPath: $('drive-missing-path'),
    app: $('app'),
    library: $('library'),
    tabLibrary: $('tab-library'),
    tabAssets: $('tab-assets'),
    search: $('search-input'),
    sortSelect: $('sort-select'),
    favoritesBtn: $('favorites-btn'),
    displayBtn: $('display-btn'),
    displayMenu: $('display-menu'),
    showNamesCb: $('show-names-cb'),
    showMetaCb: $('show-meta-cb'),
    addCompBtn: $('add-comp-btn'),
    addAepBtn: $('add-aep-btn'),
    addAssetsBtn: $('add-assets-btn'),
    thumbSlider: $('thumb-slider'),
    settingsBtn: $('settings-btn'),
    categoryModal: $('category-modal'),
    categoryModalTitle: $('category-modal-title'),
    existingCategorySelect: $('existing-category-select'),
    newCategoryInput: $('new-category-input'),
    renameModal: $('rename-modal'),
    newNameInput: $('new-name-input'),
    deleteModal: $('delete-modal'),
    deleteName: $('delete-name'),
    settingsModal: $('settings-modal'),
    settingsPath: $('settings-path'),
    spinner: $('loading-spinner'),
    toast: $('toast')
  };

  DCUI.init(els);
  DCShell.init(els);
  DCLibrary.init();
  if (typeof DCAssets !== 'undefined') DCAssets.init();

  $('welcome-browse-btn').addEventListener('click', DCShell.selectLibraryFolder);
  $('retry-library-btn').addEventListener('click', DCShell.verifyAndLoad);
  $('missing-change-path-btn').addEventListener('click', DCShell.selectLibraryFolder);

  els.tabLibrary.addEventListener('click', function () { DCShell.setActiveTab('library'); });
  els.tabAssets.addEventListener('click', function () { DCShell.setActiveTab('assets'); });

  els.search.addEventListener('input', DCShell.onSearch);
  els.sortSelect.addEventListener('change', DCShell.onSortChange);
  els.favoritesBtn.addEventListener('click', DCShell.onFavoritesToggle);
  $('relink-btn').addEventListener('click', DCLibrary.relinkMissing);
  els.showNamesCb.addEventListener('change', DCShell.onDisplayChange);
  els.showMetaCb.addEventListener('change', DCShell.onDisplayChange);
  els.thumbSlider.addEventListener('input', DCShell.onSlider);
  els.addCompBtn.addEventListener('click', DCLibrary.stashFlow);
  els.addAepBtn.addEventListener('click', DCLibrary.addAepFlow);
  if (els.addAssetsBtn && typeof DCAssets !== 'undefined') {
    els.addAssetsBtn.addEventListener('click', DCAssets.addFlow);
  }
  els.settingsBtn.addEventListener('click', DCShell.openSettings);

  els.displayBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    els.displayMenu.classList.toggle('hidden');
  });
  document.addEventListener('click', function (e) {
    if (!els.displayMenu.classList.contains('hidden') &&
        !els.displayMenu.contains(e.target) && e.target !== els.displayBtn) {
      els.displayMenu.classList.add('hidden');
    }
  });

  $('cancel-category-btn').addEventListener('click', function () { DCUI.closeModal(els.categoryModal); });
  $('confirm-category-btn').addEventListener('click', DCShell.confirmCategoryModal);
  $('cancel-rename-btn').addEventListener('click', function () { DCUI.closeModal(els.renameModal); });
  $('confirm-rename-btn').addEventListener('click', DCShell.confirmRename);
  $('cancel-delete-btn').addEventListener('click', function () { DCUI.closeModal(els.deleteModal); });
  $('confirm-delete-btn').addEventListener('click', DCShell.confirmDelete);
  $('close-settings-btn').addEventListener('click', function () { DCUI.closeModal(els.settingsModal); });
  $('open-finder-btn').addEventListener('click', DCShell.openLibraryInFinder);
  $('refresh-library-btn').addEventListener('click', DCShell.refreshActive);
  $('change-path-btn').addEventListener('click', DCShell.changeFolder);

  els.library.addEventListener('click', function (e) {
    var actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    var action = actionEl.dataset.action;
    if (action === 'toggleSection') {
      DCShell.toggleSection(actionEl.closest('.category').dataset.category);
      return;
    }
    var card = actionEl.closest('.card');
    if (!card) return;
    DCShell.onCardAction(action, card.dataset.uniqueId, card.dataset.category);
  });

  els.library.addEventListener('dblclick', function (e) {
    var card = e.target.closest('.card');
    if (card && !e.target.closest('[data-action]')) {
      DCShell.onCardDblClick(card.dataset.uniqueId);
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') DCShell.closeAllModals();
    if (e.key === 'Enter') {
      if (!els.renameModal.classList.contains('hidden')) DCShell.confirmRename();
      else if (!els.categoryModal.classList.contains('hidden')) DCShell.confirmCategoryModal();
    }
  });

  // host modules must load before any relink/assets-dependent call
  DCBridge.call('loadHostModules', [csInterface.getSystemPath(SystemPath.EXTENSION)], function (r) {
    if (r !== 'ok') console.error('DropComp: host module load failed -', r);

    // one-time v1 -> v2 settings migration (path used to live in panel localStorage)
    var oldPath = window.localStorage.getItem('ae_asset_stash_path');
    if (oldPath) {
      DCBridge.call('setLibraryPath', [oldPath], function () {
        window.localStorage.removeItem('ae_asset_stash_path');
        DCShell.boot();
      });
    } else {
      DCShell.boot();
    }
  });
}());
```

- [x] **Step 5: Update `panel/index.html` script tags** — replace the actions.js tag:

```html
<script src="js/CSInterface.js"></script>
<script src="js/validate.js"></script>
<script src="js/state.js"></script>
<script src="js/bridge.js"></script>
<script src="js/render.js"></script>
<script src="js/ui.js"></script>
<script src="js/shell.js"></script>
<script src="js/library.js"></script>
<script src="js/main.js"></script>
```

(assets.js is appended in Task 7.)

- [x] **Step 6: Delete `panel/js/actions.js`**

```bash
git rm panel/js/actions.js
```

- [x] **Step 7: Verify syntax, suite, and line limits**

```bash
node --check panel/js/ui.js && node --check panel/js/shell.js && node --check panel/js/library.js && node --check panel/js/main.js
npm test 2>&1 | grep -E "^# (pass|fail)"
wc -l panel/js/ui.js panel/js/shell.js panel/js/library.js panel/js/main.js
```
Expected: clean, all pass, every file < 400.

- [x] **Step 8: Commit**

```bash
git add -A panel/
git commit -m "refactor(panel): split actions.js into ui/shell/library modules"
```

---

### Task 7: Assets panel module + tab UI

**Files:**
- Create: `panel/js/assets.js`
- Modify: `panel/index.html`, `panel/css/style.css`

- [x] **Step 1: Create `panel/js/assets.js`**

```js
var DCAssets = (function () {
  'use strict';

  var allAssets = [];
  var usageMeta = {};
  var pendingPaths = null;
  var renameTarget = null;
  var deleteTarget = null;
  var loadedOnce = false;

  function init() { usageMeta = DCState.loadUsageMeta(localStorage, DCState.ASSETS_USAGE_KEY); }

  function els() { return DCShell.getEls(); }
  function libPath() { return DCShell.getLibraryPath(); }
  function persistUsage() { DCState.saveUsageMeta(localStorage, usageMeta, DCState.ASSETS_USAGE_KEY); }

  function ensureLoaded() {
    if (loadedOnce) rerender();
    else load();
  }
  function resetLoaded() { loadedOnce = false; }

  function load() {
    if (!DCBridge.acquire('loading assets')) return;
    DCUI.spinner(true);
    DCBridge.call('getAssets', [libPath()], function (result) {
      try {
        allAssets = (result && result !== '[]' && !DCUI.isError(result)) ? JSON.parse(result) : [];
        loadedOnce = true;
        var r = DCState.cleanupStaleMetadata(usageMeta, allAssets);
        if (r.removed > 0) { usageMeta = r.usageMeta; persistUsage(); }
        rerender();
      } catch (e) {
        DCUI.toast('Error loading assets.', true);
      } finally {
        DCUI.spinner(false);
        DCBridge.release();
      }
    });
  }

  function refresh() {
    if (!DCBridge.acquire('refreshing assets')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
    DCUI.spinner(true);
    DCBridge.call('rebuildAssetsIndex', [libPath()], function (result) {
      try {
        allAssets = (result && result !== '[]' && !DCUI.isError(result)) ? JSON.parse(result) : [];
        loadedOnce = true;
        rerender();
        DCUI.toast('Assets refreshed.', false);
      } catch (e) {
        DCUI.toast('Error refreshing assets.', true);
      } finally {
        DCUI.spinner(false);
        DCBridge.release();
      }
    });
  }

  function rerender() {
    var prefs = DCShell.getPrefs();
    var filtered = DCState.filterComps(allAssets, {
      search: els().search.value,
      favoritesOnly: prefs.favoritesOnly,
      usageMeta: usageMeta
    });
    var groups = DCState.groupByCategory(filtered).map(function (g) {
      return { category: g.category, items: DCState.sortComps(g.items, prefs.sort, usageMeta) };
    });
    var msg = allAssets.length === 0
      ? 'No assets yet. Click Add Assets to add images.'
      : 'No assets match.';
    DCRender.render(els().library, groups, prefs, usageMeta, {}, msg, 'asset');
  }

  function findAsset(uniqueId) {
    for (var i = 0; i < allAssets.length; i++) {
      if (allAssets[i].uniqueId === uniqueId) return allAssets[i];
    }
    return null;
  }

  function fileNameOf(uniqueId) {
    return uniqueId.slice(uniqueId.indexOf('/') + 1);
  }

  function categories() {
    var cats = [];
    allAssets.forEach(function (a) {
      if (cats.indexOf(a.category) === -1) cats.push(a.category);
    });
    cats.sort();
    return cats;
  }

  function addFlow() {
    DCBridge.call('pickAssetFiles', [], function (result) {
      var r = DCBridge.parseJson(result);
      if (!r) { DCUI.toast('Error: unexpected response.', true); return; }
      if (r.cancelled) return;
      if (!r.ok) { DCUI.toast(r.error, true); return; }
      pendingPaths = r.paths;
      DCUI.openCategoryModal('addAssets', 'Add Assets', categories());
    });
  }

  function confirmCategory(categoryName) {
    if (!pendingPaths || !pendingPaths.length) { DCUI.closeModal(els().categoryModal); return; }
    if (!DCBridge.acquire('adding assets')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
    DCUI.closeModal(els().categoryModal);
    DCUI.spinner(true);
    var paths = pendingPaths;
    pendingPaths = null;
    DCBridge.call('addAssetFiles', [libPath(), categoryName, JSON.stringify(paths)], function (result) {
      DCUI.spinner(false);
      DCBridge.release();
      var r = DCBridge.parseJson(result);
      if (r && r.ok) {
        var msg = r.added + ' asset' + (r.added === 1 ? '' : 's') + ' added.';
        if (r.skipped && r.skipped.length) {
          msg += ' Skipped: ' + r.skipped.slice(0, 3).join(', ') +
            (r.skipped.length > 3 ? ' +' + (r.skipped.length - 3) + ' more' : '');
        }
        DCUI.toast(msg, r.added === 0, r.skipped && r.skipped.length ? 6000 : 3000);
        load();
      } else {
        DCUI.toast((r && r.error) || result, true);
      }
    });
  }

  function importItem(uniqueId, isRetry) {
    var asset = findAsset(uniqueId);
    if (!asset) return;
    if (!DCBridge.acquire('importing asset')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
    DCBridge.call('importAsset', [asset.filePath], function (result) {
      DCBridge.release();
      if (DCUI.isError(result) && result.indexOf('not found') !== -1 && !isRetry) {
        DCBridge.call('rebuildAssetsIndex', [libPath()], function (rebuilt) {
          try { allAssets = (rebuilt && rebuilt !== '[]') ? JSON.parse(rebuilt) : []; } catch (e) { allAssets = []; }
          rerender();
          if (findAsset(uniqueId)) importItem(uniqueId, true);
          else DCUI.toast('Error: asset missing on disk - assets re-indexed.', true);
        });
        return;
      }
      if (!DCUI.isError(result)) {
        var u = DCState.getUsage(usageMeta, uniqueId);
        usageMeta[uniqueId] = { lastUsed: Date.now(), useCount: u.useCount + 1, isFavorite: u.isFavorite };
        persistUsage();
      }
      DCUI.toast(result, DCUI.isError(result));
    });
  }

  function toggleFavorite(uniqueId) {
    var u = DCState.getUsage(usageMeta, uniqueId);
    usageMeta[uniqueId] = { lastUsed: u.lastUsed, useCount: u.useCount, isFavorite: !u.isFavorite };
    persistUsage();
    rerender();
  }

  function renameFlow(uniqueId, category) {
    var asset = findAsset(uniqueId);
    if (!asset) return;
    renameTarget = { uniqueId: uniqueId, category: category, oldName: asset.name };
    DCUI.openRenameModal('assets', asset.name);
  }

  function confirmRename() {
    if (!renameTarget) return;
    var newName = els().newNameInput.value.trim();
    if (!newName || newName === renameTarget.oldName) {
      DCUI.closeModal(els().renameModal);
      renameTarget = null;
      return;
    }
    var v = DCValidate.validateName(newName, 'Name');
    if (!v.valid) { DCUI.toast(v.error, true); return; }
    if (!DCBridge.acquire('renaming asset')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
    DCUI.closeModal(els().renameModal);
    DCUI.spinner(true);
    var t = renameTarget;
    renameTarget = null;
    DCBridge.call('renameAsset', [libPath(), t.category, fileNameOf(t.uniqueId), v.name], function (result) {
      DCUI.spinner(false);
      DCBridge.release();
      var r = DCBridge.parseJson(result);
      if (r && r.ok) {
        DCState.migrateMetadataKey(usageMeta, t.uniqueId, r.newUniqueId);
        persistUsage();
        DCUI.toast('Renamed.', false);
        load();
      } else {
        DCUI.toast((r && r.error) || result, true);
      }
    });
  }

  function deleteFlow(uniqueId, category) {
    var asset = findAsset(uniqueId);
    if (!asset) return;
    deleteTarget = { uniqueId: uniqueId, category: category };
    DCUI.openDeleteModal('assets', asset.name);
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    if (!DCBridge.acquire('deleting asset')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
    DCUI.closeModal(els().deleteModal);
    DCUI.spinner(true);
    var t = deleteTarget;
    deleteTarget = null;
    DCBridge.call('deleteAsset', [libPath(), t.category, fileNameOf(t.uniqueId)], function (result) {
      DCUI.spinner(false);
      DCBridge.release();
      var r = DCBridge.parseJson(result);
      if (r && r.ok) {
        DCUI.toast('Deleted.', false);
        load();
      } else {
        DCUI.toast((r && r.error) || result, true);
      }
    });
  }

  function revealItem(uniqueId, category) {
    DCBridge.call('revealInFinder', [libPath() + '/Assets/' + category], function (result) {
      if (result !== 'ok') DCUI.toast(result, true);
    });
  }

  function toggleSection(category) {
    var prefs = DCShell.getPrefs();
    var i = prefs.collapsedAssets.indexOf(category);
    if (i === -1) prefs.collapsedAssets.push(category);
    else prefs.collapsedAssets.splice(i, 1);
    DCShell.persistPrefs();
    rerender();
  }

  function onCardAction(action, uniqueId, category) {
    if (action === 'import') importItem(uniqueId);
    else if (action === 'favorite') toggleFavorite(uniqueId);
    else if (action === 'rename') renameFlow(uniqueId, category);
    else if (action === 'delete') deleteFlow(uniqueId, category);
    else if (action === 'reveal') revealItem(uniqueId, category);
  }

  function clearPending() {
    renameTarget = null;
    deleteTarget = null;
    pendingPaths = null;
  }

  return {
    init: init, load: load, refresh: refresh, rerender: rerender,
    ensureLoaded: ensureLoaded, resetLoaded: resetLoaded,
    addFlow: addFlow, confirmCategory: confirmCategory,
    importItem: importItem, confirmRename: confirmRename, confirmDelete: confirmDelete,
    toggleSection: toggleSection, onCardAction: onCardAction, clearPending: clearPending
  };
}());
```

- [x] **Step 2: Update `panel/index.html`**

Tab bar — enable the assets tab:

```html
  <nav id="tabs">
    <button class="tab active" id="tab-library">Library</button>
    <button class="tab" id="tab-assets">Assets</button>
  </nav>
```

Toolbar — add the Add Assets button right after the add-aep button (same `row gap` div):

```html
      <button id="add-assets-btn" class="btn-gold grow">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        <span>Add Assets</span>
      </button>
```

Script tags — add assets.js between library.js and main.js:

```html
<script src="js/library.js"></script>
<script src="js/assets.js"></script>
<script src="js/main.js"></script>
```

- [x] **Step 3: CSS additions** (append to `panel/css/style.css`; verify variable names against the file's `:root` block and match the existing `.btn-gold` display rule when hiding/showing):

```css
/* ---- assets tab ---- */
#add-assets-btn { display: none; }
#app.assets-active #add-assets-btn { display: flex; }
#app.assets-active #add-comp-btn,
#app.assets-active #add-aep-btn,
#app.assets-active #relink-btn { display: none; }

.card--asset .card-thumb img {
  object-fit: contain;
  padding: 10px;
  box-sizing: border-box;
}
.ext-badge {
  font-size: 11px;
  letter-spacing: 1px;
  color: var(--text-dim, #888);
  border: 1px solid var(--border);
  padding: 2px 7px;
  border-radius: 4px;
}
#library.grid--s .ext-badge { font-size: 9px; padding: 1px 5px; }
```

- [x] **Step 4: Verify**

```bash
node --check panel/js/assets.js
npm test 2>&1 | grep -E "^# (pass|fail)"
wc -l panel/js/*.js panel/css/style.css
```
Expected: clean, all pass, every authored panel file < 400.

- [x] **Step 5: Commit**

```bash
git add panel/
git commit -m "feat(panel): assets tab - grid, add/import/rename/delete/reveal, favorites"
```

---

### Task 8: Acquire-before-close for the category modal

The shared category-modal flow closes the modal before acquiring the op lock, losing the typed category when the bridge is busy (review finding from the v2 merge). Both feature modules now route through `confirmCategory`, so fix the ordering in both.

**Files:**
- Modify: `panel/js/library.js` (`confirmCategory`), `panel/js/assets.js` (`confirmCategory`)

- [x] **Step 1: Reorder library.js `confirmCategory`** — acquire first, keep the modal open on busy:

```js
  function confirmCategory(mode, categoryName) {
    if (mode === 'stash') {
      if (!DCBridge.acquire('stashing')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
      DCUI.closeModal(els().categoryModal);
      ...
```
(and the same two-line swap in the `addAep` branch — acquire, then `DCUI.closeModal`.)

- [x] **Step 2: Reorder assets.js `confirmCategory`** the same way (acquire before `closeModal`; the no-paths early-out keeps closing first).

- [x] **Step 3: Verify + commit**

```bash
node --check panel/js/library.js && node --check panel/js/assets.js && npm test 2>&1 | grep -E "^# (pass|fail)"
git add panel/js/library.js panel/js/assets.js
git commit -m "fix(panel): acquire op lock before closing category modal - busy keeps input"
```

---

### Task 9: Docs + wrap-up checks

**Files:**
- Modify: `README.md` (feature list), this plan (tick boxes)

- [x] **Step 1: README** — add an Assets bullet to the feature list mirroring the existing tone, e.g. "**Assets tab** — a second library for reusable images (icons, logos, textures): multi-add from disk, instant file thumbnails, import to the active comp at the playhead."

- [x] **Step 2: Full suite + line limits**

```bash
npm test 2>&1 | grep -E "^# (tests|pass|fail)"
wc -l panel/js/*.js jsx/*.jsx panel/css/style.css
```
Expected: all pass; panel files < 400 (CSInterface.js exempt); jsx files < 800.

- [x] **Step 3: Commit**

```bash
git add README.md docs/
git commit -m "docs: assets tab in README, tick plan"
```

- [ ] **Step 4: Manual AE checklist** (close/reopen the panel in AE — repo is symlinked):

1. Panel boots on Library tab; everything works as before (regression pass: stash, import, rename).
2. Assets tab activates; empty state shows.
3. Add Assets → multi-select 3+ PNGs → new category → all appear with image thumbnails.
4. Add a .psd → PSD badge placeholder renders; import still works.
5. Double-click an asset with a comp open → lands at playhead, layer selected; project panel shows "Assets [DropComp]" bin.
6. Import the same asset again → footage reused (no duplicate in project panel).
7. Rename an asset (use a name with a space) → file renamed on disk, favorite star survives.
8. Delete an asset → gone from grid and disk.
9. Reveal → Finder opens the category folder.
10. Favorites toggle + favorites-only filter + search + sort + slider on assets tab.
11. Switch tabs → contextual buttons swap; quit/reopen panel → last tab restored.
12. Unplug/rename drive path → drive-missing screen still works.
13. Try to create a comp category named "assets" → rejected.

---

### Task 10: Review + merge

- [x] **Step 1: Use superpowers:requesting-code-review** on the full branch range (base = main), fix Critical/Important findings.
  Verdict: ready with fixes; refactor confirmed behavior-preserving. Fixed: host-error masking in assets load/refresh (false "refreshed" toast), cross-tab render race (load finishing after tab switch painted wrong card kind), stale cached data on drive-missing Retry, busy-toast on load, dot-files skip-reported on add, stale-index dedupe on re-add, ghost-entry delete, zero-valid-files message with format list, asset thumb cache-bust, version bump 2.1.0, settings button label. Host fixes re-verified live in the AE engine.
  Deferred (recorded): case-only rename fails on APFS (parity with comp rename); DCValidate accepts ".." as category (pre-existing, self-inflicted-only); comp usage still increments before import (pre-existing).
- [x] **Step 2: Use superpowers:finishing-a-development-branch** to merge `feature/assets-tab` into `main` and delete the branch.

---

## Self-review (done while writing)

- **Spec coverage:** §3 layout → Task 3 (assets.jsx paths) + Task 4 (reserved category). §4 index → Task 3. §5 host fns → Tasks 3–4. §6.1 split → Task 6. §6.2 flows → Task 7. §6.3 tabs/toolbar → Tasks 6 (shell) + 7 (html/css). §6.4 state → Task 1. §6.5 render → Task 5. §6.6 css → Task 7. §7 edge cases → Tasks 3/7 (rebuild-retry, skipped names, busy). §8 testing → Tasks 1, 2, 3; manual → Task 9. Acquire-order fix → Task 8.
- **Type consistency:** `DCShell.getEls/getPrefs/getLibraryPath/persistPrefs` used by library.js and assets.js match shell.js exports. Module interface (`ensureLoaded/resetLoaded/load/refresh/rerender/onCardAction/toggleSection/importItem/confirmRename/confirmDelete/confirmCategory/clearPending`) is identical across DCLibrary/DCAssets where shell dispatches. Asset index fields (`name/category/uniqueId/filePath/ext/sizeBytes/addedAt`) consistent across assets.jsx, state tests, render. `DCState.ASSETS_USAGE_KEY` used in assets.js matches Task 1. Render `kind === 'asset'` matches assets.js caller.
- **Placeholder scan:** Task 8 shows the exact reordered lines rather than full functions (the functions appear in full in Tasks 6–7); everything else is complete code.
