var DCUpdater = (function () {
  'use strict';

  // In the panel, update.js loaded first as a global; in node tests, require it.
  const DCUpdate = (typeof window !== 'undefined' && window.DCUpdate)
    ? window.DCUpdate
    : require('./update.js');

  const API_URL = 'https://api.github.com/repos/ziscolwp/dropcomp/releases/latest';
  const ALLOWED_HOSTS = { 'api.github.com': 1, 'github.com': 1, 'codeload.github.com': 1, 'objects.githubusercontent.com': 1 };

  function parseDigest(d) {
    if (!d || typeof d !== 'string') return null;
    const m = /^sha256:([0-9a-f]{64})$/i.exec(d.trim());
    return m ? m[1].toLowerCase() : null;
  }

  function isAllowedHost(host) {
    return !!ALLOWED_HOSTS[host] || /\.githubusercontent\.com$/.test(host || '');
  }

  function isAllowedUrl(u) {
    try {
      const url = new URL(u);
      return url.protocol === 'https:' && isAllowedHost(url.hostname);
    } catch (e) { return false; }
  }

  function pickZipAsset(release) {
    const assets = (release && release.assets) || [];
    for (let i = 0; i < assets.length; i++) {
      if (assets[i] && typeof assets[i].name === 'string' && /\.zip$/i.test(assets[i].name)) return assets[i];
    }
    return null;
  }

  function verifyDecision(o) {
    if (typeof o.expectedSize === 'number' && typeof o.actualSize === 'number' && o.actualSize !== o.expectedSize) {
      return { ok: false, reason: 'size' };
    }
    if (o.expectedSha256 && (!o.actualSha256 || o.expectedSha256.toLowerCase() !== o.actualSha256.toLowerCase())) {
      return { ok: false, reason: 'checksum' };
    }
    return { ok: true, reason: '' };
  }

  function hasNode(req) { return typeof req === 'function'; }

  function fail(message) { const e = new Error(message); e.userMessage = message; return e; }

  async function runUpdate(ctx) {
    const fs = ctx.fs;
    const progress = ctx.onProgress || function () {};
    progress('fetch');
    const release = ctx.release || await fs.fetchLatestRelease(ctx.apiUrl || API_URL, isAllowedUrl);
    const tag = release && release.tag_name;
    if (!tag || !DCUpdate.isNewer(tag, ctx.localVersion)) throw fail('No newer version is available.');
    const asset = pickZipAsset(release);
    if (!asset) throw fail('This release has no downloadable package.');
    if (!isAllowedUrl(asset.browser_download_url)) throw fail('The download link is not a trusted GitHub URL.');
    const version = String(tag).replace(/^v/, '');

    progress('download', 0);
    await fs.download(asset.browser_download_url, ctx.paths.tmpZip, function (p) { progress('download', p); }, isAllowedUrl);

    progress('verify');
    const decision = verifyDecision({
      expectedSize: asset.size, expectedSha256: parseDigest(asset.digest),
      actualSize: await fs.fileSize(ctx.paths.tmpZip), actualSha256: await fs.sha256File(ctx.paths.tmpZip)
    });
    if (!decision.ok) throw fail(decision.reason === 'size'
      ? 'The download was incomplete. Please try again.'
      : 'The download failed its security check and was discarded.');

    progress('extract');
    const stagedRoot = await fs.extract(ctx.paths.tmpZip, ctx.paths.stagingDir);
    fs.assertStagedTree(stagedRoot);

    progress('backup');
    await fs.backup(ctx.paths.liveDir, ctx.paths.backupZip);

    progress('apply');
    if (ctx.platform === 'win32') {
      await fs.spawnWindowsHelper(ctx.paths, stagedRoot, version);
      progress('staged');
      return { mode: 'win-pending', version: version };
    }
    await fs.applyMacSwap(ctx.paths.liveDir, stagedRoot);
    await fs.writeStatus(ctx.paths.statusFile, { state: 'ok', version: version });
    progress('done');
    return { mode: 'mac-applied', version: version };
  }

  return {
    API_URL: API_URL,
    parseDigest: parseDigest,
    isAllowedHost: isAllowedHost,
    isAllowedUrl: isAllowedUrl,
    pickZipAsset: pickZipAsset,
    verifyDecision: verifyDecision,
    hasNode: hasNode,
    runUpdate: runUpdate
  };
}());
if (typeof module !== 'undefined' && module.exports) { module.exports = DCUpdater; }
