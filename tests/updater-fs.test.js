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
