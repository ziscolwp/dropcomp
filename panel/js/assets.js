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
    if (!DCBridge.acquire('loading assets')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
    DCUI.spinner(true);
    DCBridge.call('getAssets', [libPath()], function (result) {
      try {
        // a host error must not masquerade as an empty library
        if (DCUI.isError(result)) { DCUI.toast(result, true); return; }
        allAssets = (result && result !== '[]') ? JSON.parse(result) : [];
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
        if (DCUI.isError(result)) { DCUI.toast(result, true); return; }
        allAssets = (result && result !== '[]') ? JSON.parse(result) : [];
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
    // a load finishing after the user switched tabs must not paint over the other tab
    if (DCShell.getPrefs().activeTab !== 'assets') return;
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
      ? 'No assets yet. Click Add Assets to add images or vectors.'
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

  function normalizeFileUri(value) {
    var s = String(value || '').replace(/^\s+|\s+$/g, '');
    if (!/^file:\/\//i.test(s)) return '';
    var path = s.replace(/^file:\/\//i, '');
    if (path.indexOf('localhost/') === 0) path = path.slice('localhost/'.length);
    if (path.charAt(0) !== '/') path = '/' + path;
    try { path = decodeURIComponent(path); } catch (e) { }
    if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
    return path;
  }

  function normalizeDroppedPath(value) {
    if (!value) return '';
    var s = String(value).replace(/^\s+|\s+$/g, '');
    if (/^file:\/\//i.test(s)) return normalizeFileUri(s);
    return s;
  }

  function pathFromDroppedFile(file) {
    if (!file) return '';
    return normalizeDroppedPath(file.path || file.fsName || file.fullPath || '');
  }

  function addPath(paths, seen, path) {
    if (!path || seen[path]) return;
    seen[path] = true;
    paths.push(path);
  }

  function collectUriListPaths(dataTransfer, paths, seen) {
    if (!dataTransfer || typeof dataTransfer.getData !== 'function') return;
    var list = dataTransfer.getData('text/uri-list') || '';
    if (!list) return;
    var lines = String(list).split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      if (!lines[i] || lines[i].charAt(0) === '#') continue;
      addPath(paths, seen, normalizeFileUri(lines[i]));
    }
  }

  function collectDroppedPaths(dataTransfer) {
    var paths = [];
    var seen = {};
    if (!dataTransfer) return paths;
    var files = dataTransfer.files || [];
    for (var i = 0; i < files.length; i++) {
      addPath(paths, seen, pathFromDroppedFile(files[i]));
    }
    collectUriListPaths(dataTransfer, paths, seen);
    return paths;
  }

  function hasDroppedFileData(dataTransfer) {
    if (!dataTransfer) return false;
    if (dataTransfer.files && dataTransfer.files.length) return true;
    var types = dataTransfer.types || [];
    for (var i = 0; i < types.length; i++) {
      if (types[i] === 'Files' || types[i] === 'text/uri-list') return true;
    }
    return false;
  }

  function addDroppedFiles(dataTransfer) {
    var paths = collectDroppedPaths(dataTransfer);
    if (!paths.length) return false;
    pendingPaths = paths;
    DCShell.setActiveTab('assets');
    DCUI.openCategoryModal('addAssets', 'Add Assets', categories());
    return true;
  }

  function attachDropTarget(target) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener('dragover', function (e) {
      if (!hasDroppedFileData(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      try { e.dataTransfer.dropEffect = 'copy'; } catch (eDrop) { }
    });
    target.addEventListener('drop', function (e) {
      if (!hasDroppedFileData(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      if (!addDroppedFiles(e.dataTransfer)) {
        DCUI.toast('Could not read dropped file paths.', true, 5000);
      }
    });
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

  // Adds the original image file(s) behind the current AE selection. The host
  // resolves selection -> source paths; the rest reuses the Add Assets flow.
  function addSelectedFlow() {
    DCBridge.call('getSelectedFootagePaths', [], function (result) {
      var r = DCBridge.parseJson(result);
      if (!r) { DCUI.toast('Error: unexpected response.', true); return; }
      if (!r.ok) { DCUI.toast(r.error, true, 6000); return; }
      pendingPaths = r.paths;
      DCUI.openCategoryModal('addAssets', 'Add Selected Image', categories());
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
        if (r.added === 0) {
          DCUI.toast('No supported image files selected (png, jpg, gif, bmp, tif, tga, psd, ai, eps, svg).', true, 6000);
          return;
        }
        var msg = r.added + ' asset' + (r.added === 1 ? '' : 's') + ' added.';
        if (r.skipped && r.skipped.length) {
          msg += ' Skipped: ' + r.skipped.slice(0, 3).join(', ') +
            (r.skipped.length > 3 ? ' +' + (r.skipped.length - 3) + ' more' : '');
        }
        DCUI.toast(msg, false, r.skipped && r.skipped.length ? 6000 : 3000);
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
    addFlow: addFlow, addSelectedFlow: addSelectedFlow,
    addDroppedFiles: addDroppedFiles, attachDropTarget: attachDropTarget,
    confirmCategory: confirmCategory,
    importItem: importItem, confirmRename: confirmRename, confirmDelete: confirmDelete,
    toggleSection: toggleSection, onCardAction: onCardAction, clearPending: clearPending
  };
}());
if (typeof module !== 'undefined' && module.exports) { module.exports = DCAssets; }
