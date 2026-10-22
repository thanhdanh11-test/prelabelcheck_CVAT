# Roadmap & Active Tasks

File này chứa danh sách các tính năng, mục tiêu sắp tới và tình trạng công việc hiện tại.

## Mục tiêu hiện tại (Active)
- [ ] Đo hiệu quả kiểm relabel trên nhiều item thực tế.
- [ ] Đóng kế hoạch 02: nhảy tới giữa job lớn trong Chrome, xác nhận tải nền bắt đầu quanh frame đó.
- [ ] Đóng kế hoạch 01: chạy Truy vết ngược trong Chrome với CVAT thật (2 gate ⬜ trong `planning/01_2026-10-22_track-path-trace/specs/TESTING-ACCEPTANCE.md`).

## Tương lai (Upcoming)
- [ ] Mở rộng tính năng và tối ưu hiệu năng.

## 💡 Kho Ý Tưởng & Backlog (Idea Vault)
*Nơi lưu trữ các ý tưởng hay, kiến trúc mở rộng chưa ưu tiên làm ngay nhưng cần giữ lại để tham khảo.*
- [ ] Đánh giá thêm khớp frame với che khuất và các object sát nhau.
- [ ] Cache: kiểm lại metadata theo chu kỳ và xóa cache khi dataset đổi (CVAT `chunks_updated_date`); RAM cache co theo kích thước frame (CVAT trần 2 GB); chỉ đếm điểm trong crop nếu có số đo nhanh hơn.
- [ ] Đường đi: vẽ quỹ đạo lên view 3D/Top, bấm dòng bảng để nhảy tới frame, xuất cho nhiều item cùng lúc, cờ bước nhảy bất thường.

## Đã hoàn thành (Done)
- [x] **v1.13.1 (local):** tải nền theo vị trí xem; checklist O(n); 100/100 test. Còn gate Chrome thật.
- [x] **v1.13.0 (local):** Truy vết ngược cuboid cuối → đầu, chỉ đọc; 95/95 test. Còn gate Chrome thật.
- [x] **v1.12.0:** giữ camera khi đổi frame; checklist item lưu trình duyệt; khớp một frame có duyệt/Undo; thu gọn UI. 80/80 test đạt. Giữ Tự khớp cũ, gỡ thử nghiệm hai mốc theo yêu cầu.
- [x] **Khởi tạo Bộ Nhớ Não Bộ Chuẩn (v1.0.0):** Thiết lập cấu trúc Đa Tầng brain4agent V5.2 và quy chuẩn quản trị AGENTS.md.
