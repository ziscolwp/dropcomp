const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const FS = require('../panel/js/updater-fs.js');
const DCUpdaterAllow = require('../panel/js/updater.js').isAllowedUrl;

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

test('download rejects when the response stream errors mid-transfer', async () => {
  const root = tmp();
  const dest = path.join(root, 'out.zip');
  // Build a fake https that returns a 200 response, delivers one chunk, then
  // emits 'error' on the response stream before completion.
  const fakeHttpsMidError = {
    get(_url, _opts, cb) {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.headers = { 'content-length': '10' };
      res.setEncoding = () => {};
      res.resume = () => {};
      // pipe: write one chunk then emit res 'error' via setImmediate so the
      // write stream exists before the error fires.
      res.pipe = (out) => { out.write(Buffer.from('abc')); };
      const req = new EventEmitter();
      req.setTimeout = () => {};
      req.destroy = () => {};
      setImmediate(() => {
        cb(res);
        setImmediate(() => res.emit('error', new Error('ECONNRESET mid-transfer')));
      });
      return req;
    }
  };
  await assert.rejects(
    FS.download('https://github.com/dl', dest, null, () => true, fakeHttpsMidError),
    /ECONNRESET/);
  FS.rmrf(root);
});

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

test('applyMacSwap recovers when a cross-volume (EXDEV) move-in fails mid-copy', async () => {
  const root = tmp();
  const live = makeLive(root);     // OLD-<d> in CSXS/panel/jsx (v.txt)
  const staged = makeStaged(root); // NEW-<d>
  FS.DIRS.forEach((d) => fs.writeFileSync(path.join(staged, d, 'extra.txt'), 'NEW2-' + d)); // 2nd file so copy makes >1 write
  const realFs = require('node:fs');
  let writes = 0;
  const wrapFs = Object.assign({}, realFs, {
    renameSync(src, dest) {
      // force the move-IN (src under staged) down moveDir's EXDEV copy fallback;
      // allow move-aside (live -> .dcold) and the rollback restore (.dcold -> live)
      if (String(src).indexOf(staged) === 0) { const e = new Error('EXDEV'); e.code = 'EXDEV'; throw e; }
      return realFs.renameSync(src, dest);
    },
    writeFileSync(p, data) {
      writes++;
      if (writes === 2) throw new Error('disk full mid-copy'); // fail partway through copyDirRecursive
      return realFs.writeFileSync(p, data);
    }
  });
  await assert.rejects(FS.applyMacSwap(live, staged, wrapFs));
  FS.DIRS.forEach((d) => assert.equal(fs.readFileSync(path.join(live, d, 'v.txt'), 'utf8'), 'OLD-' + d, d + ' restored to OLD'));
  FS.DIRS.forEach((d) => assert.equal(fs.existsSync(path.join(live, d + '.dcold')), false, 'no .dcold for ' + d));
  FS.rmrf(root);
});

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
