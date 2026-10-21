---
name: nao-dong-bo
description: Đồng bộ tài liệu não trong brain4agent/ theo Ma Trận 6 Điểm từ git diff, rà thêm project-intro và -data-architecture khi đổi nền cấu trúc. Dùng khi người dùng nói đồng bộ não, cập nhật não, cập nhật docs não, sync brain, update memory, chốt 6 điểm.
metadata:
  brain4agent: managed
  version: "1.0"
---
# Mục đích
Đồng bộ tài liệu dự án trong `brain4agent/` theo 6 vùng: `docs/`, `index.md`, `roadmap.md`, `changelog.md`, `memory/hot/`, kernel.

# Các bước thực thi

Khi người dùng kích hoạt skill này, thực hiện đúng trình tự:

1. **Kiểm tra `brain4agent/` tồn tại.** Nếu không có, báo skill không áp dụng.

2. **Quét bằng git diff (ưu tiên):** Chạy `git diff brain4agent/` hoặc `git log -p -1 brain4agent/` (nếu đã commit) để xác định file vừa thay đổi.

3. **Fallback:** Nếu diff rỗng, đọc các file core (`memory-distill.txt`, `-data-architecture.md`, `-known-gotchas.md`, `roadmap.md`, `index.md`) để tìm thay đổi.

4. **Xác định file cần cập nhật theo 6 vùng:** docs/, index, roadmap, changelog, memory/hot, kernel.

5. **Mở rộng khi đổi NỀN cấu trúc (§5.B.2 `AGENTS.md`):** diff thêm thư mục TOP-LEVEL mới (vd `app/`, `.claude/agents/`) hoặc đưa ngôn ngữ/khung mới vào dự án ⇒ BẮT BUỘC rà thêm 2 file NGOÀI 6 vùng trên: `brain4agent/project-intro.md` (mục tiêu, bản chất repo, tech stack) và `brain4agent/-data-architecture.md` (tầng lưu trữ, data flow). Không phải thay đổi cấu trúc ⇒ bỏ qua bước này.

6. **Cập nhật** từng file có liên quan. Ghi lại kết quả (file nào được sửa).

7. **Kiểm tra bất biến:** Kernel < 100 dòng; không tạo file ngoài 8 phân vùng; không sửa vùng luật engine.

# Không làm

- Không sửa `init_brain.js`, `brain_doctor.js`, vùng `<!-- brain:rule:… -->`.
- Không tạo file tùy tiện trong `brain4agent/`.
- Không commit hoặc push; gọi `nao-commit` nếu cần lưu.
