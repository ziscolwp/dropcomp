# Scripts Manager — Spec (DropComp 2.3.0)

> Built overnight autonomously. **Every product decision below was made by Claude**
> (the user was asleep) and is flagged for morning review. AE-technical assumptions
> were verified in a live AE 2026 session first (see §6).

## 1. Goal
Let the user register, organize, and one-click-run their many custom AE scripts —
pasted **snippets** and external **`.jsx`/`.jsxbin` files** (incl. ScriptUI Panels) —
from DropComp, so they can keep those panels **undocked** and reclaim AE real estate.

## 2. Decisions (open questions from the handoff, resolved)
| Question | Decision | Why |
|---|---|---|
| Card grid vs control surface | **Compact list/row view in a custom tab** (like Tools), not the thumbnail grid | Scripts have no thumbnail; a dense searchable list scales to "a lot of scripts" |
| Storage | Registry JSON `<library>/.dropcomp_scripts.json` `{version,scripts:[]}`; usage/favorites in `localStorage["dropcomp_scripts_metadata"]` | Mirrors the comp index + assets-metadata pattern exactly |
| Entry schema | `{uniqueId,name,description,category,source:'file'|'snippet',path|null,body|null,addedAt,tags:[]}` | Snippets are portable with the library; files referenced by absolute path so on-disk edits stay live |
| Run model | `$.evalFile`: file → `evalFile(File(path))`; snippet → write to a temp `.jsx` in `Folder.temp` then `evalFile`, delete after | Verified: a ScriptUI `'palette'` launched this way floats non-blocking (the real-estate win) |
| Undo wrapping | **No** auto undo group around user scripts | They manage their own undo; nesting/atomic-wrapping risks conflicting with their `beginUndoGroup` |
| `.jsxbin` | Allowed as file-source; body not editable | Binary has no readable body; still runnable |
| Missing external file | Run → honest error + a **Relocate** action (re-pick the file) | Files move; don't fail silently |
| "Run once" vs "open as panel" | One **Run** action | `evalFile` already floats palettes; no separate mode needed |
| Confirm-before-run | Schema reserves `confirmBeforeRun` (optional); UI deferred | These are the user's own scripts; low risk for v1 |
| Scan AE ScriptUI Panels folder | "Add file" dialog defaults to that folder when found | Quick-add without a full scanner |

## 3. Tab integration
A 4th tab `scripts`, plugged into the existing generalized tab system:
- `DCState.resolveActiveTab(tab, hasAssets, hasTools, hasScripts)` → `'scripts'`.
- `#app.scripts-active` CSS shows `<section id="scripts">` (a **custom view**, like Tools).
- `DCShell.setActiveTab` toggles `scripts-active` + calls `DCScripts.ensureMounted()`.
- Tab bar must still fit 4 tabs at 400px (Part C constraint).

## 4. Modules
- **`panel/js/scripts-core.js`** (`DCScriptsCore`, pure + unit-tested): `validateEntry`,
  `makeEntry`, `filterScripts`, `sortScripts`, `groupByCategory`, `newUniqueId`,
  registry parse/serialize with a version guard. Mirrors `tools-core.js`.
- **`panel/js/scripts.js`** (`DCScripts`, controller): mount, render list rows, search/
  category/favorites, add-snippet / add-file / edit / run / reveal / remove flows,
  delegated click dispatch. Reuses `DCRender.ICONS` + `iconBtn`, `DCBridge`, `DCUI`.
- **`jsx/scripts.jsx`** (host, ES3, exports to `$.global`):
  `scRunFile(path)`, `scRunSnippet(body)`, `scPickScriptFile()`, `scRevealFile(path)`,
  `scFileExists(path)`, `scLoadRegistry(libPath)`, `scSaveRegistry(libPath, json)`.
  Registered in `loadHostModules` (`DC_MODULE_FILES` + marker `scRunFile`).

## 5. Host run semantics (ES3)
- `scRunFile`: guard `File(path).exists` → `jerr('Script file not found: ...')`; else
  `$.evalFile` in try/catch; return `{"ok":true}` or `jerr(e + ' (line ' + e.line + ')')`.
- `scRunSnippet`: write body to `Folder.temp + '/dropcomp_run_<ts>.jsx'`, `evalFile`,
  remove temp in a `finally`-style cleanup; same error capture.
- Never throw to the panel. No undo group (see §2).

## 6. AE assumptions — VERIFIED live (AE 2026, 2026-06-18)
- `$.evalFile` of a temp `.jsx` written from a string **executes** with full DOM access. ✅
- `Folder.temp` = `/private/var/folders/.../T` (a real path, **not** the `/tmp` symlink that
  breaks `Folder.create`); `Folder.create` + registry-JSON write there **work**. ✅
- A ScriptUI `new Window('palette')` `.show()` is **non-blocking and visible** → docked-panel
  scripts run on demand as floating windows without docking. ✅

## 7. Tests (npm, zero-dep)
`DCScriptsCore` pure logic (validate/make/filter/sort/group/parse) + ES3 lint over
`jsx/scripts.jsx` + `$.global` export check (existing static guards cover the new file).

## 8. Deferred (documented, not built v1)
Confirm-before-run UI; full ScriptUI-folder scanner; tags UI; import/export of the
registry. Reserved in schema where relevant.
