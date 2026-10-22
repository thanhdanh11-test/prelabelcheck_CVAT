# Changelog & Semantic Releases

Tất cả các quyết định kiến trúc và lịch sử nâng cấp phiên bản của dự án.

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
