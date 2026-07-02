// feat-012 (Satyjeet's request): rename library folders (categories) from the
// panel. Host behavior is tested against a tiny fake filesystem; panel wiring
// is asserted structurally.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// ---- host: renameCategory ----------------------------------------------------

function makeHarness(existingFolders) {
  const folders = new Set(existingFolders || []);
  const calls = { rebuilt: 0, relinked: [] };

  function Folder(p) { this._path = String(p); }
  Object.defineProperty(Folder.prototype, 'exists', {
    get() { return folders.has(this._path); },
  });
  Object.defineProperty(Folder.prototype, 'fsName', {
    get() { return this._path; },
  });
  Folder.prototype.rename = function (newName) {
    if (!folders.has(this._path)) return false;
    const parent = this._path.slice(0, this._path.lastIndexOf('/'));
    folders.delete(this._path);
    this._path = parent + '/' + newName;
    folders.add(this._path);
    return true;
  };

  const context = {
    $: { global: {} },
    Folder,
    File: function File() {},
    jerr(m) { return JSON.stringify({ ok: false, error: String(m) }); },
    jsonEscape(v) { return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); },
    isReservedCategory(n) { return String(n).toLowerCase() === 'assets'; },
    removeFolderRecursive() { return true; },
    updateIndexPatchComp() { return true; },
    rebuildLibraryIndex() { calls.rebuilt += 1; return '[]'; },
    ensureHostModules() { return true; },
    relinkProjectFootage(oldPath, newPath) { calls.relinked.push([oldPath, newPath]); },
  };
  vm.createContext(context);
  vm.runInContext(read('jsx/library-move.jsx'), context, { filename: 'library-move.jsx' });
  return { g: context.$.global, folders, calls };
}

test('renameCategory renames the folder, rebuilds the index, and relinks footage', () => {
  const { g, folders, calls } = makeHarness(['/lib/B-roll']);

  const r = JSON.parse(g.renameCategory('/lib', 'B-roll', 'Broll Shots'));

  assert.equal(r.ok, true);
  assert.equal(r.category, 'Broll Shots');
  assert.equal(folders.has('/lib/B-roll'), false);
  assert.equal(folders.has('/lib/Broll Shots'), true);
  assert.equal(calls.rebuilt, 1, 'index is rebuilt from disk');
  assert.deepEqual(calls.relinked, [['/lib/B-roll', '/lib/Broll Shots']],
    'project footage is relinked from the old path to the new one');
});

test('renameCategory rejects reserved, invalid, empty, and duplicate names', () => {
  const { g } = makeHarness(['/lib/B-roll', '/lib/Intros']);

  assert.match(JSON.parse(g.renameCategory('/lib', 'Assets', 'Other')).error, /reserved/i);
  assert.match(JSON.parse(g.renameCategory('/lib', 'B-roll', 'Assets')).error, /reserved/i);
  assert.match(JSON.parse(g.renameCategory('/lib', 'B-roll', 'a/b')).error, /invalid characters/i);
  assert.match(JSON.parse(g.renameCategory('/lib', 'B-roll', '   ')).error, /empty/i);
  assert.match(JSON.parse(g.renameCategory('/lib', 'B-roll', 'Intros')).error, /already exists/i);
  assert.match(JSON.parse(g.renameCategory('/lib', 'Missing', 'X')).error, /not found/i);
});

test('renameCategory is a no-op for the same name and exports to $.global', () => {
  const { g, calls } = makeHarness(['/lib/B-roll']);

  const r = JSON.parse(g.renameCategory('/lib', 'B-roll', 'B-roll'));
  assert.equal(r.ok, true);
  assert.equal(r.noop, true);
  assert.equal(calls.rebuilt, 0);
  assert.match(read('jsx/library-move.jsx'), /\$\.global\.renameCategory = renameCategory;/);
});

// ---- panel: header affordance + flow ------------------------------------------

test('library category headers render a rename action; asset headers do not', () => {
  // minimal DOM stub (same shape as render.folder-columns.test.js)
  global.DCState = require('../panel/js/state.js');
  global.DCIcons = {
    chevron: '<svg></svg>', photoOff: '<svg></svg>', star: '<svg></svg>',
    starFilled: '<svg></svg>', pencil: '<svg class="pencil"></svg>', camera: '<svg></svg>',
    folder: '<svg></svg>', trash: '<svg></svg>', download: '<svg></svg>'
  };
  function makeNode(tag) {
    const node = {
      tagName: String(tag).toUpperCase(), className: '', dataset: {}, attributes: {},
      childNodes: [], children: [], parentNode: null, textContent: '', title: '',
      appendChild(c) { c.parentNode = node; node.childNodes.push(c); node.children.push(c); return c; },
      replaceChild(n, o) { const i = node.childNodes.indexOf(o); if (i !== -1) { node.childNodes[i] = n; node.children[i] = n; } return o; },
      setAttribute(k, v) { node.attributes[k] = String(v); },
    };
    let html = '';
    Object.defineProperty(node, 'innerHTML', {
      get() { return html; },
      set(v) { html = String(v); if (html === '') { node.childNodes = []; node.children = []; } },
    });
    return node;
  }
  global.document = { createElement: makeNode };
  delete require.cache[require.resolve('../panel/js/render.js')];
  const DCRender = require('../panel/js/render.js');

  function findActions(node, out = []) {
    if (node.dataset && node.dataset.action === 'renameCategory') out.push(node);
    (node.childNodes || []).forEach((c) => findActions(c, out));
    return out;
  }
  const prefs = Object.assign(DCState.defaultPrefs(), { collapsed: [], collapsedAssets: [], folderColumns: false });
  const groups = [{ category: 'B-roll', items: [{ uniqueId: 'x', category: 'B-roll', name: 'One' }] }];

  const libContainer = makeNode('main');
  DCRender.render(libContainer, groups, prefs, {}, {}, 'empty');
  assert.equal(findActions(libContainer).length, 1, 'library header exposes the rename action');

  const assetContainer = makeNode('main');
  DCRender.render(assetContainer, [{ category: 'Icons', items: [{ uniqueId: 'a', category: 'Icons', name: 'A', ext: 'png', filePath: '/p.png' }] }], prefs, {}, {}, 'empty', 'asset');
  assert.equal(findActions(assetContainer).length, 0, 'asset headers stay rename-free');
});

test('the rename-folder flow is wired through shell, library, and main', () => {
  const libraryJs = read('panel/js/library.js');
  const mainJs = read('panel/js/main.js');
  const shellJs = read('panel/js/shell.js');

  assert.match(libraryJs, /function renameCategoryFlow\(/, 'library owns the flow');
  assert.match(libraryJs, /'renameCategory'/, 'library calls the host fn');
  assert.match(libraryJs, /renameCategoryFlow:\s*renameCategoryFlow/, 'flow exported');
  assert.match(shellJs, /renameCategoryFlow/, 'shell routes the header action');
  assert.match(mainJs, /renameCategory/, 'main forwards the header action');
});
