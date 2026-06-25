const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadTools(comp) {
  function CompItem() {}
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
  return {
    time: overrides.time || 0,
    frameDuration: overrides.frameDuration || 0.1,
    selectedProperties: overrides.selectedProperties || [],
    selectedLayers: overrides.selectedLayers || [],
  };
}

function makeLayer(index, startTime) {
  return { index, startTime, selected: true };
}

function makeNoKeyProp(layerIndex) {
  return {
    propertyDepth: 1,
    numKeys: 0,
    get selectedKeys() {
      throw new Error('Can not operations on keys for this property because it has no keyframes.');
    },
    propertyGroup() {
      return { index: layerIndex };
    },
  };
}

function makeKeyProp(initialKeys, options = {}) {
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
      get numKeys() {
        return keys.length;
      },
      get selectedKeys() {
        const selected = [];
        for (let i = 0; i < keys.length; i += 1) {
          if (keys[i].selected) selected.push(i + 1);
        }
        return selected;
      },
      propertyGroup() {
        return { index: 1 };
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
          inType: 'BEZIER',
          outType: 'BEZIER',
          inEase: [{ speed: 0, influence: 33.333 }],
          outEase: [{ speed: 0, influence: 33.333 }],
          temporalAuto: false,
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
      setInterpolationTypeAtKey(index, inType, outType) {
        key(index).inType = inType;
        key(index).outType = outType;
      },
      keyInTemporalEase(index) {
        return clone(key(index).inEase);
      },
      keyOutTemporalEase(index) {
        return clone(key(index).outEase);
      },
      setTemporalEaseAtKey(index, inEase, outEase) {
        key(index).inEase = clone(inEase);
        key(index).outEase = clone(outEase);
      },
      keyTemporalAutoBezier(index) {
        return key(index).temporalAuto;
      },
      setTemporalAutoBezierAtKey(index, temporalAuto) {
        key(index).temporalAuto = temporalAuto;
        if (options.autoBezierMutatesInterpolation && temporalAuto) {
          key(index).inType = 'BEZIER';
          key(index).outType = 'BEZIER';
          key(index).inEase = [{ speed: 0, influence: 33.333 }];
          key(index).outEase = [{ speed: 0, influence: 33.333 }];
        }
      },
      keySelected(index) {
        return key(index).selected;
      },
      setSelectedAtKey(index, selected) {
        key(index).selected = selected;
      },
    },
  };
}

test('tlAdjustTiming uses layer timing when the selected property has no keyframes', () => {
  const keyProp = makeKeyProp([
    { time: 1, value: [10], inType: 'LINEAR', outType: 'LINEAR', selected: true },
    { time: 2, value: [20], inType: 'LINEAR', outType: 'LINEAR', selected: true },
  ]);
  const layer = makeLayer(1, 10);
  const comp = makeComp({
    time: 5,
    frameDuration: 0.1,
    selectedProperties: [keyProp.prop],
    selectedLayers: [layer],
  });
  const tools = loadTools(comp);

  const first = JSON.parse(tools.tlAdjustTiming('1', '5', 'sequence'));
  comp.selectedProperties = [makeNoKeyProp(1)];
  const second = JSON.parse(tools.tlAdjustTiming('1', '5', 'align'));

  assert.equal(first.target, 'keys');
  assert.equal(second.target, 'layers');
  assert.equal(layer.startTime, 5);
});

test('tlAdjustTiming keeps cached key timing for keyed properties with no selected keys reported', () => {
  const keyProp = makeKeyProp([
    { time: 1, value: [10], inType: 'LINEAR', outType: 'LINEAR', selected: true },
    { time: 2, value: [20], inType: 'LINEAR', outType: 'LINEAR', selected: true },
  ]);
  const layer = makeLayer(1, 10);
  const comp = makeComp({
    frameDuration: 0.1,
    selectedProperties: [keyProp.prop],
    selectedLayers: [layer],
  });
  const tools = loadTools(comp);

  const first = JSON.parse(tools.tlAdjustTiming('1', '5', 'sequence'));
  keyProp.setSelectedFlags(false);
  const second = JSON.parse(tools.tlAdjustTiming('1', '5', 'sequence'));

  assert.equal(first.target, 'keys');
  assert.equal(second.target, 'keys');
  assert.deepEqual(
    keyProp.snapshot().map((k) => k.time),
    [1, 3]
  );
  assert.equal(layer.startTime, 10);
});

test('tlSetKeyTimes restores explicit interpolation and ease after auto-bezier flags', () => {
  const keyProp = makeKeyProp(
    [
      {
        time: 1,
        value: [10],
        inType: 'LINEAR',
        outType: 'LINEAR',
        inEase: [{ speed: 12, influence: 20 }],
        outEase: [{ speed: 13, influence: 25 }],
        temporalAuto: true,
        selected: true,
      },
      {
        time: 2,
        value: [20],
        inType: 'HOLD',
        outType: 'HOLD',
        inEase: [{ speed: 22, influence: 30 }],
        outEase: [{ speed: 23, influence: 35 }],
        temporalAuto: true,
        selected: true,
      },
    ],
    { autoBezierMutatesInterpolation: true }
  );
  const comp = makeComp({ frameDuration: 0.1, selectedProperties: [keyProp.prop] });
  const tools = loadTools(comp);

  const result = JSON.parse(tools.tlAdjustTiming('1', '5', 'sequence'));

  assert.equal(result.target, 'keys');
  assert.deepEqual(
    keyProp.snapshot().map((k) => ({
      time: k.time,
      inType: k.inType,
      outType: k.outType,
      inEase: k.inEase,
      outEase: k.outEase,
    })),
    [
      {
        time: 1,
        inType: 'LINEAR',
        outType: 'LINEAR',
        inEase: [{ speed: 12, influence: 20 }],
        outEase: [{ speed: 13, influence: 25 }],
      },
      {
        time: 2.5,
        inType: 'HOLD',
        outType: 'HOLD',
        inEase: [{ speed: 22, influence: 30 }],
        outEase: [{ speed: 23, influence: 35 }],
      },
    ]
  );
});
