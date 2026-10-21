# Đề xuất thử nghiệm nội suy và khớp box

Khảo sát ngày 2026-10-22 trên nhánh `experiment/review-queue`, commit nền `81a753f`. Mở CVAT local bằng Ego, task 76 / job 97, track server ID 49 (car). Các script extension được nạp theo manifest vào MAIN/isolated world. Chỉ chỉnh bản nháp preview; không Apply, không Save. Đây là khảo sát một item, chưa phải đánh giá độ chính xác trên toàn bộ dữ liệu.

## Quan sát thực tế

- Job có 66 frame; item có 55 keyframe. Chỉ lọc keyframe vẫn phải xem phần lớn chuỗi.
- Số điểm trong box: frame 0 có 1.252; 20 có 3.961; 30 có 612; 40 có 98; 59 có 0 nhưng vẫn visible; 62 có 5 và visible. Outside ở cuối bắt đầu tại các keyframe 60, 63, 65. Số điểm thấp là tín hiệu để kiểm tra, không tự chứng minh nhãn sai.
- Chạy Tự khớp đoạn 30–40, frame mẫu 30, loại xe/vật cứng. Tool báo 0 frame cần kiểm tra lại. Tại frame 40, tâm dịch 0,237 m và yaw đổi 25,64°; số điểm tăng từ 98 lên 111. Tổng keyframe tăng từ 55 lên 56. Chưa có ground truth độc lập để kết luận bản nào đúng hơn.
- Hiện chưa khớp riêng một frame được: đặt đầu/cuối đều 40 bị từ chối vì frame cuối phải sau frame đầu.
- Xoay camera 3D rồi nhấn F: frame kế tiếp đặt lại góc camera ban đầu, khiến người dùng phải chọn lại góc quan sát.
- Undo khôi phục chính xác hình học trước thử nghiệm. Annotation trên server không đổi và CVAT không có thay đổi chưa Save sau khảo sát.

## Thứ tự nên thử

| Thứ tự | Tính năng | Phạm vi bản đầu |
|---|---|---|
| 1 | Khớp frame hiện tại, có so sánh trước/sau | Khởi đầu bằng chỉ dịch tâm, giữ kích thước và hướng; tùy chọn dịch + yaw. Hiện độ dịch/góc đổi và hai box chồng nhau. Chấp nhận hoặc hủy một đề xuất; một bước Undo. |
| 2 | Frame chuẩn và khớp giữa hai mốc | Đánh dấu mốc đã duyệt rõ ràng; khóa hình học mốc; chỉ khớp khoảng được chọn. Không lan truyền qua ranh giới tách object/outside đủ dài. |
| 3 | Danh sách frame cần duyệt | Đưa ra lý do: thay đổi tâm/yaw lớn sau fit, ít điểm, bước nhảy chuyển động hoặc ranh giới outside. Có nút nhảy tới điểm cần kiểm tra kế tiếp. Không tự đánh dấu frame còn lại là đúng. |
| 4 | Giữ góc camera khi chuyển frame | Giữ yaw/pitch và khoảng zoom tương đối, tâm camera theo box; vẫn có nút Về box. Sau đó mới thêm phát vòng đoạn đã chọn. |

Luồng thử đề xuất: khớp một frame → so sánh và xác nhận → đánh dấu frame chuẩn → chọn mốc tiếp theo → khớp giữa hai mốc → duyệt thay đổi lớn. Tái sử dụng bộ khớp hiện có, nhưng bổ sung đo thay đổi và bước chấp nhận trước khi ghi vào bản nháp chính.

Chưa ưu tiên spline hoặc làm mượt toàn track: item khảo sát đã có keyframe dày; cần đo lợi ích trên một tập item có mốc thưa, dừng/rẽ và mất dấu trước. Không lấy số điểm tăng hoặc hết cờ “khớp kém” làm bằng chứng kết quả tốt hơn.

Trong lượt khảo sát ban đầu chưa triển khai tính năng mới. Bằng chứng local nằm trong `docs/evidence/discovery-*` (bị gitignore), gồm ảnh trước/sau frame 40, thống kê điểm, độ dịch và kiểm tra Undo/server.


## Bản thử đã triển khai: Khớp frame này (2026-10-22)

Nhánh `experiment/review-queue`; tên extension và tiêu đề có chữ **TEST**. Chưa merge vào main, chưa phát hành.

### Cách thử

