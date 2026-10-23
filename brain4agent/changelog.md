# Changelog & Semantic Releases

Tất cả các quyết định kiến trúc và lịch sử nâng cấp phiên bản của dự án.

## [v1.14.0] - 2026-10-23: Password-encrypted cache
- Native Web Crypto vault, encrypted cloud/origins; locked default uses RAM only. Create/unlock/lock/reset controls; verified legacy origin migration and cloud version fence.
- Keys never persisted; checklist IDs/panel/metadata remain outside encryption. Serialize multi-tab origin mutations and reset/clear; reject late crypto and tampering.
- Validation: 139 Node tests; 5 real IndexedDB checks; synthetic UI create/reopen/wrong-password/lock/reset, 1/1 preload, no JS errors. Company QA pending.

## [v1.13.6] - 2026-10-23: Persist split origins across reload
- Store origin identities per browser origin/job; rebuild runtime shortcuts using stable server IDs or unique pending geometry matches, never persisted client IDs.
- Preserve source labels for missing parents, disable unsafe navigation and report storage failures. Existing lost lineage cannot be recovered retroactively.
- Validation: 128/128 tests, zero skips; disabling persistence fails four regression tests; JS syntax passes. Live company Save/reload remains pending.

## [v1.13.5] - 2026-10-23: Refresh current usage guidance
- Update README, in-app help and review workflow for split origins/navigation, collapsed-frame shortcuts, free pan/zoom and upright-fit limits.
- Correct whole-track size-lock scope, checklist storage, close controls and test count; distinguish historical browser evidence from current unverified live Apply navigation.
- Validation: 124/124 Node tests, zero skips; content.js syntax check passes. Documentation/help only; company-server QA remains pending.

## [v1.13.4] - 2026-10-23: Clarify split origin and frame intervals
- Preview labels source item/server ID, segment bounds and hidden gaps; mark the first frame of each new segment.
- Apply returns uniquely matched destination client/server IDs and shows a historical sidebar receipt; unknown mappings remain explicit, no automatic retry.
- No split geometry, annotation attributes or storage changes. Receipt cleared on job change/reload; not synchronized with native Undo/Redo/Save.
- Add segment buttons in sidebar/expanded view; receipt navigation verifies live client IDs and reuses draft-preserving item switching.
- Frame toolbar shows yellow source label and parent shortcut for known children; job-local RAM links survive subsequent Apply/client-ID replacements, clear on reload/job change.
- Validation: 124/124 tests, zero skips; ID mapping mutation fails two tests. Local browser UI checked using synthetic draft/receipt; live Apply receipt on company CVAT unverified.

## [v1.13.3] - 2026-10-23: Free expanded-view navigation
- Remove box-relative pan clamp and 3x zoom-out cap in Top/Side/Front; keep pointer-anchored wheel zoom, adaptive cloud crop and double-click reset.
- Normalize wheel delta modes; reject non-finite viewport values; preserve annotation geometry.
- Validation: 114/114 tests, no skips; local CVAT job 97 reaches 42.521x / 300,820 displayed-crop points, reset succeeds and draft JSON remains unchanged. No Apply/Save; company-server QA pending.

## [v1.13.2] - 2026-10-23: Integrate collaborator changes
- Merge upstream ec93fe5 and 203456b with local six-face fitting, region selection, expanded zoom and collapsed-frame shortcuts.
- Preserve Top trajectory/ghost boxes, directional cache preload, checklist optimization, server-ID labels and upstream CLI selection by --track.
- Resolve drawView contract to accept both zoom-window coordinates and trajectory frame; retain a single set of outside controls in Advanced.
- Fix dropdown range leaking preview frames; regression checks cover per-track bounds and combined drawing arguments.
- Validation: 113/113 Node tests, 0 skipped; JS syntax, Python compilation and CLI help checked. npm audit unavailable (no lockfile). Browser/company-server QA pending; Apply/clientID behavior unchanged.
- Earlier local/upstream v1.13.x entries below are branch history; this entry is the consolidated state.

