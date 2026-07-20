// Reverse timing mode: a reversed cascade anchored at the group's earliest
// start. Regression for the field report where Reverse pushed layers earlier
// on every click (off the front of the comp) instead of reversing the order.
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

function makeKeyProp(initialKeys, layerIndex = 1) {
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
        key(index).selected = selected;
      },
    },
  };
}

test('reverse builds a reversed cascade anchored at the earliest start, not a backward drift', () => {
  const layers = [makeLayer(1, 2), makeLayer(2, 2), makeLayer(3, 2)];
  const comp = makeComp({ frameDuration: 0.1, selectedLayers: layers });
  const tools = loadTools({ comp });

  const result = JSON.parse(tools.tlAdjustTiming('1', '5', 'reverse'));

  assert.equal(result.ok, true);
  assert.equal(result.target, 'layers');
  // Last layer starts first; nothing may move earlier than the old earliest start.
  assert.deepEqual(layers.map((layer) => layer.startTime), [3, 2.5, 2]);
});

test('repeated reverse presses keep flipping the cascade without drifting off the front', () => {
  const layers = [makeLayer(1, 0), makeLayer(2, 0), makeLayer(3, 0)];
  const comp = makeComp({ frameDuration: 0.1, selectedLayers: layers });
  const tools = loadTools({ comp });

  tools.tlAdjustTiming('1', '5', 'reverse');
  const once = layers.map((layer) => layer.startTime);
  tools.tlAdjustTiming('1', '5', 'reverse');
  const twice = layers.map((layer) => layer.startTime);
  tools.tlAdjustTiming('1', '5', 'reverse');
  const thrice = layers.map((layer) => layer.startTime);

  // Each press reverses the current order; nothing ever moves earlier than
  // the group's earliest start (the b7a6834 drift regression stays fixed).
  assert.deepEqual(once, [1, 0.5, 0]);
  assert.deepEqual(twice, [0, 0.5, 1]);
  assert.deepEqual(thrice, once);
  assert.ok(Math.min(...once, ...twice, ...thrice) >= 0);
});

test('sequence then reverse flips the cascade order within the same time span', () => {
  const layers = [makeLayer(1, 1), makeLayer(2, 1), makeLayer(3, 1)];
  const comp = makeComp({ frameDuration: 0.1, selectedLayers: layers });
  const tools = loadTools({ comp });

  tools.tlAdjustTiming('1', '5', 'sequence');
  assert.deepEqual(layers.map((layer) => layer.startTime), [1, 1.5, 2]);

  tools.tlAdjustTiming('1', '5', 'reverse');
  assert.deepEqual(layers.map((layer) => layer.startTime), [2, 1.5, 1]);
});

test('reverse on keyframe groups staggers later layers earlier without leaving the span', () => {
  const firstProp = makeKeyProp(
    [
      { time: 2, value: [10], inType: 'LINEAR', outType: 'LINEAR', selected: true },
      { time: 3, value: [20], inType: 'LINEAR', outType: 'LINEAR', selected: true },
    ],
    1
  );
  const secondProp = makeKeyProp(
    [
      { time: 2, value: [30], inType: 'LINEAR', outType: 'LINEAR', selected: true },
      { time: 3, value: [40], inType: 'LINEAR', outType: 'LINEAR', selected: true },
    ],
    2
  );
  const layers = [makeLayer(1, 0), makeLayer(2, 0)];
  const comp = makeComp({
    frameDuration: 0.1,
    selectedProperties: [firstProp.prop, secondProp.prop],
    selectedLayers: layers,
  });
  const tools = loadTools({ comp });

  const result = JSON.parse(tools.tlAdjustTiming('1', '5', 'reverse'));

  assert.equal(result.ok, true);
  assert.equal(result.target, 'keys');
  // Layer 1's group moves to the late slot, layer 2's group anchors the span.
  assert.deepEqual(firstProp.snapshot().map((k) => k.time), [2.5, 3.5]);
  assert.deepEqual(secondProp.snapshot().map((k) => k.time), [2, 3]);
  // Layer bars themselves must not move when keyframes are the target.
  assert.deepEqual(layers.map((layer) => layer.startTime), [0, 0]);
});

