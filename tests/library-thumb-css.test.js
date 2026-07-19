const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const css = fs.readFileSync(path.join(__dirname, '..', 'panel', 'css', 'style.css'), 'utf8');

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(escaped + '\\s*\\{([^}]*)\\}', 'm').exec(css);
  return match ? match[1] : '';
}

test('grid card thumbs show the whole comp graphic', () => {
  const body = ruleBody('.card-thumb img');

  assert.notEqual(body, '', 'expected a .card-thumb img rule');
  assert.match(body, /object-fit\s*:\s*contain/i);
  assert.doesNotMatch(body, /object-fit\s*:\s*cover/i);
});

test('list view row thumbs show the whole comp graphic', () => {
  const body = ruleBody('#library.view-list .card--row .card-thumb img');

  assert.notEqual(body, '', 'expected a list-view thumb rule');
  assert.match(body, /object-fit\s*:\s*contain/i);
  assert.doesNotMatch(body, /object-fit\s*:\s*cover/i);
});

test('asset card thumbs keep their padded contain treatment', () => {
  const body = ruleBody('.card--asset .card-thumb img');

  assert.notEqual(body, '', 'expected an asset thumb rule');
  assert.match(body, /object-fit\s*:\s*contain/i);
  assert.match(body, /padding\s*:\s*10px/i);
});
