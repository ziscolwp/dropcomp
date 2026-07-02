const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// ---- host-side: getSelectedFootagePaths -----------------------------------

function CompItem() {}
function FootageItem() {}
function FolderItem() {}

function makeFootage(fsName, opts) {
  const item = new FootageItem();
  item.mainSource = (opts && opts.noFile)
    ? {}
    : { file: { fsName, name: fsName.slice(fsName.lastIndexOf('/') + 1), exists: (opts && opts.missing) ? false : true } };
  return item;
}

function loadAssetsJsx(project) {
  const context = {
    $: { global: {} },
    app: { project },
    CompItem,
    FootageItem,
    FolderItem,
    File: function File() {},
    Folder: function Folder() {},
    jerr(message) { return JSON.stringify({ ok: false, error: message }); },
    jsonEscape(value) { return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); },
    readJson() { return null; },
    writeJson() { return true; },
    JSON,
    decodeURI: (s) => s,
  };
  vm.createContext(context);
  vm.runInContext(read('jsx/assets.jsx'), context, { filename: 'assets.jsx' });
  return context.$.global;
}

function projectWithComp(selectedLayers) {
  const comp = new CompItem();
  comp.selectedLayers = selectedLayers;
  return { activeItem: comp, selection: [] };
}

test('getSelectedFootagePaths returns the source paths of selected image layers', () => {
  const png = makeFootage('/shots/hero.png');
  const svg = makeFootage('/shots/logo.svg');
  const g = loadAssetsJsx(projectWithComp([{ source: png }, { source: svg }]));

  const r = JSON.parse(g.getSelectedFootagePaths());
  assert.equal(r.ok, true);
  assert.deepEqual(r.paths, ['/shots/hero.png', '/shots/logo.svg']);
});

test('getSelectedFootagePaths dedupes layers sharing one source file', () => {
  const png = makeFootage('/shots/hero.png');
  const g = loadAssetsJsx(projectWithComp([{ source: png }, { source: png }]));

  const r = JSON.parse(g.getSelectedFootagePaths());
  assert.equal(r.ok, true);
  assert.deepEqual(r.paths, ['/shots/hero.png']);
});

test('getSelectedFootagePaths errors helpfully when nothing is selected', () => {
  const g = loadAssetsJsx({ activeItem: null, selection: [] });

  const r = JSON.parse(g.getSelectedFootagePaths());
  assert.equal(r.ok, false);
  assert.match(r.error, /Select an image layer/i);
});

test('getSelectedFootagePaths rejects file-less sources like solids', () => {
  const solid = makeFootage('/ignored', { noFile: true });
  const g = loadAssetsJsx(projectWithComp([{ source: solid }]));

  const r = JSON.parse(g.getSelectedFootagePaths());
  assert.equal(r.ok, false);
  assert.match(r.error, /No supported image/i);
});

test('getSelectedFootagePaths rejects unsupported extensions', () => {
  const mov = makeFootage('/shots/clip.mov');
  const g = loadAssetsJsx(projectWithComp([{ source: mov }]));

  const r = JSON.parse(g.getSelectedFootagePaths());
  assert.equal(r.ok, false);
  assert.match(r.error, /No supported image/i);
});

test('getSelectedFootagePaths falls back to the Project panel selection', () => {
  const jpg = makeFootage('/stills/frame.jpg');
  const folder = new FolderItem();
  const g = loadAssetsJsx({ activeItem: null, selection: [folder, jpg] });

  const r = JSON.parse(g.getSelectedFootagePaths());
  assert.equal(r.ok, true);
  assert.deepEqual(r.paths, ['/stills/frame.jpg']);
});

test('getSelectedFootagePaths is exported to $.global', () => {
  assert.match(read('jsx/assets.jsx'), /\$\.global\.getSelectedFootagePaths = getSelectedFootagePaths;/);
});

// ---- panel-side wiring ------------------------------------------------------

test('assets panel exposes an addSelectedFlow that reuses the category modal', () => {
  const src = read('panel/js/assets.js');
  assert.match(src, /function addSelectedFlow\(/, 'addSelectedFlow must exist');
  assert.match(src, /getSelectedFootagePaths/, 'flow asks the host for the selected image paths');
  assert.match(src, /addSelectedFlow:\s*addSelectedFlow/, 'flow is exported on DCAssets');
});

test('the Add Selected Image button exists and is wired up', () => {
  const html = read('panel/index.html');
  const mainJs = read('panel/js/main.js');
  const css = read('panel/css/style.css');

  assert.match(html, /id="add-selected-image-btn"/, 'button markup exists');
  assert.match(html, /add-selected-image-btn[^>]*data-tip="[^"]*selected[^"]*Assets/i, 'tooltip explains the action');
  assert.match(mainJs, /addSelectedImageBtn/, 'main.js grabs the button');
  assert.match(mainJs, /DCAssets\.addSelectedFlow/, 'click routes to addSelectedFlow');
  assert.match(css, /#add-selected-image-btn\s*\{\s*display:\s*none;/, 'hidden outside the Assets tab');
  assert.match(css, /#app\.assets-active\s+#add-selected-image-btn/, 'shown on the Assets tab');
});
