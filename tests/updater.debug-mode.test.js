// feat-014 (ZXP install path): a ZXP-installed panel loads on signature alone,
// but the first self-update rewrites files and invalidates that signature.
// ensureDebugMode re-asserts PlayerDebugMode at boot so the panel keeps
// loading regardless of install method.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DCUpdaterFS = require('../panel/js/updater-fs.js');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

function spyCp(failFor) {
  const calls = [];
  return {
    calls,
    execFileSync(cmd, args) {
      calls.push([cmd].concat(args));
      if (failFor && failFor.test([cmd].concat(args).join(' '))) throw new Error('denied');
    },
  };
}

test('ensureDebugMode writes PlayerDebugMode for CSXS 8-12 on macOS', () => {
  const cp = spyCp();
  const ok = DCUpdaterFS.ensureDebugMode('darwin', cp);
  assert.equal(ok, true);
  assert.equal(cp.calls.length, 5);
  assert.deepEqual(cp.calls[0], ['/usr/bin/defaults', 'write', 'com.adobe.CSXS.8', 'PlayerDebugMode', '1']);
  assert.deepEqual(cp.calls[4], ['/usr/bin/defaults', 'write', 'com.adobe.CSXS.12', 'PlayerDebugMode', '1']);
});

test('ensureDebugMode uses the HKCU registry on Windows (no elevation)', () => {
  const cp = spyCp();
  const ok = DCUpdaterFS.ensureDebugMode('win32', cp);
  assert.equal(ok, true);
  assert.equal(cp.calls.length, 5);
  assert.equal(cp.calls[0][0], 'reg.exe');
  assert.ok(cp.calls[0].join(' ').indexOf('HKCU\\SOFTWARE\\Adobe\\CSXS.8') !== -1);
  assert.ok(cp.calls[0].indexOf('/f') !== -1, 'writes without prompting');
});

test('ensureDebugMode tolerates individual version failures', () => {
  const cp = spyCp(/CSXS\.10/);
  const ok = DCUpdaterFS.ensureDebugMode('darwin', cp);
  assert.equal(ok, true, 'any successful write is enough');
  assert.equal(cp.calls.length, 5, 'still attempts every version');
});

test('onBoot re-asserts debug mode before reading update status', () => {
  const src = read('panel/js/updater.js');
  assert.match(src, /onBoot\(\)\s*\{[\s\S]{0,220}ensureDebugMode\(\)/, 'boot path calls ensureDebugMode');
});

test('build-zxp.sh self-signs the same payload the updater expects', () => {
  const sh = read('scripts/build-zxp.sh');
  assert.match(sh, /^#!\/bin\/bash/);
  assert.match(sh, /set -euo pipefail/);
  assert.match(sh, /ZXPSignCmd/, 'uses Adobe\'s signer');
  assert.match(sh, /-selfSignedCert/, 'creates a local self-signed cert once');
  assert.match(sh, /cp -R CSXS panel jsx/, 'ships the same tree as the zip');
  assert.match(sh, /_harness\.html/, 'dev harness never ships');
  assert.match(sh, /DropComp-\$V\.zxp/, 'versioned artifact');
});
