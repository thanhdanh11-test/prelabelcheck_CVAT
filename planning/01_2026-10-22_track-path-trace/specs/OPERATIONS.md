# Vận hành

## Nạp script
`track-path.js` nằm trong content script isolated world, sau `track-split.js` và trước `lidar-view.js`/`content.js` (`manifest.json`). Không thêm vào khối MAIN world và không thêm quyền, host hay `web_accessible_resources`.

## Triển khai
1. Reload extension tại `chrome://extensions`, tải lại trang job.
2. Chọn item, bấm **Truy vết ngược**.

## Rollback
Bỏ dòng `track-path.js` khỏi `manifest.json` và khối "Đường đi" trong `content.js` (hoặc `git revert` commit tính năng). Không có dữ liệu cần dọn: không ghi storage, không ghi annotation.

## Thứ tự bắt buộc
Module phải nạp trước `content.js`; thiếu nó `tracePath()` ném `ReferenceError` và `guard()` hiển thị lỗi, các chức năng khác không bị ảnh hưởng.
