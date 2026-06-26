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
  assert.ok(
    manifest.includes(`<Extension Id="com.DropComp.ext" Version="${pkg.version}"`),
    'manifest Extension element Version out of sync with package.json'
  );
});

test('check fetches once, caches the result, and throttles failures too', () => {
  const store = {};
  const storage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  const now = 1000000000000;
  let constructed = 0;
  try {
    global.XMLHttpRequest = function () {
      constructed++;
      this.open = () => {};
      this.send = function () {
        this.readyState = 4;
        this.status = 200;
        this.responseText = JSON.stringify({ tag_name: 'v9.9.9' });
        this.onreadystatechange();
      };
    };
    let got;
    DCUpdate.check(storage, now, (l) => { got = l; });
    assert.equal(got, 'v9.9.9');
    assert.equal(constructed, 1);
    DCUpdate.check(storage, now + 1000, (l) => { got = l; });
    assert.equal(constructed, 1, 'second check inside the window must not hit the network');
    assert.equal(got, 'v9.9.9');

    delete store[DCUpdate.CHECK_KEY];
    global.XMLHttpRequest = function () {
      constructed++;
      this.open = () => {};
      this.send = function () {
        this.readyState = 4;
        this.status = 500;
        this.responseText = 'oops';
        this.onreadystatechange();
      };
    };
    DCUpdate.check(storage, now, (l) => { got = l; });
    assert.equal(got, null);
    assert.equal(constructed, 2);
    DCUpdate.check(storage, now + 1000, (l) => { got = l; });
    assert.equal(constructed, 2, 'a failed check must also be throttled');
    assert.equal(got, null);
  } finally {
    delete global.XMLHttpRequest;
  }
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

test('check refreshes a non-newer cached result after the short no-update window', () => {
  const store = {};
  const storage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  const now = 1000000000000;
  let constructed = 0;
  storage.setItem(DCUpdate.CHECK_KEY, JSON.stringify({ ts: now, latest: DCUpdate.VERSION }));
  global.XMLHttpRequest = function () {
    constructed++;
    this.open = () => {};
    this.send = function () {
      this.readyState = 4;
      this.status = 200;
      this.responseText = JSON.stringify({ tag_name: 'v9.9.9' });
      this.onreadystatechange();
    };
  };
  try {
    let got = 'unset';
    DCUpdate.check(storage, now + (15 * 60 * 1000) - 1, (latest) => { got = latest; });
    assert.equal(constructed, 0, 'same/current version cache should still throttle inside 15 minutes');
    assert.equal(got, null);

    DCUpdate.check(storage, now + (15 * 60 * 1000), (latest) => { got = latest; });
    assert.equal(constructed, 1, 'same/current version cache must refresh after 15 minutes');
    assert.equal(got, 'v9.9.9');
  } finally {
    delete global.XMLHttpRequest;
  }
});

test('check keeps a cached newer release for the long update-available window', () => {
  const store = {};
  const storage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  const now = 1000000000000;
  storage.setItem(DCUpdate.CHECK_KEY, JSON.stringify({ ts: now, latest: 'v9.9.9' }));
  global.XMLHttpRequest = function () {
    throw new Error('network should not be reached for a cached newer release');
  };
  try {
    let got = 'unset';
    DCUpdate.check(storage, now + (60 * 60 * 1000), (latest) => { got = latest; });
    assert.equal(got, 'v9.9.9');
  } finally {
    delete global.XMLHttpRequest;
  }
});

test('check can bypass the cache for a manual refresh', () => {
  const store = {};
  const storage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  const now = 1000000000000;
  let constructed = 0;
  storage.setItem(DCUpdate.CHECK_KEY, JSON.stringify({ ts: now, latest: DCUpdate.VERSION }));
  global.XMLHttpRequest = function () {
    constructed++;
    this.open = () => {};
    this.send = function () {
      this.readyState = 4;
      this.status = 200;
      this.responseText = JSON.stringify({ tag_name: 'v9.9.9' });
      this.onreadystatechange();
    };
  };
  try {
    let got = 'unset';
    DCUpdate.check(storage, now + 1000, (latest) => { got = latest; }, { force: true });
    assert.equal(constructed, 1);
    assert.equal(got, 'v9.9.9');
  } finally {
    delete global.XMLHttpRequest;
  }
});
