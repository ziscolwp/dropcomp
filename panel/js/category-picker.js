var DCCategoryPicker = (function () {
  'use strict';

  var els = null;
  var hooks = null;
  var allCategories = [];
  var rows = [];
  var selectable = [];
  var highlight = -1; // index into `selectable`

  // ---- pure row-model logic ----

  function sortAZ(names) {
    return names.slice().sort(function (a, b) { return a.localeCompare(b); });
  }

  function buildRows(categories, recents, query) {
    var q = String(query || '').trim();
    var out = [];
    if (q === '') {
      var live = (recents || []).filter(function (r) { return categories.indexOf(r) !== -1; });
      if (categories.length === 0) return [{ type: 'empty' }];
      if (live.length > 0) {
        out.push({ type: 'recent-header' });
        live.forEach(function (name) { out.push({ type: 'category', name: name, recent: true }); });
        out.push({ type: 'divider' });
      }
      sortAZ(categories).forEach(function (name) {
        if (live.indexOf(name) === -1) out.push({ type: 'category', name: name, recent: false });
      });
      return out;
    }
    var qLower = q.toLowerCase();
    var exact = false;
    sortAZ(categories).forEach(function (name) {
      var lower = name.toLowerCase();
      if (lower === qLower) exact = true;
      if (lower.indexOf(qLower) !== -1) out.push({ type: 'category', name: name, recent: false });
    });
    if (!exact) out.push({ type: 'create', name: q });
    return out;
  }

  function selectableIndices(rowList) {
    var out = [];
    rowList.forEach(function (row, i) {
      if (row.type === 'category' || row.type === 'create') out.push(i);
    });
    return out;
  }

  function moveHighlight(current, delta, count) {
    if (count <= 0) return -1;
    if (current < 0) return 0;
    var next = current + delta;
    if (next < 0) return 0;
    if (next > count - 1) return count - 1;
    return next;
  }

  // ---- DOM ----

  function rowLabel(row) {
    if (row.type === 'create') return '＋ Create "' + row.name + '"';
    if (row.type === 'recent-header') return 'Recent';
    if (row.type === 'empty') return 'No categories yet — type a name to create one.';
    return row.name;
  }

  function render() {
    els.categoryPickerList.innerHTML = '';
    rows.forEach(function (row, i) {
      var li = document.createElement('li');
      li.className = 'cp-' + row.type;
      if (row.type === 'category' || row.type === 'create') {
        li.className += ' cp-selectable';
        li.setAttribute('role', 'option');
        var selIdx = selectable.indexOf(i);
        if (selIdx === highlight) {
          li.className += ' highlight';
          li.setAttribute('aria-selected', 'true');
        } else {
          li.setAttribute('aria-selected', 'false');
        }
        li.dataset.selIndex = String(selIdx);
      }
      if (row.type !== 'divider') li.textContent = rowLabel(row);
      els.categoryPickerList.appendChild(li);
    });
    var hlEl = els.categoryPickerList.querySelector('li.highlight');
    if (hlEl && hlEl.scrollIntoView) hlEl.scrollIntoView({ block: 'nearest' });
  }

  function rebuild() {
    var recents = hooks.getRecents ? hooks.getRecents(currentScope) : [];
    rows = buildRows(allCategories, recents, els.categoryPickerInput.value);
    selectable = selectableIndices(rows);
    highlight = selectable.length > 0 ? 0 : -1;
    render();
  }

  var currentScope = 'library';

  function init(elements, pickerHooks) {
    els = elements;
    hooks = pickerHooks || {};
    els.categoryPickerInput.addEventListener('input', rebuild);
    els.categoryPickerInput.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        highlight = moveHighlight(highlight, e.key === 'ArrowDown' ? 1 : -1, selectable.length);
        render();
      }
    });
    els.categoryPickerList.addEventListener('click', function (e) {
      var li = e.target.closest('li.cp-selectable');
      if (!li) return;
      highlight = parseInt(li.dataset.selIndex, 10);
      render();
    });
    els.categoryPickerList.addEventListener('dblclick', function (e) {
      var li = e.target.closest('li.cp-selectable');
      if (!li) return;
      highlight = parseInt(li.dataset.selIndex, 10);
      if (hooks.onConfirm) hooks.onConfirm();
    });
  }

  function open(categories, scope) {
    allCategories = categories.slice();
    currentScope = scope;
    els.categoryPickerInput.value = '';
    rebuild();
    els.categoryPickerInput.focus();
  }

  function value() {
    if (highlight < 0 || highlight >= selectable.length) return '';
    var row = rows[selectable[highlight]];
    return row.name;
  }

  return {
    buildRows: buildRows,
    selectableIndices: selectableIndices,
    moveHighlight: moveHighlight,
    init: init,
    open: open,
    value: value
  };
}());
if (typeof module !== 'undefined' && module.exports) { module.exports = DCCategoryPicker; }
