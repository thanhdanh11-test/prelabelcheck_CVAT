# Split after consecutive outside frames — v1.10.0

The tool defaults to splitting the selected track on reappearance after at least six consecutive outside frames. Users can change the integer threshold or disable splitting. This threshold counts frames, independently of the existing automatic-outside point-count threshold.

For visible frame 10, outside frames 11–16 and reappearance at frame 17, the first track retains its existing shapes through the outside key at 11. A second track begins at 17. Five-frame gaps do not split, separate short gaps do not accumulate, and leading/trailing outside without a visible segment on both sides creates no extra object. Only reappearances in the current job are considered. The rule uses final preview visibility, including existing, automatic and manually edited outside flags.

`track-split.js` runs as the same pure module in both content-script worlds. Preview computes boundaries from keyframe intervals and shows segment labels and start frames. Apply recomputes the split from the final payload in the MAIN-world bridge, after the existing target-conflict and UI-state checks. All resulting tracks replace the selected original in one native `job.annotations.commit` call; unrelated objects remain untouched. The CVAT collection implementation was inspected to confirm that this call registers all appended/removed objects in a single history entry.

The first segment adopts current server IDs. Additional tracks have no track/shape server IDs and get new client IDs on import, then server IDs on Save. Each new segment copies class and immutable attributes, seeds all effective mutable attributes at its first key (including changes during the hidden interval), and retains later attribute changes. Visible geometry is unchanged by splitting. Native Undo/Redo retains the server-ID caveat described in `LIVE-APPLY.md`.

## Verification

65 Node tests pass across the current suite. Added coverage includes 5/6/7-frame boundaries, repeated outside keys, multiple gaps, leading/trailing/all-outside tracks, disabled splitting, job boundaries, rectangle tracks, attribute inheritance, no source mutation and 64 visibility patterns checked frame-by-frame for identical visible geometry and exactly one visible object. Bridge tests assert one commit, fresh IDs on additional segments, preservation of unrelated tracks, stale/invalid-input rejection and whole-operation Undo/Redo using the test collection. UI tests verify manual visibility changes update the split preview, invalid thresholds disable Apply, and per-item switching retains split settings.

### Live CVAT verification — 2026-10-21

Tested commit `81a753f` through Ego on local CVAT, using a new synthetic task **84**, job **105**, named `QA extension outside split 2026-10-21`. The task contains 24 PCD frames and four labeled tracks (`five`, `six`, `multi`, `control`). Existing work tasks were not modified. The QA task remains available for inspection at `http://localhost:8080/tasks/84/jobs/105`.

| Case | Expected | Observed |
|---|---|---|
| Outside frames 3–7; reappear 8 (5 hidden frames) | One object | Preview and Apply retained one object; Undo restored the original |
| Outside frames 3–8; reappear 9 (6 hidden frames) | Two objects, starts 0 and 9 | Correct preview, Apply, Undo/Redo, Save and reload |
| Outside 2–7 and 12–17 | Three objects, starts 0, 8, 18 | Correct preview, Apply, Undo/Redo, Save and reload |
| Disable splitting | No planned split | Correct preview |
| Raise threshold to 7 for the two six-frame gaps | No planned split | Correct preview |
| Unrelated tracks | Preserve content | Exact exported content unchanged by each tested split Apply |

For the six-frame case, the first segment ended with an outside key at frame 3. The additional track had no server ID before Save. A mutable attribute changed to `hidden` at frame 6, while outside; the new object inherited `hidden` at frame 9 and changed to `returned` at frame 14. Immutable case attributes and the label were preserved. Undo/Redo restored the whole operation, verified by normalized full annotation content in the single-gap case.

After native Undo/Redo and Save, the two six-frame segments had distinct server IDs **55, 56**. The multi-gap segments received **57, 58, 59**. Reload retained all seven resulting tracks. This also demonstrates the documented CVAT caveat: native Undo/Redo may cause the first segment to receive a new server ID on Save, even though its original server ID was retained on the initial Apply.

After the final reload, native `job.annotations.get` was checked for all 24 frames across all four cases: **96 visibility checks passed**, with exactly one visible segment wherever the original was visible, none during its outside interval, and the control object continuously visible. The saved geometry was also compared frame-by-frame to the baseline; no geometry changes were introduced by splitting. Apply retained the page time origin (no reload). Auto Save was off; persistence was tested through CVAT's Save button.

The scripts were loaded in manifest order into real MAIN/isolated execution worlds; this was not an unpacked-extension installation test. Automatic outside-by-point-count was disabled to isolate splitting of explicit source outside flags. No new defect was found in the exercised flows. Real-world occlusion detection and automatic outside generation are separate behaviors.

Local evidence: ignored `docs/evidence/split-*.json` files contain baseline, Apply, saved and reloaded annotations; `split-six-preview.png` and `split-reopened-frame9.png` capture the UI.
