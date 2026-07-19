const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const librarySrc = fs.readFileSync(path.join(__dirname, '..', 'panel', 'js', 'library.js'), 'utf8');
const RealSections = require('../panel/js/sections.js');

function stubFs(files) {
  return {
    existsSync: (p) => Object.prototype.hasOwnProperty.call(files, p),
    readFileSync: (p) => {
      if (!Object.prototype.hasOwnProperty.call(files, p)) throw new Error('ENOENT');
      return files[p];
    },
    writeFileSync: (p, data) => { files[p] = data; },
    renameSync: (from, to) => { files[to] = files[from]; delete files[from]; },
  };
}

// DCSections with load/save pinned to an in-memory file map. Without this the
// flows would hit the real filesystem at /Library/.dropcomp_sections.json
// (root-owned on macOS) and the post-mutation reloads would wipe state.
function sectionsWithMemFs() {
  const fsStub = stubFs({});
  return Object.assign({}, RealSections, {
    load: (libPath) => RealSections.load(libPath, fsStub),
    save: (libPath, model) => RealSections.save(libPath, model, fsStub),
  });
}

function makeCalls() {
  return { broadcasts: [], toasts: [], renders: [], modals: [], bridge: [] };
}

function makeContext(calls, comps) {
  const els = {
    search: { value: '' },
    library: {},
    categoryModal: { name: 'categoryModal' },
    renameModal: { name: 'renameModal' },
    deleteModal: { name: 'deleteModal' },
    newNameInput: { value: '' },
    addCompBtn: { disabled: false },
  };
  const context = {
    localStorage: { getItem() { return null; }, setItem() {} },
    Date,
    JSON,
    DCSections: sectionsWithMemFs(),
    DCShell: {
      getLibraryPath() { return '/Library'; },
      getPrefs() {
        return {
          activeTab: 'library', favoritesOnly: false, sort: 'name',
          collapsed: [], viewMode: 'comfortable', folderColumns: true,
          showNames: true, showMeta: true,
        };
      },
      getEls() { return els; },
      persistPrefs() {},
    },
    DCUI: {
      spinner() {},
      toast(msg, isErr) { calls.toasts.push({ msg: String(msg), isErr: !!isErr }); },
      isError(r) { return typeof r === 'string' && r.indexOf('Error') === 0; },
      openCategoryModal(mode, title, names) { calls.modals.push({ mode, title, names }); },
      openRenameModal(owner, name) { calls.modals.push({ owner, name, kind: 'rename' }); },
      openDeleteModal(owner, name) { calls.modals.push({ owner, name, kind: 'delete' }); },
      closeModal() {},
    },
    DCBridge: {
      acquire() { return true; },
      release() {},
      parseJson(r) { try { return JSON.parse(r); } catch (e) { return null; } },
      call(fnName, args, cb) {
        calls.bridge.push({ fnName, args });
        if (fnName === 'getStashedComps') cb(JSON.stringify(comps));
        else if (fnName === 'renameStashedComp') {
          // mirror the host: the item's id and name change on disk, so the
          // reload that follows must serve the renamed comp (else the
          // load-time prune would drop the migrated id as stale)
          comps[0].uniqueId = 'Fresh_1700000000000';
          comps[0].name = 'Fresh';
          cb('{"ok":true,"newUniqueId":"Fresh_1700000000000"}');
        }
        else if (fnName === 'deleteStashedComp') cb('Success');
      },
    },
    DCSync: { broadcast(kind) { calls.broadcasts.push(kind); } },
    DCState: {
      loadUsageMeta() { return {}; },
      saveUsageMeta() {},
      cleanupStaleMetadata(usageMeta) { return { removed: 0, usageMeta }; },
      migrateMetadataKey(meta) { return meta; },
      filterComps(items) { return items; },
      groupByCategory(items) {
        return items.length ? [{ category: items[0].category, items }] : [];
      },
      sortComps(items) { return items; },
      getUsage() { return { lastUsed: 0, useCount: 0, isFavorite: false }; },
    },
    DCValidate: {
      validateName(name) { return { valid: true, name: String(name).trim() }; },
    },
    DCRender: {
      render(container, groups) { calls.renders.push(groups); },
    },
    module: { exports: {} },
    console,
  };
  context.global = context;
  vm.createContext(context);
  vm.runInContext(librarySrc, context);
  return context;
}

function baseComps() {
  return [{
    name: 'Step Anim',
    uniqueId: 'Step_Anim_1700000000000',
    category: 'Anims',
    aepPath: '/Library/Anims/Step_Anim_1700000000000/Step_Anim.aep',
  }];
}

function loaded(calls, comps) {
  const ctx = makeContext(calls, comps || baseComps());
  ctx.DCLibrary.init();
  ctx.DCLibrary.load();
  return ctx;
}

test('addToSection card action opens the section modal with existing names', () => {
  const calls = makeCalls();
  const ctx = loaded(calls);
  ctx.DCLibrary.onCardAction('addToSection', 'Step_Anim_1700000000000', 'Anims');
  ctx.DCLibrary.confirmAddToSection('Client X');
  ctx.DCLibrary.onCardAction('addToSection', 'Step_Anim_1700000000000', 'Anims');
  const modal = calls.modals[calls.modals.length - 1];
  assert.equal(modal.mode, 'section');
  assert.deepEqual(modal.names, ['Client X']);
});

