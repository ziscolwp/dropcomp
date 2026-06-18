# DropComp — In-Panel Self-Updater Design

Date: 2026-06-18
Status: approved by user (design dialogue 2026-06-18); ready for planning.
Release gate: the Windows apply path must be hand-verified on a real Windows
machine before the release that contains this updater ships (user has no Windows
box right now; a friend's machine will be used). macOS path is testable locally.

## 1. Goal

Replace today's "update chip that only links to the GitHub download page" with a
robust, one-click in-panel self-updater: the chip opens a modal → the user
confirms once → the panel downloads the release zip from GitHub, verifies it,
backs up the current install, swaps in the new files, and prompts a restart. No
Finder, no manual unzip, no `install.command`/`.bat` double-click, no Gatekeeper.

This ships to paying, **non-technical** customers and updates will be frequent,
so the ordering priority is: **(1) never brick the panel, (2) never lose user
data, (3) reliable on Windows AND macOS, (4) simple.** Those override convenience
everywhere they conflict.

Decisions locked with the user (design dialogue):

| Decision | Choice |
|---|---|
| Automation | Confirm once ("What's new" + one confirm), then fully automatic with a progress bar, ending in a restart prompt. |
| Backup location | `~/Documents/DropComp/backup-<current-version>.zip` (Windows: `%USERPROFILE%\Documents\DropComp\…`) — matches the existing installer, sits outside the extension folder, simplest. |
| Restart AE | **Prompt only — never quit/relaunch AE** (an unsaved project must never be at risk from the updater). |
| Download trust | Verify GitHub's published **SHA-256 + byte size**, plus a local **unzip-integrity** check, before applying. Extension stays **unsigned** (PlayerDebugMode); no `.zxp` signing. |
| Apply mechanic | Shared verified-stage pipeline; **macOS swaps immediately**, **Windows stages + applies via a background helper the moment AE closes** (Windows locks in-use files). |

## 2. Current state / verified facts

- **Node is not enabled today.** `CSXS/manifest.xml` has an empty
  `<CEFCommandLine />`. The panel currently does *all* file/host I/O through
  ExtendScript via `DCBridge.call` (`cs.evalScript`). Enabling Node in the panel
  is the enabling change for in-panel download/unzip/copy.
- **`panel/js/update.js` (DCUpdate):** checks `…/releases/latest`, has
  `parseVersion`/`isNewer`, a 12 h throttle/cache in `localStorage`, and exposes
  `VERSION`, `RELEASES_PAGE`, `check`. Today the chip click calls
  `csInterface.openURLInDefaultBrowser(DCUpdate.RELEASES_PAGE)` (`main.js`).
- **Installers** (`install.command`, `install.bat`) define the install contract:
  back up the existing install, replace it, copy **exactly three folders**
  (`CSXS`, `panel`, `jsx`), set PlayerDebugMode. Destinations:
  - macOS: `~/Library/Application Support/Adobe/CEP/extensions/DropComp`
  - Windows: `%APPDATA%\Adobe\CEP\extensions\DropComp`
- **Release artifact** (`scripts/build-dist.sh`): `dist/DropComp-<V>.zip`
  containing a top-level `DropComp-<V>/` with `CSXS/ panel/ jsx/ install.bat
  install.command README.md`. The release has **one asset**. The unit we install
  is the three code dirs.
- **Integrity is free from the API.** GitHub's `releases/latest` asset metadata
  exposes the asset `size` and a `sha256` digest. We verify against those — **no
  change to the release process** is required.
- **Version pin test.** `tests/update.test.js` asserts
  `DCUpdate.VERSION === package.json.version` and that the manifest version
  attributes match. We are **not** bumping the version on this branch, so that
  test stays green. (Version bump + release happen later, in the combined 2.5.0.)
- **Paths need no ExtendScript.** `csInterface.getSystemPath(SystemPath.EXTENSION)`
  returns the live extension folder; its parent is the CEP `extensions/` dir.
  `os.homedir()` gives the backup root. **`jsx/` is not touched by this feature.**

## 3. Approaches considered (apply mechanic)

**A. Verified-stage pipeline + platform-appropriate apply (chosen).** Download →
verify → back up → stage a complete verified copy → then apply. macOS replaces
the folders immediately in the panel (no file locks); Windows writes a small
background helper that waits until AE closes, then applies. Same safety
guarantees both ways. Honest about the one real OS difference (in-use file
locking) and nothing more.

**B. Reuse the bundled `install.command`/`install.bat` post-quit.** The release
zip already contains the installers. Rejected: they do `rm -rf dest` *then*
copy — a window where **no extension is installed** if the copy fails, with no
mid-failure rollback, and the macOS backup name is hardcoded/stale
(`backup-v1.1.0.zip`, made at most once). Weaker than the "never brick"
requirement. (We may separately harden those scripts later; out of scope here.)

**C. Swap-immediately on both platforms.** Rejected: unreliable on Windows, which
locks the panel's in-use files while AE runs.

**D. Auto-quit and relaunch AE to apply.** Rejected by the user — unsaved-project
data-loss risk.

## 4. Architecture & change surface

Zero new dependencies. All I/O uses Node built-ins (`https`, `crypto`, `fs`,
`os`, `path`, `child_process`) plus OS-native archive tools (the same ones the
installers use): unzip via `ditto`/`unzip` (macOS) and PowerShell
`Expand-Archive` (Windows); backup-zip via `ditto`/`zip` (macOS) and
`Compress-Archive` (Windows). Panel-side JS may be modern; **`jsx/` stays ES3 and
is untouched.**

### 4.1 `CSXS/manifest.xml` (enabling change — NOT the version)

Populate the empty `<CEFCommandLine />` with two parameters:

```xml
<CEFCommandLine>
  <Parameter>--enable-nodejs</Parameter>
  <Parameter>--mixed-context</Parameter>
</CEFCommandLine>
```

`--enable-nodejs` gives the panel Node; `--mixed-context` lets the existing
`<script>`-tag modules use `require` in the same context as the DOM. **Version
attributes (`ExtensionBundleVersion`, `Extension Version`) are left unchanged**,
per the release-sequencing instruction. (Confirm exact `<Parameter>` syntax
against CEP docs during implementation.)

> Verify in live AE: with `--mixed-context`, `module` becomes defined in the
> panel context, so each module's `if (typeof module !== 'undefined' &&
> module.exports) {…}` guard now executes harmlessly in-browser. Confirm all
> modules still initialize (this is a known CEP mixed-context interaction).

### 4.2 New `panel/js/updater.js` — controller (< 400 lines)

Orchestration + UI state machine. Holds **no raw I/O** — it calls an injected
helper (the Node module in 4.3) so the decision logic is unit-testable with the
helper mocked. Responsibilities: open/close modal, drive progress + error UI,
sequence the steps, choose the platform apply path, and the **self-disable**
fallback (below). Reuses `DCUpdate.parseVersion`/`isNewer`.

### 4.3 New `panel/js/updater-fs.js` — Node I/O boundary (< 400 lines)

The "outer boundary" (per testing rules, this is what tests mock at): paths
resolution, `fetchReleaseInfo`, `download`, `verifyIntegrity`, `extract`,
`backup`, `applyMac`, `spawnWindowsApplyHelper` (+ `buildWindowsApplyScript`),
`rollback`, `cleanupStale`. If it approaches 400 lines, split apply/rollback into
`panel/js/updater-apply.js`.

### 4.4 Light edits to shared files (scoped — expect rebase)

- `panel/js/main.js`: chip click → `DCUpdater.open()` instead of `openURL…`;
  init the updater with `csInterface` + `localStorage`. Existing 12 h
  `DCUpdate.check` that *shows* the chip is unchanged.
- `panel/index.html`: add the update-modal markup and the two new `<script>`
  tags. **Kept to the header/modal area** (the parallel grid-view branch also
  edits this file).
- `panel/css/style.css`: modal + progress-bar styles, scoped likewise.
- `panel/js/update.js`: unchanged in substance (keeps its tests green). The
  richer release-detail fetch lives in `updater-fs.js` and runs fresh at click
  time.

### 4.5 `README.md`

Rewrite the "Updates" section (no longer "opens the download page") and add the
rollout note (§9).

## 5. Update flow (state machine)

```
chip (shown by existing 12h check) ──click──▶ MODAL: "Update available <ver>"
   • What's new (release body)   • [Update now]  [Later]  [View on GitHub]

