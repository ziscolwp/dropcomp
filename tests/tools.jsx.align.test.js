const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadToolsContext() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'jsx', 'tools.jsx'), 'utf8');
  const context = {
    $: { global: {} },
    app: {
      project: { activeItem: null },
      beginUndoGroup() {},
      endUndoGroup() {},
    },
    CompItem: function CompItem() {},
    CameraLayer: function CameraLayer() {},
    LightLayer: function LightLayer() {},
    jerr(message) {
      return JSON.stringify({ ok: false, error: String(message) });
    },
    jsonEscape(value) {
      return String(value);
    },
  };
  vm.createContext(context);
  vm.runInContext(src, context);
  return context;
}

function makeTransform(positionProperty) {
  return {
    property(name) {
      if (name === 'ADBE Position') return positionProperty;
      if (name === 'ADBE Anchor Point') return { value: [0, 0] };
      if (name === 'ADBE Scale') return { value: [100, 100] };
      throw new Error('Unexpected transform property: ' + name);
    },
  };
}

function makeLayer(positionProperty) {
  const transform = makeTransform(positionProperty);
  return {
    threeDLayer: false,
    parent: null,
    property(name) {
      assert.equal(name, 'ADBE Transform Group');
      return transform;
    },
    sourceRectAtTime(time, includeExtents) {
      assert.equal(time, 2.5);
      assert.equal(includeExtents, false);
      return { left: 0, top: 0, width: 20, height: 10 };
    },
  };
}

test('tlAlign writes keyframed position at the comp playhead', () => {
  const context = loadToolsContext();
  const comp = new context.CompItem();
  const writes = [];
  const positionProperty = {
    value: [25, 30],
    numKeys: 1,
    dimensionsSeparated: false,
    setValue(value) {
      writes.push({ method: 'setValue', value });
      throw new Error('Cannot call setValue() on a property with keyframes.');
    },
    setValueAtTime(time, value) {
      writes.push({ method: 'setValueAtTime', time, value });
      this.value = value;
    },
  };
  const layer = makeLayer(positionProperty);
  comp.time = 2.5;
  comp.width = 100;
  comp.height = 100;
  comp.selectedLayers = [layer];
  context.app.project.activeItem = comp;

  const result = JSON.parse(context.$.global.tlAlign('left'));

  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(writes)), [
    { method: 'setValueAtTime', time: 2.5, value: [0, 30] },
  ]);
});
