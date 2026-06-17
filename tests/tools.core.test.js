const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../panel/js/tools-core.js');

test('anchorFraction maps the 3x3 grid row-major (0=top-left, 8=bottom-right)', () => {
  assert.deepEqual(C.anchorFraction(0), [0, 0]);
  assert.deepEqual(C.anchorFraction(1), [0.5, 0]);
  assert.deepEqual(C.anchorFraction(2), [1, 0]);
  assert.deepEqual(C.anchorFraction(3), [0, 0.5]);
  assert.deepEqual(C.anchorFraction(4), [0.5, 0.5]);
  assert.deepEqual(C.anchorFraction(8), [1, 1]);
});

test('anchorFraction falls back to center on bad input', () => {
  assert.deepEqual(C.anchorFraction(-1), [0.5, 0.5]);
  assert.deepEqual(C.anchorFraction(99), [0.5, 0.5]);
  assert.deepEqual(C.anchorFraction('x'), [0.5, 0.5]);
});

test('clampInt parses, clamps to [min,max], and falls back on garbage', () => {
  assert.equal(C.clampInt('5', 1, 500, 1), 5);
  assert.equal(C.clampInt('abc', 1, 500, 1), 1);
  assert.equal(C.clampInt('0', 1, 500, 1), 1);
  assert.equal(C.clampInt('999', 1, 500, 1), 500);
  assert.equal(C.clampInt('-3', -100, 100, 5), -3);
  assert.equal(C.clampInt('2.9', 1, 500, 1), 2);
});
