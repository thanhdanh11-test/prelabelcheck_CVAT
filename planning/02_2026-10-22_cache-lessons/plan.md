# Kế hoạch 02 — Tối ưu cache theo bài học CVAT (PATCH)

## Metadata
- Phiên bản: `1.13.0` → `1.13.1` (PATCH: tối ưu hiệu năng, ≤1 ngày công; ngoại lệ §3.2.5 chỉ có plan.md)
- Trạng thái: 🟡 Local xong 2026-10-22; chưa chạy trong Chrome/CVAT thật
- Yêu cầu gốc: "also optimize caching, using lessons from CVAT"
- Nguồn đối chiếu (chỉ đọc): `cvat-core/src/frames.ts` (`PrefetchAnalyzer`, `decodedBlocksCacheSize`, `refreshJobCacheIfOutdated`), `cvat-data/src/ts/cvat-data.ts` (`cleanup`), `cvat-ui/src/utils/object-state-index.ts`.

## Nhật ký quyết định
| Ngày | Quyết định | Lý do |
|---|---|---|
| 2026-10-22 | Preload nền đi từ frame đang xem, ưu tiên hướng di chuyển, thay vì quét 0→cuối | CVAT chỉ prefetch phía trước vị trí/hướng đang đọc; ta tải tuần tự dù người dùng ở cuối job |
| 2026-10-22 | Vị trí xem lấy từ chính `cloudCache.get(frame)`; không đổi content.js | Mọi đường đọc foreground đã đi qua đây |
| 2026-10-22 | Không có đọc foreground → vẫn tuần tự từ frame đầu | Giữ hành vi cũ và test cũ |
| 2026-10-22 | `review-state` chỉ parse lại JSON khi chuỗi localStorage đổi; `renderReviewState` dùng một Map | Bài học `object-state-index` (một chỉ mục cho mỗi mảng thay vì quét mỗi mục) |
| 2026-10-22 | **KHÔNG** đổi `nearCloud` sang đếm hai lượt rồi điền Float32Array | Đo: 3,2 → 5,4 ms/crop (chậm hơn) vì quét hai lần và crop thực tế chỉ giữ ~0,5% điểm |

### Vùng cấm
- Không dựng lại `nearCloud` theo hai lượt trừ khi có số đo mới cho thấy nhanh hơn trên frame dày.
- Không bỏ so sánh `raw` ở `review-state.read()`: đó là thứ giữ thay đổi từ tab khác.
- Không làm preload "theo kịp" bằng cách giữ frame nền trong RAM: nền chỉ ghi IndexedDB.
- Chưa làm (cân nhắc, để Idea Vault): CVAT kiểm lại meta theo chu kỳ và xóa cache khi `chunks_updated_date` đổi; ta chỉ kiểm khi vào job. RAM cache tự co theo kích thước frame (CVAT dùng trần 2 GB); ta giữ trần cố định 24 frame/128 MiB.

### Quyết định bị thay thế
Không có.

## Số đo (2026-10-22)
| Việc | Trước | Sau |
|---|---|---|
| `renderReviewState`, 500 track × 2.000 ID đã lưu (đo bằng vi mô, 20 lần) | 4.212 ms (~210 ms/lần) | 2,9 ms |
| Thứ tự preload khi xem frame 3 của job 0–4 | 0,1,2,4 | 4,2,1,0 (frame 3 đã có) |
| `nearCloud` crop 300k điểm | 3,2 ms | 5,4 ms → hoàn tác |

## Checklist
- [x] Test đỏ trước: 3 test mới đỏ, 2 test giữ hành vi cũ xanh
- [x] `cloud-cache.js`: `viewing`/`heading`, `nextFrame`, `done = seen.size`
- [x] `review-state.js`: cache theo chuỗi thô; `set` làm việc trên bản sao
- [x] `content.js`: `renderReviewState` dùng Map
- [x] Mutation (vô hiệu hóa hai thay đổi) → 3 test đỏ; khôi phục → 100/100, 0 skip
- [x] Docs: BACKGROUND-CACHE.md, README, brain4agent/, version 1.13.1
- [ ] Gate Chrome/CVAT thật: mở job lớn, nhảy tới giữa job, xác nhận preload bắt đầu quanh frame đó
