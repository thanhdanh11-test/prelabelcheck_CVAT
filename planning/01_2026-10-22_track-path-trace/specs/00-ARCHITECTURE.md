# 00 — Kiến trúc

## Mục tiêu
Cho một item đang chọn, liệt kê tâm box từ frame cuối còn hiện về frame đầu, kèm hướng, độ dài bước, tổng quãng đường, dịch chuyển đầu↔cuối và các đoạn bị ẩn.

## Non-goals
- Không sửa, Apply hay Save annotation; không gọi `bridgeRequest`.
- Không dự đoán hay làm mượt đường đi (spline, lọc nhiễu).
- Không vẽ đường đi lên canvas CVAT hay view 3D.
- Không tính vận tốc theo giây (job không có timestamp tin cậy).

## Bất biến
1. `trace()` là hàm thuần: không đổi `track`, không I/O.
2. Nội suy giống CVAT: tuyến tính giữa keyframe; yaw đi đường ngắn và nằm trong (-π, π]; hiển thị lấy từ keyframe bên trái.
3. Track có keyframe cuối hiện thì kéo dài tới `stop_frame` của job; keyframe cuối outside thì dừng.
4. Frame ẩn không cộng vào quãng đường; chỗ nhảy giữa hai đoạn báo riêng.
5. Thứ tự kết quả luôn finish-first (frame giảm dần).

## Vùng cấm (đã cân nhắc, KHÔNG làm)
- **Không đọc `plan.shapes` (bản nháp preview).** Kết quả phải xác định theo annotation đã tải; dùng nháp sẽ đổi theo chỉnh tay chưa Apply và gây hiểu nhầm là đã ghi.
- **Không cộng bước nhảy qua frame ẩn vào quãng đường.** Nó là mất dấu, không phải chuyển động.
- **Không nhập `positionAt` từ `content.js`.** Nó nằm trong IIFE và mang cả góc xoay/kích thước; module riêng chỉ cần x, y, z, yaw nên giữ độc lập để test thuần.

## Thứ tự đọc
00 → 01-CONTRACTS → SPEC-P01 → TESTING-ACCEPTANCE → OPERATIONS.
