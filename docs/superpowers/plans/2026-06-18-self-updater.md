# In-Panel Self-Updater Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "update chip that only links to the download page" with a one-click in-panel self-updater that downloads, verifies, backs up, and swaps in a new release, then prompts a restart — robust enough never to brick the panel or lose user data, on macOS and Windows.

**Architecture:** A controller module (`updater.js`, pure decisions + UI) drives an injected Node I/O helper (`updater-fs.js`, download/verify/extract/backup/swap/rollback). The live extension is untouched until a verified copy *and* a backup both exist; the destructive swap moves folders aside (reversible) and auto-rolls-back on any failure. macOS swaps immediately; Windows stages and a detached helper applies the moment AE closes (Windows locks in-use files). If Node is unavailable the updater self-disables and the chip falls back to today's open-download-page behavior.

**Tech Stack:** Node built-ins only (`https`, `crypto`, `fs`, `os`, `path`, `child_process`) + OS-native archive tools (`ditto` on macOS, PowerShell `Expand-Archive`/`Compress-Archive` on Windows). Panel updater modules use modern JS; tests run under `node --test`.

## Global Constraints

- **No version bump anywhere.** Do not edit `package.json` version, `CSXS/manifest.xml` version attributes, or `update.js` `VERSION`. (`tests/update.test.js` pins these in sync; leaving them keeps it green.) You DO edit `manifest.xml`'s `<CEFCommandLine>`.
- **`jsx/*` is untouched** by this feature (stays ES3). All file work is Node-side in the panel.
- **Zero new dependencies.** Node built-ins + OS tools only. No npm installs.
- **Panel updater files use modern JS** (`const`/`let`, arrow fns, `async`/`await`, template literals) — `panel/js/updater.js`, `panel/js/updater-fs.js`. `update.js` stays as-is.
- **CEP-safe `fs` only.** CEP may bundle old Node (down to v8 on CEP 9). Do NOT use `fs.cpSync` / `fs.rmSync` / `fs.readdirSync(..,{withFileTypes})` / global `URL` inside the helper. Use the provided `mkdirpSync` / `rmrf` / `copyDirRecursive` helpers and `require('url').URL`.
- **HTTPS + GitHub only.** Network is locked to `api.github.com/repos/ziscolwp/dropcomp/releases/latest` and GitHub-hosted asset URLs; every URL (incl. redirect hops) must pass `isAllowedUrl`. No user-supplied URLs.
- **Never touch user data.** Only `CSXS`/`panel`/`jsx` inside the DropComp extension folder + the Documents backup zip. The library folder, `library_path.txt`, and localStorage favorites are off-limits to every file op.
- **Each new file < 400 lines.** Test runner: `npm test` (= `node --test "tests/**/*.test.js"`). Focused runs: `node --test tests/updater.test.js`.
- **Isolation:** worktree `dropcomp-updater`, branch `feature/self-updater`. Stage explicit paths only — never `git add -A`. `index.html`/`style.css`/`main.js` are shared with a parallel branch; edit only the chip/modal area.
- Every commit message ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

- **Create** `panel/js/updater.js` — controller: pure helpers (`isAllowedUrl`, `pickZipAsset`, `verifyDecision`, `parseDigest`, `hasNode`), the `runUpdate` orchestration, and the modal/progress UI. Depends on the helper via injection (not a hard require).
- **Create** `panel/js/updater-fs.js` — Node I/O boundary: `paths`, `fetchLatestRelease`, `download`, `fileSize`, `sha256File`, `extract`, `assertStagedTree`, `backup`, `applyMacSwap`, `buildWindowsApplyScript`, `spawnWindowsHelper`, `writeStatus`, `readStatus`, `cleanupStale`, plus CEP-safe `mkdirpSync`/`rmrf`/`copyDirRecursive`/`moveDir`.
- **Create** `tests/updater.test.js` — unit tests for the controller (pure helpers + `runUpdate` with a mocked helper).
- **Create** `tests/updater-fs.test.js` — integration tests for the helper against a real temp dir (network/spawn mocked at the boundary).
- **Modify** `panel/index.html` — add the update modal markup; add `<script>` tags for the two new modules (chip/modal area only).
- **Modify** `panel/css/style.css` — modal notes + progress-bar styles (append).
- **Modify** `panel/js/main.js` — chip opens the modal (or falls back); init updater; boot status toast + stale cleanup.
- **Modify** `CSXS/manifest.xml` — populate `<CEFCommandLine>` with `--enable-nodejs --mixed-context`.
- **Modify** `README.md` — rewrite the Updates section + rollout note.
- **Create** `docs/superpowers/verification/2026-06-18-self-updater.md` — manual verification log + Windows release gate.

---

### Task 1: `updater.js` pure helpers

The decision logic with no I/O — trivially unit-testable, and the security-critical URL allowlist.

**Files:**
- Create: `panel/js/updater.js`
- Create: `tests/updater.test.js`

**Interfaces:**
- Consumes: `DCUpdate.isNewer` (from `update.js`) at runtime (not in this task).
- Produces: `DCUpdater.parseDigest(s)→string|null`, `isAllowedHost(h)→bool`, `isAllowedUrl(u)→bool`, `pickZipAsset(release)→asset|null`, `verifyDecision({expectedSize,expectedSha256,actualSize,actualSha256})→{ok,reason}`, `hasNode(req)→bool`.

- [ ] **Step 1: Write the failing tests**

Create `tests/updater.test.js`:

```javascript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/updater.test.js`
Expected: FAIL — `Cannot find module '../panel/js/updater.js'`.

- [ ] **Step 3: Create `updater.js` with the pure helpers**

Create `panel/js/updater.js`:

