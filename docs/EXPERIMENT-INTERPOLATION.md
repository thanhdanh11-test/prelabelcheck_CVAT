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

## Bản v1.13.0: khớp mọi mặt và khớp ở view thu nhỏ (2026-10-22)

Phản hồi người dùng: khớp frame chỉ chỉnh box quanh và xoay, chưa khớp mặt đường, nóc, đầu/đuôi xe; nút khớp và Chấp nhận/Hủy cách xa nhau, nên dùng icon; cần phóng riêng từng view, phóng to và thu nhỏ bằng chuột.

### Thay đổi

- `fitCurrentPoints(cloud, points, allowYaw, fitFaces)`: khi `fitFaces` (UI: **Khớp mọi mặt**, mặc định bật), trước khi khớp XY đo mặt đường bằng `groundNear` (điểm trong vành 0,4–1,2 m quanh footprint, cao độ trong [đáy − 0,8; đáy + 0,6]; median rồi median lớp ±10 cm; lớp phẳng phải chiếm ≥ 40% vành, nếu không trả về không có). Đáy mới dùng để chọn tập điểm hỗ trợ, nên box bị lún không lấy điểm mặt đường làm điểm vật. Sau khớp XY (kích thước cố định, căn mặt thấy được), `fitSpan` khớp đầu/đuôi theo điểm ngang thân box và hai bên theo điểm ngang hai đầu: mặt chỉ đi ra tới điểm còn liền mạch (khe > 20 cm thì dừng, không lấy xe sát bên) và chỉ lùi vào khi có lớp điểm dày ≥ 8% ở mép (mặt LiDAR thấy); mặt khuất giữ nguyên, nên chỉ thấy một đầu thì chiều dài không đổi. Mỗi mặt nằm trong 50 cm so với vị trí ban đầu. Cuối cùng `roofOver` lấy phân vị 98% của điểm trong footprint, cao hơn mặt đường 0,3 m và không quá nóc cũ + 0,8 m.
- Giới hạn: đáy lệch > 50 cm hoặc chiều cao đổi > 60 cm thì giữ giá trị cũ và ghi chú trong đề xuất. Kết quả trả thêm `floorShift`, `sizeChange` [dài, rộng, cao], `notes`.
- Chấp nhận khi kích thước đổi đi qua `setGeometry(f, points, size)` như kéo cạnh: Khóa kích thước bật thì cả track nhận kích thước mới (giữ đáy theo tùy chọn); vẫn một bước Undo.
- Đề xuất gắn với frame, không gắn với view mở rộng: `proposeFrameFit(f)` chạy từ header frame thu nhỏ; mở/thu view cùng frame giữ đề xuất; đổi frame, chỉnh box, đổi tùy chọn khớp thì bỏ.
- Nút khớp/chấp nhận/hủy dùng icon (`FIT_ICON`) có `title` và `aria-label`, ở cả header frame thu nhỏ và thanh view mở rộng.
- **Xoá keyframe** (`clearKeys`) dùng `essentialKeys(shapes)`: giữ keyframe đầu, cuối, chỗ outside đổi và keyframe có attribute; giữa hai keyframe giữ lại, thêm keyframe sai khác lớn nhất cho tới khi nội suy lệch ≤ `FIT.posTol` (5 cm, cả tâm và kích thước) và ≤ `FIT.yawTol` (1°) ở mọi keyframe cũ. Vì đường nội suy là tuyến tính từng đoạn với góc tại các keyframe, sai số lớn nhất luôn nằm tại một keyframe cũ, nên mọi frame giữ vị trí. Bản cũ xoá mọi keyframe giữa nên box nhảy về đường thẳng nối hai đầu.
- **Kéo vùng** (`regionShift`, `moveToRegion`), chế độ bật/tắt bằng icon `.region-mode` bên trái icon khớp (`regionMode`, mặc định tắt; bật thì nền đỏ, `aria-pressed`). Khi bật: kéo chuột trái ở vùng trống trong Top/Side/Front mở rộng vẽ khung vàng; thả ra thì box dịch theo trục ngang của view (Top: dài + rộng; Side: dài; Front: rộng) về giữa phân vị 2–98% của điểm trong vùng, độ sâu ≤ nửa kích thước + 1 m, bỏ lớp thấp nhất (phân vị 5% + 20 cm). Box thẳng đứng thì chạy thêm `contain()` để mép box nằm trên mặt dày điểm. Dưới 10 điểm thì dùng giữa khung. Giữ hướng, kích thước, độ cao; một Undo. Khi tắt, kéo chuột trái ở vùng trống là pan như trước; chuột phải/giữa luôn pan. Đóng xem trước thì tắt chế độ.
- View mở rộng: `orthoZoom[i] = {k, u, w}` với k ∈ [0,1; 3]; pan được trong phạm vi |1 − k| × view mặc định. `frameReach(f, p)` mở rộng vùng crop point cloud của frame đang phóng khi thu nhỏ/pan, nên vùng nhìn luôn có điểm. `setSolo(slot)` ẩn các view khác. Đặt lại khi đóng xem trước.

