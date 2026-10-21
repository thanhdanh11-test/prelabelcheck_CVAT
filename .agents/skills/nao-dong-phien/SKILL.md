---
name: nao-dong-phien
description: Đúc kết bối cảnh phiên, quyết định, gotcha và trạng thái máy vào brain4agent/memory/hot/ (today.md, state.json) rồi đồng bộ roadmap và gotchas, giữ Root Clean. Dùng khi người dùng nói đóng phiên, chốt phiên, nén ngữ cảnh, lưu ký ức, lưu não, close session, wrap up.
metadata:
  brain4agent: managed
  version: "1.0"
---
# Mục Đích & Nguyên Lý (nao-dong-phien)

Phiên hội thoại kéo dài tích lũy nhiều ngữ cảnh (token). Skill này đúc kết toàn bộ "linh hồn" của phiên vào **Bộ Nhớ Đa Tầng trong `brain4agent/`** thay vì sinh file nháp lẻ loi ngoài root:
1. **`brain4agent/memory/hot/today.md`**: nhật ký làm việc chi tiết của phiên (đọc được bằng mắt người).
2. **`brain4agent/memory/hot/state.json`**: trạng thái máy (version, kết quả benchmark, plan đang chạy).
3. **Đồng bộ phân vùng liên quan**: cập nhật `roadmap.md` (task xong/ý tưởng mới) và `-known-gotchas.md` (bug dị biệt).
4. **Root Clean 100%**: xóa hoặc không bao giờ tạo `latest_memory.md` ngoài root.

Skill này **dùng chung cho mọi project** có cấu trúc `brain4agent/`. Kích hoạt khi người dùng nói "đóng phiên", "nén ngữ cảnh", "lưu ký ức" — thực thi tuần tự các Bước dưới đây.

## Bước 1: Phát hiện Project Root & Thư Mục Não Bộ

Xác định thư mục gốc project bằng lệnh:
```bash
git rev-parse --show-toplevel
```
- Biến `PROJECT_ROOT` = đường dẫn tuyệt đối tới thư mục gốc project.
- Biến `BRAIN_DIR` = `PROJECT_ROOT/brain4agent`
- Biến `HOT_DIR` = `BRAIN_DIR/memory/hot`

> Chưa có `brain4agent/memory/hot/` ⇒ tạo tự động. Có `latest_memory.md` ở `PROJECT_ROOT` ⇒ xóa để giữ Root sạch.

## Bước 2: Thu Thập Thông Tin Phiên Làm Việc

Chạy tại `PROJECT_ROOT`:
```bash
git log -1 --oneline             # commit cuối cùng
git branch --show-current        # branch hiện tại
git status --short               # file chưa commit / vừa sửa
```

Đọc các file cấu hình và phân vùng não bộ:
- `package.json` / `pyproject.toml` / `Cargo.toml` / `tauri.conf.json` $\rightarrow$ phiên bản hiện tại (`vX.Y.Z`).
- `brain4agent/roadmap.md` $\rightarrow$ Active Tasks và Idea Vault.
- `brain4agent/changelog.md` $\rightarrow$ mốc phát hành gần nhất.

## Bước 3: Biên Soạn Nhật Ký Phiên (`brain4agent/memory/hot/today.md`)

Ghi đè nội dung mới nhất vào `brain4agent/memory/hot/today.md` theo cấu trúc chuẩn:

```markdown
# 📅 Nhật Ký Làm Việc Ngày [DD/MM/YYYY] (Session Memory Log)

> Cập nhật lúc: `[YYYY-MM-DDTHH:mm:ss+07:00]` | Phiên bản: `vX.Y.Z` (Grade A Runtime Verified)

## 🎯 Thành Tựu Cốt Lõi Đạt Được Trong Phiên:
1. **[Tên Thành Tựu / Module]**: [Mô tả chi tiết giải pháp, kiến trúc hoặc tính năng vừa code].

## 🧪 Kết Quả Benchmark / Kiểm Thử Thực Chiến:
[Bảng kết quả benchmark, tỷ lệ pass/fail, thời gian thực thi, profile test].

## 📁 Danh Sách File Đã Tạo / Sửa:
- **Tạo mới:** `đường/dẫn/tương/đối/từ/root` — [mục đích]
- **Chỉnh sửa:** `đường/dẫn/tương/đối/từ/root` — [nội dung thay đổi]

## ⚠️ Bẫy Kỹ Thuật (Gotchas) & Lưu Ý:
[Các lưu ý quan trọng hoặc cách xử lý lỗi dị biệt phát hiện trong phiên].
```

## Bước 3b: Xoay Ký Ức Nóng Sang Lạnh (`rotate_memory.js`)

Chạy script xoay ký ức (hub: `node .agents/skills/.xay-dung-nao-bo/scripts/rotate_memory.js . --keep 3`; repo vệ tinh gọi qua cùng đường dẫn hub đã dùng ở Bước 0) để giữ `today.md` gọn gàng, tránh phình token và kích hoạt `BRN-028`. Phiên cũ hơn được tự động append vào `brain4agent/memory/archive/YYYY-MM-DD.md` theo ngày của từng phiên.

