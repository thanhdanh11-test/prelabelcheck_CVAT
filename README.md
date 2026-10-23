# prelabelcheck_CVAT

Công cụ cho track 3D trong [CVAT](https://www.cvat.ai/): đặt một kích thước cho cả track, tự ẩn (outside) các frame box gần như không có điểm, chỉnh box trên 3 mặt Top / Side / Front của từng frame và tự khớp box vào point cloud.

Gồm hai phần:

| | Dùng khi |
|---|---|
| **`cvat-resize-extension/`**: Chrome extension | Làm việc ngay trên trang job CVAT, có xem trước và chỉnh tay |
| **`cvat_resize_track.py`**: script dòng lệnh | Đổi kích thước track nhanh qua REST API, không cần mở trình duyệt |

CVAT nội suy tuyến tính giữa các keyframe. Cả hai công cụ đều làm việc bằng cách sửa hoặc thêm keyframe, nên kết quả hiển thị đúng như nhau trên mọi frame.

> **Extension v1.13.6:** bấm **Áp dụng** để cập nhật box ngay trong CVAT, không tải lại trang; sau đó bấm **Save của CVAT** để lưu server. Tool đọc cả thay đổi chưa Save và hỗ trợ Undo/Redo của CVAT.
>
> **Script Python:** vẫn ghi trực tiếp lên server. Save trong CVAT trước khi chạy script, rồi tải lại trang CVAT để xem kết quả.

---

## Chrome extension

### Cài đặt

1. Dùng Chrome hiện đại (111 trở lên), mở `chrome://extensions` và bật **Developer mode**.
2. Bấm **Load unpacked**, chọn thư mục `cvat-resize-extension`.
3. Mở một trang job CVAT, ở góc dưới bên phải sẽ có nút **Resize track**.

Extension chạy trên `localhost`, `127.0.0.1`, `app.cvat.ai` và `cvat-test.vantixapps.net`. Nếu dùng server CVAT khác, thêm domain đó vào cả hai mục `content_scripts[].matches` và mục `web_accessible_resources[].matches` trong `manifest.json` rồi reload extension.

Sau mỗi lần cập nhật code, bấm **reload** ở `chrome://extensions` rồi tải lại trang job.

### Nhận biết item sau tách (từ v1.13.4)

Preview ghi item gốc, khoảng frame từng đoạn và khoảng outside; frame bắt đầu đoạn mới có nhãn **BẮT ĐẦU ITEM MỚI**. Item con có chữ vàng **Tạo từ item #…** cạnh số frame và nút **Đến item gốc**. Từ v1.13.6, quan hệ lưu trên trình duyệt theo server/job và được khôi phục sau reload; không truy ngược được nguồn đã mất từ bản cũ. Nút **Đoạn gốc / Đoạn mới 2 / …** ở sidebar và frame mở rộng chuyển đến đầu đoạn; sau Áp dụng chọn item tương ứng, giữ bản nháp khi chuyển qua lại. Sau Áp dụng, bảng đối chiếu ghi item gốc → số item mới/ID server và khoảng frame. Item chưa Save ghi “chưa có ID server”. Bảng là lịch sử lần Áp dụng gần nhất, không tự cập nhật sau Undo/Redo/Save và không lưu qua reload.

### v1.13.3: di chuyển toàn cảnh

Top/Side/Front mở rộng không còn khóa pan quanh box và không còn trần zoom-out 3×. Cuộn để zoom theo con trỏ; kéo chuột phải/giữa để pan; double-click trở về box. Phạm vi dữ liệu là point cloud của frame hiện tại, không ghép map qua nhiều frame.

### Bản hợp nhất v1.13.2

Gộp giao diện/khớp sáu mặt/phím tắt với vệt quỹ đạo Top, cache theo frame đang xem và nhãn ID server của lechibang. Sửa khoảng frame trong dropdown. 113/113 test Node đạt; chưa QA bản hợp nhất trên server công ty. Nhãn ID server không ngăn clientID của CVAT đổi khi Áp dụng. CLI dùng `--track` (ID server), không còn `--ui-id`.

### Mới trong v1.13.0

- **Khớp ngay ở view thu nhỏ, dùng icon:** mỗi frame có icon khớp (khung có ô vuông); đề xuất (xanh) vẽ ngay trong ba view nhỏ, icon ✓ chấp nhận và ✕ hủy nằm sát bên. View mở rộng đặt Chấp nhận/Hủy thành hàng sát dưới hai nút công cụ. <kbd>Enter</kbd> chấp nhận, <kbd>Esc</kbd> hủy.
- **Khớp mọi mặt** (luôn bật): đầu/đuôi và hai bên theo điểm của vật, đáy lên mặt đường (vành 0,4–1,2 m quanh box), nóc lên điểm cao nhất (phân vị 98%). Mặt chỉ lùi vào khi LiDAR thấy mặt đó; mặt khuất giữ theo kích thước cũ. Mỗi mặt bên đổi tối đa 50 cm, đáy 50 cm, chiều cao 60 cm; vượt giới hạn hoặc thiếu điểm thì giữ nguyên và ghi lý do. Khi **Khóa kích thước cả track** bật, kích thước mới áp cho cả track như khi kéo cạnh.
- **Xoá keyframe giữ vị trí box:** chỉ bỏ keyframe thừa (nội suy từ keyframe còn lại vẫn cho đúng vị trí, lệch ≤ 5 cm / 1°); giữ keyframe đầu/cuối, chỗ đổi outside và keyframe đặt attribute. Trước đây nút này xoá mọi keyframe ở giữa nên box nhảy về đường thẳng giữa hai đầu.
- **Kéo vùng để đưa box về (tùy chọn):** bấm icon khung nét đứt bên trái icon khớp để bật (nền đỏ), bấm lại để tắt (không màu, mặc định). Khi bật, trong view mở rộng Top/Side/Front, kéo chuột trái ở vùng trống để khoanh quanh vật; box nhảy về giữa các điểm trong vùng (bỏ lớp mặt đường), đặt mép lên mặt LiDAR thấy nếu có, giữ hướng, kích thước và độ cao. Một lần Undo. Sau đó bấm khớp để chỉnh sát.
- **Thanh bên gọn theo thứ tự làm việc:** Track (⟳ tải lại) → Lấy object / Đã kiểm tra / → item kế → Kích thước + Giữ đáy + Khóa kích thước → Tự khớp (mờ và khóa tới khi Xem trước) → Bản nháp (ô số liệu bấm để lọc frame) → **Nâng cao** thu gọn (ngưỡng outside, tách object, point cloud cache). **Xem trước / Áp dụng** ghim ở đáy panel.
- **Nút đóng rõ nghĩa:** đầu panel là **—** khi đang xem trước (ẩn panel, giữ bản nháp), ✕ khi chưa xem trước; thanh xem trước có nút chữ **Thoát xem trước** (nút duy nhất có thể bỏ bản nháp); view mở rộng dùng icon thu nhỏ. Bỏ nút Undo trong view mở rộng, dùng ⌘Z / Ctrl+Z. Xoá keyframe thành icon.
- **View mở rộng linh hoạt:** nút phóng ở góc mỗi view (LiDAR 3D, Top, Side, Front) để xem riêng một view; Top/Side/Front cuộn chuột để phóng to hoặc thu nhỏ quanh con trỏ (không còn trần 3×; tự tải thêm point cloud theo vùng nhìn), kéo vùng trống (khi tắt Kéo vùng) hoặc chuột phải/giữa để di chuyển tự do, kể cả ở zoom mặc định, double-click về mặc định. Zoom giữ khi đổi frame.

Chi tiết và kiểm thử: [EXPERIMENT-INTERPOLATION.md](docs/EXPERIMENT-INTERPOLATION.md).

### Mới trong v1.13.1

- **Tải nền theo vị trí xem:** cache point cloud bắt đầu từ frame bạn đang xem và ưu tiên phía bạn đang đi tới, thay vì quét từ frame 0; nhảy sang chỗ khác thì tải nền đi theo. Danh sách track có hàng trăm item không còn parse lại checklist cho từng dòng. Chi tiết và số đo: [BACKGROUND-CACHE.md](docs/BACKGROUND-CACHE.md).

### Mới trong v1.13.0

- **Vệt quỹ đạo & Khung mờ (Top view):** bật **Vệt quỹ đạo (Top)** ở Tùy chọn để hiển thị đường chuyển động nét đứt cyan nối tâm box giữa các frame lân cận và khung mờ wireframe của frame trước / sau trên khung nhìn Top, giúp đối chiếu hướng di chuyển và căn chỉnh box liền mạch.

### Mới trong v1.12.0

- **Giữ camera khi đổi frame:** giữ góc xoay, mức zoom tương đối và độ lệch pan; tâm nhìn đi theo box của frame mới. Thu nhỏ/mở lại cùng item vẫn giữ góc. **Về box** đặt lại; đổi item hoặc dựng lại preview bắt đầu góc mặc định.
- **Đã kiểm tra:** đánh dấu thủ công ở dưới danh sách track; item có dấu ✓ và bộ đếm đã kiểm tra. **Item chưa kiểm tra tiếp** bỏ qua các item đã đánh dấu. Dấu của item có ID server được lưu trên trình duyệt theo server/job/ID, dùng lại sau F5. Item chưa có ID server chỉ giữ dấu trong tab. Dấu không Save annotation, không tự bỏ khi chỉnh box và không đồng bộ sang trình duyệt khác.
- **Giao diện gọn:** hướng dẫn nằm trong nút **?**; các hàng tùy chọn căn đều. Hướng box mặc định luôn bật, không còn bảng Cuboid orientation. Bỏ ký hiệu trục nhìn thẳng ở góc dưới và các nút ↶ / ↷ / 180°; vẫn xoay được bằng tay nắm tròn. Thanh khớp khi phóng to chỉ có hai nút **Tự động khớp** và **Di chuyển box tới vùng chọn**. Hai nút Chấp nhận/Hủy giữ màu mặc định, hiện thành hàng ngay dưới khi khớp và ẩn sau khi nhận/hủy.

Các thay đổi từ `experiment/review-queue` đã được đưa vào bản v1.12.0 trên `main`. Chi tiết và kiểm thử: [Camera và dấu kiểm tra item](docs/REVIEW-WORKFLOW.md).

Trong frame phóng to, bấm **Khớp frame này** để xem box hiện tại màu cam và đề xuất màu xanh trên cả bốn view. Luôn khớp mọi mặt và thử yaw tối đa ±15°, không cần bật checkbox. Giới hạn dịch tâm 50 cm, yêu cầu ít nhất 30 điểm trong box và box gần thẳng đứng: |rx| và |ry| ≤ 0,01 rad (khoảng 0,57°). Thông báo giới hạn này nghĩa là box nghiêng quá mức thuật toán hỗ trợ; vẫn có thể chỉnh tay. Xoay Side/Front 1° đã vượt ngưỡng, còn xoay Top là yaw.

**Chấp nhận** sửa vị trí/hướng frame đang chọn trong bản nháp; tool ghim trạng thái frame liền kề để không kéo theo nội suy cả đoạn. Kích thước mới áp cho cả track nếu bật **Khóa kích thước cả track**. **Hủy** hoặc Esc bỏ đề xuất, Ctrl/⌘Z hoàn tác lần chấp nhận. Chuyển frame, đổi item hoặc chỉnh box sẽ bỏ đề xuất cũ. Thu nhỏ rồi **Áp dụng**, sau đó **Save trong CVAT** khi muốn lưu.

Đây là đề xuất hình học cần kiểm tra bằng mắt; số điểm tăng không chứng minh box chính xác hơn. Hướng dẫn và kết quả kiểm thử: [EXPERIMENT-INTERPOLATION.md](docs/EXPERIMENT-INTERPOLATION.md).

### Mới trong v1.11.0

- Phóng to frame thành **bốn view**: LiDAR 3D phía trên, Top / Side / Front phía dưới; ẩn thanh công cụ bên trái. Dùng Ctrl/⌘Z để Undo; nhấn Esc để về thanh bên trái khi cần Áp dụng.
- View 3D dùng point cloud toàn frame từ cache chung, chỉ vẽ box của item đang chọn. Kéo chuột trái để xoay camera, kéo chuột phải/giữa để pan, cuộn để zoom; bấm **Về box** hoặc double-click để đặt lại camera.
- Cuboid orientation: mũi tên X đỏ, Y xanh lá, Z xanh dương. Mặc định luôn hiển thị trên box; không còn nút bật/tắt ở sidebar.
- Xoay box trong cả ba view bằng tay nắm tròn; giữ Shift khi kéo để bước 15°.
- Ở frame thu nhỏ hoặc mở rộng, click chọn view rồi dùng phím mũi tên để dịch box 5 cm; Shift = 1 cm, Alt = 20 cm. PageUp / PageDown nâng/hạ theo trục Z thế giới. Giữ phím liên tục là một bước Undo.

### Từ v1.10.0

- Mặc định **tách object khi outside ≥ 6 frame liên tiếp**, có thể đổi ngưỡng hoặc tắt.
- Preview ghi số object sẽ tạo và frame bắt đầu của mỗi đoạn; nhãn **Object 1, 2…** là đoạn dự kiến, không phải ID CVAT.
- Khi Áp dụng, đoạn cũ kết thúc bằng keyframe outside; đoạn xuất hiện lại thành track độc lập. Giữ box, class, attribute và hỗ trợ Undo cả lần tách.

### Từ v1.9.0

- Tự tải trước point cloud toàn job ở nền khi mở tool trên job 3D; ưu tiên frame đang xem.
- Cache IndexedDB dùng chung cho mọi item theo job/frame, dùng lại sau F5 hoặc mở lại trình duyệt.
- Đổi item tự mở preview; quay lại item đã mở sẽ khôi phục chỉnh sửa, Undo, tùy chọn và vị trí xem trong phiên tab.
- Có tiến độ frame, nút **Dừng / Tiếp tục tải nền** và **Xóa cache**.

### Từ v1.8.0

- Áp dụng trực tiếp vào annotation đang mở; hỗ trợ Undo/Redo của CVAT.
- Đọc cả thay đổi chưa Save và chặn ghi đè nếu track đã đổi trong lúc xem trước.
- Dừng được quét preview; bộ lọc rỗng có thông báo và nút bỏ lọc.
- Sửa kế thừa attribute, hoàn tác kích thước, dữ liệu PCD lỗi và nội suy ngoài khoảng tự khớp.

**Nâng cấp:** reload extension tại `chrome://extensions`, rồi tải lại trang CVAT một lần để nạp các script mới. Những lần **Áp dụng** sau không cần tải lại trang.

### Tải nền và đổi item

Mở tool là bắt đầu tải point cloud ở nền; bạn có thể làm việc ngay với item đầu tiên. Point cloud thuộc frame nên gần 100 item vẫn dùng chung dữ liệu. Tool chỉ dựng preview của item đang chọn, không dựng đồng thời toàn bộ item. Item mới vẫn cần tính outside/dựng hình, nhưng không tải lại point cloud đã cache.

Cache đọc theo thứ tự RAM → IndexedDB → CVAT, giới hạn **1 GiB mỗi server (origin)** và hết hạn sau 7 ngày. RAM giữ tối đa 24 frame hoặc khoảng 128 MiB (ít nhất một frame), cộng vùng điểm quanh box khoảng 64 MB. Nếu toàn job không vừa cache, tải nền dừng và tool chỉ tải bổ sung frame cần xem; không hứa toàn bộ job luôn sẵn offline. Trình duyệt có thể xóa cache khi thiếu dung lượng. Khi IndexedDB không dùng được, tool báo rõ và tiếp tục bằng RAM.

**Dừng tải nền** dừng phần tải trước, không ngắt frame đang được preview sử dụng. **Tiếp tục** bỏ qua các frame còn trong IndexedDB. **Xóa cache** chỉ xóa point cloud của extension trên server hiện tại; không xóa annotation, cookie hay chỉnh sửa preview. Preview đang mở có thể tải lại các frame cần hiển thị ngay sau đó.

Chỉnh sửa preview theo item chỉ được giữ trong tab/job hiện tại, mất khi F5, đóng tab hoặc chuyển job. Áp dụng từng item rồi Save trong CVAT để lưu lâu dài. Nếu track nguồn thay đổi, preview được giữ để xem nhưng phải dựng lại trước khi Áp dụng. Dừng tự khớp trước khi đổi item.

### Quy trình

1. Chọn track: chọn trong danh sách, hoặc chọn object trên sidebar CVAT rồi bấm **Lấy object đang chọn**.
2. Nhập kích thước **L / W / H**. Ô được điền sẵn kích thước hiện tại của track. Cả track sẽ dùng kích thước này.
3. Tuỳ chọn:
   - **Giữ đáy cố định**: khi đổi chiều cao, đáy box không đổi (bỏ chọn thì giữ tâm).
   - **Khóa kích thước cả track**: kéo đổi kích thước ở một frame thì cả track đổi theo.
   - **Tự động outside ≤ N**: frame nào box chứa từ N điểm trở xuống thì bị ẩn.
   - **Tách object khi outside ≥ N frame**: sau ít nhất N frame ẩn liên tiếp, lần xuất hiện lại bắt đầu object mới. Mặc định bật, N = 6. Đây là số **frame**, khác ngưỡng **điểm** ở trên.
4. Bấm **Xem trước**. Màn hình chỉnh sửa mở toàn cửa sổ. Nếu đang quét point cloud, bấm lại nút tiến độ để dừng; các lượt tải đang chạy sẽ kết thúc trước khi nút sẵn sàng lại.
5. Chỉnh nếu cần, rồi bấm **Áp dụng**: box cập nhật ngay trong CVAT, không tải lại trang.
6. Bấm **Save của CVAT** để lưu lên server. Undo/Redo của CVAT hoàn tác/làm lại cả lần áp dụng.

Nếu bạn sửa chính track đó trong CVAT sau khi mở tool, **Áp dụng** sẽ từ chối ghi đè. Bấm **Tải lại trong tool** rồi xem trước lại. Những thay đổi chưa Save của các object khác được giữ nguyên.

Tool dùng API Commit của CVAT, nên số **# trên sidebar có thể đổi** sau khi áp dụng. Undo/Redo dùng cơ chế gốc của CVAT và có thể khiến CVAT cấp lại ID khi Save. Khi CVAT không có plugin API phù hợp, tool báo lỗi và không tự chuyển sang ghi server.

### Tách object sau khi mất dấu

Để chuyển qua lại: trong preview bấm **Đoạn gốc / Đoạn mới 2 / …** ở sidebar hoặc dưới frame mở rộng để tới đầu đoạn. Sau **Áp dụng**, các nút chọn item tương ứng và giữ bản nháp khi chuyển. Khi đang xem item con, chữ vàng **Tạo từ item #…** trên thanh số frame cho biết nguồn; **Đến item gốc** mở đoạn đầu còn giữ lại sau tách, không khôi phục track chưa tách.

Quan hệ nguồn được lưu trong localStorage của trình duyệt theo server/job. Save annotation trước khi reload. ID server là định danh chính; với item chưa có ID lúc ghi nhận, tool chỉ nhận lại khi hình học khớp duy nhất, rồi lưu ID server. Nếu đã sửa hình học trong CVAT trước khi tool ghi nhận ID, liên kết có thể không khôi phục được; bấm Tải lại trong tool sau Save để cập nhật ID. Nguồn đã mất từ bản cũ không thể khôi phục chắc chắn. Xóa dữ liệu trang hoặc đổi trình duyệt/máy sẽ mất liên kết. Nếu Undo/Redo làm item đích không còn tồn tại, tool yêu cầu tải lại thay vì chọn nhầm. Bảng đối chiếu sau Áp dụng là lịch sử tại thời điểm áp dụng, không phải danh sách ID luôn cập nhật sau Save.

Ví dụ frame 10 còn hiện, frame 11–16 outside, frame 17 hiện lại: đoạn đầu giữ box đến frame 10 và keyframe outside ở frame 11; object mới bắt đầu tại frame 17. Mất dấu 5 frame thì chưa tách; nhiều khoảng ngắn không cộng dồn. Nếu có nhiều khoảng outside đủ dài, tool tạo nhiều track. Outside ở đầu/cuối mà chưa có đoạn hiện trước/sau không tạo object rỗng.

Quy tắc chạy trên trạng thái outside cuối cùng của preview, gồm outside có sẵn, do đếm điểm hoặc do bạn sửa tay. Thay đổi outside cập nhật ngay dự kiến tách. Tool chỉ tách track đang chọn trong phạm vi job hiện tại. Các đoạn giữ nguyên hình học/class, attribute cố định; attribute thay đổi theo frame được kế thừa đầy đủ tại đầu đoạn mới.

**Áp dụng** tạo các object riêng trong CVAT bằng một lần Commit; **Undo** khôi phục track ban đầu, **Redo** tách lại. Đoạn đầu dùng ID server hiện tại khi áp dụng lần đầu; các đoạn mới nhận ID server khi **Save**. Chỉnh sửa của các item khác được giữ nguyên. Xem [thiết kế và kiểm thử tách track](docs/TRACK-SPLIT.md).

### Màn hình xem trước

Mỗi frame hiện 3 mặt nhìn theo trục của box: Top (x–y), Side (x–z), Front (y–z). Mỗi hàng có 2 frame.

- Kéo **trong box** để di chuyển, kéo **cạnh** để đổi kích thước (mặt đối diện đứng yên), kéo **chấm tròn phía trên box** để xoay theo view: Top quanh Z, Side quanh Y, Front quanh X.
- Sửa ở frame nào thì frame đó thành keyframe. Các frame giữa hai keyframe được nội suy lại.
- Đầu mỗi frame:
  - dropdown **class** và **attribute**: class và attribute không đổi theo frame áp cho cả track; attribute đổi theo frame sẽ tạo keyframe;
  - **con mắt**: ẩn / hiện frame đó;
  - **chìa khoá**: bật / tắt keyframe (nền đỏ = đang bật);
  - **phóng to** một frame.
- Thanh trên cùng có bộ lọc **Keyframe / Frame ẩn / Frame khớp kém**, nút **Xoá keyframe** (chỉ bỏ keyframe thừa, box giữ nguyên vị trí), **⛶** toàn màn hình và **Thoát xem trước**.
- Nếu bộ lọc không có kết quả, màn hình báo rõ và có nút **Bỏ bộ lọc**. Số frame trên thanh công cụ hiển thị số khớp / tổng số khi đang lọc.
- Đầu mỗi frame hiển thị số điểm **nằm trong box**, ở cả dạng lưới và phóng to; số điểm cập nhật khi chỉnh box. Hiện “…” khi chưa tải được dữ liệu, “—” khi tải lỗi.
- Frame đang thao tác có viền đỏ.
- Nút **?** cạnh tiêu đề mở hướng dẫn đầy đủ.

| Phím | Tác dụng |
|---|---|
| `D` / `F` | Frame trước / sau |
| `Esc` | Đóng hướng dẫn nếu đang mở; nếu không, hủy đề xuất khớp; nếu không, thu nhỏ frame |
| `Enter` | Chấp nhận đề xuất khớp đã tính xong |
| `←` / `↑` / `↓` / `→` | Ở frame thu nhỏ hoặc mở rộng: dịch box 5 cm theo view được chọn (viền vàng) |
| `Shift` + mũi tên | Dịch chính xác 1 cm |
| `Alt` + mũi tên | Dịch 20 cm |
| `PageUp` / `PageDown` | Nâng / hạ box 5 cm theo Z thế giới (cũng dùng Shift / Alt) |
| `,` / `.` | Xoay box −1° / +1° theo view đang chọn; 3D dùng yaw |
| `Shift` + `,` / `.` | Xoay theo bước 15° |
| `⌘Z` / `Ctrl+Z` | Hoàn tác |

Trong view 3D, phím mũi tên dịch theo mặt phẳng camera; trong Top / Side / Front, dịch theo trục cục bộ của box. Click vào vùng canvas để chọn view; gõ trong ô class/attribute không dịch box. Xoay camera không thay đổi annotation. Chỉnh hình học bằng chuột ở ba view bên dưới cập nhật ngay box 3D. Khi đổi frame, camera giữ hướng nhìn, zoom tương đối và độ lệch pan quanh box mới. Cần WebGL để hiển thị LiDAR 3D; nếu không có WebGL, ba view chỉnh sửa vẫn dùng được.

### Tự khớp

Tự đặt box khít vào point cloud cho mọi frame trong một khoảng, từ một box mẫu.

1. Trong CVAT, đặt keyframe ở **frame đầu** và **frame cuối** vật xuất hiện (gần đúng là được), và một box **khít** ở frame vật **gần lidar nhất**. Nên xoay box mẫu cho mũi box về phía mũi xe.
2. Xem trước, chọn loại vật, điền **Frame đầu / Frame cuối / Frame mẫu**. Để trống Frame mẫu thì tool chọn keyframe có nhiều điểm nhất.
3. Bấm **Tự khớp**. Nút thành thanh tiến độ 0–100%, bấm lần nữa để dừng.
4. Lọc **Frame khớp kém** để xem lại những frame tool không chắc chắn.

| Loại vật | Cách khớp |
|---|---|
| **Xe, vật cứng** (xe đỗ, xe chạy, cột, rào) | Lấy hình dạng điểm của vật ở frame mẫu làm mẫu. Ở mỗi frame, tool dự đoán vị trí theo vận tốc, tìm thô quanh đó, rồi tinh chỉnh bằng ICP (x, y, z, hướng). Hướng xe được ước lượng thêm bằng L-shape fitting. Kích thước giữ cố định |
| **Người, xe đạp** | Tìm cụm điểm gần vị trí dự đoán nhất (mean shift), đặt đáy box trên mặt đất tại chỗ, làm mượt quỹ đạo. Hướng lấy theo keyframe |

Frame bạn đã sửa tay được giữ nguyên và dùng làm điểm neo. Frame bị che hoặc không phân biệt được với vật bên cạnh thì được nội suy từ hai bên và đánh dấu. Kết quả được rút gọn còn số keyframe ít nhất mà nội suy của CVAT vẫn lệch dưới 5cm / 1°. Cả lần tự khớp là một bước hoàn tác.

**Giới hạn:**
- Chỉ xoay quanh trục đứng. Box nghiêng (rx/ry) thì không khớp.
- Point cloud không cho biết đâu là đầu xe, đâu là đuôi xe. Box mẫu quay ngược thì box vẫn khít nhưng vạch chỉ hướng bị ngược 180°.
- Xe đỗ sát nhau, đám đông, vật ở rất xa hoặc bị che lâu vẫn có thể cần chỉnh tay.
- Với người, bước bù nửa thân lidar không thấy giả định point cloud ở **hệ cảm biến** (lidar ở gốc toạ độ).

### Dữ liệu và quyền

- Extension đọc annotation đang mở qua plugin API của CVAT và chỉ tải point cloud từ chính server CVAT (`/api/...`). **Áp dụng** chỉ sửa bộ nhớ của CVAT; việc ghi server thuộc nút Save hoặc Auto Save nếu bạn đã bật trong CVAT. Không gửi dữ liệu đi nơi khác, không khai báo `permissions` nào.
- Point cloud được lưu trong IndexedDB của server CVAT đang mở, có thể còn sau khi đóng trình duyệt; xóa bằng **Xóa cache**. Cache tách theo origin, job, metadata và phiên bản bộ đọc; metadata được kiểm tra khi vào job. Annotation và bản nháp preview chỉ nằm trong RAM, không lưu vào IndexedDB. `localStorage` lưu vị trí panel và dấu đã kiểm tra theo job/ID server. Quan hệ item gốc–con lưu trong localStorage theo server/job, gồm ID và dấu nhận dạng hình học để đối chiếu item chưa Save; không gửi metadata vào annotation. Lịch sử Áp dụng vẫn chỉ giữ trong RAM của tab, mất khi reload hoặc đổi job.
- Đọc point cloud dạng PCD `ascii` và `binary` (tọa độ float).

---

## Script `cvat_resize_track.py`

Chỉ dùng thư viện chuẩn, cần Python 3.

```sh
export CVAT_URL=http://localhost:8080
export CVAT_TOKEN=...          # CVAT: Profile > Access tokens

python3 cvat_resize_track.py --job 97 --list                          # liệt kê track
python3 cvat_resize_track.py --job 97 --track 45 --size 4.5 1.9 1.6   # đặt kích thước
python3 cvat_resize_track.py --job 97 --track 45 --from-frame 65 --anchor bottom
python3 cvat_resize_track.py --job 97 --track 45 --scale 1.1 --dry-run
```

| Tuỳ chọn | Ý nghĩa |
|---|---|
| `--track` | Chọn track theo Server ID (xem từ `--list` hoặc trên extension `id <số>`) |
| `--size L W H` | Kích thước mới (rectangle 2D: `W H`) |
| `--scale k` | Nhân kích thước với k (một số, hoặc một số cho mỗi trục) |
| `--from-frame F` | Dùng kích thước của track ở frame F |
| `--anchor center\|bottom` | Giữ tâm (mặc định) hoặc giữ đáy |
| `--dry-run` | Chỉ in ra thay đổi, không lưu |

Đăng nhập bằng `--token` / `CVAT_TOKEN`, hoặc `--user` / `--password` (`CVAT_USER` / `CVAT_PASSWORD`). Nên đặt token qua biến môi trường, không gõ trên dòng lệnh, để token không nằm lại trong lịch sử shell. Sau khi lưu, script đọc lại dữ liệu từ server để kiểm tra.

---

## Kiểm thử

Dùng Node.js 18 trở lên, không cần cài package:

```sh
node --check cvat-resize-extension/content.js
node --check cvat-resize-extension/page-bridge.js
node --check cvat-resize-extension/cloud-cache.js
node --check cvat-resize-extension/track-split.js
node --check cvat-resize-extension/lidar-view.js
node --test tests/*.test.cjs
```

128 kiểm thử Node bao phủ hình học, PCD, preview, xung đột, áp dụng qua bridge, tải nền, chuyển item, tách object sau outside, xoay theo view, bàn phím và tải LiDAR khi đổi frame nhanh; thêm khớp một frame, Hủy/Chấp nhận và bảo toàn dữ liệu khi Undo, giữ camera và lưu dấu kiểm tra theo item. Báo cáo thử trên CVAT: [EXPERIMENT-INTERPOLATION.md](docs/EXPERIMENT-INTERPOLATION.md). Kiểm thử IndexedDB thật: chạy `python3 -m http.server 5181 --bind 127.0.0.1` ở thư mục repo rồi mở `http://127.0.0.1:5181/tests/cloud-cache-browser.html`; trang dùng database tạm riêng và tự xóa sau khi chạy.

Luồng cập nhật box/class, Undo/Redo và không reload của v1.8 đã được thử trên CVAT 3D thật qua Ego; dữ liệu server không đổi trong lần kiểm thử. Xem [báo cáo Apply trực tiếp](docs/LIVE-APPLY.md), [báo cáo trải nghiệm](docs/EGO-UX-AUDIT.md), [báo cáo bốn view và orientation](docs/ORIENTATION-FOUR-VIEW.md), [kiểm thử tách object trên CVAT thật](docs/TRACK-SPLIT.md) và [cache v1.9](docs/BACKGROUND-CACHE.md) để biết phạm vi và giới hạn đã kiểm chứng.

---

## License

© 2026 danhtongAI11. Phát hành theo giấy phép [MIT](LICENSE).
