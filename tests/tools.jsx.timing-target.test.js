// bug-011: timing tools must pick exactly one target mode and never let a
// stale key-timing session hijack a deliberate layer distribution.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// Loader with a controllable clock and a swappable active comp, so tests can
// simulate time passing between panel presses and AE re-wrapping comp objects.
function loadTools(comp) {
  function CompItem() {}
  if (!(comp instanceof CompItem)) Object.setPrototypeOf(comp, CompItem.prototype);
  const clock = { now: 1000000 };
  function FakeDate() {}
  FakeDate.prototype.getTime = function () { return clock.now; };
  const context = {
    $: { global: {} },
    app: {
      project: { activeItem: comp },
      beginUndoGroup() {},
      endUndoGroup() {},
    },
    CompItem,
    CameraLayer: function CameraLayer() {},
    LightLayer: function LightLayer() {},
    Date: FakeDate,
    jerr(message) { return JSON.stringify({ ok: false, error: message }); },
    jsonEscape(value) { return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); },
  };
  vm.createContext(context);
  for (const file of ['tools.jsx', 'tools-timing.jsx']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'jsx', file), 'utf8');
    vm.runInContext(src, context, { filename: file });
  }
  return {
    tools: context.$.global,
    clock,
    setActiveComp(next) {
      if (!(next instanceof context.CompItem)) Object.setPrototypeOf(next, context.CompItem.prototype);
      context.app.project.activeItem = next;
    },
    CompItem: context.CompItem,
  };
}

function makeComp(overrides = {}) {
  return {
    id: overrides.id,
    time: overrides.time || 0,
    frameDuration: overrides.frameDuration || 0.1,
    selectedProperties: overrides.selectedProperties || [],
    selectedLayers: overrides.selectedLayers || [],
  };
}

function makeLayer(index, startTime) {
  return { index, startTime, selected: true };
}

function makeKeyProp(initialKeys, layerIndex = 1) {
  const keys = clone(initialKeys);
  function key(index) { return keys[index - 1]; }
  function nearestKeyIndex(time) {
    let bestIndex = 1, bestDistance = Infinity;
    for (let i = 0; i < keys.length; i += 1) {
      const d = Math.abs(keys[i].time - time);
      if (d < bestDistance) { bestIndex = i + 1; bestDistance = d; }
    }
    return bestIndex;
  }
  return {
    setSelectedFlags(selected) { for (const k of keys) k.selected = selected; },
    snapshot() { return clone(keys); },
    prop: {
      propertyDepth: 1,
      get numKeys() { return keys.length; },
      get selectedKeys() {
        const out = [];
        for (let i = 0; i < keys.length; i += 1) if (keys[i].selected) out.push(i + 1);
        return out;
      },
      propertyGroup() { return { index: layerIndex }; },
      keyTime(i) { return key(i).time; },
      keyValue(i) { return clone(key(i).value); },
      nearestKeyIndex,
      addKey(time) {
        keys.push({ time, value: null, inType: 'BEZIER', outType: 'BEZIER', selected: false });
        keys.sort((a, b) => a.time - b.time);
        return nearestKeyIndex(time);
      },
      removeKey(i) { keys.splice(i - 1, 1); },
      setValueAtKey(i, v) { key(i).value = clone(v); },
      keyInInterpolationType(i) { return key(i).inType; },
      keyOutInterpolationType(i) { return key(i).outType; },
      setInterpolationTypeAtKey(i, inT, outT) { key(i).inType = inT; key(i).outType = outT; },
      keySelected(i) { return key(i).selected; },
      setSelectedAtKey(i, s) { key(i).selected = s; },
    },
  };
}

test('a stale key-timing session expires: layers selected later distribute as layers', () => {
  const keyProp = makeKeyProp([
    { time: 1, value: [10], inType: 'LINEAR', outType: 'LINEAR', selected: true },
    { time: 2, value: [20], inType: 'LINEAR', outType: 'LINEAR', selected: true },
  ]);
  const layer = makeLayer(1, 10);
  const comp = makeComp({ frameDuration: 0.1, selectedProperties: [keyProp.prop], selectedLayers: [layer] });
  const { tools, clock } = loadTools(comp);

  const first = JSON.parse(tools.tlAdjustTiming('1', '5', 'sequence'));
  assert.equal(first.target, 'keys');

  // the user moves on: key selection is gone, the same layers are selected,
  // and enough time has passed that this is clearly a new intent
  keyProp.setSelectedFlags(false);
  comp.selectedProperties = [];
  clock.now += 60000;
  const second = JSON.parse(tools.tlAdjustTiming('1', '5', 'align'));

  assert.equal(second.target, 'layers', 'expired key session must not hijack a layer align');
  assert.equal(layer.startTime, 0, 'the selected layer aligns to the playhead');
  assert.deepEqual(keyProp.snapshot().map((k) => k.time), [1, 2.5], 'keys keep the values from the first press only');
});

