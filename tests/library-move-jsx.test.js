const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readMoveModule() {
  return fs.readFileSync(path.join(__dirname, '..', 'jsx', 'library-move.jsx'), 'utf8');
}

test('moveStashedComp copies the item folder, patches index paths, and relinks footage', () => {
  const src = readMoveModule();
  const moveBody = src.slice(src.indexOf('function moveStashedComp'));

  assert.match(src, /function\s+copyFolderRecursive\s*\(/);
  assert.match(src, /function\s+isInvalidMovePathPart\s*\(/);
  assert.match(moveBody, /isInvalidMovePathPart\(uniqueId\)/);
  assert.match(moveBody, /copyFolderRecursive\(oldFolder,\s*movedFolder\)/);
  assert.match(moveBody, /removeFolderRecursive\(oldFolder\)/);
  assert.match(moveBody, /updateIndexPatchComp\(libraryPath,\s*category,\s*uniqueId,\s*\{/);
  assert.match(moveBody, /category:\s*targetCategory/);
  assert.match(moveBody, /aepPath:\s*aeps\.length\s*\?\s*aeps\[0\]\.fsName\s*:\s*null/);
  assert.match(moveBody, /thumbPath:\s*thumb\.exists\s*\?\s*thumb\.fsName\s*:\s*null/);
  assert.match(moveBody, /relinkProjectFootage\(oldFolder\.fsName,\s*movedFolder\.fsName\)/);
  assert.match(src, /\$\.global\.moveStashedComp\s*=\s*moveStashedComp;/);
});
