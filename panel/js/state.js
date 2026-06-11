var DCState = (function () {
  'use strict';

  function safeName(name) {
    return String(name).replace(/[^a-z0-9]/gi, '_').replace(/_{2,}/g, '_');
  }

  function parseTimestamp(uniqueId) {
    var m = /_(\d{10,})$/.exec(String(uniqueId));
    return m ? parseInt(m[1], 10) : null;
  }

  function computeRenameTarget(oldUniqueId, newName) {
    var ts = parseTimestamp(oldUniqueId);
    if (ts === null) return null;
    return safeName(newName) + '_' + ts;
  }

  function formatMetaLine(comp) {
    if (!comp || !comp.width || !comp.height) return '';
    var parts = [comp.width + '×' + comp.height];
    if (comp.duration) parts.push((Math.round(comp.duration * 10) / 10).toFixed(1) + 's');
    if (comp.frameRate) parts.push(Math.round(comp.frameRate) + 'fps');
    return parts.join(' · ');
  }

  function addedAt(comp) {
    return comp.addedAt || parseTimestamp(comp.uniqueId) || 0;
  }

  function gridSizeClass(thumbMin) {
    if (thumbMin <= 120) return 'grid--s';
    if (thumbMin <= 180) return 'grid--m';
    return 'grid--l';
  }

  function getUsage(usageMeta, uniqueId) {
    return (usageMeta && usageMeta[uniqueId]) || { lastUsed: 0, useCount: 0, isFavorite: false };
  }

  function byName(a, b) { return a.name.localeCompare(b.name); }

  function sortComps(comps, mode, usageMeta) {
    var arr = comps.slice();
    if (mode === 'recent') {
      arr.sort(function (a, b) {
        return (getUsage(usageMeta, b.uniqueId).lastUsed - getUsage(usageMeta, a.uniqueId).lastUsed) || byName(a, b);
      });
    } else if (mode === 'mostUsed') {
      arr.sort(function (a, b) {
        return (getUsage(usageMeta, b.uniqueId).useCount - getUsage(usageMeta, a.uniqueId).useCount) || byName(a, b);
      });
    } else if (mode === 'dateAdded') {
      arr.sort(function (a, b) { return (addedAt(b) - addedAt(a)) || byName(a, b); });
    } else {
      arr.sort(byName);
    }
    return arr;
  }

  function filterComps(comps, opts) {
    var search = (opts.search || '').toLowerCase();
    return comps.filter(function (c) {
      if (search && c.name.toLowerCase().indexOf(search) === -1) return false;
      if (opts.favoritesOnly && !getUsage(opts.usageMeta, c.uniqueId).isFavorite) return false;
      return true;
    });
  }

  function groupByCategory(comps) {
    var map = {};
    comps.forEach(function (c) {
      if (!map[c.category]) map[c.category] = [];
      map[c.category].push(c);
    });
    return Object.keys(map).sort(function (a, b) { return a.localeCompare(b); })
      .map(function (cat) { return { category: cat, items: map[cat] }; });
  }

  var PREFS_KEY = 'dropcomp_prefs';
  var USAGE_KEY = 'dropcomp_metadata';

  function defaultPrefs() {
    return { thumbMin: 130, sort: 'recent', showNames: true, showMeta: true, favoritesOnly: false, collapsed: [] };
  }

  function loadPrefs(storage) {
    var prefs = defaultPrefs();
    try {
      var raw = storage.getItem(PREFS_KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        Object.keys(prefs).forEach(function (k) {
          if (saved[k] !== undefined) prefs[k] = saved[k];
        });
        return prefs;
      }
      if (storage.getItem('dropcomp_density') === 'compact') prefs.thumbMin = 100;
      storage.removeItem('dropcomp_view');
      storage.removeItem('dropcomp_density');
    } catch (e) { return defaultPrefs(); }
    return prefs;
  }

  function savePrefs(storage, prefs) {
    try { storage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  function loadUsageMeta(storage) {
    try { return JSON.parse(storage.getItem(USAGE_KEY)) || {}; } catch (e) { return {}; }
  }

  function saveUsageMeta(storage, meta) {
    try { storage.setItem(USAGE_KEY, JSON.stringify(meta)); } catch (e) {}
  }

  function cleanupStaleMetadata(usageMeta, comps) {
    var valid = {};
    comps.forEach(function (c) { valid[c.uniqueId] = true; });
    var cleaned = {};
    var removed = 0;
    Object.keys(usageMeta).forEach(function (k) {
      if (valid[k]) cleaned[k] = usageMeta[k];
      else removed++;
    });
    return { usageMeta: cleaned, removed: removed };
  }

  function migrateMetadataKey(usageMeta, oldId, newId) {
    if (oldId !== newId && usageMeta[oldId]) {
      usageMeta[newId] = usageMeta[oldId];
      delete usageMeta[oldId];
    }
    return usageMeta;
  }

  return {
    defaultPrefs: defaultPrefs,
    loadPrefs: loadPrefs,
    savePrefs: savePrefs,
    loadUsageMeta: loadUsageMeta,
    saveUsageMeta: saveUsageMeta,
    cleanupStaleMetadata: cleanupStaleMetadata,
    migrateMetadataKey: migrateMetadataKey,
    getUsage: getUsage,
    sortComps: sortComps,
    filterComps: filterComps,
    groupByCategory: groupByCategory,
    safeName: safeName,
    parseTimestamp: parseTimestamp,
    computeRenameTarget: computeRenameTarget,
    formatMetaLine: formatMetaLine,
    addedAt: addedAt,
    gridSizeClass: gridSizeClass
  };
}());
if (typeof module !== 'undefined' && module.exports) { module.exports = DCState; }
