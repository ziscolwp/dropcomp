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
