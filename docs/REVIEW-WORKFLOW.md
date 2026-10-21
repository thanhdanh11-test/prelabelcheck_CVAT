# Giữ camera, đánh dấu item và thu gọn giao diện

Phát triển và kiểm thử trên `experiment/review-queue` ngày 2026-10-22; phát hành trên `main` với manifest `1.12.0`, bỏ nhãn TEST. Tự khớp cũ và Khớp frame này vẫn được giữ.

## Camera

- Khi đổi frame trong cùng item, giữ yaw/pitch camera, mức zoom tương đối với kích thước box và độ lệch pan so với tâm box. Camera đi theo vị trí box mới.
- Thu nhỏ rồi mở lại frame trong cùng preview vẫn giữ góc. Đổi item hoặc dựng lại preview đặt lại góc mặc định.
- Về box hoặc double-click đặt lại camera. Chỉ thay đổi góc nhìn, không sửa box hay annotation.
- Vẫn bỏ kết quả tải LiDAR đến muộn khi đã chuyển sang frame khác. Camera được lưu trước khi giải phóng cloud/box cũ, không phụ thuộc thứ tự tải xong.

## Đã kiểm tra

Dùng checkbox dưới danh sách track. Dấu ✓ trong danh sách và bộ đếm phản ánh các item đã đánh dấu; Item chưa kiểm tra tiếp tìm item hỗ trợ tiếp theo và vòng lại đầu danh sách. Không tự đánh dấu sau khi Tự khớp và không tự bỏ dấu khi sửa box; người dùng chủ động bỏ dấu khi cần duyệt lại.

`review-state.js` lưu danh sách ID server trong localStorage theo job, tách origin của từng server. Không dùng số #/clientID làm định danh lâu dài. Item chưa Save/chưa có ID server chỉ lưu dấu trong bộ nhớ tab; nếu sau Save được cấp ID mới thì cần đánh dấu lại. Không ghi trạng thái vào CVAT, không thay thế Save annotation và không đồng bộ giữa trình duyệt/máy khác.

Lỗi/quota storage: giữ dấu trong bộ nhớ và báo chỉ giữ trong phiên. Storage sự kiện từ tab khác cập nhật giao diện; mỗi lần ghi đọc lại các ID để giữ thay đổi trước đó của tab khác. Các thao tác đồng thời tuyệt đối ở hai tab không có khóa giao dịch. Xóa point cloud cache không xóa checklist.

## Giao diện

- Chuyển hướng dẫn Apply/Save, camera, xoay, cache và khớp một frame vào box ? có sẵn.
- Giữ tên điều khiển, trạng thái tác vụ, lỗi và số liệu; bỏ đoạn hướng dẫn tĩnh ở sidebar và dòng hướng dẫn dưới view mở rộng.
- Các hàng tùy chọn có chiều cao đồng nhất, hai ô ngưỡng và đơn vị thẳng cột.
- Bỏ phần Cuboid orientation; mũi tên hướng box luôn bật. Bỏ ký hiệu trục nhìn thẳng ở góc dưới trái và các nút xoay ↶ / ↷ / 180° ở mọi frame. Giữ tay nắm tròn để xoay bằng chuột và các mũi tên hướng trên chính box.
- View mở rộng mặc định chỉ có Khớp frame này và Cho phép xoay trên thanh khớp. Có đề xuất thì hiện số liệu, màu trước/sau và Chấp nhận/Hủy; lỗi vẫn hiển thị.

## Kiểm thử

`node --test tests/*.test.cjs`: **80/80 pass**. Kiểm tra cú pháp các script và `git diff --check` đạt.

Test mới: lưu/check/bỏ dấu theo server ID và job, đổi số # vẫn giữ dấu đúng item, item chưa lưu không nhiễm sang ID server, đọc lại từ hai controller, dữ liệu storage lỗi/quota, chuyển tới item chưa duyệt và quay vòng. Camera test chạy renderer với WebGL stub: orbit/zoom/pan giữ khi box đổi vị trí/kích thước; target đi theo tâm mới, reset và camera đầu vào không hợp lệ. Regression bảo toàn tải cloud bất đồng bộ và vẽ hướng mặc định không có nhãn góc dưới.

Ego trên CVAT local task 76 / job 97 / track server ID 49:

- Checkbox chuyển 0/1 → 1/1, danh sách thêm ✓. Reload rồi nạp lại extension vẫn có dấu. Kết thúc đã trả dấu về trạng thái trước QA.
- Xoay và zoom frame 30: camera yaw −1,505398, pitch 0,843599, zoom 0,778801. Chuyển F sang 31, D về 30, thu nhỏ/mở lại đều giữ nguyên các giá trị này. Về box trở lại yaw −π/4, pitch π/6, zoom 1. Geometry bản nháp không đổi.
- Đã xem ảnh sidebar, Help và view mở rộng: hàng tùy chọn căn đều; không còn orientation controls hoặc rotation buttons; thanh khớp ban đầu chỉ còn hai điều khiển yêu cầu. Hướng vẫn vẽ trên box, không có ký hiệu góc dưới.
- Annotation server giống trước QA; CVAT `hasUnsavedChanges()` trả false. Không Apply/Save.

Các script được nạp theo manifest vào MAIN/isolated world trong Ego; chưa kiểm tra thao tác cài/reload unpacked của Chrome. Job thật có một item nên chuyển nhiều item và fallback storage được kiểm tra bằng test tự động. Bằng chứng local `docs/evidence/review-workflow-*` được gitignore.

Reload extension tại chrome://extensions rồi tải lại trang CVAT để nạp script checklist mới.
