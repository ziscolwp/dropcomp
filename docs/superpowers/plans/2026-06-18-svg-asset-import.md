# SVG Asset Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users add `.svg` files in the Assets tab through the existing add → categorize → import-to-timeline flow, with imported SVGs auto-set to stay crisp when scaled.

**Architecture:** AE 2026 imports SVG natively as footage (verified live), so the existing `importAsset` pipeline already handles it. The only functional blocker is `svg` being absent from the host extension allowlist. We widen that allowlist, enable continuous rasterization for SVG layers, and add an SVG-aware error hint for older AE versions. No new modules; three files touched.

**Tech Stack:** ExtendScript (ES3) host script, vanilla-JS CEP panel, `node --test` for source-assertion tests.

## Global Constraints

- **Host (`jsx/*.jsx`) is ES3 only** — no `const`/`let`, no arrow functions, no template literals (backticks), no `.map/.filter/.forEach/.reduce/.some/.every`, no `Object.keys`, no `Array.isArray`. Enforced by `tests/jsx.es3.test.js`.
- **Single source of truth** for supported extensions is `DC_ASSET_EXTS` in `jsx/assets.jsx`. The panel carries only display copy — never a second allowlist.
- **Continuous rasterization is SVG-scoped only.** Do not change existing `ai`/`eps` behavior.
- Host JSX is not a Node module — tests assert against the **source text** (pattern: `tests/assets.validation.parity.test.js`).
- Test runner: `npm test` (= `node --test "tests/**/*.test.js"`).
- Every commit message ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Verified target: AE 2026 / 26.2x49. Manifest range is `[15.0,99.9]`; native SVG import requires a recent AE, hence the error hint in Task 2.

## File Structure

- **Modify** `jsx/assets.jsx` — add `svg` to `DC_ASSET_EXTS`; in `importAsset`, set `collapseTransformation` for SVG layers and add an SVG-aware catch-path error; update the file-picker dialog title.
- **Modify** `panel/js/assets.js` — update the unsupported-files toast and empty-state copy to include vectors/svg.
- **Create** `tests/assets.svg.test.js` — source assertions: svg in allowlist, panel copy parity, SVG-scoped rasterization, SVG error hint.

---

### Task 1: SVG in the allowlist + supported-formats copy

This is the functional core: once `svg` is in `DC_ASSET_EXTS`, SVG files become selectable, copyable, indexable, and importable through the unchanged pipeline.

**Files:**
- Create: `tests/assets.svg.test.js`
- Modify: `jsx/assets.jsx:7` (allowlist), `jsx/assets.jsx:80` (dialog title)
- Modify: `panel/js/assets.js:76` (empty state), `panel/js/assets.js:125` (toast)

**Interfaces:**
- Consumes: existing `DC_ASSET_EXTS` map, `isSupportedAsset`, `assetExt` in `jsx/assets.jsx`.
- Produces: `svg` accepted everywhere `isSupportedAsset` gates (add/index/import). No new exports.

- [ ] **Step 1: Write the failing tests**

Create `tests/assets.svg.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const jsxSrc = fs.readFileSync(path.join(__dirname, '..', 'jsx', 'assets.jsx'), 'utf8');
const panelSrc = fs.readFileSync(path.join(__dirname, '..', 'panel', 'js', 'assets.js'), 'utf8');

test('svg is in the host asset extension allowlist', () => {
  const m = /var DC_ASSET_EXTS = \{([^}]*)\}/.exec(jsxSrc);
  assert.ok(m, 'DC_ASSET_EXTS map not found');
  assert.match(m[1], /\bsvg\s*:\s*1\b/, 'svg missing from DC_ASSET_EXTS');
});

test('panel supported-formats copy mentions svg', () => {
  assert.match(panelSrc, /No supported image files selected[^']*svg/,
    'panel unsupported-files toast does not mention svg');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="svg is in the host|panel supported-formats"`
Expected: FAIL — `svg missing from DC_ASSET_EXTS` and `panel unsupported-files toast does not mention svg`.

- [ ] **Step 3: Add `svg` to the allowlist**

In `jsx/assets.jsx:7`, change:

```javascript
var DC_ASSET_EXTS = { png: 1, jpg: 1, jpeg: 1, gif: 1, bmp: 1, tif: 1, tiff: 1, tga: 1, psd: 1, ai: 1, eps: 1 };
```

to:

```javascript
var DC_ASSET_EXTS = { png: 1, jpg: 1, jpeg: 1, gif: 1, bmp: 1, tif: 1, tiff: 1, tga: 1, psd: 1, ai: 1, eps: 1, svg: 1 };
```

- [ ] **Step 4: Update the file-picker dialog title**

In `jsx/assets.jsx:80`, change:

