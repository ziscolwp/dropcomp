const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const DCUpdate = require('../panel/js/update.js');

test('parseVersion handles v-prefix and plain semver, rejects garbage', () => {
  assert.deepEqual(DCUpdate.parseVersion('v2.1.0'), [2, 1, 0]);
  assert.deepEqual(DCUpdate.parseVersion('2.10.3'), [2, 10, 3]);
  assert.equal(DCUpdate.parseVersion('latest'), null);
  assert.equal(DCUpdate.parseVersion(''), null);
  assert.equal(DCUpdate.parseVersion(undefined), null);
});

test('isNewer compares major/minor/patch numerically', () => {
  assert.equal(DCUpdate.isNewer('v2.2.0', '2.1.1'), true);
  assert.equal(DCUpdate.isNewer('v2.1.2', '2.1.1'), true);
  assert.equal(DCUpdate.isNewer('v3.0.0', '2.9.9'), true);
  assert.equal(DCUpdate.isNewer('v2.1.1', '2.1.1'), false);
  assert.equal(DCUpdate.isNewer('v2.1.0', '2.1.1'), false);
  assert.equal(DCUpdate.isNewer('v2.10.0', '2.9.0'), true); // numeric, not lexicographic
  assert.equal(DCUpdate.isNewer('garbage', '2.1.1'), false);
  assert.equal(DCUpdate.isNewer('v2.2.0', 'garbage'), false);
});

test('VERSION constant matches package.json and the CSXS manifest', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(DCUpdate.VERSION, pkg.version, 'update.js VERSION out of sync with package.json');
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'CSXS', 'manifest.xml'), 'utf8');
  assert.ok(
    manifest.includes(`ExtensionBundleVersion="${pkg.version}"`),
    'manifest ExtensionBundleVersion out of sync with package.json'
  );
});

test('check uses the cached result inside the throttle window (no network)', () => {
  // no XMLHttpRequest exists in node - reaching the network path would throw,
  // so this also proves the throttle short-circuits before any request
  const store = {};
  const storage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  const now = 1000000000000;
  storage.setItem(DCUpdate.CHECK_KEY, JSON.stringify({ ts: now - 1000, latest: 'v9.9.9' }));
  let got = 'unset';
  DCUpdate.check(storage, now, (latest) => { got = latest; });
  assert.equal(got, 'v9.9.9');

  storage.setItem(DCUpdate.CHECK_KEY, JSON.stringify({ ts: now - 1000, latest: 'v0.0.1' }));
  DCUpdate.check(storage, now, (latest) => { got = latest; });
  assert.equal(got, null, 'older cached release must not signal an update');
});
