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
  });
  // NOT via Object.assign: it would bake the getter's value in at assign time
  Object.defineProperty(srcComp, 'numLayers', { get: () => srcLayers.length });
  srcLayers.forEach((l) => {
    l.copyToComp = function (target) {
      target._copied.unshift(Object.assign({}, this)); // copyToComp inserts at TOP
      calls.push('copy:' + this.name);
    };
  });

  const world = {
    calls,
    srcComp,
    tempComp: null,
    copiedTemps: [],
    reopened: [],
    removedFiles: [],
    thumbSaved: [],
    savedIndex: null,
  };

  world.project = {
    activeItem: srcComp,
    file: { exists: true, fsName: '/proj/my.aep' },
    numItems: 1,
    item() { return srcComp; },
    items: {
      addComp(name, w, h, pa, dur, fr) {
        const c = new CompItem();
        const copied = [];
        Object.assign(c, {
          _copied: copied, name, width: w, height: h, duration: dur, frameRate: fr,
          layer(i) { return copied[i - 1]; }, // index 1 = top
        });
        // NOT via Object.assign: it would bake the getter's value in at assign time
        Object.defineProperty(c, 'numLayers', { get: () => copied.length });
        calls.push('addComp');
        world.tempComp = c;
        return c;
      },
    },
    save(file) { calls.push(file ? 'saveAs' : 'save'); },
    reduceProject(items) { calls.push('reduce:' + items.length); },
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

test('addShapeFromSelection updates the assets index with the new entry', () => {
  const world = makeCaptureWorld();
  const g = loadShapesForCapture(world);
  g.addShapeFromSelection('/Library', 'Shapes');
  assert.ok(world.savedIndex, 'index must be saved');
  assert.equal(world.savedIndex.length, 1);
  assert.equal(world.savedIndex[0].uniqueId, 'Shapes/Star.aep');
  assert.ok(world.savedIndex[0].addedAt > 0, 'addedAt is stamped at capture time');
});

test('addShapeFromSelection reopens the original project even when capture throws', () => {
  const world = makeCaptureWorld();
  world.project.reduceProject = () => { throw new Error('boom'); };
  const g = loadShapesForCapture(world);
  const r = JSON.parse(g.addShapeFromSelection('/Library', 'Shapes'));
  assert.equal(r.ok, false);
  assert.deepEqual(world.reopened, ['/proj/my.aep'], 'finally must reopen the original');
});

// ---- importShapeAsset -------------------------------------------------------

function makeImportWorld(opts) {
  const calls = [];
  const activeLayers = []; // index 1 = top
  const activeComp = new CompItem();
  Object.assign(activeComp, {
    name: 'Main', time: 4,
    layer(i) { return activeLayers[i - 1]; },
  });
  Object.defineProperty(activeComp, 'numLayers', { get: () => activeLayers.length });

  const srcLayers = (opts && opts.srcLayers) || [
    shapeLayer('Star', { startTime: 0, outPoint: 3 }),
    shapeLayer('Blob', { startTime: 1, outPoint: 4 }),
  ];
  srcLayers.forEach((l) => {
    l.copyToComp = function () {
      activeLayers.unshift(Object.assign({}, this, { selected: false })); // inserts at TOP
      calls.push('copy:' + this.name);
    };
  });
  const srcComp = new CompItem();
  Object.assign(srcComp, {
    name: 'Star',
    layer(i) { return srcLayers[i - 1]; },
  });
  Object.defineProperty(srcComp, 'numLayers', { get: () => srcLayers.length });

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
      beginUndoGroup() { calls.push('beginUndo'); },
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