```javascript
    var files = File.openDialog('Select image files', undefined, true);
```

to:

```javascript
    var files = File.openDialog('Select image or vector files', undefined, true);
```

- [ ] **Step 5: Update the panel copy**

In `panel/js/assets.js:125`, change:

```javascript
          DCUI.toast('No supported image files selected (png, jpg, gif, bmp, tif, tga, psd, ai, eps).', true, 6000);
```

to:

```javascript
          DCUI.toast('No supported image files selected (png, jpg, gif, bmp, tif, tga, psd, ai, eps, svg).', true, 6000);
```

In `panel/js/assets.js:76`, change:

```javascript
      ? 'No assets yet. Click Add Assets to add images.'
```

to:

```javascript
      ? 'No assets yet. Click Add Assets to add images or vectors.'
```

- [ ] **Step 6: Run the new tests + ES3 lint to verify pass**

Run: `npm test -- --test-name-pattern="svg is in the host|panel supported-formats|assets.jsx contains no ES5"`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add tests/assets.svg.test.js jsx/assets.jsx panel/js/assets.js
git commit -m "$(cat <<'EOF'
feat(assets): support SVG files in the asset library

Add `svg` to the host extension allowlist (single source of truth), so
SVG files can be added, indexed, and imported through the existing
footage pipeline. AE 2026 imports SVG natively as footage. Updates the
file-picker dialog title and the panel supported-formats copy.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Keep imported SVGs crisp + SVG-aware error

Two small edits to `importAsset`, both keyed off `assetExt(...) === 'svg'`: enable continuous rasterization on the new layer, and return a clearer error when an SVG import throws (older AE that predates native SVG support).

**Files:**
- Modify: `tests/assets.svg.test.js` (append two tests)
- Modify: `jsx/assets.jsx` — inside `importAsset` (the timeline-add block ~line 254 and the catch block ~line 267)

**Interfaces:**
- Consumes: `assetExt(fileName)` (existing, returns lowercase ext string); `newLayer` (the `AVLayer` added in the timeline block); `filePath` (function parameter).
- Produces: no new exports; `importAsset` return string unchanged on success, extended on SVG failure.

- [ ] **Step 1: Write the failing tests**

Append to `tests/assets.svg.test.js`:

```javascript
function importAssetBody() {
  return jsxSrc.slice(
    jsxSrc.indexOf('function importAsset'),
    jsxSrc.indexOf('// ---- exports')
  );
}

test('importAsset keeps svg layers crisp via continuous rasterization', () => {
  const body = importAssetBody();
  assert.match(body, /collapseTransformation\s*=\s*true/, 'continuous rasterization not set');
  // must be svg-scoped, not applied to every asset
  assert.match(body, /'svg'[\s\S]{0,120}collapseTransformation\s*=\s*true/,
    'collapseTransformation must be guarded by an svg check');
});

test('importAsset returns an svg-specific hint when import fails', () => {
  assert.match(importAssetBody(), /may not support SVG/,
    'no svg-specific error hint in the catch path');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="keeps svg layers crisp|svg-specific hint"`
Expected: FAIL — `continuation rasterization not set` / `no svg-specific error hint in the catch path`.

- [ ] **Step 3: Enable continuous rasterization for SVG layers**

In `jsx/assets.jsx`, inside `importAsset`, find the deselect loop in the timeline-add block:

```javascript
                for (var k = 1; k <= activeComp.numLayers; k++) {
                    if (activeComp.layer(k) !== newLayer) activeComp.layer(k).selected = false;
                }
                addedToTimeline = true;
```

Change it to (insert the SVG block before `addedToTimeline = true;`):

```javascript
                for (var k = 1; k <= activeComp.numLayers; k++) {
                    if (activeComp.layer(k) !== newLayer) activeComp.layer(k).selected = false;
                }
                // SVG is vector: keep it crisp when scaled past 100%
                if (assetExt(assetName) === 'svg') {
                    try { newLayer.collapseTransformation = true; } catch (eRast) { }
                }
                addedToTimeline = true;
```

- [ ] **Step 4: Add the SVG-aware error in the catch block**

In `jsx/assets.jsx`, find the `importAsset` catch block:

```javascript
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) { }
        try { if (suppressing) app.endSuppressDialogs(false); } catch (e3) { }
        return 'Error: ' + e.toString();
    }
```

Change it to:

```javascript
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) { }
        try { if (suppressing) app.endSuppressDialogs(false); } catch (e3) { }
        if (assetExt(filePath) === 'svg') {
            return 'Error: SVG import failed - this After Effects version may not support SVG. Update to a newer After Effects. (' + e.toString() + ')';
        }
        return 'Error: ' + e.toString();
    }
```

