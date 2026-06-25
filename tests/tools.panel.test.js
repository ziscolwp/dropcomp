const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const panelHtml = fs.readFileSync(path.join(__dirname, '..', 'panel', 'index.html'), 'utf8');
const toolsJs = fs.readFileSync(path.join(__dirname, '..', 'panel', 'js', 'tools.js'), 'utf8');

test('Tools tab exposes timing adjustment modes with Amount and Step controls', () => {
  assert.match(panelHtml, /<span class="tool-label">Amount<\/span>/);
  assert.match(panelHtml, /id="tools-step"[^>]+aria-label="Step in frames"/);
  for (const mode of ['align', 'sequence', 'reverse', 'random']) {
    assert.match(
      panelHtml,
      new RegExp(`data-tool="adjust-time" data-arg="${mode}"`),
      `missing adjust-time ${mode} button`
    );
  }
});

test('Tools tab dispatches timing modes to tlAdjustTiming', () => {
  assert.match(toolsJs, /tool === 'adjust-time'/);
  assert.match(toolsJs, /run\('adjust timing', 'tlAdjustTiming', \[amount, stepFrames, arg\]\)/);
  assert.match(toolsJs, /fn === 'tlSequence' \|\| fn === 'tlAdjustTiming'/);
});
