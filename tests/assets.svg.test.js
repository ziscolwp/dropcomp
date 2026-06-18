const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const jsxSrc = fs.readFileSync(path.join(__dirname, '..', 'jsx', 'assets.jsx'), 'utf8');
const panelSrc = fs.readFileSync(path.join(__dirname, '..', 'panel', 'js', 'assets.js'), 'utf8');

test('svg is in the host asset extension allowlist', () => {
  const m = /var DC_ASSET_EXTS = \{([^}]*)\}/.exec(jsxSrc);
  assert.ok(m, 'DC_ASSET_EXTS map not found');
  assert.match(m[1], /\bsvg\s*:\s*1\b/, 'svg missing from DC_ASSET_EXTS');
});

test('panel supported-formats copy mentions svg', () => {
  assert.match(panelSrc, /No supported image files selected[^']*svg/,
    'panel unsupported-files toast does not mention svg');
});

function importAssetBody() {
  return jsxSrc.slice(
    jsxSrc.indexOf('function importAsset'),
    jsxSrc.indexOf('// ---- exports')
  );
}

test('importAsset keeps svg layers crisp via continuous rasterization', () => {
  const body = importAssetBody();
  assert.match(body, /collapseTransformation\s*=\s*true/, 'continuous rasterization not set');
  // must be svg-scoped, not applied to every asset
  assert.match(body, /'svg'[\s\S]{0,120}collapseTransformation\s*=\s*true/,
    'collapseTransformation must be guarded by an svg check');
});

test('importAsset returns an svg-specific hint when import fails', () => {
  assert.match(importAssetBody(), /may not support SVG/,
    'no svg-specific error hint in the catch path');
});
