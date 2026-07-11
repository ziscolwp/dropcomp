// TODO: split by concern - library rendering, actions, and drag-move wiring.
var DCLibrary = (function () {
  'use strict';

  var allComps = [];
  var usageMeta = {};
  var busts = {};
  var pendingAepPath = null;
  var renameTarget = null;
  var renameCategoryTarget = null;
  var deleteTarget = null;
  var dragCard = null;
  var loadedOnce = false;
  var DRAG_MIME = 'application/x-dropcomp-library-card';

  function init() { usageMeta = DCState.loadUsageMeta(localStorage); }

  function els() { return DCShell.getEls(); }
  function libPath() { return DCShell.getLibraryPath(); }
  function persistUsage() { DCState.saveUsageMeta(localStorage, usageMeta); }

  function ensureLoaded() {
    if (loadedOnce) rerender();
    else load();
  }
  function resetLoaded() { loadedOnce = false; }

  function load() {
    if (!DCBridge.acquire('loading library')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
    DCUI.spinner(true);
    DCBridge.call('getStashedComps', [libPath()], function (result) {
      try {
        allComps = (result && result !== '[]') ? JSON.parse(result) : [];
        loadedOnce = true;
        var r = DCState.cleanupStaleMetadata(usageMeta, allComps);
        if (r.removed > 0) { usageMeta = r.usageMeta; persistUsage(); }
        rerender();
      } catch (e) {
        DCUI.toast('Error loading library.', true);
      } finally {
        DCUI.spinner(false);
        DCBridge.release();
      }
    });
  }

  function refresh() {
    if (!DCBridge.acquire('refreshing')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
    DCUI.spinner(true);
    DCBridge.call('rebuildLibraryIndex', [libPath()], function (result) {
      try {
        allComps = (result && result !== '[]') ? JSON.parse(result) : [];
        loadedOnce = true;
        rerender();
        DCUI.toast('Library refreshed.', false);
      } catch (e) {
        DCUI.toast('Error refreshing library.', true);
      } finally {
        DCUI.spinner(false);
        DCBridge.release();
      }
    });
  }

  function rerender() {
    // a load finishing after the user switched tabs must not paint over the other tab
    if (DCShell.getPrefs().activeTab === 'assets' && typeof DCAssets !== 'undefined') return;
    var prefs = DCShell.getPrefs();
    var filtered = DCState.filterComps(allComps, {
      search: els().search.value,
      favoritesOnly: prefs.favoritesOnly,
      usageMeta: usageMeta
    });
    var groups = DCState.groupByCategory(filtered).map(function (g) {
      return { category: g.category, items: DCState.sortComps(g.items, prefs.sort, usageMeta) };
    });
    var msg = allComps.length === 0
      ? 'Your library is empty. Stash a comp or add an .aep.'
      : 'No items match.';
    DCRender.render(els().library, groups, prefs, usageMeta, busts, msg);
  }

  function findComp(uniqueId) {
    for (var i = 0; i < allComps.length; i++) {
      if (allComps[i].uniqueId === uniqueId) return allComps[i];
    }
    return null;
  }

  function categories() {
    var cats = [];
    allComps.forEach(function (c) {
      if (cats.indexOf(c.category) === -1) cats.push(c.category);
    });
    cats.sort();
    return cats;
  }

  function stashFlow() {
    DCUI.openCategoryModal('stash', 'Add Composition', categories());
  }

  function addAepFlow() {
    DCBridge.call('pickAepFile', [], function (result) {
      var r = DCBridge.parseJson(result);
      if (!r) { DCUI.toast('Error: unexpected response.', true); return; }
      if (r.cancelled) return;
      if (!r.ok) { DCUI.toast(r.error, true); return; }
      pendingAepPath = r.path;
      DCUI.openCategoryModal('addAep', 'Add AE Project to Library', categories());
    });
  }

  function confirmCategory(mode, categoryName) {
    if (mode === 'stash') {
      // acquire before closing so a busy bridge keeps the typed category in the modal
      if (!DCBridge.acquire('stashing')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
      DCUI.closeModal(els().categoryModal);
      els().addCompBtn.disabled = true;
      DCUI.spinner(true);
      DCBridge.call('stashSelectedComp', [libPath(), categoryName], function (result) {
        DCUI.spinner(false);
        els().addCompBtn.disabled = false;
        DCUI.toast(result, DCUI.isError(result));
        DCBridge.release();
        if (!DCUI.isError(result)) load();
      });
    } else {
      if (!DCBridge.acquire('adding aep')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
      DCUI.closeModal(els().categoryModal);
      DCUI.spinner(true);
      DCBridge.call('addExternalAep', [libPath(), categoryName, pendingAepPath], function (result) {
        DCUI.spinner(false);
        DCBridge.release();
        var r = DCBridge.parseJson(result);
        if (r && r.ok) {
          // r.warning: item landed but the capture import failed (host keeps
          // it because thumbnails/metadata can be regenerated later)
          if (r.warning) DCUI.toast("'" + r.name + "' added, but: " + r.warning, true);
          else DCUI.toast("'" + r.name + "' added" + (r.thumbOk ? '.' : ' (thumbnail failed - use Generate).'), false);
          load();
        } else {
          DCUI.toast((r && r.error) || result, true);
        }
        pendingAepPath = null;
      });
    }
  }

  function importItem(uniqueId, isRetry) {
    var comp = findComp(uniqueId);
    if (!comp) return;
    if (!DCBridge.acquire('importing')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
    var u = DCState.getUsage(usageMeta, uniqueId);
    usageMeta[uniqueId] = { lastUsed: Date.now(), useCount: u.useCount + 1, isFavorite: u.isFavorite };
    persistUsage();
    DCBridge.call('importComp', [comp.aepPath], function (result) {
      DCBridge.release();
      if (DCUI.isError(result) && result.indexOf('not found') !== -1 && !isRetry) {
        DCBridge.call('rebuildLibraryIndex', [libPath()], function (rebuilt) {
          try { allComps = (rebuilt && rebuilt !== '[]') ? JSON.parse(rebuilt) : []; } catch (e) { allComps = []; }
          rerender();
          if (findComp(uniqueId)) importItem(uniqueId, true);
          else DCUI.toast('Error: item missing on disk - library re-indexed.', true);
        });
        return;
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
    var comp = findComp(uniqueId);
    if (!comp) return;
    renameCategoryTarget = null;
    renameTarget = { uniqueId: uniqueId, category: category, oldName: comp.name };
    DCUI.openRenameModal('library', comp.name);
  }

  // Rename a whole category folder (reuses the shared rename modal).
  function renameCategoryFlow(category) {
    if (!category) return;
    renameTarget = null;
    renameCategoryTarget = category;
    DCUI.openRenameModal('library', category);
  }

  function confirmCategoryRename() {
    var oldName = renameCategoryTarget;
    var newName = els().newNameInput.value.trim();
    if (!newName || newName === oldName) {
      DCUI.closeModal(els().renameModal);
      renameCategoryTarget = null;
      return;
    }
    var v = DCValidate.validateName(newName, 'Folder name');
    if (!v.valid) { DCUI.toast(v.error, true); return; }
    if (!DCBridge.acquire('renaming folder')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
    DCUI.closeModal(els().renameModal);
    DCUI.spinner(true);
    renameCategoryTarget = null;
    DCBridge.call('renameCategory', [libPath(), oldName, v.name], function (result) {
      DCUI.spinner(false);
      DCBridge.release();
      var r = DCBridge.parseJson(result);
      if (r && r.ok) {
        // keep the section's collapsed state under its new name
        var prefs = DCShell.getPrefs();
        var ci = prefs.collapsed.indexOf(oldName);
        if (ci !== -1) { prefs.collapsed.splice(ci, 1, v.name); DCShell.persistPrefs(); }
        DCUI.toast('Folder renamed to "' + v.name + '".', false);
        load();
      } else {
        DCUI.toast((r && r.error) || result, true);
      }
    });
  }

  function confirmRename() {
    if (renameCategoryTarget) { confirmCategoryRename(); return; }
    if (!renameTarget) return;
    var newName = els().newNameInput.value.trim();
    if (!newName || newName === renameTarget.oldName) {
      DCUI.closeModal(els().renameModal);
      renameTarget = null;
      return;
    }
    var v = DCValidate.validateName(newName, 'Name');
    if (!v.valid) { DCUI.toast(v.error, true); return; }
    if (!DCBridge.acquire('renaming')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
    DCUI.closeModal(els().renameModal);
    DCUI.spinner(true);
    var t = renameTarget;
    renameTarget = null;
    DCBridge.call('renameStashedComp', [libPath(), t.category, t.uniqueId, v.name], function (result) {
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
    var comp = findComp(uniqueId);
    if (!comp) return;
    deleteTarget = { uniqueId: uniqueId, category: category };
    DCUI.openDeleteModal('library', comp.name);
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    if (!DCBridge.acquire('deleting')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
    DCUI.closeModal(els().deleteModal);
    DCUI.spinner(true);
    var t = deleteTarget;
    deleteTarget = null;
    DCBridge.call('deleteStashedComp', [libPath(), t.category, t.uniqueId], function (result) {
      DCUI.spinner(false);
      DCBridge.release();
      if (result === 'Success') {
        DCUI.toast('Deleted.', false);
        load();
      } else {
        DCUI.toast(result, true);
      }
    });
  }

  function generateThumb(uniqueId, category) {
    if (!DCBridge.acquire('generating thumbnail')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
    DCUI.spinner(true);
    DCBridge.call('generateThumbForItem', [libPath(), category, uniqueId], function (result) {
      DCUI.spinner(false);
      DCBridge.release();
      var r = DCBridge.parseJson(result);
      if (r && r.ok) {
        busts[uniqueId] = Date.now();
        DCUI.toast(r.thumbOk ? 'Thumbnail generated.' : 'Info updated, but the frame render failed.', !r.thumbOk);
        load();
      } else {
        DCUI.toast((r && r.error) || result, true);
      }
    });
  }

  function setThumb(uniqueId, category) {
    if (!DCBridge.acquire('setting thumbnail')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
    DCUI.spinner(true);
    DCBridge.call('setThumbFromActiveComp', [libPath(), category, uniqueId], function (result) {
      DCUI.spinner(false);
      DCBridge.release();
      var r = DCBridge.parseJson(result);
      if (r && r.ok) {
        busts[uniqueId] = Date.now();
        DCUI.toast('Thumbnail set from current frame.', false);
        load();
      } else {
        DCUI.toast((r && r.error) || result, true);
      }
    });
  }

  function revealItem(uniqueId, category) {
    DCBridge.call('revealInFinder', [libPath() + '/' + category + '/' + uniqueId], function (result) {
      if (result !== 'ok') DCUI.toast(result, true);
    });
  }

  function moveToCategory(uniqueId, fromCategory, targetCategory) {
    var comp = findComp(uniqueId);
    var sourceCategory = comp ? comp.category : fromCategory;
    if (!comp || !targetCategory || targetCategory === sourceCategory) return false;
    if (!DCBridge.acquire('moving card')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return false; }
    DCUI.spinner(true);
    DCBridge.call('moveStashedComp', [libPath(), sourceCategory, uniqueId, targetCategory], function (result) {
      DCUI.spinner(false);
      DCBridge.release();
      var r = DCBridge.parseJson(result);
      if (r && r.ok) {
        DCUI.toast('Moved to ' + targetCategory + '.', false);
        load();
      } else {
        DCUI.toast((r && r.error) || result, true);
      }
    });
    return true;
  }

  function closestCategory(target) {
    return target && target.closest ? target.closest('.category') : null;
  }

  function closestLibraryCard(target) {
    var card = target && target.closest ? target.closest('.card') : null;
    return card && card.dataset && card.dataset.dragKind === 'library-card' ? card : null;
  }

  function canDropOn(section) {
    return dragCard && section && section.dataset &&
      section.dataset.category && section.dataset.category !== dragCard.category;
  }

  function clearDropTarget(target) {
    var section = closestCategory(target);
    if (section && section.classList) section.classList.remove('drop-target');
  }

  function clearAllDropTargets() {
    var root = els().library;
    if (!root || !root.querySelectorAll) return;
    var nodes = root.querySelectorAll('.drop-target');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].classList) nodes[i].classList.remove('drop-target');
    }
  }

  function attachMoveTarget(target) {
    if (!target || !target.addEventListener) return;
    target.addEventListener('dragstart', function (e) {
      if (DCShell.getPrefs().activeTab !== 'library') return;
      var card = closestLibraryCard(e.target);
      if (!card) return;
      dragCard = { uniqueId: card.dataset.uniqueId, category: card.dataset.category };
      if (e.dataTransfer) {
        try { e.dataTransfer.effectAllowed = 'move'; } catch (effErr) { }
        try { e.dataTransfer.setData(DRAG_MIME, JSON.stringify(dragCard)); } catch (setErr) { }
        try { e.dataTransfer.setData('text/plain', dragCard.uniqueId); } catch (textErr) { }
      }
      if (card.classList) card.classList.add('dragging');
    });
    target.addEventListener('dragover', function (e) {
      var section = closestCategory(e.target);
      if (!canDropOn(section)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) {
        try { e.dataTransfer.dropEffect = 'move'; } catch (dropErr) { }
      }
      if (section.classList) section.classList.add('drop-target');
    });
    target.addEventListener('dragleave', function (e) {
      var section = closestCategory(e.target);
      if (section && (!e.relatedTarget || !section.contains(e.relatedTarget)) && section.classList) {
        section.classList.remove('drop-target');
      }
    });
    target.addEventListener('drop', function (e) {
      var section = closestCategory(e.target);
      if (!canDropOn(section)) return;
      e.preventDefault();
      e.stopPropagation();
      var card = dragCard;
      dragCard = null;
      clearAllDropTargets();
      moveToCategory(card.uniqueId, card.category, section.dataset.category);
    });
    target.addEventListener('dragend', function (e) {
      var card = closestLibraryCard(e.target);
      if (card && card.classList) card.classList.remove('dragging');
      clearDropTarget(e.target);
      clearAllDropTargets();
      dragCard = null;
    });
  }

  function relinkMissing() {
    if (!DCBridge.acquire('relinking footage')) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
    DCUI.spinner(true);
    DCBridge.call('relinkMissingFootage', [libPath()], function (result) {
      DCUI.spinner(false);
      DCBridge.release();
      var r = DCBridge.parseJson(result);
      if (r && r.ok) {
        if (r.missing === 0) {
          DCUI.toast('No missing footage in this project.', false);
        } else if (r.relinked === r.missing) {
          DCUI.toast('Relinked all ' + r.relinked + ' missing file' + (r.relinked === 1 ? '' : 's') + '. Save your project.', false, 5000);
        } else {
          var names = (r.notFound || []).slice(0, 3).join(', ');
          var more = (r.notFound || []).length > 3 ? ' +' + (r.notFound.length - 3) + ' more' : '';
          DCUI.toast('Relinked ' + r.relinked + ' of ' + r.missing +
            (r.relinked > 0 ? ' - save your project.' : '.') +
            (names ? ' Not found: ' + names + more : ''), r.relinked === 0, 7000);
          console.warn('DropComp relink - not found:', r.notFound);
        }
      } else {
        DCUI.toast((r && r.error) || result, true);
      }
    });
  }

  function toggleSection(category) {
    var prefs = DCShell.getPrefs();
    var i = prefs.collapsed.indexOf(category);
    if (i === -1) prefs.collapsed.push(category);
    else prefs.collapsed.splice(i, 1);
    DCShell.persistPrefs();
    rerender();
  }

  function onCardAction(action, uniqueId, category) {
    if (action === 'import') importItem(uniqueId);
    else if (action === 'favorite') toggleFavorite(uniqueId);
    else if (action === 'rename') renameFlow(uniqueId, category);
    else if (action === 'delete') deleteFlow(uniqueId, category);
    else if (action === 'generate') generateThumb(uniqueId, category);
    else if (action === 'setThumb') setThumb(uniqueId, category);
    else if (action === 'reveal') revealItem(uniqueId, category);
  }

  function clearPending() {
    renameTarget = null;
    renameCategoryTarget = null;
    deleteTarget = null;
    dragCard = null;
    clearAllDropTargets();
  }

  return {
    init: init, load: load, refresh: refresh, rerender: rerender,
    ensureLoaded: ensureLoaded, resetLoaded: resetLoaded,
    attachMoveTarget: attachMoveTarget, moveToCategory: moveToCategory,
    stashFlow: stashFlow, addAepFlow: addAepFlow, confirmCategory: confirmCategory,
    importItem: importItem, confirmRename: confirmRename, confirmDelete: confirmDelete,
    renameCategoryFlow: renameCategoryFlow,
    relinkMissing: relinkMissing, toggleSection: toggleSection,
    onCardAction: onCardAction, clearPending: clearPending
  };
}());
