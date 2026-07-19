const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const css = fs.readFileSync(path.join(__dirname, '..', 'panel', 'css', 'style.css'), 'utf8');

test('virtual section badge is styled', () => {
  assert.match(css, /\.section-badge svg/);
});

test('section delete header button gets the danger hover', () => {
  assert.match(css, /\.category-delete:hover/);
});

test('empty section hint is styled', () => {
  assert.match(css, /\.section-empty/);
});

test('in-section card action reads as active', () => {
  assert.match(css, /\.card-action\.in-section/);
});
