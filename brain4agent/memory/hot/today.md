# 📅 Nhật Ký Làm Việc Ngày 2026-10-21 (Session Memory Log)

> Cập nhật lúc: `2026-10-21T17:25:37.254Z` | Phiên bản: `v1.0.0`

---

## 🏁 Phiên 2026-10-21 — Khởi tạo cấu trúc dự án

## 🎯 Thành Tựu Khởi Tạo:
- Khởi tạo thành công cấu trúc dự án và bộ nhớ Đa Tầng brain4agent V5.2.

## Phiên 2026-10-22 — Đưa review workflow lên main

- Thời điểm kiểm tra: `2026-10-21T18:48:14.369863+00:00`.
- Người dùng yêu cầu commit/push main. Gộp experiment/review-queue, giữ commit quản trị 837e298.
- Release v1.12.0; README và báo cáo QA được cập nhật.
- 80/80 Node tests, 0 skip; syntax và diff check đạt. npm audit không áp dụng vì không có package/lockfile.
- QA Ego trước đó: camera giữ qua đổi frame; checklist giữ qua reload; annotation server không đổi. Chưa kiểm thử cài/reload unpacked Chrome.

## Phiên 2026-10-22 — Truy vết đường đi cuboid (v1.13.0, chưa commit)

- Yêu cầu: "tracks a cuboid from finish to beginning and tell me their paths". Hiểu là quỹ đạo tâm box từ frame cuối về đầu; quyết định ghi ở `planning/01_2026-10-22_track-path-trace/plan.md`.
- Thêm `track-path.js`, khối UI *Đường đi* trong `content.js`, `docs/TRACK-PATH.md`. Chỉ đọc, dùng annotation đã tải, không dùng nháp preview.
- 95/95 test, 0 skip; mutation bỏ `reverse()` → 11 đỏ. Chưa chạy trong Chrome/CVAT thật (2 gate ⬜).
- Gotcha: `../brain4agent.release` không tồn tại trên máy này nên Bước 0 `init_brain.js --check` thoát 1; chưa kiểm được chuẩn não.
- Gotcha: mảng sinh trong `vm.createContext` khác realm, `assert.deepEqual` cần `JSON.parse(JSON.stringify())`.

## Phiên 2026-10-22 (tiếp) — Tối ưu cache theo CVAT (v1.13.1, chưa commit)

- Đối chiếu `/media/bang/Work/projects/cvat`: PrefetchAnalyzer, object-state-index. Áp dụng: tải nền quanh frame đang xem; checklist parse một lần. Quyết định và vùng cấm: `planning/02_2026-10-22_cache-lessons/plan.md`.
- Số đo trái dự đoán: crop `nearCloud` hai lượt chậm hơn (3,2 → 5,4 ms) nên hoàn tác. Luôn đo trước khi giữ tối ưu "hiển nhiên".
- 100/100 test, 0 skip; mutation → 3 đỏ. Chưa chạy trong Chrome/CVAT thật.
