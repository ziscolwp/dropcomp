const test = require('node:test');
const assert = require('node:assert/strict');
const DCBridge = require('../panel/js/bridge.js');

test('escapes backslashes FIRST, then quotes and control chars', () => {
  assert.equal(DCBridge.escapeForEvalScript('a\\b'), 'a\\\\b');
  assert.equal(DCBridge.escapeForEvalScript('say "hi"'), 'say \\"hi\\"');
  assert.equal(DCBridge.escapeForEvalScript("it's"), "it\\'s");
  assert.equal(DCBridge.escapeForEvalScript('line1\nline2\tend'), 'line1\\nline2\\tend');
  assert.equal(DCBridge.escapeForEvalScript(null), '');
  assert.equal(DCBridge.escapeForEvalScript(undefined), '');
});

test('buildCall quotes and joins arguments', () => {
  assert.equal(DCBridge.buildCall('fn', ['a', 'b']), 'fn("a", "b")');
  assert.equal(DCBridge.buildCall('fn', []), 'fn()');
  assert.equal(DCBridge.buildCall('fn'), 'fn()');
  assert.equal(DCBridge.buildCall('fn', ['pa"th']), 'fn("pa\\"th")');
  assert.equal(DCBridge.buildCall('fn', [42]), 'fn("42")');
});

test('parseJson returns null for non-JSON host responses', () => {
  assert.deepEqual(DCBridge.parseJson('{"ok":true}'), { ok: true });
  assert.equal(DCBridge.parseJson('Error: nope'), null);
  assert.equal(DCBridge.parseJson(''), null);
  assert.equal(DCBridge.parseJson(undefined), null);
});

test('lock is exclusive and reports the running operation', () => {
  assert.equal(DCBridge.acquire('stash'), true);
  assert.equal(DCBridge.acquire('delete'), false);
  assert.equal(DCBridge.busyWith(), 'stash');
  DCBridge.release();
  assert.equal(DCBridge.busyWith(), false);
  assert.equal(DCBridge.acquire('delete'), true);
  DCBridge.release();
});

// A module function that failed to load at boot makes CEP return the literal
// 'EvalScript error.'. The bridge reloads host modules once and retries so a
// broken boot self-heals instead of surfacing an opaque error toast.
test('call retries once through loadHostModules on EvalScript error', () => {
  const scripts = [];
  const results = ['EvalScript error.', 'ok', '{"ok":true}'];
  DCBridge.init({ evalScript: (script, cb) => { scripts.push(script); cb(results.shift()); } }, '/ext/root');
  let final = null;
  DCBridge.call('addExternalAep', ['lib', 'cat', 'file.aep'], (r) => { final = r; });
  assert.deepEqual(scripts, [
    'addExternalAep("lib", "cat", "file.aep")',
    'loadHostModules("/ext/root")',
    'addExternalAep("lib", "cat", "file.aep")',
  ]);
  assert.equal(final, '{"ok":true}');
});

test('call does not retry forever when the reload cannot fix the function', () => {
  const scripts = [];
  DCBridge.init({ evalScript: (script, cb) => { scripts.push(script); cb('EvalScript error.'); } }, '/ext/root');
  let final = null;
  DCBridge.call('brokenFn', [], (r) => { final = r; });
  // original call + one reload + one retry, whose failure passes through
  assert.equal(scripts.length, 3);
  assert.equal(final, 'EvalScript error.');
});

test('call without an extension path passes the raw error through untouched', () => {
  const scripts = [];
  DCBridge.init({ evalScript: (script, cb) => { scripts.push(script); cb('EvalScript error.'); } });
  let final = null;
  DCBridge.call('fn', [], (r) => { final = r; });
  assert.equal(scripts.length, 1);
  assert.equal(final, 'EvalScript error.');
});
