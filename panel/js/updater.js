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

  let _cfg = null;   // { csInterface, storage, nodeAvailable }
  let _paths = null; // resolved DCUpdaterFS.paths or null
  let _latest = null;
  let _release = null;
  let _running = false;

  function $(id) { return document.getElementById(id); }

  function init(cfg) {
    _cfg = cfg;
    if (!cfg.nodeAvailable) return;
    try {
      const SystemPath = window.SystemPath;
      const extDir = cfg.csInterface.getSystemPath(SystemPath.EXTENSION);
      _paths = DCUpdaterFS.paths(extDir, process.platform, require('os').homedir(), DCUpdate.VERSION);
      $('update-github-btn').addEventListener('click', function () { cfg.csInterface.openURLInDefaultBrowser(DCUpdate.RELEASES_PAGE); });
      $('update-later-btn').addEventListener('click', close);
      $('update-done-btn').addEventListener('click', close);
      $('update-now-btn').addEventListener('click', start);
    } catch (e) { _paths = null; _cfg.nodeAvailable = false; }
  }

  function setLatest(tag) { _latest = tag; }
  function close() { if (!_running) $('update-modal').classList.add('hidden'); }

  function open() {
    resetModal();
    $('update-modal-title').textContent = 'Update available — ' + String(_latest || '').replace(/^v/, '');
    $('update-modal').classList.remove('hidden');
    DCUpdaterFS.fetchLatestRelease(API_URL, isAllowedUrl).then(function (rel) {
      _release = rel;
      $('update-notes').textContent = (rel && rel.body) ? rel.body : 'A newer version of DropComp is available.';
    }).catch(function () { $('update-notes').textContent = 'A newer version of DropComp is available.'; });
  }

  function resetModal() {
    $('update-progress').classList.add('hidden');
    $('update-error').classList.add('hidden');
    $('update-actions').classList.remove('hidden');
    $('update-done-actions').classList.add('hidden');
    $('update-progress-bar').style.width = '0';
  }

  const LABELS = { fetch: 'Checking…', download: 'Downloading…', verify: 'Verifying…', extract: 'Unpacking…', backup: 'Backing up your current version…', apply: 'Installing…', staged: 'Almost done…', done: 'Done.' };

  function onProgress(phase, pct) {
    $('update-progress-label').textContent = LABELS[phase] || phase;
    if (phase === 'download' && typeof pct === 'number') $('update-progress-bar').style.width = pct + '%';
    else if (phase !== 'fetch') $('update-progress-bar').style.width = '100%';
  }

  function start() {
    if (_running || !_paths) return;
    _running = true;
    $('update-actions').classList.add('hidden');
    $('update-error').classList.add('hidden');
    $('update-progress').classList.remove('hidden');
    runUpdate({ fs: DCUpdaterFS, paths: _paths, platform: process.platform, localVersion: DCUpdate.VERSION, release: _release, onProgress: onProgress })
      .then(function (r) {
        _running = false;
        $('update-progress').classList.add('hidden');
        $('update-modal-title').textContent = r.mode === 'win-pending' ? 'Update ready' : 'Update complete';
        $('update-notes').textContent = r.mode === 'win-pending'
          ? 'Quit and reopen After Effects to finish installing — it applies automatically the moment AE closes. Your work and library are safe.'
          : 'Restart After Effects to finish — you\'ll be on ' + r.version + '. Your work and library are safe.';
        $('update-done-actions').classList.remove('hidden');
      })
      .catch(function (err) {
        _running = false;
        $('update-progress').classList.add('hidden');
        $('update-actions').classList.remove('hidden');
        const e = $('update-error');
        e.textContent = (err && err.userMessage ? err.userMessage : 'The update couldn\'t be completed.') + ' Your current version is safe and unchanged. Use "View on GitHub" to download it manually.';
        e.classList.remove('hidden');
      });
  }

  function onBoot() {
    if (!_cfg || !_cfg.nodeAvailable || !_paths) return;
    try {
      const st = DCUpdaterFS.readStatus(_paths.statusFile);
      if (st && st.state === 'ok') {
        if (window.DCUI) DCUI.toast('Updated to ' + st.version + '.');
        DCUpdaterFS.writeStatus(_paths.statusFile, { state: 'idle' });
      } else if (st && st.state === 'fail') {
        if (window.DCUI) DCUI.toast('Update didn\'t finish — you\'re still on ' + DCUpdate.VERSION + '. Nothing was changed.', true, 6000);
        DCUpdaterFS.writeStatus(_paths.statusFile, { state: 'idle' });
      }
      DCUpdaterFS.cleanupStale(_paths);
    } catch (e) {}
  }

  return {
    API_URL: API_URL,
    parseDigest: parseDigest,
    isAllowedHost: isAllowedHost,
    isAllowedUrl: isAllowedUrl,
    pickZipAsset: pickZipAsset,
    verifyDecision: verifyDecision,
    hasNode: hasNode,
    runUpdate: runUpdate,
    init: init,
    setLatest: setLatest,
    open: open,
    onBoot: onBoot
  };
}());
if (typeof module !== 'undefined' && module.exports) { module.exports = DCUpdater; }
