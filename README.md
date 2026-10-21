# prelabelcheck_CVAT

Công cụ cho track 3D trong [CVAT](https://www.cvat.ai/): đặt một kích thước cho cả track, tự ẩn (outside) các frame box gần như không có điểm, chỉnh box trên 3 mặt Top / Side / Front của từng frame và tự khớp box vào point cloud.

Gồm hai phần:

| | Dùng khi |
|---|---|
| **`cvat-resize-extension/`**: Chrome extension | Làm việc ngay trên trang job CVAT, có xem trước và chỉnh tay |
| **`cvat_resize_track.py`**: script dòng lệnh | Đổi kích thước track nhanh qua REST API, không cần mở trình duyệt |

CVAT nội suy tuyến tính giữa các keyframe. Cả hai công cụ đều làm việc bằng cách sửa hoặc thêm keyframe, nên kết quả hiển thị đúng như nhau trên mọi frame.

> **Extension v1.8:** bấm **Áp dụng** để cập nhật box ngay trong CVAT, không tải lại trang; sau đó bấm **Save của CVAT** để lưu server. Tool đọc cả thay đổi chưa Save và hỗ trợ Undo/Redo của CVAT.
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

### Mới trong v1.8.0

- Áp dụng trực tiếp vào annotation đang mở; hỗ trợ Undo/Redo của CVAT.
- Đọc cả thay đổi chưa Save và chặn ghi đè nếu track đã đổi trong lúc xem trước.
- Dừng được quét preview; bộ lọc rỗng có thông báo và nút bỏ lọc.
- Sửa kế thừa attribute, hoàn tác kích thước, dữ liệu PCD lỗi và nội suy ngoài khoảng tự khớp.

**Nâng cấp:** reload extension tại `chrome://extensions`, rồi tải lại trang CVAT một lần để nạp bridge mới. Những lần **Áp dụng** sau không cần tải lại trang.

### Quy trình

1. Chọn track: chọn trong danh sách, hoặc chọn object trên sidebar CVAT rồi bấm **Lấy object đang chọn**.
2. Nhập kích thước **L / W / H**. Ô được điền sẵn kích thước hiện tại của track. Cả track sẽ dùng kích thước này.
3. Tuỳ chọn:
   - **Giữ đáy cố định**: khi đổi chiều cao, đáy box không đổi (bỏ chọn thì giữ tâm).
   - **Khóa kích thước cả track**: kéo đổi kích thước ở một frame thì cả track đổi theo.
   - **Tự động outside ≤ N**: frame nào box chứa từ N điểm trở xuống thì bị ẩn.
4. Bấm **Xem trước**. Màn hình chỉnh sửa mở toàn cửa sổ. Nếu đang quét point cloud, bấm lại nút tiến độ để dừng; các lượt tải đang chạy sẽ kết thúc trước khi nút sẵn sàng lại.
5. Chỉnh nếu cần, rồi bấm **Áp dụng**: box cập nhật ngay trong CVAT, không tải lại trang.
6. Bấm **Save của CVAT** để lưu lên server. Undo/Redo của CVAT hoàn tác/làm lại cả lần áp dụng.

Nếu bạn sửa chính track đó trong CVAT sau khi mở tool, **Áp dụng** sẽ từ chối ghi đè. Bấm **Tải lại trong tool** rồi xem trước lại. Những thay đổi chưa Save của các object khác được giữ nguyên.

Tool dùng API Commit của CVAT, nên số **# trên sidebar có thể đổi** sau khi áp dụng. Undo/Redo dùng cơ chế gốc của CVAT và có thể khiến CVAT cấp lại ID khi Save. Khi CVAT không có plugin API phù hợp, tool báo lỗi và không tự chuyển sang ghi server.

### Màn hình xem trước

Mỗi frame hiện 3 mặt nhìn theo trục của box: Top (x–y), Side (x–z), Front (y–z). Mỗi hàng có 2 frame.

- Kéo **trong box** để di chuyển, kéo **cạnh** để đổi kích thước (mặt đối diện đứng yên), kéo **chấm đỏ** ở mặt Top để xoay.
- Sửa ở frame nào thì frame đó thành keyframe. Các frame giữa hai keyframe được nội suy lại.
- Đầu mỗi frame:
  - dropdown **class** và **attribute**: class và attribute không đổi theo frame áp cho cả track; attribute đổi theo frame sẽ tạo keyframe;
  - **con mắt**: ẩn / hiện frame đó;
  - **chìa khoá**: bật / tắt keyframe (nền đỏ = đang bật);
  - **phóng to** một frame.
- Thanh trên cùng có bộ lọc **Keyframe / Frame ẩn / Frame khớp kém**, nút **Xoá keyframe** (giữ keyframe đầu và cuối), **⛶** toàn màn hình và **✕** đóng.
- Nếu bộ lọc không có kết quả, màn hình báo rõ và có nút **Bỏ bộ lọc**. Số frame trên thanh công cụ hiển thị số khớp / tổng số khi đang lọc.
- Frame đang thao tác có viền đỏ.
- Nút **?** cạnh tiêu đề mở hướng dẫn đầy đủ.

| Phím | Tác dụng |
|---|---|
| `D` / `F` | Frame trước / sau |
| `Esc` | Thu nhỏ frame đang phóng to |
| `⌘Z` / `Ctrl+Z` | Hoàn tác |

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
- Point cloud và annotation chỉ nằm trong bộ nhớ của tab trong lúc xử lý và mất khi đóng hoặc tải lại trang. Không lưu xuống máy, không mã hoá hay sao chép sang nơi khác. `localStorage` chỉ lưu vị trí của panel.
- Đọc point cloud dạng PCD `ascii` và `binary` (tọa độ float).

---

## Script `cvat_resize_track.py`

Chỉ dùng thư viện chuẩn, cần Python 3.

```sh
export CVAT_URL=http://localhost:8080
export CVAT_TOKEN=...          # CVAT: Profile > Access tokens

python3 cvat_resize_track.py --job 97 --list                          # liệt kê track
python3 cvat_resize_track.py --job 97 --track 45 --size 4.5 1.9 1.6   # đặt kích thước
python3 cvat_resize_track.py --job 97 --ui-id 1662 --from-frame 65 --anchor bottom
python3 cvat_resize_track.py --job 97 --track 45 --scale 1.1 --dry-run
```

| Tuỳ chọn | Ý nghĩa |
|---|---|
| `--track` / `--ui-id` | Chọn track theo id trên server, hoặc theo số # trên sidebar CVAT (đếm sau khi tải lại trang) |
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
node --test tests/*.test.cjs
```

21 kiểm thử tự động bao phủ hình học, PCD, preview, xung đột và áp dụng qua bridge. Đã thử luồng cập nhật box/class, Undo/Redo và không reload trên CVAT 3D thật qua Ego; dữ liệu server không đổi trong lần kiểm thử. Xem [báo cáo Apply trực tiếp](docs/LIVE-APPLY.md) và [báo cáo trải nghiệm](docs/EGO-UX-AUDIT.md) để biết phạm vi và giới hạn đã kiểm chứng.

---

## License

© 2026 danhtongAI11. Phát hành theo giấy phép [MIT](LICENSE).
