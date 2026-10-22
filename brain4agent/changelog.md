# Changelog & Semantic Releases

Tất cả các quyết định kiến trúc và lịch sử nâng cấp phiên bản của dự án.

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

## [v1.12.0] - 2026-10-22: Review workflow
- Promote experiment/review-queue to main; remove TEST branding.
- Retain camera across frames; persist manual item review by origin/job/server ID.
- Add conservative single-frame fit proposals with accept/cancel and Undo; retain original segment auto-fit.
- Consolidate help text, always show box axes, simplify expanded view controls.
- Validation: 80/80 Node tests; prior Ego live checks documented in docs/REVIEW-WORKFLOW.md.

## [v1.0.0] - 2026-10-21: Initial Project Scaffolding
### Added
- Khởi tạo kiến trúc dự án và thiết lập hệ thống Bộ Nhớ Não Bộ `brain4agent/` Đa Tầng thế hệ mới.
