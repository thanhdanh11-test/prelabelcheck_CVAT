# Extension audit — 2026-10-20

Scope: static review of `cvat-resize-extension/content.js`, manifest, documented workflows; local regression tests. No live CVAT job was changed. The Python CLI is a separate tool and is outside this audit.

## Fixed in 1.7.2

- Generated outside keys copied mutable attributes from the first key, potentially resetting later attribute values. New keys now inherit the preceding geometry metadata and leave attribute changes empty.
- Editor-created keys replayed attributes from a preceding key even when intervening keys had changed other attributes. New keys preserve the attribute history through inheritance.
- Saving allowed concurrent editing, fitting or preview replacement. The save flow now blocks panel input, rejects saving during fitting and captures the target job and payload for readback verification.
- Readback checked only partial geometry and visibility. It now also checks label, track/keyframe attributes, geometry length, finite coordinates and remaining shape flags.
- Late annotation/label responses could replace state after navigation or a newer refresh. Generation and job checks reject stale responses. Old point-cloud requests no longer update a newer editor's loading state.
- Label loading stopped after the first 500 entries. Pagination now loads all pages and checks that subsequent requests stay on the same origin. Label loading errors are surfaced.
- Undo restored geometry but left the dimension inputs at their edited values. Snapshots now restore these inputs too.
- Auto fit could affect interpolation outside its selected range. Neighbour frames now retain their original geometry as boundary keys.
- Auto fit could refine a manually adjusted reference, discard manually hidden keys or replace hidden-key geometry. Manual keys are retained, reference correction skips manual references, and hidden geometry is preserved.
- Truncated ASCII PCD silently added zero-filled points at the origin. Header/body validation rejects malformed data; nonfinite lidar returns are removed. Binary coordinates require float32/float64 and a complete body.
- Closing a preview during dragging cleared the model before finishing the drag. Editor teardown now happens before clearing the model and cancels ongoing fitting.
- Unsupported/empty tracks are disabled in the picker; unsupported preview requests produce explicit errors. Numeric attributes use browser validity checks before entering the model.
- Blocked session storage no longer interrupts successful save/reload or startup. Outside scanning uses a cursor rather than repeatedly shifting its frame array and checks cancellation before processing each frame.

## Verification

Run from repository root with Node.js 18+:

```sh
node --check cvat-resize-extension/content.js
node --test tests/extension.test.cjs
```

15 regression tests cover PCD decoding/validation, rotated point counting, interpolation, bottom anchoring, persisted data comparison, attribute inheritance, stale job responses, undo inputs and fit range/manual-anchor preservation and preview cancellation. Fitting orchestration is tested with deterministic fitting stubs; this does not establish real-cloud fitting accuracy.

## Remaining limitations and useful follow-ups

- Real Chrome/CVAT integration still needs testing: unpacked-extension reload, API schema/defaults, label pagination, keyboard/pointer interactions, fullscreen and delayed network requests.
- The extension cannot merge unsaved CVAT page edits. Save in CVAT before applying; the existing confirmation remains necessary.
- Sidebar object selection depends on CVAT DOM and inferred client IDs. A stable CVAT integration would be more reliable across versions.
- PCD `binary_compressed` remains unsupported. Add a tested decoder if actual jobs require it.
- Cancellation stops further fitting/scanning but does not abort in-flight HTTP downloads. An AbortController per operation would reduce wasted bandwidth.
- Long jobs still create DOM containers for every frame and retain an unbounded point-count cache. Windowing the frame list and bounding that cache would improve prolonged sessions.
- Auto-fit quality still requires representative real clouds: adjacent vehicles, long occlusions, sparse returns and non-sensor coordinate systems. Current tests verify orchestration, not tracking accuracy.
- No claim of complete defect elimination: browser integration and these documented limitations remain unverified or unresolved.

## Ego browser follow-up — 1.7.3

See [live UX evidence](EGO-UX-AUDIT.md). The content script was run directly on a real logged-in local CVAT job in Ego; native unpacked-extension installation remains untested. Confirmed preview, point-cloud rendering, resize/undo, visibility/undo, navigation, short-range fitting, fullscreen and empty-filter behavior. No annotation write was submitted. Remaining integration items above still apply beyond the flows exercised.

## v1.8.0 supersedes direct-server Apply

The historical save/reload behavior described above has been replaced. See [Apply directly in CVAT](LIVE-APPLY.md) for the current design, integration proof and native history/ID limitations. Apply now updates CVAT's local state; Save belongs to CVAT.
