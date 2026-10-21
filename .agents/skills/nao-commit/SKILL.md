---
name: nao-commit
description: Gọi nao-dong-bo để đồng bộ não rồi stage tường minh và commit Conventional Commits tiếng Anh, không push. Dùng khi người dùng nói commit não, commit kèm đồng bộ não, lưu và commit, chốt commit, update memory commit.
metadata:
  brain4agent: managed
  version: "1.0"
---
# Mục đích
Kết hợp `nao-dong-bo` + stage tường minh + commit tiếng Anh. Kết thúc bằng khối "Tiếp theo".

# Các bước thực thi

Khi người dùng kích hoạt skill này:

1. **Gọi `nao-dong-bo`** để đồng bộ toàn bộ tài liệu.

2. **Kiểm tra `git diff --name-only`** để liệt kê file thay đổi.

3. **Stage từng đường dẫn tường minh** (CẤM `git add -A`). Đề xuất bằng lời tiếng Việt file sẽ stage và message dự kiến — KHÔNG dùng thẻ hỏi (Luật L.2).

4. **Commit:** Message tiếng Anh Conventional Commits (ví dụ: `docs(brain): sync memory and architecture`).

5. **Kết thúc:** Tuyệt đối KHÔNG push. Hiển thị khối "Tiếp theo" 4 dòng.

# Không làm

- Không push hoặc rebase.
- Không sửa vùng luật engine, không tạo file ngoài 8 phân vùng.
