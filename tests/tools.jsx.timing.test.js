const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadTools(options = {}) {
  function CompItem() {}
  const comp = options.comp || new CompItem();
  if (!(comp instanceof CompItem)) {
    Object.setPrototypeOf(comp, CompItem.prototype);
  }
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
    jerr(message) {
      return JSON.stringify({ ok: false, error: message });
    },
    jsonEscape(value) {
      return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    },
  };
  if (options.randomValues) {
    let i = 0;
    context.Math = Object.create(Math);
    context.Math.random = () => {
      const value = options.randomValues[i % options.randomValues.length];
      i += 1;
      return value;
    };
  }
  vm.createContext(context);
  for (const file of ['tools.jsx', 'tools-timing.jsx']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'jsx', file), 'utf8');
    vm.runInContext(src, context, { filename: file });
  }
  return context.$.global;
}

function makeComp(overrides = {}) {
  function CompItem() {}
  const comp = new CompItem();
  comp.time = overrides.time || 0;
  comp.frameDuration = overrides.frameDuration || 0.1;
  comp.selectedProperties = overrides.selectedProperties || [];
  comp.selectedLayers = overrides.selectedLayers || [];
  comp.numLayers = overrides.numLayers || comp.selectedLayers.length;
  comp.layer = (index) => comp.selectedLayers[index - 1];
  return comp;
}

function makeLayer(index, startTime) {
  return {
    index,
    startTime,
    selected: true,
    duplicate() {
      return makeLayer(index + 100, this.startTime);
    },
  };
}

function makeKeyProp(initialKeys, layerIndex = 1, options = {}) {
  const keys = clone(initialKeys);

  function sortKeys() {
    keys.sort((a, b) => a.time - b.time);
  }

  function key(index) {
    assert.ok(index >= 1 && index <= keys.length, `invalid key index ${index}`);
    return keys[index - 1];
  }

  function nearestKeyIndex(time) {
    let bestIndex = 1;
    let bestDistance = Infinity;
    for (let i = 0; i < keys.length; i += 1) {
      const distance = Math.abs(keys[i].time - time);
      if (distance < bestDistance) {
        bestIndex = i + 1;
        bestDistance = distance;
      }
    }
    return bestIndex;
  }

  return {
    setSelectedFlags(selected) {
      for (const currentKey of keys) currentKey.selected = selected;
    },
    snapshot() {
      return clone(keys);
    },
    prop: {
      propertyDepth: 1,
      get selectedKeys() {
        const selected = [];
        for (let i = 0; i < keys.length; i += 1) {
          if (keys[i].selected) selected.push(i + 1);
        }
        return selected;
      },
      propertyGroup() {
        return { index: layerIndex };
      },
      keyTime(index) {
        return key(index).time;
      },
      keyValue(index) {
        return clone(key(index).value);
      },
      nearestKeyIndex,
      addKey(time) {
        if (options.clearSelectionOnAdd) {
          for (const existingKey of keys) existingKey.selected = false;
        }
        keys.push({
          time,
          value: null,
          inType: 'LINEAR',
          outType: 'LINEAR',
          selected: false,
        });
        sortKeys();
        return nearestKeyIndex(time);
      },
      removeKey(index) {
        keys.splice(index - 1, 1);
      },
      setValueAtKey(index, value) {
        key(index).value = clone(value);
      },
      keyInInterpolationType(index) {
        return key(index).inType;
      },
      keyOutInterpolationType(index) {
        return key(index).outType;
      },
      keySelected(index) {
        return key(index).selected;
      },
      setInterpolationTypeAtKey(index, inType, outType) {
        key(index).inType = inType;
        key(index).outType = outType;
      },
      setSelectedAtKey(index, selected) {
        if (options.ignoreSetSelectedAtKey) return;
        key(index).selected = selected;
      },
    },
  };
}

