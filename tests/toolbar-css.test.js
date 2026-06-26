const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(
  path.join(__dirname, '..', 'panel', 'css', 'style.css'), 'utf8');

const flat = css.replace(/\s+/g, ' ');

test('hidden thumbnail slider still reserves toolbar space', () => {
  const m = flat.match(/#thumb-slider\.hidden\s*\{([^}]*)\}/);
  assert.ok(m, 'expected #thumb-slider.hidden to override the global hidden display');
  assert.match(m[1], /display:\s*inline-block\s*!important/);
  assert.match(m[1], /visibility:\s*hidden/);
  assert.match(m[1], /pointer-events:\s*none/);
});
