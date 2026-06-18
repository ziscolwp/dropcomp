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

function mockFs(over) {
  const calls = [];
  const base = {
    fetchLatestRelease: async () => ({ tag_name: 'v2.5.0', assets: [{ name: 'DropComp-2.5.0.zip', size: 100, digest: 'sha256:' + 'a'.repeat(64), browser_download_url: 'https://github.com/ziscolwp/dropcomp/releases/download/v2.5.0/DropComp-2.5.0.zip' }] }),
    download: async () => { calls.push('download'); return '/tmp/d.zip'; },
    fileSize: async () => 100,
    sha256File: async () => 'a'.repeat(64),
    extract: async () => { calls.push('extract'); return '/tmp/staged'; },
    assertStagedTree: () => { calls.push('assert'); },
    backup: async () => { calls.push('backup'); },
    applyMacSwap: async () => { calls.push('applyMacSwap'); },
    spawnWindowsHelper: async () => { calls.push('spawnWindowsHelper'); },
    writeStatus: async () => {}
  };
  return { fs: Object.assign(base, over || {}), calls };
}
const baseCtx = (m, plat) => ({ fs: m.fs, paths: { tmpZip: '/tmp/d.zip', stagingDir: '/tmp/staging', liveDir: '/live', backupZip: '/b.zip', statusFile: '/s.json' }, platform: plat, localVersion: '2.4.0' });

test('runUpdate (mac) runs steps in order and applies the swap', async () => {
  const m = mockFs();
  const r = await DCUpdater.runUpdate(baseCtx(m, 'darwin'));
  assert.deepEqual(m.calls, ['download', 'extract', 'assert', 'backup', 'applyMacSwap']);
  assert.deepEqual(r, { mode: 'mac-applied', version: '2.5.0' });
});

test('runUpdate (win) stages and spawns the helper instead of swapping', async () => {
  const m = mockFs();
  const r = await DCUpdater.runUpdate(baseCtx(m, 'win32'));
  assert.ok(m.calls.includes('spawnWindowsHelper'));
  assert.ok(!m.calls.includes('applyMacSwap'));
  assert.equal(r.mode, 'win-pending');
});

test('runUpdate aborts before backup when verification fails', async () => {
  const m = mockFs({ sha256File: async () => 'b'.repeat(64) }); // mismatch
  await assert.rejects(DCUpdater.runUpdate(baseCtx(m, 'darwin')), /security check/);
  assert.ok(!m.calls.includes('backup'), 'must not back up a bad download');
  assert.ok(!m.calls.includes('applyMacSwap'), 'must not apply a bad download');
});

test('runUpdate refuses a release whose asset URL is not GitHub', async () => {
  const m = mockFs({ fetchLatestRelease: async () => ({ tag_name: 'v2.5.0', assets: [{ name: 'x.zip', size: 1, browser_download_url: 'https://evil.com/x.zip' }] }) });
  await assert.rejects(DCUpdater.runUpdate(baseCtx(m, 'darwin')), /trusted GitHub/);
});

test('runUpdate stops when the latest is not newer', async () => {
  const m = mockFs({ fetchLatestRelease: async () => ({ tag_name: 'v2.4.0', assets: [] }) });
  await assert.rejects(DCUpdater.runUpdate(baseCtx(m, 'darwin')), /No newer/);
});
