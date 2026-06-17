var DCUpdate = (function () {
  'use strict';

  var VERSION = '2.2.0';
  var RELEASES_API = 'https://api.github.com/repos/ziscolwp/dropcomp/releases/latest';
  var RELEASES_PAGE = 'https://github.com/ziscolwp/dropcomp/releases/latest';
  var CHECK_KEY = 'dropcomp_update_check';
  var CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

  function parseVersion(v) {
    var m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v === undefined || v === null ? '' : v).trim());
    if (!m) return null;
    return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
  }

  function isNewer(remote, local) {
    var r = parseVersion(remote);
    var l = parseVersion(local);
    if (!r || !l) return false;
    for (var i = 0; i < 3; i++) {
      if (r[i] > l[i]) return true;
      if (r[i] < l[i]) return false;
    }
    return false;
  }

  function readCache(storage) {
    try { return JSON.parse(storage.getItem(CHECK_KEY)) || null; } catch (e) { return null; }
  }

  function writeCache(storage, cache) {
    try { storage.setItem(CHECK_KEY, JSON.stringify(cache)); } catch (e) {}
  }

  // Calls cb with the newer release tag (e.g. 'v2.2.0') or null when up to date.
  // Network failures and malformed responses are silent (cb(null)) - an update
  // notice is a nicety, never an error condition.
  function check(storage, now, cb) {
    var cache = readCache(storage);
    if (cache && cache.ts && (now - cache.ts) < CHECK_INTERVAL_MS) {
      cb(isNewer(cache.latest, VERSION) ? cache.latest : null);
      return;
    }
    var xhr = new XMLHttpRequest();
    xhr.open('GET', RELEASES_API, true);
    xhr.timeout = 8000;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var latest = null;
      if (xhr.status === 200) {
        try { latest = JSON.parse(xhr.responseText).tag_name || null; } catch (e) { latest = null; }
      }
      // cache failures too (latest: null) so rate-limited/offline boots
      // don't re-fire the request until the window passes
      writeCache(storage, { ts: now, latest: latest });
      cb(latest && isNewer(latest, VERSION) ? latest : null);
    };
    try { xhr.send(); } catch (e) { cb(null); }
  }

  return {
    VERSION: VERSION,
    RELEASES_PAGE: RELEASES_PAGE,
    CHECK_KEY: CHECK_KEY,
    parseVersion: parseVersion,
    isNewer: isNewer,
    check: check
  };
}());
if (typeof module !== 'undefined' && module.exports) { module.exports = DCUpdate; }
