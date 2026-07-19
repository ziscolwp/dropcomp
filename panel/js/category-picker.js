var DCCategoryPicker = (function () {
  'use strict';

  function sortAZ(names) {
    return names.slice().sort(function (a, b) { return a.localeCompare(b); });
  }

  function buildRows(categories, recents, query) {
    var q = String(query || '').trim();
    var rows = [];
    if (q === '') {
      var live = (recents || []).filter(function (r) { return categories.indexOf(r) !== -1; });
      if (categories.length === 0) return [{ type: 'empty' }];
      if (live.length > 0) {
        rows.push({ type: 'recent-header' });
        live.forEach(function (name) { rows.push({ type: 'category', name: name, recent: true }); });
        rows.push({ type: 'divider' });
      }
      sortAZ(categories).forEach(function (name) {
        if (live.indexOf(name) === -1) rows.push({ type: 'category', name: name, recent: false });
      });
      return rows;
    }
    var qLower = q.toLowerCase();
    var exact = false;
    sortAZ(categories).forEach(function (name) {
      var lower = name.toLowerCase();
      if (lower === qLower) exact = true;
      if (lower.indexOf(qLower) !== -1) rows.push({ type: 'category', name: name, recent: false });
    });
    if (!exact) rows.push({ type: 'create', name: q });
    return rows;
  }

  function selectableIndices(rows) {
    var out = [];
    rows.forEach(function (row, i) {
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

  return {
    buildRows: buildRows,
    selectableIndices: selectableIndices,
    moveHighlight: moveHighlight
  };
}());
if (typeof module !== 'undefined' && module.exports) { module.exports = DCCategoryPicker; }
