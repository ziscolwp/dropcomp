# DropComp — SVG Asset Import Design

Date: 2026-06-18
Status: approved by user (design dialogue 2026-06-18); ready for planning

## 1. Goal

Let users add `.svg` files in the Assets tab through the existing
add → categorize → index → import-to-timeline flow, exactly like other image
assets. This is the first step toward a broader "import multiple formats"
capability; the design keeps adding further formats a one-line change.

User's words: *"In the assets panel I want an option to import multiple format
but for now we can start with adding an option of adding SVG."*

One product decision was made with the user:
- **SVG layers are auto-kept crisp.** On import, DropComp enables continuous
  rasterization so an SVG stays sharp when scaled past 100% (ideal for
  logos/icons). User chose this over AE's default raster behavior.

## 2. Verified facts (live AE 2026 / 26.2x49)

These were probed on the user's running AE via `osascript … DoScript` before
designing, because AE's SVG support is version-dependent and several layer
properties in this codebase throw on write:

| Probe | Result |
|---|---|
| `new ImportOptions(svg).canImportAs(FOOTAGE)` | `true` |
| `app.project.importFile(svg)` | imports, `typeName == "Footage"`, width read as declared px |
| Added timeline layer | `instanceof AVLayer == true` |
| `layer.collapseTransformation = true` on the SVG layer | settable, value sticks (no throw) |

**Conclusion:** AE 2026 imports SVG natively as footage. The existing
`importAsset` pipeline already handles it end-to-end. The *only* functional
blocker is that `svg` is absent from the host-side extension allowlist.

(AE added native SVG import in a recent version; older AE — still within the
manifest's `[15.0,99.9]` range — predates it. See §6 error handling.)

## 3. Approaches considered

**A. Native AE import via the existing footage pipeline (chosen).** Widen the
host allowlist; AE imports SVG as footage through the unchanged `importAsset`
path. Minimal surface, leans on verified native support, and the allowlist is a
clean extension point for future formats.

**B. Rasterize SVG → PNG on add.** Convert each SVG to a raster on copy.
Rejected: unnecessary now that native import works, adds a converter dependency,
and discards the vector scalability that is the whole point of SVG.

**C. Parse SVG → AE shape layers.** Convert vector paths into native shape
layers (à la Overlord). Rejected as out of scope: a large feature (full path
parser) with no need given native footage import. Could be a separate future
feature.

## 4. Change surface (3 files)

The asset extension allowlist has a **single source of truth**:
`DC_ASSET_EXTS` in `jsx/assets.jsx`. The panel side carries only display copy —
no duplicate allowlist — so there is one functional edit plus copy/tests.

### 4.1 `jsx/assets.jsx` (host, ES3 only)

1. Add `svg: 1` to `DC_ASSET_EXTS` (currently line 7). This single value flows
   through every consumer automatically:
   - `isSupportedAsset` → accepts `.svg` in the file picker result and in
     `addAssetFiles` (file is copied into `Library/Assets/<category>/`).
   - `assetEntryFromFile` / `rebuildAssetsIndex` → SVG is indexed and listed.
   - `importAsset` → SVG is imported as footage and dropped on the timeline.

2. In `importAsset`, on the **freshly-added-layer path only**, when the asset's
   extension is `svg`, set `newLayer.collapseTransformation = true` (continuous
   rasterization). Wrapped in its own `try/catch` so it can never break an
   otherwise-successful import. **SVG-scoped only** — existing `ai`/`eps`
   behavior is intentionally left unchanged to avoid regressing current users.

3. Update the `pickAssetFiles` dialog title ("Select image files") to wording
   that includes vectors (e.g. "Select image or vector files").

### 4.2 `panel/js/assets.js` (panel copy)

- Update the unsupported-files toast (currently line 125) from
  `"… (png, jpg, gif, bmp, tif, tga, psd, ai, eps)."` to include `svg`.
- Minor: broaden the empty-state copy (line 76) from "add images" to wording
  that acknowledges vectors. Cosmetic; no behavior change.

### 4.3 `tests/` (guard the change)

New `tests/assets.svg.test.js`, following the existing **source-reading** test
pattern (`assets.validation.parity.test.js` reads the `.jsx` as text and
regex-asserts), since the host file is ES3 and not a Node module:

- Assert `DC_ASSET_EXTS` in `jsx/assets.jsx` contains `svg`.
- Assert the continuous-rasterization line exists and is SVG-scoped (guards
  against it being applied unconditionally to all assets).
- Parity: assert the panel's supported-formats toast in `panel/js/assets.js`
  mentions `svg`, so display copy can't silently drift from the allowlist.

`jsx.es3.test.js` continues to enforce ES3-cleanliness of the host edit (the new
code — one object property and one guarded assignment — is ES3-safe).

## 5. Data flow (unchanged)

```
addFlow → pickAssetFiles (host dialog)
        → openCategoryModal → confirmCategory
        → addAssetFiles  (copy into Library/Assets/<cat>/, update index)
        → load → cards render (placeholder glyph; no preview thumbnail)
importItem → importAsset (import as Footage → add to active comp at playhead
                          → SVG: collapseTransformation = true)
```

SVG cards show the same placeholder glyph as any other asset without a
generated thumbnail — no rendering change.

## 6. Error handling

- `addAssetFiles` already skips unsupported/missing/dot files and reports a
  `skipped` list; SVG simply joins the supported set.
- `importAsset` already wraps failures and returns `"Error: " + e.toString()`.
  For the public-repo users on an **older AE that predates SVG import**, an SVG
  import will throw there. Improvement: when the failing asset is `.svg`, return
  a clearer hint (e.g. "This After Effects version may not support SVG import;
  update to a newer AE.") instead of the raw AE error string. The user's own
  machine (AE 2026) is unaffected; this is purely defensive for distribution.

## 7. Out of scope (YAGNI)

- Other formats (webp, heic, video, …) — trivial to add to `DC_ASSET_EXTS`
  later; deliberately not added now.
- SVG → shape-layer conversion (approach C).
- SVG preview thumbnails on asset cards.
- Auto-rasterization toggle UI — the crisp-scaling decision is fixed (auto-on)
  per the design dialogue.

## 8. Verification

- **Automated:** the new `assets.svg.test.js` plus the existing ES3 / exports /
  parity suites (`node --test`).
- **Manual (live AE):** add an `.svg` asset into a category, confirm it appears
  as a card, import it, confirm it lands on the active comp at the playhead and
  stays crisp when scaled above 100%. Record in the manual verification log
  alongside the existing 2.3.0 checklist.
