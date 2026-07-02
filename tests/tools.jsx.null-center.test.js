// bug-013: a new Null (and its anchor) must sit at the visual center of the
// selected layers' combined bounds, so parenting pivots around that center.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const toolsSrc = fs.readFileSync(path.join(__dirname, '..', 'jsx', 'tools.jsx'), 'utf8');

function CompItem() {}
function CameraLayer() {}
function LightLayer() {}

// Layer stub with a full-enough transform for tlLayerBounds/tlWritePos:
// Position + Anchor + Scale, an unrotated sourceRect, and no parent chain.
function makeBoundedLayer(name, opts) {
  const o = opts || {};
  let position = (o.position || [0, 0]).slice(0);
  let anchor = (o.anchor || [0, 0]).slice(0);
  const scale = (o.scale || [100, 100]).slice(0);
  const rect = o.rect || null;
  const layer = {
    name,
    selected: !!o.selected,
    parent: null,
    threeDLayer: false,
    startTime: 0,
    containingComp: null,
    property(groupName) {
      if (groupName !== 'ADBE Transform Group') throw new Error('unexpected group ' + groupName);
      return {
        property(propName) {
          if (propName === 'ADBE Position') {
            return {
              dimensionsSeparated: false,
              numKeys: 0,
              get value() { return position.slice(0); },
              setValue(next) { position = next.slice(0); },
            };
          }
          if (propName === 'ADBE Anchor Point') {
            return {
              get value() { return anchor.slice(0); },
              setValue(next) { anchor = next.slice(0); },
            };
          }
          if (propName === 'ADBE Scale') {
            return { get value() { return scale.slice(0); } };
          }
          throw new Error('unexpected transform property ' + propName);
        },
      };
    },
    // rebuild as host-realm arrays: setValue receives vm-realm arrays, whose
    // prototype would fail deepStrictEqual against literals in this file
    getPosition() { return Array.from(position); },
    getAnchor() { return Array.from(anchor); },
  };
  if (rect) layer.sourceRectAtTime = () => ({ ...rect });
  return layer;
}

function makeComp() {
  const comp = new CompItem();
  comp.width = 1920;
  comp.height = 1080;
  comp.pixelAspect = 1;
  comp.time = 0;
  comp._layers = [];
  comp.layer = function (index) { return this._layers[index - 1]; };
  Object.defineProperty(comp, 'numLayers', { get() { return this._layers.length; } });
  Object.defineProperty(comp, 'selectedLayers', {
    get() { return this._layers.filter((l) => l.selected); },
  });
  comp.layers = {
    addNull() {
      const layer = makeBoundedLayer('Null 1', { position: [960, 540] });
      comp._layers.push(layer);
      return layer;
    },
  };
  return comp;
}

function loadTools(comp) {
  const context = {
    $: {},
    app: { project: { activeItem: comp }, beginUndoGroup() {}, endUndoGroup() {} },
    CompItem,
    CameraLayer,
    LightLayer,
    jerr(m) { return JSON.stringify({ ok: false, error: m }); },
    jsonEscape(v) { return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); },
  };
  context.$.global = context;
  vm.runInNewContext(toolsSrc, context, { filename: 'tools.jsx' });
  return context;
}

const square = { left: 0, top: 0, width: 100, height: 100 };

test('a null created over one selected layer is centered on that layer', () => {
  const comp = makeComp();
  const layer = makeBoundedLayer('Shape 1', { position: [200, 300], anchor: [50, 50], rect: square, selected: true });
  comp._layers.push(layer);
  const host = loadTools(comp);

  const result = JSON.parse(host.tlCreateLayer('null'));
  const nullLayer = comp._layers[1];

  assert.equal(result.ok, true);
  assert.deepEqual(nullLayer.getPosition(), [200, 300], 'null sits at the layer center');
  assert.deepEqual(nullLayer.getAnchor(), [50, 50], 'null anchor stays centered on its own box');
  assert.equal(layer.parent, nullLayer);
});

test('a null created over several selected layers is centered on their combined bounds', () => {
  const comp = makeComp();
  const a = makeBoundedLayer('Shape 1', { position: [200, 300], anchor: [50, 50], rect: square, selected: true });
  const b = makeBoundedLayer('Shape 2', { position: [600, 500], anchor: [50, 50], rect: square, selected: true });
  comp._layers.push(a, b);
  const host = loadTools(comp);

  JSON.parse(host.tlCreateLayer('null'));
  const nullLayer = comp._layers[2];

  // combined bounds: x 150..650, y 250..550 -> center [400, 400]
  assert.deepEqual(nullLayer.getPosition(), [400, 400]);
  assert.equal(a.parent, nullLayer);
  assert.equal(b.parent, nullLayer);
});

test('scaled layers center on their scaled bounds', () => {
  const comp = makeComp();
  const layer = makeBoundedLayer('Shape 1', {
    position: [400, 400], anchor: [0, 0], scale: [200, 200], rect: square, selected: true,
  });
  comp._layers.push(layer);
  const host = loadTools(comp);

  JSON.parse(host.tlCreateLayer('null'));
  const nullLayer = comp._layers[1];

  // bounds: left 400, top 400, size 200x200 -> center [500, 500]
  assert.deepEqual(nullLayer.getPosition(), [500, 500]);
});

test('with no selection the null keeps its default comp-center position', () => {
  const comp = makeComp();
  const host = loadTools(comp);

  JSON.parse(host.tlCreateLayer('null'));
  const nullLayer = comp._layers[0];

  assert.deepEqual(nullLayer.getPosition(), [960, 540]);
});

test('selection without measurable bounds keeps the default null position', () => {
  const comp = makeComp();
  // no sourceRectAtTime -> tlLayerBounds returns null for this layer
  const audioish = makeBoundedLayer('Audio 1', { position: [111, 222], selected: true });
  comp._layers.push(audioish);
  const host = loadTools(comp);

  JSON.parse(host.tlCreateLayer('null'));
  const nullLayer = comp._layers[1];

  assert.deepEqual(nullLayer.getPosition(), [960, 540], 'no bounds -> leave the null where AE put it');
  assert.equal(audioish.parent, nullLayer, 'parenting still applies');
});
