# Known Gotchas & Bugs

Tổng hợp các lỗi khó, các lưu ý dị biệt hoặc cách workaround đặc thù của dự án này để AI không dẫm lại vết xe đổ.

## Môi trường & Config
- (Chưa có - Cập nhật ngay khi phát hiện bug khó).

## Keyframe & nội suy
- **Xoá keyframe làm box nhảy (sửa v1.13.0):** xoá mọi keyframe giữa chỉ còn nội suy thẳng giữa đầu/cuối. Luôn rút gọn bằng `essentialKeys` (giữ sai số ≤ 5 cm / 1° tại mọi keyframe cũ, giữ chỗ đổi outside và keyframe có attribute). Sai số lớn nhất của nội suy tuyến tính từng đoạn luôn nằm tại một keyframe cũ nên chỉ cần kiểm các keyframe.

## QA bằng Ego
- `confirm()` của content script chạy trong isolated world: đè `window.confirm` ở MAIN world không có tác dụng. Bấm nút qua `setTimeout` trong `page.evaluate` (để lệnh không bị chặn) rồi `page.acceptDialog()`; nếu tiến trình script thoát khi hộp thoại đang mở thì hộp thoại bị đóng (confirm trả về false).
- Cửa sổ Ego thu nhỏ thì `page.screenshot` lỗi; lấy ảnh canvas bằng `toDataURL` trong shadow root.

- Upstream `203456b`: đổi nhãn ID server không giữ clientID sau Apply; bridge không đổi. Dropdown bỏ biến frames cục bộ nên dùng frames preview, cho Infinity–-Infinity khi preview trống (đã tái hiện Node VM). Không cherry-pick nguyên commit để chữa nhảy ID.