test('rapid repeated presses inside the session window keep targeting the same keys', () => {
  const keyProp = makeKeyProp([
    { time: 1, value: [10], inType: 'LINEAR', outType: 'LINEAR', selected: true },
    { time: 2, value: [20], inType: 'LINEAR', outType: 'LINEAR', selected: true },
  ]);
  const layer = makeLayer(1, 10);
  const comp = makeComp({ frameDuration: 0.1, selectedProperties: [keyProp.prop], selectedLayers: [layer] });
  const { tools, clock } = loadTools(comp);

  const first = JSON.parse(tools.tlAdjustTiming('1', '5', 'sequence'));
  keyProp.setSelectedFlags(false);
  comp.selectedProperties = [];
  clock.now += 2000; // quick second press
  const second = JSON.parse(tools.tlAdjustTiming('1', '5', 'sequence'));

  assert.equal(first.target, 'keys');
  assert.equal(second.target, 'keys');
  assert.deepEqual(keyProp.snapshot().map((k) => k.time), [1, 3]);
  assert.equal(layer.startTime, 10, 'layers stay put during a key session');
});

test('each key press refreshes the session window', () => {
  const keyProp = makeKeyProp([
    { time: 1, value: [10], inType: 'LINEAR', outType: 'LINEAR', selected: true },
    { time: 2, value: [20], inType: 'LINEAR', outType: 'LINEAR', selected: true },
  ]);
  const layer = makeLayer(1, 10);
  const comp = makeComp({ frameDuration: 0.1, selectedProperties: [keyProp.prop], selectedLayers: [layer] });
  const { tools, clock } = loadTools(comp);

  JSON.parse(tools.tlAdjustTiming('1', '5', 'sequence'));
  keyProp.setSelectedFlags(false);
  comp.selectedProperties = [];
  // three nudges, each inside the window measured from the previous press
  for (let i = 0; i < 3; i += 1) {
    clock.now += 10000;
    const r = JSON.parse(tools.tlAdjustTiming('1', '5', 'sequence'));
    assert.equal(r.target, 'keys', `press ${i + 2} stays on keys`);
  }
  assert.equal(layer.startTime, 10);
});

test('the key session survives AE re-wrapping the same comp (matched by id)', () => {
  const keyProp = makeKeyProp([
    { time: 1, value: [10], inType: 'LINEAR', outType: 'LINEAR', selected: true },
    { time: 2, value: [20], inType: 'LINEAR', outType: 'LINEAR', selected: true },
  ]);
  const layer = makeLayer(1, 10);
  const comp = makeComp({ id: 42, frameDuration: 0.1, selectedProperties: [keyProp.prop], selectedLayers: [layer] });
  const { tools, clock, setActiveComp } = loadTools(comp);

  const first = JSON.parse(tools.tlAdjustTiming('1', '5', 'sequence'));
  keyProp.setSelectedFlags(false);

  // AE hands the next evalScript call a fresh wrapper object for the same comp
  const rewrapped = makeComp({ id: 42, frameDuration: 0.1, selectedProperties: [], selectedLayers: [layer] });
  setActiveComp(rewrapped);
  clock.now += 2000;
  const second = JSON.parse(tools.tlAdjustTiming('1', '5', 'sequence'));

  assert.equal(first.target, 'keys');
  assert.equal(second.target, 'keys', 'same comp id keeps the key session alive');
  assert.deepEqual(keyProp.snapshot().map((k) => k.time), [1, 3]);
});

test('switching to a different comp (different id) drops the key session', () => {
  const keyProp = makeKeyProp([
    { time: 1, value: [10], inType: 'LINEAR', outType: 'LINEAR', selected: true },
    { time: 2, value: [20], inType: 'LINEAR', outType: 'LINEAR', selected: true },
  ]);
  const layerA = makeLayer(1, 10);
  const comp = makeComp({ id: 42, frameDuration: 0.1, selectedProperties: [keyProp.prop], selectedLayers: [layerA] });
  const { tools, clock, setActiveComp } = loadTools(comp);

  JSON.parse(tools.tlAdjustTiming('1', '5', 'sequence'));
  keyProp.setSelectedFlags(false);

  const layerB = makeLayer(1, 7);
  const otherComp = makeComp({ id: 43, time: 3, frameDuration: 0.1, selectedProperties: [], selectedLayers: [layerB] });
  setActiveComp(otherComp);
  clock.now += 2000;
  const second = JSON.parse(tools.tlAdjustTiming('1', '5', 'align'));

  assert.equal(second.target, 'layers', 'a different comp starts fresh');
  assert.equal(layerB.startTime, 3);
});