1. Reload extension tại `chrome://extensions`, tải lại trang job để nạp code mới.
2. Chọn item, mở Xem trước và phóng to một frame đang visible.
3. Bấm **Khớp frame này**. Mặc định giữ hướng/kích thước/độ cao và chỉ dịch tâm XY. Có thể bật **Cho phép xoay** rồi chạy lại.
4. Đối chiếu box cam (hiện tại) và xanh (đề xuất) ở LiDAR 3D, Top, Side, Front. Thanh trên hiển thị độ dịch, góc đổi và số điểm trước/sau.
5. **Hủy** hoặc Esc bỏ đề xuất; **Chấp nhận** ghi vào bản nháp. Một lần Ctrl/⌘Z hoàn tác toàn bộ lần chấp nhận, gồm các keyframe ghim thêm.
6. Thu nhỏ để bấm **Áp dụng** sang CVAT; **Save của CVAT** mới lưu server.

Đổi frame, đóng view/editor, đổi item hoặc chỉnh box làm mất hiệu lực đề xuất. Tải point cloud xong muộn sau khi Hủy không khôi phục đề xuất. Xoay camera 3D vẫn giữ so sánh để kiểm tra từ nhiều góc.

### Giới hạn và cách tính

- Chỉ box gần thẳng đứng: |rx| và |ry| ≤ 0,01 rad; cần ít nhất 30 điểm trong box và 30 điểm sau lọc đáy.
- Giới hạn dịch tâm XY ≤ 0,5 m; yaw tùy chọn ≤ ±15°. Không tự đổi outside, kích thước hay cao độ.
- Tái sử dụng bộ căn mặt box và ước lượng hướng L-shape hiện có; lấy tập điểm hỗ trợ quanh box ban đầu, đánh giá ứng viên trên cùng tập điểm, tối đa 2.000 điểm mẫu. Nếu không có ứng viên đạt điểm chi phí tốt hơn thì giữ nguyên box.
- Khi chấp nhận, ghim trạng thái frame trước/sau rồi mới sửa frame hiện tại để bảo toàn nội suy ở mọi frame khác. Có thể tăng số keyframe tối đa ba; đây là tính năng sửa cục bộ, chưa phải nội suy giữa hai frame chuẩn.
- Chi phí hình học thấp hơn hoặc số điểm tăng không chứng minh nhãn đúng hơn; vật bị che khuất hoặc có vật gần sát vẫn cần người dùng duyệt. Chưa đo mức tiết kiệm thời gian trên nhiều item.

### Kiểm thử

`node --test tests/*.test.cjs`: **73/73 pass**; cú pháp content/lidar-view và `git diff --check` đều đạt.

Tám test mới kiểm tra: dịch tâm trên dữ liệu tổng hợp có vị trí chuẩn; giới hạn yaw/dịch; giữ nguyên kích thước/hướng mặc định; loại điểm xa, thiếu điểm và box nghiêng; Hủy không đổi dữ liệu; Chấp nhận một bước Undo và bảo toàn mọi frame khác; biên đầu/cuối job; kết quả tải muộn, chuyển frame/item và dữ liệu đổi trong lúc chờ.

Ego trên CVAT local task 76 / job 97 / item #1, server track 49:

| Trường hợp | Kết quả |
|---|---|
| Chỉ dịch tâm ở frame 30 và 40 | Không có ứng viên tốt hơn; giữ nguyên box, không thêm Undo |
| Frame 40, cho phép xoay | Đề xuất dịch 19,064 cm, yaw +7°; 98 → 100 điểm trong box |
| Trước Chấp nhận | 55 keyframe và bản nháp không đổi |
| Hủy | Không đổi bản nháp, Undo vẫn 0 |
| Chấp nhận | Chỉ hình học frame 40 thay đổi khi so toàn bộ 66 frame; Undo tăng đúng một |
| Ctrl/⌘Z | Khôi phục chính xác toàn bộ danh sách keyframe |
| Chuyển sang frame 41 khi đang so sánh | Bỏ đề xuất, bản nháp giữ nguyên |
| Frame 59 có 0 điểm | Báo không đủ điểm, không tạo đề xuất |
| Frame 60 outside | Nút Khớp bị vô hiệu hóa |
| Kết thúc QA | Annotation server giống trước; CVAT không có thay đổi chưa Save |

Đã xem ảnh chụp để xác nhận hai box hiển thị trên cả bốn view và các nút Chấp nhận/Hủy. Kiểm thử dùng các script từ manifest nạp qua MAIN/isolated world trong Ego; chưa kiểm tra vòng cài đặt/reload extension bằng giao diện Chrome. Trong QA không bấm Áp dụng hay Save. Bằng chứng local: `docs/evidence/single-fit-*` (gitignore).

## Trạng thái hiện tại

Theo yêu cầu người dùng, đã gỡ thử nghiệm hai mốc đã duyệt và khôi phục Tự khớp từ một frame mẫu: Frame đầu / Frame cuối / Frame mẫu, chạy về hai phía, giữ frame sửa tay và rút gọn keyframe như trước. Đã bỏ nút đặt/khóa mốc, so sánh và chấp nhận đoạn cùng trạng thái liên quan. Khớp frame này vẫn được giữ lại. Bộ kiểm thử trở lại 73 test.
