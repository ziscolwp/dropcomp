// bug-015: the anchor grid set only the LAYER anchor. A shape group rotates
// and scales around its OWN transform anchor, so the two drifted apart. Each
// top-level shape group's anchor now lands on the same visual point, with the
// group position compensated so nothing moves on screen.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const toolsSrc = fs.readFileSync(path.join(__dirname, '..', 'jsx', 'tools.jsx'), 'utf8');

function CompItem() {}
function CameraLayer() {}
function LightLayer() {}

function vecProp(initial) {
  let value = initial.slice(0);
  return {
    numKeys: 0,
    get value() { return Array.from(value); },
    setValue(next) { value = Array.from(next); },
  };
}

function makeShapeGroup(name, opts) {
  const o = opts || {};
  const anchor = vecProp(o.anchor || [0, 0]);
  const position = vecProp(o.position || [0, 0]);
  const scale = vecProp(o.scale || [100, 100]);
  return {
    matchName: 'ADBE Vector Group',
    name,
    _anchor: anchor,
    _position: position,
    property(n) {
      if (n === 'ADBE Vector Transform Group') {
        return {
          property(p) {
            if (p === 'ADBE Vector Anchor') return anchor;
            if (p === 'ADBE Vector Position') return position;
            if (p === 'ADBE Vector Scale') return scale;
            return null;
          },
        };
      }
      return null;
    },
  };
}

function makeShapeLayer(opts) {
  const o = opts || {};
  const anchor = vecProp(o.anchor || [0, 0]);
  const position = vecProp(o.position || [0, 0]);
  const scale = vecProp(o.scale || [100, 100]);
  const groups = o.groups || [];
  return {
    selected: true,
    parent: null,
    threeDLayer: false,
    containingComp: null,
    _anchor: anchor,
    _position: position,
    sourceRectAtTime() { return { left: o.rect.left, top: o.rect.top, width: o.rect.width, height: o.rect.height }; },
    property(n) {
      if (n === 'ADBE Transform Group') {
        return {
          property(p) {
            if (p === 'ADBE Anchor Point') return anchor;
            if (p === 'ADBE Position') return Object.assign(position, { dimensionsSeparated: false });
            if (p === 'ADBE Scale') return scale;
            return null;
          },
        };
      }
      if (n === 'ADBE Root Vectors Group') {
        return {
          numProperties: groups.length,
          property(i) { return groups[i - 1]; },
        };
      }
      return null;
    },
  };
}

function makeComp(layers) {
  const comp = new CompItem();
  comp.time = 0;
  comp.selectedLayers = layers;
  comp.numLayers = layers.length;
  comp.layer = (i) => layers[i - 1];
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
    jsonEscape(v) { return String(v); },
  };
  context.$.global = context;
  vm.runInNewContext(toolsSrc, context, { filename: 'tools.jsx' });
  return context;
}

test('anchoring a shape layer aligns the shape group anchor to the same point', () => {
  // rect group drawn offset inside the layer: content 0..100 in layer space,
  // group transform at position [30,40] with anchor [0,0]
  const group = makeShapeGroup('Rectangle 1', { anchor: [0, 0], position: [30, 40] });
  const layer = makeShapeLayer({
    anchor: [0, 0], position: [500, 500],
    rect: { left: 0, top: 0, width: 100, height: 100 },
    groups: [group],
  });
  const comp = makeComp([layer]);
  const host = loadTools(comp);

  const r = JSON.parse(host.tlSetAnchor('0.5', '0.5'));

  assert.equal(r.ok, true);
  assert.deepEqual(layer._anchor.value, [50, 50], 'layer anchor lands at the visual center');
  // group content point rendering at layer [50,50] is [20,10]; anchor moves
  // there and position follows so the shape does not shift
  assert.deepEqual(group._anchor.value, [20, 10]);
  assert.deepEqual(group._position.value, [50, 50], 'group pivot now coincides with the layer anchor');
});

test('scaled shape groups compensate in scaled units', () => {
  const group = makeShapeGroup('Rectangle 1', { anchor: [0, 0], position: [0, 0], scale: [200, 200] });
  const layer = makeShapeLayer({
    anchor: [0, 0], position: [500, 500],
    rect: { left: 0, top: 0, width: 200, height: 200 },
    groups: [group],
  });
  const comp = makeComp([layer]);
  const host = loadTools(comp);

  JSON.parse(host.tlSetAnchor('0.5', '0.5'));

  // layer anchor -> [100,100]; content point = (100-0)/2 = [50,50]
  assert.deepEqual(group._anchor.value, [50, 50]);
  assert.deepEqual(group._position.value, [100, 100]);
});

test('every top-level group is aligned, and non-shape layers are untouched', () => {
  const g1 = makeShapeGroup('A', { anchor: [0, 0], position: [0, 0] });
  const g2 = makeShapeGroup('B', { anchor: [5, 5], position: [60, 60] });
  const layer = makeShapeLayer({
    anchor: [0, 0], position: [0, 0],
    rect: { left: 0, top: 0, width: 100, height: 100 },
    groups: [g1, g2],
  });
  const comp = makeComp([layer]);
  const host = loadTools(comp);

  const r = JSON.parse(host.tlSetAnchor('0', '0'));
  assert.equal(r.ok, true);
  // fx=fy=0 -> layer anchor [0,0]: g1 unchanged (already there), g2 shifts
  assert.deepEqual(g1._anchor.value, [0, 0]);
  assert.deepEqual(g2._anchor.value, [-55, -55]);
  assert.deepEqual(g2._position.value, [0, 0]);
});
