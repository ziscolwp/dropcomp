const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const toolsSrc = fs.readFileSync(path.join(__dirname, '..', 'jsx', 'tools.jsx'), 'utf8');

function CompItem() {}
function CameraLayer() {}
function LightLayer() {}

function makeLayer(name, anchor) {
  var anchorValue = anchor ? anchor.slice(0) : [0, 0, 0];
  return {
    name,
    selected: false,
    parent: null,
    startTime: 0,
    property(groupName) {
      assert.equal(groupName, 'ADBE Transform Group');
      return {
        property(propName) {
          if (propName === 'ADBE Anchor Point') {
            return {
              get value() { return anchorValue.slice(0); },
              setValue(next) { anchorValue = next.slice(0); },
            };
          }
          throw new Error(`unexpected transform property ${propName}`);
        },
      };
    },
  };
}

function makeComp() {
  const comp = new CompItem();
  comp.width = 1920;
  comp.height = 1080;
  comp.pixelAspect = 1;
  comp.time = 3;
  comp._layers = [];
  comp.layer = function layer(index) {
    return this._layers[index - 1];
  };
  Object.defineProperty(comp, 'numLayers', {
    get() { return this._layers.length; },
  });
  Object.defineProperty(comp, 'selectedLayers', {
    get() { return this._layers.filter((layer) => layer.selected); },
  });
  comp.layers = {
    addNull() {
      const layer = makeLayer('Null 1', [0, 0, 0]);
      comp._layers.push(layer);
      return layer;
    },
    addSolid() {
      const layer = makeLayer('Solid 1', [0, 0, 0]);
      comp._layers.push(layer);
      return layer;
    },
    addCamera(name) {
      const layer = makeLayer(name, [0, 0, 0]);
      comp._layers.push(layer);
      return layer;
    },
  };
  return comp;
}

function loadTools(comp) {
  const context = {
    $: {},
    app: {
      project: { activeItem: comp },
      beginUndoGroup() {},
      endUndoGroup() {},
    },
    CompItem,
    CameraLayer,
    LightLayer,
    jerr(message) {
      return JSON.stringify({ ok: false, error: message });
    },
    jsonEscape(value) {
      return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    },
  };
  context.$.global = context;
  vm.runInNewContext(toolsSrc, context, { filename: 'tools.jsx' });
  return context;
}

test('creating a null parents the prior selected layers to the centered null', () => {
  const comp = makeComp();
  const first = makeLayer('Shape 1', [5, 6, 0]);
  const second = makeLayer('Text 1', [7, 8, 0]);
  first.selected = true;
  second.selected = true;
  comp._layers.push(first, second);

  const host = loadTools(comp);
  const result = JSON.parse(host.tlCreateLayer('null'));
  const nullLayer = comp._layers[2];

  assert.equal(result.ok, true);
  assert.equal(first.parent, nullLayer);
  assert.equal(second.parent, nullLayer);
  assert.deepEqual(
    Array.prototype.slice.call(nullLayer.property('ADBE Transform Group').property('ADBE Anchor Point').value),
    [50, 50, 0],
  );
  assert.equal(first.selected, false);
  assert.equal(second.selected, false);
  assert.equal(nullLayer.selected, true);
});