[Update now] ▶ confirm once ▶ run automatically, showing progress:

 1 fetchReleaseInfo  fresh GET releases/latest → tag, body, pick the .zip asset →
                     {url,size,sha256}. Reject if url not https or host not in the
                     GitHub allowlist (§6). Re-confirm isNewer vs installed.
 2 download          → temp file outside extensions/ (progress %); timeout/abort.
 3 verify            bytes==size AND sha256(bytes)==asset.sha256 AND archive
                     decompresses cleanly. Any miss → discard, error, live UNTOUCHED.
 4 extract+sanity    → staging dir OUTSIDE the extensions scan path. Assert staged
                     DropComp-<V>/ has CSXS+panel+jsx and its manifest version==tag.
 5 backup            zip live folder → ~/Documents/DropComp/backup-<curver>.zip
                     (skip if it already exists). Fail → error, live UNTOUCHED.
 6 apply (branch):
     macOS:   for d in CSXS,panel,jsx: move live/d → live/d.dcold; move staged/d
              → live/d. all ok → delete .dcold + staging. any fail → reverse every
              move done, restore from backup if needed → complete working version.
     Windows: write buildWindowsApplyScript(paths) to temp; spawn it DETACHED
              (survives AE exit). It retries the same move-aside swap with backoff
              until the files unlock (AE fully closed) or it times out; writes a
              status file (ok/fail) and self-cleans. On fail it reverses → live
              intact. Panel does NOT delete staging (helper owns it).
 7 finish:
     macOS:   "Update complete — restart After Effects to finish."
     Windows: "Update ready — quit & reopen After Effects to finish
               (it installs automatically the moment AE closes)."

