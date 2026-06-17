# DropComp — Handoff: Tools‑tab v2 fixes + Scripts manager + UI/UX overhaul

> Paste this entire document into a fresh Claude Code chat (ultracode on) opened in the DropComp repo. It is self‑contained. It assumes no memory of prior chats.

## 0. Mission

Take DropComp's **Tools tab** from "built but buggy" to production‑grade, **build the Scripts manager** (the user's second original feature), and run a **panel‑wide UI/UX overhaul**. Improve the tool as much as is reasonable.

**The one rule that matters most:** every After Effects (ExtendScript) behavior MUST be verified in a live AE session before it's called done. The bugs below shipped *because the host code was unit‑tested and code‑reviewed but never run in AE*. Automated tests cannot catch AE behavior. Treat in‑AE verification as the gate.

## 1. Orientation

- **DropComp** is an Adobe After Effects CEP panel (public repo `ziscolwp/dropcomp`). It already has a comp Library tab, an Assets tab, and a new **Tools** tab.
- **START HERE:** the Tools tab (v2.2.0) lives on branch **`feature/tools-tab`**, **not merged to `main`**. `git checkout feature/tools-tab` first — `main` does not contain the Tools tab. Do new work on a branch off `feature/tools-tab` (e.g. `feature/tools-v2`).
- **Architecture**
  - Panel (Chromium‑99, modern JS, IIFE modules exposing a `DCx` global + optional `module.exports`):
    `DCShell` (tabs/prefs/boot), `DCBridge` (single‑op lock → ExtendScript via `evalScript`), `DCState` (pure logic + `localStorage` prefs/usage), `DCUI` (modals/toast/spinner), `DCRender` (cards), `DCLibrary`/`DCAssets` (per‑tab card modules), `DCTools` (Tools controller, delegated click dispatch), `DCToolsCore` (pure helpers).
  - Host (ExtendScript, **ES3 only**): `jsx/hostscript.jsx` (main, ~755 lines, has a split‑TODO — don't grow it), plus modules `jsx/relink.jsx`, `jsx/assets.jsx`, `jsx/tools.jsx` loaded by `loadHostModules`. **Every top‑level function in a loaded module must export itself: `$.global.fn = fn;`** (`$.evalFile` runs in local scope). New AE ops go in `jsx/tools.jsx` (or a new module), never in `hostscript.jsx`.
  - **Generalized tab system:** a tab is a *card view* (Library/Assets: toolbar + grid) or a *custom view* (Tools: control surface). `DCState.resolveActiveTab(tab, hasAssets, hasTools)` + `#app.tools-active` CSS. The Scripts tab plugs into this same mechanism.
  - **Tests:** `npm test` (node `--test`, zero deps) covers pure panel logic + static guards (ES3 lint over every `jsx/*.jsx`; `$.global` export check; version parity). **Host/AE behavior is NOT covered — only manual AE testing catches it.**
- **Constraints (hard)**
  - `jsx/*.jsx` ES3 only: no `const`/`let`, arrow fns, template literals, `.map/.filter/.forEach/.reduce/.some/.every`, `Object.keys`, `Array.isArray` (`.push/.slice/.sort` are fine). Statically enforced by `tests/jsx.es3.test.js`.
  - Every host op: one `app.beginUndoGroup(...)`/`endUndoGroup()` closed on the catch path; guard preconditions; return JSON `{"ok":true,...}` or `jerr('msg')`; never throw to the panel.
  - File‑size target < 400 lines/file (`jsx` hard limit 800). Split by concern if needed.
  - Release coupling: bump `package.json`, `CSXS/manifest.xml` (two attrs), and `panel/js/update.js` together → **2.3.0** (`tests/update.test.js` enforces parity).
  - Theme tokens (reuse, invent no new palette): `--bg #161616`, `--bg-raised #222`, `--bg-inset #1d1d1d`, `--bg-hover #2a2a2a`, `--border #2e2e2e`, `--border-strong #3a3a3a`, `--text #f0f0f0`, `--text-mid #999`, `--text-dim #777`, `--gold #ffd700` (+ `--gold-dim/-bg/-hover`), `--danger`, `--radius 8px`.
- **Existing docs:** design spec `docs/superpowers/specs/2026-06-11-*` and `2026-06-17-tools-tab-design.md`; plan `docs/superpowers/plans/2026-06-17-tools-tab.md`; `README.md`. Dev install: `./dev-link.command` (symlinks the repo as the extension); reload by quitting/reopening AE or the panel.

## 2. Process

- **Part A (bug fixes):** these are diagnosed below. Reproduce each in AE first to confirm the root cause, fix in `jsx/tools.jsx`, then re‑verify in AE. Use `superpowers:systematic-debugging` where a cause is uncertain.
- **Part B (Scripts manager — new feature) and Part C (UI/UX overhaul — substantial):** run the full `superpowers:brainstorming → writing-plans → subagent-driven-development` flow. Each gets its own spec + plan.
- Bump to **2.3.0**. Keep `npm test` green. Drive per‑task reviews + a final whole‑branch review. Produce and **actually execute** a manual AE checklist.

---

## 3. PART A — Tools tab fixes (root causes diagnosed; verify each in AE)

### A1. Anchor 3×3 grid does nothing on shape layers
Root cause (high confidence), in `tlSetAnchor` (`jsx/tools.jsx`):
1. **Separated Position dimensions.** If a layer has Separate Dimensions on (common on shape layers, e.g. wiggle presets), the compound `ADBE Position` property's `.value`/`.setValue` throws. The per‑layer `catch (eL) {}` swallows it, `count` stays 0, and the user sees the misleading "Select a footage, shape, text, or solid layer."
2. **Empty shape rect.** `sourceRectAtTime(time,false)` on a shape layer returns layer‑space coords relative to the anchor; on an empty shape it's `0×0`, so all 9 cells map to `[0,0]`.
3. **Swallowed errors** hide the real cause.

Fix:
- Detect `posProp.isSeparated`; when true, read/write the X/Y(/Z) sub‑properties by ordinal index `posProp.property(1)/.property(2)/.property(3)` (don't use matchNames — they vary by version). Set anchor first, then position (the existing order is right).
- Guard `if (rect.width === 0 && rect.height === 0) { continue; }` (or accumulate a warning) so empty shapes don't silently move the anchor to `[0,0]`.
- Stop silently swallowing per‑layer errors — accumulate them and surface a real message when `count === 0`.
- **Extend the separated‑dimensions fix to `tlShift` and `tlLayerBounds`** (see A2) — they read/write `ADBE Position` the same way and are used by align/distribute/reset, so those break on the same layers.

Verify in AE: draw a Rectangle shape (no precomp) → click all 9 cells → anchor moves, layer doesn't jump. Repeat with Separate Dimensions enabled. Repeat with align/distribute/reset on shape layers.

### A2. Align row — "L C R T M B" unclear and "not fixed properly"
Meaning (for the user, and to put in tooltips): **L**eft / **C**enter‑horizontal / **R**ight, **T**op / **M**iddle‑vertical / **B**ottom — aligns selected layers to the selection's bounds (2+ layers) or the comp (1 layer).
Root cause of "not fixed properly" (`tlAlign`/`tlLayerBounds`):
1. **All‑non‑AVLayer selection** (cameras/lights) never updates the sentinel ref `{left:1e9,…,right:-1e9}`; `count` stays 0 → the false "Select a layer that can be moved." toast.
2. **Parented layers** compute wrong bounds — `tlLayerBounds` reads local Position and ignores the parent transform.
3. The **separated‑dimensions throw** (A1) in `tlLayerBounds`/`tlShift` fails the whole op (no inner try/catch there).

Fix:
- After the ref‑building loop, guard `if (ref.right < ref.left) { app.endUndoGroup(); return jerr('Cameras, lights, and audio layers can't be aligned.'); }`.
- In `tlLayerBounds`, convert to comp space by walking the parent chain and summing positions (accurate when parents aren't rotated; otherwise document + skip parented layers with a warning).
- Apply the A1 separated‑dimensions read/write in `tlShift` and `tlLayerBounds`.
- UX: replace the L/C/R/T/M/B letters and the `⇿ ⇳ ⟳` Unicode glyphs with inline‑SVG icons + tooltips, grouped (align / distribute / reset) with dividers — see Part C.

Verify in AE: 2 cameras selected → clear error; a parented layer aligns correctly; all 6 modes on normal + shape layers; 1 vs 2+ selection reference.

### A3. PreComp & Multi PreComp switch the active comp and "aren't made properly"
Root cause (`tlPreComp`/`tlMultiPreComp`):
1. **Viewer hijack:** `tlPreComp` calls `newComp.openInViewer()`, which switches the Composition viewer/timeline to the new precomp, losing the user's context.
2. **Active‑item ambiguity:** when a CEP panel button is clicked the panel can take focus, so `app.project.activeItem` may not be the comp the user thinks — making the precomp seem "not properly made."

Fix:
- Remove `newComp.openInViewer()` (or gate it behind an opt‑in param defaulting off; the panel passes no args). The new precomp layer is already in the source comp's timeline.
- Snapshot `app.project.activeItem`/`selectedLayers` at the very top and guard: `if (!comp || !(comp instanceof CompItem)) return jerr('No active composition — click inside the Timeline first, then run this.');`
- Confirm Multi PreComp yields exactly one comp per selected layer (indices are snapshotted; process descending — already done).

Verify in AE: PreComp leaves the viewer on the source comp; Multi PreComp on 3 layers → 3 separate comps; run immediately after clicking the panel (focus case).

### A4. Decompose adds an unwanted null
Root cause: `tlDecompose` creates the carrier null **unconditionally**, even when the precomp layer's transform is identity (nothing to carry).
Fix:
- Add `tlIsIdentityTransform(layer, comp)` (position == comp center, anchor `[0,0]`, scale `[100,100]`, rotateZ 0, opacity 100, and `numKeys === 0` on each). If identity → skip the null and leave the copied layers un‑parented; if non‑identity → create the null as today.
- **Definite bug to fix too:** `tlCopyTransform` currently copies only Position/Scale/RotateZ — it **drops opacity and 3D**, but the spec (§11.4) says transform+timing are transferred (opacity is part of transform). Add opacity, and copy the `threeDLayer` flag + 3D rotation/orientation when the source is 3D.
- Optional: error if `timeRemapEnabled` on the precomp layer (decompose can't preserve it).

Verify in AE: identity precomp → Decompose leaves **no** null and layers look identical; moved/scaled/faded precomp → null carries position/scale/rotation **and opacity**; 3D precomp preserved.

### A5. "Independent" is not understood
What it does: for a precomp layer whose source comp is reused elsewhere, it **duplicates the source comp and assigns the copy to this layer**, so editing this instance no longer affects the other copies (identical to Illustrator's "make unique").
Fix (UX; behavior is correct):
- **Rename the button "Make Unique."** "Independent" has no prior art in AE and reads like a property, not an action.
- Add a caption/tooltip: "Duplicates the source comp so this layer can be edited without affecting other instances." Optional small "fork" icon.
- Better guard message: "Select at least one precomp layer that shares its source comp."
- Report the count in the success toast (it currently says a flat "Made independent.").

Verify in AE: place one source comp as a precomp in two parents; Make Unique on one → a new source comp is created, that layer repoints to it, editing it doesn't affect the other.

### A‑extra (from review — fold in)
- `tlIndependent` silently ignores non‑precomp layers in a mixed selection; report how many were affected.
- **Success toasts everywhere should include counts/names** ("Aligned 3 layers", "Sequenced 5 layers", "Made 2 unique") — `OK_MSG` in `panel/js/tools.js` returns flat strings; the host already returns a `count`.

---

## 4. PART B — Scripts manager (feature #2)  ·  brainstorm → spec → plan → build

**User's original requirements:** they run **many** custom AE scripts and want to (a) **save/register each with a NAME + DESCRIPTION** ("this script does X") so they remember what each does and what they have; (b) handle **two sources** — pasted/written **snippets** AND external script **files** (`.jsx`/`.jsxbin`, including ScriptUI Panels) they deliberately keep **undocked** to keep AE panel real estate clean; (c) **run any script with one click** from DropComp instead of docking them all; (d) **organize** them (categories/search/favorites) because there are a lot. Goal: reclaim AE real estate while still using scripts optimally.

**Recommended design approach** (confirm in brainstorming):
- New **Scripts** tab. Decide card‑view (reuse `DCRender` + the Library/Assets card + action‑icon pattern) vs a custom control surface — a card/list reusing `DCState` (filter/sort/favorites/usage) + `DCRender` action icons (run / edit / reveal / remove) is the natural fit.
- **Storage:** a registry JSON `<library>/.dropcomp_scripts.json` (`{version, scripts:[…]}`), parallel to the comp index. Separate `localStorage` usage key `dropcomp_scripts_metadata` (lastRun/runCount/isFavorite), mirroring the assets pattern.
- **Entry schema:** `{ uniqueId, name, description, category, source:'file'|'snippet', path|null, body|null, addedAt, tags:[] }`. Snippets store `body` in the registry (portable with the library). File scripts store the **absolute path by reference** (not copied), so editing the file on disk stays live.
- **Run (new host module, e.g. `jsx/scripts.jsx`):** file → `$.evalFile(new File(path))`; snippet → write `body` to a temp `.jsx` then `$.evalFile` it. This is the real‑estate win: a ScriptUI `'palette'` script launched via `$.evalFile` opens as a **floating window**, so the user runs docked‑panel scripts on demand without docking them. Return `jerr` on missing file / eval error; wrap in an undo group where the script mutates the project.
- **Add/edit flows:** "Add script file" → `File.openDialog` (.jsx/.jsxbin) → register by reference + name/description/category modal; "New snippet" → modal with name/description/category + a code textarea; allow editing a snippet later.
- **Reuse** the custom‑vs‑card tab mechanism, `DCState`, categories/search/favorites like Library/Assets.
- **Open questions for brainstorming:** card vs control‑surface; `.jsxbin` (no editable/visible body); handling a missing external file (toast + relocate); optionally scanning AE's `Scripts/ScriptUI Panels` folder for quick‑add; "run once" vs "open as panel"; default category set; confirm‑before‑run for destructive scripts.
- **Verify in AE FIRST:** confirm `$.evalFile` on a temp `.jsx` works on macOS *and* Windows, and that a ScriptUI `'palette'` script launches as a floating window via `$.evalFile` from a CEP bridge call.

---

## 5. PART C — UI/UX overhaul (panel‑wide)  ·  brainstorm → plan → build

(Grounded in an audit of the current markup/CSS.)

**Highest‑impact:**
- **Iconography:** replace the `L C R T M B` letters + `⇿ ⇳ ⟳` glyphs with inline‑SVG icons (24×24, `stroke="currentColor"`, `stroke-width="2"`) matching the existing header/card style; add leading icons to Null/Adjust(ment)/Solid/Camera and the four pre‑comp buttons; tooltips on everything.
- **De‑gold the align row:** gold means "primary action" everywhere else but `.tool-icon` paints the whole align row gold — switch align/distribute/reset to neutral icon‑button tokens (`--bg-inset` bg, `--border`, `--text-mid` icon, hover `--bg-hover`/`--text`); reserve gold for CTAs/active/hover.
- **Shared icon registry:** promote `DCRender.ICONS` into a shared module consumed by cards + Tools + Scripts (one visual language; no duplicated SVG path strings).
- **Anchor grid:** add a bounding‑box frame so it reads as an anchor control; implement the spec's `.anchor-cell.on` active state (currently never defined or set); larger hit targets (~30px); per‑cell tooltips + `aria-label`; arrow‑key nav via roving `tabindex`.
- **States & feedback:** add **disabled** styling (dim + `not-allowed`) for tool buttons when no comp/selection; add a **busy/pending** look during in‑flight host calls; **counted** success toasts; a **neutral/info** toast variant for "busy" (not the red error tone).
- **Accessibility (biggest gap):** add a global `:focus-visible` ring (`outline: 2px solid var(--gold); outline-offset: 2px;`) and **remove every bare `outline:none`**; add `aria-label` to all icon‑only buttons; fix `--text-dim`#777 contrast on small text (use `--text-mid` or larger); hit targets ≥24 (cards) / ≥30 (anchor cells).
- **Tokens:** remove hardcoded hex (`#555`, `#999`, `#ddd`, `rgba(17,17,17,.88)`, literal `#161616`) → use the CSS vars.
- **Num/Step:** relabel to **"Count"** and **"Step (frames)"** + a one‑line helper ("Multiple layers: stagger them. One layer: duplicate ×Count.").
- **Empty states:** icon + CTA for Library/Assets/Scripts; show a fallback glyph on thumbnail load error instead of `display:none`.
- **Cross‑tab consistency:** Tools + Scripts share button tokens, icon style, toasts, empty/loading/focus treatments; the tab bar must fit 4 tabs at 400px.

**Constraints:** reuse the existing palette (no new colors), ≤400px width, Chromium‑99 only, no frameworks, inline‑SVG icons only (no icon font), keep files < 400 lines (extract the icon module / a Tools stylesheet section if needed).

**Acceptance criteria (checkable):** no bare letter/Unicode glyphs as buttons; gold only on CTA/active/hover; a visible focus ring on every interactive element; `aria-label` on every icon‑only button; anchor grid has a frame + active state; tools are visibly disabled when not runnable; toasts report counts; one shared icon source; empty states have a CTA; no horizontal scroll at 400px; file‑size contract held.

---

## 6. Definition of done
1. Every Part‑A bug fixed **and verified in a live AE session** (run the checklist).
2. Scripts manager brainstormed → spec'd → planned → built → verified in AE.
3. UI/UX acceptance criteria met.
4. `npm test` green (version bumped to 2.3.0; ES3 lint + exports pass).
5. A manual AE checklist written **and executed** (not just written).
6. Per‑task reviews + a final whole‑branch review; then finish the branch (merge/PR).

## 7. Why these bugs existed (don't repeat it)
The Tools tab was unit‑tested and code‑reviewed but **never run in After Effects** before being called complete. That is exactly why anchor‑on‑shapes, the false align toast, the precomp viewer‑hijack, and the decompose null shipped. **In‑AE verification is the gate, not an optional follow‑up.**
