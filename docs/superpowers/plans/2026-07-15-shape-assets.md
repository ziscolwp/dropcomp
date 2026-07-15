# Shape Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture selected AE shape layers into the Assets tab as self-contained .aep snapshots, and paste them back into any comp as editable shape layers.

**Architecture:** New `jsx/shapes.jsx` host module rides the proven Library-stash machinery (save → save-as-temp → copy layers to a throwaway comp → `reduceProject` → copy the tiny .aep out → reopen original). Import silently imports the .aep, `copyToComp`s the shape layers into the active comp, then deletes the imported items. Assets index treats `ext === 'aep'` as a shape asset with a dot-file PNG thumbnail sidecar.

**Tech Stack:** ExtendScript ES3 (jsx), vanilla ES5 panel JS, node:test with vm-context AE mocks.

**Spec:** `docs/superpowers/specs/2026-07-15-shape-assets-design.md`

## Global Constraints

- ExtendScript is ES3: no `const`/`let`, no `trim()`, no `Array.prototype.map/forEach`, `var` only (jsx files). `tests/jsx.es3.test.js` enforces this.
- Every top-level jsx function MUST be exported via `$.global.<name> = <name>;` (`tests/jsx.exports.test.js` enforces).
- AE project import must happen OUTSIDE any explicit undo group (`tests/undo-groups.test.js` enforces the ordering).
- Shape layers fail `instanceof AVLayer` checks — detect with `layer.matchName === 'ADBE Vector Layer'`.
- Text protocol for import results: strings starting `Success:` / `Error:` (mirrors `importAsset`/`importComp`). JSON protocol (`{"ok":...}`) for everything else.
- Panel mutations that change disk state call `loadAndBroadcast()`, never plain `load()`; plain refreshes never broadcast.
- Run tests with: `npm test` (or a single file: `node --test tests/<file>`).
- Commit messages: conventional prefixes + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer. Stage files explicitly — never `git add -A`.

---

### Task 1: shapes.jsx module skeleton + `getShapeSelectionInfo`

**Files:**
- Create: `jsx/shapes.jsx`
- Modify: `jsx/hostscript.jsx:9-10` (DC_MODULE_FILES / DC_MODULE_MARKERS)
- Modify: `tests/jsx.exports.test.js:13-14` (LOADED_MODULES / MARKERS)
- Test: `tests/shapes.jsx.test.js`

**Interfaces:**
- Consumes: hostscript globals `jerr`, `jsonEscape`; AE globals `app`, `CompItem`.
- Produces: `isShapeLayer(layer) -> bool`, `getShapeSelectionInfo() -> '{"ok":true,"count":N,"skipped":M,"name":"..."}' | jerr(...)`. Marker for the module loader: `addShapeFromSelection` (stubbed in Task 1? No — the marker array is only extended in Task 2 when the function exists; Task 1 registers the file with marker `getShapeSelectionInfo`, Task 2 does NOT change the marker. One marker per module; use `getShapeSelectionInfo` permanently.)

- [ ] **Step 1: Write the failing test**

Create `tests/shapes.jsx.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function CompItem() {}
function FolderItem() {}
function FootageItem() {}

function shapeLayer(name, opts) {
  return Object.assign({ name, matchName: 'ADBE Vector Layer', startTime: 0, outPoint: 1 }, opts || {});
}
function textLayer(name) {
  return { name, matchName: 'ADBE Text Layer', startTime: 0, outPoint: 1 };
}

function baseContext(project) {
  const context = {
    $: { global: {} },
    app: { project },
    CompItem, FolderItem, FootageItem,
    File: function File() {},
    Folder: function Folder() {},
    ImportOptions: function ImportOptions() {},
    jerr(message) { return JSON.stringify({ ok: false, error: message }); },
    jsonEscape(value) { return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); },
    safeNameJsx(name) { return String(name).replace(/[^a-z0-9]/gi, '_').replace(/_{2,}/g, '_'); },
    JSON,
    decodeURI: (s) => s,
    Math,
  };
  vm.createContext(context);
  return context;
}

function loadShapesJsx(project, extend) {
  const context = baseContext(project);
  if (extend) extend(context);
  vm.runInContext(read('jsx/shapes.jsx'), context, { filename: 'shapes.jsx' });
  return context.$.global;
}

function compWithSelection(selectedLayers) {
  const comp = new CompItem();
  comp.selectedLayers = selectedLayers;
  return comp;
}

// ---- getShapeSelectionInfo --------------------------------------------------

test('getShapeSelectionInfo returns count, skipped and first shape name', () => {
  const comp = compWithSelection([shapeLayer('Star'), textLayer('Title'), shapeLayer('Blob')]);
  const g = loadShapesJsx({ activeItem: comp, file: {} });
  const r = JSON.parse(g.getShapeSelectionInfo());
  assert.equal(r.ok, true);
  assert.equal(r.count, 2);
  assert.equal(r.skipped, 1);
  assert.equal(r.name, 'Star');
});

test('getShapeSelectionInfo requires an active comp', () => {
  const g = loadShapesJsx({ activeItem: null, file: {} });
  const r = JSON.parse(g.getShapeSelectionInfo());
  assert.equal(r.ok, false);
  assert.match(r.error, /open composition/i);
});

test('getShapeSelectionInfo rejects selections without any shape layer', () => {
  const comp = compWithSelection([textLayer('Title')]);
  const g = loadShapesJsx({ activeItem: comp, file: {} });
  const r = JSON.parse(g.getShapeSelectionInfo());
  assert.equal(r.ok, false);
  assert.match(r.error, /shape layer/i);
});

test('getShapeSelectionInfo requires the project to be saved once', () => {
  const comp = compWithSelection([shapeLayer('Star')]);
  const g = loadShapesJsx({ activeItem: comp, file: null });
  const r = JSON.parse(g.getShapeSelectionInfo());
  assert.equal(r.ok, false);
  assert.match(r.error, /save your project/i);
});

test('isShapeLayer uses matchName, not instanceof', () => {
  const src = read('jsx/shapes.jsx');
  assert.match(src, /matchName === 'ADBE Vector Layer'/);
  assert.doesNotMatch(src, /instanceof ShapeLayer/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/shapes.jsx.test.js`
Expected: FAIL — `Cannot find module .../jsx/shapes.jsx` (ENOENT from `read`).

- [ ] **Step 3: Create jsx/shapes.jsx with the minimal implementation**

