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
