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
    var params = input.params ? normalizeParams(input.params) : [];
    return {
      uniqueId: input.uniqueId || newUniqueId(input.name, now),
      name: String(input.name || '').trim(),
      description: String(input.description || '').trim(),
      category: String(input.category || '').trim() || DEFAULT_CATEGORY,
      source: isFile ? 'file' : 'snippet',
      path: isFile ? (input.path || null) : null,
      body: isFile ? null : String(input.body || ''),
      addedAt: input.addedAt || now,
      tags: input.tags || [],
      params: params,
      opensWindow: params.length ? false : !!input.opensWindow
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
    var pv = validateParams(input.params);
    if (!pv.valid) return pv;
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
        if (list[i] && list[i].uniqueId && list[i].name) clean.push(normalizeLoadedEntry(list[i]));
      }
      return { version: obj.version || REGISTRY_VERSION, scripts: clean };
    } catch (e) {
      return { version: REGISTRY_VERSION, scripts: [] };
    }
  }

  function normalizeLoadedEntry(entry) {
    var params = entry.params ? normalizeParams(entry.params) : [];
    if (!params.length) return entry;
    var out = {};
    for (var k in entry) {
      if (entry.hasOwnProperty(k)) out[k] = entry[k];
    }
    out.params = params;
    out.opensWindow = false;
    return out;
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

  function runMode(entry) {
    if (entry && entry.params && entry.params.length) return 'params';
    if (entry && entry.opensWindow) return 'windowNotice';
    return 'direct';
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

  var PARAM_TYPES = ['text', 'number', 'slider', 'checkbox', 'select'];
  var PARAM_KEY_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

  function validateParams(params) {
    if (params == null) return { valid: true };
    var seen = {};
    for (var i = 0; i < params.length; i++) {
      var p = params[i] || {};
      var label = p.label || p.key || '';
      if (!p.key || !PARAM_KEY_RE.test(p.key)) {
        return { valid: false, error: 'Input "' + (p.key || '') + '": key must start with a letter or _ and use only letters, numbers, or _.' };
      }
      if (seen[p.key]) return { valid: false, error: 'Duplicate input key "' + p.key + '".' };
      seen[p.key] = true;
      if (PARAM_TYPES.indexOf(p.type) === -1) {
        return { valid: false, error: 'Input "' + label + '": choose a type.' };
      }
      if (p.type === 'slider') {
        if (typeof p.min !== 'number' || typeof p.max !== 'number') return { valid: false, error: 'Input "' + label + '": slider needs numeric min and max.' };
        if (p.min >= p.max) return { valid: false, error: 'Input "' + label + '": min must be less than max.' };
        if (p.step != null && !(p.step > 0)) return { valid: false, error: 'Input "' + label + '": step must be greater than 0.' };
      }
      if (p.type === 'select' && (!p.options || p.options.length === 0)) {
        return { valid: false, error: 'Input "' + label + '": add at least one option.' };
      }
    }
    return { valid: true };
  }

  function coerceValue(param, raw) {
    var t = param.type;
    if (t === 'checkbox') return (raw === true || raw === 'true' || raw === 'on' || raw === 1 || raw === '1');
    if (t === 'number' || t === 'slider') {
      var n = parseFloat(raw);
      if (isNaN(n)) n = (typeof param.default === 'number') ? param.default : 0;
      if (typeof param.min === 'number' && n < param.min) n = param.min;
      if (typeof param.max === 'number' && n > param.max) n = param.max;
      return n;
    }
    if (t === 'select') {
      var v = String(raw);
      if (param.options && param.options.indexOf(v) === -1) return param.options[0];
      return v;
    }
    return String(raw == null ? '' : raw);
  }

  function buildValuesJson(params, rawValues) {
    var out = {};
    params = params || [];
    for (var i = 0; i < params.length; i++) {
      var p = params[i];
      var raw = (rawValues && (p.key in rawValues)) ? rawValues[p.key] : p['default'];
      out[p.key] = coerceValue(p, raw);
    }
    return JSON.stringify(out);
  }

  function normalizeParams(params) {
    var out = [];
    params = params || [];
    for (var i = 0; i < params.length; i++) {
      var p = params[i] || {};
      var np = { key: p.key, label: p.label || p.key, type: p.type };
      if (p.type === 'number' || p.type === 'slider') {
        if (p.min != null) np.min = (typeof p.min === 'number') ? p.min : parseFloat(p.min);
        if (p.max != null) np.max = (typeof p.max === 'number') ? p.max : parseFloat(p.max);
        if (p.step != null) np.step = (typeof p.step === 'number') ? p.step : parseFloat(p.step);
        var dn = parseFloat(p['default']);
        np['default'] = isNaN(dn) ? 0 : dn;
      } else if (p.type === 'checkbox') {
        np['default'] = (p['default'] === true || p['default'] === 'true' || p['default'] === 1 || p['default'] === '1');
      } else if (p.type === 'select') {
        np.options = p.options || [];
        np['default'] = (np.options.indexOf(p['default']) !== -1) ? p['default'] : (np.options[0] || '');
      } else {
        np['default'] = String(p['default'] == null ? '' : p['default']);
      }
      out.push(np);
    }
    return out;
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
    runMode: runMode,
    getUsage: getUsage,
    filterScripts: filterScripts,
    sortScripts: sortScripts,
    groupByCategory: groupByCategory,
    categories: categories,
    validateParams: validateParams,
    normalizeParams: normalizeParams,
    coerceValue: coerceValue,
    buildValuesJson: buildValuesJson
  };
}());
if (typeof module !== 'undefined' && module.exports) { module.exports = DCScriptsCore; }
