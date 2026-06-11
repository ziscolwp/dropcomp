const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', 'jsx', p), 'utf8');
const relinkSrc = read('relink.jsx');
const hostSrc = read('hostscript.jsx');

// hostscript loads relink.jsx with $.evalFile INSIDE loadHostModules(). Per ES3
// eval semantics, declarations land in that function's local scope and vanish
// when it returns - so every top-level function must be exported to $.global
// explicitly or it is undefined at call time (the collectMissingFootage bug).
test('every top-level function in relink.jsx is exported to $.global', () => {
  const declared = [...relinkSrc.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)]
    .map((m) => m[1]);
  assert.ok(declared.length > 0, 'expected top-level functions in relink.jsx');
  for (const name of declared) {
    const exportRe = new RegExp(`\\$\\.global\\.${name}\\s*=\\s*${name}\\s*;`);
    assert.match(relinkSrc, exportRe, `${name} is declared but never exported to $.global`);
  }
});

test('loadHostModules verifies the exports actually landed before reporting ok', () => {
  const fnBody = hostSrc.slice(
    hostSrc.indexOf('function loadHostModules'),
    hostSrc.indexOf('DC_MODULES_LOADED = true;')
  );
  assert.match(
    fnBody,
    /typeof \$\.global\.collectMissingFootage/,
    'loadHostModules must check $.global.collectMissingFootage before setting DC_MODULES_LOADED'
  );
});

// relink helpers called by hostscript must all exist in relink.jsx - guards
// against renaming a helper in one file but not the other.
test('relink functions referenced by hostscript.jsx are defined in relink.jsx', () => {
  const used = ['collectMissingFootage', 'collectFilesRecursive', 'relinkItems', 'relinkProjectFootage', 'absorbHealedFootage'];
  for (const name of used) {
    assert.ok(hostSrc.includes(name + '('), `expected hostscript.jsx to call ${name}`);
    assert.match(relinkSrc, new RegExp(`^function\\s+${name}\\s*\\(`, 'm'), `${name} missing from relink.jsx`);
  }
});
