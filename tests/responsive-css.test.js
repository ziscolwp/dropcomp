// Field report: shrinking a docked panel grew a horizontal scrollbar in the
// tools view and the header title crowded out the content. These pin the
// reflow rules and the density classes that keep every section inside the
// panel's real width.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const css = read('panel/css/style.css');

function blockFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(escaped + '\\s*\\{([^}]*)\\}'));
  assert.ok(match, selector + ' rule missing');
  return match[1];
}

test('scrolling sections never grow a horizontal scrollbar', () => {
  for (const id of ['#tools', '#library', '#scripts']) {
    assert.match(blockFor(id), /overflow-x:\s*hidden/, id + ' blocks horizontal overflow');
  }
});

test('tool rows wrap instead of overflowing', () => {
  assert.match(blockFor('.tool-row'), /flex-wrap:\s*wrap/, 'anchor/create row wraps');
  // the create grid needs a floor so wrap actually triggers before crushing
  assert.match(css, /\.tool-row\s*>\s*\.tool-grow\s*\{[^}]*min-width:\s*\d+px/,
    'create column has a wrap floor');
  assert.match(blockFor('.tool-icons'), /flex-wrap:\s*wrap/, 'align strip wraps');
});

test('tool button labels shrink before forcing overflow', () => {
  assert.match(blockFor('.tool-btn'), /min-width:\s*0/, 'buttons can shrink');
  assert.match(css, /\.tool-btn span\s*\{[^}]*text-overflow:\s*ellipsis/, 'labels ellipsize');
});

test('library grid never demands more than the panel width', () => {
  assert.match(css, /\.grid\s*\{[^}]*minmax\(min\(var\(--thumb-min\),\s*100%\),\s*1fr\)/,
    'thumb floor caps at container width');
});

test('scripts bar wraps on narrow panels', () => {
  assert.match(blockFor('#scripts-bar'), /flex-wrap:\s*wrap/);
});

test('narrow density drops the header title, tight goes icon-only', () => {
  assert.match(css, /body\.dc-narrow \.app-name\s*\{\s*display:\s*none/, 'title hidden when narrow');
  assert.match(css, /body\.dc-tight \.tool-btn span\s*\{\s*display:\s*none/, 'tool labels hidden when tight');
  assert.match(css, /body\.dc-narrow #app-header\s*\{[^}]*padding/, 'header padding tightens');
});

// Field report round 2: tight panels still scrolled forever - the anchor grid
// kept full-size cells, create tiles stretched, and double paddings + the hint
// line wasted a screen of vertical space. Pin the Motion-Tools-density pack.
test('tight panels compress the tools stack', () => {
  assert.match(css, /body\.dc-tight \.anchor-grid\s*\{[^}]*repeat\(3,\s*24px\)/,
    'anchor cells shrink at tight');
  assert.match(css, /body\.dc-tight \.tool-grid-2\s*\{[^}]*repeat\(auto-fill,\s*44px\)/,
    'icon buttons become fixed square tiles');
  assert.match(css, /body\.dc-tight \.tool-row\s*>\s*\.tool-grow\s*\{[^}]*min-width:\s*94px/,
    'create grid sits beside the anchor when two tile columns fit');
  assert.match(css, /body\.dc-tight \.tool-icon\s*\{[^}]*flex:\s*0 0/,
    'align tiles stay fixed-size instead of stretching');
  assert.match(css, /body\.dc-tight \.tool-inset\s*\{[^}]*border:\s*none/,
    'nested inset frame flattens');
  assert.match(css, /body\.dc-tight \.tool-hint\s*\{\s*display:\s*none/,
    'hint line hidden (tooltips still explain)');
  assert.match(css, /body\.dc-tight #tools\s*\{[^}]*padding:\s*8px/,
    'section padding halves');
  assert.match(css, /body\.dc-tight \.tool-card\s*\{[^}]*padding:\s*8px/,
    'card padding halves');
});

test('density module is loaded and wired in both panel pages', () => {
  // _harness.html is gitignored (local dev file) - assert on it only when present
  const pages = ['panel/index.html'];
  if (fs.existsSync(path.join(__dirname, '..', 'panel', '_harness.html'))) pages.push('panel/_harness.html');
  for (const page of pages) {
    assert.match(read(page), /<script src="js\/density\.js"><\/script>/, page + ' loads density.js');
  }
  assert.match(read('panel/js/main.js'), /DCDensity\.init\(\)/, 'main.js starts the density watcher');
});
