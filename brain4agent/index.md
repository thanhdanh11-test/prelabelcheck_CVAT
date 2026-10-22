# Project Index Map & Navigation Router

Tệp này là **Bản Đồ Chỉ Mục Trung Tâm (Master Index Map)** của dự án. Mọi AI Agent sử dụng tệp này để định tuyến tài liệu và nắm bắt toàn bộ bản đồ cấu trúc mã nguồn, luồng giao tiếp và các điểm vào (Entry Points).

---

## 🧭 1. ĐIỀU HƯỚNG TÀI LIỆU & KẾ HOẠCH (Documentation & Planning Router)

Khi nhận nhiệm vụ, Agent tra cứu bảng này để đọc **chính xác** tài liệu chuyên sâu liên quan:

| Lĩnh vực / Nhiệm vụ | Tài liệu chuyên trách | Nội dung chính |
| :--- | :--- | :--- |
| **Ký ức nóng phiên gần nhất** | [`memory/hot/today.md`](memory/hot/today.md) & [`state.json`](memory/hot/state.json) | Trạng thái máy (JSON), nhật ký làm việc theo phiên và kết quả benchmark gần nhất. |
| **Khởi động / Quy tắc chung** | [`memory-distill.txt`](memory-distill.txt) | Kernel hiện trạng, Startup Protocol, Tech stack cốt lõi. |
| **Tổng quan dự án** | [`project-intro.md`](project-intro.md) | Mục tiêu, kiến trúc tổng thể. |
| **Kế hoạch nâng cấp & RFCs** | [`planning/`](../planning/) | Thư mục chứa các bản kế hoạch theo chuẩn `[STT]_[YYYY-MM-DD]_[Ten-Ngan]`. |
| **Lỗi khó / Cạm bẫy / Gotchas** | [`-known-gotchas.md`](-known-gotchas.md) | Tổng hợp các bẫy kỹ thuật và lỗi dị biệt đã gặp. |
| **Kiến trúc dữ liệu & Data Flow** | [`-data-architecture.md`](-data-architecture.md) | Cấu trúc dữ liệu, cơ chế lưu trữ và State Flow. |
| **Lộ trình nâng cấp & Ý tưởng** | [`roadmap.md`](roadmap.md) | Active tasks, Kho Ý Tưởng (Idea Vault) và các mốc đã hoàn thành. |
| **Lịch sử cập nhật** | [`changelog.md`](changelog.md) | Lịch sử Semantic Releases (vX.Y.Z). |
| **Extension review workflow v1.12.0** | [`REVIEW-WORKFLOW.md`](../docs/REVIEW-WORKFLOW.md), [`README`](../README.md) | Camera, checklist, UI; khớp một frame trong [`EXPERIMENT-INTERPOLATION.md`](../docs/EXPERIMENT-INTERPOLATION.md). |
| **Đường đi item v1.13.0** | [`TRACK-PATH.md`](../docs/TRACK-PATH.md), [`planning/01_2026-10-22_track-path-trace/`](../planning/01_2026-10-22_track-path-trace/plan.md) | Truy vết ngược cuối → đầu: thuật toán, UI, SPEC, gate. |
| **Cache point cloud v1.13.1** | [`BACKGROUND-CACHE.md`](../docs/BACKGROUND-CACHE.md), [`planning/02_2026-10-22_cache-lessons/`](../planning/02_2026-10-22_cache-lessons/plan.md) | Tải nền theo vị trí xem, bài học từ CVAT, số đo. |
| **Tài liệu kỹ thuật module** | [`docs/`](../docs/) | Thư mục chứa tài liệu chuyên trách 1-1 cho từng module. |

---

### 🛠️ 1.2. Bảng Định Tuyến Kỹ Năng Chuyên Dụng (Workspace Skills Router - `.agents/skills/`)

| STT | Tên Skill (`.agents/skills/`) | File Quy Chuẩn (`SKILL.md`) | Vai Trò & Chức Năng Cốt Lõi |
| :---: | :--- | :--- | :--- |
| **1** | `sample-skill` | `SKILL.md` | Kỹ năng mẫu cho workspace. |

---

## 🗺️ 2. BẢN ĐỒ CẤU TRÚC MÃ NGUỒN (Codebase Directory Map)

```text
project-root/
├── AGENTS.md                         # [QUY TẮC TỐI THƯỢNG] Nguồn chân lý DUY NHẤT (Gemini/Codex đọc trực tiếp)
├── CLAUDE.md                         # [SHIM] Điểm nạp tự động của Claude Code — chỉ chứa @AGENTS.md
├── brain4agent-v1.7.1.md   # [MARKER] Phiên bản khung não — soi nhanh ở root
├── README.md                         # Tài liệu giới thiệu và hướng dẫn build dự án
├── cvat-resize-extension/            # MV3 manifest, content, page-bridge, cloud-cache, lidar-view, review-state, track-split, track-path
├── tests/                            # Node tests + IndexedDB browser harness
├── brain4agent/                      # [BỘ NHỚ DỰ ÁN] Single Source of Truth
│   ├── memory/hot/                   # [HOT MEMORY] Ký ức nóng phiên (today.md, state.json)
│   ├── memory-distill.txt            # [KERNEL] Bản cô đọng tối thượng (< 100 dòng)
│   ├── index.md                      # [ROUTER] Master Index Map & Codebase Navigation
│   ├── roadmap.md                    # [ROADMAP] Tiến độ, Active tasks & Idea Vault
│   ├── changelog.md                  # [CHANGELOG] Lịch sử Semantic Releases
│   ├── -known-gotchas.md             # [GOTCHAS] Tổng hợp lỗi dị biệt & bẫy kỹ thuật
│   ├── -data-architecture.md         # [DATA ARCH] Kiến trúc dữ liệu & Data Flow
│   └── project-intro.md              # [INTRO] Tổng quan dự án & Tech stack
├── planning/                         # [QUẢN LÝ KẾ HOẠCH NÂNG CẤP] 01_…track-path-trace/ (plan+specs), 02_…cache-lessons/ (plan)
├── .agents/skills/                   # [WORKSPACE SKILLS] Kỹ năng chuyên dụng cục bộ dự án
└── docs/                             # [MODULE DOCS] Tài liệu kỹ thuật chi tiết
```
