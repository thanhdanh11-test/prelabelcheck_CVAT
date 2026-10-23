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

## v1.13.4 — identify source and resulting segments

Preview lists the source CVAT item number and server ID, each segment's frame interval, and the outside interval preceding a split. Frame headers show `Đoạn N từ item #…`; a reappearance starting a new item gets `BẮT ĐẦU ITEM MỚI` and a highlighted top border in the grid. These are proposed segments, not assigned item IDs. Intervals include hidden trailing frames owned by the previous segment; they do not imply visible boxes throughout. No frame data is created.

Shared contract: `CvatTrackSplit.ranges(shapes, cuts, start, stop)` returns `{startFrame,endFrame}[]`. Apply's existing result adds `segments: {startFrame,endFrame,clientID?,id?}[]`. The bridge computes ranges from the same cuts as the actual split; after the single native commit it maps replacements to newly exported client IDs by label, first keyframe and points, accepting only unique matches. It does not rely on export array order. Export failure leaves IDs absent and returns the existing applied-with-warning result; never retry the commit automatically. Existing request fields and split geometry are unchanged.

Sidebar retains the last Apply receipt with source → destination item numbers, server IDs and intervals. New tracks without server IDs explicitly say so. Unknown/ambiguous mappings say `chưa xác định item mới`; never invent IDs. This is a historical receipt at Apply time, not live lineage: it does not follow Undo/Redo/Save, disappears on page reload/job switch, and is replaced by the next Apply (hidden for an unsplit Apply). No annotation attributes or persistent storage are added.

Validation: 124/124 Node tests, zero skips; ID mapping mutation makes two bridge tests fail. Covers preview changes/disabled split, first-new-frame label, server versus client IDs, reordered export, post-commit export failure without retry, and native Undo/Redo. Ego local job 97 verifies preview/receipt DOM with synthetic draft and receipt data only; no Apply/Save. Real Apply receipt validation on company CVAT remains open.

### Segment navigation

Sidebar and expanded frame both expose `Đoạn gốc`, `Đoạn mới 2`, … with frame intervals. Preview buttons select/reveal the segment's first frame and clear frame filters so the destination is visible; expanded mode stays expanded. After Apply, buttons use the receipt's client IDs, verify against a fresh bridge snapshot, then reuse `switchTrack` to retain per-item draft and Undo before revealing the segment start. They select items inside the extension; they do not restore the old unsplit track or mutate annotations.

`navigateSplit(kind,index)` accepts `preview` or `receipt`; ignores invalid indices, concurrent navigation and pending fit/Apply/preview. Missing IDs disable destination buttons. Missing/stale targets after native Undo/Redo or edits report a reload requirement rather than guessing another ID. Late responses after job/plan/receipt changes are ignored. No persistent lineage is introduced.

Tests cover both directions, small/expanded views, filter clearing, existing switch path, missing/unknown IDs and stale async replies.

Ego local job 97, synthetic draft: sidebar button selects frame 16; expanded buttons switch 16 → 0 → 16. Draft shapes JSON unchanged throughout; no Apply/Save. Post-Apply item navigation remains covered by mocked bridge tests, not a live company-server run.

### Origin shortcut on the frame toolbar

The frame toolbar (beside the frame count) displays yellow `Tạo từ item #… · ID server …` for a known split child, with `Đến item gốc`. The source label records the item before splitting; the button targets the retained first segment's current client ID, not a deleted pre-split object. It reuses the verified navigation path and preserves drafts. Unknown target IDs disable the button; missing targets after Undo report a reload requirement.

A job-local RAM map `itemOrigins` retains known links across later Apply operations, including an unsplit Apply replacing parent/child client IDs. Links clear on job change/page reload; no annotation or persistent storage changes. Previously created items without a recorded link cannot be attributed retroactively. Origin text is hidden on unrelated items and on the retained parent (unless that parent was itself a known child).

124/124 tests; new coverage checks toolbar content/visibility, parent navigation, unrelated Apply, parent/child ID replacement and missing parent after Undo. The new toolbar shortcut has not yet been exercised with a real split Apply on company CVAT.

## v1.13.6 — persist origin shortcuts across reload

This supersedes the RAM-only origin limitation above; the last-Apply receipt remains session-only. `syncStoredOrigins(tracks)` runs on a successful job snapshot, including immediately after Apply. localStorage key `cvat-track-origins:v1:<jobId>` is scoped by browser origin. Payload: `{version:1,links:[{child:{id,fingerprint},target:{id,fingerprint},source:{uiId,id},startFrame,endFrame}]}`. No annotation metadata or bridge API changes.

Fingerprints encode label, immutable attributes and ordered keyframe geometry/visibility/rotation/mutable attributes, excluding allocated track/shape IDs and client IDs. Records with known server IDs MUST resolve only by that ID; pending records MUST match exactly one fingerprint. Ambiguous/missing children get no shortcut; missing parents retain the source label with a disabled button. Current client IDs are rebuilt from the snapshot and never persisted as identity. Successful resolution promotes pending identities to server IDs. Historical source item number is not the current navigation target.

Apply updates existing runtime parent/child links before storing the resulting collection. Unresolved history is retained for native Undo/Redo. Invalid JSON/schema or read/write/quota failure keeps runtime links and displays a warning; do not retry Apply. Persistence is local to this browser/server/job, not synchronized between machines. Concurrent tabs have no transactional merge guarantee. Clearing site data removes links. Save annotation before reload: storage does not save unsaved CVAT objects. If pending geometry is edited before a snapshot captures its server ID, matching may fail safely; refresh the tool after Save to capture IDs. Old links already lost before this patch cannot be reconstructed reliably.

Verification: 128/128 Node tests, zero skips; persistence-disabled mutation fails all four new regression cases. Tests cover a fresh runtime with Save-assigned IDs and changed client IDs, parent navigation, ID promotion, later edits with stable IDs, duplicate geometry, client-ID reuse, job isolation, missing parents, Undo recovery, corrupt storage and quota errors. JavaScript syntax check passes. Real Save/reload on company CVAT is still pending.

## v1.14.0 — encrypted origin storage
Origin persistence uses `cacheVault.readOrigins/writeOrigins` under one Web Lock; key `cvat-encrypted-origins:v1:<job>` contains an encrypted envelope. Legacy plaintext migrates after verification. Locked mode keeps new links in RAM; unlock merges without dropping unrelated history. Reload requires unlocking to restore labels. Last-Apply receipt remains RAM-only. See [CACHE-ENCRYPTION.md](CACHE-ENCRYPTION.md).
