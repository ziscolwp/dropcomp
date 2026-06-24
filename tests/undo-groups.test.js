const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const hostSrc = fs.readFileSync(path.join(__dirname, '..', 'jsx', 'hostscript.jsx'), 'utf8');

function sectionBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  assert.notEqual(start, -1, `${startNeedle} missing`);
  const end = src.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `${endNeedle} missing after ${startNeedle}`);
  return src.slice(start, end);
}

test('importComp closes its undo group when import fails after opening it', () => {
  const body = sectionBetween(hostSrc, 'function importComp', '// ---------- thumbnails ----------');
  const catchBody = body.slice(body.lastIndexOf('} catch (e) {'));

  assert.match(body, /app\.beginUndoGroup\('DropComp Import'\)/);
  assert.match(
    catchBody,
    /app\.endUndoGroup\(\)/,
    'importComp catch path must close DropComp Import to avoid AE undo group mismatch warnings'
  );
});
