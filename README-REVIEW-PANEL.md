# DropComp Review Panel Bundle

Created: 2026-06-25

This branch combines the current review-board work into one local DropComp panel build so
Tanmay can test everything together inside After Effects.

- Combined branch: `review/live-panel-combined-20260625`
- Worktree path: `/Users/ziscol/Ziscol Media Projects/dropcomp-review-combined`
- Baseline: `main` at `8ee2119` (`chore(release): bump to 2.5.0`)
- Verification command: `npm test`
- Latest local verification: `npm test` passed, 162 tests, 0 failures.

## Integration Notes

- The bundle includes every task currently in `REVIEW-KANBAN.md` under `Waiting For Review`.
- It also includes the `Approved` task branches that are not merged into `main`, so this local panel reflects the whole pending review board.
- The `feature/feat-006-keyframe-distribution` merge supersedes the older inline `tlSequence` implementation from `bug-003`; timing/keyframe actions now live in `jsx/tools-timing.jsx`.
- Manual smoke-test focus: after testing keyframe timing on one layer, clear key selection and verify layer timing behaves as expected on that same layer.
- No task status files were changed by this bundle. Use this README for the review pass, then move individual tasks to `needs-fix`, `approved`, or `done` as appropriate.

## Waiting For Review

| Review | ID | Type | Branch | What to test |
|---|---|---|---|---|
| [ ] | `bug-001` | Bug | `fix/bug-001-keyframes-not-adjusting` | Keyframed transform changes update at the playhead instead of ignoring existing keyframes. |
| [ ] | `bug-002` | Bug | `fix/bug-002-align-keyframed-setvalue` | Align a layer with Position keyframes; it should snap and add/update a playhead keyframe with no `setValue()` error. |
| [ ] | `bug-003` | Bug | `fix/bug-003-sequence-keyframes-setkeytime` | Select multiple keyframes and use timing/sequence controls; keyframes should move with no `setKeyTime` error. |
| [ ] | `bug-004` | Bug | `fix/bug-004-delete-small-library-cards` | Set Library card size very small, then delete a card; the delete action should stay reachable and clickable. |
| [ ] | `bug-006` | Bug | `fix/bug-006-undo-group-mismatch-import-v2` | Import an animation from the panel, select the new layer, then adjust it; no "Undo group mismatch" warning should appear. |
| [ ] | `feat-002` | Feature | `feature/feat-002-scripts-inpanel-dropdown` | Open a parameterized script; its UI should stay inside DropComp as an in-panel dropdown/form, not a floating window. |
| [ ] | `feat-005` | Feature | `feature/feat-005-solid-fill-effect` | Create a Solid from DropComp; it should automatically receive a Fill effect whose color controls the solid. |
| [ ] | `feat-006` | Feature | `feature/feat-006-keyframe-distribution` | Tools tab should show Amount/Step controls plus timing mode buttons; selected keyframes should align, sequence, reverse, and randomize correctly. |
| [ ] | `feat-008` | Feature | `feature/feat-008-folder-column-grid` | Turn on Folder columns in Display options; Library folder sections should pack into responsive columns while single-column layout remains available. |

## Approved But Included

These were already marked `approved` in the backlog, but their branches are still pending merge into `main`, so they are included in this combined local build.

| Review | ID | Type | Branch | What to spot check |
|---|---|---|---|---|
| [ ] | `feat-003` | Feature | `feature/feat-003-drag-drop-images` | Drag/drop image assets into the library flow still works alongside the other panel changes. |
| [ ] | `feat-004` | Feature | `feature/feat-004-null-auto-parent` | Create a Null with layers selected; selected layers should become parented to the new centered null. |
| [ ] | `feat-007` | Feature | `feature/feat-007-match-comp-length` | Match comp length should extend selected precomp sources and layers to the active comp duration. |

## Review Outcome Notes

Use this section while testing in AE.

- `bug-001`:
- `bug-002`:
- `bug-003`:
- `bug-004`:
- `bug-006`:
- `feat-002`:
- `feat-003`:
- `feat-004`:
- `feat-005`:
- `feat-006`:
- `feat-007`:
- `feat-008`:
