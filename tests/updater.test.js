const test = require('node:test');
const assert = require('node:assert/strict');
const DCUpdater = require('../panel/js/updater.js');

test('parseDigest extracts the sha256 hex or null', () => {
  assert.equal(DCUpdater.parseDigest('sha256:' + 'a'.repeat(64)), 'a'.repeat(64));
  assert.equal(DCUpdater.parseDigest('SHA256:' + 'A'.repeat(64)), 'a'.repeat(64));
  assert.equal(DCUpdater.parseDigest('md5:abc'), null);
  assert.equal(DCUpdater.parseDigest(''), null);
  assert.equal(DCUpdater.parseDigest(undefined), null);
});

test('isAllowedUrl accepts GitHub https hosts, rejects everything else', () => {
  assert.equal(DCUpdater.isAllowedUrl('https://api.github.com/repos/ziscolwp/dropcomp/releases/latest'), true);
  assert.equal(DCUpdater.isAllowedUrl('https://github.com/ziscolwp/dropcomp/releases/download/v2.5.0/DropComp-2.5.0.zip'), true);
  assert.equal(DCUpdater.isAllowedUrl('https://objects.githubusercontent.com/x'), true);
  assert.equal(DCUpdater.isAllowedUrl('https://release-assets.githubusercontent.com/x'), true);
  assert.equal(DCUpdater.isAllowedUrl('http://github.com/x'), false, 'http rejected');
  assert.equal(DCUpdater.isAllowedUrl('https://evil.com/x'), false);
  assert.equal(DCUpdater.isAllowedUrl('https://github.com.evil.com/x'), false);
  assert.equal(DCUpdater.isAllowedUrl('not a url'), false);
});

test('pickZipAsset returns the first .zip asset or null', () => {
  assert.equal(DCUpdater.pickZipAsset({ assets: [{ name: 'notes.txt' }, { name: 'DropComp-2.5.0.zip', size: 9 }] }).size, 9);
  assert.equal(DCUpdater.pickZipAsset({ assets: [{ name: 'a.txt' }] }), null);
  assert.equal(DCUpdater.pickZipAsset({}), null);
});

test('verifyDecision: size mismatch fails, digest mismatch fails, missing digest passes on size', () => {
  assert.deepEqual(DCUpdater.verifyDecision({ expectedSize: 10, actualSize: 10, expectedSha256: 'ab', actualSha256: 'ab' }), { ok: true, reason: '' });
  assert.equal(DCUpdater.verifyDecision({ expectedSize: 10, actualSize: 9, expectedSha256: 'ab', actualSha256: 'ab' }).reason, 'size');
  assert.equal(DCUpdater.verifyDecision({ expectedSize: 10, actualSize: 10, expectedSha256: 'ab', actualSha256: 'cd' }).reason, 'checksum');
  assert.equal(DCUpdater.verifyDecision({ expectedSize: 10, actualSize: 10, expectedSha256: null, actualSha256: 'cd' }).ok, true);
  assert.equal(DCUpdater.verifyDecision({ expectedSize: 10, actualSize: 10, expectedSha256: 'ab', actualSha256: null }).reason, 'checksum');
});

test('hasNode reflects whether a require function was passed', () => {
  assert.equal(DCUpdater.hasNode(require), true);
  assert.equal(DCUpdater.hasNode(undefined), false);
  assert.equal(DCUpdater.hasNode('nope'), false);
});