test('tlAdjustTiming aligns selected keyframes so the first key lands on the playhead', () => {
  const keyProp = makeKeyProp([
    { time: 1, value: [10], inType: 'LINEAR', outType: 'LINEAR', selected: true },
    { time: 2, value: [20], inType: 'HOLD', outType: 'HOLD', selected: true },
  ]);
  const comp = makeComp({ time: 3, selectedProperties: [keyProp.prop] });
  const tools = loadTools({ comp });

  const result = JSON.parse(tools.tlAdjustTiming('1', '5', 'align'));

  assert.equal(result.ok, true);
  assert.deepEqual(
    keyProp.snapshot().map((k) => k.time),
    [3, 4]
  );
});

test('tlAdjustTiming keeps all moved keyframes selected so repeated presses stay on keyframes', () => {
  const keyProp = makeKeyProp(
    [
      { time: 1, value: [10], inType: 'LINEAR', outType: 'LINEAR', selected: true },
      { time: 2, value: [20], inType: 'HOLD', outType: 'HOLD', selected: true },
      { time: 3, value: [30], inType: 'BEZIER', outType: 'BEZIER', selected: true },
    ],
    1,
    { clearSelectionOnAdd: true }
  );
  const layer = makeLayer(1, 10);
  const comp = makeComp({
    frameDuration: 0.1,
    selectedProperties: [keyProp.prop],
    selectedLayers: [layer],
  });
  const tools = loadTools({ comp });

  const result = JSON.parse(tools.tlAdjustTiming('1', '5', 'sequence'));

  assert.equal(result.target, 'keys');
  assert.deepEqual(keyProp.prop.selectedKeys, [1, 2, 3]);
  assert.deepEqual(
    keyProp.snapshot().map((k) => k.time),
    [1, 2.5, 4]
  );
  assert.equal(layer.startTime, 10);
});

test('tlAdjustTiming reuses key target when AE drops selectedProperties after key timing', () => {
  const keyProp = makeKeyProp([
    { time: 1, value: [10], inType: 'LINEAR', outType: 'LINEAR', selected: true },
    { time: 2, value: [20], inType: 'HOLD', outType: 'HOLD', selected: true },
    { time: 3, value: [30], inType: 'BEZIER', outType: 'BEZIER', selected: true },
  ]);
  const layer = makeLayer(1, 10);
  const comp = makeComp({
    frameDuration: 0.1,
    selectedProperties: [keyProp.prop],
    selectedLayers: [layer],
  });
  const tools = loadTools({ comp });

  const first = JSON.parse(tools.tlAdjustTiming('1', '5', 'sequence'));
  comp.selectedProperties = [];
  const second = JSON.parse(tools.tlAdjustTiming('1', '5', 'sequence'));

  assert.equal(first.target, 'keys');
  assert.equal(second.target, 'keys');
  assert.deepEqual(
    keyProp.snapshot().map((k) => k.time),
    [1, 3, 5]
  );
  assert.equal(layer.startTime, 10);
});

test('tlAdjustTiming keeps cached key target when AE stops reporting selected keys', () => {
  const keyProp = makeKeyProp([
    { time: 1, value: [10], inType: 'LINEAR', outType: 'LINEAR', selected: true },
    { time: 2, value: [20], inType: 'HOLD', outType: 'HOLD', selected: true },
  ]);
  const layer = makeLayer(1, 10);
  const comp = makeComp({
    frameDuration: 0.1,
    selectedProperties: [keyProp.prop],
    selectedLayers: [layer],
  });
  const tools = loadTools({ comp });

  const first = JSON.parse(tools.tlAdjustTiming('1', '5', 'sequence'));
  keyProp.setSelectedFlags(false);
  comp.selectedProperties = [];
  const second = JSON.parse(tools.tlAdjustTiming('1', '5', 'sequence'));

  assert.equal(first.target, 'keys');
  assert.equal(second.target, 'keys');
  assert.deepEqual(
    keyProp.snapshot().map((k) => k.time),
    [1, 3]
  );
  assert.equal(layer.startTime, 10);
});

