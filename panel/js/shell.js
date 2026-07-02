var DCShell = (function () {
  'use strict';

  var els = null;
  var prefs = null;
  var libraryPath = null;

  function hasAssets() { return typeof DCAssets !== 'undefined'; }
  function hasTools() { return typeof DCTools !== 'undefined'; }
  function hasScripts() { return typeof DCScripts !== 'undefined'; }

  function init(elements) {
    els = elements;
    prefs = DCState.loadPrefs(localStorage);
    applyPrefsToControls();
  }

  function getEls() { return els; }
  function getPrefs() { return prefs; }
  function getLibraryPath() { return libraryPath; }
  function persistPrefs() { DCState.savePrefs(localStorage, prefs); }

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

  function setActiveTab(tab, skipPersist) {
    prefs.activeTab = DCState.resolveActiveTab(tab, hasAssets(), hasTools(), hasScripts());
    if (!skipPersist) persistPrefs();
    var isAssets = prefs.activeTab === 'assets';
    var isTools = prefs.activeTab === 'tools';
    var isScripts = prefs.activeTab === 'scripts';
    els.tabLibrary.classList.toggle('active', prefs.activeTab === 'library');
    els.tabAssets.classList.toggle('active', isAssets);
    if (els.tabTools) els.tabTools.classList.toggle('active', isTools);
    if (els.tabScripts) els.tabScripts.classList.toggle('active', isScripts);
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
    var categoryName = els.newCategoryInput.value.trim() || els.existingCategorySelect.value;
    var v = DCValidate.validateName(categoryName, 'Category name');
    if (!v.valid) { DCUI.toast(v.error, true); return; }
    if (mode !== 'addAssets' && v.name.toLowerCase() === 'assets') {
      DCUI.toast('"Assets" is reserved for the Assets tab.', true);
      return;
    }
    if (mode === 'addAssets' && hasAssets()) DCAssets.confirmCategory(v.name);
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

  function onCardAction(action, uniqueId, category) {
    activeModule().onCardAction(action, uniqueId, category);
  }
  function onCardDblClick(uniqueId) { activeModule().importItem(uniqueId); }
  function toggleSection(category) { activeModule().toggleSection(category); }
  // the rename affordance only renders on Library section headers
  function renameCategory(category) { DCLibrary.renameCategoryFlow(category); }

  return {
    init: init, boot: boot, verifyAndLoad: verifyAndLoad,
    getEls: getEls, getPrefs: getPrefs, getLibraryPath: getLibraryPath, persistPrefs: persistPrefs,
    setActiveTab: setActiveTab, selectLibraryFolder: selectLibraryFolder,
    openSettings: openSettings, openLibraryInFinder: openLibraryInFinder,
    changeFolder: changeFolder, refreshActive: refreshActive,
    confirmCategoryModal: confirmCategoryModal, confirmRename: confirmRename, confirmDelete: confirmDelete,
    closeAllModals: closeAllModals,
    onSearch: onSearch, onSortChange: onSortChange, onFavoritesToggle: onFavoritesToggle,
    onDisplayChange: onDisplayChange, onSlider: onSlider, onViewChange: onViewChange,
    onCardAction: onCardAction, onCardDblClick: onCardDblClick, toggleSection: toggleSection,
    renameCategory: renameCategory
  };
}());
