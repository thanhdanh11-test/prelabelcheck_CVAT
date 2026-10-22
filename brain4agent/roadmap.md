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
- [ ] Khớp chiều cao theo nhiều frame (lấy trung vị nóc của các frame tốt) thay vì một frame khi khóa kích thước.
- [ ] Đo khớp đáy trên mặt đường dốc, xe tải/bus; có thể ước lượng mặt phẳng nghiêng thay vì một cao độ.

- [ ] Cache: kiểm lại metadata theo chu kỳ và xóa cache khi dataset đổi (CVAT `chunks_updated_date`); RAM cache co theo kích thước frame (CVAT trần 2 GB); chỉ đếm điểm trong crop nếu có số đo nhanh hơn.
- [ ] Đường đi: vẽ quỹ đạo lên view 3D/Top, bấm dòng bảng để nhảy tới frame, xuất cho nhiều item cùng lúc, cờ bước nhảy bất thường.

## Đã hoàn thành (Done)
- [x] **v1.13.3 (2026-10-22T17:56:53Z):** bỏ giới hạn pan quanh box/trần zoom-out 3×; 114/114 tests; Ego local đạt 42,5×, 300.820 điểm, reset và không đổi bản nháp.
- [x] **v1.13.2 (2026-10-22T17:42:57Z):** gộp lechibang 203456b và bản local; sửa dropdown, giữ zoom/fit/keyboard + vệt Top/cache; 113/113 tests. QA trình duyệt/server còn mở, chưa xác nhận chữa nhảy ID.
- [x] **v1.13.1 (2026-10-22T17:34:05Z):** thanh khớp gọn; mũi tên ở frame thu nhỏ; xoay bằng dấu phẩy/chấm; 94/94 tests. Đánh giá 203456b, chưa nhập thay đổi remote; còn QA trình duyệt/server.
- [x] **v1.13.0 (2026-10-22T16:20:00Z):** khớp mọi mặt (đầu/đuôi, hai bên, đáy, nóc); icon khớp/chấp nhận/hủy ở view thu nhỏ và sát nhau ở view mở rộng; phóng riêng từng view, phóng to/thu nhỏ/pan bằng chuột; Xoá keyframe giữ vị trí box; kéo vùng để đưa box về vật (chế độ bật/tắt bằng icon, đỏ khi bật); thanh bên sắp theo luồng, nút đóng rõ nghĩa, bỏ Undo ở view mở rộng. 91/91 test.

- [x] **v1.13.1 (local):** tải nền theo vị trí xem; checklist O(n); 100/100 test. Còn gate Chrome thật.
- [x] **v1.13.0 (local):** Truy vết ngược cuboid cuối → đầu, chỉ đọc; 95/95 test. Còn gate Chrome thật.
- [x] **v1.12.0:** giữ camera khi đổi frame; checklist item lưu trình duyệt; khớp một frame có duyệt/Undo; thu gọn UI. 80/80 test đạt. Giữ Tự khớp cũ, gỡ thử nghiệm hai mốc theo yêu cầu.
- [x] **Khởi tạo Bộ Nhớ Não Bộ Chuẩn (v1.0.0):** Thiết lập cấu trúc Đa Tầng brain4agent V5.2 và quy chuẩn quản trị AGENTS.md.