```javascript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/updater.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add panel/js/updater.js tests/updater.test.js
git commit -m "$(cat <<'EOF'
feat(updater): add pure decision helpers for the self-updater

URL allowlist (HTTPS + GitHub hosts only), release asset picker, download
verify decision (size + optional sha256), digest parser, and node-availability
check. No I/O — these are the unit-testable core of the updater.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `updater-fs.js` skeleton — CEP-safe fs primitives + paths

The Node helper module and its filesystem primitives that work on old CEP Node, plus path resolution. Everything else hangs off this.

**Files:**
- Create: `panel/js/updater-fs.js`
- Create: `tests/updater-fs.test.js`

**Interfaces:**
- Produces: `DCUpdaterFS.DIRS = ['CSXS','panel','jsx']`; `mkdirpSync(dir,fs?)`; `rmrf(target,fs?)`; `copyDirRecursive(src,dest,fs?)`; `moveDir(src,dest,fs?)→Promise`; `paths(extensionDir, platform, homeDir, version)→{liveDir,extensionsRoot,backupDir,backupZip,workDir,stagingDir,tmpZip,statusFile}`.

- [ ] **Step 1: Write the failing tests**

Create `tests/updater-fs.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const FS = require('../panel/js/updater-fs.js');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dc-upd-')); }

test('paths resolves the live dir, backup zip, and work dirs', () => {
  const p = FS.paths('/ext/DropComp', 'darwin', '/Users/me', '2.4.0');
  assert.equal(p.liveDir, '/ext/DropComp');
  assert.equal(p.extensionsRoot, '/ext');
  assert.equal(p.backupZip, '/Users/me/Documents/DropComp/backup-2.4.0.zip');
  assert.ok(p.stagingDir.includes('.dropcomp-update'));
  assert.ok(p.tmpZip.endsWith('.zip'));
  assert.ok(p.statusFile.endsWith('status.json'));
});

test('mkdirpSync + rmrf create and recursively remove a tree', () => {
  const root = tmp();
  const deep = path.join(root, 'a', 'b', 'c');
  FS.mkdirpSync(deep);
  fs.writeFileSync(path.join(deep, 'f.txt'), 'hi');
  assert.ok(fs.existsSync(path.join(deep, 'f.txt')));
  FS.rmrf(path.join(root, 'a'));
  assert.equal(fs.existsSync(path.join(root, 'a')), false);
  FS.rmrf(root);
});

test('copyDirRecursive duplicates a nested tree by content', () => {
  const root = tmp();
  const src = path.join(root, 'src');
  FS.mkdirpSync(path.join(src, 'sub'));
  fs.writeFileSync(path.join(src, 'top.txt'), 'top');
  fs.writeFileSync(path.join(src, 'sub', 'nested.txt'), 'nested');
  const dest = path.join(root, 'dest');
  FS.copyDirRecursive(src, dest);
  assert.equal(fs.readFileSync(path.join(dest, 'top.txt'), 'utf8'), 'top');
  assert.equal(fs.readFileSync(path.join(dest, 'sub', 'nested.txt'), 'utf8'), 'nested');
  FS.rmrf(root);
});

test('moveDir renames within a volume', async () => {
  const root = tmp();
  FS.mkdirpSync(path.join(root, 'from'));
  fs.writeFileSync(path.join(root, 'from', 'x.txt'), 'x');
  await FS.moveDir(path.join(root, 'from'), path.join(root, 'to'));
  assert.equal(fs.existsSync(path.join(root, 'from')), false);
  assert.equal(fs.readFileSync(path.join(root, 'to', 'x.txt'), 'utf8'), 'x');
  FS.rmrf(root);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/updater-fs.test.js`
Expected: FAIL — `Cannot find module '../panel/js/updater-fs.js'`.

- [ ] **Step 3: Create `updater-fs.js` with primitives + paths**

Create `panel/js/updater-fs.js`:

```javascript
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

  return {
    DIRS: DIRS,
    mkdirpSync: mkdirpSync,
    rmrf: rmrf,
    copyDirRecursive: copyDirRecursive,
    moveDir: moveDir,
    paths: paths
  };
}());
if (typeof module !== 'undefined' && module.exports) { module.exports = DCUpdaterFS; }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/updater-fs.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add panel/js/updater-fs.js tests/updater-fs.test.js
git commit -m "$(cat <<'EOF'
feat(updater): add CEP-safe fs primitives + path resolution

mkdirpSync/rmrf/copyDirRecursive/moveDir use only old-Node-safe fs calls
(CEP can bundle Node 8). paths() derives the live extension dir, the
Documents backup zip, and the work/staging dirs from the extension path.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `updater-fs.js` network — fetch release + download

GitHub API fetch and the redirect-following, allowlist-enforcing, progress-reporting download. Tests inject a fake `https` (the outer boundary).

**Files:**
- Modify: `panel/js/updater-fs.js`
- Modify: `tests/updater-fs.test.js`

**Interfaces:**
- Consumes: `isAllowedUrl` (passed in by the caller; `DCUpdater.isAllowedUrl`).
- Produces: `fetchLatestRelease(apiUrl, isAllowedUrl, _https?)→Promise<release>`; `download(url, destPath, onProgress, isAllowedUrl, _https?)→Promise<destPath>`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/updater-fs.test.js`:

```javascript
const { EventEmitter } = require('node:events');

// Fake https.get: feeds a scripted response (status, headers, body chunks).
function fakeHttps(script) {
  return {
    get(url, opts, cb) {
      const step = script(typeof url === 'string' ? url : url.href);
      const res = new EventEmitter();
      res.statusCode = step.status;
      res.headers = step.headers || {};
      res.setEncoding = () => {};
      res.resume = () => {};
      res.pipe = (out) => { (step.chunks || []).forEach((c) => out.write(c)); out.end(); };
      const req = new EventEmitter();
      req.setTimeout = () => {};
      req.destroy = () => {};
      setImmediate(() => {
        cb(res);
        if (!step.headers || !step.headers.location) {
          (step.chunks || []).forEach((c) => res.emit('data', Buffer.from(c)));
          res.emit('end');
        }
      });
      return req;
    }
  };
}

test('fetchLatestRelease parses the GitHub JSON', async () => {
  const https = fakeHttps(() => ({ status: 200, chunks: [JSON.stringify({ tag_name: 'v2.5.0' })] }));
  const r = await FS.fetchLatestRelease('https://api.github.com/x', () => true, https);
  assert.equal(r.tag_name, 'v2.5.0');
});

