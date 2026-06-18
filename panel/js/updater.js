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

  return {
    API_URL: API_URL,
    parseDigest: parseDigest,
    isAllowedHost: isAllowedHost,
    isAllowedUrl: isAllowedUrl,
    pickZipAsset: pickZipAsset,
    verifyDecision: verifyDecision,
    hasNode: hasNode
  };
}());
if (typeof module !== 'undefined' && module.exports) { module.exports = DCUpdater; }
