const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function functionBody(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} function must exist`);
  const exportStart = src.indexOf(`$.global.${name} = ${name};`, start);
  assert.notEqual(exportStart, -1, `${name} must export to $.global`);
  return src.slice(start, exportStart);
}

test('tlMatchCompLength extends every layer to the active comp duration', () => {
  const src = read('jsx/tools.jsx');
  const body = functionBody(src, 'tlMatchCompLength');

  assert.match(body, /tlActiveComp\(\)/, 'uses the active composition');
  assert.match(body, /Open a composition first\./, 'reports the standard no-comp error');
  assert.match(body, /app\.beginUndoGroup\('DropComp Match Comp Length'\)/, 'opens a named undo group');
  assert.match(body, /for\s*\(\s*var\s+i\s*=\s*1\s*;\s*i\s*<=\s*comp\.numLayers\s*;\s*i\+\+\s*\)/, 'walks the full layer stack, not only selected layers');
  assert.match(body, /var\s+layer\s*=\s*comp\.layer\(i\)/, 'reads each timeline layer by index');
  assert.match(body, /layer\.outPoint\s*=\s*comp\.duration/, 'sets each out-point to the comp duration');
  assert.match(body, /"count":'\s*\+\s*count/, 'returns the number of changed layers');
});

test('Tools panel exposes Match Length in the pre-comp group', () => {
  const html = read('panel/index.html');
  const toolsJs = read('panel/js/tools.js');

  assert.match(toolsJs, /matchLength:\s*'tlMatchCompLength'/, 'pre-comp router maps matchLength to tlMatchCompLength');
  assert.match(toolsJs, /tlMatchCompLength/, 'success copy knows the match-length command');
  assert.match(html, /data-tool="precomp"\s+data-arg="matchLength"/, 'button routes through the pre-comp tool handler');
  assert.match(html, />Match Length<\/span>/, 'button label fits the pre-comp grid');
  assert.match(html, /active comp length|active comp's duration/i, 'button tooltip explains the target duration');
});