### Kiểm thử

`node --test tests/*.test.cjs`: **91/91 pass**; cú pháp mọi script và `git diff --check` đạt. Test mới: sáu mặt khớp đúng trên dữ liệu tổng hợp; chỉ thấy một đầu/một bên thì giữ kích thước; mở rộng tới điểm liền mạch nhưng không vượt khe sang vật bên cạnh; mặt đường ngoài phạm vi, không có mặt đường, nóc ngoài giới hạn đều giữ nguyên kèm ghi chú; đề xuất từ view thu nhỏ (không mở frame) chấp nhận được, chiều cao theo khóa kích thước và một Undo khôi phục; phóng to/thu nhỏ giữ điểm dưới con trỏ, pan bị kẹp và vùng crop cần tải bao được cửa sổ thu nhỏ; Xoá keyframe giữ mọi frame trong 5 cm / 1°, giữ outside/attribute/khúc cua; kéo vùng ở Top đưa box về giữa vật, Side chỉ dịch theo chiều dài, vùng trống dùng giữa khung, xe chỉ thấy một nửa thì box tựa mặt thấy được.

Ego trên CVAT local task 76 / job 97 / track server 49, script nạp theo manifest vào MAIN/isolated world:

| Trường hợp | Kết quả |
|---|---|
| Khớp ở header frame 0 (thu nhỏ) | Đề xuất xanh trên ba view nhỏ: dịch 0,1 cm, đáy +4 cm, cao −8 cm (cả track), 1.252 → 1.219 điểm; Nhận/Hủy cạnh nút |
| Nhận rồi ⌘Z | Sửa tay 0 → 1 → 0; kích thước track trở lại 4,178 × 1,753 × 1,596 |
| Khớp frame này ở frame 30 (mở rộng) | Chấp nhận/Hủy ngay sau nút; đáy −3 cm, cao +4 cm, 612 → 653 điểm; Esc bỏ, bản nháp không đổi |
| Cuộn chuột 4 nấc trên Side | Zoom quanh con trỏ, giữ khi bật/tắt phóng riêng |
| Nút phóng riêng Side | Một view chiếm cả vùng, bấm lại về bốn view |
| Thu nhỏ Side 14 nấc (3×) | Thấy mặt đường và xe bên cạnh; point cloud xung quanh được tải thêm |
| Xoá keyframe trên item 66 frame | 56 → 53 keyframe; số điểm trong box của cả 66 frame không đổi |
| Đẩy box frame 30 lệch 1 m (Alt+→ ×5) rồi kéo vùng quanh xe ở Top | 612 → 593 → 618 điểm, box dịch về 69 cm; khung vàng hiện khi kéo; bấm khớp sau đó không dịch XY thêm |
| Nút Kéo vùng | Mặc định tắt: nền trong suốt, kéo không đổi box (593 điểm). Bật: nền đỏ `rgb(218, 41, 28)`, kéo vùng → 618 điểm. Nút nằm ngay trái icon khớp |
| Khớp mọi mặt ở frame 0 / 20 / 30 (icon trên header thu nhỏ) | Đề xuất đáy +4/−1/−3 cm, cao −8/−8/+4 cm; dài/rộng không đổi vì mặt thấy được đã sát điểm; ba nút icon có nhãn Khớp/Chấp nhận/Hủy |

