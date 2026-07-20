const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(
  path.join(__dirname, '..', 'panel', 'index.html'), 'utf8');
const mainSrc = fs.readFileSync(
  path.join(__dirname, '..', 'panel', 'js', 'main.js'), 'utf8');

test('settings modal offers a Left/Right rail position control', () => {
  assert.ok(html.includes('id="rail-side-row"'), 'rail side form row missing');
  assert.ok(html.includes('id="rail-side-switch"'), 'rail side segmented control missing');
  assert.ok(html.includes('data-side="left"'), 'left segment missing');
  assert.ok(html.includes('data-side="right"'), 'right segment missing');
});

test('main.js routes rail side clicks to the shell', () => {
  assert.match(mainSrc, /railSideSwitch:\s*\$\('rail-side-switch'\)/);
  assert.match(mainSrc, /DCShell\.onRailSideChange/);
});