**Ngưỡng xoay tính theo NGÂN SÁCH DÒNG, không chỉ theo số phiên (#21 Đ13/Đ24):** `today.md` **dưới** ngưỡng `BRN-028` (150 dòng) ⇒ script **KHÔNG đụng gì**, dù phiên đã cũ. Vượt ngưỡng ⇒ script xoay từ phiên **cũ nhất** tới khi file về dưới ngưỡng — `--keep 3` là **SÀN chứ không phải TRẦN**, nên có thể còn **ít hơn** 3 phiên. Phiên của **hôm nay không bao giờ bị xoay**: nếu mọi phiên trong file đều là hôm nay mà file vẫn vượt ngưỡng thì script thoát 0 mà không xoay và `BRN-028` **còn lại là ĐÚNG** — lúc đó phải tự tay rút gọn nội dung.

<!-- brain:cmd rotate-memory -->
```sh
node "$BRAIN_ENGINE/rotate_memory.js" . --keep 3
```
<!-- /brain:cmd rotate-memory -->

- **Script thoát mã 4 (`E_NO_SESSION`):** ghi cảnh báo `today.md` có nội dung thực nhưng parser không nhận được phiên nào (gợi ý định dạng đầu phiên chuẩn `## 🏁 Phiên YYYY-MM-DD`), rồi **ĐI TIẾP BƯỚC 4 — TUYỆT ĐỐI KHÔNG DỪNG VIỆC ĐÓNG PHIÊN**.

## Bước 4a: Kiểm Commit Chưa Push — Đóng Phiên Mà Để Việc Nằm Local Là Đóng Hụt

Một commit chỉ nằm trên đĩa sống sót qua đổi tên, sửa hỏng, tiến trình chết — **nhưng không sống sót qua việc chính cái đĩa đó biến mất**. Sự cố thật (repo vệ tinh `coding-orchestrator`, 2026-09-09/10): cả repo bị xoá khỏi đĩa, phần đã push lên GitHub còn nguyên, và **đúng hai commit nằm local 30 giờ là đúng phần không quay lại**.

Đo **offline**, KHÔNG `fetch` (đóng phiên không được phụ thuộc mạng):

<!-- brain:cmd unpushed-check -->
```sh
git rev-list --count @{u}..HEAD
```
<!-- /brain:cmd unpushed-check -->

- **Không có upstream, hoặc detached HEAD** ⇒ bỏ qua, KHÔNG coi là lỗi (bản clone mới, CI checkout theo SHA).
- **Kết quả `0`** ⇒ đi tiếp Bước 4.
- **Lớn hơn `0`** ⇒ **BÁO cho người dùng bằng lời**, nêu rõ **số commit** và đề xuất `git push`. Đây là **đề xuất, KHÔNG tự push** — push là thao tác chạm remote, phải chờ người đồng ý (luật ứng xử chung).
- **Repo có cổng máy riêng cho việc này thì chạy cổng đó**, vì cổng biết ngữ cảnh của chính repo — vd `coding-orchestrator` có `tests/verify-brain-standards.ps1 -RequirePushed` (check `S14`) biến trạng thái "còn commit chưa push" từ WARN thành **FAIL**, đúng vì đóng phiên là lúc nó phải đỏ. **KHÔNG ghim lệnh của một repo cụ thể thành bắt buộc chung** — repo khác không có verifier đó.
- **TUYỆT ĐỐI KHÔNG DỪNG việc đóng phiên vì bước này.** Ghi ký ức xong rồi mới push là thứ tự đúng; báo rồi đi tiếp.

## Bước 4: Cập Nhật Trạng Thái Máy (`brain4agent/memory/hot/state.json`)

Cập nhật `brain4agent/memory/hot/state.json` theo phép **ĐỌC → SỬA TRƯỜNG → GHI LẠI**: đọc file hiện có, cập nhật hoặc thêm đúng các trường cần đổi; mọi trường khác (vd `plan_*`, `last_verification_*`, `brain_template_version`) GIỮ NGUYÊN. **CẤM thay cả file bằng một snapshot mới.** Sau khi ghi, file phải parse được (`JSON.parse`/`json.load`) và kết thúc bằng một byte `\n`. <!-- brain:id dong-phien.state-merge -->
Các trường tối thiểu (mẫu — chỉ là DANH SÁCH TRƯỜNG để cập nhật, KHÔNG phải nội dung để ghi đè cả file):

```json
{
  "current_version": "X.Y.Z",
  "system_status": "healthy_and_runtime_verified",
  "last_verification": {
    "timestamp": "[ISO Timestamp]",
    "scenarios_passed": ["[Danh sách test cases pass]"],
    "benchmark_accuracy": "100%",
    "grade": "Grade A Runtime Verified"
  },
  "active_plans_completed": [Số lượng plan đã xong]
}
```

## Bước 5: Báo Cáo Hoàn Tất

Thông báo ngắn gọn với Người dùng:
```text
✅ Đã nén và lưu trữ ngữ cảnh thành công vào Não Bộ:
   • brain4agent/memory/hot/today.md (Nhật ký phiên)
   • brain4agent/memory/hot/state.json (Trạng thái máy)
   • brain4agent/memory/archive/ (Ký ức lạnh theo ngày)
   • Thư mục root sạch sẽ 100% (Zero root clutter).

⚠️ Nếu Bước 4a đếm được commit chưa push: nêu đúng số commit ở đây và đề xuất `git push` (không tự chạy).

👉 Ở phiên chat mới, bạn chỉ cần nhắn:
"Đọc brain4agent/memory/hot/today.md và state.json rồi tiếp tục công việc."
Agent sẽ lập tức khôi phục 100% ngữ cảnh!
```