test('confirmAddToSection adds, broadcasts, rerenders, and pins the group', () => {
  const calls = makeCalls();
  const ctx = loaded(calls);
  ctx.DCLibrary.onCardAction('addToSection', 'Step_Anim_1700000000000', 'Anims');
  ctx.DCLibrary.confirmAddToSection('Client X');
  assert.deepEqual(calls.broadcasts, ['library']);
  const groups = calls.renders[calls.renders.length - 1];
  assert.equal(groups[0].category, 'Client X');
  assert.equal(groups[0].virtual, true);
  assert.deepEqual(groups[0].items.map((c) => c.uniqueId), ['Step_Anim_1700000000000']);
  assert.equal(groups[1].category, 'Anims');
});

test('adding twice toasts instead of duplicating', () => {
  const calls = makeCalls();
  const ctx = loaded(calls);
  ctx.DCLibrary.onCardAction('addToSection', 'Step_Anim_1700000000000', 'Anims');
  ctx.DCLibrary.confirmAddToSection('Client X');
  ctx.DCLibrary.onCardAction('addToSection', 'Step_Anim_1700000000000', 'Anims');
  ctx.DCLibrary.confirmAddToSection('Client X');
  assert.equal(calls.broadcasts.length, 1);
  assert.match(calls.toasts[calls.toasts.length - 1].msg, /Already in/);
});

test('removeFromSection unlinks only the section entry', () => {
  const calls = makeCalls();
  const ctx = loaded(calls);
  ctx.DCLibrary.onCardAction('addToSection', 'Step_Anim_1700000000000', 'Anims');
  ctx.DCLibrary.confirmAddToSection('Client X');
  ctx.DCLibrary.onCardAction('removeFromSection', 'Step_Anim_1700000000000', 'Anims', 'Client X');
  const groups = calls.renders[calls.renders.length - 1];
  assert.equal(groups[0].category, 'Client X');
  assert.deepEqual(groups[0].items, []);
  assert.equal(groups[1].category, 'Anims');
  assert.equal(groups[1].items.length, 1);
});

test('deleting a comp clears it from every section', () => {
  const calls = makeCalls();
  const ctx = loaded(calls);
  ctx.DCLibrary.onCardAction('addToSection', 'Step_Anim_1700000000000', 'Anims');
  ctx.DCLibrary.confirmAddToSection('Client X');
  ctx.DCLibrary.onCardAction('delete', 'Step_Anim_1700000000000', 'Anims');
  ctx.DCLibrary.confirmDelete();
  // deletion triggers loadAndBroadcast -> load; the stub still serves the
  // comp, so assert via the model: the section no longer holds it
  ctx.DCLibrary.onCardAction('addToSection', 'Step_Anim_1700000000000', 'Anims');
  const modal = calls.modals[calls.modals.length - 1];
  assert.deepEqual(modal.names, ['Client X']);
  ctx.DCLibrary.confirmAddToSection('Client X');
  assert.match(calls.toasts[calls.toasts.length - 1].msg, /Added to/);
});

test('renaming a comp migrates its id inside sections', () => {
  const calls = makeCalls();
  const ctx = loaded(calls);
  ctx.DCLibrary.onCardAction('addToSection', 'Step_Anim_1700000000000', 'Anims');
  ctx.DCLibrary.confirmAddToSection('Client X');
  ctx.DCLibrary.onCardAction('rename', 'Step_Anim_1700000000000', 'Anims');
  ctx.DCShell.getEls().newNameInput.value = 'Fresh';
  ctx.DCLibrary.confirmRename();
  // adding the NEW id must report "already in" - membership followed the rename
  ctx.DCLibrary.onCardAction('addToSection', 'Fresh_1700000000000', 'Anims');
  ctx.DCLibrary.confirmAddToSection('Client X');
  assert.match(calls.toasts[calls.toasts.length - 1].msg, /Already in/);
});

test('section rename via header keeps membership and collapse key', () => {
  const calls = makeCalls();
  const ctx = loaded(calls);
  ctx.DCLibrary.onCardAction('addToSection', 'Step_Anim_1700000000000', 'Anims');
  ctx.DCLibrary.confirmAddToSection('Client X');
  ctx.DCLibrary.renameSectionFlow('Client X');
  ctx.DCShell.getEls().newNameInput.value = 'Client Y';
  ctx.DCLibrary.confirmRename();
  const groups = calls.renders[calls.renders.length - 1];
  assert.equal(groups[0].category, 'Client Y');
  assert.equal(groups[0].items.length, 1);
});

test('section delete removes only the grouping', () => {
  const calls = makeCalls();
  const ctx = loaded(calls);
  ctx.DCLibrary.onCardAction('addToSection', 'Step_Anim_1700000000000', 'Anims');
  ctx.DCLibrary.confirmAddToSection('Client X');
  ctx.DCLibrary.deleteSectionFlow('Client X');
  ctx.DCLibrary.confirmDelete();
  const groups = calls.renders[calls.renders.length - 1];
  assert.equal(groups.length, 1);
  assert.equal(groups[0].category, 'Anims');
  assert.equal(groups[0].items.length, 1);
});

test('empty sections hide while searching', () => {
  const calls = makeCalls();
  const ctx = loaded(calls);
  ctx.DCLibrary.onCardAction('addToSection', 'Step_Anim_1700000000000', 'Anims');
  ctx.DCLibrary.confirmAddToSection('Client X');
  ctx.DCLibrary.onCardAction('removeFromSection', 'Step_Anim_1700000000000', 'Anims', 'Client X');
  ctx.DCShell.getEls().search.value = 'step';
  ctx.DCLibrary.rerender();
  const groups = calls.renders[calls.renders.length - 1];
  assert.equal(groups.length, 1);
  assert.equal(groups[0].category, 'Anims');
});
