# 📅 Nhật Ký Làm Việc Ngày 2026-10-21 (Session Memory Log)

> Cập nhật lúc: `2026-10-21T17:25:37.254Z` | Phiên bản: `v1.0.0`

---

## 🏁 Phiên 2026-10-21 — Khởi tạo cấu trúc dự án

## 🎯 Thành Tựu Khởi Tạo:
- Khởi tạo thành công cấu trúc dự án và bộ nhớ Đa Tầng brain4agent V5.2.

## Phiên 2026-10-22 — Đưa review workflow lên main

- Thời điểm kiểm tra: `2026-10-21T18:48:14.369863+00:00`.
- Người dùng yêu cầu commit/push main. Gộp experiment/review-queue, giữ commit quản trị 837e298.
- Release v1.12.0; README và báo cáo QA được cập nhật.
- 80/80 Node tests, 0 skip; syntax và diff check đạt. npm audit không áp dụng vì không có package/lockfile.
- QA Ego trước đó: camera giữ qua đổi frame; checklist giữ qua reload; annotation server không đổi. Chưa kiểm thử cài/reload unpacked Chrome.

## Phiên 2026-10-22 — v1.13.0 khớp mọi mặt và thao tác nhanh

- Phản hồi: khớp frame không khớp mặt đường/nóc; nút khớp xa Chấp nhận/Hủy; cần phóng riêng view + zoom chuột.
- Quyết định: đáy đo ở vành 0,4–1,2 m quanh footprint, yêu cầu lớp phẳng ≥ 40% (tránh lấy hông xe làm mặt đường khi box lệch); chiều cao khi Nhận đi theo Khóa kích thước (cả track) như kéo cạnh.
- Người dùng yêu cầu thêm: khớp đầu/đuôi/hai bên mặc định, icon thay chữ, zoom cả thu nhỏ. Mặt chỉ lùi vào khi LiDAR thấy (lớp dày ≥ 8%), mặt khuất giữ kích thước cũ; giới hạn 50 cm tính từ mặt ban đầu (không cộng dồn với bước dịch XY).
- Thu nhỏ tới 3×: `frameReach` tải crop rộng hơn cho frame đang phóng.
- 86/86 test; Ego QA job 97 (không Apply/Save). Cửa sổ Ego bị thu nhỏ nên ảnh icon chưa chụp được.
- Thêm: Xoá keyframe chỉ bỏ keyframe thừa (box nhảy vì trước đây xoá mọi keyframe giữa). Kéo chuột trái ở vùng trống view mở rộng = khoanh vùng đưa box về vật (căn mặt bằng `contain`); theo yêu cầu thành chế độ bật/tắt bằng icon bên trái icon khớp (đỏ khi bật, mặc định tắt); tắt thì kéo trái = pan.
- Ego: xoá keyframe 56 → 53, số điểm 66 frame không đổi; kéo vùng sau khi đẩy box lệch 1 m: 593 → 618 điểm. 91/91 test.
- 2026-10-23: duyệt mẫu và áp thanh bên mới (footer ghim Xem trước/Áp dụng, Tự khớp `inert` tới khi xem trước, chip Bản nháp lọc frame, mục Nâng cao), nút đóng theo nghĩa, bỏ Undo ở view mở rộng. Ego bị thu nhỏ nên chụp DOM thật của panel thành HTML để duyệt.

## 2026-10-22T17:34:05Z — v1.13.1
Thanh hai nút, fit luôn yaw/sáu mặt; phím mũi tên ở frame thu nhỏ, dấu phẩy/chấm xoay theo view. 94/94 test. Remote 203456b chỉ đổi nhãn/CLI ID, không đổi Apply; đo dropdown sai Infinity do dùng frames của preview. Không merge remote, không thao tác server. Chi tiết docs/EXPERIMENT-INTERPOLATION.md.

## Phiên 2026-10-22 — Truy vết đường đi cuboid (v1.13.0, chưa commit)

- Yêu cầu: "tracks a cuboid from finish to beginning and tell me their paths". Hiểu là quỹ đạo tâm box từ frame cuối về đầu; quyết định ghi ở `planning/01_2026-10-22_track-path-trace/plan.md`.
- Thêm `track-path.js`, khối UI *Đường đi* trong `content.js`, `docs/TRACK-PATH.md`. Chỉ đọc, dùng annotation đã tải, không dùng nháp preview.
- 95/95 test, 0 skip; mutation bỏ `reverse()` → 11 đỏ. Chưa chạy trong Chrome/CVAT thật (2 gate ⬜).
- Gotcha: `../brain4agent.release` không tồn tại trên máy này nên Bước 0 `init_brain.js --check` thoát 1; chưa kiểm được chuẩn não.
- Gotcha: mảng sinh trong `vm.createContext` khác realm, `assert.deepEqual` cần `JSON.parse(JSON.stringify())`.

