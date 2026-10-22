# Master Data Architecture & Flow

Tài liệu thiết kế về cấu trúc dữ liệu, cơ chế lưu trữ bền vững (Persistence Layer) và luồng luân chuyển dữ liệu đa tầng.

## 1. Các Tầng Lưu Trữ (Data Persistence Stores)
- [Mô tả các nguồn lưu trữ dữ liệu chính]

## 2. Schema & Data Flow
- [Mô tả cấu trúc Schema và luồng xử lý]

## Extension v1.13.0
- CVAT MAIN bridge đọc annotation đang mở; Apply tạo thay đổi có native Undo, Save của CVAT lưu server.
- Point cloud dùng chung qua RAM/IndexedDB. Checklist tách riêng trong localStorage: `cvat-track-reviews:v1:<job>`, `{version:1,ids:[serverTrackId]}`, origin tách server.
- Item chưa có ID server chỉ đánh dấu trong tab; quota/lỗi storage dùng bộ nhớ. Không đồng bộ máy; ghi đồng thời hai tab không có giao dịch.
- Camera, zoom view mở rộng và đề xuất khớp một frame là trạng thái phiên; chỉ Chấp nhận mới sửa bản nháp (kích thước theo khóa kích thước).
