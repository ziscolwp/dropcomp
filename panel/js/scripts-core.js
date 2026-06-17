// DropComp Scripts tab - pure helpers (panel JS, Chromium 99). No DOM, no host.
// Mirrors tools-core.js / DCState patterns so it is unit-testable under node.
var DCScriptsCore = (function () {
  'use strict';

  var REGISTRY_VERSION = 1;
  var DEFAULT_CATEGORY = 'Uncategorized';

  function newUniqueId(name, now) {
    var base = String(name || 'script').toLowerCase()
      .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
    return (base || 'script') + '_' + now;
  }

  // Normalise raw form input into a stored registry entry.
  function makeEntry(input, now) {
    var isFile = input.source === 'file';
    return {
      uniqueId: input.uniqueId || newUniqueId(input.name, now),
      name: String(input.name || '').trim(),
      description: String(input.description || '').trim(),
      category: String(input.category || '').trim() || DEFAULT_CATEGORY,
      source: isFile ? 'file' : 'snippet',
      path: isFile ? (input.path || null) : null,
      body: isFile ? null : String(input.body || ''),
      addedAt: input.addedAt || now,
      tags: input.tags || []
    };
  }

  function validateEntry(input) {
    var name = String(input.name || '').trim();
    if (!name) return { valid: false, error: 'Give the script a name.' };
    if (name.length > 120) return { valid: false, error: 'Name is too long (max 120 characters).' };
    if (input.source === 'file') {
      if (!input.path) return { valid: false, error: 'Choose a script file first.' };
    } else if (!String(input.body || '').trim()) {
      return { valid: false, error: 'The snippet is empty.' };
    }
    return { valid: true };
  }

  // Defensive registry parse: never throws, always returns {version, scripts:[]}.
  function parseRegistry(raw) {
    try {
      var obj = (typeof raw === 'string') ? JSON.parse(raw) : raw;
      if (!obj || typeof obj !== 'object' || obj.error) return { version: REGISTRY_VERSION, scripts: [] };
      var list = (obj.scripts && obj.scripts.length !== undefined) ? obj.scripts : [];
      var clean = [];
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].uniqueId && list[i].name) clean.push(list[i]);
      }
      return { version: obj.version || REGISTRY_VERSION, scripts: clean };
    } catch (e) {
      return { version: REGISTRY_VERSION, scripts: [] };
    }
  }

  function serializeRegistry(scripts) {
    return JSON.stringify({ version: REGISTRY_VERSION, scripts: scripts || [] });
  }

  // Insert or replace by uniqueId; returns a new array.
  function upsert(scripts, entry) {
    var out = [], replaced = false;
    for (var i = 0; i < scripts.length; i++) {
      if (scripts[i].uniqueId === entry.uniqueId) { out.push(entry); replaced = true; }
      else out.push(scripts[i]);
    }
    if (!replaced) out.push(entry);
    return out;
  }

  function removeById(scripts, uniqueId) {
    var out = [];
    for (var i = 0; i < scripts.length; i++) {
      if (scripts[i].uniqueId !== uniqueId) out.push(scripts[i]);
    }
    return out;
  }

  function getUsage(usageMeta, uniqueId) {
    return (usageMeta && usageMeta[uniqueId]) || { lastRun: 0, runCount: 0, isFavorite: false };
  }

  function filterScripts(scripts, opts) {
    opts = opts || {};
    var search = (opts.search || '').toLowerCase();
    var out = [];
    for (var i = 0; i < scripts.length; i++) {
      var s = scripts[i];
      if (search) {
        var hay = (s.name + ' ' + (s.description || '') + ' ' + (s.category || '')).toLowerCase();
        if (hay.indexOf(search) === -1) continue;
      }
      if (opts.favoritesOnly && !getUsage(opts.usageMeta, s.uniqueId).isFavorite) continue;
      out.push(s);
    }
    return out;
  }

  function byName(a, b) { return String(a.name).localeCompare(String(b.name)); }

  function sortScripts(scripts, mode, usageMeta) {
    var arr = scripts.slice();
    function u(id) { return getUsage(usageMeta, id); }
    if (mode === 'recent') arr.sort(function (a, b) { return (u(b.uniqueId).lastRun - u(a.uniqueId).lastRun) || byName(a, b); });
    else if (mode === 'mostUsed') arr.sort(function (a, b) { return (u(b.uniqueId).runCount - u(a.uniqueId).runCount) || byName(a, b); });
    else if (mode === 'dateAdded') arr.sort(function (a, b) { return ((b.addedAt || 0) - (a.addedAt || 0)) || byName(a, b); });
    else arr.sort(byName);
    return arr;
  }

  function groupByCategory(scripts) {
    var map = {};
    for (var i = 0; i < scripts.length; i++) {
      var c = scripts[i].category || DEFAULT_CATEGORY;
      if (!map[c]) map[c] = [];
      map[c].push(scripts[i]);
    }
    return Object.keys(map).sort(function (a, b) { return a.localeCompare(b); })
      .map(function (cat) { return { category: cat, items: map[cat] }; });
  }

  function categories(scripts) {
    var seen = {}, out = [];
    for (var i = 0; i < scripts.length; i++) {
      var c = scripts[i].category || DEFAULT_CATEGORY;
      if (!seen[c]) { seen[c] = true; out.push(c); }
    }
    return out.sort(function (a, b) { return a.localeCompare(b); });
  }

  return {
    REGISTRY_VERSION: REGISTRY_VERSION,
    DEFAULT_CATEGORY: DEFAULT_CATEGORY,
    newUniqueId: newUniqueId,
    makeEntry: makeEntry,
    validateEntry: validateEntry,
    parseRegistry: parseRegistry,
    serializeRegistry: serializeRegistry,
    upsert: upsert,
    removeById: removeById,
    getUsage: getUsage,
    filterScripts: filterScripts,
    sortScripts: sortScripts,
    groupByCategory: groupByCategory,
    categories: categories
  };
}());
if (typeof module !== 'undefined' && module.exports) { module.exports = DCScriptsCore; }
