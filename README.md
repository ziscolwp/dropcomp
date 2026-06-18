# DropComp 2.1

After Effects CEP panel: a personal library of reusable comps and image assets
with thumbnails, categories, favorites, and one-click import.

## Install

- macOS: run `./install.command` (copies files; backs up the previous version first)
- Windows: double-click `install.bat` (same thing: backup, copy, enable unsigned panels)
- Development (macOS): run `./dev-link.command` (symlinks this repo as the extension)

Restart After Effects, then Window > Extensions > DropComp. Updating = run the
installer again; your library folder, favorites, and settings are untouched.

## Library format

`<Library>/<Category>/<safeName>_<timestamp>/` containing `<safeName>.aep`,
`comp.png`, `metadata.json`, `(Footage)/`. Index cache: `<Library>/.dropcomp_index.json`
(version 2). Settings: `~/Documents/DropComp/library_path.txt`.

Assets live at `<Library>/Assets/<Category>/<file>` - plain image files, no
sidecars (the top-level `Assets` folder name is reserved). Index cache:
`<Library>/Assets/.dropcomp_assets_index.json` (version 1).

## Features

- Stash the selected comp (project must be saved once) - self-contained AEP + footage copy
- Add any external `.aep` from disk: copied into the library, thumbnail + resolution/
  duration/fps captured silently inside the current project (never closes your project)
- Generate chip on thumbnail-less items; "Set thumbnail from current frame" per card
- Rename keeps folder, AEP, metadata, and index in sync (transactional)
- Relink button (chain icon): finds missing footage in the open project by filename
  across the library tree and relinks it automatically
- Collapsible category sections, search, 4 sort modes, favorites, size slider
- **Assets tab** - a second library for reusable images (icons, logos, textures):
  multi-add from disk (png/jpg/gif/bmp/tif/tga/psd/ai/eps), the file itself is the
  thumbnail, import drops into the active comp at the playhead and reuses footage
  already in the project (one `Assets [DropComp]` bin, no duplicates)
- **Tools tab** - common AE layer utilities one click away: anchor-point 3×3 grid
  (scale-compensated), Null/Adjustment/Solid/Camera creators, align & distribute,
  Num/Step sequence-in-time, and pre-comp tools (PreComp, Decompose [AE 2022+],
  Multi PreComp, Independent). Each action is a single undo step.

## Scripts

### Make a script DropComp-driven (in-panel form)

Instead of opening its own floating window, a script can read its inputs from a
form DropComp renders inside the panel. In the script's editor, add Inputs (a key,
type, and default for each), then in the script read them from `DC_PARAMS`:

    var P = $.global.DC_PARAMS || {};   // P.spacing, P.mode, ...
    var spacing = (P.spacing != null) ? P.spacing : 10;

`DC_PARAMS` is set only when DropComp runs the script with a form, so the `|| {}`
guard keeps the script working if you run it the old way too. Third-party panels
you can't edit still run as a floating window — tick "opens its own floating window"
on them so the panel labels them honestly.

## Updates

The panel checks GitHub's latest release (at most every 12 h, silent offline)
and shows a gold "Update x.y.z" chip in the header when a newer version exists.
Clicking it opens the download page; installing is the same one-click installer.

## Releasing a new version

1. Bump the version in `package.json`, `CSXS/manifest.xml`, and `panel/js/update.js`
   (`npm test` fails if they disagree).
2. `npm test`
3. `./scripts/build-dist.sh`
4. `git tag vX.Y.Z && git push origin main vX.Y.Z`
5. `gh release create vX.Y.Z dist/DropComp-X.Y.Z.zip --title "DropComp X.Y.Z" --notes "..."`

Everyone on an older version sees the update chip within 12 hours of opening the panel.

## Development

- `npm test` - unit tests (node >= 18, zero deps) for the pure panel modules
- Panel JS: Chromium 99 (modern JS fine). `jsx/*.jsx`: ExtendScript ES3 only
  (statically enforced by tests/jsx.es3.test.js)
- Manual AE checklists: docs/superpowers/plans/2026-06-11-dropcomp-2.0.md Task 17,
  docs/superpowers/plans/2026-06-11-assets-tab.md Task 9

Full design: `docs/superpowers/specs/2026-06-11-dropcomp-2-refinement-design.md`
