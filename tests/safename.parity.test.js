const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// The panel computes rename targets (state.js safeName) that must land on the
// exact folder names the host writes (hostscript.jsx safeNameJsx). The plan
// declares the sanitizer chain "must be byte-identical" across both sides -
// lock the regex chain itself, not just sample outputs.
const CHAIN = /\.replace\(\/\[\^a-z0-9\]\/gi,\s*'_'\)\.replace\(\/_\{2,\}\/g,\s*'_'\)/;

test('panel safeName and host safeNameJsx use the identical sanitizer chain', () => {
  const stateSrc = read('panel/js/state.js');
  const hostSrc = read('jsx/hostscript.jsx');

  const stateMatch = stateSrc.match(CHAIN);
  const hostMatch = hostSrc.match(CHAIN);
  assert.ok(stateMatch, 'state.js safeName chain not found or changed');
  assert.ok(hostMatch, 'hostscript.jsx safeNameJsx chain not found or changed');
  assert.equal(stateMatch[0], hostMatch[0], 'sanitizer chains differ between panel and host');
});

test('host-side rename re-validation mirrors DCValidate rules', () => {
  const hostSrc = read('jsx/hostscript.jsx');
  const fnBody = hostSrc.slice(
    hostSrc.indexOf('function renameStashedComp'),
    hostSrc.indexOf('function', hostSrc.indexOf('function renameStashedComp') + 10)
  );
  assert.match(fnBody, /\[<>:"\\\/\\\\\|\?\*/, 'invalid-char check missing in renameStashedComp');
  assert.match(fnBody, /CON\|PRN\|AUX\|NUL/, 'reserved-name check missing in renameStashedComp');
});
