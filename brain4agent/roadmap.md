# Roadmap & Active Tasks

File này chứa danh sách các tính năng, mục tiêu sắp tới và tình trạng công việc hiện tại.

## Mục tiêu hiện tại (Active)
- [ ] Đo hiệu quả kiểm relabel trên nhiều item thực tế.

## Tương lai (Upcoming)
- [ ] Mở rộng tính năng và tối ưu hiệu năng.

## 💡 Kho Ý Tưởng & Backlog (Idea Vault)
*Nơi lưu trữ các ý tưởng hay, kiến trúc mở rộng chưa ưu tiên làm ngay nhưng cần giữ lại để tham khảo.*
- [ ] Đánh giá thêm khớp frame với che khuất và các object sát nhau.
- [ ] Khớp chiều cao theo nhiều frame (lấy trung vị nóc của các frame tốt) thay vì một frame khi khóa kích thước.
- [ ] Đo khớp đáy trên mặt đường dốc, xe tải/bus; có thể ước lượng mặt phẳng nghiêng thay vì một cao độ.

## Đã hoàn thành (Done)
- [x] **v1.13.1 (2026-10-22T17:34:05Z):** thanh khớp gọn; mũi tên ở frame thu nhỏ; xoay bằng dấu phẩy/chấm; 94/94 tests. Đánh giá 203456b, chưa nhập thay đổi remote; còn QA trình duyệt/server.
- [x] **v1.13.0 (2026-10-22T16:20:00Z):** khớp mọi mặt (đầu/đuôi, hai bên, đáy, nóc); icon khớp/chấp nhận/hủy ở view thu nhỏ và sát nhau ở view mở rộng; phóng riêng từng view, phóng to/thu nhỏ/pan bằng chuột; Xoá keyframe giữ vị trí box; kéo vùng để đưa box về vật (chế độ bật/tắt bằng icon, đỏ khi bật); thanh bên sắp theo luồng, nút đóng rõ nghĩa, bỏ Undo ở view mở rộng. 91/91 test.
- [x] **v1.12.0:** giữ camera khi đổi frame; checklist item lưu trình duyệt; khớp một frame có duyệt/Undo; thu gọn UI. 80/80 test đạt. Giữ Tự khớp cũ, gỡ thử nghiệm hai mốc theo yêu cầu.
- [x] **Khởi tạo Bộ Nhớ Não Bộ Chuẩn (v1.0.0):** Thiết lập cấu trúc Đa Tầng brain4agent V5.2 và quy chuẩn quản trị AGENTS.md.