```jsx
// DropComp shape-assets module (ExtendScript, ES3 only)
// Loaded by hostscript.jsx loadHostModules() via $.evalFile. evalFile runs in
// the caller's LOCAL scope, so every public function must be exported to
// $.global explicitly or it is undefined at call time.
// Uses hostscript globals: jerr, jsonEscape, safeNameJsx, collectComps,
// saveVerifiedThumb. Uses assets.jsx globals (loads before this file):
// assetExt, assetEntryFromFile, loadAssetsIndex, saveAssetsIndex,
// uniqueAssetTarget, shapeThumbSidecarName. Uses aep-compat globals:
// aepPreflight.

// Shape and text layers fail `instanceof AVLayer` checks in ExtendScript -
// matchName is the reliable discriminator.
function isShapeLayer(layer) {
    return !!layer && layer.matchName === 'ADBE Vector Layer';
}

function selectedShapeLayers(comp) {
    var out = [];
    var sel = comp.selectedLayers;
    for (var i = 0; i < sel.length; i++) {
        if (isShapeLayer(sel[i])) out.push(sel[i]);
    }
    return out;
}

// Fast pre-modal validation so the user sees a specific error before picking
// a category. JSON protocol.
function getShapeSelectionInfo() {
    try {
        if (!app.project) return jerr('Please open a project first.');
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return jerr('Select shape layers in an open composition first.');
        }
        var shapes = selectedShapeLayers(comp);
        if (!shapes.length) return jerr('Select one or more shape layers first.');
        if (!app.project.file) return jerr('Save your project once before saving shapes.');
        return '{"ok":true,"count":' + shapes.length +
            ',"skipped":' + (comp.selectedLayers.length - shapes.length) +
            ',"name":"' + jsonEscape(shapes[0].name) + '"}';
    } catch (e) {
        return jerr(e.toString());
    }
}

// ---- exports (see header comment) ----
$.global.isShapeLayer = isShapeLayer;
$.global.selectedShapeLayers = selectedShapeLayers;
$.global.getShapeSelectionInfo = getShapeSelectionInfo;
```

- [ ] **Step 4: Register the module in hostscript.jsx**

In `jsx/hostscript.jsx`, change lines 9-10:

```jsx
var DC_MODULE_FILES = ['relink.jsx', 'assets.jsx', 'tools.jsx', 'tools-timing.jsx', 'scripts.jsx', 'library-move.jsx', 'aep-compat.jsx', 'import-capture.jsx', 'shapes.jsx'];
var DC_MODULE_MARKERS = ['collectMissingFootage', 'getAssets', 'tlCreateLayer', 'tlAdjustTiming', 'scRunFile', 'moveStashedComp', 'aepPreflight', 'addExternalAep', 'getShapeSelectionInfo'];
```

In `tests/jsx.exports.test.js`, change lines 13-14 to match:

```js
const LOADED_MODULES = ['relink.jsx', 'assets.jsx', 'tools.jsx', 'tools-timing.jsx', 'scripts.jsx', 'library-move.jsx', 'aep-compat.jsx', 'import-capture.jsx', 'shapes.jsx'];
const MARKERS = ['collectMissingFootage', 'getAssets', 'tlCreateLayer', 'tlAdjustTiming', 'scRunFile', 'moveStashedComp', 'aepPreflight', 'addExternalAep', 'getShapeSelectionInfo'];
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS (shapes.jsx tests green; jsx.exports and jsx.es3 pick up the new module automatically).

- [ ] **Step 6: Commit**

```bash
git add jsx/shapes.jsx jsx/hostscript.jsx tests/shapes.jsx.test.js tests/jsx.exports.test.js
git commit -m "feat(shapes): add shapes.jsx module with selection validation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `addShapeFromSelection` capture flow

**Files:**
- Modify: `jsx/shapes.jsx`
- Modify: `jsx/assets.jsx` (add `shapeThumbSidecarName` helper — it is an index-naming concern)
- Test: `tests/shapes.jsx.test.js` (extend)

**Interfaces:**
- Consumes: `safeNameJsx`, `uniqueAssetTarget(catFolder, fileName)`, `assetEntryFromFile(category, file)`, `loadAssetsIndex`/`saveAssetsIndex`, `saveVerifiedThumb(comp, pngFile)` (all on `$.global` at call time).
- Produces: `addShapeFromSelection(libraryPath, categoryName) -> '{"ok":true,"name":"...","count":N,"skipped":M,"thumbOk":bool}' | jerr(...)`; `shapeThumbSidecarName(aepFileName) -> '.thumb_<aepFileName>.png'` in assets.jsx.

- [ ] **Step 1: Write the failing tests**

Append to `tests/shapes.jsx.test.js`. The mock project needs to simulate the stash dance: `save()` (no arg = persist), `save(file)` (retarget), `items.addComp`, item lookup by id, `reduceProject`.

