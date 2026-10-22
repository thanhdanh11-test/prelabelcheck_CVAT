# Kế hoạch 01 — Truy vết đường đi cuboid (cuối → đầu)

## Metadata
- Phiên bản: `1.12.0` → `1.13.0` (MINOR: thêm tính năng, tương thích ngược)
- Trạng thái: 🟡 Local xong 2026-10-22 14:08:39 +0700; CHƯA đóng vì 2 gate Chrome/CVAT thật còn ⬜ (xem specs/TESTING-ACCEPTANCE.md)
- Yêu cầu gốc: "tracks a cuboid from finish to beginning and tell me their paths"
- Phạm vi: tính năng ĐỌC thuần; không ghi annotation, không chạm bridge/Apply/Save.

## Nhật ký quyết định
| Ngày | Quyết định | Lý do |
|---|---|---|
| 2026-10-22 | "Finish → beginning" = đi từ frame cuối còn hiện về frame đầu của item, theo thời gian ngược | Cách đọc sát nhất yêu cầu; liệt kê finish-first để người duyệt bắt đầu từ chỗ track kết thúc |
| 2026-10-22 | "Paths" = quỹ đạo tâm box mỗi frame (x, y, z, yaw) + quãng đường, không phải đường dẫn file | Ngữ cảnh là cuboid trong CVAT |
| 2026-10-22 | Module thuần `track-path.js`, nạp ở isolated world, không đụng bridge | Không cần API CVAT; dữ liệu đã có trong snapshot |
| 2026-10-22 | Dùng keyframe đã tải của item, KHÔNG dùng bản nháp preview | Kết quả xác định, không đổi theo chỉnh tay chưa Apply |
| 2026-10-22 | Hỗ trợ cả rectangle (px, không yaw) vì item chọn được cả hai loại | Tránh nút chết trên item 2D |
| 2026-10-22 | Phân loại MINOR nhưng bộ SPEC rút gọn vì tính năng chỉ đọc, một module | Vẫn đủ 4 mảng theo §3.2.1 |

### Quyết định bị thay thế
Không có.

## Work Packages
| WP | Việc | Tier | Trạng thái |
|---|---|---|---|
| P01 | `track-path.js` + test thuần | 🟠 | ✅ |
| P02 | Nối UI sidebar (`content.js`), manifest, help | 🟠 | ✅ |
| P03 | Test UI + mutation check | 🟠 | ✅ |
| P04 | Docs, version, đồng bộ não | 🟢 | ✅ |

## Checklist thực thi
- [x] Dựng bộ SPEC
- [x] `trace()` / `toCsv()` thuần, 11 test
- [x] UI: nút Truy vết ngược, bảng tổng hợp, bản đồ SVG, bảng từng frame, Sao chép CSV
- [x] Test UI 4 ca; mutation (bỏ `reverse`) làm 11 test đỏ
- [x] `node --test tests/*.test.cjs` → 95/95, 0 skip
- [x] Bump 1.13.0, docs/TRACK-PATH.md, README, brain4agent/
- [ ] Gate Chrome thật (nạp unpacked, bấm trên job có cuboid)

## Bảng SPEC
| File | Nội dung |
|---|---|
| [specs/00-ARCHITECTURE.md](specs/00-ARCHITECTURE.md) | Mục tiêu, non-goals, bất biến, thứ tự đọc |
| [specs/01-CONTRACTS.md](specs/01-CONTRACTS.md) | Chữ ký hàm, kiểu kết quả |
| [specs/SPEC-P01-TrackPath.md](specs/SPEC-P01-TrackPath.md) | Thuật toán, luật BẮT BUỘC/CẤM, bảng lỗi |
| [specs/OPERATIONS.md](specs/OPERATIONS.md) | Nạp script, rollback |
| [specs/TESTING-ACCEPTANCE.md](specs/TESTING-ACCEPTANCE.md) | Ma trận test, Exit Gates |
