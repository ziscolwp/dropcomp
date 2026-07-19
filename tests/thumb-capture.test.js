const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const hostSrc = fs.readFileSync(path.join(__dirname, '..', 'jsx', 'hostscript.jsx'), 'utf8');
const captureSrc = fs.readFileSync(path.join(__dirname, '..', 'jsx', 'import-capture.jsx'), 'utf8');

function sectionBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  assert.notEqual(start, -1, `${startNeedle} missing`);
  const end = src.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `${endNeedle} missing after ${startNeedle}`);
  return src.slice(start, end);
}

const PNG_SIG = '\x89PNG\r\n\x1a\n';
const PNG_TAIL = '\x00\x00\x00\x00IEND\xAE\x42\x60\x82';

function makePngContent(totalBytes) {
  const fillerLen = totalBytes - PNG_SIG.length - PNG_TAIL.length;
  return PNG_SIG + 'x'.repeat(fillerLen) + PNG_TAIL;
}

// Simulates AE's asynchronous saveFrameToPng writer: the file appears
// immediately and grows by `rate` bytes per simulated millisecond each time
// the host script calls $.sleep. Content only ends with IEND once fully written.
function loadThumbEngine() {
  const disk = new Map(); // path -> current content string
  const jobs = []; // { path, content, written, rate }
  const state = { raceDetected: false, saveCalls: 0 };

  function advance(ms) {
    for (const job of jobs) {
      if (job.written >= job.content.length) continue;
      job.written = Math.min(job.content.length, job.written + job.rate * ms);
      disk.set(job.path, job.content.slice(0, Math.floor(job.written)));
    }
  }

  function FakeFile(p) {
    this.fsName = p;
    this._pos = 0;
    this.encoding = 'BINARY';
    Object.defineProperty(this, 'exists', { get: () => disk.has(p) });
    Object.defineProperty(this, 'length', {
      get: () => (disk.has(p) ? disk.get(p).length : 0),
    });
  }
  FakeFile.prototype.remove = function () {
    if (!disk.has(this.fsName)) return false;
    disk.delete(this.fsName);
    return true;
  };
  FakeFile.prototype.open = function () {
    this._pos = 0;
    return disk.has(this.fsName);
  };
  FakeFile.prototype.seek = function (pos, mode) {
    const len = disk.has(this.fsName) ? disk.get(this.fsName).length : 0;
    if (mode === 2) this._pos = len - pos; // ExtendScript: backward from end
    else if (mode === 1) this._pos += pos;
    else this._pos = pos;
    return true;
  };
  FakeFile.prototype.read = function (count) {
    const content = disk.get(this.fsName) || '';
    const out = content.substr(this._pos, count);
    this._pos += out.length;
    return out;
  };
  FakeFile.prototype.close = function () {
    return true;
  };

  const context = {
    $: { global: {}, sleep: (ms) => advance(ms) },
    File: FakeFile,
  };
  vm.createContext(context);
  const section = sectionBetween(
    hostSrc,
    '// ---------- thumbnails ----------',
    '// ---------- stash ----------'
  );
  vm.runInContext(section, context, { filename: 'hostscript.jsx#thumbnails' });

  function makeComp(renderPlan) {
    // renderPlan: (time, file) -> { content, rate } for the fake writer
    return {
      workAreaStart: 0,
      workAreaDuration: 10,
      saveFrameToPng(time, file) {
        state.saveCalls += 1;
        const inFlight = jobs.some(
          (j) => j.path === file.fsName && j.written < j.content.length
        );
        if (inFlight) state.raceDetected = true;
        const plan = renderPlan(time, file);
        disk.set(file.fsName, '');
        jobs.push({ path: file.fsName, content: plan.content, written: 0, rate: plan.rate });
      },
    };
  }

  return { context, disk, state, makeComp, FakeFile };
}