Không bấm Áp dụng hay Save. Ước lượng đáy/nóc vẫn là đề xuất cần duyệt: hai frame của cùng item cho chiều cao lệch nhau ±8 cm, nên với Khóa kích thước bật hãy nhận chiều cao ở frame vật gần LiDAR và nhiều điểm nhất. Chưa đo trên nhiều item, xe tải/bus hay mặt đường dốc.

## v1.13.1 — thanh khớp và bàn phím (2026-10-23)

- View mở rộng chỉ có hai nút công cụ: chọn vùng và tự động khớp. Xoay (±15°) và mọi mặt luôn bật. Chấp nhận/Hủy màu mặc định hiện ngay dưới, cách 4 px; khi đang tính thì Chấp nhận vô hiệu hóa, Hủy vẫn dùng được; nhận/hủy xong ẩn cả hàng.
- Click canvas Top/Side/Front của frame thu nhỏ để chọn frame và mặt phẳng; mũi tên dịch 5 cm, Shift 1 cm, Alt 20 cm; PageUp/Down theo Z. `,` / `.` xoay −/+1°, Shift 15°, view 3D dùng yaw. Không kích hoạt khi nhập liệu hoặc Ctrl/⌘/Alt cho phím xoay. Dùng lại setGeometry và Undo hiện có.
- Kiểm chứng: 94/94 Node tests, 0 fail/skip; cú pháp các script và diff whitespace đạt. Chưa kiểm tra tương tác bản này bằng trình duyệt hoặc trên server công ty.

### Đánh giá thay đổi ID trên origin/main

Đã fetch và đọc `ec93fe5`, `203456bf33fe351d22a7aa412ad59d5a0ed9f5c6` của `lechibang-1512` (commit ngày 2026-10-22). Không có PR tại thời điểm kiểm tra.

- `203456b` ưu tiên nhãn ID server trong extension, bỏ `--ui-id` khỏi CLI; thêm vệt quỹ đạo. Không đổi `page-bridge.js`, nơi Apply gọi `job.annotations.commit` thay track và đọc clientID mới. Do đó chưa có bằng chứng commit này ngăn số UI/clientID đổi trên CVAT; nhãn server chỉ giúp nhận diện ổn định. ID server của track đầu đã được code hiện tại giữ lại; track mới do tách outside là trường hợp riêng.
- Lỗi đo được trong dropdown remote: xóa `const frames = t.shapes.map(...)`, vô tình dùng mảng `frames` của preview bên ngoài. Chạy chính đoạn dựng option bằng Node VM với track frame 10–20 và preview trống cho `frame Infinity–-Infinity`. Không phải lỗi thiếu biến; đây là nhầm phạm vi biến.
- Kết luận: có thể áp dụng riêng ý tưởng hiển thị ID server, giữ nguyên contract CLI; không nên merge/cherry-pick toàn commit làm bản sửa lỗi ID. Chưa áp dụng thay đổi remote, chưa thao tác annotation/server công ty. Cần tái hiện Apply/Undo/Save trên đúng bản CVAT trước khi đổi bridge để giữ clientID.

## Hợp nhất v1.13.2 (2026-10-23)

Người dùng đã duyệt gộp với lechibang. Đánh giá “chưa áp dụng remote” bên trên là lịch sử, được thay bằng trạng thái: đã gộp `ec93fe5`/`203456b`, sửa dropdown bằng biến frames riêng của từng track và kết hợp chữ ký `drawView` nhận cả `win` lẫn `f`. Giữ thanh hai nút, khớp sáu mặt, phím tắt, zoom/pan và vệt Top/cache/checklist upstream. CLI giữ bản upstream dùng server ID qua `--track`.

113/113 tests, 0 fail/skip; thêm hai hồi quy cho dropdown và truyền frame/window/proposal vào renderer. Cú pháp JavaScript và Python đạt; npm audit không chạy được vì không có lockfile. Chưa kiểm trên trình duyệt/server công ty, chưa đổi bridge hay khẳng định chữa nhảy clientID.
