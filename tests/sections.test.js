const test = require('node:test');
const assert = require('node:assert/strict');
const DCSections = require('../panel/js/sections.js');

function model(sections) { return { version: 1, sections: sections || {} }; }

test('parse returns an empty model for null/empty input without corruption', () => {
  assert.deepEqual(DCSections.parse(null), { model: model(), corrupt: false });
  assert.deepEqual(DCSections.parse(''), { model: model(), corrupt: false });
});

test('parse round-trips a serialized model', () => {
  const m = model({ 'Client X': ['a_1', 'b_2'] });
  assert.deepEqual(DCSections.parse(DCSections.serialize(m)), { model: m, corrupt: false });
});

test('parse flags malformed JSON and wrong shapes as corrupt', () => {
  assert.equal(DCSections.parse('{nope').corrupt, true);
  assert.equal(DCSections.parse('[]').corrupt, true);
  assert.equal(DCSections.parse('{"version":1}').corrupt, true);
  assert.equal(DCSections.parse('{"version":1,"sections":[]}').corrupt, true);
});

test('parse drops non-array sections and non-string ids but keeps the rest', () => {
  const r = DCSections.parse('{"version":1,"sections":{"Good":["a",7],"Bad":"x"}}');
  assert.deepEqual(r, { model: model({ Good: ['a'] }), corrupt: false });
});

test('sectionNames sorts alphabetically', () => {
  assert.deepEqual(
    DCSections.sectionNames(model({ Zeta: [], Alpha: [] })),
    ['Alpha', 'Zeta']
  );
});

test('add creates the section on first use and rejects duplicates', () => {
  const m = model();
  assert.equal(DCSections.add(m, 'Client X', 'a_1'), true);
  assert.equal(DCSections.add(m, 'Client X', 'a_1'), false);
  assert.deepEqual(m.sections, { 'Client X': ['a_1'] });
});

test('remove deletes only the targeted id and reports misses', () => {
  const m = model({ 'Client X': ['a_1', 'b_2'] });
  assert.equal(DCSections.remove(m, 'Client X', 'a_1'), true);
  assert.equal(DCSections.remove(m, 'Client X', 'nope'), false);
  assert.equal(DCSections.remove(m, 'Ghost', 'a_1'), false);
  assert.deepEqual(m.sections['Client X'], ['b_2']);
});

test('removeEverywhere clears an id from all sections', () => {
  const m = model({ A: ['x_1', 'y_2'], B: ['x_1'], C: ['z_3'] });
  assert.equal(DCSections.removeEverywhere(m, 'x_1'), true);
  assert.equal(DCSections.removeEverywhere(m, 'x_1'), false);
  assert.deepEqual(m.sections, { A: ['y_2'], B: [], C: ['z_3'] });
});

test('renameSection moves membership and rejects collisions', () => {
  const m = model({ Old: ['a_1'], Taken: [] });
  assert.equal(DCSections.renameSection(m, 'Old', 'Taken').ok, false);
  assert.equal(DCSections.renameSection(m, 'Ghost', 'New').ok, false);
  assert.deepEqual(DCSections.renameSection(m, 'Old', 'Old'), { ok: true, changed: false });
  assert.deepEqual(DCSections.renameSection(m, 'Old', 'Fresh'), { ok: true, changed: true });
  assert.deepEqual(m.sections, { Taken: [], Fresh: ['a_1'] });
});

test('deleteSection removes the grouping only', () => {
  const m = model({ Gone: ['a_1'], Stays: ['b_2'] });
  assert.equal(DCSections.deleteSection(m, 'Gone'), true);
  assert.equal(DCSections.deleteSection(m, 'Gone'), false);
  assert.deepEqual(m.sections, { Stays: ['b_2'] });
});

test('migrateId rewrites a renamed comp id in every section', () => {
  const m = model({ A: ['old_1'], B: ['old_1', 'k_9'] });
  assert.equal(DCSections.migrateId(m, 'old_1', 'new_1'), true);
  assert.equal(DCSections.migrateId(m, 'old_1', 'new_1'), false);
  assert.equal(DCSections.migrateId(m, 'k_9', 'k_9'), false);
  assert.deepEqual(m.sections, { A: ['new_1'], B: ['new_1', 'k_9'] });
});

