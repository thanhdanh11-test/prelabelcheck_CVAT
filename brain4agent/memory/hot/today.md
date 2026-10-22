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

## Phiên 2026-10-22 — v1.13.0 khớp mọi mặt và thao tác nhanh

- Phản hồi: khớp frame không khớp mặt đường/nóc; nút khớp xa Chấp nhận/Hủy; cần phóng riêng view + zoom chuột.
- Quyết định: đáy đo ở vành 0,4–1,2 m quanh footprint, yêu cầu lớp phẳng ≥ 40% (tránh lấy hông xe làm mặt đường khi box lệch); chiều cao khi Nhận đi theo Khóa kích thước (cả track) như kéo cạnh.
- Người dùng yêu cầu thêm: khớp đầu/đuôi/hai bên mặc định, icon thay chữ, zoom cả thu nhỏ. Mặt chỉ lùi vào khi LiDAR thấy (lớp dày ≥ 8%), mặt khuất giữ kích thước cũ; giới hạn 50 cm tính từ mặt ban đầu (không cộng dồn với bước dịch XY).
- Thu nhỏ tới 3×: `frameReach` tải crop rộng hơn cho frame đang phóng.
- 86/86 test; Ego QA job 97 (không Apply/Save). Cửa sổ Ego bị thu nhỏ nên ảnh icon chưa chụp được.
- Thêm: Xoá keyframe chỉ bỏ keyframe thừa (box nhảy vì trước đây xoá mọi keyframe giữa). Kéo chuột trái ở vùng trống view mở rộng = khoanh vùng đưa box về vật (căn mặt bằng `contain`); theo yêu cầu thành chế độ bật/tắt bằng icon bên trái icon khớp (đỏ khi bật, mặc định tắt); tắt thì kéo trái = pan.
- Ego: xoá keyframe 56 → 53, số điểm 66 frame không đổi; kéo vùng sau khi đẩy box lệch 1 m: 593 → 618 điểm. 91/91 test.
- 2026-10-23: duyệt mẫu và áp thanh bên mới (footer ghim Xem trước/Áp dụng, Tự khớp `inert` tới khi xem trước, chip Bản nháp lọc frame, mục Nâng cao), nút đóng theo nghĩa, bỏ Undo ở view mở rộng. Ego bị thu nhỏ nên chụp DOM thật của panel thành HTML để duyệt.

## 2026-10-22T17:34:05Z — v1.13.1
Thanh hai nút, fit luôn yaw/sáu mặt; phím mũi tên ở frame thu nhỏ, dấu phẩy/chấm xoay theo view. 94/94 test. Remote 203456b chỉ đổi nhãn/CLI ID, không đổi Apply; đo dropdown sai Infinity do dùng frames của preview. Không merge remote, không thao tác server. Chi tiết docs/EXPERIMENT-INTERPOLATION.md.
