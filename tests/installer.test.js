// bug-016: the Mac install path relied on a double-clickable install.command
// (and an unsigned .pkg attempt), both of which Gatekeeper blocks for unsigned
// developers. The supported path is now a Terminal one-liner (install.sh),
// which is never quarantined.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('install.sh is a safe curl|bash installer', () => {
  const sh = read('install.sh');
  assert.match(sh, /^#!\/bin\/bash/, 'bash shebang');
  assert.match(sh, /set -euo pipefail/, 'fails fast');
  assert.match(sh, /api\.github\.com\/repos\/\$REPO\/releases\/latest/, 'resolves the latest release');
  assert.match(sh, /archive\/refs\/tags\/\$TAG\.zip/, 'falls back to the source archive');
  assert.match(sh, /for CSXS_VERSION in 8 9 10 11 12/, 'enables PlayerDebugMode for every CSXS AE uses');
  assert.match(sh, /xattr -dr com\.apple\.quarantine/, 'strips quarantine attributes');
  assert.match(sh, /zip -rq "\$BACKUP"/, 'backs up a previous copy-install');
  assert.match(sh, /\[ ! -L "\$DEST" \]/, 'leaves symlinked dev installs alone before backup');
  assert.doesNotMatch(sh, /sudo/, 'user-level install, no sudo');
  assert.match(sh, /DROPCOMP_DEST/, 'destination is overridable for tests');
  const mode = fs.statSync(path.join(__dirname, '..', 'install.sh')).mode;
  assert.ok(mode & 0o111, 'install.sh is executable');
});

test('install.command is version-agnostic and clears quarantine', () => {
  const cmd = read('install.command');
  assert.doesNotMatch(cmd, /\d+\.\d+\.\d+/, 'no hardcoded version strings to go stale');
  assert.match(cmd, /for CSXS_VERSION in 8 9 10 11 12/);
  assert.match(cmd, /xattr -dr com\.apple\.quarantine/);
  assert.match(cmd, /backup-\$\(date/, 'timestamped backups');
});

test('the release zip ships both installers', () => {
  const build = read('scripts/build-dist.sh');
  assert.match(build, /install\.bat install\.command install\.sh/, 'install.sh is packaged');
});

test('the README leads with the Terminal one-liner', () => {
  const readme = read('README.md');
  assert.match(readme, /curl -fsSL https:\/\/raw\.githubusercontent\.com\/ziscolwp\/dropcomp\/main\/install\.sh \| bash/);
});