```js
// ---- addShapeFromSelection --------------------------------------------------

function makeCaptureWorld(opts) {
  const calls = [];
  const srcLayers = (opts && opts.layers) || [
    shapeLayer('Star', { index: 1, startTime: 2, outPoint: 5 }),
    shapeLayer('Blob', { index: 2, startTime: 3, outPoint: 6 }),
  ];
  const srcComp = new CompItem();
  Object.assign(srcComp, {
    id: 77, width: 1920, height: 1080, pixelAspect: 1, frameRate: 30,
    selectedLayers: srcLayers.filter((l) => l.selected !== false),
    layer(i) { return srcLayers[i - 1]; },
    get numLayers() { return srcLayers.length; },
  });
  srcLayers.forEach((l) => {
    l.copyToComp = function (target) { target._copied.push(this); calls.push('copy:' + this.name); };
  });

  const project = {
    activeItem: srcComp,
    file: { exists: true, fsName: '/proj/my.aep' },
    numItems: 1,
    item(i) { return srcComp; },
    items: {
      addComp(name, w, h, pa, dur, fr) {
        const c = new CompItem();
        const copied = [];
        Object.assign(c, {
          _copied: copied, name, width: w, height: h, duration: dur, frameRate: fr,
          layer(i) { return copied[copied.length - i]; }, // copyToComp inserts at TOP
          get numLayers() { return copied.length; },
        });
        calls.push('addComp');
        world.tempComp = c;
        return c;
      },
    },
    save(file) { calls.push(file ? 'saveAs' : 'save'); },
    reduceProject(items) { calls.push('reduce:' + items.length); },
  };

  const world = {
    calls,
    project,
    srcComp,
    tempComp: null,
    copiedTemps: [],
    reopened: [],
    removedFiles: [],
    thumbSaved: [],
  };
  return world;
}

function loadShapesForCapture(world) {
  return loadShapesJsx(world.project, (context) => {
    context.app = {
      project: world.project,
      open(file) { world.reopened.push(file.fsName); },
      beginUndoGroup(name) { world.calls.push('beginUndo:' + name); },
      endUndoGroup() { world.calls.push('endUndo'); },
    };
    context.Folder = function Folder(p) {
      this.fsName = String(p);
      this.exists = true;
      this.create = () => true;
    };
    context.Folder.temp = { fsName: '/tmp' };
    context.File = function File(p) {
      this.fsName = String(p);
      this.name = String(p).slice(String(p).lastIndexOf('/') + 1);
      this.exists = /dropcomp_shape_/.test(p); // temp aep "exists" for cleanup+copy
      this.copy = (target) => { world.copiedTemps.push(target.fsName || String(target)); return true; };
      this.remove = () => { world.removedFiles.push(this.fsName); return true; };
    };
    context.Date = Date;
    context.uniqueAssetTarget = (catFolder, fileName) =>
      new context.File(catFolder.fsName + '/' + fileName);
    context.assetEntryFromFile = (category, file) => ({
      name: file.name.replace(/\.aep$/i, ''), category,
      uniqueId: category + '/' + file.name, filePath: file.fsName, ext: 'aep',
      sizeBytes: 0, addedAt: 0,
    });
    context.loadAssetsIndex = () => [];
    context.saveAssetsIndex = (lib, assets) => { world.savedIndex = assets; return true; };
    context.saveVerifiedThumb = (comp, png) => { world.thumbSaved.push(png.fsName); return true; };
    context.shapeThumbSidecarName = (aepName) => '.thumb_' + aepName + '.png';
  });
}

test('addShapeFromSelection runs the stash dance in order', () => {
  const world = makeCaptureWorld();
  const g = loadShapesForCapture(world);
  const r = JSON.parse(g.addShapeFromSelection('/Library', 'Shapes'));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.count, 2);
  assert.equal(r.name, 'Star');
  // persist user edits BEFORE retargeting to the temp file
  const saveIdx = world.calls.indexOf('save');
  const saveAsIdx = world.calls.indexOf('saveAs');
  const reduceIdx = world.calls.indexOf('reduce:1');
  assert.ok(saveIdx !== -1 && saveIdx < saveAsIdx, 'save() must precede save(tempAEP)');
  assert.ok(reduceIdx > saveAsIdx, 'reduceProject happens in the temp project');
  // the original project is reopened and the temp file removed
  assert.deepEqual(world.reopened, ['/proj/my.aep']);
  assert.equal(world.removedFiles.some((f) => /dropcomp_shape_/.test(f)), true);
  // the final aep lands in the Assets category folder
  assert.equal(world.copiedTemps.some((f) => f === '/Library/Assets/Shapes/Star.aep'), true);
});

test('addShapeFromSelection preserves stacking order (bottom-to-top copy)', () => {
  const world = makeCaptureWorld();
  const g = loadShapesForCapture(world);
  g.addShapeFromSelection('/Library', 'Shapes');
  // Blob (index 2, lower) copied first so Star ends on top
  const copyCalls = world.calls.filter((c) => c.indexOf('copy:') === 0);
  assert.deepEqual(copyCalls, ['copy:Blob', 'copy:Star']);
});

test('addShapeFromSelection rebases layer times so the earliest starts at 0', () => {
  const world = makeCaptureWorld();
  const g = loadShapesForCapture(world);
  g.addShapeFromSelection('/Library', 'Shapes');
  const starts = world.tempComp._copied.map((l) => l.startTime).sort((a, b) => a - b);
  assert.equal(starts[0], 0, 'earliest copied layer starts at 0');
  assert.equal(starts[1], 1, 'relative offset (3-2=1) is preserved');
});

test('addShapeFromSelection writes the thumbnail sidecar next to the aep', () => {
  const world = makeCaptureWorld();
  const g = loadShapesForCapture(world);
  g.addShapeFromSelection('/Library', 'Shapes');
  assert.deepEqual(world.thumbSaved, ['/Library/Assets/Shapes/.thumb_Star.aep.png']);
});

test('addShapeFromSelection reopens the original project even when capture throws', () => {
  const world = makeCaptureWorld();
  world.project.reduceProject = () => { throw new Error('boom'); };
  const g = loadShapesForCapture(world);
  const r = JSON.parse(g.addShapeFromSelection('/Library', 'Shapes'));
  assert.equal(r.ok, false);
  assert.deepEqual(world.reopened, ['/proj/my.aep'], 'finally must reopen the original');
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test tests/shapes.jsx.test.js`
Expected: FAIL — `addShapeFromSelection is not a function`.

- [ ] **Step 3: Add `shapeThumbSidecarName` to jsx/assets.jsx**

After `getAssetsIndexFile` (around `jsx/assets.jsx:24`), add:

```jsx
// Shape assets (.aep) carry a rendered PNG thumbnail as a dot-file sidecar.
// Dot-files are skipped by assetEntryFromFile, so sidecars are never indexed.
function shapeThumbSidecarName(aepFileName) {
    return '.thumb_' + aepFileName + '.png';
}
```

And in the exports block: `$.global.shapeThumbSidecarName = shapeThumbSidecarName;`

- [ ] **Step 4: Implement addShapeFromSelection in jsx/shapes.jsx**

