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

test('small slider cards keep delete action reachable', () => {
  const body = ruleBody('#library.grid--s .card-actions');

  assert.notEqual(body, '', 'expected a grid--s card actions rule');
  assert.doesNotMatch(body, /display\s*:\s*none/i);
  assert.match(css, /#library\.grid--s\s+\.card-action\[data-action="delete"\]/);
});

test('compact grid cards keep delete action reachable', () => {
  const body = ruleBody('#library.view-compact .card-actions');

  assert.notEqual(body, '', 'expected a compact card actions rule');
  assert.doesNotMatch(body, /display\s*:\s*none/i);
  assert.match(css, /#library\.view-compact\s+\.card-action\[data-action="delete"\]/);
});
