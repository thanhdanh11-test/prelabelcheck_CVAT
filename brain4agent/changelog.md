# Changelog & Semantic Releases

Tất cả các quyết định kiến trúc và lịch sử nâng cấp phiên bản của dự án.

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