```jsx
// Captures the selected shape layers into a self-contained .aep in
// Assets/<category>/ plus a PNG thumbnail sidecar. Rides the Library stash
// dance: save -> save-as-temp -> copy layers into a throwaway comp ->
// reduceProject -> save -> copy out -> reopen the original (in finally).
function addShapeFromSelection(libraryPath, categoryName) {
    var originalProjectFile = app.project ? app.project.file : null;
    var tempAEP = null;
    var movedAway = false;
    var undoing = false;
    var sidecarFile = null;
    var wrote = false;
    try {
        if (!app.project) return jerr('Please open a project first.');
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return jerr('Select shape layers in an open composition first.');
        }
        if (!originalProjectFile) return jerr('Save your project once before saving shapes.');
        var shapes = selectedShapeLayers(comp);
        if (!shapes.length) return jerr('Select one or more shape layers first.');
        var skipped = comp.selectedLayers.length - shapes.length;
        var displayName = shapes[0].name;
        var srcCompId = comp.id;

        // record indices now: layer objects may not survive the save dance,
        // but indices are stable while the project stays open
        var indices = [];
        for (var i = 0; i < shapes.length; i++) indices.push(shapes[i].index);
        indices.sort(function (a, b) { return a - b; });

        var root = new Folder(libraryPath + '/Assets');
        if (!root.exists && !root.create()) return jerr('Could not create the Assets folder.');
        var catFolder = new Folder(root.fsName + '/' + categoryName);
        if (!catFolder.exists && !catFolder.create()) return jerr('Could not create the category folder.');

        var finalAep = uniqueAssetTarget(catFolder, safeNameJsx(displayName) + '.aep');
        if (!finalAep) return jerr('Could not find a free file name.');
        var finalAepName = decodeURI(finalAep.name);

        // The finally block reopens originalProjectFile from disk, so any
        // edits made since the user's last manual save must be persisted first.
        app.project.save();

        var ts = new Date().getTime();
        app.beginUndoGroup('DropComp Save Shape');
        undoing = true;
        tempAEP = new File(Folder.temp.fsName + '/dropcomp_shape_' + ts + '.aep');
        app.project.save(tempAEP);
        movedAway = true;

        var srcComp = null;
        for (var k = 1; k <= app.project.numItems; k++) {
            if (app.project.item(k).id === srcCompId) { srcComp = app.project.item(k); break; }
        }
        if (!srcComp) throw new Error('Could not find the composition in the temp project.');

        var shapeComp = app.project.items.addComp(displayName, srcComp.width, srcComp.height,
            srcComp.pixelAspect, 1, srcComp.frameRate);
        // copyToComp inserts at the TOP: copy bottom-most first (highest index)
        // so the original stacking order survives
        for (i = indices.length - 1; i >= 0; i--) {
            srcComp.layer(indices[i]).copyToComp(shapeComp);
        }
        // rebase so the earliest layer starts at 0 (import shifts to playhead)
        var minStart = null;
        var maxOut = 1;
        for (i = 1; i <= shapeComp.numLayers; i++) {
            var st = shapeComp.layer(i).startTime;
            if (minStart === null || st < minStart) minStart = st;
        }
        for (i = 1; i <= shapeComp.numLayers; i++) {
            var ly = shapeComp.layer(i);
            ly.startTime = ly.startTime - minStart;
            if (ly.outPoint - minStart > maxOut) maxOut = ly.outPoint - minStart;
        }
        shapeComp.duration = maxOut;

        sidecarFile = new File(catFolder.fsName + '/' + shapeThumbSidecarName(finalAepName));
        var thumbOk = saveVerifiedThumb(shapeComp, sidecarFile);

        app.project.reduceProject([shapeComp]);
        app.project.save(tempAEP);
        if (!tempAEP.copy(finalAep)) {
            throw new Error('Could not copy the shape project into the library.');
        }
        app.endUndoGroup();
        undoing = false;
        wrote = true;

        var assets = loadAssetsIndex(libraryPath) || [];
        var entry = assetEntryFromFile(categoryName, new File(finalAep.fsName));
        if (entry) {
            entry.addedAt = ts;
            for (var x = assets.length - 1; x >= 0; x--) {
                if (assets[x].uniqueId === entry.uniqueId) assets.splice(x, 1);
            }
            assets.push(entry);
        }
        saveAssetsIndex(libraryPath, assets);

        return '{"ok":true,"name":"' + jsonEscape(displayName) + '","count":' + shapes.length +
            ',"skipped":' + skipped + ',"thumbOk":' + (thumbOk ? 'true' : 'false') + '}';
    } catch (e) {
        try { if (undoing) app.endUndoGroup(); } catch (e2) { }
        // a failed capture must not leave an orphan sidecar behind
        try { if (!wrote && sidecarFile && sidecarFile.exists) sidecarFile.remove(); } catch (e3) { }
        return jerr(e.toString());
    } finally {
        if (movedAway && originalProjectFile && originalProjectFile.exists) {
            app.open(originalProjectFile);
        }
        if (tempAEP && tempAEP.exists) tempAEP.remove();
    }
}
```

Add to exports: `$.global.addShapeFromSelection = addShapeFromSelection;`

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add jsx/shapes.jsx jsx/assets.jsx tests/shapes.jsx.test.js
git commit -m "feat(shapes): capture selected shape layers into the Assets folder

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `importShapeAsset` + `importAsset` routing

**Files:**
- Modify: `jsx/shapes.jsx`
- Modify: `jsx/assets.jsx:238` (importAsset branches on ext)
- Test: `tests/shapes.jsx.test.js` (extend), `tests/undo-groups.test.js` (extend)

**Interfaces:**
- Consumes: `collectComps(folderItem, out)`, `aepPreflight(path)` (both `$.global` at call time), `isShapeLayer` (Task 1).
- Produces: `importShapeAsset(filePath) -> 'Success: ...' | 'Error: ...'` (text protocol). `importAsset` (assets.jsx) delegates to it when `assetExt(filePath) === 'aep'`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/shapes.jsx.test.js`:

```js
// ---- importShapeAsset -------------------------------------------------------

function makeImportWorld(opts) {
  const calls = [];
  const activeLayers = []; // index 1 = top
  const activeComp = new CompItem();
  Object.assign(activeComp, {
    name: 'Main', time: 4,
    layer(i) { return activeLayers[i - 1]; },
    get numLayers() { return activeLayers.length; },
  });

  const srcLayers = (opts && opts.srcLayers) || [
    shapeLayer('Star', { startTime: 0, outPoint: 3 }),
    shapeLayer('Blob', { startTime: 1, outPoint: 4 }),
  ];
  srcLayers.forEach((l) => {
    l.copyToComp = function (target) {
      const copy = Object.assign({}, this, { selected: false });
      activeLayers.unshift(copy); // copyToComp inserts at TOP
      calls.push('copy:' + this.name);
    };
  });
  const srcComp = new CompItem();
  Object.assign(srcComp, {
    name: 'Star',
    layer(i) { return srcLayers[i - 1]; },
    get numLayers() { return srcLayers.length; },
  });

  const importedFolder = new FolderItem();
  importedFolder.remove = () => { calls.push('removeImported'); };

  const project = {
    activeItem: activeComp,
    importFile() { calls.push('importFile'); return importedFolder; },
  };
  const world = { calls, activeComp, activeLayers, srcComp, project };
  world.load = () => loadShapesJsx(project, (context) => {
    context.app = {
      project,
      beginSuppressDialogs() { calls.push('suppressOn'); },
      endSuppressDialogs() { calls.push('suppressOff'); },
      beginUndoGroup(n) { calls.push('beginUndo'); },
      endUndoGroup() { calls.push('endUndo'); },
    };
    context.File = function File(p) {
      this.fsName = String(p);
      this.name = String(p).slice(String(p).lastIndexOf('/') + 1);
      this.exists = true;
    };
    context.collectComps = (folder, out) => { out.push(world.srcComp); };
    context.aepPreflight = () => ({ reason: 'ok', message: '' });
  });
  return world;
}

test('importShapeAsset copies shapes to the active comp at the playhead', () => {
  const world = makeImportWorld();
  const g = world.load();
  const result = g.importShapeAsset('/Library/Assets/Shapes/Star.aep');
  assert.match(result, /^Success:/, result);
  assert.equal(world.activeLayers.length, 2);
  // bottom-to-top copy preserves stacking: Star on top
  assert.equal(world.activeLayers[0].name, 'Star');
  // earliest startTime (0) lands at the playhead (4); offsets preserved
  const starts = world.activeLayers.map((l) => l.startTime).sort((a, b) => a - b);
  assert.deepEqual(starts, [4, 5]);
  // copied layers are selected
  assert.equal(world.activeLayers.every((l) => l.selected), true);
  // imported project items are cleaned out of the bin
  assert.ok(world.calls.includes('removeImported'));
});

test('importShapeAsset imports OUTSIDE the undo group', () => {
  const world = makeImportWorld();
  const g = world.load();
  g.importShapeAsset('/x/Star.aep');
  assert.ok(world.calls.indexOf('importFile') < world.calls.indexOf('beginUndo'),
    'project import must precede beginUndoGroup');
});

test('importShapeAsset requires an active comp', () => {
  const world = makeImportWorld();
  world.project.activeItem = null;
  const g = world.load();
  assert.match(g.importShapeAsset('/x/Star.aep'), /^Error: Open a composition/);
});

