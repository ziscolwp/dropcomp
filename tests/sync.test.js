const test = require('node:test');
const assert = require('node:assert/strict');

function freshSyncModule() {
  const modulePath = require.resolve('../panel/js/sync.js');
  delete require.cache[modulePath];
  return require(modulePath);
}

function fakeCsInterface() {
  return {
    listeners: {},
    dispatched: [],
    addEventListener(type, fn) { this.listeners[type] = fn; },
    dispatchEvent(ev) { this.dispatched.push(ev); },
    emit(type, event) { this.listeners[type](event); },
  };
}

test('decode accepts string payloads, object payloads, rejects garbage', () => {
  const DCSync = freshSyncModule();
  assert.deepEqual(
    DCSync.decode('{"kind":"library","sender":"com.DropComp.ext"}'),
    { kind: 'library', sender: 'com.DropComp.ext' }
  );
  assert.deepEqual(
    DCSync.decode({ kind: 'prefs', sender: 'com.DropComp.tools' }),
    { kind: 'prefs', sender: 'com.DropComp.tools' }
  );
  assert.equal(DCSync.decode('not json {'), null);
  assert.equal(DCSync.decode(null), null);
  assert.equal(DCSync.decode(undefined), null);
  assert.equal(DCSync.decode('{"kind":"evil","sender":"x"}'), null);
  assert.equal(DCSync.decode('{"kind":"library"}'), null);
  assert.equal(DCSync.decode('{"sender":"x"}'), null);
  assert.equal(DCSync.decode(42), null);
});

test('init routes remote events to the handler and ignores own events', () => {
  const DCSync = freshSyncModule();
  const cs = fakeCsInterface();
  const seen = [];
  DCSync.init(cs, 'com.DropComp.library', (kind) => seen.push(kind));

  cs.emit(DCSync.EVENT_TYPE, { data: '{"kind":"assets","sender":"com.DropComp.ext"}' });
  cs.emit(DCSync.EVENT_TYPE, { data: '{"kind":"library","sender":"com.DropComp.library"}' }); // own
  cs.emit(DCSync.EVENT_TYPE, { data: 'garbage' });
  cs.emit(DCSync.EVENT_TYPE, {}); // no data
  cs.emit(DCSync.EVENT_TYPE, { data: '{"kind":"prefs","sender":"com.DropComp.tools"}' });

  assert.deepEqual(seen, ['assets', 'prefs']);
});

test('broadcast dispatches a JSON payload stamped with the sender id', () => {
  const DCSync = freshSyncModule();
  const cs = fakeCsInterface();
  DCSync.init(cs, 'com.DropComp.assets', () => {});
  DCSync.broadcast('assets');

  assert.equal(cs.dispatched.length, 1);
  const ev = cs.dispatched[0];
  assert.equal(ev.type, DCSync.EVENT_TYPE);
  assert.equal(ev.scope, 'APPLICATION');
  assert.equal(ev.extensionId, 'com.DropComp.assets');
  assert.deepEqual(JSON.parse(ev.data), { kind: 'assets', sender: 'com.DropComp.assets' });
});

test('broadcast is a safe no-op before init and for invalid kinds', () => {
  const DCSync = freshSyncModule();
  assert.doesNotThrow(() => DCSync.broadcast('library')); // before init
  const cs = fakeCsInterface();
  DCSync.init(cs, 'com.DropComp.ext', () => {});
  DCSync.broadcast('not-a-kind');
  assert.equal(cs.dispatched.length, 0);
});
