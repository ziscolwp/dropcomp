# Multi-Panel DropComp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship standalone, dockable Library / Assets / Tools / Scripts panels alongside the existing all-in-one DropComp panel, with live sync between all open panels.

**Architecture:** One CEP extension bundle declares five `<Extension>` entries that all load the same `panel/index.html`; each panel picks its mode from `CSInterface.getExtensionID()` at boot. A new `DCSync` module broadcasts mutation events over CEP's cross-extension event bus so open panels stay consistent.

**Tech Stack:** Adobe CEP 8 (CSInterface), plain ES5-style panel JavaScript (IIFE modules, `var`), ExtendScript host, `node --test` for tests.

**Spec:** `docs/superpowers/specs/2026-07-15-multi-panel-design.md` (approved 2026-07-15).

## Global Constraints

- Branch: `feature/multi-panel`. Target release: 2.9.0, but **all files stay at version `2.8.2` in this plan** — the bump to 2.9.0 is a separate release-time commit outside this plan (repo convention).
- Extension IDs, verbatim: `com.DropComp.ext` (existing, unchanged), `com.DropComp.library`, `com.DropComp.assets`, `com.DropComp.tools`, `com.DropComp.scripts`.
- Panel mode names, verbatim: `'full' | 'library' | 'assets' | 'tools' | 'scripts'`. Unknown extension IDs map to `'full'`.
- Sync event type, verbatim: `com.dropcomp.changed`. Payload kinds: `'library' | 'assets' | 'scripts' | 'prefs' | 'path'`.
- Panel JS style: `var`, IIFE module pattern with `'use strict'`, trailing `if (typeof module !== 'undefined' && module.exports) { module.exports = <Name>; }` for node-tested modules. No ES6 syntax in `panel/js/` (matches every existing file).
- **Broadcasts fire only from mutation success paths.** Loads/refreshes never broadcast — a panel refreshing in response to an event must not emit another event (echo loop).
- **Standalone panels never persist `activeTab`** — localStorage is shared with the main panel.
- Test runner: `npm test` (runs `node --test "tests/**/*.test.js"`). All existing tests must stay green after every task.
- Files stay under 400 lines (all touched files are currently well under).
- Commits: conventional prefixes (`feat`, `docs`, `test`), imperative mood, each ending with the line `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Panel-mode helpers in `state.js`

**Files:**
- Modify: `panel/js/state.js` (insert before the `return {` block at line 195; add exports)
- Test: `tests/state.panel-mode.test.js` (create)

**Interfaces:**
- Produces: `DCState.panelModeFromExtensionId(id) -> string` (one of the five mode names), `DCState.panelModeTitle(mode) -> string` (header label, e.g. `'DropComp Tools'`), `DCState.savePrefsForMode(storage, prefs, mode) -> undefined` (persists prefs; in standalone modes first restores `activeTab` from storage so it is never clobbered).
- Consumes: existing `DCState.loadPrefs(storage)` / `DCState.savePrefs(storage, prefs)`.

- [ ] **Step 1: Write the failing test**

Create `tests/state.panel-mode.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const DCState = require('../panel/js/state.js');

test('panelModeFromExtensionId maps the four standalone ids', () => {
  assert.equal(DCState.panelModeFromExtensionId('com.DropComp.library'), 'library');
  assert.equal(DCState.panelModeFromExtensionId('com.DropComp.assets'), 'assets');
  assert.equal(DCState.panelModeFromExtensionId('com.DropComp.tools'), 'tools');
  assert.equal(DCState.panelModeFromExtensionId('com.DropComp.scripts'), 'scripts');
});

test('main and unknown extension ids fall back to full', () => {
  assert.equal(DCState.panelModeFromExtensionId('com.DropComp.ext'), 'full');
  assert.equal(DCState.panelModeFromExtensionId('com.Other.panel'), 'full');
  assert.equal(DCState.panelModeFromExtensionId(undefined), 'full');
  assert.equal(DCState.panelModeFromExtensionId(''), 'full');
});

test('panelModeTitle labels each mode, defaulting to DropComp', () => {
  assert.equal(DCState.panelModeTitle('full'), 'DropComp');
  assert.equal(DCState.panelModeTitle('library'), 'DropComp Library');
  assert.equal(DCState.panelModeTitle('assets'), 'DropComp Assets');
  assert.equal(DCState.panelModeTitle('tools'), 'DropComp Tools');
  assert.equal(DCState.panelModeTitle('scripts'), 'DropComp Scripts');
  assert.equal(DCState.panelModeTitle('nonsense'), 'DropComp');
});

function fakeStorage() {
  const store = {};
  return {
    getItem(k) { return k in store ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
    dump() { return store; },
  };
}

test('savePrefsForMode in full mode persists activeTab as-is', () => {
  const storage = fakeStorage();
  const prefs = DCState.defaultPrefs();
  prefs.activeTab = 'tools';
  DCState.savePrefsForMode(storage, prefs, 'full');
  assert.equal(JSON.parse(storage.dump().dropcomp_prefs).activeTab, 'tools');
});

test('savePrefsForMode in a standalone mode preserves the stored activeTab', () => {
  const storage = fakeStorage();
  // the main panel saved activeTab = 'scripts' after this standalone panel booted
  const mainPrefs = DCState.defaultPrefs();
  mainPrefs.activeTab = 'scripts';
  DCState.savePrefs(storage, mainPrefs);

  // the standalone panel holds a stale activeTab but changed the sort
  const standalonePrefs = DCState.defaultPrefs();
  standalonePrefs.activeTab = 'library';
  standalonePrefs.sort = 'name';
  DCState.savePrefsForMode(storage, standalonePrefs, 'library');

  const saved = JSON.parse(storage.dump().dropcomp_prefs);
  assert.equal(saved.activeTab, 'scripts', 'standalone save must not clobber activeTab');
  assert.equal(saved.sort, 'name', 'the real change must still persist');
});

test('savePrefsForMode in a standalone mode with empty storage keeps the default tab', () => {
  const storage = fakeStorage();
  const prefs = DCState.defaultPrefs();
  prefs.activeTab = 'assets';
  DCState.savePrefsForMode(storage, prefs, 'assets');
  assert.equal(JSON.parse(storage.dump().dropcomp_prefs).activeTab, 'library');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A2 "panel-mode"`
Expected: FAIL — `DCState.panelModeFromExtensionId is not a function`

- [ ] **Step 3: Write minimal implementation**

In `panel/js/state.js`, insert immediately after the `migrateMetadataKey` function (ends line 193) and before `return {`:

```js
  var PANEL_MODE_BY_EXTENSION_ID = {
    'com.DropComp.library': 'library',
    'com.DropComp.assets': 'assets',
    'com.DropComp.tools': 'tools',
    'com.DropComp.scripts': 'scripts'
  };

  var PANEL_MODE_TITLES = {
    library: 'DropComp Library',
    assets: 'DropComp Assets',
    tools: 'DropComp Tools',
    scripts: 'DropComp Scripts'
  };

  // Unknown/legacy ids (including the main com.DropComp.ext) fall back to the
  // full tabbed shell so a manifest/runtime mismatch can never brick a panel.
  function panelModeFromExtensionId(id) {
    return PANEL_MODE_BY_EXTENSION_ID[id] || 'full';
  }

  function panelModeTitle(mode) {
    return PANEL_MODE_TITLES[mode] || 'DropComp';
  }

  // Standalone panels share localStorage with the main panel; when they save
  // prefs they must not overwrite the main panel's remembered tab with the
  // stale value they booted with.
  function savePrefsForMode(storage, prefs, mode) {
    if (mode !== 'full') prefs.activeTab = loadPrefs(storage).activeTab;
    savePrefs(storage, prefs);
  }
```

Add to the `return {` export object (after `resolveActiveTab: resolveActiveTab,`):

```js
    panelModeFromExtensionId: panelModeFromExtensionId,
    panelModeTitle: panelModeTitle,
    savePrefsForMode: savePrefsForMode,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all tests PASS (including the 6 new ones).

- [ ] **Step 5: Commit**

```bash
git add tests/state.panel-mode.test.js panel/js/state.js
git commit -m "feat(panel): add panel-mode helpers to state

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `DCSync` cross-panel event module

**Files:**
- Create: `panel/js/sync.js`
- Test: `tests/sync.test.js` (create)

**Interfaces:**
- Produces: `DCSync.init(csInterface, extensionId, onRemoteChange)` (registers the CEP listener; `onRemoteChange(kind)` is called for events from *other* panels only), `DCSync.broadcast(kind)` (dispatches to all panels; no-op before init or for invalid kinds), `DCSync.decode(raw) -> {kind, sender} | null` (exported for tests), `DCSync.EVENT_TYPE`.
- Consumes: CEP `csInterface.addEventListener(type, fn)` / `csInterface.dispatchEvent(ev)`; the `CSEvent` constructor when present (CEP runtime), plain object fallback in node.

- [ ] **Step 1: Write the failing test**

Create `tests/sync.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -B1 -A3 "sync.test"`
Expected: FAIL — `Cannot find module '../panel/js/sync.js'`

- [ ] **Step 3: Write minimal implementation**

Create `panel/js/sync.js`:

```js
var DCSync = (function () {
  'use strict';

  var EVENT_TYPE = 'com.dropcomp.changed';
  var KINDS = ['library', 'assets', 'scripts', 'prefs', 'path'];

  var cs = null;
  var ownId = '';

  function isKind(k) { return KINDS.indexOf(k) !== -1; }

  // CEP delivers event.data as a JSON string in some host versions and as an
  // already-parsed object in others; anything malformed decodes to null.
  function decode(raw) {
    var msg = raw;
    if (typeof raw === 'string') {
      try { msg = JSON.parse(raw); } catch (e) { return null; }
    }
    if (!msg || typeof msg !== 'object') return null;
    if (!isKind(msg.kind) || typeof msg.sender !== 'string') return null;
    return { kind: msg.kind, sender: msg.sender };
  }

  function makeEvent() {
    // CSEvent exists in the CEP runtime; node tests get a plain object
    if (typeof CSEvent !== 'undefined') return new CSEvent(EVENT_TYPE, 'APPLICATION');
    return { type: EVENT_TYPE, scope: 'APPLICATION' };
  }

  function init(csInterface, extensionId, onRemoteChange) {
    cs = csInterface;
    ownId = extensionId || '';
    var handler = onRemoteChange || function () {};
    cs.addEventListener(EVENT_TYPE, function (event) {
      var msg = decode(event && event.data);
      if (!msg || msg.sender === ownId) return;
      handler(msg.kind);
    });
  }

  function broadcast(kind) {
    if (!cs || !isKind(kind)) return;
    var ev = makeEvent();
    ev.extensionId = ownId;
    ev.data = JSON.stringify({ kind: kind, sender: ownId });
    cs.dispatchEvent(ev);
  }

  return { EVENT_TYPE: EVENT_TYPE, decode: decode, init: init, broadcast: broadcast };
}());
if (typeof module !== 'undefined' && module.exports) { module.exports = DCSync; }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add panel/js/sync.js tests/sync.test.js
git commit -m "feat(panel): add DCSync cross-panel event module

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Manifest — declare the four standalone panels

**Files:**
- Modify: `tests/update.test.js:26-38` (the `VERSION constant matches…` test)
- Modify: `CSXS/manifest.xml`

**Interfaces:**
- Produces: five registered extensions sharing `./panel/index.html` + `./jsx/hostscript.jsx`. Menu labels: `DropComp`, `DropComp Library`, `DropComp Assets`, `DropComp Tools`, `DropComp Scripts`.
- Consumes: nothing from earlier tasks.

- [ ] **Step 1: Extend the version-sync test (failing first)**

In `tests/update.test.js`, replace the whole test block at lines 26–38 (`test('VERSION constant matches package.json and the CSXS manifest', …)`) with:

```js
const PANEL_EXTENSION_IDS = [
  'com.DropComp.ext',
  'com.DropComp.library',
  'com.DropComp.assets',
  'com.DropComp.tools',
  'com.DropComp.scripts',
];

test('VERSION constant matches package.json and the CSXS manifest', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(DCUpdate.VERSION, pkg.version, 'update.js VERSION out of sync with package.json');
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'CSXS', 'manifest.xml'), 'utf8');
  assert.ok(
    manifest.includes(`ExtensionBundleVersion="${pkg.version}"`),
    'manifest ExtensionBundleVersion out of sync with package.json'
  );
  for (const id of PANEL_EXTENSION_IDS) {
    assert.ok(
      manifest.includes(`<Extension Id="${id}" Version="${pkg.version}"`),
      `manifest ExtensionList missing <Extension Id="${id}"> at version ${pkg.version}`
    );
    assert.ok(
      manifest.includes(`<Extension Id="${id}">`),
      `manifest DispatchInfoList missing an entry for ${id}`
    );
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A4 "VERSION constant"`
Expected: FAIL — `manifest ExtensionList missing <Extension Id="com.DropComp.library">…`

- [ ] **Step 3: Rewrite the manifest**

Replace the full contents of `CSXS/manifest.xml` with (this preserves the existing main entry byte-for-byte and adds four siblings; note per-panel Geometry):

```xml
<?xml version="1.0" encoding="utf-8"?>
<ExtensionManifest Version="7.0" ExtensionBundleId="com.DropComp.ext" ExtensionBundleVersion="2.8.2" ExtensionBundleName="DropComp" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <ExtensionList>
    <Extension Id="com.DropComp.ext" Version="2.8.2" />
    <Extension Id="com.DropComp.library" Version="2.8.2" />
    <Extension Id="com.DropComp.assets" Version="2.8.2" />
    <Extension Id="com.DropComp.tools" Version="2.8.2" />
    <Extension Id="com.DropComp.scripts" Version="2.8.2" />
  </ExtensionList>
  <ExecutionEnvironment>
    <HostList>
      <Host Name="AEFT" Version="[15.0,99.9]" />
    </HostList>
    <LocaleList>
      <Locale Code="All" />
    </LocaleList>
    <RequiredRuntimeList>
      <Runtime Name="CSXS" Version="8.0" />
    </RequiredRuntimeList>
  </ExecutionEnvironment>
  <DispatchInfoList>
    <Extension Id="com.DropComp.ext">
      <DispatchInfo>
        <Resources>
          <MainPath>./panel/index.html</MainPath>
          <ScriptPath>./jsx/hostscript.jsx</ScriptPath>
          <CEFCommandLine>
            <Parameter>--enable-nodejs</Parameter>
            <Parameter>--mixed-context</Parameter>
          </CEFCommandLine>
        </Resources>
        <Lifecycle>
          <AutoVisible>true</AutoVisible>
        </Lifecycle>
        <UI>
          <Type>Panel</Type>
          <Menu>DropComp</Menu>
          <Geometry>
            <Size>
              <Height>600</Height>
              <Width>400</Width>
            </Size>
          </Geometry>
          <Icons />
        </UI>
      </DispatchInfo>
    </Extension>
    <Extension Id="com.DropComp.library">
      <DispatchInfo>
        <Resources>
          <MainPath>./panel/index.html</MainPath>
          <ScriptPath>./jsx/hostscript.jsx</ScriptPath>
          <CEFCommandLine>
            <Parameter>--enable-nodejs</Parameter>
            <Parameter>--mixed-context</Parameter>
          </CEFCommandLine>
        </Resources>
        <Lifecycle>
          <AutoVisible>true</AutoVisible>
        </Lifecycle>
        <UI>
          <Type>Panel</Type>
          <Menu>DropComp Library</Menu>
          <Geometry>
            <Size>
              <Height>600</Height>
              <Width>400</Width>
            </Size>
          </Geometry>
          <Icons />
        </UI>
      </DispatchInfo>
    </Extension>
    <Extension Id="com.DropComp.assets">
      <DispatchInfo>
        <Resources>
          <MainPath>./panel/index.html</MainPath>
          <ScriptPath>./jsx/hostscript.jsx</ScriptPath>
          <CEFCommandLine>
            <Parameter>--enable-nodejs</Parameter>
            <Parameter>--mixed-context</Parameter>
          </CEFCommandLine>
        </Resources>
        <Lifecycle>
          <AutoVisible>true</AutoVisible>
        </Lifecycle>
        <UI>
          <Type>Panel</Type>
          <Menu>DropComp Assets</Menu>
          <Geometry>
            <Size>
              <Height>600</Height>
              <Width>400</Width>
            </Size>
          </Geometry>
          <Icons />
        </UI>
      </DispatchInfo>
    </Extension>
    <Extension Id="com.DropComp.tools">
      <DispatchInfo>
        <Resources>
          <MainPath>./panel/index.html</MainPath>
          <ScriptPath>./jsx/hostscript.jsx</ScriptPath>
          <CEFCommandLine>
            <Parameter>--enable-nodejs</Parameter>
            <Parameter>--mixed-context</Parameter>
          </CEFCommandLine>
        </Resources>
        <Lifecycle>
          <AutoVisible>true</AutoVisible>
        </Lifecycle>
        <UI>
          <Type>Panel</Type>
          <Menu>DropComp Tools</Menu>
          <Geometry>
            <Size>
              <Height>420</Height>
              <Width>340</Width>
            </Size>
          </Geometry>
          <Icons />
        </UI>
      </DispatchInfo>
    </Extension>
    <Extension Id="com.DropComp.scripts">
      <DispatchInfo>
        <Resources>
          <MainPath>./panel/index.html</MainPath>
          <ScriptPath>./jsx/hostscript.jsx</ScriptPath>
          <CEFCommandLine>
            <Parameter>--enable-nodejs</Parameter>
            <Parameter>--mixed-context</Parameter>
          </CEFCommandLine>
        </Resources>
        <Lifecycle>
          <AutoVisible>true</AutoVisible>
        </Lifecycle>
        <UI>
          <Type>Panel</Type>
          <Menu>DropComp Scripts</Menu>
          <Geometry>
            <Size>
              <Height>500</Height>
              <Width>360</Width>
            </Size>
          </Geometry>
          <Icons />
        </UI>
      </DispatchInfo>
    </Extension>
  </DispatchInfoList>
</ExtensionManifest>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/update.test.js CSXS/manifest.xml
git commit -m "feat(manifest): declare standalone library/assets/tools/scripts panels

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Shell standalone-mode support + remote-change handling

**Files:**
- Modify: `panel/js/shell.js`

`shell.js` has no `module.exports` and no direct unit tests today (house pattern: pure logic lives in tested modules; shell is thin wiring). The testable pieces of this task were tested in Tasks 1–2. Full suite must stay green; behavior is exercised in Task 8's AE pass.

**Interfaces:**
- Consumes: `DCState.savePrefsForMode` (Task 1), `DCSync.broadcast` (Task 2, guarded with `typeof DCSync !== 'undefined'`), existing `DCLibrary/DCAssets/DCScripts` module functions (`resetLoaded`, `ensureLoaded`, `refresh`, `rerender`).
- Produces: `DCShell.init(elements, mode)` (second param NEW; `undefined` → `'full'`), `DCShell.getMode() -> string`, `DCShell.onRemoteChange(kind)` (public; Task 5 wires it into `DCSync.init`).

- [ ] **Step 1: Add mode state, reloadPrefs, and the new init**

In `panel/js/shell.js` replace lines 4–16 (`var els = null;` through the end of `init`):

```js
  var els = null;
  var prefs = null;
  var libraryPath = null;
  var panelMode = 'full';

  function hasAssets() { return typeof DCAssets !== 'undefined'; }
  function hasTools() { return typeof DCTools !== 'undefined'; }
  function hasScripts() { return typeof DCScripts !== 'undefined'; }
  function hasSync() { return typeof DCSync !== 'undefined'; }

  // Prefs live in localStorage shared by every DropComp panel. A standalone
  // panel pins its own activeTab after every (re)load so a tab remembered by
  // the main panel can never leak into it.
  function reloadPrefs() {
    prefs = DCState.loadPrefs(localStorage);
    if (panelMode !== 'full') prefs.activeTab = panelMode;
  }

  function init(elements, mode) {
    els = elements;
    panelMode = mode || 'full';
    reloadPrefs();
    applyPrefsToControls();
  }

  function getMode() { return panelMode; }
```

- [ ] **Step 2: Guard persistPrefs and debounce the prefs broadcast**

Replace line 21 (`function persistPrefs() { DCState.savePrefs(localStorage, prefs); }`):

```js
  // The thumb-size slider persists on every input event while dragging, so the
  // cross-panel prefs broadcast is trailing-debounced instead of per-call.
  var prefsBroadcastTimer = null;
  function persistPrefs() {
    DCState.savePrefsForMode(localStorage, prefs, panelMode);
    if (!hasSync()) return;
    clearTimeout(prefsBroadcastTimer);
    prefsBroadcastTimer = setTimeout(function () { DCSync.broadcast('prefs'); }, 200);
  }
```

(Design-spec note: the spec said "no debouncing needed" — the slider's per-input persistence is the one case that breaks that assumption, so prefs broadcasts alone are debounced 200 ms.)

- [ ] **Step 3: Pin the tab in standalone modes**

In `setActiveTab` (line 109), insert as the first line of the function body:

```js
    if (panelMode !== 'full') { tab = panelMode; skipPersist = true; }
```

- [ ] **Step 4: Tools mode boots without a library**

In `boot()` (line 82), insert at the top of the function body:

```js
    if (panelMode === 'tools') {
      // tools never touch the library; boot straight to a usable panel even
      // with no library configured or the drive missing
      DCUI.show('app');
      setActiveTab('tools', true);
      return;
    }
```

- [ ] **Step 5: Broadcast library-path changes**

In `selectLibraryFolder()` (line 129), inside the `if (path && path !== 'null') {` block, after `verifyAndLoad();` add:

```js
        if (hasSync()) DCSync.broadcast('path');
```

- [ ] **Step 6: Add the remote-change handler**

Insert after the `onSlider` function (ends line 224):

```js
  function appVisible() { return els && els.app && !els.app.classList.contains('hidden'); }

  // Another DropComp panel changed shared state. Visible sections re-read the
  // disk now; hidden sections are only marked stale and re-read on next visit.
  // Never broadcast from in here - that would echo between panels forever.
  function onRemoteChange(kind) {
    if (kind === 'path') { boot(); return; }
    if (kind === 'prefs') {
      reloadPrefs();
      applyPrefsToControls();
      if (appVisible() && (prefs.activeTab === 'library' || prefs.activeTab === 'assets')) {
        activeModule().rerender();
      }
      return;
    }
    if (kind === 'library') {
      DCLibrary.resetLoaded();
      if (appVisible() && prefs.activeTab === 'library') DCLibrary.ensureLoaded();
    } else if (kind === 'assets' && hasAssets()) {
      DCAssets.resetLoaded();
      if (appVisible() && prefs.activeTab === 'assets') DCAssets.ensureLoaded();
    } else if (kind === 'scripts' && hasScripts()) {
      if (appVisible() && prefs.activeTab === 'scripts') DCScripts.refresh();
      else DCScripts.resetLoaded();
    }
  }
```

- [ ] **Step 7: Export the new functions**

In the `return {` block (line 234), change the first two lines to:

```js
    init: init, boot: boot, verifyAndLoad: verifyAndLoad,
    getMode: getMode, onRemoteChange: onRemoteChange,
```

- [ ] **Step 8: Run tests to verify nothing broke**

Run: `npm test`
Expected: all PASS (shell.js is not directly imported by tests; this confirms no accidental breakage elsewhere).

- [ ] **Step 9: Commit**

```bash
git add panel/js/shell.js
git commit -m "feat(shell): support standalone panel modes and remote-change handling

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Wire panel mode into boot, markup, and styles

**Files:**
- Modify: `panel/index.html` (app-name id at line 30; script tag after line 344)
- Modify: `panel/css/style.css` (after the `#tabs` rule at line 69)
- Modify: `panel/js/main.js`
- Test: `tests/panel-mode-wiring.test.js` (create)

**Interfaces:**
- Consumes: `DCState.panelModeFromExtensionId` / `panelModeTitle` (Task 1), `DCSync.init` (Task 2), `DCShell.init(els, mode)` / `DCShell.onRemoteChange` (Task 4), CEP `csInterface.getExtensionID()`.
- Produces: `<body class="mode-<name>">` in standalone panels; per-mode header title; update check gated to full mode.

- [ ] **Step 1: Write the failing wiring test**

Create `tests/panel-mode-wiring.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'panel', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'panel', 'css', 'style.css'), 'utf8');

test('index.html loads sync.js before shell.js', () => {
  const sync = html.indexOf('js/sync.js');
  const shell = html.indexOf('js/shell.js');
  assert.ok(sync !== -1, 'sync.js script tag missing');
  assert.ok(shell !== -1, 'shell.js script tag missing');
  assert.ok(sync < shell, 'sync.js must load before shell.js');
});

test('index.html gives the app-name span an id for per-mode titles', () => {
  assert.ok(html.includes('id="app-name"'), 'app-name span needs id="app-name"');
});

test('style.css hides the tab bar in every standalone mode', () => {
  for (const mode of ['library', 'assets', 'tools', 'scripts']) {
    assert.ok(css.includes(`body.mode-${mode} #tabs`), `missing #tabs rule for mode-${mode}`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A3 "wiring"`
Expected: FAIL on all three tests.

- [ ] **Step 3: Edit index.html**

Line 30, add the id:

```html
    <span class="app-name" id="app-name">DropComp</span>
```

After the `bridge.js` script tag (line 344), insert:

```html
<script src="js/sync.js"></script>
```

- [ ] **Step 4: Edit style.css**

Immediately after the `#tabs` rule at line 69, add:

```css
body.mode-library #tabs, body.mode-assets #tabs, body.mode-tools #tabs, body.mode-scripts #tabs { display: none; }
```

- [ ] **Step 5: Edit main.js**

(a) After line 4 (`var csInterface = new CSInterface();`) insert:

```js
  // Five manifest entries share this page; the extension id picks which panel
  // this instance is (full tabbed shell, or one section standalone).
  var extensionId = csInterface.getExtensionID();
  var panelMode = DCState.panelModeFromExtensionId(extensionId);
  if (panelMode !== 'full') document.body.classList.add('mode-' + panelMode);
```

(b) Line 52, pass the mode and wire sync — replace `DCShell.init(els);` with:

```js
  DCShell.init(els, panelMode);
  DCSync.init(csInterface, extensionId, DCShell.onRemoteChange);
```

(c) Line 146, per-mode header title — replace `$('app-version').textContent = DCUpdate.VERSION.replace(/\.\d+$/, '');` area: keep those two version lines, and add before them:

```js
  $('app-name').textContent = DCState.panelModeTitle(panelMode);
```

(d) Gate the boot-time update machinery (lines 176–180) to the main panel — replace:

```js
  checkForUpdates(false);
  // a network blip at boot caches a short-lived error result; one quiet
  // re-check after that window means the chip still appears this session
  setTimeout(function () { checkForUpdates(false); }, 2 * DCUpdate.ERROR_RETRY_MS);
  DCUpdater.onBoot();
```

with:

```js
  // only the main panel runs boot-time update checks and post-update healing;
  // standalone panels stay quiet (Settings > Check for Updates works anywhere)
  if (panelMode === 'full') {
    checkForUpdates(false);
    // a network blip at boot caches a short-lived error result; one quiet
    // re-check after that window means the chip still appears this session
    setTimeout(function () { checkForUpdates(false); }, 2 * DCUpdate.ERROR_RETRY_MS);
    DCUpdater.onBoot();
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add panel/index.html panel/css/style.css panel/js/main.js tests/panel-mode-wiring.test.js
git commit -m "feat(panel): wire panel mode into boot, markup, and styles

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Broadcast mutations from library, assets, and scripts

**Files:**
- Modify: `panel/js/library.js` (helper + 8 call sites)
- Modify: `panel/js/assets.js` (helper + 3 call sites)
- Modify: `panel/js/scripts.js` (2 call sites)
- Test: `tests/sync.broadcast.test.js` (create; assets is the node-testable module — library.js/scripts.js have no `module.exports`, so their identical pattern is covered by the shared helper shape + Task 8's AE pass)

**Interfaces:**
- Consumes: `DCSync.broadcast(kind)` (Task 2), always guarded `typeof DCSync !== 'undefined'` so node tests and the mock harness run without it.
- Produces: no new public API; mutation success paths now emit exactly one broadcast each.

- [ ] **Step 1: Write the failing test**

Create `tests/sync.broadcast.test.js` (mirrors the house style of `tests/assets.dragdrop.test.js` — fresh-require + fake globals):

```js
const test = require('node:test');
const assert = require('node:assert/strict');

function freshAssetsModule() {
  const modulePath = require.resolve('../panel/js/assets.js');
  delete require.cache[modulePath];
  return require(modulePath);
}

function makeClassList() {
  return { add() {}, remove() {}, toggle() {}, contains() { return false; } };
}

function installGlobals(broadcasts) {
  global.localStorage = {};
  global.DCShell = {
    setActiveTab() {},
    getLibraryPath() { return '/Library'; },
    getPrefs() {
      return { activeTab: 'assets', favoritesOnly: false, sort: 'name', collapsedAssets: [] };
    },
    getEls() {
      return {
        categoryModal: { classList: makeClassList() },
        search: { value: '' },
        library: {},
      };
    },
  };
  global.DCUI = {
    openCategoryModal() {},
    closeModal() {},
    spinner() {},
    toast() {},
    isError(result) { return typeof result === 'string' && result.indexOf('Error') === 0; },
  };
  global.DCBridge = {
    acquire() { return true; },
    release() {},
    parseJson(result) { try { return JSON.parse(result); } catch (e) { return null; } },
    call(fnName, args, cb) {
      if (fnName === 'pickAssetFiles') cb('{"ok":true,"paths":["/tmp/a.png"]}');
      else if (fnName === 'addAssetFiles') cb('{"ok":true,"added":1,"skipped":[]}');
      else if (fnName === 'getAssets') cb('[]');
    },
  };
  global.DCState = {
    ASSETS_USAGE_KEY: 'dropcomp_assets_metadata',
    loadUsageMeta() { return {}; },
    cleanupStaleMetadata(usageMeta) { return { removed: 0, usageMeta }; },
    filterComps(items) { return items; },
    groupByCategory() { return []; },
    sortComps(items) { return items; },
  };
  global.DCRender = { render() {} };
  global.DCSync = { broadcast(kind) { broadcasts.push(kind); } };
}

function cleanupGlobals() {
  delete global.localStorage;
  delete global.DCShell;
  delete global.DCUI;
  delete global.DCBridge;
  delete global.DCState;
  delete global.DCRender;
  delete global.DCSync;
}

test('adding assets broadcasts an assets change to other panels', () => {
  const broadcasts = [];
  installGlobals(broadcasts);
  try {
    const DCAssets = freshAssetsModule();
    DCAssets.addFlow();               // stages pendingPaths via pickAssetFiles
    DCAssets.confirmCategory('Logos'); // addAssetFiles succeeds -> reload + broadcast
    assert.deepEqual(broadcasts, ['assets']);
  } finally {
    cleanupGlobals();
  }
});

test('a plain refresh never broadcasts', () => {
  const broadcasts = [];
  installGlobals(broadcasts);
  try {
    const DCAssets = freshAssetsModule();
    DCAssets.refresh();
    assert.deepEqual(broadcasts, []);
  } finally {
    cleanupGlobals();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A3 "broadcasts an assets change"`
Expected: FAIL — `deepEqual` mismatch: `[] !== ['assets']`.

- [ ] **Step 3: assets.js — helper + swap the 3 mutation sites**

In `panel/js/assets.js`, insert directly above `function refresh()` (line 44):

```js
  // Reload after a disk mutation and tell other open DropComp panels.
  // Plain loads/refreshes must never broadcast (echo loop between panels).
  function loadAndBroadcast() {
    if (typeof DCSync !== 'undefined') DCSync.broadcast('assets');
    load();
  }
```

Swap exactly these three success-path calls from `load();` to `loadAndBroadcast();`:
- line 235 (in `confirmCategory`, after the "N assets added" toast)
- line 303 (in `confirmRename`, after the "Renamed." toast)
- line 330 (in `confirmDelete`, after the "Deleted." toast)

Do NOT touch the `load()` calls in `ensureLoaded`/`refresh`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: library.js — same helper, kind 'library', 8 sites**

In `panel/js/library.js`, insert directly above `function refresh()` (line 47):

```js
  // Reload after a disk mutation and tell other open DropComp panels.
  // Plain loads/refreshes must never broadcast (echo loop between panels).
  function loadAndBroadcast() {
    if (typeof DCSync !== 'undefined') DCSync.broadcast('library');
    load();
  }
```

Swap exactly these eight success-path calls from `load();` to `loadAndBroadcast();`:
- line 126 — `confirmCategory` stash branch (`if (!DCUI.isError(result)) load();`)
- line 141 — `confirmCategory` addAep branch (after the "'name' added" toast)
- line 219 — `confirmCategoryRename` (after "Folder renamed…" toast)
- line 250 — `confirmRename` (after "Renamed." toast)
- line 276 — `confirmDelete` (after "Deleted." toast)
- line 293 — `generateThumb` (after "Thumbnail generated…" toast)
- line 310 — `setThumb` (after "Thumbnail set…" toast)
- line 335 — `moveToCategory` (after "Moved to…" toast)

(Known minor limitation, accepted in design review: other panels re-render after thumbnail changes but their `<img>` cache-bust map is per-panel, so a regenerated thumbnail may show stale in another panel until its next own reload.)

- [ ] **Step 6: scripts.js — broadcast on save and remove**

In `panel/js/scripts.js` line 425, append the broadcast inside the callback:

```js
    persistLocked(function () { closeModal(); render(); DCUI.toast('Saved "' + entry.name + '".', false); if (typeof DCSync !== 'undefined') DCSync.broadcast('scripts'); });
```

Line 444, same:

```js
    persistLocked(function () { DCUI.closeAllModals(); render(); DCUI.toast('Removed "' + name + '".', false); if (typeof DCSync !== 'undefined') DCSync.broadcast('scripts'); });
```

(Deliberately NOT inside `persistLocked` itself — usage bumps also persist through it and must not spam other panels on every script run.)

- [ ] **Step 7: Run tests to verify everything still passes**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add panel/js/library.js panel/js/assets.js panel/js/scripts.js tests/sync.broadcast.test.js
git commit -m "feat(sync): broadcast library/assets/scripts mutations to other panels

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: hostscript idempotency check + README

**Files:**
- Verify (read-only unless a problem is found): `jsx/hostscript.jsx`
- Modify: `README.md`

- [ ] **Step 1: Verify hostscript.jsx re-evaluation is idempotent**

Each of the five panels evaluates `jsx/hostscript.jsx` into AE's single shared ExtendScript engine when it opens. Check for top-level mutable state that a re-eval would reset:

Run: `grep -n "^var \|^\$\.\|\$.global" jsx/hostscript.jsx | head -30`

Review each hit: function declarations and constant tables are fine (re-eval overwrites with identical values). A problem would be top-level state that accumulates between calls (e.g. a session cache object) — re-evaluating would wipe it while another panel expects it. If such state exists, guard it:

```js
// before:  var SOME_CACHE = {};
// after:   if (typeof $.global.SOME_CACHE === 'undefined') $.global.SOME_CACHE = {};
```

If nothing needs guarding (expected), record that in the Task 8 verification notes — no commit for a pure check.

- [ ] **Step 2: Add the README section**

In `README.md`, after the main feature overview section (place it beside the existing feature descriptions, before install instructions), add:

```markdown
## Multiple panels

DropComp ships five panels (Window > Extensions): the classic all-in-one
**DropComp** panel plus standalone **DropComp Library**, **DropComp Assets**,
**DropComp Tools**, and **DropComp Scripts** panels. Open any combination and
dock them anywhere — e.g. keep Tools next to the timeline while Library sits
by the Project panel. All open panels share one library and stay in sync:
adding, renaming, or deleting items in one panel updates the others
immediately. New panels appear in the menu after restarting After Effects.
Each open panel is a separate Chromium view (roughly 50 MB of RAM), so open
only what you need.
```

- [ ] **Step 3: Run tests, commit**

Run: `npm test` — all PASS.

```bash
git add README.md
git commit -m "docs(readme): document the five-panel workspace

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Full verification

**Files:** none (verification only; fixes get their own commits).

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: 0 failures; suite grew by 15 tests (state.panel-mode 6, sync 4, wiring 3, broadcast 2, none removed).

- [ ] **Step 2: Manual AE pass**

The repo folder is the dev-linked extension, so the working tree is live in AE. Restart After Effects, then walk this checklist:

1. Window > Extensions shows all five DropComp entries; open all five.
2. Standalone panels show no tab bar; header titles read "DropComp Library" / "DropComp Assets" / "DropComp Tools" / "DropComp Scripts".
3. **localStorage-shared check** (spec assumption): in the main panel change the sort; in the standalone Library panel's debug console run `JSON.parse(localStorage.getItem('dropcomp_prefs')).sort` — it must reflect the change. Record the result either way (the code works in both worlds, but the spec assumes shared).
4. Live sync: add a comp from the main panel → standalone Library panel updates without touching it. Delete it from the standalone panel → main panel updates.
5. Prefs sync: change sort/view in one Library view → the other follows (≤ ~1 s, after the 200 ms debounce). Drag the thumb slider — no visible thrash in the other panel.
6. activeTab guard: put the main panel on Scripts, change the sort in the standalone Library panel, close + reopen the main panel → it must reopen on Scripts.
7. Tools standalone: with the library drive disconnected (or path unset), the Tools panel still boots straight to buttons; anchor/align/precomp tools work.
8. Update chip appears only in the main panel (standalone panels: Settings > Check for Updates still functions).
9. Scripts sync: save a snippet in the main panel's Scripts tab → standalone Scripts panel shows it.
10. Restart AE with panels docked → workspace restores all of them, each in its correct mode.

- [ ] **Step 3: Wrap up**

Use superpowers:verification-before-completion, then superpowers:finishing-a-development-branch (merge to main is release-gated: version bump to 2.9.0 + the 5-step release happen separately when Ziscol says ship).
