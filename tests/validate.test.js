const test = require('node:test');
const assert = require('node:assert/strict');
const DCValidate = require('../panel/js/validate.js');

test('accepts a simple name and trims it', () => {
  const r = DCValidate.validateName('  Lower Third  ', 'Name');
  assert.equal(r.valid, true);
  assert.equal(r.name, 'Lower Third');
});

test('rejects empty and whitespace-only', () => {
  assert.equal(DCValidate.validateName('', 'Name').valid, false);
  assert.equal(DCValidate.validateName('   ', 'Name').valid, false);
  assert.equal(DCValidate.validateName(null, 'Name').valid, false);
});

test('rejects names over 200 chars', () => {
  const r = DCValidate.validateName('a'.repeat(201), 'Name');
  assert.equal(r.valid, false);
  assert.match(r.error, /too long/);
});

test('rejects every forbidden character', () => {
  for (const ch of ['<', '>', ':', '"', '/', '\\', '|', '?', '*']) {
    assert.equal(DCValidate.validateName('a' + ch + 'b', 'Name').valid, false, 'should reject ' + ch);
  }
});

test('regression: same invalid string fails on EVERY call (no /g lastIndex bug)', () => {
  assert.equal(DCValidate.validateName('bad:name', 'Name').valid, false);
  assert.equal(DCValidate.validateName('bad:name', 'Name').valid, false);
  assert.equal(DCValidate.validateName('bad:name', 'Name').valid, false);
});

test('rejects reserved Windows device names, case-insensitively', () => {
  for (const n of ['CON', 'con', 'PRN', 'aux', 'NUL', 'COM1', 'lpt9']) {
    assert.equal(DCValidate.validateName(n, 'Name').valid, false, 'should reject ' + n);
  }
});

test('error message includes the field name', () => {
  assert.match(DCValidate.validateName('', 'Category name').error, /^Category name/);
});
