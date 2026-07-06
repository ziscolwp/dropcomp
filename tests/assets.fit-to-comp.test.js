const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const jsxSrc = fs.readFileSync(path.join(__dirname, '..', 'jsx', 'assets.jsx'), 'utf8');

function extractFn(name) {
  const start = jsxSrc.indexOf(`function ${name}`);
  assert.ok(start !== -1, `${name} not found in assets.jsx`);
  const src = jsxSrc.slice(start, jsxSrc.indexOf('\n}', start) + 2);
  const ctx = {};
  vm.createContext(ctx);
  return vm.runInContext(`(${src})`, ctx);
}

function fakeLayer() {
  const layer = { scaleValue: null };
  layer.property = (group) => {
    assert.equal(group, 'ADBE Transform Group');
    return {
      property: (prop) => {
        assert.equal(prop, 'ADBE Scale');
        return { setValue: (v) => { layer.scaleValue = v; } };
      },
    };
  };
  return layer;
}

test('importAsset fits the new layer to the comp', () => {
  const body = jsxSrc.slice(
    jsxSrc.indexOf('function importAsset'),
    jsxSrc.indexOf('// ---- exports')
  );
  assert.match(body, /fitLayerToComp\(newLayer,\s*footage,\s*activeComp\)/,
    'importAsset does not call fitLayerToComp on the new layer');
});

test('fitLayerToComp scales oversized footage down proportionally', () => {
  const fit = extractFn('fitLayerToComp');
  const layer = fakeLayer();
  fit(layer, { width: 3840, height: 2160 }, { width: 1920, height: 1080 });
  assert.deepEqual([...layer.scaleValue], [50, 50]);
});

test('fitLayerToComp uses the tighter axis for non-matching aspect ratios', () => {
  const fit = extractFn('fitLayerToComp');
  const layer = fakeLayer();
  // 4000x1000 into 1920x1080: width is the constraint -> 48%
  fit(layer, { width: 4000, height: 1000 }, { width: 1920, height: 1080 });
  assert.deepEqual([...layer.scaleValue], [48, 48]);
});

test('fitLayerToComp never upscales assets that already fit', () => {
  const fit = extractFn('fitLayerToComp');
  const layer = fakeLayer();
  fit(layer, { width: 800, height: 600 }, { width: 1920, height: 1080 });
  assert.equal(layer.scaleValue, null, 'small asset must keep its 100% scale');
});

test('fitLayerToComp ignores footage without dimensions', () => {
  const fit = extractFn('fitLayerToComp');
  const layer = fakeLayer();
  fit(layer, { width: 0, height: 0 }, { width: 1920, height: 1080 });
  assert.equal(layer.scaleValue, null);
});

test('fitLayerToComp is exported to the global scope', () => {
  assert.match(jsxSrc, /\$\.global\.fitLayerToComp = fitLayerToComp;/);
});
