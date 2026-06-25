const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadToolsContext(time) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'jsx', 'tools.jsx'), 'utf8');
  const context = {
    $: { global: {} },
    app: { project: { activeItem: { time } } },
    CompItem: function CompItem() {},
    CameraLayer: function CameraLayer() {},
    LightLayer: function LightLayer() {},
    AVLayer: function AVLayer() {},
    ShapeLayer: function ShapeLayer() {},
    TextLayer: function TextLayer() {},
    jerr: (message) => `{"ok":false,"error":"${message}"}`,
    jsonEscape: (value) => String(value),
  };
  vm.createContext(context);
  vm.runInContext(src, context);
  return context.$.global;
}

function makeLayer(positionProperty) {
  return {
    threeDLayer: false,
    property(name) {
      assert.equal(name, 'ADBE Transform Group');
      return {
        property(propName) {
          assert.equal(propName, 'ADBE Position');
          return positionProperty;
        },
      };
    },
  };
}

test('tlWritePos writes animated position at the active comp time', () => {
  const tools = loadToolsContext(3.25);
  const calls = [];
  const positionProperty = {
    value: [10, 20],
    numKeys: 1,
    dimensionsSeparated: false,
    setValue(value) {
      calls.push({ method: 'setValue', value });
    },
    setValueAtTime(time, value) {
      calls.push({ method: 'setValueAtTime', time, value });
    },
  };

  tools.tlWritePos(makeLayer(positionProperty), 30, 40);

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { method: 'setValueAtTime', time: 3.25, value: [30, 40] },
  ]);
});
