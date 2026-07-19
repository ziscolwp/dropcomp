const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const indexHtml = read('panel/index.html');
// _harness.html is gitignored (local dev file) - assert on it only when present
const harnessPath = path.join(__dirname, '..', 'panel', '_harness.html');
const harnessHtml = fs.existsSync(harnessPath) ? fs.readFileSync(harnessPath, 'utf8') : null;
const shellSrc = read('panel/js/shell.js');
const mainSrc = read('panel/js/main.js');

test('html shells load sections.js after state.js and before library.js', () => {
  [indexHtml, harnessHtml].filter(Boolean).forEach((html) => {
    const stateAt = html.indexOf('js/state.js');
    const sectionsAt = html.indexOf('js/sections.js');
    const libraryAt = html.indexOf('js/library.js');
    assert.ok(sectionsAt !== -1, 'sections.js script tag missing');
    assert.ok(stateAt < sectionsAt && sectionsAt < libraryAt, 'sections.js in wrong order');
  });
});

test('shell routes the section category-modal mode to the library', () => {
  assert.match(shellSrc, /mode === 'section'/);
  assert.match(shellSrc, /DCLibrary\.confirmAddToSection/);
});

test('shell exposes renameSection and deleteSection passthroughs', () => {
  assert.match(shellSrc, /function renameSection\(/);
  assert.match(shellSrc, /DCLibrary\.renameSectionFlow/);
  assert.match(shellSrc, /function deleteSection\(/);
  assert.match(shellSrc, /DCLibrary\.deleteSectionFlow/);
});

test('shell forwards the card section context', () => {
  assert.match(shellSrc, /onCardAction\(action, uniqueId, category, section\)/);
});

test('main routes section header actions and card section datasets', () => {
  assert.match(mainSrc, /renameSection/);
  assert.match(mainSrc, /deleteSection/);
  assert.match(mainSrc, /dataset\.section/);
  assert.match(mainSrc, /DCSections\.collapseKey/);
});