test('tlAdjustTiming keeps key target for repeated presses even when setSelectedAtKey does not stick', () => {
  const keyProp = makeKeyProp(
    [
      { time: 1, value: [10], inType: 'LINEAR', outType: 'LINEAR', selected: true },
      { time: 2, value: [20], inType: 'HOLD', outType: 'HOLD', selected: true },
    ],
    1,
    { ignoreSetSelectedAtKey: true }
  );
  const layer = makeLayer(1, 10);
  const comp = makeComp({
    frameDuration: 0.1,
    selectedProperties: [keyProp.prop],
    selectedLayers: [layer],
  });
  const tools = loadTools({ comp });

  const first = JSON.parse(tools.tlAdjustTiming('1', '5', 'sequence'));
  keyProp.setSelectedFlags(false);
  comp.selectedProperties = [];
  const second = JSON.parse(tools.tlAdjustTiming('1', '5', 'sequence'));
  const third = JSON.parse(tools.tlAdjustTiming('1', '5', 'sequence'));

  assert.equal(first.target, 'keys');
  assert.equal(second.target, 'keys');
  assert.equal(third.target, 'keys');
  assert.deepEqual(
    keyProp.snapshot().map((k) => k.time),
    [1, 3.5]
  );
  assert.equal(layer.startTime, 10);
});

test('tlAdjustTiming can use layers after key target layer selection changes', () => {
  const keyProp = makeKeyProp([
    { time: 1, value: [10], inType: 'LINEAR', outType: 'LINEAR', selected: true },
    { time: 2, value: [20], inType: 'HOLD', outType: 'HOLD', selected: true },
  ]);
  const firstLayer = makeLayer(1, 10);
  const secondLayer = makeLayer(2, 20);
  const comp = makeComp({
    frameDuration: 0.1,
    selectedProperties: [keyProp.prop],
    selectedLayers: [firstLayer],
  });
  const tools = loadTools({ comp });

  const first = JSON.parse(tools.tlAdjustTiming('1', '5', 'sequence'));
  keyProp.setSelectedFlags(false);
  comp.selectedProperties = [];
  comp.selectedLayers = [secondLayer];
  const second = JSON.parse(tools.tlAdjustTiming('1', '5', 'align'));

  assert.equal(first.target, 'keys');
  assert.equal(second.target, 'layers');
  assert.equal(firstLayer.startTime, 10);
  assert.equal(secondLayer.startTime, 0);
});

test('tlAdjustTiming aligns selected layers to the playhead when no keyframes are selected', () => {
  const layers = [makeLayer(2, 1), makeLayer(1, 2.5)];
  const comp = makeComp({ time: 4, selectedLayers: layers });
  const tools = loadTools({ comp });

  const result = JSON.parse(tools.tlAdjustTiming('1', '5', 'align'));

  assert.equal(result.ok, true);
  assert.equal(result.target, 'layers');
  assert.deepEqual(layers.map((layer) => layer.startTime), [4, 4]);
});

test('tlAdjustTiming randomizes selected layers into unique Step-based frame slots', () => {
  const layers = [makeLayer(1, 1), makeLayer(2, 2), makeLayer(3, 3)];
  const comp = makeComp({ frameDuration: 0.1, selectedLayers: layers });
  const tools = loadTools({ comp, randomValues: [0.1, 0.9, 0.5] });

  const result = JSON.parse(tools.tlAdjustTiming('3', '5', 'random'));

  assert.equal(result.ok, true);
  assert.equal(result.target, 'layers');
  assert.deepEqual(layers.map((layer) => layer.startTime), [1, 2.5, 2]);
});

test('tlAdjustTiming randomizes selected keyframes into unique Step-based frame slots', () => {
  const keyProp = makeKeyProp([
    { time: 1, value: [10], inType: 'LINEAR', outType: 'LINEAR', selected: true },
    { time: 2, value: [20], inType: 'HOLD', outType: 'HOLD', selected: true },
    { time: 3, value: [30], inType: 'BEZIER', outType: 'BEZIER', selected: true },
  ]);
  const comp = makeComp({ frameDuration: 0.1, selectedProperties: [keyProp.prop] });
  const tools = loadTools({ comp, randomValues: [0.1, 0.9, 0.5] });

  const result = JSON.parse(tools.tlAdjustTiming('3', '5', 'random'));

  assert.equal(result.ok, true);
  assert.equal(result.target, 'keys');
  assert.deepEqual(
    keyProp.snapshot().map((k) => k.time),
    [1, 2, 2.5]
  );
});
