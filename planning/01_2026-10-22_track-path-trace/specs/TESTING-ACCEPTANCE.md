# Kiểm thử & nghiệm thu

## Ma trận test
| Test | File | Phủ |
|---|---|---|
| finish-first + nội suy | `tests/track-path.test.cjs` | thứ tự, x nội suy, cờ keyframe, step |
| kéo dài tới cuối job / dừng khi outside | cùng file | invariant 3 |
| độ dài đường cong vs dịch chuyển ròng; chiều cao chỉ vào 3D | cùng file | `length`, `net`, `lengthXY` |
| frame ẩn tách đoạn, báo `jump`, không cộng vào `length` | cùng file | invariant 4 |
| yaw đường ngắn | cùng file | invariant 2 |
| cắt theo phạm vi job | cùng file | `startFrame`/`stopFrame` |
| rectangle (px, không yaw) | cùng file | nhánh 2D |
| input sai, input không bị đổi, CSV | cùng file | bảng lỗi, bất biến 1 |
| bảng/map/summary, đoạn ẩn, track không hiện, Sao chép + xóa | `tests/track-path-ui.test.cjs` | UI |

## Bằng chứng (2026-10-22)
- `node --test tests/*.test.cjs`: 95 test, 95 pass, 0 fail, 0 skip (trước đó 80).
- Mutation: bỏ `list.reverse()` trong `track-path.js` → 11 test đỏ (4 pass); khôi phục → 95/95.
- `node --check` content.js, track-path.js đạt; `git diff --check` đạt.

## Exit Gates
| Gate | Môi trường | Trạng thái |
|---|---|---|
| Test thuần + UI-slice 95/95 | local | ✅ |
| Mutation đỏ rồi xanh | local | ✅ |
| Docs + version 1.13.0 đồng bộ | local | ✅ |
| Nạp unpacked trong Chrome, bấm trên job có cuboid, đối chiếu với keyframe CVAT | Chrome/CVAT thật | ⬜ |
| Annotation server không đổi, `hasUnsavedChanges()` false sau khi truy vết | Chrome/CVAT thật | ⬜ |

Kế hoạch chỉ đóng hoàn toàn khi hai gate ⬜ chuyển ✅.
