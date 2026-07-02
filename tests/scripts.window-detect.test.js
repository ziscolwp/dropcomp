// bug-012: ScriptUI scripts must not surprise-launch a floating window. Window
// creation is detected up front (panel heuristic for snippets, host guard for
// files) and routed to the in-panel notice instead.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const core = require('../panel/js/scripts-core.js');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// ---- panel heuristic --------------------------------------------------------

test('detectsWindow recognises ScriptUI window construction', () => {
  assert.equal(core.detectsWindow('var w = new Window("palette", "Tools");'), true);
  assert.equal(core.detectsWindow("var d = new  Window('dialog');"), true);
  assert.equal(core.detectsWindow('app.beginUndoGroup("x"); alert("done");'), false);
  assert.equal(core.detectsWindow('var windowish = newWindowish("no");'), false);
  assert.equal(core.detectsWindow(''), false);
  assert.equal(core.detectsWindow(null), false);
});

test('runMode routes window-creating snippets to the in-panel notice', () => {
  const body = 'var w = new Window("palette", "T"); w.show();';
  assert.equal(core.runMode({ source: 'snippet', body, params: [] }), 'windowNotice');
  // an in-panel form still wins: DC_PARAMS is the supported fallback
  assert.equal(core.runMode({ source: 'snippet', body, params: [{ key: 'x' }] }), 'params');
  // file sources are guarded host-side (the panel cannot read the file)
  assert.equal(core.runMode({ source: 'file', path: '/a.jsx', params: [] }), 'direct');
  assert.equal(core.runMode({ source: 'snippet', body: 'alert(1);', params: [] }), 'direct');
});

// ---- host guard -------------------------------------------------------------

function createHarness(seedFiles = {}) {
  const files = new Map();
  const evaled = [];

  function makeFile(filePath, content = '') {
    const normalized = String(filePath);
    const file = {
      fsName: normalized,
      name: path.basename(normalized),
      exists: true,
      content,
      parent: { exists: true, execute() {} },
      remove() { this.exists = false; files.delete(normalized); return true; },
    };
    files.set(normalized, file);
    return file;
  }

  function File(filePath) {
    const normalized = String(filePath);
    if (files.has(normalized)) return files.get(normalized);
    return makeFile(normalized, '');
  }

  for (const [filePath, content] of Object.entries(seedFiles)) makeFile(filePath, content);

  const context = {
    $: {
      global: {},
      os: 'Mac',
      evalFile(file) {
        evaled.push(file.content);
        vm.runInContext(file.content, context, { filename: file.fsName });
      },
    },
    File,
    Folder: { temp: { fsName: '/tmp' } },
    Date,
    alert() {},
    jerr(m) { return JSON.stringify({ ok: false, error: String(m) }); },
    jsonEscape(v) { return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); },
    readTextFile(file) { return file.content; },
    writeTextFile(file, src) {
      file.content = String(src);
      file.exists = true;
      files.set(file.fsName, file);
      return true;
    },
  };

  vm.createContext(context);
  vm.runInContext(read('jsx/scripts.jsx'), context, { filename: 'scripts.jsx' });
  return { context, evaled };
}

test('scRunFile refuses a .jsx that builds a ScriptUI window', () => {
  const { context, evaled } = createHarness({
    '/scripts/palette.jsx': 'var w = new Window("palette", "My Tools"); w.show();',
  });

  const r = JSON.parse(context.$.global.scRunFile('/scripts/palette.jsx'));

  assert.equal(r.ok, false);
  assert.equal(r.windowScript, true, 'flags the refusal so the panel can show the notice');
  assert.match(r.error, /window/i);
  assert.equal(evaled.length, 0, 'the script must not run');
});

test('scRunFile still runs ordinary scripts', () => {
  const { context, evaled } = createHarness({
    '/scripts/plain.jsx': '$.global.RAN = true;',
  });

  const r = JSON.parse(context.$.global.scRunFile('/scripts/plain.jsx'));

  assert.equal(r.ok, true);
  assert.equal(evaled.length, 1);
  assert.equal(context.$.global.RAN, true);
});

test('scRunSnippet refuses a window-creating snippet', () => {
  const { context, evaled } = createHarness();

  const r = JSON.parse(context.$.global.scRunSnippet('var w = new Window("dialog"); w.show();'));

  assert.equal(r.ok, false);
  assert.equal(r.windowScript, true);
  assert.equal(evaled.length, 0);
});

test('params runs stay unguarded - DC_PARAMS is the supported in-panel path', () => {
  const { context } = createHarness({
    '/scripts/paramscript.jsx': 'if (!$.global.DC_PARAMS) { var w = new Window("palette"); } $.global.SAW = $.global.DC_PARAMS.n;',
  });

  const r = JSON.parse(context.$.global.scRunFileWithParams('/scripts/paramscript.jsx', '{"n":9}'));

  assert.equal(r.ok, true);
  assert.equal(context.$.global.SAW, 9);
});

// ---- panel wiring -----------------------------------------------------------

test('the panel turns a host windowScript refusal into the in-panel notice', () => {
  const src = read('panel/js/scripts.js');
  assert.match(src, /windowScript/, 'runScript inspects the refusal flag');
  assert.match(src, /windowScript[\s\S]{0,120}toggleWindowNotice/, 'refusal shows the window notice, not a bare toast');
});