test('download follows an allowed redirect and writes the file', async () => {
  const root = tmp();
  const dest = path.join(root, 'out.zip');
  const https = fakeHttps((u) => u.includes('cdn')
    ? { status: 200, headers: { 'content-length': '5' }, chunks: ['hello'] }
    : { status: 302, headers: { location: 'https://objects.githubusercontent.com/cdn' } });
  let lastPct = 0;
  const out = await FS.download('https://github.com/dl', dest, (p) => { lastPct = p; }, () => true, https);
  assert.equal(out, dest);
  assert.equal(fs.readFileSync(dest, 'utf8'), 'hello');
  assert.equal(lastPct, 100);
  FS.rmrf(root);
});

test('download refuses a non-allowed redirect target', async () => {
  const root = tmp();
  const https = fakeHttps(() => ({ status: 302, headers: { location: 'https://evil.com/x' } }));
  await assert.rejects(
    FS.download('https://github.com/dl', path.join(root, 'o.zip'), null, DCUpdaterAllow, https),
    /non-GitHub/);
  FS.rmrf(root);
});
```

Add this require near the top of the test file (just after the existing requires):

```javascript
const DCUpdaterAllow = require('../panel/js/updater.js').isAllowedUrl;
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/updater-fs.test.js`
Expected: FAIL — `FS.fetchLatestRelease is not a function`.

- [ ] **Step 3: Add `fetchLatestRelease` and `download`**

In `panel/js/updater-fs.js`, add these functions inside the IIFE (before the `return`):

```javascript
  async function fetchLatestRelease(apiUrl, isAllowedUrl, _https) {
    const https = _https || require('https');
    if (isAllowedUrl && !isAllowedUrl(apiUrl)) throw new Error('Refused a non-GitHub API URL.');
    return await new Promise(function (resolve, reject) {
      const req = https.get(apiUrl, { headers: { 'User-Agent': 'DropComp-Updater', 'Accept': 'application/vnd.github+json' } }, function (res) {
        if (res.statusCode !== 200) { res.resume(); reject(new Error('GitHub API returned HTTP ' + res.statusCode + '.')); return; }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', function (c) { body += c; });
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
          const out = fs.createWriteStream(destPath);
          res.on('data', function (c) { got += c.length; if (total) progress(Math.round(got / total * 100)); });
          res.pipe(out);
          out.on('finish', function () { out.close(function () { resolve(destPath); }); });
          out.on('error', reject);
        });
        req.on('error', reject);
        req.setTimeout(30000, function () { req.destroy(new Error('Download timed out.')); });
      }
      get(url);
    });
  }
```

Add `fetchLatestRelease: fetchLatestRelease,` and `download: download,` to the returned object.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/updater-fs.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add panel/js/updater-fs.js tests/updater-fs.test.js
git commit -m "$(cat <<'EOF'
feat(updater): add GitHub release fetch + verified download

fetchLatestRelease GETs releases/latest; download streams to a temp file,
follows redirects, reports progress, and runs every URL (including redirect
hops) through the GitHub allowlist before connecting.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `updater-fs.js` verify + extract

Hash/size of the download, OS-native extraction, and the staged-tree sanity check. Integration-tested with a real zip fixture (macOS `ditto`).

**Files:**
- Modify: `panel/js/updater-fs.js`
- Modify: `tests/updater-fs.test.js`

**Interfaces:**
- Produces: `fileSize(p,_fs?)→Promise<number>`; `sha256File(p,_fs?)→Promise<hex>`; `extract(zipPath, stagingDir, platform?, _cp?, _fs?)→Promise<stagedRoot>`; `assertStagedTree(stagedRoot,_fs?)→void` (throws on missing `CSXS`/`panel`/`jsx`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/updater-fs.test.js`:

```javascript
const cp = require('node:child_process');
const crypto = require('node:crypto');

function makeReleaseZip(root) {
  // build a DropComp-9.9.9/{CSXS,panel,jsx} tree and zip it like a real release
  const tree = path.join(root, 'DropComp-9.9.9');
  FS.DIRS.forEach((d) => { FS.mkdirpSync(path.join(tree, d)); });
  fs.writeFileSync(path.join(tree, 'CSXS', 'manifest.xml'), '<x/>');
  fs.writeFileSync(path.join(tree, 'panel', 'main.js'), 'new');
  fs.writeFileSync(path.join(tree, 'jsx', 'host.jsx'), 'new');
  const zip = path.join(root, 'rel.zip');
  cp.execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', tree, zip]);
  return zip;
}

test('sha256File + fileSize match crypto/stat on a real file', async () => {
  const root = tmp();
  const f = path.join(root, 'a.bin');
  fs.writeFileSync(f, 'payload');
  assert.equal(await FS.fileSize(f), 7);
  assert.equal(await FS.sha256File(f), crypto.createHash('sha256').update('payload').digest('hex'));
  FS.rmrf(root);
});

test('extract unpacks the zip and finds the inner DropComp root', async () => {
  const root = tmp();
  const zip = makeReleaseZip(root);
  const staged = await FS.extract(zip, path.join(root, 'staging'));
  assert.ok(fs.existsSync(path.join(staged, 'CSXS', 'manifest.xml')));
  assert.equal(fs.readFileSync(path.join(staged, 'panel', 'main.js'), 'utf8'), 'new');
  FS.rmrf(root);
});

test('assertStagedTree throws when a code dir is missing', () => {
  const root = tmp();
  FS.mkdirpSync(path.join(root, 'CSXS'));
  FS.mkdirpSync(path.join(root, 'panel'));
  assert.throws(() => FS.assertStagedTree(root), /jsx/);
  FS.rmrf(root);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/updater-fs.test.js`
Expected: FAIL — `FS.sha256File is not a function`.

- [ ] **Step 3: Add `fileSize`, `sha256File`, `extract`, `assertStagedTree`**

In `panel/js/updater-fs.js`, add inside the IIFE:

```javascript
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
```

Add `fileSize`, `sha256File`, `extract`, `assertStagedTree` to the returned object.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/updater-fs.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add panel/js/updater-fs.js tests/updater-fs.test.js
git commit -m "$(cat <<'EOF'
feat(updater): add download verification + extraction