next panel boot: read status/marker → toast "Updated to <ver> ✓" or, on failure,
   "Update didn't finish — you're still on <ver>, nothing was changed.
   [Try again] [Download manually]". Also cleanup any stray .dcold/staging.
```

## 6. Safety & robustness (the adversarial review of apply/rollback)

- **Never bricked.** The only destructive step (the swap) runs **after** both a
  verified staged copy and a backup exist. It **moves folders aside** rather than
  delete-then-copy, so there is never a "no extension installed" gap. Any failure
  **auto-reverses** every move already made and restores from backup if needed,
  always ending on one complete, working version.
- **Self-disable fallback.** If `typeof require === 'undefined'` (Node not
  enabled — old runtime, manifest didn't take, mixed-context issue), the updater
  disables itself and the chip reverts to today's behavior (opens
  `RELEASES_PAGE`). The feature can never make things worse than the current
  build. A `[Download manually]` button is present in every error state.
- **Locked to GitHub, HTTPS only.** Only `https://api.github.com/repos/ziscolwp/
  dropcomp/releases/latest` and its GitHub-hosted asset URL are contacted. The
  asset URL must be `https:` and its host in an allowlist
  (`github.com`, `objects.githubusercontent.com`, `*.githubusercontent.com`);
  redirects are followed only to allowlisted https hosts. No user-supplied URLs.
- **User data is never touched.** Only `CSXS`/`panel`/`jsx` inside the DropComp
  extension folder, plus the Documents backup zip, are written. The library
  folder, `Documents/DropComp/library_path.txt`, and localStorage favorites are
  out of scope of every file operation.
- **No duplicate-manifest collision.** CEP loads every immediate subfolder of
  `extensions/` that has `CSXS/manifest.xml`. Therefore: staging lives **outside**
  `extensions/`; the `.dcold` backups live **inside** `DropComp/` (not scanned as
  a separate extension); and no second loadable manifest is ever left directly
  under `extensions/`.
- **Re-runnable / idempotent.** Boot-time cleanup removes stray `.dcold`/staging
  from an interrupted run; an existing backup for the current version is reused;
  an in-progress/staged update is detected so a second click never double-stages.
- **Throttle preserved.** The existing 12 h chip check is unchanged; the heavier
  release-detail fetch happens on demand at click time, not on every boot.
- **PlayerDebugMode.** Already enabled (the panel is running), so it is not
  required for the swapped bundle to load. Re-asserting it is a **best-effort,
  non-fatal** step (mirrors the installers; covers CSXS 9–12 / AE 2019–2026).
- **Enumerated edge cases:** offline / DNS failure / timeout; partial download
  (size mismatch); checksum mismatch; disk full / permission denied (temp,
  backup, or extensions dir); locked file on Windows (helper retry → rollback);
  CEP runtimes 9–12 across AE 2019–2026; macOS vs Windows path differences.

## 7. Testing

- **Unit — `tests/updater.test.js`** (mocked fs+net helper): step ordering on the
  happy path; verify-failure → no apply + correct rollback; URL allowlist
  accept/reject; platform branch selection (mac vs win); self-disable when
  `require` is absent; reuse of `parseVersion`/`isNewer`.
- **Integration — `tests/updater-fs.test.js`** (real OS temp dir + a fixture zip;
  mock the network only, per "integration over mocks for I/O"): download(mocked)
  → verify(real sha256/size) → extract(real) → backup(real) → macOS swap(real) →
  injected-failure rollback(real). Assert: the live tree is restored **byte-for-
  byte** on failure; user-data paths are never written; the backup has the
  correct per-version name.
- **Windows helper:** `buildWindowsApplyScript` is pure → unit-test that it emits
  correctly-quoted paths, is scoped to the DropComp folder only, and has the
  move-aside / reverse-on-error structure. **Real Windows end-to-end = the
  release gate** (deferred to a Windows machine).
- **Existing suites stay green** (`update.test.js` version pin, `jsx.es3`,
  `jsx.exports`, …).
- **Manual live AE (macOS):** self-update a real *older* build end-to-end before
  this is called done; record in `docs/superpowers/verification/`.

## 8. Out of scope (YAGNI)

- Auto-quit / relaunch AE.
- `.zxp` code-signing / notarization.
- Delta/partial updates (always the full bundle).
- A downgrade / "roll back to older version" UI (the Documents backup is a manual
  restore).
- Background auto-download before the user opts in; update channels / beta.

## 9. Rollout note (also added to README)

This updater ships *inside* the next release. Existing 2.4.0 (and earlier) users
install that next release **once via the manual installer** — their old chip
still just opens the download page — and **every update after that is one-click**.
The version bump and release are done separately when this and the parallel
grid-view feature both land (combined 2.5.0); **this branch changes no version
number.**

## 10. Isolation / housekeeping

All new files target < 400 lines; `jsx/` is untouched (stays ES3). Shared files
(`index.html`, `style.css`, `main.js`) are edited only in the chip/modal area and
will likely need a rebase against the parallel grid-view branch at merge time.
Staging is done with explicit paths; never `git add -A`.