## [v1.13.1] - 2026-10-23: Compact fit controls and collapsed-frame keyboard
- Fit yaw and six faces always enabled; neutral accept/cancel row below expanded tools, hidden after completion.
- Arrow editing on selected collapsed frames; comma/period rotation (1°, Shift 15°) in the selected view.
- Validation: 94/94 Node tests, no skips; browser/company-server QA pending.
- Reviewed upstream 203456b: server-ID labeling does not change Apply/clientID behavior; dropdown frame-range regression reproduced. No upstream code merged.

## [v1.13.0] - 2026-10-22: Six-face fit and inline icon controls
- Single-frame fit fits all six faces by default: front/back and sides from object points (connected growth, shrink only onto seen faces, ±50 cm from the original face), floor onto the road (ring 0.4–1.2 m, flat-layer check), top onto the roof (98th percentile, ±60 cm height).
- Decision: unseen faces keep the previous size; a size change on accept follows "Khóa kích thước cả track" like an edge drag (whole track), one Undo step.
- Icon fit/accept/cancel in each small-view header and side by side in the expanded view; Enter accepts, Esc cancels.
- Expanded view: maximize any single view; wheel zoom in and out (0.1–3×) about the cursor, drag-pan, larger point cloud crop when zoomed out.
- Fix: "Xoá keyframe" now drops only spare keyframes (interpolation stays within 5 cm / 1° of every old keyframe) instead of every middle keyframe, so boxes no longer jump.
- Region drag, an opt-in mode toggled by an icon left of the fit icon (red when on): a left drag on empty space of an expanded Top/Side/Front view moves the box to the object points in the region, aligned to the seen face. Off by default; then the left drag pans as before (right/middle drag always pans).
- Sidebar reorganised by workflow: sticky Preview/Apply footer, auto-fit inert until preview, summary chips double as frame filters, rarely used options under a collapsed "Nâng cao".
- Close buttons by meaning: header "—" while previewing (hide, keep draft), "Thoát xem trước" text button for closing the preview, shrink icon to leave an expanded frame; expanded-view Undo button removed (⌘Z/Ctrl+Z); clear-keyframes as an icon.
- Validation: 91/91 Node tests; Ego live check on CVAT local job 97.

## [v1.13.1] - 2026-10-22: Cache lessons from CVAT
- Background preload now starts at the frame being viewed and prefers the direction of travel (CVAT PrefetchAnalyzer lesson); sequential when nothing was viewed yet.
- review-state reparses localStorage only when the stored text changes; renderReviewState uses a single Map (object-state-index lesson). ~210 ms → <1 ms per render at 500 tracks × 2,000 IDs (micro-benchmark).
- Tried and reverted a two-pass typed-array crop in nearCloud: 3.2 → 5.4 ms, slower.
- Validation: 100/100 Node tests (+5); mutation turned 3 red. Chrome/CVAT live gate open (planning/02_2026-10-22_cache-lessons).

## [v1.13.0] - 2026-10-22: Track path trace
- Add read-only "Truy vết ngược": walks the selected item from its last visible frame back to its first and lists centre, yaw, step, total length, net displacement, hidden gaps; top-down map and CSV copy.
- New pure module `track-path.js` (isolated world); no bridge, Apply or Save involvement. Reads loaded annotation, never the unapplied preview draft.
- Validation: 95/95 Node tests (+15); reverse-order mutation turned 11 red. Chrome/CVAT live gate still open (planning/01_2026-10-22_track-path-trace).

## [v1.12.0] - 2026-10-22: Review workflow
- Promote experiment/review-queue to main; remove TEST branding.
- Retain camera across frames; persist manual item review by origin/job/server ID.
- Add conservative single-frame fit proposals with accept/cancel and Undo; retain original segment auto-fit.
- Consolidate help text, always show box axes, simplify expanded view controls.
- Validation: 80/80 Node tests; prior Ego live checks documented in docs/REVIEW-WORKFLOW.md.

## [v1.0.0] - 2026-10-21: Initial Project Scaffolding
### Added
- Khởi tạo kiến trúc dự án và thiết lập hệ thống Bộ Nhớ Não Bộ `brain4agent/` Đa Tầng thế hệ mới.


### v1.14.0 local security hardening — 2026-10-23
Password moved to extension popup; private one-use challenge channel and same-origin global revocation, including pending initial creation on reset. 147 Node tests pass; actual installed Chrome/company gates pending. No new published release.
