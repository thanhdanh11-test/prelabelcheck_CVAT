# Split after consecutive outside frames — v1.10.0

The tool defaults to splitting the selected track on reappearance after at least six consecutive outside frames. Users can change the integer threshold or disable splitting. This threshold counts frames, independently of the existing automatic-outside point-count threshold.

For visible frame 10, outside frames 11–16 and reappearance at frame 17, the first track retains its existing shapes through the outside key at 11. A second track begins at 17. Five-frame gaps do not split, separate short gaps do not accumulate, and leading/trailing outside without a visible segment on both sides creates no extra object. Only reappearances in the current job are considered. The rule uses final preview visibility, including existing, automatic and manually edited outside flags.

`track-split.js` runs as the same pure module in both content-script worlds. Preview computes boundaries from keyframe intervals and shows segment labels and start frames. Apply recomputes the split from the final payload in the MAIN-world bridge, after the existing target-conflict and UI-state checks. All resulting tracks replace the selected original in one native `job.annotations.commit` call; unrelated objects remain untouched. The CVAT collection implementation was inspected to confirm that this call registers all appended/removed objects in a single history entry.

The first segment adopts current server IDs. Additional tracks have no track/shape server IDs and get new client IDs on import, then server IDs on Save. Each new segment copies class and immutable attributes, seeds all effective mutable attributes at its first key (including changes during the hidden interval), and retains later attribute changes. Visible geometry is unchanged by splitting. Native Undo/Redo retains the server-ID caveat described in `LIVE-APPLY.md`.

## Verification

48 Node tests pass across the suite. Added coverage includes 5/6/7-frame boundaries, repeated outside keys, multiple gaps, leading/trailing/all-outside tracks, disabled splitting, job boundaries, rectangle tracks, attribute inheritance, no source mutation and 64 visibility patterns checked frame-by-frame for identical visible geometry and exactly one visible object. Bridge tests assert one commit, fresh IDs on additional segments, preservation of unrelated tracks, stale/invalid-input rejection and whole-operation Undo/Redo using the test collection. UI tests verify manual visibility changes update the split preview, invalid thresholds disable Apply, and per-item switching retains split settings.

Live v1.10 CVAT and actual server Save have not been exercised. The existing Ego task space was handed to the user during v1.9 testing and has not been reclaimed without authorization. No new live-browser pass is claimed.