## Phiên 2026-10-22 (tiếp) — Tối ưu cache theo CVAT (v1.13.1, chưa commit)

- Đối chiếu `/media/bang/Work/projects/cvat`: PrefetchAnalyzer, object-state-index. Áp dụng: tải nền quanh frame đang xem; checklist parse một lần. Quyết định và vùng cấm: `planning/02_2026-10-22_cache-lessons/plan.md`.
- Số đo trái dự đoán: crop `nearCloud` hai lượt chậm hơn (3,2 → 5,4 ms) nên hoàn tác. Luôn đo trước khi giữ tối ưu "hiển nhiên".
- 100/100 test, 0 skip; mutation → 3 đỏ. Chưa chạy trong Chrome/CVAT thật.

## 2026-10-22T17:42:57Z — gộp v1.13.2
Người dùng xác nhận gộp và commit. Mốc local 121b01b; gộp origin/main 203456b (kèm ec93fe5). Giữ cả UI/fit/phím tắt và vệt Top/cache/checklist/ID server của lechibang. Sửa dropdown lấy frames từng track, nối frame vào drawView dùng zoom window. 113/113 tests, 0 skip; npm audit ENOLOCK; QA trình duyệt/server còn mở. Các ghi chú “chưa merge” ở phiên trước đã được thay thế bởi mục này. Không push.

## 2026-10-22T17:56:53Z — v1.13.3
Yêu cầu pan toàn map: gỡ clamp ±base*|1−k| và trần k=3. Giữ crop thích nghi, zoom theo con trỏ, reset double-click. 114/114 tests; hồi quy pan đỏ trước sửa. Ego local job 97: pan ở k=1, zoom42,521×, crop300.820 điểm; shapes không đổi, reset đạt. Không Apply/Save, chưa commit/push thay đổi này.

## 2026-10-23T02:56:00Z — v1.13.4 nguồn gốc đoạn tách
Đã thêm nhãn item gốc/đoạn/frame ẩn, dấu bắt đầu item mới và receipt Apply có ID thực nếu match duy nhất. 118/118 tests; mutation ID mapping làm đỏ 2 tests. Ego local job97 kiểm DOM bằng nháp/receipt tổng hợp, không Apply/Save. Chưa commit/push; chưa live Apply receipt trên server công ty.

2026-10-23T03:11:59Z — Bổ sung nút Đoạn gốc/Đoạn mới ở sidebar và view mở rộng. Preview nhảy đầu đoạn; sau Apply kiểm clientID bằng snapshot mới, dùng switchTrack giữ nháp/Undo. Không khôi phục track gốc chưa tách. 121/121 tests; chưa commit/push.
Ego local: nút sidebar tới16, nút mở rộng16→0→16, shapes JSON không đổi. Không Apply/Save.

2026-10-23T03:19:26Z — Thêm chữ vàng Tạo từ item #… và Đến item gốc trên fbar đúng ảnh người dùng. Map nguồn trong RAM giữ liên kết qua Apply đổi clientID; clear theo job/reload. 124/124 tests; chưa commit/push hoặc live toolbar sau Apply.

## 2026-10-23T03:36:36Z — v1.13.5 hướng dẫn hiện tại
Mốc v1.13.4 đã commit/push main: 09ee43f4daab30e011665bb27207f9e9c7d87003; thay thế trạng thái chưa push ở các ghi chú trước. Cập nhật README, help trong tool và REVIEW-WORKFLOW: điều hướng nguồn item, thời hạn lưu quan hệ, phím xoay/dịch ở frame thu nhỏ, pan/zoom, tilt ≤0,01 rad, kích thước theo khóa cả track và checklist localStorage. Không đổi thuật toán. 124/124 tests, 0 skip; syntax đạt. Bản docs/help v1.13.5 chưa commit/push. QA Apply/toolbar thật trên server công ty vẫn chưa thực hiện.

## 2026-10-23T03:50:59Z — v1.13.6 giữ nguồn qua reload
v1.13.5 đã push main ở 6fb29a9. Người dùng báo mất nguồn/nút về gốc sau reload: nguyên nhân RAM-only. Đã thêm localStorage theo server/job, ID server ưu tiên, fingerprint duy nhất cho pending; cập nhật nhãn/nút từ clientID mới, lỗi storage báo rõ. 128/128 tests, mutation tắt persistence đỏ 4 ca. Chưa kiểm Save/reload trên server công ty, chưa commit/push bản sửa. Không khôi phục được nguồn đã mất trước bản này.