sha256File/fileSize for integrity checks; extract() unpacks via ditto (mac)
/ Expand-Archive (win) and locates the inner DropComp release root;
assertStagedTree fails fast if the package is missing CSXS/panel/jsx.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `updater-fs.js` backup + macOS swap with rollback

The destructive step and its automatic rollback — the highest-risk code. Backup the live install, then move-aside/move-in the three dirs, reversing everything on any failure.

**Files:**
- Modify: `panel/js/updater-fs.js`
- Modify: `tests/updater-fs.test.js`

**Interfaces:**
- Produces: `backup(liveDir, backupZip, platform?, _cp?, _fs?)→Promise<void>` (skips if the zip exists); `applyMacSwap(liveDir, stagedRoot, _fs?)→Promise<void>` (throws after fully rolling back on failure).

- [ ] **Step 1: Write the failing tests**

Append to `tests/updater-fs.test.js`:

```javascript
function makeLive(root) {
  const live = path.join(root, 'DropComp');
  FS.DIRS.forEach((d) => { FS.mkdirpSync(path.join(live, d)); fs.writeFileSync(path.join(live, d, 'v.txt'), 'OLD-' + d); });
  return live;
}
function makeStaged(root) {
  const staged = path.join(root, 'staged', 'DropComp-9.9.9');
  FS.DIRS.forEach((d) => { FS.mkdirpSync(path.join(staged, d)); fs.writeFileSync(path.join(staged, d, 'v.txt'), 'NEW-' + d); });
  return staged;
}

test('backup zips the live dir once and skips if it already exists', async () => {
  const root = tmp();
  const live = makeLive(root);
  const zip = path.join(root, 'backup-2.4.0.zip');
  await FS.backup(live, zip);
  assert.ok(fs.existsSync(zip) && fs.statSync(zip).size > 0);
  const mtime = fs.statSync(zip).mtimeMs;
  await FS.backup(live, zip); // second call is a no-op
  assert.equal(fs.statSync(zip).mtimeMs, mtime);
  FS.rmrf(root);
});

test('applyMacSwap replaces all three dirs with the staged content', async () => {
  const root = tmp();
  const live = makeLive(root);
  const staged = makeStaged(root);
  await FS.applyMacSwap(live, staged);
  FS.DIRS.forEach((d) => assert.equal(fs.readFileSync(path.join(live, d, 'v.txt'), 'utf8'), 'NEW-' + d));
  FS.DIRS.forEach((d) => assert.equal(fs.existsSync(path.join(live, d + '.dcold')), false, '.dcold cleaned'));
  FS.rmrf(root);
});

test('applyMacSwap rolls every dir back when a later move fails', async () => {
  const root = tmp();
  const live = makeLive(root);
  const staged = makeStaged(root);
  FS.rmrf(path.join(staged, 'jsx')); // 3rd move will fail (source gone)
  await assert.rejects(FS.applyMacSwap(live, staged));
  // all three original dirs restored, no .dcold left behind
  FS.DIRS.forEach((d) => assert.equal(fs.readFileSync(path.join(live, d, 'v.txt'), 'utf8'), 'OLD-' + d, d + ' restored'));
  FS.DIRS.forEach((d) => assert.equal(fs.existsSync(path.join(live, d + '.dcold')), false));
  FS.rmrf(root);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/updater-fs.test.js`
Expected: FAIL — `FS.backup is not a function`.

- [ ] **Step 3: Add `backup` and `applyMacSwap`**

In `panel/js/updater-fs.js`, add inside the IIFE:

```javascript
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
      for (let j = i; j >= 0; j--) {
        const s = steps[j];
        if (!s) continue;
        try { if (s.movedIn && fs.existsSync(s.live)) { rmrf(s.live, fs); s.movedIn = false; } } catch (e2) {}
        try { if (s.movedAside && fs.existsSync(s.old)) { fs.renameSync(s.old, s.live); s.movedAside = false; } } catch (e3) {}
      }
      throw e;
    }
  }
```

Add `backup` and `applyMacSwap` to the returned object.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/updater-fs.test.js`
Expected: PASS (13 tests) — including the rollback test proving the live tree is restored exactly.

- [ ] **Step 5: Commit**

```bash
git add panel/js/updater-fs.js tests/updater-fs.test.js
git commit -m "$(cat <<'EOF'
feat(updater): add backup + macOS atomic-ish swap with rollback

backup() zips the live install once into Documents. applyMacSwap() moves
each code dir aside (.dcold) and moves the staged one in; any failure
reverses every move so the live install is restored intact. Covered by a
forced-failure rollback test.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `updater-fs.js` Windows apply helper + status + cleanup

The Windows path (apply after AE closes), the status file both platforms use, and boot-time recovery/cleanup.

**Files:**
- Modify: `panel/js/updater-fs.js`
- Modify: `tests/updater-fs.test.js`

**Interfaces:**
- Produces: `buildWindowsApplyScript({liveDir,stagedRoot,backupZip,statusFile,version})→string`; `spawnWindowsHelper(paths, stagedRoot, version, _deps?)→Promise<void>`; `writeStatus(statusFile,obj,_fs?)→Promise<void>`; `readStatus(statusFile,_fs?)→obj|null`; `cleanupStale(paths,_fs?)→Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/updater-fs.test.js`:

```javascript
test('buildWindowsApplyScript embeds escaped paths, waits for AE, swaps, and writes status', () => {
  const s = FS.buildWindowsApplyScript({
    liveDir: "C:\\Users\\O'Neil\\ext\\DropComp", stagedRoot: 'C:\\stage\\DropComp-9.9.9',
    backupZip: 'C:\\b.zip', statusFile: 'C:\\s.json', version: '2.5.0'
  });
  assert.match(s, /O''Neil/, "single quotes doubled for PowerShell");
  assert.match(s, /AfterFX/, 'waits for After Effects to close');
  assert.match(s, /Move-Item/);
  assert.match(s, /\.dcold/);
  assert.match(s, /catch/, 'has a rollback catch');
  assert.match(s, /"ok"/);
  assert.match(s, /"fail"/);
  FS.DIRS.forEach((d) => assert.ok(s.includes('"' + d + '"'), d + ' referenced'));
});

test('spawnWindowsHelper writes the script + pending status and spawns detached', async () => {
  const root = tmp();
  const p = FS.paths(path.join(root, 'DropComp'), 'win32', root, '2.4.0');
  FS.mkdirpSync(p.liveDir);
  let spawned = null;
  const fakeCp = { spawn: (cmd, args, opts) => { spawned = { cmd, args, opts }; return { unref: () => {} }; } };
  await FS.spawnWindowsHelper(p, 'C:\\stage\\DropComp-9.9.9', '2.5.0', { cp: fakeCp });
  assert.equal(spawned.cmd, 'powershell.exe');
  assert.ok(spawned.args.includes('-File'));
  assert.equal(spawned.opts.detached, true);
  assert.ok(fs.existsSync(path.join(p.workDir, 'apply.ps1')));
  assert.equal(FS.readStatus(p.statusFile).state, 'pending');
  FS.rmrf(root);
});

test('cleanupStale recovers an interrupted swap and clears leftovers', async () => {
  const root = tmp();
  const p = FS.paths(path.join(root, 'DropComp'), 'darwin', root, '2.4.0');
  FS.mkdirpSync(p.liveDir);
  // CSXS swapped but .dcold not cleaned; panel interrupted (live missing, .dcold present)
  FS.mkdirpSync(path.join(p.liveDir, 'CSXS')); FS.mkdirpSync(path.join(p.liveDir, 'CSXS.dcold'));
  FS.mkdirpSync(path.join(p.liveDir, 'panel.dcold')); fs.writeFileSync(path.join(p.liveDir, 'panel.dcold', 'v.txt'), 'OLD');
  FS.mkdirpSync(p.stagingDir);
  await FS.cleanupStale(p);
  assert.equal(fs.existsSync(path.join(p.liveDir, 'CSXS.dcold')), false, 'leftover .dcold removed');
  assert.equal(fs.readFileSync(path.join(p.liveDir, 'panel', 'v.txt'), 'utf8'), 'OLD', 'interrupted dir restored');
  assert.equal(fs.existsSync(p.stagingDir), false, 'staging cleared');
  FS.rmrf(root);
});

test('cleanupStale leaves things alone while a Windows apply is pending', async () => {
  const root = tmp();
  const p = FS.paths(path.join(root, 'DropComp'), 'win32', root, '2.4.0');
  FS.mkdirpSync(p.liveDir); FS.mkdirpSync(path.join(p.liveDir, 'CSXS.dcold'));
  await FS.writeStatus(p.statusFile, { state: 'pending', version: '2.5.0' });
  await FS.cleanupStale(p);
  assert.ok(fs.existsSync(path.join(p.liveDir, 'CSXS.dcold')), 'pending apply not disturbed');
  FS.rmrf(root);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/updater-fs.test.js`
Expected: FAIL — `FS.buildWindowsApplyScript is not a function`.

- [ ] **Step 3: Add the Windows helper, status, and cleanup**

In `panel/js/updater-fs.js`, add inside the IIFE:

```javascript
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
```

Add `buildWindowsApplyScript`, `spawnWindowsHelper`, `writeStatus`, `readStatus`, `cleanupStale` to the returned object.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/updater-fs.test.js`
Expected: PASS (17 tests).

- [ ] **Step 5: Commit**

```bash
git add panel/js/updater-fs.js tests/updater-fs.test.js
git commit -m "$(cat <<'EOF'
feat(updater): add Windows post-quit apply helper + status/cleanup

buildWindowsApplyScript emits a PowerShell that waits for AE to close then
does the same move-aside swap with rollback. spawnWindowsHelper stages it
detached and writes a pending status. cleanupStale recovers an interrupted
swap on boot and clears leftovers (but never while an apply is pending).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `updater.js` orchestration (`runUpdate`)

The state machine that wires the helper steps together with the correct ordering, verification gate, and platform branch. Unit-tested with a mocked helper (the real helper is integration-tested in Tasks 3–6).

**Files:**
- Modify: `panel/js/updater.js`
- Modify: `tests/updater.test.js`

**Interfaces:**
- Consumes: the helper interface from `updater-fs.js` (injected as `ctx.fs`), `DCUpdate.isNewer`.
- Produces: `DCUpdater.runUpdate(ctx)→Promise<{mode,version}>` where `ctx = {fs, paths, platform, localVersion, release?, apiUrl?, onProgress?}`. Throws `Error` (with `.userMessage` for controller-level failures).

- [ ] **Step 1: Write the failing tests**

Append to `tests/updater.test.js`:

```javascript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/updater.test.js`
Expected: FAIL — `DCUpdater.runUpdate is not a function`.

- [ ] **Step 3: Add `runUpdate` to `updater.js`**

In `panel/js/updater.js`, add inside the IIFE (before the `return`):

```javascript
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
```

Add `runUpdate: runUpdate` to the returned object.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/updater.test.js`
Expected: PASS (10 tests total in this file).

- [ ] **Step 5: Run the whole suite (no regressions)**

Run: `npm test`
Expected: PASS — all suites green, including `update.test.js` (VERSION pin unchanged), `jsx.es3`, `jsx.exports`.

- [ ] **Step 6: Commit**

```bash
git add panel/js/updater.js tests/updater.test.js
git commit -m "$(cat <<'EOF'
feat(updater): add runUpdate orchestration

Sequences fetch -> download -> verify -> extract -> sanity -> backup ->
apply, with the verify gate before any backup/apply and a mac/win branch at
apply. Unit-tested with a mocked helper: step order, verify-failure abort,
URL rejection, and not-newer short-circuit.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Update modal markup + styles + script tags

The UI shell. DOM/CSS only — verified via the panel, not `node --test`. Keep edits in the chip/modal region of these shared files.

**Files:**
- Modify: `panel/index.html` (add modal before `<div id="loading-spinner">`; add two script tags after `update.js`)
- Modify: `panel/css/style.css` (append)

