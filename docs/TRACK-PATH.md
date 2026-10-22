# Đường đi của item, từ cuối về đầu — v1.13.0

Nút **Truy vết ngược** (sidebar, mục *Đường đi*) liệt kê nơi item đã đi, bắt đầu từ frame cuối còn hiện và lùi về frame đầu. Chỉ đọc: không sửa bản nháp, không Apply, không Save, không ghi storage.

## Kết quả

- **Bảng tổng hợp:** khoảng frame cuối → đầu, số frame hiện, quãng đường 3D và ngang (x–y), dịch chuyển đầu↔cuối, bước lớn nhất kèm frame, số đoạn liên tục, và mỗi đoạn ẩn (frame ẩn, khoảng nhảy).
- **Bản đồ:** nhìn từ trên xuống (x sang phải, y lên). Chấm xanh = cuối, cam = đầu; nét liền là đoạn hiện, nét đứt nối qua frame ẩn.
- **Từng frame:** frame (◆ = keyframe), x, y, z, hướng (độ), bước từ frame liền sau. Dòng mờ là frame đầu tiên của một đoạn (không có bước).
- **Sao chép CSV:** `frame,x,y,z,yaw_deg,step,keyframe`, finish trước.

## Cách tính

- Tâm cuboid là `points[0..2]`, hướng là `points[5]`; rectangle dùng tâm chữ nhật, đơn vị px, không có hướng và z.
- Nội suy tuyến tính giữa keyframe như CVAT (hướng đi đường ngắn). Keyframe cuối còn hiện thì item kéo dài tới frame cuối của job; keyframe cuối outside thì dừng.
- Quãng đường cộng các bước giữa frame liền nhau. Frame outside không tính; khoảng nhảy qua chỗ ẩn được báo riêng, không cộng vào quãng đường.
- Dùng annotation đã tải khi mở tool (hoặc sau **Tải lại**), không dùng bản nháp xem trước chưa Apply.

## Mã nguồn và kiểm thử

`cvat-resize-extension/track-path.js` (hàm thuần `trace`, `toCsv`, nạp ở isolated world) và khối *path trace* trong `content.js`. Test: `tests/track-path.test.cjs` (11), `tests/track-path-ui.test.cjs` (4). `node --test tests/*.test.cjs`: 95/95; bỏ `list.reverse()` thì 11 test đỏ. Chưa kiểm thử trong Chrome với CVAT thật. Spec: `planning/01_2026-10-22_track-path-trace/`.
