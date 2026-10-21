# Apply directly in CVAT — v1.8.0

Implemented 2026-10-21. Apply now changes the open CVAT annotation collection, refreshes the current frame and creates one native Commit annotations history action. It does not PATCH the annotation server or reload the document. Save (or CVAT Auto Save, if enabled) persists the result.

The MAIN-world bridge uses `window.cvatUI.registerComponent` to obtain CVAT's store, then calls `job.annotations.export`, `commit` and `get`. The isolated content script requests snapshots and commits over a same-origin page message channel. Missing/incompatible plugin APIs produce an error; there is no direct-server fallback.

The tool reads unsaved page data and real client IDs. It compares an immutable baseline against the current target before applying, rejects stale/deleted targets and leaves other objects alone. Saving, playback, drawing, locked tracks and Review mode block Apply. After an ambiguous timeout the preview is marked stale and the user must refresh the tool before retrying. A failure to refresh the canvas after commit is reported as already applied, preventing duplicate automatic commits.

## Verification

21 tests pass with `node --test tests/*.test.cjs`; both scripts pass `node --check`; `git diff --check` passes. Tests cover native-commit orchestration, baseline conflicts, preservation of unrelated unsaved edits, unsupported UI states, post-commit refresh failures, adopting newly assigned server IDs, content-to-bridge payloads and existing preview/geometry behavior.

Ego Lite, real local CVAT job 97:

- L changed from 4.178469515232308 to 5.178; CVAT's current rendered object state reflected 5.178 immediately.
- `performance.timeOrigin` and current frame stayed unchanged: no reload.
- Exactly one track remained; server ID 49 was retained on the initial apply; native history gained one Commit annotations entry.
- Native Undo restored original dimensions; Redo restored the applied dimensions.
- A separate tab ran `content.js` in a CDP-created isolated world and the bridge in MAIN, matching extension world separation. Changed both class (638 → 639) and L (→ 4.5), applied successfully, then native Undo restored class/dimensions.
- Editing the target through native ObjectState.save after opening preview caused Apply to reject the stale baseline. The intervening edit remained and no extra commit appeared. The test edit was subsequently undone.
- Annotation JSON read from the server before/after was identical. No Save was submitted. Test geometry changes were undone before closing the test tabs.

Local screenshot: `docs/evidence/ego-2026-10-21-applied.png`. Evidence images contain CVAT job data and are excluded from Git.

## Limits

Native CVAT Commit replaces the client object, so its sidebar # can change. CVAT also clears server IDs on objects removed by Undo/Redo; a later Save may delete/recreate the track with a new server ID. This is CVAT's native commit/history behavior. External integrations that depend on permanent track IDs should account for it.

Native unpacked-extension installation and an actual server Save were not exercised. Chrome 111+ is declared for MAIN-world manifest support. Live testing covered cuboid tracks on the local CVAT version; rectangle handling and other hosted CVAT versions still need integration coverage. Filters and ground-truth overlays are retained during frame refresh; camera state is not recreated by the bridge.
