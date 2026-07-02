# DropComp 2.7

After Effects CEP panel: a personal library of reusable comps and image assets
with thumbnails, categories, favorites, and one-click import.

## Install

- **Recommended (Mac & Windows)** — download `DropComp-<version>.zxp` from the
  [latest release](https://github.com/ziscolwp/dropcomp/releases/latest) and
  open it with the free [aescripts ZXP Installer](https://aescripts.com/learn/zxp-installer/)
  (drag the file in, done). No Terminal, no security prompts. After the first
  install, updates arrive through the panel's built-in Update button.
- macOS alternative — paste this in Terminal (⌘-Space, type "Terminal"):

  ```
  curl -fsSL https://raw.githubusercontent.com/ziscolwp/dropcomp/main/install.sh | bash
  ```

  (Gatekeeper blocks the double-clickable `install.command` for unsigned
  developers; from Terminal, `bash install.command` inside the zip also works.)
- Windows alternative: download the release zip and double-click `install.bat`
- Development (macOS): run `./dev-link.command` (symlinks this repo as the extension)

Release builds: `./scripts/build-dist.sh` (zip) and `./scripts/build-zxp.sh`
(self-signed .zxp for the ZXP Installer) — upload both as release assets.

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
guard keeps the script working if you run it the old way too. Third-party ScriptUI
panels cannot be embedded inside DropComp; mark them as requiring a separate AE
window so the run button stays in-panel instead of launching their floating UI.

## Updates

The panel checks GitHub's latest release (at most every 12 h, silent offline)
and shows a gold "Update x.y.z" chip in the header when a newer version exists.

Click the chip → **What's new** → **Update now**, and the panel updates itself:
it downloads the release from GitHub, verifies it (size + SHA-256 + unzip
check), backs up your current install to `~/Documents/DropComp/backup-<version>.zip`
(Windows: `%USERPROFILE%\Documents\DropComp\`), swaps in the new files, and asks
you to restart After Effects. Your library folder, favorites, and settings are
never touched. If anything fails, your current version is left intact and the
chip still offers a manual download.

- **macOS:** the swap happens immediately — restart AE to finish.
- **Windows:** files in use can't be replaced while AE runs, so the update is
  staged and applied automatically the moment you quit AE; reopen AE to finish.

**Rollout:** one-click self-update works from the first release that contains it
onward. If you're on an older build, install the next release once with the
manual installer (`install.command` / `install.bat`); every update after that is
one-click.

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
