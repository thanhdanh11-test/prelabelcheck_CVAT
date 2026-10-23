# Master Data Architecture & Flow

Tài liệu thiết kế về cấu trúc dữ liệu, cơ chế lưu trữ bền vững (Persistence Layer) và luồng luân chuyển dữ liệu đa tầng.

## 1. Các Tầng Lưu Trữ (Data Persistence Stores)
- [Mô tả các nguồn lưu trữ dữ liệu chính]

## 2. Schema & Data Flow
- [Mô tả cấu trúc Schema và luồng xử lý]

## Extension v1.13.1
- Tải nền ghi IndexedDB theo thứ tự quanh frame đang xem (RAM `viewing`/`heading` trong `cloud-cache.js`, quên khi đổi job/Xóa cache). `review-state.js` giữ thêm bản parse theo chuỗi thô trong RAM; localStorage vẫn là nguồn chân lý.

## Extension v1.13.0
- `track-path.js` giữ thuật toán thuần; UI truy vết/CSV đã được upstream thay bằng vệt quỹ đạo Top tính từ bản nháp, không ghi storage/annotation.

## Khớp và chỉnh box
- CVAT MAIN bridge đọc annotation đang mở; Apply tạo thay đổi có native Undo, Save của CVAT lưu server.
- Point cloud dùng chung qua RAM/IndexedDB. Checklist tách riêng trong localStorage: `cvat-track-reviews:v1:<job>`, `{version:1,ids:[serverTrackId]}`, origin tách server.
- Item chưa có ID server chỉ đánh dấu trong tab; quota/lỗi storage dùng bộ nhớ. Không đồng bộ máy; ghi đồng thời hai tab không có giao dịch.
- Camera, zoom view mở rộng và đề xuất khớp một frame là trạng thái phiên; chỉ Chấp nhận mới sửa bản nháp (kích thước theo khóa kích thước).

## Hợp nhất v1.13.2
`drawView(..., win, ..., proposed, f)` nhận cửa sổ zoom/pan và frame để vẽ quỹ đạo Top từ bản nháp. UI ưu tiên server ID nhưng selection/bridge tiếp tục theo clientID; Apply vẫn dùng native commit thay track. CLI từ upstream chỉ chọn bằng `--track` (server ID).

## Tách item v1.13.4
Bridge Apply thêm `segments[{startFrame,endFrame,clientID?,id?}]` từ export sau commit; chỉ nhận match duy nhất, không đoán ID. Receipt nguồn→đích chỉ nằm trong DOM/tab, bị thay bởi Apply tiếp theo và xóa khi đổi job/reload. Không thêm metadata vào annotation/storage; không phản ánh Undo/Redo/Save sau thời điểm tạo receipt.

`itemOrigins` (RAM theo job) ánh xạ clientID item con → nhãn nguồn lịch sử và đoạn đầu hiện tại. Cập nhật khi Apply đổi clientID; dùng cho nhãn vàng/nút về gốc trên fbar. Xóa khi đổi job/reload; không suy đoán lineage cho item cũ thiếu dữ liệu.

## Nguồn item v1.13.6 (thay giới hạn RAM-only ở trên)
`cvat-track-origins:v1:<job>` trong localStorage, tách theo origin; lưu child/parent `{id,fingerprint}`, nhãn nguồn lịch sử và khoảng frame. Snapshot sau Apply ghi dấu hình học trước Save; reload nhận theo server ID hoặc fingerprint duy nhất khi chưa có ID, nâng lên server ID khi có. Không dùng clientID làm định danh bền. Receipt vẫn chỉ trong tab. Không đổi annotation/API. Lỗi storage giữ runtime và báo cảnh báo; không đảm bảo merge ghi đồng thời nhiều tab.

## Cache mã hóa v1.14.0 (thay persistence rõ ở trên)
cache-vault.js: header localStorage, AES-GCM/PBKDF2 key RAM, cloud encrypted-v1. Nguồn ở cvat-encrypted-origins:v1:<job>, migration sau decrypt-verify. Web Lock bao init/reset/migration và read-merge-write nguồn. Khi khóa chỉ dùng RAM; nháp annotation vẫn RAM. Checklist ID/panel không mã hóa. Chưa cách ly tài khoản trong cùng origin. Xem docs/CACHE-ENCRYPTION.md.


### Popup unlock boundary
Password stays in extension-origin popup; transient exported key uses private Chrome messaging with checked sender and single-use nonce. Isolated-world receiver imports nonextractable key. Public token (actual key `cvat-cache-lock:v1`) revokes every same-origin tab and pending proofs; reset rotates it before Web Lock. No persistent key/password. ActiveTab permission only.
