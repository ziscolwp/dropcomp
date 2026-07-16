const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'panel', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'panel', 'css', 'style.css'), 'utf8');

test('index.html loads sync.js before shell.js', () => {
  const sync = html.indexOf('js/sync.js');
  const shell = html.indexOf('js/shell.js');
  assert.ok(sync !== -1, 'sync.js script tag missing');
  assert.ok(shell !== -1, 'shell.js script tag missing');
  assert.ok(sync < shell, 'sync.js must load before shell.js');
});

test('index.html gives the app-name span an id for per-mode titles', () => {
  assert.ok(html.includes('id="app-name"'), 'app-name span needs id="app-name"');
});

test('style.css hides the nav rail in every standalone mode', () => {
  for (const mode of ['library', 'assets', 'tools', 'scripts']) {
    assert.ok(css.includes(`body.mode-${mode} #rail`), `missing #rail rule for mode-${mode}`);
  }
});

// Standalone panels have no rail, so the header must keep its own Settings
// button (and brand glyph) in those modes - and only in those modes.
test('the header settings button and glyph are standalone-mode fallbacks', () => {
  assert.ok(html.includes('id="header-settings-btn"'), 'header fallback settings button missing');
  assert.ok(css.includes('#header-settings-btn { display: none; }'), 'header settings must hide in the full panel');
  for (const mode of ['library', 'assets', 'tools', 'scripts']) {
    assert.ok(css.includes(`body.mode-${mode} #header-settings-btn`), `missing header settings rule for mode-${mode}`);
    assert.ok(css.includes(`body.mode-${mode} #app-header .logo-glyph`), `missing header glyph rule for mode-${mode}`);
  }
});