test('importShapeAsset skips non-shape layers and reports the count', () => {
  const world = makeImportWorld({
    srcLayers: [shapeLayer('Star', { startTime: 0, outPoint: 3 }), textLayer('Note')],
  });
  const g = world.load();
  const result = g.importShapeAsset('/x/Star.aep');
  assert.match(result, /^Success:/);
  assert.match(result, /Skipped 1 non-shape layer/);
  assert.equal(world.activeLayers.length, 1);
});

test('importShapeAsset errors when the asset holds no shape layers', () => {
  const world = makeImportWorld({ srcLayers: [textLayer('Note')] });
  const g = world.load();
  assert.match(g.importShapeAsset('/x/Star.aep'), /^Error: No shape layers found/);
  assert.ok(world.calls.includes('removeImported'), 'cleanup still runs');
});
```

Append to `tests/undo-groups.test.js` (uses its existing `sectionBetween` helper; add `const shapesSrc = fs.readFileSync(path.join(__dirname, '..', 'jsx', 'shapes.jsx'), 'utf8');` next to the other reads):

```js
test('importShapeAsset keeps project import outside the explicit undo group', () => {
  const body = sectionBetween(shapesSrc, 'function importShapeAsset', '// ---- exports');
  const importIndex = body.indexOf('app.project.importFile(new ImportOptions(f))');
  const undoIndex = body.indexOf("app.beginUndoGroup('DropComp Import Shape')");
  assert.notEqual(importIndex, -1, 'importShapeAsset should import the AEP project');
  assert.notEqual(undoIndex, -1, 'importShapeAsset should group its edits');
  assert.ok(importIndex < undoIndex, 'AE project import must happen before the explicit undo group');
});

