# DropComp 2.3.0 — Manual AE Verification Checklist (EXECUTED)

> Executed against a **live After Effects 2026 (26.2x49)** session on 2026-06-18,
> in a throwaway blank project (the user's client project was saved + closed
> first; its file was never touched). Host functions were loaded exactly as the
> panel loads them and driven via `osascript … DoScript $.evalFile`. Each row was
> asserted programmatically (values read back from the live project), not eyeballed.
> Part B/C **panel UI** was verified in a 380px browser harness with a mocked CEP
> bridge (the host side is AE-verified; the core logic is unit-tested).

## Part A — Tools tab (host: jsx/tools.jsx)

| # | Check | Result |
|---|---|---|
| A1.1 | Anchor on a **shape** layer moves the anchor (no jump) | ✅ PASS |
| A1.2 | Anchor on a **text** layer works | ✅ PASS |
| A1.3 | Anchor on a **Separate-Dimensions** solid: anchor→[0,0], position→[810,440] via followers | ✅ PASS |
| A1.4 | Anchor on an **empty shape** → honest "no visible bounds" message (not the old lie) | ✅ PASS |
| A1.5 | Anchor on a **camera-only** selection → honest "cameras/lights have no anchor" | ✅ PASS |
| A2.1 | **Align** left on 3 shapes → all share the same left edge (shapes used to be skipped) | ✅ PASS |
| A2.2 | Align on **2 cameras** → honest "nothing to align to" (the false toast is gone) | ✅ PASS |
| A2.3 | **Recenter a parented** shape (null moved + anchor moved) → comp centre exactly | ✅ PASS |
| A2.4 | **Distribute** 3 shapes | ✅ PASS |
| A2.5 | **Mixed** selection (2 shapes + camera) → 2 aligned, camera skipped, no error | ✅ PASS |
| A3.1 | **PreComp** leaves the viewer on the source comp (no hijack) | ✅ PASS |
| A3.2 | **Multi PreComp** on 3 layers → exactly 3 comps | ✅ PASS |
| A4.1 | **Decompose** an identity precomp → **no null**, content unchanged | ✅ PASS |
| A4.2 | Decompose a **translated** precomp → content lands at the same comp point | ✅ PASS |
| A4.3 | Decompose a **scaled** precomp → null inherits the anchor (pivot correct) | ✅ PASS |
| A4.4 | Decompose with **opacity 40** → applied to the copies (parenting can't carry it) | ✅ PASS |
| A4.5 | Decompose a **3D** precomp → carrier null is 3D, carries the rotation | ✅ PASS |
| A5.1 | **Make Unique** on a shared precomp → that layer repoints, others unaffected | ✅ PASS |
| A5.2 | Make Unique on a **mixed** selection → reports `ignored: 1` | ✅ PASS |

## Part B — Scripts manager (host: jsx/scripts.jsx)

| # | Check | Result |
|---|---|---|
| B.1 | `scRunSnippet` executes a snippet with full DOM access (created a comp) | ✅ PASS |
| B.2 | `scRunSnippet` captures a syntax error with a line number | ✅ PASS |
| B.3 | `scRunSnippet` empty-body guard | ✅ PASS |
| B.4 | `scRunFile` runs an external .jsx | ✅ PASS |
| B.5 | `scRunFile` honest "file not found" for a missing path | ✅ PASS |
| B.6 | `scLoadRegistry` default for a missing registry; `scSaveRegistry`→`scLoadRegistry` round-trips exactly | ✅ PASS |
| B.7 | `scFileExists` true/false | ✅ PASS |
| B.8 | `loadHostModules` loads scripts.jsx end-to-end (marker `scRunFile` present) | ✅ PASS |
| B.9 | ScriptUI `'palette'` launches **non-blocking** as a floating window (real-estate win) | ✅ PASS |
| B.10 | `Folder.temp` is a real path (not the /tmp symlink); `Folder.create` + JSON write work there | ✅ PASS |

## Part B/C — Panel UI (browser harness, 380px, mocked CEP bridge)

| # | Check | Result |
|---|---|---|
| U.1 | Scripts tab activates; registry renders grouped by category | ✅ PASS |
| U.2 | Search / sort / favorites filter | ✅ PASS |
| U.3 | New Snippet → save → new row + new category; counted success toast | ✅ PASS |
| U.4 | Add File → picker → editor in file mode (path shown, body hidden) | ✅ PASS |
| U.5 | Run → "Ran …" toast; favorite toggle; file row has Reveal | ✅ PASS |
| U.6 | 4 tabs fit at 380px, no horizontal overflow | ✅ PASS |
| U.7 | Align row is de-golded (neutral icons); all icons are SVG (no letters) | ✅ PASS |
| U.8 | Anchor grid framed; clicking a cell sets the single `.on` active state | ✅ PASS |
| U.9 | `:focus-visible` ring present; 0 of 37 icon buttons unlabeled | ✅ PASS |
| U.10 | No console errors across all interactions | ✅ PASS |

## Not yet exercised in the live PANEL (recommended morning sanity)
The panel wasn't open in AE during the run (no debug port), so the UI was verified
in the harness. On reload of the real panel, spot-check: open the **Scripts** tab,
**Add File** a real `.jsx`, **Run** it (and a snippet), and click a couple of
**Tools** align icons on a shape — all host paths are already AE-verified above.
