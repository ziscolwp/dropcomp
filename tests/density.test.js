const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const DCDensity = require(path.join(__dirname, '..', 'panel', 'js', 'density.js'));

test('wide panels get no density classes', () => {
  assert.deepEqual(DCDensity.classesFor(400), { narrow: false, tight: false });
});

test('narrow panels drop the title but keep labels', () => {
  assert.deepEqual(DCDensity.classesFor(340), { narrow: true, tight: false });
});

test('tight panels go icon-only', () => {
  assert.deepEqual(DCDensity.classesFor(280), { narrow: true, tight: true });
});

test('thresholds are exclusive at the boundary', () => {
  assert.deepEqual(DCDensity.classesFor(DCDensity.NARROW), { narrow: false, tight: false });
  assert.deepEqual(DCDensity.classesFor(DCDensity.NARROW - 1), { narrow: true, tight: false });
  assert.deepEqual(DCDensity.classesFor(DCDensity.TIGHT), { narrow: true, tight: false });
  assert.deepEqual(DCDensity.classesFor(DCDensity.TIGHT - 1), { narrow: true, tight: true });
});

test('tight always implies narrow', () => {
  for (let w = 0; w < 600; w += 20) {
    const c = DCDensity.classesFor(w);
    if (c.tight) assert.ok(c.narrow, `tight without narrow at ${w}px`);
  }
});
