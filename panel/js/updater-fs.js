// TODO: split by concern (generic fs helpers vs Windows exit-time helper)
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

  function paths(extensionDir, platform, homeDir, version, env) {
    const path = require('path');
    const e = env || (typeof process !== 'undefined' ? process.env : null) || {};
    const backupDir = path.join(homeDir, 'Documents', 'DropComp');
    const docsWorkDir = path.join(backupDir, '.dropcomp-update');
    // Windows stages under LOCALAPPDATA: Documents is often OneDrive-synced or
    // Controlled-Folder-Access protected, both of which can lock or block the
    // swap. The user-facing backup zip stays in Documents on purpose.
    const win = platform === 'win32';
    const workDir = win
      ? path.join(e.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local'), 'DropComp', 'update')
      : docsWorkDir;
    return {
      liveDir: extensionDir,
      extensionsRoot: path.dirname(extensionDir),
      backupDir: backupDir,
      backupZip: path.join(backupDir, 'backup-' + version + '.zip'),
      workDir: workDir,
      legacyWorkDir: win ? docsWorkDir : null,
      stagingDir: path.join(workDir, 'staging'),
      tmpZip: path.join(workDir, 'download.zip'),
      statusFile: path.join(workDir, 'status.json'),
      logFile: path.join(workDir, 'updater.log')
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
    const root = findStagedRoot(stagingDir, fs);
    if (!root) throw new Error('Downloaded package layout was not recognized.');
    return root;
  }

  // The release zip may contain the code dirs at its root or nested one level
  // (DropComp-x.y.z/...). Returns the dir that holds CSXS, or null.
  function findStagedRoot(stagingDir, _fs) {
    const fs = _fs || require('fs');
    const path = require('path');
    try {
      if (!fs.existsSync(stagingDir)) return null;
      if (fs.existsSync(path.join(stagingDir, 'CSXS'))) return stagingDir;
      const names = fs.readdirSync(stagingDir);
      for (let i = 0; i < names.length; i++) {
        const cand = path.join(stagingDir, names[i]);
        if (fs.statSync(cand).isDirectory() && fs.existsSync(path.join(cand, 'CSXS'))) return cand;
      }
    } catch (e) {}
    return null;
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

  // Move-aside swap with full rollback. Plain Node fs, so it works on every
  // platform - the mac updater applies it immediately; Windows uses it at boot
  // when the exit-time helper never got to run.
  async function applySwap(liveDir, stagedRoot, _fs) {
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

  // Constraints this script lives under, learned the hard way:
  // - It waits ONLY on AfterFX* - CEPHtmlEngine.exe belongs to every Adobe
  //   app's CEP panels (Premiere, Photoshop...), so waiting on it deadlocks.
  // - "Quiet" needs consecutive empty polls: users quit-and-reopen AE fast,
  //   and a single empty poll can land in that gap.
  // - Status writes go through [IO.File]::WriteAllText - Set-Content -Encoding
  //   UTF8 on PowerShell 5.1 adds a BOM that Node's JSON.parse chokes on,
  //   which made every outcome invisible to the panel.
  // - A timeout leaves state "pending" (nothing changed; the panel finishes
  //   the swap itself on next boot) - it is not a failure.
  function buildWindowsApplyScript(o) {
    return [
      '$ErrorActionPreference = "Stop"',
      '$live = ' + psQuote(o.liveDir),
      '$staged = ' + psQuote(o.stagedRoot),
      '$backup = ' + psQuote(o.backupZip),
      '$statusFile = ' + psQuote(o.statusFile),
      '$logFile = ' + psQuote(o.logFile || ''),
      '$version = ' + psQuote(o.version),
      '$dirs = @("CSXS","panel","jsx")',
      'function Write-Log($msg) {',
      '  try { Add-Content -LiteralPath $logFile -Value ("[" + (Get-Date -Format s) + "] " + $msg) } catch {}',
      '}',
      'function Write-Status($state, $msg) {',
      '  $o = @{ state = $state; version = $version; message = $msg } | ConvertTo-Json -Compress',
      '  [System.IO.File]::WriteAllText($statusFile, $o, (New-Object System.Text.UTF8Encoding($false)))',
      '}',
      'function Test-AeRunning { return [bool](Get-Process -Name "AfterFX*" -ErrorAction SilentlyContinue) }',
      'function Wait-AeQuiet($deadline) {',
      '  $quiet = 0',
      '  while ($quiet -lt 3) {',
      '    if ((Get-Date) -gt $deadline) { return $false }',
      '    if (Test-AeRunning) { $quiet = 0 } else { $quiet++ }',
      '    Start-Sleep -Seconds 2',
      '  }',
      '  return $true',
      '}',
      // Freshly written files are often briefly held by AV/indexing - retry.
      'function Move-WithRetry($from, $to) {',
      '  for ($i = 1; $i -le 5; $i++) {',
      '    try { Move-Item -LiteralPath $from -Destination $to -Force; return }',
      '    catch { if ($i -eq 5) { throw }; Write-Log ("move retry " + $i + ": " + $_.Exception.Message); Start-Sleep -Seconds 2 }',
      '  }',
      '}',
      'function Rename-WithRetry($p, $newName) {',
      '  for ($i = 1; $i -le 5; $i++) {',
      '    try { Rename-Item -LiteralPath $p -NewName $newName; return }',
      '    catch { if ($i -eq 5) { throw }; Write-Log ("rename retry " + $i + ": " + $_.Exception.Message); Start-Sleep -Seconds 2 }',
      '  }',
      '}',
      'function Remove-WithRetry($p) {',
      '  if (-not (Test-Path -LiteralPath $p)) { return }',
      '  for ($i = 1; $i -le 5; $i++) {',
      '    try { Remove-Item -LiteralPath $p -Recurse -Force; return }',
      '    catch { if ($i -eq 5) { throw }; Write-Log ("remove retry " + $i + ": " + $_.Exception.Message); Start-Sleep -Seconds 2 }',
      '  }',
      '}',
      'Write-Log ("helper started for " + $version)',
      '$deadline = (Get-Date).AddMinutes(60)',
      'while ($true) {',
      '  if (-not (Wait-AeQuiet $deadline)) { Write-Log "timed out waiting for After Effects to close - update stays pending; the panel applies it on next boot"; exit 0 }',
      '  Write-Log "After Effects closed - applying"',
      '  try {',
      '    foreach ($d in $dirs) {',
      '      $liveD = Join-Path $live $d; $oldD = Join-Path $live ($d + ".dcold"); $newD = Join-Path $staged $d',
      '      Remove-WithRetry $oldD',
      '      if (Test-Path -LiteralPath $liveD) { Rename-WithRetry $liveD ($d + ".dcold") }',
      '      Move-WithRetry $newD $liveD',
      '    }',
      '    foreach ($d in $dirs) { Remove-WithRetry (Join-Path $live ($d + ".dcold")) }',
      '    Remove-WithRetry $staged',
      '    Write-Status "ok" ("Updated to " + $version + ".")',
      '    Write-Log "applied ok"',
      '    exit 0',
      '  } catch {',
      '    $err = $_.Exception.Message',
      '    Write-Log ("swap failed: " + $err + " - rolling back")',
      '    foreach ($d in $dirs) {',
      '      $liveD = Join-Path $live $d; $oldD = Join-Path $live ($d + ".dcold")',
      '      if (Test-Path -LiteralPath $oldD) {',
      '        if (Test-Path -LiteralPath $liveD) { try { Remove-Item -LiteralPath $liveD -Recurse -Force } catch { Write-Log ("rollback remove failed: " + $_.Exception.Message) } }',
      '        try { Rename-Item -LiteralPath $oldD -NewName $d } catch { Write-Log ("rollback restore failed: " + $_.Exception.Message) }',
      '      }',
      '    }',
      // AE relaunched mid-swap (the classic quick restart) - wait again.
      '    if (Test-AeRunning) { Write-Log "After Effects relaunched mid-swap - waiting again"; continue }',
      '    Write-Status "fail" $err',
      '    Write-Log "gave up"',
      '    exit 1',
      '  }',
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

  // ZXP-installed panels load because their signature is valid - but every
  // self-update rewrites files and breaks that signature. Re-asserting
  // PlayerDebugMode (user-level, no elevation) on each boot keeps the panel
  // loading forever regardless of how it was first installed.
  function ensureDebugMode(platform, _cp) {
    const cp = _cp || require('child_process');
    const plat = platform || process.platform;
    let ok = false;
    for (let v = 8; v <= 12; v++) {
      try {
        if (plat === 'darwin') {
          cp.execFileSync('/usr/bin/defaults', ['write', 'com.adobe.CSXS.' + v, 'PlayerDebugMode', '1']);
        } else if (plat === 'win32') {
          cp.execFileSync('reg.exe', ['add', 'HKCU\\SOFTWARE\\Adobe\\CSXS.' + v, '/v', 'PlayerDebugMode', '/t', 'REG_SZ', '/d', '1', '/f']);
        }
        ok = true;
      } catch (e) { /* per-version failures are fine; any success is enough */ }
    }
    return ok;
  }

  function readStatus(statusFile, _fs) {
    const fs = _fs || require('fs');
    // strip the BOM in case an older helper wrote one (PS 5.1 Set-Content UTF8)
    try { return JSON.parse(fs.readFileSync(statusFile, 'utf8').replace(/^﻿/, '')); } catch (e) { return null; }
  }

  async function spawnWindowsHelper(p, stagedRoot, version, _deps) {
    const deps = _deps || {};
    const fs = deps.fs || require('fs');
    const cp = deps.cp || require('child_process');
    const env = deps.env || (typeof process !== 'undefined' ? process.env : null) || {};
    const path = require('path');
    mkdirpSync(p.workDir, fs);
    const script = buildWindowsApplyScript({ liveDir: p.liveDir, stagedRoot: stagedRoot, backupZip: p.backupZip, statusFile: p.statusFile, logFile: p.logFile, version: version });
    const scriptPath = path.join(p.workDir, 'apply.ps1');
    fs.writeFileSync(scriptPath, script, 'utf8');
    await writeStatus(p.statusFile, { state: 'pending', version: version }, fs);
    const psExe = env.SystemRoot
      ? path.join(env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : 'powershell.exe';
    // A plain detached child sits in AE's job object and can be killed the
    // instant AE quits - before it ever swaps. Win32_Process.Create parents
    // the worker under WmiPrvSE instead, and -EncodedCommand keeps it running
    // even where Group Policy blocks unsigned script files.
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const workerCmd = '"' + psExe + '" -NoProfile -WindowStyle Hidden -EncodedCommand ' + encoded;
    const bootstrap =
      'try { Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ' + psQuote(workerCmd) + ' } -ErrorAction Stop | Out-Null } ' +
      'catch { Start-Process -FilePath ' + psQuote(psExe) + ' -ArgumentList ' + psQuote('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + scriptPath + '"') + ' -WindowStyle Hidden }';
    const child = cp.spawn(psExe, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', bootstrap], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
  }

  // A "pending" status plus staged files at boot means the exit-time helper
  // never ran (killed with AE, blocked by policy, or the machine rebooted).
  // AE has only just started, so the extension files aren't locked yet -
  // finish the swap ourselves, or hand it back to a fresh helper if we can't.
  async function applyPendingSwapAtBoot(p, opts, _deps) {
    const deps = _deps || {};
    const fs = deps.fs || require('fs');
    const status = readStatus(p.statusFile, fs);
    if (!status || status.state !== 'pending') return { mode: 'none' };
    const stagedRoot = findStagedRoot(p.stagingDir, fs);
    const usable = stagedRoot && status.version && opts.isNewer(status.version, opts.localVersion);
    if (usable) {
      try { assertStagedTree(stagedRoot, fs); } catch (e) {
        await writeStatus(p.statusFile, { state: 'idle' }, fs);
        return { mode: 'none' };
      }
      try {
        await applySwap(p.liveDir, stagedRoot, fs);
        await writeStatus(p.statusFile, { state: 'ok', version: status.version }, fs);
        return { mode: 'applied', version: status.version };
      } catch (e) {
        // locked or AV-held files - the exit-time helper gets another shot
        try { await spawnWindowsHelper(p, stagedRoot, status.version, deps); } catch (e2) {}
        return { mode: 'respawned', version: status.version };
      }
    }
    // staleness: the helper already applied it (we ARE the new version), or
    // the staging is gone/unusable - either way pending must not live forever
    await writeStatus(p.statusFile, { state: 'idle' }, fs);
    return { mode: 'none' };
  }

  async function cleanupStale(p, _fs) {
    const fs = _fs || require('fs');
    const path = require('path');
    // pre-2.8.0 updaters staged under Documents; anything left there is dead
    if (p.legacyWorkDir && p.legacyWorkDir !== p.workDir && fs.existsSync(p.legacyWorkDir)) {
      try { rmrf(p.legacyWorkDir, fs); } catch (e) {}
    }
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
    findStagedRoot: findStagedRoot,
    assertStagedTree: assertStagedTree,
    backup: backup,
    applySwap: applySwap,
    applyMacSwap: applySwap, // legacy name
    applyPendingSwapAtBoot: applyPendingSwapAtBoot,
    buildWindowsApplyScript: buildWindowsApplyScript,
    spawnWindowsHelper: spawnWindowsHelper,
    ensureDebugMode: ensureDebugMode,
    writeStatus: writeStatus,
    readStatus: readStatus,
    cleanupStale: cleanupStale
  };
}());
if (typeof module !== 'undefined' && module.exports) { module.exports = DCUpdaterFS; }