test('pressing reverse twice on keyframe groups restores the original stagger', () => {
  const firstProp = makeKeyProp(
    [
      { time: 2, value: [10], inType: 'LINEAR', outType: 'LINEAR', selected: true },
      { time: 3, value: [20], inType: 'LINEAR', outType: 'LINEAR', selected: true },
    ],
    1
  );
  const secondProp = makeKeyProp(
    [
      { time: 2.5, value: [30], inType: 'LINEAR', outType: 'LINEAR', selected: true },
      { time: 3.5, value: [40], inType: 'LINEAR', outType: 'LINEAR', selected: true },
    ],
    2
  );
  const layers = [makeLayer(1, 0), makeLayer(2, 0)];
  const comp = makeComp({
    frameDuration: 0.1,
    selectedProperties: [firstProp.prop, secondProp.prop],
    selectedLayers: layers,
  });
  const tools = loadTools({ comp });

  tools.tlAdjustTiming('1', '5', 'reverse');
  // Layer 1's group (earliest) takes the late slot, layer 2's group anchors.
  assert.deepEqual(firstProp.snapshot().map((k) => k.time), [2.5, 3.5]);
  assert.deepEqual(secondProp.snapshot().map((k) => k.time), [2, 3]);

  tools.tlAdjustTiming('1', '5', 'reverse');
  // Second press reverses the reversed cascade back to the original order.
  assert.deepEqual(firstProp.snapshot().map((k) => k.time), [2, 3]);
  assert.deepEqual(secondProp.snapshot().map((k) => k.time), [2.5, 3.5]);
});

test('reverse moves all properties of a layer group together by the group delta', () => {
  // Layer 1 has two properties with different first-key times; both must
  // shift by the same group delta so their relative offset is preserved.
  const positionProp = makeKeyProp(
    [
      { time: 1, value: [10], inType: 'LINEAR', outType: 'LINEAR', selected: true },
      { time: 2, value: [20], inType: 'LINEAR', outType: 'LINEAR', selected: true },
    ],
    1
  );
  const opacityProp = makeKeyProp(
    [{ time: 1.2, value: [50], inType: 'LINEAR', outType: 'LINEAR', selected: true }],
    1
  );
  const otherLayerProp = makeKeyProp(
    [
      { time: 2, value: [30], inType: 'LINEAR', outType: 'LINEAR', selected: true },
      { time: 3, value: [40], inType: 'LINEAR', outType: 'LINEAR', selected: true },
    ],
    2
  );
  const layers = [makeLayer(1, 0), makeLayer(2, 0)];
  const comp = makeComp({
    frameDuration: 0.1,
    selectedProperties: [positionProp.prop, opacityProp.prop, otherLayerProp.prop],
    selectedLayers: layers,
  });
  const tools = loadTools({ comp });

  tools.tlAdjustTiming('1', '5', 'reverse');
  // Group firsts: layer 1 at 1, layer 2 at 2. Reversed slots: layer 1 -> 1.5,
  // layer 2 -> 1. Layer 1 delta +0.5, layer 2 delta -1.
  assert.deepEqual(positionProp.snapshot().map((k) => k.time), [1.5, 2.5]);
  assert.deepEqual(opacityProp.snapshot().map((k) => k.time), [1.7]);
  assert.deepEqual(otherLayerProp.snapshot().map((k) => k.time), [1, 2]);

  tools.tlAdjustTiming('1', '5', 'reverse');
  // Toggle back: layer 2 (now earliest at 1) takes the late slot again.
  assert.deepEqual(positionProp.snapshot().map((k) => k.time), [1, 2]);
  assert.deepEqual(opacityProp.snapshot().map((k) => k.time), [1.2]);
  assert.deepEqual(otherLayerProp.snapshot().map((k) => k.time), [1.5, 2.5]);
});

test('reverse on a single property time-reverses its keys anchored at the first key', () => {
  const keyProp = makeKeyProp([
    { time: 1, value: [10], inType: 'LINEAR', outType: 'LINEAR', selected: true },
    { time: 1.5, value: [20], inType: 'LINEAR', outType: 'LINEAR', selected: true },
    { time: 2, value: [30], inType: 'LINEAR', outType: 'LINEAR', selected: true },
  ]);
  const layer = makeLayer(1, 10);
  const comp = makeComp({
    frameDuration: 0.1,
    selectedProperties: [keyProp.prop],
    selectedLayers: [layer],
  });
  const tools = loadTools({ comp });

  const result = JSON.parse(tools.tlAdjustTiming('1', '5', 'reverse'));

  assert.equal(result.ok, true);
  assert.equal(result.target, 'keys');
  const snapshot = keyProp.snapshot();
  assert.deepEqual(snapshot.map((k) => k.time), [1, 1.5, 2]);
  // Same span, values now play in reverse order.
  assert.deepEqual(snapshot.map((k) => k.value), [[30], [20], [10]]);
  assert.equal(layer.startTime, 10);
});

test('reverse on a single layer still duplicates like sequence, just backward', () => {
  const layer = makeLayer(1, 5);
  const comp = makeComp({ frameDuration: 0.1, selectedLayers: [layer] });
  const tools = loadTools({ comp });
  tools.tlSelectOnly = () => {};

  const result = JSON.parse(tools.tlAdjustTiming('2', '5', 'reverse'));

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'duplicate');
  assert.equal(result.count, 2);
});
