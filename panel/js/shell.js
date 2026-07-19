var DCShell = (function () {
  'use strict';

  var els = null;
  var prefs = null;
  var libraryPath = null;
  var panelMode = 'full';

  function hasAssets() { return typeof DCAssets !== 'undefined'; }
  function hasTools() { return typeof DCTools !== 'undefined'; }
  function hasScripts() { return typeof DCScripts !== 'undefined'; }
  function hasSync() { return typeof DCSync !== 'undefined'; }

  // Prefs live in localStorage shared by every DropComp panel. A standalone
  // panel pins its own activeTab after every (re)load so a tab remembered by
  // the main panel can never leak into it.
  function reloadPrefs() {
    prefs = DCState.loadPrefs(localStorage);
    if (panelMode !== 'full') prefs.activeTab = panelMode;
  }

  function init(elements, mode) {
    els = elements;
    panelMode = mode || 'full';
    reloadPrefs();
    applyPrefsToControls();
  }

  function getMode() { return panelMode; }

  function getEls() { return els; }
  function getPrefs() { return prefs; }
  function getLibraryPath() { return libraryPath; }
  function recentCategories(scope) { return DCState.recentCategories(prefs, scope); }
  // The thumb-size slider persists on every input event while dragging, so the
  // cross-panel prefs broadcast is trailing-debounced instead of per-call.
  var prefsBroadcastTimer = null;
  function persistPrefs() {
    DCState.savePrefsForMode(localStorage, prefs, panelMode);
    if (!hasSync()) return;
    clearTimeout(prefsBroadcastTimer);
    prefsBroadcastTimer = setTimeout(function () { DCSync.broadcast('prefs'); }, 200);
  }

  function activeModule() {
    return (prefs.activeTab === 'assets' && hasAssets()) ? DCAssets : DCLibrary;
  }

  function applyPrefsToControls() {
    els.sortSelect.value = prefs.sort;
    els.thumbSlider.value = prefs.thumbMin;
    els.showNamesCb.checked = prefs.showNames;
    els.showMetaCb.checked = prefs.showMeta;
    if (els.folderLayoutSelect) els.folderLayoutSelect.value = DCState.normalizeFolderLayout(prefs.folderLayout);
    if (els.folderColsCb) els.folderColsCb.checked = prefs.folderColumns;
    els.favoritesBtn.classList.toggle('active', prefs.favoritesOnly);
    applyGridSize();
    applyFolderColumns();
    applyView();
  }

  // Folder columns is a pure layout class on the shared #library element; it
  // survives tab switches, so it only needs (re)applying at init and on change.
  function applyFolderColumns() {
    els.library.classList.toggle('folders-cols', DCState.isFolderColumns(prefs));
  }

  function applyGridSize() {
    document.documentElement.style.setProperty('--thumb-min', prefs.thumbMin + 'px');
    var cls = DCState.gridSizeClass(prefs.thumbMin);
    ['grid--s', 'grid--m', 'grid--l'].forEach(function (c) {
      els.library.classList.toggle(c, c === cls);
    });
  }

  function viewKey() { return prefs.activeTab === 'assets' ? 'viewModeAssets' : 'viewMode'; }
  function currentViewMode() { return DCState.normalizeViewMode(prefs[viewKey()]); }

  function applyView() {
    var mode = currentViewMode();
    var cls = DCState.viewClass(mode);
    ['view-comfortable', 'view-compact', 'view-list'].forEach(function (c) {
      els.library.classList.toggle(c, c === cls);
    });
    els.thumbSlider.classList.toggle('hidden', mode !== 'comfortable');
    if (els.viewSwitch) {
      var btns = els.viewSwitch.querySelectorAll('[data-view]');
      for (var i = 0; i < btns.length; i++) {
        var on = btns[i].getAttribute('data-view') === mode;
        btns[i].classList.toggle('active', on);
        btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
  }

  function onViewChange(mode) {
    if (prefs.activeTab !== 'library' && prefs.activeTab !== 'assets') return;
    prefs[viewKey()] = DCState.normalizeViewMode(mode);
    persistPrefs();
    applyView();
    activeModule().rerender();
  }

  function boot() {
    if (panelMode === 'tools') {
      // tools never touch the library; boot straight to a usable panel even
      // with no library configured or the drive missing
      DCUI.show('app');
      setActiveTab('tools', true);
      return;
    }
    DCBridge.call('getLibraryPath', [], function (savedPath) {
      if (savedPath && savedPath !== 'null') {
        libraryPath = savedPath;
        verifyAndLoad();
      } else {
        DCUI.show('welcome');
      }
    });
  }

  function verifyAndLoad() {
    DCBridge.call('checkLibraryPath', [libraryPath], function (status) {
      if (status === 'ok') {
        DCUI.show('app');
        // boot / retry / folder change all re-read disk, never cached tab data
        DCLibrary.resetLoaded();
        if (hasAssets()) DCAssets.resetLoaded();
        if (hasScripts()) DCScripts.resetLoaded();
        setActiveTab(prefs.activeTab, true);
      } else {
        els.driveMissingPath.textContent = libraryPath;
        DCUI.show('driveMissing');
      }
    });
  }

  // Rail tabs are ARIA tabs: the visual active state, aria-selected and the
  // roving tabindex all move together, whoever triggered the change.
  function syncRailTab(btn, on) {
    if (!btn) return;
    btn.classList.toggle('active', on);
    if (btn.setAttribute) {
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      btn.setAttribute('tabindex', on ? '0' : '-1');
    }
  }

  function setActiveTab(tab, skipPersist) {
    if (panelMode !== 'full') { tab = panelMode; skipPersist = true; }
    prefs.activeTab = DCState.resolveActiveTab(tab, hasAssets(), hasTools(), hasScripts());
    if (!skipPersist) persistPrefs();
    var isAssets = prefs.activeTab === 'assets';
    var isTools = prefs.activeTab === 'tools';
    var isScripts = prefs.activeTab === 'scripts';
    syncRailTab(els.tabLibrary, prefs.activeTab === 'library');
    syncRailTab(els.tabAssets, isAssets);
    syncRailTab(els.tabTools, isTools);
    syncRailTab(els.tabScripts, isScripts);
    els.app.classList.toggle('assets-active', isAssets);
    els.app.classList.toggle('tools-active', isTools);
    els.app.classList.toggle('scripts-active', isScripts);
    if (isTools) { if (hasTools()) DCTools.ensureMounted(); return; }
    if (isScripts) { if (hasScripts()) DCScripts.ensureMounted(); return; }
    els.search.placeholder = isAssets ? 'Search assets...' : 'Search library...';
    applyView();
    activeModule().ensureLoaded();
  }

  function selectLibraryFolder() {
    DCUI.spinner(true);
    DCBridge.call('selectLibraryFolder', [], function (path) {
      DCUI.spinner(false);
      if (path && path !== 'null') {
        libraryPath = path;
        verifyAndLoad();
        if (hasSync()) DCSync.broadcast('path');
      }
    });
  }

  function openSettings() {
    els.settingsPath.textContent = libraryPath || 'No path set.';
    els.settingsModal.classList.remove('hidden');
  }

  function openLibraryInFinder() {
    DCBridge.call('revealInFinder', [libraryPath], function (result) {
      if (result !== 'ok') DCUI.toast(result, true);
    });
  }

  function changeFolder() {
    DCUI.closeModal(els.settingsModal);
    selectLibraryFolder();
  }

  function refreshActive() {
    DCUI.closeModal(els.settingsModal);
    if (prefs.activeTab === 'scripts' && hasScripts()) { DCScripts.refresh(); return; }
    if (prefs.activeTab === 'tools') return; // the Tools tab has nothing to reload
    activeModule().refresh();
  }

  function confirmCategoryModal() {
    var mode = DCUI.categoryModalMode();
    var categoryName = DCCategoryPicker.value();
    var v = DCValidate.validateName(categoryName, 'Category name');
    if (!v.valid) { DCUI.toast(v.error, true); return; }
    // asset-tab flows may reuse the name "assets"; only library categories
    // collide with the reserved top-level Assets folder
    var isAssetsFlow = mode === 'addAssets' || mode === 'addShape';
    if (!isAssetsFlow && v.name.toLowerCase() === 'assets') {
      DCUI.toast('"Assets" is reserved for the Assets tab.', true);
      return;
    }
    DCState.pushRecentCategory(prefs, DCState.categoryScope(mode), v.name);
    persistPrefs();
    if (mode === 'addAssets' && hasAssets()) DCAssets.confirmCategory(v.name);
    else if (mode === 'addShape' && hasAssets()) DCAssets.confirmShapeCategory(v.name);
    else if (mode === 'section') DCLibrary.confirmAddToSection(v.name);
    else DCLibrary.confirmCategory(mode, v.name);
  }

  function confirmRename() {
    if (DCUI.renameOwner() === 'assets' && hasAssets()) DCAssets.confirmRename();
    else DCLibrary.confirmRename();
  }

  function confirmDelete() {
    if (DCUI.deleteOwner() === 'scripts' && hasScripts()) DCScripts.confirmDelete();
    else if (DCUI.deleteOwner() === 'assets' && hasAssets()) DCAssets.confirmDelete();
    else DCLibrary.confirmDelete();
  }

  function closeAllModals() {
    DCUI.closeAllModals();
    DCLibrary.clearPending();
    if (hasAssets()) DCAssets.clearPending();
    if (hasScripts()) { DCScripts.clearPending(); DCScripts.closeModal(); }
  }

  function onSearch() { if (prefs.activeTab === 'tools') return; activeModule().rerender(); }
  function onSortChange() { if (prefs.activeTab === 'tools') return; prefs.sort = els.sortSelect.value; persistPrefs(); activeModule().rerender(); }
  function onFavoritesToggle() {
    if (prefs.activeTab === 'tools') return;
    prefs.favoritesOnly = !prefs.favoritesOnly;
    els.favoritesBtn.classList.toggle('active', prefs.favoritesOnly);
    persistPrefs();
    activeModule().rerender();
  }
  function onDisplayChange() {
    if (prefs.activeTab === 'tools') return;
    prefs.showNames = els.showNamesCb.checked;
    prefs.showMeta = els.showMetaCb.checked;
    if (els.folderLayoutSelect) {
      prefs.folderLayout = DCState.normalizeFolderLayout(els.folderLayoutSelect.value);
      prefs.folderColumns = DCState.isFolderColumns(prefs);
    }
    if (els.folderColsCb) prefs.folderColumns = els.folderColsCb.checked;
    if (!els.folderLayoutSelect && els.folderColsCb) {
      prefs.folderLayout = els.folderColsCb.checked ? 'columns' : 'rows';
    }
    persistPrefs();
    applyFolderColumns();
    activeModule().rerender();
  }
  function onSlider() {
    if (prefs.activeTab === 'tools') return;
    prefs.thumbMin = parseInt(els.thumbSlider.value, 10);
    applyGridSize();
    persistPrefs();
  }

  function appVisible() { return els && els.app && !els.app.classList.contains('hidden'); }

  // Another DropComp panel changed shared state. Visible sections re-read the
  // disk now; hidden sections are only marked stale and re-read on next visit.
  // Never broadcast from in here - that would echo between panels forever.
  function onRemoteChange(kind) {
    if (kind === 'path') { boot(); return; }
    if (kind === 'prefs') {
      reloadPrefs();
      applyPrefsToControls();
      if (appVisible() && (prefs.activeTab === 'library' || prefs.activeTab === 'assets')) {
        activeModule().rerender();
      }
      return;
    }
    if (kind === 'library') {
      DCLibrary.resetLoaded();
      if (appVisible() && prefs.activeTab === 'library') DCLibrary.ensureLoaded();
    } else if (kind === 'assets' && hasAssets()) {
      DCAssets.resetLoaded();
      if (appVisible() && prefs.activeTab === 'assets') DCAssets.ensureLoaded();
    } else if (kind === 'scripts' && hasScripts()) {
      if (appVisible() && prefs.activeTab === 'scripts') DCScripts.refresh();
      else DCScripts.resetLoaded();
    }
  }

  function onCardAction(action, uniqueId, category, section) {
    activeModule().onCardAction(action, uniqueId, category, section);
  }
  function onCardDblClick(uniqueId) { activeModule().importItem(uniqueId); }
  function toggleSection(category) { activeModule().toggleSection(category); }
  // the rename affordance only renders on Library section headers
  function renameCategory(category) { DCLibrary.renameCategoryFlow(category); }
  // virtual section header affordances only render on Library virtual sections
  function renameSection(name) { DCLibrary.renameSectionFlow(name); }
  function deleteSection(name) { DCLibrary.deleteSectionFlow(name); }

  return {
    init: init, boot: boot, verifyAndLoad: verifyAndLoad,
    getMode: getMode, onRemoteChange: onRemoteChange,
    getEls: getEls, getPrefs: getPrefs, getLibraryPath: getLibraryPath, persistPrefs: persistPrefs,
    recentCategories: recentCategories,
    setActiveTab: setActiveTab, selectLibraryFolder: selectLibraryFolder,
    openSettings: openSettings, openLibraryInFinder: openLibraryInFinder,
    changeFolder: changeFolder, refreshActive: refreshActive,
    confirmCategoryModal: confirmCategoryModal, confirmRename: confirmRename, confirmDelete: confirmDelete,
    closeAllModals: closeAllModals,
    onSearch: onSearch, onSortChange: onSortChange, onFavoritesToggle: onFavoritesToggle,
    onDisplayChange: onDisplayChange, onSlider: onSlider, onViewChange: onViewChange,
    onCardAction: onCardAction, onCardDblClick: onCardDblClick, toggleSection: toggleSection,
    renameCategory: renameCategory,
    renameSection: renameSection, deleteSection: deleteSection
  };
}());
if (typeof module !== 'undefined' && module.exports) { module.exports = DCShell; }
