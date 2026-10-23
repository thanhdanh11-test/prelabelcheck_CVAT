# Known Gotchas & Bugs

Tổng hợp các lỗi khó, các lưu ý dị biệt hoặc cách workaround đặc thù của dự án này để AI không dẫm lại vết xe đổ.

## Môi trường & Config
- (Chưa có - Cập nhật ngay khi phát hiện bug khó).

## Keyframe & nội suy
- **Xoá keyframe làm box nhảy (sửa v1.13.0):** xoá mọi keyframe giữa chỉ còn nội suy thẳng giữa đầu/cuối. Luôn rút gọn bằng `essentialKeys` (giữ sai số ≤ 5 cm / 1° tại mọi keyframe cũ, giữ chỗ đổi outside và keyframe có attribute). Sai số lớn nhất của nội suy tuyến tính từng đoạn luôn nằm tại một keyframe cũ nên chỉ cần kiểm các keyframe.

## QA bằng Ego
- `confirm()` của content script chạy trong isolated world: đè `window.confirm` ở MAIN world không có tác dụng. Bấm nút qua `setTimeout` trong `page.evaluate` (để lệnh không bị chặn) rồi `page.acceptDialog()`; nếu tiến trình script thoát khi hộp thoại đang mở thì hộp thoại bị đóng (confirm trả về false).
- Cửa sổ Ego thu nhỏ thì `page.screenshot` lỗi; lấy ảnh canvas bằng `toDataURL` trong shadow root.

- Upstream `203456b`: đổi nhãn ID server không giữ clientID sau Apply; bridge không đổi. Dropdown bỏ biến frames cục bộ nên dùng frames preview, cho Infinity–-Infinity khi preview trống (đã tái hiện Node VM). Đã gộp có sửa lỗi dropdown trong v1.13.2; không coi đổi nhãn là bản sửa nhảy ID.

## Test với `vm.createContext`
- Mảng/đối tượng tạo trong context khác realm với test; `assert.deepEqual` strict báo "same structure but not reference-equal". Chuẩn hóa bằng `JSON.parse(JSON.stringify(x))` (xem `plain()` trong `tests/track-split.test.cjs`).

## Bước 0 của AGENTS.md
- Ghi nhận từ máy cộng tác viên (không phải máy Mac hiện tại): engine `../brain4agent.release/.agents/skills/.xay-dung-nao-bo/scripts/init_brain.js` không có trên máy này (exit 1, MODULE_NOT_FOUND, 2026-10-22). Chưa kiểm được chuẩn não; cần người đặt hub đúng chỗ.

## Tối ưu cache cần đo
- Đếm-rồi-điền Float32Array trong `nearCloud` chậm hơn mảng JS tạm (quét hai lần; crop chỉ giữ ~0,5% điểm). Đừng "tối ưu" lại nếu chưa đo trên frame dày.

## Nguồn item mất khi reload (v1.13.6)
Bản ≤1.13.5 chỉ giữ itemOrigins bằng clientID trong RAM. Đã lưu theo server/job bằng ID server hoặc hình học khớp duy nhất khi chưa Save; không đoán từ clientID tái sử dụng. Quan hệ đã mất từ bản cũ không tự phục hồi; sửa hình học trước khi thu ID server có thể làm match pending thất bại an toàn. Save rồi tải lại danh sách tool để thu ID. Xóa dữ liệu trang/đổi máy không giữ nguồn.

## Cache mã hóa v1.14.0
Không await crypto trong IDB transaction. Lock loại crypto trả muộn; getter unlocked không tăng generation khi derive key. Reset giữ Web Lock đến hết clear; nguồn khóa toàn bộ read-merge-write. Merge từ RAM giữ link cũ không liên quan. CSS display:grid cần override [hidden]. Legacy upgrade2 chặn writer1, localStorage tab cũ vẫn phải reload. Không hứa xóa vật lý/chống máy bị chiếm quyền.

## Audit v1.14.0 chưa phát hành
MAIN world đọc được input mật khẩu trong open Shadow DOM dù extension JS ở isolated world; sau khóa vẫn giải mã nếu đã chụp pass. Tiền đề là code độc trên trang, không khẳng định CVAT có XSS. Khóa chỉ tab hiện tại (browser2 tab xác nhận); replay ciphertext cũ vẫn hợp lệ; mật khẩu12 ký tự có thể yếu. Chưa sửa. docs/CACHE-SECURITY-AUDIT.md.


### Cache popup hardening 2026-10-23
Shared DOM is visible across isolated worlds: password belongs in extension popup. reset on an empty vault must rotate shared revocation token before waiting for Web Lock; removing absent header emits no useful cross-tab invalidation. Regression147/147; reset mutation fails. Replay/weak password limits remain.
