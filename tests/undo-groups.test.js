const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const hostSrc = fs.readFileSync(path.join(__dirname, '..', 'jsx', 'hostscript.jsx'), 'utf8');
const captureSrc = fs.readFileSync(path.join(__dirname, '..', 'jsx', 'import-capture.jsx'), 'utf8');

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

test('importComp keeps project import outside the explicit undo group', () => {
  const body = sectionBetween(hostSrc, 'function importComp', '// ---------- thumbnails ----------');
  const importIndex = body.indexOf('app.project.importFile(new ImportOptions(fileToImport))');
  const undoIndex = body.indexOf("app.beginUndoGroup('DropComp Import')");

  assert.notEqual(importIndex, -1, 'importComp should import the AEP project');
  assert.notEqual(undoIndex, -1, 'importComp should still group post-import timeline changes');
  assert.ok(
    importIndex < undoIndex,
    'AE project import must happen before DropComp opens its explicit undo group'
  );
});

// Field report: "Undo group mismatch, will attempt to fix" on every external
// aep add. captureCompInfo (the add-external-aep capture path) still imported
// INSIDE its undo group after importComp got the fix.
test('captureCompInfo keeps project import outside the explicit undo group', () => {
  const body = sectionBetween(captureSrc, 'function captureCompInfo', 'function pickAepFile');
  const importIndex = body.indexOf('app.project.importFile(new ImportOptions(f))');
  const undoIndex = body.indexOf("app.beginUndoGroup('DropComp Capture')");

  assert.notEqual(importIndex, -1, 'captureCompInfo should import the AEP project');
  assert.notEqual(undoIndex, -1, 'captureCompInfo should still group its cleanup edits');
  assert.ok(
    importIndex < undoIndex,
    'AE project import must happen before DropComp opens its explicit undo group'
  );
});

test('captureCompInfo closes the undo group only when it actually opened one', () => {
  const body = sectionBetween(captureSrc, 'function captureCompInfo', 'function pickAepFile');
  const catchBody = body.slice(body.indexOf('} catch (e) {'));
  assert.match(
    catchBody,
    /if \(undoing\) app\.endUndoGroup\(\)/,
    'captureCompInfo catch path must guard endUndoGroup with the undoing flag'
  );
});

// Shape assets import the saved .aep the same way - same undo-corruption trap.
const shapesSrc = fs.readFileSync(path.join(__dirname, '..', 'jsx', 'shapes.jsx'), 'utf8');

test('importShapeAsset keeps project import outside the explicit undo group', () => {
  const body = sectionBetween(shapesSrc, 'function importShapeAsset', '// ---- exports');
  const importIndex = body.indexOf('app.project.importFile(new ImportOptions(f))');
  const undoIndex = body.indexOf("app.beginUndoGroup('DropComp Import Shape')");

  assert.notEqual(importIndex, -1, 'importShapeAsset should import the AEP project');
  assert.notEqual(undoIndex, -1, 'importShapeAsset should group its edits');
  assert.ok(
    importIndex < undoIndex,
    'AE project import must happen before DropComp opens its explicit undo group'
  );
});

test('importShapeAsset closes the undo group only when it actually opened one', () => {
  const body = sectionBetween(shapesSrc, 'function importShapeAsset', '// ---- exports');
  const catchBody = body.slice(body.lastIndexOf('} catch (e) {'));
  assert.match(
    catchBody,
    /if \(undoing\) app\.endUndoGroup\(\)/,
    'importShapeAsset catch path must guard endUndoGroup with the undoing flag'
  );
});
