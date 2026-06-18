var DCUpdaterFS = (function () {
  'use strict';

  const DIRS = ['CSXS', 'panel', 'jsx'];

  function mkdirpSync(dir, _fs) {
    const fs = _fs || require('fs');
    const path = require('path');
    if (fs.existsSync(dir)) return;
    mkdirpSync(path.dirname(dir), fs);
    try { fs.mkdirSync(dir); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }

  function rmrf(target, _fs) {
    const fs = _fs || require('fs');
    const path = require('path');
    if (!fs.existsSync(target)) return;
    if (fs.lstatSync(target).isDirectory()) {
      const names = fs.readdirSync(target);
      for (let i = 0; i < names.length; i++) rmrf(path.join(target, names[i]), fs);
      fs.rmdirSync(target);
    } else {
      fs.unlinkSync(target);
    }
  }

  function copyDirRecursive(src, dest, _fs) {
    const fs = _fs || require('fs');
    const path = require('path');
    mkdirpSync(dest, fs);
    const names = fs.readdirSync(src);
    for (let i = 0; i < names.length; i++) {
      const s = path.join(src, names[i]);
      const d = path.join(dest, names[i]);
      if (fs.lstatSync(s).isDirectory()) copyDirRecursive(s, d, fs);
      else fs.writeFileSync(d, fs.readFileSync(s));
    }
  }

  async function moveDir(src, dest, _fs) {
    const fs = _fs || require('fs');
    try { fs.renameSync(src, dest); }
    catch (e) {
      if (e.code !== 'EXDEV') throw e;
      copyDirRecursive(src, dest, fs);
      rmrf(src, fs);
    }
  }

  function paths(extensionDir, platform, homeDir, version) {
    const path = require('path');
    const backupDir = path.join(homeDir, 'Documents', 'DropComp');
    const workDir = path.join(backupDir, '.dropcomp-update');
    return {
      liveDir: extensionDir,
      extensionsRoot: path.dirname(extensionDir),
      backupDir: backupDir,
      backupZip: path.join(backupDir, 'backup-' + version + '.zip'),
      workDir: workDir,
      stagingDir: path.join(workDir, 'staging'),
      tmpZip: path.join(workDir, 'download.zip'),
      statusFile: path.join(workDir, 'status.json')
    };
  }

  async function fetchLatestRelease(apiUrl, isAllowedUrl, _https) {
    const https = _https || require('https');
    if (isAllowedUrl && !isAllowedUrl(apiUrl)) throw new Error('Refused a non-GitHub API URL.');
    return await new Promise(function (resolve, reject) {
      const req = https.get(apiUrl, { headers: { 'User-Agent': 'DropComp-Updater', 'Accept': 'application/vnd.github+json' } }, function (res) {
        if (res.statusCode !== 200) { res.resume(); reject(new Error('GitHub API returned HTTP ' + res.statusCode + '.')); return; }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', function (c) { body += c; });
        res.on('error', reject);
        res.on('end', function () { try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('Could not parse the GitHub response.')); } });
      });
      req.on('error', reject);
      req.setTimeout(15000, function () { req.destroy(new Error('GitHub request timed out.')); });
    });
  }

  async function download(url, destPath, onProgress, isAllowedUrl, _https) {
    const https = _https || require('https');
    const fs = require('fs');
    const path = require('path');
    const URL = require('url').URL;
    mkdirpSync(path.dirname(destPath), fs);
    const progress = onProgress || function () {};
    return await new Promise(function (resolve, reject) {
      let redirects = 0;
      function get(u) {
        if (isAllowedUrl && !isAllowedUrl(u)) { reject(new Error('Refused a non-GitHub download URL.')); return; }
        let out = null;
        function destroyOut() { if (out) { try { out.destroy(); } catch (_) {} } }
        const req = https.get(u, { headers: { 'User-Agent': 'DropComp-Updater' } }, function (res) {
          const sc = res.statusCode;
          if (sc >= 300 && sc < 400 && res.headers.location) {
            res.resume();
            if (++redirects > 5) { reject(new Error('Too many redirects.')); return; }
            get(new URL(res.headers.location, u).toString());
            return;
          }
          if (sc !== 200) { res.resume(); reject(new Error('Download failed (HTTP ' + sc + ').')); return; }
          const total = parseInt(res.headers['content-length'] || '0', 10);
          let got = 0;
          out = fs.createWriteStream(destPath);
          res.on('data', function (c) { got += c.length; if (total) progress(Math.round(got / total * 100)); });
          res.on('error', function (e) { destroyOut(); reject(e); });
          res.pipe(out);
          out.on('finish', function () { out.close(function () { resolve(destPath); }); });
          out.on('error', reject);
        });
        req.on('error', function (e) { destroyOut(); reject(e); });
        req.setTimeout(30000, function () { req.destroy(new Error('Download timed out.')); });
      }
      get(url);
    });
  }

  return {
    DIRS: DIRS,
    mkdirpSync: mkdirpSync,
    rmrf: rmrf,
    copyDirRecursive: copyDirRecursive,
    moveDir: moveDir,
    paths: paths,
    fetchLatestRelease: fetchLatestRelease,
    download: download
  };
}());
if (typeof module !== 'undefined' && module.exports) { module.exports = DCUpdaterFS; }
