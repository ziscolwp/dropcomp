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

  async function fileSize(p, _fs) { const fs = _fs || require('fs'); return fs.statSync(p).size; }

  async function sha256File(p, _fs) {
    const fs = _fs || require('fs');
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  }

  async function extract(zipPath, stagingDir, platform, _cp, _fs) {
    const fs = _fs || require('fs');
    const path = require('path');
    const cp = _cp || require('child_process');
    const plat = platform || process.platform;
    if (fs.existsSync(stagingDir)) rmrf(stagingDir, fs);
    mkdirpSync(stagingDir, fs);
    if (plat === 'win32') {
      cp.execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        "Expand-Archive -LiteralPath '" + zipPath.replace(/'/g, "''") + "' -DestinationPath '" + stagingDir.replace(/'/g, "''") + "' -Force"]);
    } else {
      cp.execFileSync('/usr/bin/ditto', ['-x', '-k', zipPath, stagingDir]);
    }
    const names = fs.readdirSync(stagingDir);
    if (names.indexOf('CSXS') !== -1) return stagingDir;
    for (let i = 0; i < names.length; i++) {
      const cand = path.join(stagingDir, names[i]);
      if (fs.statSync(cand).isDirectory() && fs.existsSync(path.join(cand, 'CSXS'))) return cand;
    }
    throw new Error('Downloaded package layout was not recognized.');
  }

  function assertStagedTree(stagedRoot, _fs) {
    const fs = _fs || require('fs');
    const path = require('path');
    for (let i = 0; i < DIRS.length; i++) {
      const p = path.join(stagedRoot, DIRS[i]);
      if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) throw new Error('Downloaded package is missing the "' + DIRS[i] + '" folder.');
    }
  }

  async function backup(liveDir, backupZip, platform, _cp, _fs) {
    const fs = _fs || require('fs');
    const cp = _cp || require('child_process');
    const path = require('path');
    if (fs.existsSync(backupZip)) return;
    mkdirpSync(path.dirname(backupZip), fs);
    const plat = platform || process.platform;
    if (plat === 'win32') {
      cp.execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        "Compress-Archive -Path '" + liveDir.replace(/'/g, "''") + "' -DestinationPath '" + backupZip.replace(/'/g, "''") + "' -Force"]);
    } else {
      cp.execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', liveDir, backupZip]);
    }
  }

  async function applyMacSwap(liveDir, stagedRoot, _fs) {
    const fs = _fs || require('fs');
    const path = require('path');
    const steps = DIRS.map(function (d) {
      return { d: d, live: path.join(liveDir, d), old: path.join(liveDir, d + '.dcold'), staged: path.join(stagedRoot, d), movedAside: false, movedIn: false };
    });
    let i = 0;
    try {
      for (; i < steps.length; i++) {
        const s = steps[i];
        if (fs.existsSync(s.old)) rmrf(s.old, fs);
        if (fs.existsSync(s.live)) { fs.renameSync(s.live, s.old); s.movedAside = true; }
        await moveDir(s.staged, s.live, fs);
        s.movedIn = true;
      }
      for (let k = 0; k < steps.length; k++) if (fs.existsSync(steps[k].old)) rmrf(steps[k].old, fs);
    } catch (e) {
      const rollbackErrors = [];
      for (let j = i; j >= 0; j--) {
        const s = steps[j];
        if (!s) continue;
        // remove whatever is now at live (a partial copy, the full new content, or nothing)
        if (s.movedAside || s.movedIn) {
          try { if (fs.existsSync(s.live)) rmrf(s.live, fs); }
          catch (e2) { rollbackErrors.push(s.d + ': ' + e2.message); }
        }
        // restore the original we moved aside
        if (s.movedAside) {
          try { fs.renameSync(s.old, s.live); }
          catch (e3) { rollbackErrors.push(s.d + ' restore: ' + e3.message); }
        }
      }
      if (rollbackErrors.length) {
        const err = new Error('Update failed (' + e.message + ') and automatic rollback was incomplete: ' + rollbackErrors.join('; '));
        err.rollbackFailed = true;
        err.userMessage = 'The update failed and the previous version could not be fully restored automatically. Please reinstall DropComp or restore from the backup in your Documents/DropComp folder.';
        throw err;
      }
      throw e;
    }
  }

  function psQuote(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

  function buildWindowsApplyScript(o) {
    return [
      '$ErrorActionPreference = "Stop"',
      '$live = ' + psQuote(o.liveDir),
      '$staged = ' + psQuote(o.stagedRoot),
      '$backup = ' + psQuote(o.backupZip),
      '$statusFile = ' + psQuote(o.statusFile),
      '$version = ' + psQuote(o.version),
      '$dirs = @("CSXS","panel","jsx")',
      'function Write-Status($state, $msg) {',
      '  $o = @{ state = $state; version = $version; message = $msg } | ConvertTo-Json -Compress',
      '  Set-Content -LiteralPath $statusFile -Value $o -Encoding UTF8',
      '}',
      '$deadline = (Get-Date).AddMinutes(60)',
      'while (Get-Process -Name AfterFX,AfterFXLib,CEPHtmlEngine -ErrorAction SilentlyContinue) {',
      '  if ((Get-Date) -gt $deadline) { Write-Status "fail" "Timed out waiting for After Effects to close."; exit 1 }',
      '  Start-Sleep -Seconds 2',
      '}',
      'Start-Sleep -Seconds 3',
      'try {',
      '  foreach ($d in $dirs) {',
      '    $liveD = Join-Path $live $d; $oldD = Join-Path $live ($d + ".dcold"); $newD = Join-Path $staged $d',
      '    if (Test-Path -LiteralPath $oldD) { Remove-Item -LiteralPath $oldD -Recurse -Force }',
      '    if (Test-Path -LiteralPath $liveD) { Rename-Item -LiteralPath $liveD -NewName ($d + ".dcold") }',
      '    Move-Item -LiteralPath $newD -Destination $liveD',
      '  }',
      '  foreach ($d in $dirs) { $oldD = Join-Path $live ($d + ".dcold"); if (Test-Path -LiteralPath $oldD) { Remove-Item -LiteralPath $oldD -Recurse -Force } }',
      '  if (Test-Path -LiteralPath $staged) { Remove-Item -LiteralPath $staged -Recurse -Force }',
      '  Write-Status "ok" "Updated to $version."',
      '} catch {',
      '  foreach ($d in $dirs) {',
      '    $liveD = Join-Path $live $d; $oldD = Join-Path $live ($d + ".dcold")',
      '    if (Test-Path -LiteralPath $oldD) {',
      '      if (Test-Path -LiteralPath $liveD) { Remove-Item -LiteralPath $liveD -Recurse -Force }',
      '      Rename-Item -LiteralPath $oldD -NewName $d',
      '    }',
      '  }',
      '  Write-Status "fail" $_.Exception.Message',
      '  exit 1',
      '}'
    ].join('\r\n');
  }

  function writeStatus(statusFile, obj, _fs) {
    const fs = _fs || require('fs');
    const path = require('path');
    mkdirpSync(path.dirname(statusFile), fs);
    fs.writeFileSync(statusFile, JSON.stringify(obj), 'utf8');
    return Promise.resolve();
  }

  function readStatus(statusFile, _fs) {
    const fs = _fs || require('fs');
    try { return JSON.parse(fs.readFileSync(statusFile, 'utf8')); } catch (e) { return null; }
  }

  async function spawnWindowsHelper(p, stagedRoot, version, _deps) {
    const deps = _deps || {};
    const fs = deps.fs || require('fs');
    const cp = deps.cp || require('child_process');
    const path = require('path');
    mkdirpSync(p.workDir, fs);
    const scriptPath = path.join(p.workDir, 'apply.ps1');
    fs.writeFileSync(scriptPath, buildWindowsApplyScript({ liveDir: p.liveDir, stagedRoot: stagedRoot, backupZip: p.backupZip, statusFile: p.statusFile, version: version }), 'utf8');
    await writeStatus(p.statusFile, { state: 'pending', version: version }, fs);
    const child = cp.spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
  }

  async function cleanupStale(p, _fs) {
    const fs = _fs || require('fs');
    const path = require('path');
    const status = readStatus(p.statusFile, fs);
    if (status && status.state === 'pending') return;
    for (let i = 0; i < DIRS.length; i++) {
      const live = path.join(p.liveDir, DIRS[i]);
      const old = path.join(p.liveDir, DIRS[i] + '.dcold');
      if (!fs.existsSync(live) && fs.existsSync(old)) { try { fs.renameSync(old, live); } catch (e) {} }
      else if (fs.existsSync(live) && fs.existsSync(old)) { rmrf(old, fs); }
    }
    if (fs.existsSync(p.stagingDir)) rmrf(p.stagingDir, fs);
  }

  return {
    DIRS: DIRS,
    mkdirpSync: mkdirpSync,
    rmrf: rmrf,
    copyDirRecursive: copyDirRecursive,
    moveDir: moveDir,
    paths: paths,
    fetchLatestRelease: fetchLatestRelease,
    download: download,
    fileSize: fileSize,
    sha256File: sha256File,
    extract: extract,
    assertStagedTree: assertStagedTree,
    backup: backup,
    applyMacSwap: applyMacSwap,
    buildWindowsApplyScript: buildWindowsApplyScript,
    spawnWindowsHelper: spawnWindowsHelper,
    writeStatus: writeStatus,
    readStatus: readStatus,
    cleanupStale: cleanupStale
  };
}());
if (typeof module !== 'undefined' && module.exports) { module.exports = DCUpdaterFS; }
