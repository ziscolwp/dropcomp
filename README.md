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

## Development

- `npm test` - unit tests (node >= 18, zero deps) for the pure panel modules
- Panel JS: Chromium 99 (modern JS fine). `jsx/*.jsx`: ExtendScript ES3 only
  (statically enforced by tests/jsx.es3.test.js)
- Manual AE checklists: docs/superpowers/plans/2026-06-11-dropcomp-2.0.md Task 17,
  docs/superpowers/plans/2026-06-11-assets-tab.md Task 9

Full design: `docs/superpowers/specs/2026-06-11-dropcomp-2-refinement-design.md`
