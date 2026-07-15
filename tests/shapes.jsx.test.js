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
