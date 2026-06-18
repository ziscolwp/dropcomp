# Self-Updater — Manual Verification

Date: 2026-06-18
AE version: 26.2x49 (After Effects 2026), macOS

| Check | Result |
|---|---|
| Panel loads with --enable-nodejs --mixed-context, no console errors | PASS / FAIL |
| Existing modules initialize (module.exports guard harmless) | PASS / FAIL |
| Chip → modal shows version + release notes | PASS / FAIL |
| Update now: progress runs through download→verify→backup→install | PASS / FAIL |
| backup-<ver>.zip written to ~/Documents/DropComp/ | PASS / FAIL |
| Code dirs swapped; new version reported after restart | PASS / FAIL |
| Library folder, library_path.txt, favorites untouched | PASS / FAIL |
| Failure path (e.g. network off mid-download): live version intact + manual fallback shown | PASS / FAIL |

## Windows — RELEASE GATE (must pass before shipping the release that contains the updater)

Run on a real Windows machine with AE installed:

| Check | Result |
|---|---|
| Panel loads with Node enabled, no errors | PASS / FAIL |
| Update now stages, prompts "quit & reopen AE" | PASS / FAIL |
| Quitting AE triggers the helper; files swap; status → ok | PASS / FAIL |
| Reopen AE: new version reported; backup zip in %USERPROFILE%\Documents\DropComp | PASS / FAIL |
| Forced failure rolls back; live version intact | PASS / FAIL |

Notes:
