var DCUI = (function () {
  'use strict';

  var els = null;
  var toastTimer = null;
  var catMode = null;
  var renameOwnerName = 'library';
  var deleteOwnerName = 'library';

  function init(elements) { els = elements; }

  function toast(msg, isErr, ms) {
    if (toastTimer) clearTimeout(toastTimer);
    els.toast.textContent = String(msg).replace(/^(Success!|Success:|Error:)\s*/, '');
    els.toast.className = 'show ' + (isErr ? 'error' : 'success');
    toastTimer = setTimeout(function () { els.toast.classList.remove('show'); }, ms || 3000);
  }

  function spinner(show) { els.spinner.classList.toggle('hidden', !show); }

  function show(elName) {
    ['welcome', 'driveMissing', 'app'].forEach(function (k) {
      els[k].classList.toggle('hidden', k !== elName);
    });
  }

  function isError(result) {
    return typeof result === 'string' &&
      (result.indexOf('Error') === 0 || result.indexOf('EvalScript error') === 0);
  }

  function openCategoryModal(mode, title, categories) {
    catMode = mode;
    els.categoryModalTitle.textContent = title;
    els.categoryModal.classList.remove('hidden');
    DCCategoryPicker.open(categories, DCState.categoryScope(mode));
  }
  function categoryModalMode() { return catMode; }

  function openRenameModal(owner, currentName) {
    renameOwnerName = owner;
    els.renameModal.classList.remove('hidden');
    els.newNameInput.value = currentName;
    els.newNameInput.focus();
    els.newNameInput.select();
  }
  function renameOwner() { return renameOwnerName; }

  function openDeleteModal(owner, displayName) {
    deleteOwnerName = owner;
    els.deleteName.textContent = displayName;
    els.deleteModal.classList.remove('hidden');
  }
  function deleteOwner() { return deleteOwnerName; }

  function closeModal(modal) { modal.classList.add('hidden'); }

  function closeAllModals() {
    [els.categoryModal, els.renameModal, els.deleteModal, els.settingsModal].forEach(closeModal);
    els.displayMenu.classList.add('hidden');
  }

  return {
    init: init, toast: toast, spinner: spinner, show: show, isError: isError,
    openCategoryModal: openCategoryModal, categoryModalMode: categoryModalMode,
    openRenameModal: openRenameModal, renameOwner: renameOwner,
    openDeleteModal: openDeleteModal, deleteOwner: deleteOwner,
    closeModal: closeModal, closeAllModals: closeAllModals
  };
}());
if (typeof module !== 'undefined' && module.exports) { module.exports = DCUI; }
