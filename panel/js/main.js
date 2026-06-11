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
    search: $('search-input'),
    sortSelect: $('sort-select'),
    favoritesBtn: $('favorites-btn'),
    displayBtn: $('display-btn'),
    displayMenu: $('display-menu'),
    showNamesCb: $('show-names-cb'),
    showMetaCb: $('show-meta-cb'),
    addCompBtn: $('add-comp-btn'),
    addAepBtn: $('add-aep-btn'),
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

  DCActions.init(els);

  $('welcome-browse-btn').addEventListener('click', DCActions.selectLibraryFolder);
  $('retry-library-btn').addEventListener('click', DCActions.verifyAndLoad);
  $('missing-change-path-btn').addEventListener('click', DCActions.selectLibraryFolder);

  els.search.addEventListener('input', DCActions.onSearch);
  els.sortSelect.addEventListener('change', DCActions.onSortChange);
  els.favoritesBtn.addEventListener('click', DCActions.onFavoritesToggle);
  els.showNamesCb.addEventListener('change', DCActions.onDisplayChange);
  els.showMetaCb.addEventListener('change', DCActions.onDisplayChange);
  els.thumbSlider.addEventListener('input', DCActions.onSlider);
  els.addCompBtn.addEventListener('click', DCActions.stashFlow);
  els.addAepBtn.addEventListener('click', DCActions.addAepFlow);
  els.settingsBtn.addEventListener('click', DCActions.openSettings);

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

  $('cancel-category-btn').addEventListener('click', function () { DCActions.closeModal(els.categoryModal); });
  $('confirm-category-btn').addEventListener('click', DCActions.confirmCategoryModal);
  $('cancel-rename-btn').addEventListener('click', function () { DCActions.closeModal(els.renameModal); });
  $('confirm-rename-btn').addEventListener('click', DCActions.confirmRename);
  $('cancel-delete-btn').addEventListener('click', function () { DCActions.closeModal(els.deleteModal); });
  $('confirm-delete-btn').addEventListener('click', DCActions.confirmDelete);
  $('close-settings-btn').addEventListener('click', function () { DCActions.closeModal(els.settingsModal); });
  $('open-finder-btn').addEventListener('click', DCActions.openLibraryInFinder);
  $('refresh-library-btn').addEventListener('click', DCActions.refreshLibrary);
  $('change-path-btn').addEventListener('click', DCActions.changeFolder);

  els.library.addEventListener('click', function (e) {
    var actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    var action = actionEl.dataset.action;
    if (action === 'toggleSection') {
      DCActions.toggleSection(actionEl.closest('.category').dataset.category);
      return;
    }
    var card = actionEl.closest('.card');
    if (!card) return;
    var id = card.dataset.uniqueId;
    var cat = card.dataset.category;
    if (action === 'import') DCActions.importItem(id);
    else if (action === 'favorite') DCActions.toggleFavorite(id);
    else if (action === 'rename') DCActions.renameFlow(id, cat);
    else if (action === 'delete') DCActions.deleteFlow(id, cat);
    else if (action === 'generate') DCActions.generateThumb(id, cat);
    else if (action === 'setThumb') DCActions.setThumb(id, cat);
    else if (action === 'reveal') DCActions.revealItem(id, cat);
  });

  els.library.addEventListener('dblclick', function (e) {
    var card = e.target.closest('.card');
    if (card && !e.target.closest('[data-action]')) {
      DCActions.importItem(card.dataset.uniqueId);
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') DCActions.closeAllModals();
    if (e.key === 'Enter') {
      if (!els.renameModal.classList.contains('hidden')) DCActions.confirmRename();
      else if (!els.categoryModal.classList.contains('hidden')) DCActions.confirmCategoryModal();
    }
  });

  // one-time v1 -> v2 settings migration (path used to live in panel localStorage)
  var oldPath = window.localStorage.getItem('ae_asset_stash_path');
  if (oldPath) {
    DCBridge.call('setLibraryPath', [oldPath], function () {
      window.localStorage.removeItem('ae_asset_stash_path');
      DCActions.boot();
    });
  } else {
    DCActions.boot();
  }
}());
