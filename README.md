# DropComp 2.0

After Effects CEP panel: a personal library of reusable comps with thumbnails,
categories, favorites, and one-click import.

## Install

- Stable: run `./install.command` (copies files; backs up v1 first)
- Development: run `./dev-link.command` (symlinks this repo as the extension)

Restart After Effects, then Window > Extensions > DropComp.

## Library format

`<Library>/<Category>/<safeName>_<timestamp>/` containing `<safeName>.aep`,
`comp.png`, `metadata.json`, `(Footage)/`. Index cache: `<Library>/.dropcomp_index.json`
(version 2). Settings: `~/Documents/DropComp/library_path.txt`.

## Features

- Stash the selected comp (project must be saved once) - self-contained AEP + footage copy
- Add any external `.aep` from disk: copied into the library, thumbnail + resolution/
  duration/fps captured silently inside the current project (never closes your project)
- Generate chip on thumbnail-less items; "Set thumbnail from current frame" per card
- Rename keeps folder, AEP, metadata, and index in sync (transactional)
- Relink button (chain icon): finds missing footage in the open project by filename
  across the library tree and relinks it automatically
- Collapsible category sections, search, 4 sort modes, favorites, size slider
- Assets tab is a stub - planned for 2.1

## Development

- `npm test` - unit tests (node >= 18, zero deps) for the pure panel modules
- Panel JS: Chromium 99 (modern JS fine). `jsx/hostscript.jsx`: ExtendScript ES3 only.
- Manual AE checklist: docs/superpowers/plans/2026-06-11-dropcomp-2.0.md Task 17

Full design: `docs/superpowers/specs/2026-06-11-dropcomp-2-refinement-design.md`
