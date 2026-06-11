const test = require('node:test');
const assert = require('node:assert/strict');
const DCState = require('../panel/js/state.js');

test('safeName matches the hostscript algorithm', () => {
  assert.equal(DCState.safeName('My Comp!'), 'My_Comp_');
  assert.equal(DCState.safeName('a  b'), 'a_b');
  assert.equal(DCState.safeName('Clean123'), 'Clean123');
});

test('parseTimestamp extracts the trailing timestamp', () => {
  assert.equal(DCState.parseTimestamp('Logo_Anim_1718000000000'), 1718000000000);
  assert.equal(DCState.parseTimestamp('no_timestamp_here'), null);
  assert.equal(DCState.parseTimestamp('short_123'), null);
});

test('computeRenameTarget keeps the original timestamp', () => {
  assert.equal(
    DCState.computeRenameTarget('Old_1718000000000', 'Fresh Title'),
    'Fresh_Title_1718000000000'
  );
  assert.equal(DCState.computeRenameTarget('broken-id', 'X'), null);
});

test('formatMetaLine renders resolution, duration, fps', () => {
  assert.equal(
    DCState.formatMetaLine({ width: 1920, height: 1080, duration: 6.04, frameRate: 29.97 }),
    '1920×1080 · 6.0s · 30fps'
  );
});

test('formatMetaLine returns empty string when resolution unknown', () => {
  assert.equal(DCState.formatMetaLine({}), '');
  assert.equal(DCState.formatMetaLine({ width: 1920 }), '');
  assert.equal(DCState.formatMetaLine(null), '');
});

test('formatMetaLine omits missing duration/fps but keeps resolution', () => {
  assert.equal(DCState.formatMetaLine({ width: 1080, height: 1920 }), '1080×1920');
});

test('addedAt falls back to the uniqueId timestamp', () => {
  assert.equal(DCState.addedAt({ addedAt: 5, uniqueId: 'x_1718000000000' }), 5);
  assert.equal(DCState.addedAt({ uniqueId: 'x_1718000000000' }), 1718000000000);
  assert.equal(DCState.addedAt({ uniqueId: 'nope' }), 0);
});
