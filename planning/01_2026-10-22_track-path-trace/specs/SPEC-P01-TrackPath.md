# SPEC-P01 — Thuật toán truy vết

## Thuật toán
1. Sắp keyframe theo `frame`; kiểm tra số nguyên, không trùng.
2. Duyệt xuôi `frame = shapes[0].frame … last` (`last = stopFrame` nếu hữu hạn, ngược lại frame keyframe cuối), con trỏ `i` là keyframe bên trái. Bỏ frame `< startFrame` và frame có `shapes[i].outside`.
3. Điểm = keyframe nếu `frame` trùng, hoặc là keyframe cuối; ngược lại nội suy tuyến tính x, y, z và yaw (đường ngắn, `wrap`).
4. Đảo danh sách (finish-first). Với mỗi điểm, nếu điểm trước trong danh sách có frame hơn đúng 1 thì tính `step`; ngược lại mở đoạn mới và, nếu đã có đoạn trước, ghi `gap`.

## BẮT BUỘC
- Nội suy theo keyframe đã tải, kể cả keyframe đầu nằm trước `startFrame`.
- Ném `Error` tiếng Việt cho input sai; không trả kết quả một phần.

## CẤM
- Ghi vào `track`/annotation; gọi bridge.
- Cộng bước nhảy qua frame ẩn vào `length`.
- Làm tròn trong `trace()` (chỉ làm tròn khi hiển thị/CSV).

## Bảng lỗi
| Tình huống | Hành vi bắt buộc |
|---|---|
| `shapes` rỗng | `Error("Track không có keyframe.")` |
| Frame không nguyên hoặc trùng | `Error("Keyframe phải có số frame nguyên và không trùng nhau.")` |
| `type` không phải cuboid/rectangle | `Error("Không hỗ trợ loại …")` |
| Không có frame nào hiện trong job | Trả `points: []`, `summary.frames = 0`; UI báo "không hiện ở frame nào" và tắt Sao chép CSV |
| Chưa chọn item | UI báo lỗi qua `setStatus(…, true)`, không gọi `trace()` |
| Clipboard bị từ chối | `guard()` hiển thị lỗi; không đổi kết quả |

## Làm mới kết quả
`clearPath()` được gọi khi `renderInputs()` chạy (đổi item, tải lại) và khi đổi job. Kết quả cũ không bao giờ hiển thị cho item khác.
