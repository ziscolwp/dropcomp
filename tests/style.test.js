const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'panel', 'css', 'style.css'), 'utf8');

function blockFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(escaped + '\\s*\\{([^}]*)\\}'));
  assert.ok(match, selector + ' rule missing');
  return match[1];
}

function pxDeclaration(block, property) {
  const match = block.match(new RegExp(property + '\\s*:\\s*([0-9.]+)px\\b'));
  assert.ok(match, property + ' declaration missing');
  return Number(match[1]);
}

test('settings version keeps clear spacing below the close button', () => {
  const block = blockFor('#settings-version');
  assert.ok(pxDeclaration(block, 'margin-top') >= 14);
});
