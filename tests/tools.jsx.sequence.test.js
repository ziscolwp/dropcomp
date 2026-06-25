const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadTools() {
  const context = {
    $: { global: {} },
    app: {},
    CompItem: function CompItem() {},
    CameraLayer: function CameraLayer() {},
    LightLayer: function LightLayer() {},
  };
  vm.createContext(context);
  const src = fs.readFileSync(path.join(__dirname, '..', 'jsx', 'tools.jsx'), 'utf8');
  vm.runInContext(src, context, { filename: 'tools.jsx' });
  return context.$.global;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeKeyProp(initialKeys) {
  const keys = clone(initialKeys);
  const calls = [];

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
    calls,
    snapshot() {
      return clone(keys);
    },
    prop: {
      keyTime(index) {
        return key(index).time;
      },
      keyValue(index) {
        return clone(key(index).value);
      },
      nearestKeyIndex,
      addKey(time) {
        calls.push(['addKey', time]);
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
        calls.push(['removeKey', key(index).time]);
        keys.splice(index - 1, 1);
      },
      setValueAtKey(index, value) {
        calls.push(['setValueAtKey', key(index).time, clone(value)]);
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
        calls.push(['setInterpolationTypeAtKey', key(index).time, inType, outType]);
        key(index).inType = inType;
        key(index).outType = outType;
      },
      setSelectedAtKey(index, selected) {
        calls.push(['setSelectedAtKey', key(index).time, selected]);
        key(index).selected = selected;
      },
    },
  };
}

test('tlApplyKeyDeltas moves selected keyframes without setKeyTime and keeps them selected', () => {
  const tools = loadTools();
  const keyProp = makeKeyProp([
    { time: 1, value: [10, 10], inType: 'LINEAR', outType: 'LINEAR', selected: true },
    { time: 2, value: [20, 20], inType: 'BEZIER', outType: 'HOLD', selected: true },
    { time: 3, value: [30, 30], inType: 'HOLD', outType: 'BEZIER', selected: true },
  ]);

  tools.tlApplyKeyDeltas(keyProp.prop, [1, 2, 3], [0, 0.5, 1], true);

  assert.deepEqual(keyProp.snapshot(), [
    { time: 1, value: [10, 10], inType: 'LINEAR', outType: 'LINEAR', selected: true },
    { time: 2.5, value: [20, 20], inType: 'BEZIER', outType: 'HOLD', selected: true },
    { time: 4, value: [30, 30], inType: 'HOLD', outType: 'BEZIER', selected: true },
  ]);
  assert.deepEqual(
    keyProp.calls.filter((call) => call[0] === 'addKey').map((call) => call[1]),
    [4, 2.5]
  );
});