**Interfaces:**
- Produces: DOM ids consumed by `updater.js` in Task 9: `update-modal`, `update-modal-title`, `update-notes`, `update-progress`, `update-progress-label`, `update-progress-bar`, `update-error`, `update-actions`, `update-now-btn`, `update-later-btn`, `update-github-btn`, `update-done-actions`, `update-done-btn`.

- [ ] **Step 1: Add the modal markup**

In `panel/index.html`, immediately before `<div id="loading-spinner" class="hidden"></div>` (currently line 290), insert:

```html
<div id="update-modal" class="modal-overlay hidden">
  <div class="modal-box">
    <h3 id="update-modal-title">Update available</h3>
    <div id="update-notes" class="update-notes"></div>
    <div id="update-progress" class="update-progress hidden">
      <div class="update-progress-label" id="update-progress-label">Starting…</div>
      <div class="update-progress-track"><div class="update-progress-bar" id="update-progress-bar"></div></div>
    </div>
    <p id="update-error" class="update-error hidden"></p>
    <div class="modal-buttons" id="update-actions">
      <button class="btn-dark" id="update-later-btn">Later</button>
      <button class="btn-dark" id="update-github-btn">View on GitHub</button>
      <button class="btn-gold" id="update-now-btn">Update now</button>
    </div>
    <div class="modal-buttons hidden" id="update-done-actions">
      <button class="btn-gold" id="update-done-btn">Got it</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add the script tags**

In `panel/index.html`, the script block (currently lines 293–310): immediately after `<script src="js/update.js"></script>` insert:

```html
<script src="js/updater-fs.js"></script>
<script src="js/updater.js"></script>
```

- [ ] **Step 3: Append the styles**

At the end of `panel/css/style.css`, append:

```css
/* ---- self-updater modal ---- */
.update-notes {
  max-height: 180px; overflow-y: auto; font-size: 12px; line-height: 1.5;
  color: var(--text-mid); white-space: pre-wrap; margin: 0 0 14px;
  background: var(--bg-inset); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 10px;
}
.update-progress { margin: 4px 0 14px; }
.update-progress-label { font-size: 12px; color: var(--text-mid); margin-bottom: 6px; }
.update-progress-track { height: 6px; background: var(--bg-inset); border-radius: 3px; overflow: hidden; }
.update-progress-bar { height: 100%; width: 0; background: var(--gold); transition: width 0.2s ease; }
.update-error {
  font-size: 12px; color: var(--danger); background: var(--bg-inset);
  border: 1px solid var(--border); border-radius: var(--radius); padding: 10px; margin: 0 0 14px;
}
```

- [ ] **Step 4: Verify the panel still parses (harness)**

Run: `node --test` (sanity: no test references these ids yet, suite stays green)
Expected: PASS. Visual check happens in Task 11 (live AE). The markup reuses existing `.modal-overlay`/`.modal-box`/`.btn-*` classes, so it inherits the established modal styling.

- [ ] **Step 5: Commit**

```bash
git add panel/index.html panel/css/style.css
git commit -m "$(cat <<'EOF'
feat(updater): add update modal markup, styles, and script tags

Reuses the existing modal-overlay/modal-box/btn classes; adds a notes pane,
a progress bar, and an error line. Loads updater-fs.js + updater.js after
update.js. Scoped to the chip/modal area of these shared files.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Wire the chip → modal in `main.js` (with self-disable + boot status)

Replace the chip's open-URL handler with the modal, initialize the updater, and on boot show an "updated" toast + clean up leftovers. If Node is unavailable, everything falls back to today's behavior.

**Files:**
- Modify: `panel/js/main.js:126-139` (the version-label + chip block) and append the updater UI controller to `panel/js/updater.js`.

**Interfaces:**
- Consumes: `DCUpdater.hasNode`, `DCUpdater.init`, `DCUpdater.setLatest`, `DCUpdater.open`, `DCUpdater.onBoot`; `DCUpdate.RELEASES_PAGE`, `DCUpdate.VERSION`.
- Produces: a working chip that opens the modal (Node on) or the releases page (Node off).

- [ ] **Step 1: Add the UI controller to `updater.js`**

In `panel/js/updater.js`, add inside the IIFE (before the `return`). This is the DOM layer (not unit-tested; exercised live):

```javascript
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
          : 'Restart After Effects to finish — you’ll be on ' + r.version + '. Your work and library are safe.';
        $('update-done-actions').classList.remove('hidden');
      })
      .catch(function (err) {
        _running = false;
        $('update-progress').classList.add('hidden');
        $('update-actions').classList.remove('hidden');
        const e = $('update-error');
        e.textContent = (err && err.userMessage ? err.userMessage : 'The update couldn’t be completed.') + ' Your current version is safe and unchanged. Use “View on GitHub” to download it manually.';
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
        if (window.DCUI) DCUI.toast('Update didn’t finish — you’re still on ' + DCUpdate.VERSION + '. Nothing was changed.', true, 6000);
        DCUpdaterFS.writeStatus(_paths.statusFile, { state: 'idle' });
      }
      DCUpdaterFS.cleanupStale(_paths);
    } catch (e) {}
  }
```

Add `init`, `setLatest`, `open`, `onBoot` to the returned object.

- [ ] **Step 2: Rewire the chip in `main.js`**

In `panel/js/main.js`, replace the block at lines 126–139:

```javascript
  // version labels come from the single DCUpdate.VERSION constant
  $('app-version').textContent = DCUpdate.VERSION.replace(/\.\d+$/, '');
  $('settings-version').textContent = 'DropComp ' + DCUpdate.VERSION;

  // free update notice: GitHub latest-release check, throttled, silent on failure
  var updateChip = $('update-chip');
  updateChip.addEventListener('click', function () {
    csInterface.openURLInDefaultBrowser(DCUpdate.RELEASES_PAGE);
  });
  DCUpdate.check(window.localStorage, Date.now(), function (latest) {
    if (!latest) return;
    updateChip.textContent = 'Update ' + String(latest).replace(/^v/, '');
    updateChip.classList.remove('hidden');
  });
```

