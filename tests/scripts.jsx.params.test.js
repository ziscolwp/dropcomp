const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createHarness(seedFiles = {}) {
  const files = new Map();

  function makeFile(filePath, content = '') {
    const normalized = String(filePath);
    const file = {
      fsName: normalized,
      name: path.basename(normalized),
      exists: true,
      content,
      parent: { exists: true, execute() {} },
      remove() {
        this.exists = false;
        files.delete(normalized);
        return true;
      },
    };
    files.set(normalized, file);
    return file;
  }

  function File(filePath) {
    const normalized = String(filePath);
    if (files.has(normalized)) return files.get(normalized);
    return makeFile(normalized, '');
  }

  for (const [filePath, content] of Object.entries(seedFiles)) {
    makeFile(filePath, content);
  }

  const context = {
    $: {
      global: {},
      os: 'Mac',
      evalFile(file) {
        vm.runInContext(file.content, context, { filename: file.fsName });
      },
    },
    File,
    Folder: {
      temp: { fsName: '/tmp' },
    },
    jerr(message) {
      return JSON.stringify({ ok: false, error: String(message) });
    },
    jsonEscape(value) {
      return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    },
    readTextFile(file) {
      return file.content;
    },
    writeTextFile(file, src) {
      file.content = String(src);
      file.exists = true;
      files.set(file.fsName, file);
      return true;
    },
  };

  vm.createContext(context);
  const src = fs.readFileSync(path.join(__dirname, '..', 'jsx', 'scripts.jsx'), 'utf8');
  vm.runInContext(src, context, { filename: 'scripts.jsx' });
  return context;
}

test('scRunSnippetWithParams restores an existing DC_PARAMS value after run', () => {
  const context = createHarness();
  const previous = { keep: true };
  context.$.global.DC_PARAMS = previous;

  const result = JSON.parse(context.$.global.scRunSnippetWithParams(
    '$.global.SEEN_PARAMS = $.global.DC_PARAMS.count;',
    '{"count":7}'
  ));

  assert.equal(result.ok, true);
  assert.equal(context.$.global.SEEN_PARAMS, 7);
  assert.equal(context.$.global.DC_PARAMS, previous);
});

test('scRunFileWithParams clears DC_PARAMS after a user script throws', () => {
  const context = createHarness({
    '/scripts/fail.jsx': '$.global.SEEN_FILE_PARAM = $.global.DC_PARAMS.name; throw new Error("boom");',
  });

  const result = JSON.parse(context.$.global.scRunFileWithParams('/scripts/fail.jsx', '{"name":"drop"}'));

  assert.equal(result.ok, false);
  assert.equal(context.$.global.SEEN_FILE_PARAM, 'drop');
  assert.equal(Object.prototype.hasOwnProperty.call(context.$.global, 'DC_PARAMS'), false);
});