- [ ] **Step 5: Run the new tests to verify pass**

Run: `npm test -- --test-name-pattern="keeps svg layers crisp|svg-specific hint"`
Expected: PASS (2 tests).

- [ ] **Step 6: Run the full suite (ES3 + parity + everything)**

Run: `npm test`
Expected: PASS — all tests green, including `assets.jsx contains no ES5+ syntax` and the existing parity/exports suites. No regressions.

- [ ] **Step 7: Commit**

```bash
git add tests/assets.svg.test.js jsx/assets.jsx
git commit -m "$(cat <<'EOF'
feat(assets): keep imported SVGs crisp and clarify SVG errors

Enable continuous rasterization on imported SVG layers so they stay sharp
when scaled past 100% (verified settable on AE 2026). SVG-scoped only;
ai/eps behavior unchanged. Add an SVG-aware error hint for older AE
versions that predate native SVG import.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Manual live-AE verification + log

Source tests can't exercise the real AE import. Verify end-to-end in the running panel and record the result, matching the project's existing manual-verification practice.

**Files:**
- Create: `docs/superpowers/verification/2026-06-18-svg-asset-import.md` (verification log)

**Interfaces:**
- Consumes: the shipped Task 1–2 code, loaded into AE via the dev symlink.
- Produces: a dated pass/fail log entry.

- [ ] **Step 1: Get the updated host code into AE**

Ensure the dev symlink is active so AE loads this repo's `jsx/`:

Run: `./dev-link.command`
Expected: confirms the extension is linked into the CEP extensions folder (or "already linked").

- [ ] **Step 2: Reload the DropComp panel in AE**

In After Effects: close the DropComp panel and reopen it from `Window → Extensions → DropComp` (forces a fresh load of `hostscript.jsx` + modules). Open or create a project with at least one composition, and make that comp the active/foreground item.

- [ ] **Step 3: Add an SVG asset**

In the Assets tab: click **Add Assets**, select a `.svg` file, choose a category, confirm. Expected: toast reports `1 asset added`, and a card for the SVG appears in that category (placeholder glyph thumbnail).

- [ ] **Step 4: Import and check crispness**

Click the SVG card's import action. Expected: a new layer is added to the active comp at the playhead and selected; toast reads `Success: '<name>.svg' imported and added to timeline.` In the timeline, confirm the layer's **Continuously Rasterize / Collapse** switch (sunburst icon) is ON. Scale the layer to ~400% and confirm edges stay sharp (no pixelation).

- [ ] **Step 5: Record the result**

Create `docs/superpowers/verification/2026-06-18-svg-asset-import.md`:

```markdown
# SVG Asset Import — Manual Verification

Date: 2026-06-18
AE version: 26.2x49 (After Effects 2026)

| Check | Result |
|---|---|
| .svg selectable in Add Assets and copied into category | PASS / FAIL |
| SVG card appears in the Assets grid | PASS / FAIL |
| Import adds a layer to the active comp at the playhead | PASS / FAIL |
| Imported SVG layer has Continuously Rasterize ON | PASS / FAIL |
| SVG stays crisp scaled to ~400% | PASS / FAIL |

Notes:
```

Fill in PASS/FAIL from Steps 3–4. If any check fails, stop and debug before continuing.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/verification/2026-06-18-svg-asset-import.md
git commit -m "$(cat <<'EOF'
docs(assets): log manual SVG import verification (AE 2026)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**1. Spec coverage**

| Spec section | Task |
|---|---|
| §4.1.1 add `svg` to `DC_ASSET_EXTS` | Task 1 (Step 3) |
| §4.1.2 SVG-scoped continuous rasterization | Task 2 (Step 3) |
| §4.1.3 dialog title includes vectors | Task 1 (Step 4) |
| §4.2 panel toast + empty-state copy | Task 1 (Step 5) |
| §4.3 new source-assertion tests (allowlist, scoping, parity) | Task 1 (Step 1), Task 2 (Step 1) |
| §6 SVG-aware error for older AE | Task 2 (Step 4) |
| §8 automated suite + manual AE verification | Task 2 (Step 6), Task 3 |

No gaps.

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"write tests for the above". Every code step shows complete code. PASS/FAIL in the verification log is intended fill-in data, not a plan placeholder.

**3. Type consistency:** `assetExt(...)` used identically in Task 2 Steps 3–4 and matches its existing signature (returns lowercase ext string). `newLayer` is the `AVLayer` from the timeline block. `filePath` is the `importAsset` parameter. `collapseTransformation` spelled consistently across implementation and tests. `importAssetBody()` helper defined once in Task 2 Step 1 and reused. Test names referenced in `--test-name-pattern` match the `test('...')` titles exactly.
