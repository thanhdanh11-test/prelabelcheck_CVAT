# Known Gotchas & Bugs

Tổng hợp các lỗi khó, các lưu ý dị biệt hoặc cách workaround đặc thù của dự án này để AI không dẫm lại vết xe đổ.

## Môi trường & Config
- (Chưa có - Cập nhật ngay khi phát hiện bug khó).

## Test với `vm.createContext`
- Mảng/đối tượng tạo trong context khác realm với test; `assert.deepEqual` strict báo "same structure but not reference-equal". Chuẩn hóa bằng `JSON.parse(JSON.stringify(x))` (xem `plain()` trong `tests/track-split.test.cjs`).

## Bước 0 của AGENTS.md
- Engine `../brain4agent.release/.agents/skills/.xay-dung-nao-bo/scripts/init_brain.js` không có trên máy này (exit 1, MODULE_NOT_FOUND, 2026-10-22). Chưa kiểm được chuẩn não; cần người đặt hub đúng chỗ.

## Tối ưu cache cần đo
- Đếm-rồi-điền Float32Array trong `nearCloud` chậm hơn mảng JS tạm (quét hai lần; crop chỉ giữ ~0,5% điểm). Đừng "tối ưu" lại nếu chưa đo trên frame dày.
