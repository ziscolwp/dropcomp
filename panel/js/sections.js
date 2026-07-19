// DropComp virtual library sections ("client groups"). One comp can appear in
// its home category folder and in any number of named sections; membership
// lives in <library>/.dropcomp_sections.json, never in the comp folders.
var DCSections = (function () {
  'use strict';

  var COLLAPSE_PREFIX = 'sec:';

  function emptyModel() { return { version: 1, sections: {} }; }

  function isValidModel(m) {
    return !!m && typeof m === 'object' && !(m instanceof Array) &&
      !!m.sections && typeof m.sections === 'object' && !(m.sections instanceof Array);
  }

  function parse(raw) {
    if (raw === null || raw === undefined || raw === '') {
      return { model: emptyModel(), corrupt: false };
    }
    var m;
    try { m = JSON.parse(raw); } catch (e) { return { model: emptyModel(), corrupt: true }; }
    if (!isValidModel(m)) return { model: emptyModel(), corrupt: true };
    var clean = emptyModel();
    Object.keys(m.sections).forEach(function (name) {
      var ids = m.sections[name];
      if (ids instanceof Array) {
        clean.sections[name] = ids.filter(function (id) { return typeof id === 'string'; });
      }
    });
    return { model: clean, corrupt: false };
  }

  function serialize(model) { return JSON.stringify(model, null, 2); }

  function has(model, name) {
    return Object.prototype.hasOwnProperty.call(model.sections, name);
  }

  function sectionNames(model) {
    return Object.keys(model.sections).sort(function (a, b) { return a.localeCompare(b); });
  }

  function add(model, name, id) {
    if (!has(model, name)) model.sections[name] = [];
    if (model.sections[name].indexOf(id) !== -1) return false;
    model.sections[name].push(id);
    return true;
  }

  function remove(model, name, id) {
    if (!has(model, name)) return false;
    var i = model.sections[name].indexOf(id);
    if (i === -1) return false;
    model.sections[name].splice(i, 1);
    return true;
  }

  function removeEverywhere(model, id) {
    var changed = false;
    Object.keys(model.sections).forEach(function (name) {
      if (remove(model, name, id)) changed = true;
    });
    return changed;
  }

  function renameSection(model, oldName, newName) {
    if (!has(model, oldName)) return { ok: false, error: 'Section not found.' };
    if (oldName === newName) return { ok: true, changed: false };
    if (has(model, newName)) {
      return { ok: false, error: 'A section named "' + newName + '" already exists.' };
    }
    model.sections[newName] = model.sections[oldName];
    delete model.sections[oldName];
    return { ok: true, changed: true };
  }

  function deleteSection(model, name) {
    if (!has(model, name)) return false;
    delete model.sections[name];
    return true;
  }

  function migrateId(model, oldId, newId) {
    if (oldId === newId) return false;
    var changed = false;
    Object.keys(model.sections).forEach(function (name) {
      var i = model.sections[name].indexOf(oldId);
      if (i !== -1) { model.sections[name][i] = newId; changed = true; }
    });
    return changed;
  }

  function prune(model, validIds) {
    var valid = {};
    (validIds || []).forEach(function (id) { valid[id] = true; });
    var changed = false;
    Object.keys(model.sections).forEach(function (name) {
      var kept = model.sections[name].filter(function (id) { return valid[id] === true; });
      if (kept.length !== model.sections[name].length) {
        model.sections[name] = kept;
        changed = true;
      }
    });
    return changed;
  }

  function collapseKey(name) { return COLLAPSE_PREFIX + name; }

  // comps: the already-filtered comp list. hideEmpty: a search/favorites
  // filter is active, so deliberately-empty sections would read as noise.
  function buildGroups(model, comps, sortFn, hideEmpty) {
    var byId = {};
    comps.forEach(function (c) { byId[c.uniqueId] = c; });
    var groups = [];
    sectionNames(model).forEach(function (name) {
      var items = model.sections[name]
        .map(function (id) { return byId[id]; })
        .filter(function (c) { return !!c; });
      if (items.length === 0 && hideEmpty) return;
      groups.push({ category: name, virtual: true, items: sortFn ? sortFn(items) : items });
    });
    return groups;
  }

  var FILE_NAME = '.dropcomp_sections.json';

  function filePath(libPath) { return libPath + '/' + FILE_NAME; }

  // _fs: injectable for tests (updater-fs.js pattern). null = explicitly
  // unavailable; undefined = use Node's fs when the runtime has it.
  function nodeFs(_fs) {
    if (_fs !== undefined) return _fs;
    if (typeof require === 'undefined') return null;
    try { return require('fs'); } catch (e) { return null; }
  }

  function load(libPath, _fs) {
    var fs = nodeFs(_fs);
    if (!fs || !libPath) return { model: emptyModel(), corrupt: false };
    var p = filePath(libPath);
    var raw;
    try {
      if (!fs.existsSync(p)) return { model: emptyModel(), corrupt: false };
      raw = fs.readFileSync(p, 'utf8');
    } catch (e) {
      return { model: emptyModel(), corrupt: false };
    }
    var r = parse(String(raw));
    if (r.corrupt) {
      // quarantine - never leave a file the next save would overwrite
      try { fs.renameSync(p, libPath + '/' + '.dropcomp_sections.corrupt-' + Date.now() + '.json'); } catch (e2) { }
    }
    return r;
  }

  function save(libPath, model, _fs) {
    var fs = nodeFs(_fs);
    if (!fs || !libPath) return { ok: true, persisted: false };
    try {
      fs.writeFileSync(filePath(libPath), serialize(model), 'utf8');
      return { ok: true, persisted: true };
    } catch (e) {
      return { ok: false, error: 'Could not save sections: ' + e.message };
    }
  }

  return {
    emptyModel: emptyModel, parse: parse, serialize: serialize,
    sectionNames: sectionNames, add: add, remove: remove,
    removeEverywhere: removeEverywhere, renameSection: renameSection,
    deleteSection: deleteSection, migrateId: migrateId, prune: prune,
    collapseKey: collapseKey, buildGroups: buildGroups,
    filePath: filePath, load: load, save: save
  };
}());
if (typeof module !== 'undefined' && module.exports) { module.exports = DCSections; }
