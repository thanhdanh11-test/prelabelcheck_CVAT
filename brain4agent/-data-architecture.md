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