test('prune drops ids missing from the index and keeps empty sections', () => {
  const m = model({ A: ['live_1', 'dead_2'], B: ['dead_2'] });
  assert.equal(DCSections.prune(m, ['live_1']), true);
  assert.equal(DCSections.prune(m, ['live_1']), false);
  assert.deepEqual(m.sections, { A: ['live_1'], B: [] });
});

test('buildGroups pins alphabetical virtual groups with sorted resolved items', () => {
  const m = model({ Zeta: ['b_2'], Alpha: ['a_1', 'missing_9', 'b_2'] });
  const comps = [
    { uniqueId: 'a_1', name: 'A' },
    { uniqueId: 'b_2', name: 'B' },
  ];
  const groups = DCSections.buildGroups(m, comps, (items) => items.slice().reverse(), false);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].category, 'Alpha');
  assert.equal(groups[0].virtual, true);
  assert.deepEqual(groups[0].items.map((c) => c.uniqueId), ['b_2', 'a_1']);
  assert.deepEqual(groups[1].items.map((c) => c.uniqueId), ['b_2']);
});

test('buildGroups keeps empty sections visible unless hideEmpty', () => {
  const m = model({ Empty: [] });
  assert.equal(DCSections.buildGroups(m, [], null, false).length, 1);
  assert.equal(DCSections.buildGroups(m, [], null, true).length, 0);
});

test('collapseKey prefixes to avoid category name clashes', () => {
  assert.equal(DCSections.collapseKey('Client X'), 'sec:Client X');
});

function stubFs(files) {
  const calls = { writes: [], renames: [] };
  return {
    calls,
    existsSync: (p) => Object.prototype.hasOwnProperty.call(files, p),
    readFileSync: (p) => {
      if (!Object.prototype.hasOwnProperty.call(files, p)) throw new Error('ENOENT');
      return files[p];
    },
    writeFileSync: (p, data) => { files[p] = data; calls.writes.push(p); },
    renameSync: (from, to) => {
      files[to] = files[from];
      delete files[from];
      calls.renames.push({ from, to });
    },
  };
}

test('load returns an empty model when the file is missing', () => {
  const fs = stubFs({});
  assert.deepEqual(DCSections.load('/lib', fs), { model: model(), corrupt: false });
});

test('load parses an existing sections file', () => {
  const fs = stubFs({ '/lib/.dropcomp_sections.json': '{"version":1,"sections":{"C":["a_1"]}}' });
  assert.deepEqual(DCSections.load('/lib', fs), { model: model({ C: ['a_1'] }), corrupt: false });
});

test('load quarantines a corrupt file instead of leaving it to be overwritten', () => {
  const fs = stubFs({ '/lib/.dropcomp_sections.json': '{broken' });
  const r = DCSections.load('/lib', fs);
  assert.equal(r.corrupt, true);
  assert.deepEqual(r.model, model());
  assert.equal(fs.calls.renames.length, 1);
  assert.equal(fs.calls.renames[0].from, '/lib/.dropcomp_sections.json');
  assert.match(fs.calls.renames[0].to, /\/lib\/\.dropcomp_sections\.corrupt-\d+\.json$/);
});

test('save writes serialized json and reports write failures', () => {
  const fs = stubFs({});
  const m = model({ C: ['a_1'] });
  assert.deepEqual(DCSections.save('/lib', m, fs), { ok: true, persisted: true });
  assert.deepEqual(DCSections.parse(fs.readFileSync('/lib/.dropcomp_sections.json')).model, m);

  const failing = stubFs({});
  failing.writeFileSync = () => { throw new Error('disk full'); };
  const r = DCSections.save('/lib', m, failing);
  assert.equal(r.ok, false);
  assert.match(r.error, /disk full/);
});

test('load and save degrade to in-memory when fs is unavailable', () => {
  assert.deepEqual(DCSections.load('/lib', null), { model: model(), corrupt: false });
  assert.deepEqual(DCSections.save('/lib', model(), null), { ok: true, persisted: false });
});
