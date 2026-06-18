# SVG Asset Import — Verification

Date: 2026-06-18
AE version: 26.2x49 (After Effects 2026)
Branch: `feature/svg-asset-import` (isolated worktree)

## Automated source tests

`npm test` → **82 tests, 82 pass, 0 fail**, including:

- `svg is in the host asset extension allowlist`
- `panel supported-formats copy mentions svg`
- `importAsset keeps svg layers crisp via continuous rasterization` (svg-scoped)
- `importAsset returns an svg-specific hint when import fails`
- `assets.jsx contains no ES5+ syntax` (host edits stay ES3-clean)

## Live-AE probe (actual edited code, self-cleaning)

A DoScript probe `$.evalFile`'d the edited `jsx/assets.jsx` into the running
AE engine and exercised the real functions plus the AE primitives
`importAsset` depends on. No comp viewer was opened; the temp comp and
imported footage were removed afterward.

| Check | Result |
|---|---|
| `jsx/assets.jsx` parses/loads in AE; `typeof importAsset === 'function'` | PASS |
| `isSupportedAsset('logo.svg')` (allowlist edit, live) | PASS (true) |
| `isSupportedAsset('notes.txt')` (control) | PASS (false) |
| `assetExt('/a/b/c.svg')` | PASS (`svg`) |
| `ImportOptions(svg).canImportAs(FOOTAGE)` | PASS (true) |
| `importFile(svg).typeName` | PASS (`Footage`) |
| added layer `instanceof AVLayer` | PASS (true) |
| `layer.collapseTransformation = true` (continuous rasterization) | PASS (sticks) |

This confirms the edited module loads in the real ExtendScript engine, the
allowlist change takes effect, and every AE operation `importAsset` performs
for an SVG works on AE 2026.

## In-panel UI flow — pending user run

Not auto-run: AE was a single shared instance with a concurrently-active
session, and the in-panel test would require either re-pointing the dev-link
(hijacking the other session's panel) or opening a comp viewer. Run this when
AE is free, on the `feature/svg-asset-import` worktree:

1. Point the dev-link at the worktree, or merge to a branch AE loads; reload
   the DropComp panel (`Window → Extensions → DropComp`).
2. Assets tab → **Add Assets** → pick a `.svg` → choose a category → confirm.
   Expect: `1 asset added`, an SVG card appears.
3. Import the SVG card. Expect a layer added to the active comp at the
   playhead; toast `Success: '<name>.svg' imported and added to timeline.`
4. Confirm the layer's Continuously Rasterize switch is ON; scale to ~400%
   and confirm edges stay crisp.

| Check | Result |
|---|---|
| .svg selectable in Add Assets and copied into category | PENDING |
| SVG card appears in the Assets grid | PENDING |
| Import adds a layer to the active comp at the playhead | PENDING |
| Imported SVG layer has Continuously Rasterize ON | PENDING |
| SVG stays crisp scaled to ~400% | PENDING |
