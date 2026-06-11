var DCActions = (function () {
  'use strict';

  var els = null;
  var allComps = [];
  var usageMeta = {};
  var prefs = null;
  var busts = {};
  var libraryPath = null;
  var modalMode = null;
  var pendingAepPath = null;
  var renameTarget = null;
  var deleteTarget = null;
  var toastTimer = null;

  function toast(msg, isErr) {
    if (toastTimer) clearTimeout(toastTimer);
    els.toast.textContent = String(msg).replace(/^(Success!|Success:|Error:)\s*/, '');
    els.toast.className = 'show ' + (isErr ? 'error' : 'success');
    toastTimer = setTimeout(function () { els.toast.classList.remove('show'); }, 3000);
  }
  function spinner(show) { els.spinner.classList.toggle('hidden', !show); }
  function show(elName) {
    ['welcome', 'driveMissing', 'app'].forEach(function (k) {
      els[k].classList.toggle('hidden', k !== elName);
    });
  }
  function isError(result) { return typeof result === 'string' && result.indexOf('Error') === 0; }

  function init(elements) {
    els = elements;
    prefs = DCState.loadPrefs(localStorage);
    usageMeta = DCState.loadUsageMeta(localStorage);
    applyPrefsToControls();
  }

  function applyPrefsToControls() {
    els.sortSelect.value = prefs.sort;
    els.thumbSlider.value = prefs.thumbMin;
    els.showNamesCb.checked = prefs.showNames;
    els.showMetaCb.checked = prefs.showMeta;
    els.favoritesBtn.classList.toggle('active', prefs.favoritesOnly);
    document.documentElement.style.setProperty('--thumb-min', prefs.thumbMin + 'px');
  }
  function persistPrefs() { DCState.savePrefs(localStorage, prefs); }
  function persistUsage() { DCState.saveUsageMeta(localStorage, usageMeta); }

  function boot() {
    DCBridge.call('getLibraryPath', [], function (savedPath) {
      if (savedPath && savedPath !== 'null') {
        libraryPath = savedPath;
        verifyAndLoad();
      } else {
        show('welcome');
      }
    });
  }

  function verifyAndLoad() {
    DCBridge.call('checkLibraryPath', [libraryPath], function (status) {
      if (status === 'ok') {
        show('app');
        loadLibrary();
      } else {
        els.driveMissingPath.textContent = libraryPath;
        show('driveMissing');
      }
    });
  }

  function selectLibraryFolder() {
    spinner(true);
    DCBridge.call('selectLibraryFolder', [], function (path) {
      spinner(false);
      if (path && path !== 'null') {
        libraryPath = path;
        verifyAndLoad();
      }
    });
  }

  function loadLibrary() {
    if (!DCBridge.acquire('loading library')) return;
    spinner(true);
    DCBridge.call('getStashedComps', [libraryPath], function (result) {
      try {
        allComps = (result && result !== '[]') ? JSON.parse(result) : [];
        var r = DCState.cleanupStaleMetadata(usageMeta, allComps);
        if (r.removed > 0) { usageMeta = r.usageMeta; persistUsage(); }
        rerender();
      } catch (e) {
        toast('Error loading library.', true);
      } finally {
        spinner(false);
        DCBridge.release();
      }
    });
  }

  function refreshLibrary() {
    closeModal(els.settingsModal);
    if (!DCBridge.acquire('refreshing')) { toast('Busy: ' + DCBridge.busyWith(), true); return; }
    spinner(true);
    DCBridge.call('rebuildLibraryIndex', [libraryPath], function (result) {
      try {
        allComps = (result && result !== '[]') ? JSON.parse(result) : [];
        rerender();
        toast('Library refreshed.', false);
      } catch (e) {
        toast('Error refreshing library.', true);
      } finally {
        spinner(false);
        DCBridge.release();
      }
    });
  }

  function rerender() {
    var filtered = DCState.filterComps(allComps, {
      search: els.search.value,
      favoritesOnly: prefs.favoritesOnly,
      usageMeta: usageMeta
    });
    var groups = DCState.groupByCategory(filtered).map(function (g) {
      return { category: g.category, items: DCState.sortComps(g.items, prefs.sort, usageMeta) };
    });
    var msg = allComps.length === 0
      ? 'Your library is empty. Stash a comp or add an .aep.'
      : 'No items match.';
    DCRender.render(els.library, groups, prefs, usageMeta, busts, msg);
  }

  function findComp(uniqueId) {
    for (var i = 0; i < allComps.length; i++) {
      if (allComps[i].uniqueId === uniqueId) return allComps[i];
    }
    return null;
  }

  function openCategoryModal(mode) {
    modalMode = mode;
    els.categoryModalTitle.textContent = mode === 'stash' ? 'Add Composition' : 'Add .aep to Library';
    var categories = [];
    allComps.forEach(function (c) {
      if (categories.indexOf(c.category) === -1) categories.push(c.category);
    });
    categories.sort();
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

  function stashFlow() { openCategoryModal('stash'); }

  function addAepFlow() {
    DCBridge.call('pickAepFile', [], function (result) {
      var r = DCBridge.parseJson(result);
      if (!r) { toast('Error: unexpected response.', true); return; }
      if (r.cancelled) return;
      if (!r.ok) { toast(r.error, true); return; }
      pendingAepPath = r.path;
      openCategoryModal('addAep');
    });
  }

  function confirmCategoryModal() {
    var categoryName = els.newCategoryInput.value.trim() || els.existingCategorySelect.value;
    var v = DCValidate.validateName(categoryName, 'Category name');
    if (!v.valid) { toast(v.error, true); return; }
    categoryName = v.name;
    closeModal(els.categoryModal);

    if (modalMode === 'stash') {
      if (!DCBridge.acquire('stashing')) { toast('Busy: ' + DCBridge.busyWith(), true); return; }
      els.addCompBtn.disabled = true;
      spinner(true);
      DCBridge.call('stashSelectedComp', [libraryPath, categoryName], function (result) {
        spinner(false);
        els.addCompBtn.disabled = false;
        toast(result, isError(result));
        DCBridge.release();
        if (!isError(result)) loadLibrary();
      });
    } else {
      if (!DCBridge.acquire('adding aep')) { toast('Busy: ' + DCBridge.busyWith(), true); return; }
      spinner(true);
      DCBridge.call('addExternalAep', [libraryPath, categoryName, pendingAepPath], function (result) {
        spinner(false);
        DCBridge.release();
        var r = DCBridge.parseJson(result);
        if (r && r.ok) {
          toast("'" + r.name + "' added" + (r.thumbOk ? '.' : ' (thumbnail failed - use Generate).'), false);
          loadLibrary();
        } else {
          toast((r && r.error) || result, true);
        }
        pendingAepPath = null;
      });
    }
  }

  function importItem(uniqueId, isRetry) {
    var comp = findComp(uniqueId);
    if (!comp) return;
    if (!DCBridge.acquire('importing')) { toast('Busy: ' + DCBridge.busyWith(), true); return; }
    var u = DCState.getUsage(usageMeta, uniqueId);
    usageMeta[uniqueId] = { lastUsed: Date.now(), useCount: u.useCount + 1, isFavorite: u.isFavorite };
    persistUsage();
    DCBridge.call('importComp', [comp.aepPath], function (result) {
      DCBridge.release();
      if (isError(result) && result.indexOf('not found') !== -1 && !isRetry) {
        DCBridge.call('rebuildLibraryIndex', [libraryPath], function (rebuilt) {
          try { allComps = (rebuilt && rebuilt !== '[]') ? JSON.parse(rebuilt) : []; } catch (e) { allComps = []; }
          rerender();
          if (findComp(uniqueId)) importItem(uniqueId, true);
          else toast('Error: item missing on disk - library re-indexed.', true);
        });
        return;
      }
      toast(result, isError(result));
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
    els.renameModal.classList.remove('hidden');
    els.newNameInput.value = comp.name;
    els.newNameInput.focus();
    els.newNameInput.select();
  }

  function confirmRename() {
    if (!renameTarget) return;
    var newName = els.newNameInput.value.trim();
    if (!newName || newName === renameTarget.oldName) {
      closeModal(els.renameModal);
      renameTarget = null;
      return;
    }
    var v = DCValidate.validateName(newName, 'Name');
    if (!v.valid) { toast(v.error, true); return; }
    if (!DCBridge.acquire('renaming')) { toast('Busy: ' + DCBridge.busyWith(), true); return; }
    closeModal(els.renameModal);
    spinner(true);
    var t = renameTarget;
    renameTarget = null;
    DCBridge.call('renameStashedComp', [libraryPath, t.category, t.uniqueId, v.name], function (result) {
      spinner(false);
      DCBridge.release();
      var r = DCBridge.parseJson(result);
      if (r && r.ok) {
        DCState.migrateMetadataKey(usageMeta, t.uniqueId, r.newUniqueId);
        persistUsage();
        toast('Renamed.', false);
        loadLibrary();
      } else {
        toast((r && r.error) || result, true);
      }
    });
  }

  function deleteFlow(uniqueId, category) {
    var comp = findComp(uniqueId);
    if (!comp) return;
    deleteTarget = { uniqueId: uniqueId, category: category };
    els.deleteName.textContent = comp.name;
    els.deleteModal.classList.remove('hidden');
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    if (!DCBridge.acquire('deleting')) { toast('Busy: ' + DCBridge.busyWith(), true); return; }
    closeModal(els.deleteModal);
    spinner(true);
    var t = deleteTarget;
    deleteTarget = null;
    DCBridge.call('deleteStashedComp', [libraryPath, t.category, t.uniqueId], function (result) {
      spinner(false);
      DCBridge.release();
      if (result === 'Success') {
        toast('Deleted.', false);
        loadLibrary();
      } else {
        toast(result, true);
      }
    });
  }

  function generateThumb(uniqueId, category) {
    if (!DCBridge.acquire('generating thumbnail')) { toast('Busy: ' + DCBridge.busyWith(), true); return; }
    spinner(true);
    DCBridge.call('generateThumbForItem', [libraryPath, category, uniqueId], function (result) {
      spinner(false);
      DCBridge.release();
      var r = DCBridge.parseJson(result);
      if (r && r.ok) {
        busts[uniqueId] = Date.now();
        toast(r.thumbOk ? 'Thumbnail generated.' : 'Info updated, but the frame render failed.', !r.thumbOk);
        loadLibrary();
      } else {
        toast((r && r.error) || result, true);
      }
    });
  }

  function setThumb(uniqueId, category) {
    if (!DCBridge.acquire('setting thumbnail')) { toast('Busy: ' + DCBridge.busyWith(), true); return; }
    spinner(true);
    DCBridge.call('setThumbFromActiveComp', [libraryPath, category, uniqueId], function (result) {
      spinner(false);
      DCBridge.release();
      var r = DCBridge.parseJson(result);
      if (r && r.ok) {
        busts[uniqueId] = Date.now();
        toast('Thumbnail set from current frame.', false);
        loadLibrary();
      } else {
        toast((r && r.error) || result, true);
      }
    });
  }

  function revealItem(uniqueId, category) {
    DCBridge.call('revealInFinder', [libraryPath + '/' + category + '/' + uniqueId], function (result) {
      if (result !== 'ok') toast(result, true);
    });
  }

  function toggleSection(category) {
    var i = prefs.collapsed.indexOf(category);
    if (i === -1) prefs.collapsed.push(category);
    else prefs.collapsed.splice(i, 1);
    persistPrefs();
    rerender();
  }

  function openSettings() {
    els.settingsPath.textContent = libraryPath || 'No path set.';
    els.settingsModal.classList.remove('hidden');
  }
  function openLibraryInFinder() {
    DCBridge.call('revealInFinder', [libraryPath], function (result) {
      if (result !== 'ok') toast(result, true);
    });
  }
  function changeFolder() {
    closeModal(els.settingsModal);
    selectLibraryFolder();
  }

  function onSearch() { rerender(); }
  function onSortChange() { prefs.sort = els.sortSelect.value; persistPrefs(); rerender(); }
  function onFavoritesToggle() {
    prefs.favoritesOnly = !prefs.favoritesOnly;
    els.favoritesBtn.classList.toggle('active', prefs.favoritesOnly);
    persistPrefs();
    rerender();
  }
  function onDisplayChange() {
    prefs.showNames = els.showNamesCb.checked;
    prefs.showMeta = els.showMetaCb.checked;
    persistPrefs();
    rerender();
  }
  function onSlider() {
    prefs.thumbMin = parseInt(els.thumbSlider.value, 10);
    document.documentElement.style.setProperty('--thumb-min', prefs.thumbMin + 'px');
    persistPrefs();
  }

  function closeModal(modal) { modal.classList.add('hidden'); }
  function closeAllModals() {
    [els.categoryModal, els.renameModal, els.deleteModal, els.settingsModal].forEach(closeModal);
    els.displayMenu.classList.add('hidden');
    renameTarget = null;
    deleteTarget = null;
  }

  return {
    init: init, boot: boot, selectLibraryFolder: selectLibraryFolder, verifyAndLoad: verifyAndLoad,
    loadLibrary: loadLibrary, refreshLibrary: refreshLibrary, rerender: rerender,
    stashFlow: stashFlow, addAepFlow: addAepFlow, confirmCategoryModal: confirmCategoryModal,
    importItem: importItem, toggleFavorite: toggleFavorite,
    renameFlow: renameFlow, confirmRename: confirmRename,
    deleteFlow: deleteFlow, confirmDelete: confirmDelete,
    generateThumb: generateThumb, setThumb: setThumb, revealItem: revealItem,
    toggleSection: toggleSection,
    openSettings: openSettings, openLibraryInFinder: openLibraryInFinder, changeFolder: changeFolder,
    onSearch: onSearch, onSortChange: onSortChange, onFavoritesToggle: onFavoritesToggle,
    onDisplayChange: onDisplayChange, onSlider: onSlider,
    closeModal: closeModal, closeAllModals: closeAllModals
  };
}());
