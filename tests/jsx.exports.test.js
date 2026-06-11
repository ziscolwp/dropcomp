const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', 'jsx', p), 'utf8');
const hostSrc = read('hostscript.jsx');

// hostscript loads these with $.evalFile INSIDE loadHostModules(). Per ES3
// eval semantics, declarations land in that function's local scope and vanish
// when it returns - so every top-level function must be exported to $.global
// explicitly or it is undefined at call time (the collectMissingFootage bug).
const LOADED_MODULES = ['relink.jsx', 'assets.jsx'];
const MARKERS = ['collectMissingFootage', 'getAssets'];

for (const mod of LOADED_MODULES) {
  test(`every top-level function in ${mod} is exported to $.global`, () => {
    const src = read(mod);
    const declared = [...src.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map((m) => m[1]);
    assert.ok(declared.length > 0, `expected top-level functions in ${mod}`);
    for (const name of declared) {
      const exportRe = new RegExp(`\\$\\.global\\.${name}\\s*=\\s*${name}\\s*;`);
      assert.match(src, exportRe, `${name} is declared but never exported to $.global`);
    }
  });
}

test('loadHostModules verifies the exports actually landed before reporting ok', () => {
  // marker names live in the DC_MODULE_MARKERS array; the loader loop checks each
  const loaderRegion = hostSrc.slice(
    hostSrc.indexOf('var DC_MODULE_MARKERS'),
    hostSrc.indexOf('DC_MODULES_LOADED = true;')
  );
  for (const marker of MARKERS) {
    assert.match(
      loaderRegion,
      new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `loadHostModules must check ${marker} before setting DC_MODULES_LOADED`
    );
  }
  assert.match(
    loaderRegion,
    /typeof \$\.global\[DC_MODULE_MARKERS\[i\]\] !== 'function'/,
    'loadHostModules must typeof-check each module marker on $.global'
  );
});

// relink helpers called by hostscript must all exist in relink.jsx - guards
// against renaming a helper in one file but not the other.
test('relink functions referenced by hostscript.jsx are defined in relink.jsx', () => {
  const relinkSrc = read('relink.jsx');
  const used = ['collectMissingFootage', 'collectFilesRecursive', 'relinkItems', 'relinkProjectFootage', 'absorbHealedFootage'];
  for (const name of used) {
    assert.ok(hostSrc.includes(name + '('), `expected hostscript.jsx to call ${name}`);
    assert.match(relinkSrc, new RegExp(`^function\\s+${name}\\s*\\(`, 'm'), `${name} missing from relink.jsx`);
  }
});
