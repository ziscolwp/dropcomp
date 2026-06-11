const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'jsx', 'assets.jsx'), 'utf8');

// renameAsset must re-check names host-side with the same rules as DCValidate.
test('renameAsset mirrors DCValidate invalid-chars and reserved-name rules', () => {
  const fnBody = src.slice(
    src.indexOf('function renameAsset'),
    src.indexOf('function', src.indexOf('function renameAsset') + 10)
  );
  assert.match(fnBody, /\[<>:"\\\/\\\\\|\?\*/, 'invalid-char check missing in renameAsset');
  assert.match(fnBody, /CON\|PRN\|AUX\|NUL/, 'reserved-name check missing in renameAsset');
  assert.match(fnBody, /length > 200/, 'max-length check missing in renameAsset');
});
