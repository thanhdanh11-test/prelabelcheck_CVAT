# Giới Thiệu Dự Án (Project Overview)

## 1. Mục tiêu (Goals & Objectives)
Công cụ hỗ trợ rà và sửa label 3D (cuboid) trong CVAT: đặt kích thước cả track, tự ẩn frame ít điểm, tự khớp box, chỉnh tay trên Top/Side/Front/LiDAR 3D, đánh dấu item đã kiểm tra và truy vết đường đi của item. Chỉ Apply/Save của CVAT mới ghi dữ liệu.

## 2. Công nghệ cốt lõi (Tech Stack)
- **Frontend / Desktop / Web:** Chrome MV3 extension (`cvat-resize-extension/`), JavaScript thuần, Canvas/WebGL, không npm dependencies.
- **Backend / Engine:** không có server riêng; script Python `cvat_resize_track.py` gọi REST API của CVAT.
- **Data Persistence:** annotation nằm ở CVAT; point cloud cache RAM/IndexedDB; checklist localStorage theo origin/job/server track ID.
- **Test:** Node built-in test runner (`node --test tests/*.test.cjs`).
