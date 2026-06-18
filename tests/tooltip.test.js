const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../panel/js/tooltip.js');

test('clampPosition places below by default, centered on the anchor', () => {
  const r = T.clampPosition(
    { left: 100, top: 100, bottom: 120, width: 40, height: 20 },
    { w: 80, h: 30 }, { w: 400, h: 600 }, 6
  );
  assert.equal(r.placement, 'below');
  assert.equal(r.y, 126); // bottom + margin
  assert.equal(r.x, 80);  // 100 + 40/2 - 80/2
});

test('clampPosition flips above when there is no room below', () => {
  const r = T.clampPosition(
    { left: 10, top: 560, bottom: 590, width: 40, height: 20 },
    { w: 80, h: 40 }, { w: 400, h: 600 }, 6
  );
  assert.equal(r.placement, 'above');
  assert.equal(r.y, 514); // 560 - 40 - 6
});

test('clampPosition clamps x within the viewport margins', () => {
  const left = T.clampPosition({ left: 0, top: 50, bottom: 70, width: 10, height: 20 }, { w: 80, h: 30 }, { w: 400, h: 600 }, 6);
  assert.equal(left.x, 6);
  const right = T.clampPosition({ left: 395, top: 50, bottom: 70, width: 10, height: 20 }, { w: 80, h: 30 }, { w: 400, h: 600 }, 6);
  assert.equal(right.x, 314); // 400 - 80 - 6
});

test('buildScriptTip: file entry shows description, path, run count', () => {
  const t = T.buildScriptTip({ name: 'My Tool', description: 'does X', source: 'file', path: '/a/b.jsx' }, { runCount: 2 });
  assert.equal(t.title, 'My Tool');
  assert.match(t.body, /does X/);
  assert.match(t.body, /File: \/a\/b\.jsx/);
  assert.match(t.body, /Run 2 times/);
});

test('buildScriptTip: snippet entry previews up to 5 body lines', () => {
  const body = ['1','2','3','4','5','6','7'].join('\n');
  const t = T.buildScriptTip({ name: 'Snip', source: 'snippet', body }, { runCount: 1 });
  assert.match(t.body, /Snippet/);
  assert.match(t.body, /1\n2\n3\n4\n5\n…/);
  assert.match(t.body, /Run 1 time$/);
});