test('saveVerifiedThumb only reports success once the png is fully written', () => {
  const engine = loadThumbEngine();
  // 200KB png, written over ~5 seconds - well past the file-exists threshold
  const full = makePngContent(200000);
  const comp = engine.makeComp(() => ({ content: full, rate: 40 }));
  const png = new engine.FakeFile('/lib/cat/item/comp.png');

  const ok = engine.context.$.global.saveVerifiedThumb
    ? engine.context.$.global.saveVerifiedThumb(comp, png)
    : engine.context.saveVerifiedThumb(comp, png);

  assert.equal(ok, true, 'a render that completes should report success');
  const written = engine.disk.get('/lib/cat/item/comp.png') || '';
  assert.ok(
    written.endsWith(PNG_TAIL),
    `thumbnail must be complete when saveVerifiedThumb returns (got ${written.length} of ${full.length} bytes)`
  );
});

test('saveVerifiedThumb never starts a second render over an in-flight write', () => {
  const engine = loadThumbEngine();
  // slow dribble: stays under 1KB for several seconds, completes at ~16.7s
  const full = makePngContent(5000);
  const comp = engine.makeComp(() => ({ content: full, rate: 0.3 }));
  const png = new engine.FakeFile('/lib/cat/item/comp.png');

  const ok = engine.context.saveVerifiedThumb(comp, png);

  assert.equal(
    engine.state.raceDetected,
    false,
    'saveFrameToPng must not be called again while a previous write to the same path is in flight'
  );
  assert.equal(ok, true, 'a slow but successful render should still land');
  const written = engine.disk.get('/lib/cat/item/comp.png') || '';
  assert.ok(written.endsWith(PNG_TAIL), 'thumbnail must be complete when accepted');
});

test('saveVerifiedThumb fails and scrubs the file when the writer dies partway', () => {
  const engine = loadThumbEngine();
  // writer emits 500 bytes then stops forever - never a valid png
  const truncated = makePngContent(100000).slice(0, 500);
  const comp = engine.makeComp(() => ({ content: truncated, rate: 40 }));
  const png = new engine.FakeFile('/lib/cat/item/comp.png');

  const ok = engine.context.saveVerifiedThumb(comp, png);

  assert.equal(ok, false, 'a truncated png must never count as a captured thumbnail');
  assert.equal(
    engine.disk.has('/lib/cat/item/comp.png'),
    false,
    'partial pngs must be scrubbed so the index/panel never picks them up'
  );
});

test('setThumbFromActiveComp verifies a complete png, not just any bytes', () => {
  const body = sectionBetween(captureSrc, 'function setThumbFromActiveComp', '// ---- exports');
  assert.doesNotMatch(
    body,
    /waitForFile\(/,
    'setThumbFromActiveComp must not use the size-threshold wait (accepts half-written files)'
  );
  assert.match(
    body,
    /watchPngWrite|pngIsComplete/,
    'setThumbFromActiveComp must verify png completeness (signature + IEND)'
  );
});

test('index entries only record a thumbPath the capture actually verified', () => {
  const addBody = sectionBetween(captureSrc, 'function addExternalAep', 'function generateThumbForItem');
  assert.match(
    addBody,
    /thumbPath:\s*\(?\s*info\.ok\s*&&\s*info\.thumbOk/,
    'addExternalAep must gate thumbPath on the capture verdict, not bare file existence'
  );
  const genBody = sectionBetween(captureSrc, 'function generateThumbForItem', 'function setThumbFromActiveComp');
  assert.match(
    genBody,
    /thumbPath:\s*\(?\s*info\.thumbOk/,
    'generateThumbForItem must gate thumbPath on the capture verdict'
  );
  const stashBody = sectionBetween(hostSrc, 'function stashSelectedComp', '// ---------- transactional rename');
  assert.match(
    stashBody,
    /thumbPath:\s*\(?\s*thumbOk/,
    'stashSelectedComp must gate thumbPath on the capture verdict'
  );
});
