(function () {
  'use strict';

  var csInterface = new CSInterface();
  DCBridge.init(csInterface);

  function $(id) { return document.getElementById(id); }

  var els = {
    welcome: $('welcome-overlay'),
    driveMissing: $('drive-missing'),
    driveMissingPath: $('drive-missing-path'),
    app: $('app'),
    library: $('library'),
    tabLibrary: $('tab-library'),
    tabAssets: $('tab-assets'),
    search: $('search-input'),
    sortSelect: $('sort-select'),
    favoritesBtn: $('favorites-btn'),
    displayBtn: $('display-btn'),
    displayMenu: $('display-menu'),
    showNamesCb: $('show-names-cb'),
    showMetaCb: $('show-meta-cb'),
    addCompBtn: $('add-comp-btn'),
    addAepBtn: $('add-aep-btn'),
    addAssetsBtn: $('add-assets-btn'),
    thumbSlider: $('thumb-slider'),
    settingsBtn: $('settings-btn'),
    categoryModal: $('category-modal'),
    categoryModalTitle: $('category-modal-title'),
    existingCategorySelect: $('existing-category-select'),
    newCategoryInput: $('new-category-input'),
    renameModal: $('rename-modal'),
    newNameInput: $('new-name-input'),
    deleteModal: $('delete-modal'),
    deleteName: $('delete-name'),
    settingsModal: $('settings-modal'),
    settingsPath: $('settings-path'),
    spinner: $('loading-spinner'),
    toast: $('toast')
  };

  DCUI.init(els);
  DCShell.init(els);
  DCLibrary.init();
  if (typeof DCAssets !== 'undefined') DCAssets.init();

  $('welcome-browse-btn').addEventListener('click', DCShell.selectLibraryFolder);
  $('retry-library-btn').addEventListener('click', DCShell.verifyAndLoad);
  $('missing-change-path-btn').addEventListener('click', DCShell.selectLibraryFolder);

  els.tabLibrary.addEventListener('click', function () { DCShell.setActiveTab('library'); });
  els.tabAssets.addEventListener('click', function () { DCShell.setActiveTab('assets'); });

  els.search.addEventListener('input', DCShell.onSearch);
  els.sortSelect.addEventListener('change', DCShell.onSortChange);
  els.favoritesBtn.addEventListener('click', DCShell.onFavoritesToggle);
  $('relink-btn').addEventListener('click', DCLibrary.relinkMissing);
  els.showNamesCb.addEventListener('change', DCShell.onDisplayChange);
  els.showMetaCb.addEventListener('change', DCShell.onDisplayChange);
  els.thumbSlider.addEventListener('input', DCShell.onSlider);
  els.addCompBtn.addEventListener('click', DCLibrary.stashFlow);
  els.addAepBtn.addEventListener('click', DCLibrary.addAepFlow);
  if (els.addAssetsBtn && typeof DCAssets !== 'undefined') {
    els.addAssetsBtn.addEventListener('click', DCAssets.addFlow);
  }
  els.settingsBtn.addEventListener('click', DCShell.openSettings);

  els.displayBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    els.displayMenu.classList.toggle('hidden');
  });
  document.addEventListener('click', function (e) {
    if (!els.displayMenu.classList.contains('hidden') &&
        !els.displayMenu.contains(e.target) && e.target !== els.displayBtn) {
      els.displayMenu.classList.add('hidden');
    }
  });

  $('cancel-category-btn').addEventListener('click', function () { DCUI.closeModal(els.categoryModal); });
  $('confirm-category-btn').addEventListener('click', DCShell.confirmCategoryModal);
  $('cancel-rename-btn').addEventListener('click', function () { DCUI.closeModal(els.renameModal); });
  $('confirm-rename-btn').addEventListener('click', DCShell.confirmRename);
  $('cancel-delete-btn').addEventListener('click', function () { DCUI.closeModal(els.deleteModal); });
  $('confirm-delete-btn').addEventListener('click', DCShell.confirmDelete);
  $('close-settings-btn').addEventListener('click', function () { DCUI.closeModal(els.settingsModal); });
  $('open-finder-btn').addEventListener('click', DCShell.openLibraryInFinder);
  $('refresh-library-btn').addEventListener('click', DCShell.refreshActive);
  $('change-path-btn').addEventListener('click', DCShell.changeFolder);

  els.library.addEventListener('click', function (e) {
    var actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    var action = actionEl.dataset.action;
    if (action === 'toggleSection') {
      DCShell.toggleSection(actionEl.closest('.category').dataset.category);
      return;
    }
    var card = actionEl.closest('.card');
    if (!card) return;
    DCShell.onCardAction(action, card.dataset.uniqueId, card.dataset.category);
  });

  els.library.addEventListener('dblclick', function (e) {
    var card = e.target.closest('.card');
    if (card && !e.target.closest('[data-action]')) {
      DCShell.onCardDblClick(card.dataset.uniqueId);
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') DCShell.closeAllModals();
    if (e.key === 'Enter') {
      if (!els.renameModal.classList.contains('hidden')) DCShell.confirmRename();
      else if (!els.categoryModal.classList.contains('hidden')) DCShell.confirmCategoryModal();
    }
  });

  // version labels come from the single DCUpdate.VERSION constant
  $('app-version').textContent = DCUpdate.VERSION.replace(/\.\d+$/, '');
  $('settings-version').textContent = 'DropComp ' + DCUpdate.VERSION;

  // free update notice: GitHub latest-release check, throttled, silent on failure
  var updateChip = $('update-chip');
  updateChip.addEventListener('click', function () {
    csInterface.openURLInDefaultBrowser(DCUpdate.RELEASES_PAGE);
  });
  DCUpdate.check(window.localStorage, Date.now(), function (latest) {
    if (!latest) return;
    updateChip.textContent = 'Update ' + String(latest).replace(/^v/, '');
    updateChip.classList.remove('hidden');
  });

  // host modules must load before any relink/assets-dependent call
  DCBridge.call('loadHostModules', [csInterface.getSystemPath(SystemPath.EXTENSION)], function (r) {
    if (r !== 'ok') console.error('DropComp: host module load failed -', r);

    // one-time v1 -> v2 settings migration (path used to live in panel localStorage)
    var oldPath = window.localStorage.getItem('ae_asset_stash_path');
    if (oldPath) {
      DCBridge.call('setLibraryPath', [oldPath], function () {
        window.localStorage.removeItem('ae_asset_stash_path');
        DCShell.boot();
      });
    } else {
      DCShell.boot();
    }
  });
}());
