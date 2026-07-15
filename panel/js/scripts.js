// DropComp Scripts tab controller. Registers, organises and one-click-runs the
// user's custom .jsx files and pasted snippets so they can stay undocked.
// TODO: split by concern — the editor-modal wiring (openEditor/saveEntry/fillCategoryList) could move to a scripts-editor.js module.
var DCScripts = (function () {
  'use strict';

  var USAGE_KEY = 'dropcomp_scripts_metadata';
  var VIEW_KEY = 'dropcomp_scripts_view'; // persisted view state (collapsed categories)

  var ICON = DCIcons; // shared icon registry

  var mounted = false;
  var loaded = false;
  var loadFailed = false; // registry exists but couldn't be read - block saves so we never clobber it
  var scripts = [];
  var usageMeta = {};
  var view = { search: '', sort: 'recent', favoritesOnly: false, collapsed: [] };

  function loadViewState() {
    try {
      var raw = localStorage.getItem(VIEW_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      if (parsed && parsed.collapsed instanceof Array) view.collapsed = parsed.collapsed;
    } catch (e) { /* corrupted view state: fall back to everything expanded */ }
  }

  function saveViewState() {
    try { localStorage.setItem(VIEW_KEY, JSON.stringify({ collapsed: view.collapsed })); } catch (e) { }
  }
  var editing = null;
  var pendingDelete = null;
  var els = {};

  function init() { /* lazy: real wiring happens in mount() */ }

  function libPath() { return DCShell.getLibraryPath(); }

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function iconBtn(action, title, svg, extraClass) {
    var b = el('button', 'script-action' + (extraClass ? ' ' + extraClass : ''));
    b.dataset.action = action;
    b.setAttribute('data-tip', title);
    b.setAttribute('aria-label', title);
    b.innerHTML = svg;
    return b;
  }

  function ensureMounted() {
    if (!mounted) { mount(); mounted = true; }
    if (!loaded) load(); else render();
  }

  function mount() {
    els.list = document.getElementById('scripts-list');
    els.search = document.getElementById('script-search');
    els.sort = document.getElementById('script-sort');
    els.favBtn = document.getElementById('script-fav-btn');
    els.modal = document.getElementById('script-modal');
    els.modalTitle = document.getElementById('script-modal-title');
    els.nameInput = document.getElementById('script-name-input');
    els.descInput = document.getElementById('script-desc-input');
    els.catInput = document.getElementById('script-cat-input');
    els.catList = document.getElementById('script-cat-list');
    els.bodyGroup = document.getElementById('script-body-group');
    els.bodyInput = document.getElementById('script-body-input');
    els.pathGroup = document.getElementById('script-path-group');
    els.pathDisplay = document.getElementById('script-path-display');
    els.inputsList = document.getElementById('script-inputs-list');
    els.opensWindow = document.getElementById('script-opens-window');
    document.getElementById('script-add-input').addEventListener('click', function () {
      DCScriptsForm.addBuilderRow(els.inputsList);
    });

    els.search.addEventListener('input', function () { view.search = els.search.value; render(); });
    els.sort.addEventListener('change', function () { view.sort = els.sort.value; render(); });
    els.favBtn.addEventListener('click', function () {
      view.favoritesOnly = !view.favoritesOnly;
      els.favBtn.classList.toggle('active', view.favoritesOnly);
      render();
    });
    document.getElementById('script-new-snippet').addEventListener('click', newSnippet);
    document.getElementById('script-add-file').addEventListener('click', addFile);
    document.getElementById('script-save-btn').addEventListener('click', saveEntry);
    document.getElementById('script-cancel-btn').addEventListener('click', closeModal);
    els.list.addEventListener('click', onListClick);

    usageMeta = DCState.loadUsageMeta(localStorage, USAGE_KEY);
    loadViewState();
  }

  function load() {
    loadFailed = false;
    if (!libPath()) { loaded = true; render(); return; }
    DCBridge.call('scLoadRegistry', [libPath()], function (result) {
      loaded = true;
      var parsed = DCBridge.parseJson(result);
      // A jerr ({ok:false}) means the file exists but couldn't be read. Do NOT
      // coerce that to an empty list - a later save would overwrite a registry
      // that is actually intact on disk. Block saves until a clean (re)load.
      if (!parsed || parsed.ok === false) {
        loadFailed = true;
        DCUI.toast((parsed && parsed.error) || 'Could not read the scripts registry.', true);
        render();
        return;
      }
      scripts = DCScriptsCore.parseRegistry(result).scripts;
      render();
    });
  }

  // Assumes the bridge lock is already held; releases it in the callback.
  function persistLocked(cb) {
    DCBridge.call('scSaveRegistry', [libPath(), DCScriptsCore.serializeRegistry(scripts)], function (result) {
      DCBridge.release();
      var r = DCBridge.parseJson(result);
      if (!(r && r.ok)) DCUI.toast((r && r.error) || 'Could not save the scripts registry.', true);
      if (cb) cb();
    });
  }

  // Acquire the single-op lock before mutating, so a save/delete can't clobber
  // the registry mid-run and the in-memory list never diverges from disk on a
  // busy bounce. Returns false (and toasts) when blocked or when load failed.
  function beginWrite() {
    if (loadFailed) {
      DCUI.toast('Scripts registry could not be read; saving is paused. Tap Retry first.', true);
      return false;
    }
    if (!DCBridge.acquire('saving scripts')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return false; }
    return true;
  }

  function render() {
    if (loadFailed) {
      els.list.innerHTML = '';
      els.list.appendChild(loadErrorState());
      return;
    }
    var filtered = DCScriptsCore.filterScripts(scripts, {
      search: view.search, favoritesOnly: view.favoritesOnly, usageMeta: usageMeta
    });
    var sorted = DCScriptsCore.sortScripts(filtered, view.sort, usageMeta);
    var groups = DCScriptsCore.groupByCategory(sorted);
    els.list.innerHTML = '';
    if (scripts.length === 0) {
      els.list.appendChild(emptyState('No scripts yet', 'Add a .jsx file or paste a snippet, then run it with one click.', true));
      return;
    }
    if (groups.length === 0) {
      els.list.appendChild(emptyState('No matches', 'Try a different search, or turn off the favorites filter.', false));
      return;
    }
    groups.forEach(function (g) { els.list.appendChild(buildSection(g)); });
  }

  function emptyState(title, sub, showCta) {
    var wrap = el('div', 'scripts-empty');
    wrap.innerHTML = ICON.snippet;
    wrap.appendChild(el('div', 'scripts-empty-title', title));
    wrap.appendChild(el('div', 'scripts-empty-sub', sub));
    if (showCta) {
      var cta = el('button', 'btn-gold', 'New Snippet');
      cta.addEventListener('click', newSnippet);
      wrap.appendChild(cta);
    }
    return wrap;
  }

  function loadErrorState() {
    var wrap = el('div', 'scripts-empty');
    wrap.innerHTML = ICON.file;
    wrap.appendChild(el('div', 'scripts-empty-title', 'Couldn’t read your scripts'));
    wrap.appendChild(el('div', 'scripts-empty-sub', 'The registry exists but could not be read. Your scripts are safe on disk — saving is paused until it loads. Tap Retry.'));
    var retry = el('button', 'btn-dark', 'Retry');
    retry.addEventListener('click', function () { loaded = false; load(); });
    wrap.appendChild(retry);
    return wrap;
  }

  function buildSection(group) {
    var collapsed = view.collapsed.indexOf(group.category) !== -1;
    var section = el('section', 'script-category' + (collapsed ? ' collapsed' : ''));
    section.dataset.category = group.category;
    var header = el('div', 'script-cat-header');
    header.dataset.action = 'toggleCat';
    header.setAttribute('role', 'button');
    header.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    header.innerHTML = ICON.chevron;
    header.appendChild(el('span', 'script-cat-name', group.category));
    header.appendChild(el('span', 'script-cat-count', String(group.items.length)));
    section.appendChild(header);
    group.items.forEach(function (s) { section.appendChild(buildRow(s)); });
    return section;
  }

  function toggleCategory(category) {
    view.collapsed = DCScriptsCore.toggleCollapsed(view.collapsed, category);
    saveViewState();
    render();
  }

  function buildRow(s) {
    var usage = DCScriptsCore.getUsage(usageMeta, s.uniqueId);
    var mode = DCScriptsCore.runMode(s);
    var row = el('div', 'script-row' + (usage.isFavorite ? ' has-fav' : '') + (mode === 'params' ? ' has-form' : ''));
    row.dataset.id = s.uniqueId;
    var tip = DCTooltip.buildScriptTip(s, usage);
    row.setAttribute('data-tip-title', tip.title);
    row.setAttribute('data-tip', tip.body);

    var run = el('button', 'script-run');
    run.dataset.action = 'run';
    run.setAttribute('data-tip', 'Run "' + s.name + '"');
    run.setAttribute('aria-label', 'Run ' + s.name);
    run.innerHTML = ICON.play;
    row.appendChild(run);

    var main = el('div', 'script-main');
    var nameRow = el('div', 'script-name-row');
    var typeIcon = el('span', 'script-type', undefined);
    typeIcon.innerHTML = s.source === 'file' ? ICON.file : ICON.snippet;
    typeIcon.setAttribute('data-tip', s.source === 'file' ? 'External file' : 'Snippet');
    nameRow.appendChild(typeIcon);
    nameRow.appendChild(el('span', 'script-name', s.name));
    main.appendChild(nameRow);
    if (s.description) main.appendChild(el('div', 'script-desc', s.description));
    var meta = formatMeta(s, usage);
    if (meta) main.appendChild(el('div', 'script-meta', meta));
    row.appendChild(main);

    var actions = el('div', 'script-actions');
    actions.appendChild(iconBtn('favorite', 'Favorite', usage.isFavorite ? ICON.starFilled : ICON.star, usage.isFavorite ? 'fav-on' : ''));
    actions.appendChild(iconBtn('edit', 'Edit', ICON.pencil));
    if (s.source === 'file') actions.appendChild(iconBtn('reveal', 'Reveal file', ICON.folder));
    actions.appendChild(iconBtn('remove', 'Remove', ICON.trash));
    row.appendChild(actions);
    return row;
  }

  function formatMeta(s, usage) {
    var parts = [];
    if (usage.runCount) parts.push('run ' + usage.runCount + (usage.runCount === 1 ? ' time' : ' times'));
    if (s.source === 'file' && s.path) parts.push(s.path.replace(/^.*[\\\/]/, ''));
    return parts.join(' · ');
  }

  function onListClick(e) {
    var actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    if (actionEl.dataset.action === 'toggleCat') {
      var section = actionEl.closest('.script-category');
      if (section) toggleCategory(section.dataset.category);
      return;
    }
    var row = actionEl.closest('.script-row');
    if (!row) return;
    var s = byId(row.dataset.id);
    if (!s) return;
    var action = actionEl.dataset.action;
    if (action === 'run') runScript(s);
    else if (action === 'edit') openEditor(s);
    else if (action === 'reveal') reveal(s);
    else if (action === 'remove') confirmRemove(s);
    else if (action === 'favorite') toggleFav(s);
  }

  function okMsg(s) {
    return 'Ran "' + s.name + '".';
  }

  function runScript(s) {
    var row = els.list.querySelector('.script-row[data-id="' + s.uniqueId + '"]');
    var mode = DCScriptsCore.runMode(s);
    if (mode === 'params' && row) { toggleRunForm(row, s); return; }
    if (mode === 'windowNotice' && row) { toggleWindowNotice(row, s); return; }
    if (!DCBridge.acquire('runScript')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
    var fn = s.source === 'file' ? 'scRunFile' : 'scRunSnippet';
    var arg = s.source === 'file' ? s.path : s.body;
    DCBridge.call(fn, [arg], function (result) {
      DCBridge.release();
      var r = DCBridge.parseJson(result);
      if (r && r.ok) { bumpUsage(s.uniqueId); DCUI.toast(okMsg(s), false); render(); }
      // the host refused a ScriptUI window script (file scripts are only
      // readable host-side): show the same in-panel notice as opensWindow
      else if (r && r.windowScript && row) toggleWindowNotice(row, s);
      else DCUI.toast((r && r.error) || result || 'Script failed.', true);
    });
  }

  // explicit "Run Anyway" consent: launches the script's own floating window
  function runForced(s) {
    if (!DCBridge.acquire('runScript')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
    var openNote = els.list.querySelector('.script-form');
    if (openNote) openNote.parentNode.removeChild(openNote);
    var fn = s.source === 'file' ? 'scRunFile' : 'scRunSnippet';
    var arg = s.source === 'file' ? s.path : s.body;
    DCBridge.call(fn, [arg, '1'], function (result) {
      DCBridge.release();
      var r = DCBridge.parseJson(result);
      if (r && r.ok) { bumpUsage(s.uniqueId); DCUI.toast('Opened "' + s.name + '" in its own window.', false); render(); }
      else DCUI.toast((r && r.error) || result || 'Script failed.', true);
    });
  }

  function toggleRunForm(row, s) {
    var existing = row.querySelector('.script-form');
    var open = els.list.querySelector('.script-form');
    if (open) open.parentNode.removeChild(open);
    if (existing) return; // re-click on the same row collapses it
    var form = DCScriptsForm.renderRunForm(s,
      function (valuesJson) { runWithParams(s, valuesJson); },
      function () { var f = row.querySelector('.script-form'); if (f) f.parentNode.removeChild(f); });
    row.appendChild(form);
    var first = form.querySelector('input, select, textarea');
    if (first) first.focus();
  }

  function toggleWindowNotice(row, s) {
    var existing = row.querySelector('.script-window-note');
    var open = els.list.querySelector('.script-form');
    if (open) open.parentNode.removeChild(open);
    if (existing) return;
    var wrap = el('div', 'script-form script-window-note');
    wrap.appendChild(el('div', 'script-window-title', 'Opens in its own window'));
    wrap.appendChild(el('div', 'script-window-copy', '"' + s.name + '" builds a ScriptUI window, which cannot be embedded in DropComp. Run it as a floating window, or add Inputs (DC_PARAMS) to turn it into an in-panel form.'));
    var btns = el('div', 'script-form-btns');
    var runAnyway = el('button', 'btn-gold', 'Run Anyway'); runAnyway.type = 'button';
    runAnyway.addEventListener('click', function () { runForced(s); });
    var edit = el('button', 'btn-dark', 'Edit Inputs'); edit.type = 'button';
    edit.addEventListener('click', function () { openEditor(s); });
    var cancel = el('button', 'btn-dark', 'Cancel'); cancel.type = 'button';
    cancel.addEventListener('click', function () {
      var note = row.querySelector('.script-window-note');
      if (note) note.parentNode.removeChild(note);
    });
    btns.appendChild(cancel);
    btns.appendChild(edit);
    btns.appendChild(runAnyway);
    wrap.appendChild(btns);
    row.appendChild(wrap);
  }

  function runWithParams(s, valuesJson) {
    if (!DCBridge.acquire('runScript')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
    var fn = s.source === 'file' ? 'scRunFileWithParams' : 'scRunSnippetWithParams';
    var arg = s.source === 'file' ? s.path : s.body;
    DCBridge.call(fn, [arg, valuesJson], function (result) {
      DCBridge.release();
      var r = DCBridge.parseJson(result);
      if (r && r.ok) {
        bumpUsage(s.uniqueId);
        DCUI.toast(okMsg(s), false);
        var openForm = els.list.querySelector('.script-form');
        if (openForm) openForm.parentNode.removeChild(openForm);
        render();
      } else DCUI.toast((r && r.error) || result || 'Script failed.', true);
    });
  }

  function newSnippet() { openEditor({ source: 'snippet', name: '', description: '', category: '', body: '' }); }

  function addFile() {
    if (!DCBridge.acquire('pickScript')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
    DCBridge.call('scPickScriptFile', [], function (result) {
      DCBridge.release();
      var r = DCBridge.parseJson(result);
      if (!r || r.cancelled) return;
      if (!r.ok) { DCUI.toast(r.error || 'Could not open the file picker.', true); return; }
      openEditor({ source: 'file', name: r.name || '', description: '', category: '', path: r.path });
    });
  }

  function openEditor(entry) {
    editing = entry;
    els.modalTitle.textContent = entry.uniqueId ? 'Edit Script'
      : (entry.source === 'file' ? 'Add Script File' : 'New Snippet');
    els.nameInput.value = entry.name || '';
    els.descInput.value = entry.description || '';
    els.catInput.value = entry.category || '';
    fillCategoryList();
    var isFile = entry.source === 'file';
    els.bodyGroup.style.display = isFile ? 'none' : 'block';
    els.pathGroup.style.display = isFile ? 'block' : 'none';
    if (isFile) els.pathDisplay.textContent = entry.path || '';
    else els.bodyInput.value = entry.body || '';
    DCScriptsForm.renderBuilder(els.inputsList, entry.params || []);
    els.opensWindow.checked = !!entry.opensWindow;
    els.modal.classList.remove('hidden');
    els.nameInput.focus();
  }

  function fillCategoryList() {
    els.catList.innerHTML = '';
    DCScriptsCore.categories(scripts).forEach(function (c) {
      var o = document.createElement('option');
      o.value = c;
      els.catList.appendChild(o);
    });
  }

  function saveEntry() {
    var input = {
      uniqueId: editing.uniqueId,
      name: els.nameInput.value,
      description: els.descInput.value,
      category: els.catInput.value,
      source: editing.source,
      path: editing.path,
      body: editing.source === 'snippet' ? els.bodyInput.value : null,
      addedAt: editing.addedAt,
      params: DCScriptsForm.readBuilder(els.inputsList),
      opensWindow: els.opensWindow.checked
    };
    var v = DCScriptsCore.validateEntry(input);
    if (!v.valid) { DCUI.toast(v.error, true); return; }
    if (!beginWrite()) return;
    var entry = DCScriptsCore.makeEntry(input, Date.now());
    scripts = DCScriptsCore.upsert(scripts, entry);
    persistLocked(function () { closeModal(); render(); DCUI.toast('Saved "' + entry.name + '".', false); if (typeof DCSync !== 'undefined') DCSync.broadcast('scripts'); });
  }

  function reveal(s) {
    if (s.source !== 'file') return;
    DCBridge.call('scRevealFile', [s.path], function (result) {
      var r = DCBridge.parseJson(result);
      if (!(r && r.ok)) DCUI.toast((r && r.error) || 'Could not reveal the file.', true);
    });
  }

  function confirmRemove(s) { pendingDelete = s; DCUI.openDeleteModal('scripts', s.name); }

  function confirmDelete() {
    if (!pendingDelete) return;
    if (!beginWrite()) return;
    scripts = DCScriptsCore.removeById(scripts, pendingDelete.uniqueId);
    var name = pendingDelete.name;
    pendingDelete = null;
    persistLocked(function () { DCUI.closeAllModals(); render(); DCUI.toast('Removed "' + name + '".', false); if (typeof DCSync !== 'undefined') DCSync.broadcast('scripts'); });
  }

  function clearPending() { pendingDelete = null; }

  function toggleFav(s) {
    var u = usageMeta[s.uniqueId] || { lastRun: 0, runCount: 0, isFavorite: false };
    u.isFavorite = !u.isFavorite;
    usageMeta[s.uniqueId] = u;
    DCState.saveUsageMeta(localStorage, usageMeta, USAGE_KEY);
    render();
  }

  function bumpUsage(id) {
    var u = usageMeta[id] || { lastRun: 0, runCount: 0, isFavorite: false };
    u.lastRun = Date.now();
    u.runCount = (u.runCount || 0) + 1;
    usageMeta[id] = u;
    DCState.saveUsageMeta(localStorage, usageMeta, USAGE_KEY);
  }

  function byId(id) {
    for (var i = 0; i < scripts.length; i++) { if (scripts[i].uniqueId === id) return scripts[i]; }
    return null;
  }

  function closeModal() { els.modal.classList.add('hidden'); editing = null; }
  function refresh() { loaded = false; load(); }
  function resetLoaded() { loaded = false; }

  return {
    init: init, ensureMounted: ensureMounted,
    confirmDelete: confirmDelete, clearPending: clearPending, closeModal: closeModal,
    refresh: refresh, resetLoaded: resetLoaded
  };
}());
