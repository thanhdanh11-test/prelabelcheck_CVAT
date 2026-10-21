# Changelog & Semantic Releases

Tất cả các quyết định kiến trúc và lịch sử nâng cấp phiên bản của dự án.

## [v1.12.0] - 2026-10-22: Review workflow
- Promote experiment/review-queue to main; remove TEST branding.
- Retain camera across frames; persist manual item review by origin/job/server ID.
- Add conservative single-frame fit proposals with accept/cancel and Undo; retain original segment auto-fit.
- Consolidate help text, always show box axes, simplify expanded view controls.
- Validation: 80/80 Node tests; prior Ego live checks documented in docs/REVIEW-WORKFLOW.md.

## [v1.0.0] - 2026-10-21: Initial Project Scaffolding
### Added
- Khởi tạo kiến trúc dự án và thiết lập hệ thống Bộ Nhớ Não Bộ `brain4agent/` Đa Tầng thế hệ mới.
