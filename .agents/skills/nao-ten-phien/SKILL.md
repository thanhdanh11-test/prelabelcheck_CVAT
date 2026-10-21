---
name: nao-ten-phien
description: Tính tên phiên gợi ý từ kế hoạch đang active trong planning/ và nhắc người dùng đổi tên phiên, chỉ đọc. Dùng khi người dùng nói tên phiên, đặt tên session, sync session name, hoặc ngay sau khi tạo thư mục kế hoạch mới.
metadata:
  brain4agent: managed
  version: "1.0"
---
# nao-ten-phien — Tên phiên theo kế hoạch đang active (chỉ đọc)

Tính tên phiên gợi ý từ kế hoạch đang active rồi nhắc người dùng tự đổi tên (Claude Code không cho agent tự gọi `/rename` — lệnh interactive-only; Codex/Gemini tương tự: agent chỉ gợi ý).

1. Xác định root dự án (chứa `brain4agent/` và `planning/`); không đúng cấu trúc ⇒ báo và dừng.
2. Kế hoạch active: ưu tiên `active_plan.id` trong `brain4agent/memory/hot/state.json`; rỗng ⇒ thư mục `planning/` có STT lớn nhất.
3. Từ `planning/[STT]_[YYYY-MM-DD]_[Ten-Ngan]/` ⇒ tên gợi ý `[STT]-[Ten-Ngan]` (bỏ ngày).
4. In đúng một dòng: `Kế hoạch đang active: <folder>. Gợi ý tên phiên: <STT-Ten-Ngan>. Đổi tên phiên bằng lệnh của vỏ đang dùng (Claude Code: /rename <STT-Ten-Ngan>).`
5. Không sửa file, không commit.

Tự gọi (không cần nhắc): ngay sau khi tạo thư mục kế hoạch mới; khi người dùng hỏi tên/trạng thái phiên.
