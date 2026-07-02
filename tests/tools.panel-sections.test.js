// feat-013: the Tools tab's middle block mixed two unlabeled tool families
// (timing and align/distribute) as bare icon rows. Each family now sits in a
// labeled section, matching the anchor/create/pre-comp visual language.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

function toolsSection(html) {
  const start = html.indexOf('<section id="tools">');
  const end = html.indexOf('</section>', start);
  assert.notEqual(start, -1, 'tools section exists');
  return html.slice(start, end);
}

// _harness.html mirrors this markup but is gitignored (local dev only), so
// only the tracked panel markup is asserted here.
for (const file of ['panel/index.html']) {
  test(`timing and align tools are labeled sections in ${file}`, () => {
    const tools = toolsSection(read(file));

    const sections = tools.match(/class="tool-section"[^>]*/g) || [];
    assert.equal(sections.length, 2, 'the inset holds two labeled sections');
    assert.match(tools, /<div class="tool-section"[^>]*>\s*<div class="tool-label">timing<\/div>/,
      'timing section is labeled');
    assert.match(tools, /<div class="tool-section"[^>]*>\s*<div class="tool-label">align &amp; distribute<\/div>/,
      'align/distribute section is labeled');

    // the timing section owns Amount/Step, the 4 time modes, and the hint
    const timing = tools.slice(tools.indexOf('>timing<'), tools.indexOf('align &amp; distribute'));
    assert.match(timing, /id="tools-num"/);
    assert.match(timing, /id="tools-step"/);
    assert.equal((timing.match(/data-tool="adjust-time"/g) || []).length, 4);
    assert.match(timing, /class="tool-hint"/);

    // the align section owns align/distribute/reset
    const align = tools.slice(tools.indexOf('align &amp; distribute'));
    assert.equal((align.match(/data-tool="align"/g) || []).length, 6);
    assert.equal((align.match(/data-tool="distribute"/g) || []).length, 2);
    assert.equal((align.match(/data-tool="reset"/g) || []).length, 1);
  });

  test(`no tool buttons were lost in ${file}`, () => {
    const tools = toolsSection(read(file));
    assert.equal((tools.match(/data-tool="anchor"/g) || []).length, 9);
    assert.equal((tools.match(/data-tool="create"/g) || []).length, 4);
    assert.equal((tools.match(/data-tool="adjust-time"/g) || []).length, 4);
    assert.equal((tools.match(/data-tool="align"/g) || []).length, 6);
    assert.equal((tools.match(/data-tool="distribute"/g) || []).length, 2);
    assert.equal((tools.match(/data-tool="reset"/g) || []).length, 1);
    assert.equal((tools.match(/data-tool="precomp"/g) || []).length, 5);
  });
}

test('tool sections have a grouping style', () => {
  const css = read('panel/css/style.css');
  const m = /\.tool-section\s*\{([^}]*)\}/.exec(css);
  assert.ok(m, '.tool-section rule exists');
  assert.match(m[1], /flex-direction:\s*column/);
});

// feat-013 follow-up: the four timing modes were bare 16px glyphs behind
// tooltips. They are now labeled buttons, and the remaining icon row gets a
// larger, clearer hit target.
test('timing modes are labeled buttons, not bare glyphs', () => {
  const tools = toolsSection(read('panel/index.html'));
  const timing = tools.slice(tools.indexOf('>timing<'), tools.indexOf('align &amp; distribute'));
  for (const label of ['Playhead', 'Sequence', 'Reverse', 'Random']) {
    assert.match(timing, new RegExp('<span>' + label + '</span>'), label + ' has a visible label');
  }
  assert.doesNotMatch(timing, /class="tool-icon"/, 'no unlabeled icon buttons remain in the timing section');
  assert.equal((timing.match(/class="tool-btn"/g) || []).length, 4, 'all four modes use the labeled button style');
});

test('align/distribute icons have larger, clearer targets', () => {
  const css = read('panel/css/style.css');
  const btn = /\.tool-icon\s*\{([^}]*)\}/.exec(css);
  assert.ok(btn, '.tool-icon rule exists');
  assert.match(btn[1], /height:\s*3[4-9]px/, 'taller touch target');
  const svg = /\.tool-icon svg\s*\{([^}]*)\}/.exec(css);
  assert.match(svg[1], /width:\s*18px/, 'larger glyph');
});