test('importShapeAsset closes the undo group on the error path', () => {
  const body = sectionBetween(shapesSrc, 'function importShapeAsset', '// ---- exports');
  const catchBody = body.slice(body.lastIndexOf('} catch (e) {'));
  assert.match(catchBody, /if \(undoing\) app\.endUndoGroup\(\)/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/shapes.jsx.test.js tests/undo-groups.test.js`
Expected: FAIL — `importShapeAsset is not a function` / section not found.

- [ ] **Step 3: Implement importShapeAsset in jsx/shapes.jsx**

Insert BEFORE the exports block (the undo-groups test slices up to `// ---- exports`):

```jsx
// Pastes a saved shape asset's layers into the active comp as editable shape
// layers, then removes the imported project items (shape layers carry no
// external footage, so removal is safe). Text protocol mirrors importAsset.
function importShapeAsset(filePath) {
    var suppressing = false;
    var undoing = false;
    var importedFolder = null;
    try {
        if (!app.project) return 'Error: Please open a project first.';
        var activeComp = app.project.activeItem;
        if (!activeComp || !(activeComp instanceof CompItem)) {
            return 'Error: Open a composition first to import a shape.';
        }
        var f = new File(filePath);
        if (!f.exists) return 'Error: Asset file not found.';
        // advisory preflight: block definitive junk, explain version mismatches
        var pf = aepPreflight(f.fsName);
        if (pf.reason === 'missing' || pf.reason === 'not-aep') return 'Error: ' + pf.message;

        app.beginSuppressDialogs();
        suppressing = true;
        // AE project import can corrupt the undo stack inside an explicit
        // group - import first, then group DropComp's edits (mirrors importComp)
        importedFolder = app.project.importFile(new ImportOptions(f));
        app.beginUndoGroup('DropComp Import Shape');
        undoing = true;

        var comps = [];
        collectComps(importedFolder, comps);
        var srcComp = comps.length ? comps[0] : null;
        var copied = 0;
        var skipped = 0;
        if (srcComp) {
            // copyToComp inserts at the TOP: walk bottom-up so stacking survives
            for (var i = srcComp.numLayers; i >= 1; i--) {
                if (isShapeLayer(srcComp.layer(i))) {
                    srcComp.layer(i).copyToComp(activeComp);
                    copied++;
                } else {
                    skipped++;
                }
            }
        }
        if (!copied) {
            importedFolder.remove();
            importedFolder = null;
            app.endUndoGroup();
            undoing = false;
            app.endSuppressDialogs(false);
            suppressing = false;
            return 'Error: No shape layers found in this asset.';
        }

        // the copied layers occupy indices 1..copied (each insert lands on top)
        var minStart = null;
        for (i = 1; i <= copied; i++) {
            var st = activeComp.layer(i).startTime;
            if (minStart === null || st < minStart) minStart = st;
        }
        var shift = activeComp.time - minStart;
        for (i = 1; i <= copied; i++) {
            activeComp.layer(i).startTime = activeComp.layer(i).startTime + shift;
        }
        for (i = 1; i <= activeComp.numLayers; i++) {
            activeComp.layer(i).selected = (i <= copied);
        }

        importedFolder.remove();
        importedFolder = null;
        app.endUndoGroup();
        undoing = false;
        app.endSuppressDialogs(false);
        suppressing = false;

        var assetName = decodeURI(f.name).replace(/\.aep$/i, '');
        return "Success: '" + assetName + "' added to '" + activeComp.name + "'." +
            (skipped ? ' Skipped ' + skipped + ' non-shape layer' + (skipped === 1 ? '' : 's') + '.' : '');
    } catch (e) {
        try { if (importedFolder) importedFolder.remove(); } catch (e2) { }
        try { if (undoing) app.endUndoGroup(); } catch (e3) { }
        try { if (suppressing) app.endSuppressDialogs(false); } catch (e4) { }
        return 'Error: ' + e.toString();
    }
}
```

Add export: `$.global.importShapeAsset = importShapeAsset;`

- [ ] **Step 4: Route .aep assets in jsx/assets.jsx importAsset**

At the top of `importAsset` (jsx/assets.jsx:238), after the function opens:

```jsx
function importAsset(filePath) {
    // shape assets (.aep) paste editable layers instead of importing footage
    if (assetExt(filePath) === 'aep') return importShapeAsset(filePath);
    var suppressing = false;
    ...
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS. (`assets.svg.test.js` and others load assets.jsx in vm contexts without `importShapeAsset` — the branch only resolves the global at call time with an `.aep` path, so existing tests are unaffected.)

- [ ] **Step 6: Commit**

```bash
git add jsx/shapes.jsx jsx/assets.jsx tests/shapes.jsx.test.js tests/undo-groups.test.js
git commit -m "feat(shapes): paste shape assets into the active comp on import

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: assets.jsx index support — ext, sidecar probe, rename/delete

**Files:**
- Modify: `jsx/assets.jsx:7` (DC_ASSET_EXTS), `assetEntryFromFile`, `renameAsset`, `deleteAsset`
- Test: `tests/assets.shape-sidecar.test.js` (new)

**Interfaces:**
- Consumes: `shapeThumbSidecarName` (Task 2).
- Produces: asset entries with optional `thumbPath` (string) when `ext === 'aep'` and the sidecar exists; rename/delete keep the sidecar in sync.

- [ ] **Step 1: Write the failing tests**

Create `tests/assets.shape-sidecar.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// File/Folder mocks backed by a path registry so exists/rename/remove behave
function loadAssetsJsx(diskPaths, hooks) {
  const disk = new Set(diskPaths || []);
  const ops = { renamed: [], removed: [] };
  function File(p) {
    this.fsName = String(p);
    this.parent = { fsName: String(p).slice(0, String(p).lastIndexOf('/')) };
    this.name = String(p).slice(String(p).lastIndexOf('/') + 1);
    this.exists = disk.has(this.fsName);
    this.length = 0;
    this.modified = null;
    this.rename = (newName) => {
      ops.renamed.push([this.fsName, newName]);
      disk.delete(this.fsName);
      disk.add(this.parent.fsName + '/' + newName);
      return true;
    };
    this.remove = () => { ops.removed.push(this.fsName); disk.delete(this.fsName); return true; };
  }
  function Folder(p) {
    this.fsName = String(p);
    this.exists = true;
  }
  const context = {
    $: { global: {} },
    app: {},
    File, Folder,
    CompItem: function () {}, FootageItem: function () {}, FolderItem: function () {},
    ImportOptions: function () {},
    jerr(m) { return JSON.stringify({ ok: false, error: m }); },
    jsonEscape(v) { return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); },
    readJson() { return (hooks && hooks.index) ? { version: 1, assets: hooks.index } : null; },
    writeJson(file, obj) { if (hooks) hooks.written = obj; return true; },
    JSON, Math, Date,
    decodeURI: (s) => s,
  };
  vm.createContext(context);
  vm.runInContext(read('jsx/assets.jsx'), context, { filename: 'assets.jsx' });
  return { g: context.$.global, ops, disk, File };
}

test('aep files are supported assets', () => {
  const { g } = loadAssetsJsx();
  assert.equal(g.isSupportedAsset('Star.aep'), true);
});

test('assetEntryFromFile attaches thumbPath when the sidecar exists', () => {
  const { g, File } = loadAssetsJsx(['/L/Assets/Shapes/.thumb_Star.aep.png']);
  const entry = g.assetEntryFromFile('Shapes', new File('/L/Assets/Shapes/Star.aep'));
  assert.equal(entry.ext, 'aep');
  assert.equal(entry.thumbPath, '/L/Assets/Shapes/.thumb_Star.aep.png');
});

test('assetEntryFromFile leaves thumbPath unset without a sidecar', () => {
  const { g, File } = loadAssetsJsx();
  const entry = g.assetEntryFromFile('Shapes', new File('/L/Assets/Shapes/Star.aep'));
  assert.equal(entry.thumbPath, undefined);
});

test('renameAsset renames the sidecar with the aep', () => {
  const idx = [{ uniqueId: 'Shapes/Star.aep', name: 'Star', category: 'Shapes',
    filePath: '/L/Assets/Shapes/Star.aep', ext: 'aep' }];
  const hooks = { index: idx };
  const { g, ops } = loadAssetsJsx(
    ['/L/Assets/Shapes/Star.aep', '/L/Assets/Shapes/.thumb_Star.aep.png'], hooks);
  const r = JSON.parse(g.renameAsset('/L', 'Shapes', 'Star.aep', 'Nova'));
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(ops.renamed, [
    ['/L/Assets/Shapes/Star.aep', 'Nova.aep'],
    ['/L/Assets/Shapes/.thumb_Star.aep.png', '.thumb_Nova.aep.png'],
  ]);
  // index entry keeps a live thumbPath
  const patched = hooks.written.assets[0];
  assert.equal(patched.thumbPath, '/L/Assets/Shapes/.thumb_Nova.aep.png');
});

test('deleteAsset removes the sidecar with the aep', () => {
  const { g, ops } = loadAssetsJsx(
    ['/L/Assets/Shapes/Star.aep', '/L/Assets/Shapes/.thumb_Star.aep.png'],
    { index: [] });
  const r = JSON.parse(g.deleteAsset('/L', 'Shapes', 'Star.aep'));
  assert.equal(r.ok, true, r.error);
  assert.ok(ops.removed.includes('/L/Assets/Shapes/Star.aep'));
  assert.ok(ops.removed.includes('/L/Assets/Shapes/.thumb_Star.aep.png'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/assets.shape-sidecar.test.js`
Expected: FAIL — `isSupportedAsset('Star.aep')` is false.

- [ ] **Step 3: Implement in jsx/assets.jsx**

Line 7 — add aep:

```jsx
var DC_ASSET_EXTS = { png: 1, jpg: 1, jpeg: 1, gif: 1, bmp: 1, tif: 1, tiff: 1, tga: 1, psd: 1, ai: 1, eps: 1, svg: 1, aep: 1 };
```

`assetEntryFromFile` — probe the sidecar before returning:

```jsx
function assetEntryFromFile(categoryName, file) {
    var fileName = decodeURI(file.name);
    if (fileName.charAt(0) === '.') return null;
    if (!isSupportedAsset(fileName)) return null;
    var entry = {
        name: fileName.replace(/\.[a-z0-9]+$/i, ''),
        category: categoryName,
        uniqueId: categoryName + '/' + fileName,
        filePath: file.fsName,
        ext: assetExt(fileName),
        sizeBytes: file.length,
        addedAt: file.modified ? file.modified.getTime() : 0
    };
    if (entry.ext === 'aep') {
        var thumb = new File(file.parent.fsName + '/' + shapeThumbSidecarName(fileName));
        if (thumb.exists) entry.thumbPath = thumb.fsName;
    }
    return entry;
}
```

`renameAsset` — after the `file.rename(newFileName)` success block (jsx/assets.jsx:167), add:

```jsx
        // shape assets carry a thumbnail sidecar that must follow the rename
        if (ext === 'aep' && newFileName !== fileName) {
            var oldThumb = new File(catFolder.fsName + '/' + shapeThumbSidecarName(fileName));
            if (oldThumb.exists) oldThumb.rename(shapeThumbSidecarName(newFileName));
        }
```

And in the index-patch loop, refresh thumbPath alongside filePath:

```jsx
                assets[i].filePath = new File(catFolder.fsName + '/' + newFileName).fsName;
                var newThumb = new File(catFolder.fsName + '/' + shapeThumbSidecarName(newFileName));
                if (newThumb.exists) assets[i].thumbPath = newThumb.fsName;
                else delete assets[i].thumbPath;
```

`deleteAsset` — after the file removal, before the index rewrite:

```jsx
        var sidecar = new File(libraryPath + '/Assets/' + category + '/' + shapeThumbSidecarName(fileName));
        if (sidecar.exists) sidecar.remove();
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS. Watch `assets.validation.parity.test.js` and `assets.svg.test.js` — they load assets.jsx in vm contexts; the new `shapeThumbSidecarName` is defined inside assets.jsx itself so no mock changes are needed. If a context lacks `File.parent`, fix the TEST mock, not the code (`file.parent` is a real ExtendScript File property).

- [ ] **Step 5: Commit**

```bash
git add jsx/assets.jsx tests/assets.shape-sidecar.test.js
git commit -m "feat(assets): index aep shape assets with thumbnail sidecars

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Panel flow — Add Shape button, modal routing, broadcast

**Files:**
- Modify: `panel/js/assets.js` (addShapeFlow, confirmShapeCategory, clearPending)
- Modify: `panel/js/shell.js:193-204` (confirmCategoryModal routes 'addShape')
- Modify: `panel/js/main.js:39,92` (grab + wire the button)
- Modify: `panel/index.html:90-92` (button markup, after add-selected-image-btn)
- Modify: `panel/css/style.css:308-314` (visibility rules)
- Test: `tests/assets.add-shape.test.js` (new)

**Interfaces:**
- Consumes: host `getShapeSelectionInfo` (Task 1), `addShapeFromSelection` (Task 2), existing `DCUI.openCategoryModal(mode, title, categories)` / `DCUI.categoryModalMode()`.
- Produces: `DCAssets.addShapeFlow()`, `DCAssets.confirmShapeCategory(name)` (called from shell's `confirmCategoryModal` when mode is `'addShape'`).

- [ ] **Step 1: Write the failing tests**

Create `tests/assets.add-shape.test.js` (mirrors the mock style of `sync.broadcast.test.js` for behavior plus `assets.add-selected.test.js` for wiring):

```js
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

test('shell routes the addShape modal mode to DCAssets', () => {
  const shellJs = read('panel/js/shell.js');
  assert.match(shellJs, /mode === 'addShape'/, 'shell recognises the addShape mode');
  assert.match(shellJs, /DCAssets\.confirmShapeCategory/, 'shell dispatches to confirmShapeCategory');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/assets.add-shape.test.js`
Expected: FAIL — `DCAssets.addShapeFlow is not a function`.

- [ ] **Step 3: Implement panel/js/assets.js**

Add state var next to `pendingPaths` (line 6): `var pendingShape = null;`

Add after `addSelectedFlow()` (line 218):

```js
  // Saves the selected AE shape layers as a reusable asset. The host validates
  // the selection up front so the user gets a specific error before the modal.
  function addShapeFlow() {
    DCBridge.call('getShapeSelectionInfo', [], function (result) {
      var r = DCBridge.parseJson(result);
      if (!r) { DCUI.toast('Error: unexpected response.', true); return; }
      if (!r.ok) { DCUI.toast(r.error, true, 6000); return; }
      pendingShape = r;
      DCUI.openCategoryModal('addShape', 'Save Shape to Assets', categories());
    });
  }

  function confirmShapeCategory(categoryName) {
    if (!pendingShape) { DCUI.closeModal(els().categoryModal); return; }
    if (!DCBridge.acquire('saving shape')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
    DCUI.closeModal(els().categoryModal);
    DCUI.spinner(true);
    pendingShape = null;
    DCBridge.call('addShapeFromSelection', [libPath(), categoryName], function (result) {
      DCUI.spinner(false);
      DCBridge.release();
      var r = DCBridge.parseJson(result);
      if (r && r.ok) {
        var msg = '"' + r.name + '" saved (' + r.count + ' layer' + (r.count === 1 ? '' : 's') + ').';
        if (r.skipped) msg += ' Skipped ' + r.skipped + ' non-shape layer' + (r.skipped === 1 ? '' : 's') + '.';
        DCUI.toast(msg, false, r.skipped ? 6000 : 3000);
        loadAndBroadcast();
      } else {
        DCUI.toast((r && r.error) || result, true);
      }
    });
  }
```

Update `clearPending` (line 367): add `pendingShape = null;`

Extend the return block (line 376): `addShapeFlow: addShapeFlow, confirmShapeCategory: confirmShapeCategory,`

- [ ] **Step 4: Route the modal mode in panel/js/shell.js**

Replace lines 198-203:

```js
    // asset-tab flows may reuse the name "assets"; only library categories
    // collide with the reserved top-level Assets folder
    var isAssetsFlow = mode === 'addAssets' || mode === 'addShape';
    if (!isAssetsFlow && v.name.toLowerCase() === 'assets') {
      DCUI.toast('"Assets" is reserved for the Assets tab.', true);
      return;
    }
    if (mode === 'addAssets' && hasAssets()) DCAssets.confirmCategory(v.name);
    else if (mode === 'addShape' && hasAssets()) DCAssets.confirmShapeCategory(v.name);
    else DCLibrary.confirmCategory(mode, v.name);
```

- [ ] **Step 5: Button markup, main.js wiring, CSS**

`panel/index.html` — insert after the `add-selected-image-btn` button (line 92):

```html
      <button id="add-shape-btn" class="btn-dark icon-btn" data-tip="Save selected shape layers to Assets" aria-label="Save selected shape layers to Assets">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="7.5" cy="7.5" r="3.5"></circle><rect x="13" y="13" width="8" height="8" rx="1"></rect><path d="M16.5 3l4.33 7.5h-8.66z"></path></svg>
      </button>
```

`panel/js/main.js` — next to `addSelectedImageBtn` (line 39): `addShapeBtn: $('add-shape-btn'),`
Next to the addSelectedFlow listener (line 92):

```js
  if (els.addShapeBtn) els.addShapeBtn.addEventListener('click', DCAssets.addShapeFlow);
```

`panel/css/style.css` — extend the assets-tab visibility block (lines 308-314):

```css
#add-shape-btn { display: none; }
#app.assets-active #add-shape-btn { display: inline-flex; }
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS (including `toolbar-css.test.js` and `panel-mode-wiring.test.js` — if either asserts an exhaustive button list, add `add-shape-btn` there and re-run).

- [ ] **Step 7: Commit**

```bash
git add panel/js/assets.js panel/js/shell.js panel/js/main.js panel/index.html panel/css/style.css tests/assets.add-shape.test.js
git commit -m "feat(panel): add Save Shape flow to the Assets toolbar

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Rendering — shape thumbnails and SHAPE badge

**Files:**
- Modify: `panel/js/render.js:98-119,160-175` (buildAssetCard + buildRow)
- Modify: `panel/js/state.js:34-40` (formatAssetMetaLine)
- Test: `tests/render.asset-preview.test.js` (extend), `tests/state.assets.test.js` (extend)

**Interfaces:**
- Consumes: asset entries with `ext === 'aep'` and optional `thumbPath` (Task 4).
- Produces: cards render the sidecar PNG (cache-busted by `addedAt`) or a `SHAPE` badge; meta line reads `SHAPE · <size>`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/render.asset-preview.test.js` (reuse its `makeNode`/`prefs`/`assetGroups`/`findByTag` helpers; follow the file's existing test style for locating `img` nodes and placeholder badges):

```js
test('aep shape assets render their thumbnail sidecar when present', () => {
  const container = makeNode('div');
  DCRender.render(container, assetGroups({
    uniqueId: 'Shapes/Star.aep', category: 'Shapes', name: 'Star',
    ext: 'aep', filePath: '/L/Assets/Shapes/Star.aep',
    thumbPath: '/L/Assets/Shapes/.thumb_Star.aep.png', addedAt: 42,
  }), prefs(), {}, {}, 'empty', 'asset');
  const imgs = findByTag(container, 'IMG');
  assert.equal(imgs.length, 1);
  assert.match(imgs[0].src, /\.thumb_Star\.aep\.png\?t=42/);
});

test('aep shape assets without a thumbnail show a SHAPE badge', () => {
  const container = makeNode('div');
  DCRender.render(container, assetGroups({
    uniqueId: 'Shapes/Star.aep', category: 'Shapes', name: 'Star',
    ext: 'aep', filePath: '/L/Assets/Shapes/Star.aep',
  }), prefs(), {}, {}, 'empty', 'asset');
  const badges = findByTag(container, 'SPAN').filter((n) => n.className === 'ext-badge');
  assert.equal(badges.length, 1);
  assert.equal(badges[0].textContent, 'SHAPE');
});
```

Note: `findByTag` filters by `tagName`; `img.src` is a plain property on the mock node. If the file's helpers differ slightly (e.g. badge lookup helper already exists), match the local convention instead of the literal code above — the assertions stay the same.

Append to `tests/state.assets.test.js` (follow its local test style):

```js
test('formatAssetMetaLine labels aep assets as SHAPE', () => {
  assert.equal(DCState.formatAssetMetaLine({ ext: 'aep', sizeBytes: 0 }), 'SHAPE');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/render.asset-preview.test.js tests/state.assets.test.js`
Expected: FAIL — no img for aep (not in RENDERABLE_EXTS), badge says 'AEP', meta says 'AEP'.

- [ ] **Step 3: Implement in panel/js/render.js**

Add a helper next to `RENDERABLE_EXTS` (line 98):

```js
  // shape assets are .aep files - the badge should say what they ARE
  function assetBadgeText(ext) {
    return ext === 'aep' ? 'SHAPE' : String(ext || '?').toUpperCase();
  }

  // aep shape assets render their PNG sidecar; images render themselves
  function assetThumbSrc(asset) {
    if (RENDERABLE_EXTS[asset.ext]) return asset.filePath;
    if (asset.ext === 'aep' && asset.thumbPath) return asset.thumbPath;
    return null;
  }
```

`buildAssetCard` (lines 106-119) — replace the thumb branch:

```js
    var thumbWrap = el('div', 'card-thumb');
    var src = assetThumbSrc(asset);
    if (src) {
      var img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = '';
      // addedAt changes when the same filename is re-added, busting the stale cache
      img.src = thumbUrl(src, asset.addedAt || null);
      img.onerror = function () { showThumbFallback(img, asset.ext); };
      thumbWrap.appendChild(img);
    } else {
      var ph = el('div', 'thumb-placeholder');
      ph.appendChild(el('span', 'ext-badge', assetBadgeText(asset.ext)));
      thumbWrap.appendChild(ph);
    }
```

`buildRow` (lines 160-175) — same treatment for the asset branch:

```js
    var renderable = isAsset ? assetThumbSrc(item) : item.thumbPath;
    if (renderable) {
      var img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = '';
      img.src = thumbUrl(isAsset ? renderable : item.thumbPath,
        isAsset ? (item.addedAt || null) : bust);
      img.onerror = function () { showThumbFallback(img, isAsset ? item.ext : null); };
      thumbWrap.appendChild(img);
    } else {
      var ph = el('div', 'thumb-placeholder');
      if (isAsset) ph.appendChild(el('span', 'ext-badge', assetBadgeText(item.ext)));
      else ph.innerHTML = ICONS.photoOff;
      thumbWrap.appendChild(ph);
    }
```

`showThumbFallback` (line 25) — route the badge text through the helper:

```js
    if (ext) ph.appendChild(el('span', 'ext-badge', assetBadgeText(ext)));
```

(Move the `assetBadgeText`/`assetThumbSrc` definitions ABOVE `showThumbFallback` so they are in scope.)

- [ ] **Step 4: Implement in panel/js/state.js**

`formatAssetMetaLine` (line 34):

```js
  function formatAssetMetaLine(asset) {
    var parts = [];
    if (asset && asset.ext) parts.push(asset.ext === 'aep' ? 'SHAPE' : String(asset.ext).toUpperCase());
    var size = formatBytes(asset && asset.sizeBytes);
    if (size) parts.push(size);
    return parts.join(' · ');
  }
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add panel/js/render.js panel/js/state.js tests/render.asset-preview.test.js tests/state.assets.test.js
git commit -m "feat(render): show shape asset thumbnails and SHAPE badges

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Documentation + final verification

**Files:**
- Modify: `README.md` (Features / Assets section)
- Test: full suite + manual checklist doc

**Interfaces:** none (docs only).

- [ ] **Step 1: Document the feature in README.md**

Find the Assets bullet/section in Features (around lines 41-62) and add:

```markdown
- **Shape assets** — select shape layers in a comp and click *Save Shape*
  (Assets tab) to store them as a reusable asset with a rendered thumbnail.
  Importing pastes them back into the active comp at the playhead as fully
  editable shape layers (paths, keyframes, expressions intact). Requires the
  project to be saved once; the capture briefly saves and reopens your
  project, exactly like stashing a comp to the Library.
```

- [ ] **Step 2: Run the full suite one last time**

Run: `npm test`
Expected: PASS, zero failures.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): document shape assets

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Report the manual AE checklist**

Not automatable — surface to Ziscol at the end:

1. Save a single selected shape layer; card appears with a real thumbnail.
2. Save a multi-layer selection (include one text layer); toast reports the skip; stacking order preserved on re-import.
3. Import at a non-zero playhead: layers land at the playhead, selected, project bin has no leftover import folder.
4. One Cmd+Z after import removes the pasted layers cleanly (no "Undo group mismatch" warning).
5. Rename and delete a shape asset; thumbnail follows / disappears; second panel (multi-panel build) refreshes via sync.
6. Capture with an unsaved project shows the "save your project once" error before the modal opens.

## Plan Self-Review (completed)

- **Spec coverage:** storage layout (T2/T4), capture flow (T1/T2/T5), import flow (T3), index/rename/delete (T4), rendering (T6), module registration (T1), error table (T1/T2/T3), tests (every task), README (T7). No gaps.
- **Placeholder scan:** clean — every step carries real code/commands.
- **Type consistency:** `getShapeSelectionInfo` / `addShapeFromSelection` / `importShapeAsset` / `shapeThumbSidecarName` / `confirmShapeCategory` names match across tasks; JSON keys (`count`, `skipped`, `name`, `thumbOk`) consistent between jsx and panel.
