# Tooltips + In-Panel Script UI — Spec (DropComp 2.4.0)

> Brainstormed with the user 2026-06-18. Two requests:
> 1. Hover tooltips on Tools buttons and Scripts rows ("a slight box of description").
> 2. Run a script so its UI appears **inside DropComp** in an optimized way.
>
> Hard platform constraint established up front: a script's own UI is **ScriptUI**
> (ExtendScript's native widget toolkit); DropComp's panel is **HTML/Chromium (CEP)**.
> There is no bridge to render a ScriptUI window inside the HTML panel. So "inside
> DropComp" is delivered by DropComp **drawing the controls itself in HTML** and feeding
> values to the script — not by embedding the script's window.

## 1. Goal
- **A. Tooltips:** a fast, theme-matched hover/focus tooltip across the panel, replacing
  the slow (~1.5 s), OS-styled native `title` tooltip.
- **B. Track A — in-panel forms:** for scripts the user can adapt, DropComp renders their
  inputs as native HTML controls in the Scripts tab and passes the values into the script
  via a `DC_PARAMS` global — no floating window.
- **C. Track B — windowed panels:** for third-party `.jsx`/`.jsxbin` panels the user can't
  edit, run unchanged (floats as today) with honest labeling. No false embedding promises.

## 2. Scope
**In v1:** A (tooltips) · B (param schema + in-editor builder + inline run form + host
param injection) · C (optional "opens its own window" flag for honest labeling).

**Deferred (documented, not built):** manifest-comment form definitions inside `.jsx`;
`color`/`file` param types; single-instance / no-duplicate control for windowed scripts
(not possible without adapting the script — see §5.3); registry import/export; tags UI.

---

## 3. Feature A — `DCTooltip`

### 3.1 Module
New `panel/js/tooltip.js` → `DCTooltip` (IIFE, mirrors `DCTools`/`DCScripts`). Loaded once
in `panel/index.html` **after** `render.js` and before `main.js`. `main.js` calls
`DCTooltip.init()` on boot.

### 3.2 Behavior
- Injects a single `<div id="dc-tooltip" role="tooltip" aria-hidden="true">` into `<body>`:
  `position:fixed`, `pointer-events:none`, hidden until shown.
- **Delegated** listeners on `document` (so dynamically rendered rows are covered with no
  per-element wiring):
  - `pointerover` → `target.closest('[data-tip]')`; if found, start a **300 ms** show timer.
  - `pointerout` / `pointerdown` → clear timer + hide.
  - `focusin` → show **immediately** (0 ms) for keyboard users; `focusout` → hide.
  - `keydown` Escape, `scroll` (capture), and `resize` → hide (no stale position).
- **Content is text-only**, set via `textContent` / DOM nodes — **never `innerHTML`**,
  because script names/descriptions/paths are user data. Source attributes:
  - `data-tip` — body text. `\n` is split into separate lines.
  - `data-tip-title` — optional bold first line (used by script rows for the name).
- **Show rule:** ignore elements whose `data-tip` is empty after trim.

### 3.3 Positioning (pure, tested)
`clampPosition(anchorRect, tipSize, viewport, margin=6)` → `{ x, y, placement }`:
- Default placement **below** the anchor, horizontally centered on it.
- If the tip would overflow the bottom edge, place **above**.
- Clamp `x` into `[margin, viewport.w - tipSize.w - margin]`; same for `y`.
- Returns `placement` ('above'|'below') for an optional CSS hook; no arrow needed in v1.

### 3.4 Script-row tip (pure, tested)
`buildScriptTip(entry, usage)` → `{ title, body }`:
- `title` = entry name.
- `body` lines: description (if any) · `Snippet` or `File` · for files the **full path**;
  for snippets a **≤5-line body preview** (joined, trailing `…` if longer). Run-count line
  if `usage.runCount`.

### 3.5 Text-source migration
Replace `title="…"` with `data-tip="…"` (keep `aria-label`; drop `title` so the native
tooltip can't double up) on: header buttons (`#settings-btn`, `#update-chip`), toolbar
icons (`#favorites-btn`, `#relink-btn`, `#display-btn`, `#add-aep-btn`, `#sort-select`,
`#thumb-slider`), the anchor grid (9 cells), `create`/`align`/`distribute`/`reset` icons,
and the four pre-comp buttons. Upgrade terse ones to a full sentence
(e.g. `Solid` → "Add a full-frame solid layer"; `Null` → "Add a null object to parent to").
In `scripts.js`, set `data-tip` (+ `data-tip-title`) on each script row, and `data-tip` on
the run/edit/reveal/remove action buttons (reuse current `title` strings).

### 3.6 Styles (`style.css`, tokens only)
`#dc-tooltip`: `background:var(--bg-raised)`, `border:1px solid var(--border-strong)`,
`color:var(--text)`, `border-radius:var(--radius)`, `font-size:12px`, `padding:6px 8px`,
`max-width:240px`, `line-height:1.35`, subtle shadow, `opacity` fade (0.12 s),
**`z-index:4000`** (above toast=3000). `.dc-tip-title{ font-weight:600; }`.

---

## 4. Feature B — Track A: in-panel parameter forms

### 4.1 Registry schema (one new optional field)
A script entry gains optional `params`. **Backward-compatible**: absent/empty ⇒ exactly
today's one-click Run.

```js
params: [
  { key:'spacing', label:'Spacing', type:'slider',   min:0, max:100, step:1, default:10 },
  { key:'mode',    label:'Mode',    type:'select',   options:['add','remove'], default:'add' },
  { key:'loop',    label:'Loop',    type:'checkbox', default:false },
  { key:'title',   label:'Title',   type:'text',     default:'' },
  { key:'count',   label:'Count',   type:'number',   min:1, default:1 }
]
```

Control types (v1): `text · number · slider · checkbox · select`.
Field rules per type:
- `text` → `default:string`.
- `number` → `default:number`; optional `min`/`max`/`step`.
- `slider` → **required** `min`/`max` (numbers, `min<max`); optional `step` (>0, default 1);
  `default:number` clamped into range.
- `checkbox` → `default:boolean`.
- `select` → **required** non-empty `options:string[]`; `default` must be in `options`
  (else coerced to `options[0]`).

### 4.2 Validation (`scripts-core.js`, pure, tested)
`validateParams(params)` → `{ valid, error }`:
- Each `key` matches `^[A-Za-z_$][A-Za-z0-9_$]*$` (so `DC_PARAMS.<key>` is valid) and is
  **unique** within the script.
- `type` ∈ the five; per-type required fields present and well-typed (per §4.1).
- `label` optional → defaults to `key`.
- Returns the first specific error (e.g. `Input "spacing": min must be less than max`).

`normalizeParams(params)` → coerces defaults, fills labels, drops unknown keys.

### 4.3 Authoring — "Inputs (optional)" builder
Added to the existing `#script-modal` (already `modal-box--wide`), for **both** snippet and
file sources. A new `panel/js/scripts-form.js` (`DCScriptsForm`) owns builder + run-form
rendering, to keep `scripts.js` under the 400-line budget (§7).
- Section: heading "Inputs (optional)", a rows container, and an "Add input" button.
- Each builder row: `[label][key][type ▾]` then type-dependent fields
  (`text`→default · `number`→default/min/max/step · `slider`→min/max/step/default ·
  `checkbox`→default · `select`→options(comma-separated)/default) and a remove `×`.
- On **Save**: read rows → `params` → `validateParams`; on error toast it and **block save**
  (reuses the existing `saveEntry` guard path). Valid params flow through `makeEntry`,
  `upsert`, `serializeRegistry` unchanged otherwise.

### 4.4 Running a form script (inline, no modal)
In `scripts.js` `onListClick` → `run`:
- If `s.params && s.params.length`: **toggle an inline `.script-form` panel** under that row
  (collapsing any other open one), rendered by `DCScriptsForm.renderRunForm(s)`, focus the
  first control. The form has a primary **Apply** button (+ collapse on re-click/Esc).
- Else: run immediately (today's path, untouched).
- **Apply** → `collectValues(params, formEl)` (pure, tested: `coerceValue` per type) →
  `valuesJson = JSON.stringify(values)` → dispatch to host (§4.5). On `{ok:true}`:
  `bumpUsage`, toast `Ran "name".`, collapse form. On error: toast host error, keep open.

### 4.5 Host run semantics (`jsx/scripts.jsx`, ES3, exported to `$.global`)
Two new fns alongside the existing ones; registered the same way (marker stays `scRunFile`):

- `scRunFileWithParams(path, valuesJson)`:
  1. Guard `new File(path).exists` → `jerr('Script file not found:\n'+path)`.
  2. Guard `valuesJson` is a non-empty string starting with `{` → else `jerr('Bad params.')`.
  3. Write a **temp wrapper** to `Folder.temp` (real path, not `/tmp` symlink — verified in
     2.3.0):
     ```jsx
     $.global.DC_PARAMS = <valuesJson>;
     $.evalFile(new File("<jsonEscape(path)>"));
     ```
     The user's file is **never modified**. `evalFile` the wrapper in try/catch; remove the
     temp in cleanup; return `{ok:true}` or `scErr(e)`.
- `scRunSnippetWithParams(body, valuesJson)`: same, but the temp file is
  `'$.global.DC_PARAMS = '+valuesJson+';\n' + body`.

**Injection safety:** `valuesJson` is produced panel-side by `JSON.stringify`, and JSON is a
strict subset of ExtendScript literal syntax, so concatenating it after `=` is valid and
**cannot break out** (all quotes/backslashes already escaped). Path is escaped into a JS
string with the existing host `jsonEscape()`. No undo group is forced (consistent with
2.3.0). Never throws to the panel.

### 4.6 Script contract (documented for the user)
Inside a Track-A script: read `DC_PARAMS`. Recommended guard so the same file still runs
outside DropComp:
```jsx
var P = $.global.DC_PARAMS || {};
var spacing = (P.spacing != null) ? P.spacing : 10;
```
A short "Make a script DropComp-driven" note goes in `README.md`.

---

## 5. Feature C — Track B: windowed third-party panels

### 5.1 Run path
Unchanged: `scRunFile`/`scRunSnippet` → `evalFile`; a `new Window('palette').show()` floats
non-blocking (verified 2.3.0).

### 5.2 Honest labeling
Optional boolean `opensWindow` on the entry, set by a checkbox in the editor: "This script
opens its own floating window." It only changes presentation — a distinct row icon, the
tooltip line, and the success toast ("Opened *name* in a floating AE window.") so the user
isn't left wondering where the UI went. No behavioral change.

### 5.3 Explicitly NOT possible (stated so expectations are honest)
DropComp **cannot** force single-instance, reposition, or dock a window created by a script
it doesn't own — the script itself calls `new Window`. The only way to get that control is
to adapt the script into a Track-A form. The spec records this so it isn't re-litigated.

---

## 6. Modules & files
| File | Change |
|---|---|
| `panel/js/tooltip.js` | **New.** `DCTooltip` controller + pure `clampPosition`, `buildScriptTip` (exported for tests). |
| `panel/js/scripts-form.js` | **New.** `DCScriptsForm`: builder rows + inline run-form render + `collectValues`. |
| `panel/js/scripts-core.js` | Add `validateParams`, `normalizeParams`, `coerceValue`, `buildValuesJson`; thread `params`/`opensWindow` through `validateEntry`/`makeEntry`/serialize. |
| `panel/js/scripts.js` | Editor builder wiring; inline run-form toggle + param dispatch; set `data-tip` on rows/actions. |
| `panel/index.html` | Load `tooltip.js` + `scripts-form.js`; `title`→`data-tip` migration; "Inputs" section markup in `#script-modal`; `opensWindow` checkbox. |
| `panel/css/style.css` | `#dc-tooltip`, `.script-form`, builder-row styles (tokens only). |
| `jsx/scripts.jsx` | Add `scRunFileWithParams`, `scRunSnippetWithParams` (+ `$.global` exports). |
| `tests/scripts-core.test.js` | Extend: param validation/coerce/buildValuesJson, entry round-trip with params. |
| `tests/tooltip.test.js` | **New.** `clampPosition` + `buildScriptTip`. |
| `tests/jsx.exports.test.js` | Add the two new `$.global` exports to the expected set. |
| `package.json` / `CSXS/manifest.xml` | Version bump 2.3.0 → 2.4.0. |

## 7. File-size discipline
`scripts.js` is 353 lines; builder + run-form would exceed 400, so that UI lives in the new
`scripts-form.js`. Each touched/new file stays < 400 lines (user contract). `tooltip.js`
target < 200.

## 8. Data flow (Track A run)
`row Run click → DCScripts (has params?) → DCScriptsForm.renderRunForm → user edits →
Apply → collectValues+coerce → JSON.stringify → DCBridge.call('scRunFileWithParams'|
'scRunSnippetWithParams',[target,valuesJson]) → host writes temp wrapper setting
$.global.DC_PARAMS → evalFile → script reads DC_PARAMS → {ok:true} → bumpUsage + toast.`

## 9. Error handling
- Reuse the bridge single-op lock + honest-toast model (no silent failures).
- Invalid builder input → specific toast, save blocked.
- Missing file on run → existing honest error + Relocate.
- Bad `valuesJson` or eval error → `scErr` → toast; temp file always cleaned up.

## 10. Testing (TDD; user's 80% floor on non-trivial logic)
- **Red→green unit** (`node --test`, zero-dep): `validateParams`, `coerceValue`,
  `buildValuesJson`, `normalizeParams`, `clampPosition`, `buildScriptTip`, entry round-trip
  with `params`/`opensWindow`.
- **ES3 lint** (`jsx.es3.test.js`) covers the two new host fns; **exports test** asserts the
  two new `$.global` names.
- **Live AE verify** (established harness): a form script reads `DC_PARAMS` (string/number/
  bool/select) and acts; a windowed script still floats; a no-params script unchanged.

## 11. AE assumptions to verify live before merge
- Setting `$.global.DC_PARAMS = <json>` in a temp wrapper, then `$.evalFile(realFile)`,
  makes `DC_PARAMS` readable inside the real file. (Expected: yes — evalFile runs in global
  scope; 2.3.0 verified temp-wrapper evalFile + Folder.temp writes.)
- A `.jsxbin` file still runs via the wrapper (it only adds a global before evalFile).

## 12. Decisions resolved
| Question | Decision | Why |
|---|---|---|
| Embed ScriptUI in the HTML panel? | **No — impossible.** Draw controls in HTML, pass `DC_PARAMS`. | Two unbridgeable rendering engines. |
| Form definition source | **In-editor builder** (manifest-comment deferred) | No syntax to learn; works for snippets + files + `.jsxbin`. |
| Run form: modal vs inline | **Inline row expansion** | Feels in-panel; one open at a time. |
| Param transport | `JSON.stringify` → inline after `=` in a temp wrapper | JSON ⊂ ES3 literal; injection-safe; file never mutated. |
| Tooltip text source | Reuse existing `title`s as `data-tip`; upgrade terse ones | Minimal churn; one fast styled box. |
| Windowed-script single-instance | **Not built — not possible** without adaptation | DropComp doesn't own the script's window. |