with:

```javascript
  // version labels come from the single DCUpdate.VERSION constant
  $('app-version').textContent = DCUpdate.VERSION.replace(/\.\d+$/, '');
  $('settings-version').textContent = 'DropComp ' + DCUpdate.VERSION;

  // one-click self-updater; falls back to opening the releases page when Node
  // is unavailable (older runtime / manifest didn't take) so the chip never breaks
  var updateChip = $('update-chip');
  var nodeAvailable = DCUpdater.hasNode(typeof require !== 'undefined' ? require : undefined);
  DCUpdater.init({ csInterface: csInterface, storage: window.localStorage, nodeAvailable: nodeAvailable });
  updateChip.addEventListener('click', function () {
    if (nodeAvailable) DCUpdater.open();
    else csInterface.openURLInDefaultBrowser(DCUpdate.RELEASES_PAGE);
  });
  DCUpdate.check(window.localStorage, Date.now(), function (latest) {
    if (!latest) return;
    updateChip.textContent = 'Update ' + String(latest).replace(/^v/, '');
    updateChip.classList.remove('hidden');
    DCUpdater.setLatest(latest);
  });
  DCUpdater.onBoot();
```

- [ ] **Step 3: Run the suite (no regressions)**

Run: `npm test`
Expected: PASS — all green. (`main.js`/`updater.js` DOM paths aren't unit-tested; the pure + orchestration tests still pass.)

- [ ] **Step 4: Commit**

```bash
git add panel/js/main.js panel/js/updater.js
git commit -m "$(cat <<'EOF'
feat(updater): wire the chip to the modal with self-disable + boot status

Chip opens the update modal when Node is available, else falls back to the
releases page (today's behavior) — so it can never regress. On boot, show an
"updated"/"didn't finish" toast from the status file and clean up any
leftover swap state.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: README — Updates section + rollout note

**Files:**
- Modify: `README.md` (the `## Updates` section, lines ~60–75)

**Interfaces:** docs only.

- [ ] **Step 1: Rewrite the Updates section**

In `README.md`, replace the `## Updates` section body (the lines describing "Clicking it opens the download page; installing is the same one-click installer." and the release steps note) with:

```markdown
## Updates

The panel checks GitHub's latest release (at most every 12 h, silent offline)
and shows a gold "Update x.y.z" chip in the header when a newer version exists.

Click the chip → **What's new** → **Update now**, and the panel updates itself:
it downloads the release from GitHub, verifies it (size + SHA-256 + unzip
check), backs up your current install to `~/Documents/DropComp/backup-<version>.zip`
(Windows: `%USERPROFILE%\Documents\DropComp\`), swaps in the new files, and asks
you to restart After Effects. Your library folder, favorites, and settings are
never touched. If anything fails, your current version is left intact and the
chip still offers a manual download.

- **macOS:** the swap happens immediately — restart AE to finish.
- **Windows:** files in use can't be replaced while AE runs, so the update is
  staged and applied automatically the moment you quit AE; reopen AE to finish.

**Rollout:** one-click self-update works from the first release that contains it
onward. If you're on an older build, install the next release once with the
manual installer (`install.command` / `install.bat`); every update after that is
one-click.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs: document the one-click self-updater and rollout

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Enable Node in the manifest + manual live verification

The enabling change, a guard test that it's present (and the version pin is untouched), and the manual end-to-end test on macOS plus the Windows release gate.

**Files:**
- Modify: `CSXS/manifest.xml:23` (the empty `<CEFCommandLine />`)
- Modify: `tests/updater.test.js` (append a manifest guard test)
- Create: `docs/superpowers/verification/2026-06-18-self-updater.md`

**Interfaces:**
- Produces: Node-enabled panel; a source test asserting the CEF flags + unchanged version.

- [ ] **Step 1: Write the failing manifest guard test**

Append to `tests/updater.test.js`:

```javascript
const fs = require('node:fs');
const path = require('node:path');

test('manifest enables Node (mixed-context) and keeps the version pinned', () => {
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'CSXS', 'manifest.xml'), 'utf8');
  assert.match(manifest, /--enable-nodejs/, 'nodejs not enabled');
  assert.match(manifest, /--mixed-context/, 'mixed-context not set');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.match(manifest, new RegExp('ExtensionBundleVersion="' + pkg.version.replace(/\./g, '\\.') + '"'), 'version must stay pinned');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/updater.test.js`
Expected: FAIL — `nodejs not enabled`.

- [ ] **Step 3: Populate `<CEFCommandLine>`**

In `CSXS/manifest.xml:23`, replace:

```xml
          <CEFCommandLine />
```

with:

```xml
          <CEFCommandLine>
            <Parameter>--enable-nodejs</Parameter>
            <Parameter>--mixed-context</Parameter>
          </CEFCommandLine>
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS — the manifest guard passes and `update.test.js`'s version-pin test still passes (version attributes unchanged).

- [ ] **Step 5: Commit**

```bash
git add CSXS/manifest.xml tests/updater.test.js
git commit -m "$(cat <<'EOF'
feat(updater): enable Node.js (mixed-context) in the CEP manifest

Adds --enable-nodejs --mixed-context so the panel can download/unzip/copy
files for the self-updater. Version attributes left unchanged (release is
sequenced separately). Guard test asserts the flags + the pinned version.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Live macOS smoke test — panel still loads with Node on**

Get this branch into AE (`./dev-link.command`), restart AE, open `Window → Extensions → DropComp`. Confirm: the panel loads normally, all tabs work, and the console (right-click → Inspect, or the CEP debug port) shows no errors. With `--mixed-context`, `module` is now defined in the panel — confirm the existing modules (which guard `module.exports`) still initialize. If the panel fails to load, STOP and debug before continuing (this is the riskiest change).

- [ ] **Step 7: Live macOS end-to-end self-update**

Build a real *older* test build to update FROM: temporarily set a lower `VERSION` in a throwaway local copy is NOT needed — instead, create a real prior release tag in a fork/test repo OR point `API_URL` at a test release. Simplest: with the current install reporting `2.4.0`, ensure a newer real release (e.g. the published `2.4.0`+ or a test `9.9.9` release asset) is visible to the chip, then click **Update now** and verify the full flow: progress runs, backup zip appears at `~/Documents/DropComp/backup-2.4.0.zip`, the three code dirs are swapped, and after restarting AE the panel reports the new version. Then confirm the library folder + favorites are untouched.

- [ ] **Step 8: Record results + Windows release gate**

Create `docs/superpowers/verification/2026-06-18-self-updater.md`:

```markdown
# Self-Updater — Manual Verification

Date: 2026-06-18
AE version: 26.2x49 (After Effects 2026), macOS

| Check | Result |
|---|---|
| Panel loads with --enable-nodejs --mixed-context, no console errors | PASS / FAIL |
| Existing modules initialize (module.exports guard harmless) | PASS / FAIL |
| Chip → modal shows version + release notes | PASS / FAIL |
| Update now: progress runs through download→verify→backup→install | PASS / FAIL |
| backup-<ver>.zip written to ~/Documents/DropComp/ | PASS / FAIL |
| Code dirs swapped; new version reported after restart | PASS / FAIL |
| Library folder, library_path.txt, favorites untouched | PASS / FAIL |
| Failure path (e.g. network off mid-download): live version intact + manual fallback shown | PASS / FAIL |

## Windows — RELEASE GATE (must pass before shipping the release that contains the updater)

Run on a real Windows machine with AE installed:

| Check | Result |
|---|---|
| Panel loads with Node enabled, no errors | PASS / FAIL |
| Update now stages, prompts "quit & reopen AE" | PASS / FAIL |
| Quitting AE triggers the helper; files swap; status → ok | PASS / FAIL |
| Reopen AE: new version reported; backup zip in %USERPROFILE%\Documents\DropComp | PASS / FAIL |
| Forced failure rolls back; live version intact | PASS / FAIL |

Notes:
```

Fill in PASS/FAIL. The Windows table stays open until verified on Windows (a friend's machine); the release containing this updater must not ship until it passes.

- [ ] **Step 9: Commit**

```bash
git add docs/superpowers/verification/2026-06-18-self-updater.md
git commit -m "$(cat <<'EOF'
docs(updater): add manual verification log + Windows release gate

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**1. Spec coverage**

| Spec section | Task |
|---|---|
| §1 confirm-once-then-auto flow | Task 9 (modal: notes + Update now → progress) |
| §1 backup to ~/Documents/DropComp/backup-<ver>.zip | Task 2 (paths), Task 5 (backup) |
| §1 prompt-only restart (never quit AE) | Task 9 (done message), Task 6 (win helper waits for user to quit) |
| §1 verify sha256 + size + unzip | Task 1 (verifyDecision), Task 4 (sha256File/extract), Task 7 (gate) |
| §1/§3 apply: mac swap-now / win post-quit | Task 5 (applyMacSwap), Task 6 (win helper), Task 7 (branch) |
| §4.1 manifest --enable-nodejs --mixed-context (no version bump) | Task 11 |
| §4.2 updater.js controller (<400) | Tasks 1, 7, 9 |
| §4.3 updater-fs.js I/O boundary (<400) | Tasks 2–6 |
| §4.4 main.js chip→modal, index.html, style.css | Tasks 8, 9 |
| §4.5 README | Task 10 |
| §5 flow / progress / status-on-boot | Tasks 7, 9 |
| §6 never-brick (verify+backup before swap, rollback) | Task 5 (rollback test), Task 7 (ordering) |
| §6 self-disable when no Node | Task 1 (hasNode), Task 9 (fallback) |
| §6 HTTPS + GitHub allowlist | Task 1 (isAllowedUrl), Task 3 (hop check) |
| §6 never touch user data | All file ops scoped to liveDir + backupZip; asserted by tests in Tasks 5–6 |
| §6 no duplicate-manifest (staging outside extensions/, .dcold inside DropComp) | Task 2 (paths: staging under Documents), Task 5/6 (.dcold inside liveDir) |
| §6 re-runnable / interrupted-swap recovery | Task 6 (cleanupStale) |
| §6 12h throttle preserved | Task 9 (DCUpdate.check unchanged) |
| §7 unit + integration tests, Windows generator test + release gate | Tasks 1–7 (tests), Task 6 (generator), Task 11 (gate) |
| §8 out of scope | Honored — no auto-quit, no signing, no delta, no downgrade UI |
| §9 rollout note | Task 10 |

No gaps.

**2. Placeholder scan:** Every code step shows complete code; every command has expected output. PASS/FAIL cells in the verification log are intended fill-in data, not plan placeholders. No "TBD"/"handle edge cases"/"similar to Task N".

**3. Type consistency:**
- `DCUpdaterFS.paths(...)` returns `{liveDir, extensionsRoot, backupDir, backupZip, workDir, stagingDir, tmpZip, statusFile}` (Task 2) — consumed with those exact keys in Tasks 6, 7, 9.
- Helper method names match between definition and use: `fetchLatestRelease`, `download`, `fileSize`, `sha256File`, `extract`, `assertStagedTree`, `backup`, `applyMacSwap`, `spawnWindowsHelper`, `writeStatus`, `readStatus`, `cleanupStale` — defined in Tasks 2–6, called identically in `runUpdate` (Task 7) and the UI (Task 9) and the mocked helper (Task 7 tests).
- `runUpdate(ctx)` `ctx` shape `{fs, paths, platform, localVersion, release?, apiUrl?, onProgress}` is consistent between Task 7 tests and Task 9's call site.
- `DIRS = ['CSXS','panel','jsx']` defined once (Task 2), used in Tasks 4, 5, 6 and both test files.
- `onProgress(phase, pct)` phases (`fetch/download/verify/extract/backup/apply/staged/done`) emitted in Task 7 match the `LABELS` map in Task 9.
- DOM ids in Task 8 markup match every `$('...')` in Task 9.
- `verifyDecision` `{ok, reason}` with `reason ∈ {'size','checksum',''}` consistent between Task 1 and Task 7.
