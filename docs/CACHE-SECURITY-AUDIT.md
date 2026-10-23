# Kiểm thử đối kháng cache — 2026-10-23

Đối tượng: bản v1.14.0 chưa commit trong working tree trên base `4d129de`. Phạm vi: code local, dữ liệu giả, Node WebCrypto và Chromium/Ego. Không truy cập server công ty, không lấy dữ liệu/mật khẩu thật, không gửi dữ liệu thử ra ngoài. Đây là kiểm thử có giới hạn, không phải chứng nhận bảo mật. Không sửa product code trong lượt audit.

## Kết quả cần xử lý

### A1 — Mật khẩu trong DOM của trang có thể bị đọc khi trang đã bị chèn mã

- Điểm: `content.js:382–384` tạo open shadow root; `:647` input mật khẩu; `:3253` xóa value sau submit chỉ xóa giá trị hiện tại, không thu hồi giá trị mã độc đã chụp.
- Tiền đề: kẻ tấn công đã thực thi JavaScript trong trang CVAT lúc nhập mật khẩu (ví dụ XSS). Không chứng minh CVAT đang có XSS; không phải truy cập được từ một website bất kỳ.
- Đo thật: nạp extension scripts trong isolated world riêng, MAIN world không thấy `CvatCacheVault` nhưng đọc được ô mật khẩu qua DOM dùng chung. Listener giả lập lấy mật khẩu thử; sau click Khóa cache, script MAIN dùng mật khẩu đó và dữ liệu localStorage để giải mã canary giả thành công.
- Tác động cao khi tiền đề đã xảy ra: lấy được khóa bảo vệ dữ liệu lịch sử, kể cả sau khóa. Đây là giới hạn compromised-page đã nêu trong thiết kế, nay có bằng chứng cụ thể.
- Hướng giảm rủi ro: nhập mật khẩu trong popup/trang thuộc origin extension, không đặt ô mật khẩu trong DOM CVAT; cần thiết kế đường truyền khóa có kiểm chứng. Closed shadow root không phải ranh giới bảo mật đủ mạnh. Vẫn không chống máy bị chiếm quyền.

### A2 — Nút Khóa cache chỉ khóa tab hiện tại

- Điểm: `cache-vault.js:12` chỉ bỏ key trong closure hiện tại. `content.js:3284` nghe đổi header, nhưng lock thông thường không phát tín hiệu đổi header.
- Đo thật: hai tab Chromium, hai isolated world. Mở khóa cả hai bằng mật khẩu giả; khóa UI tab A. Tab B vẫn `unlocked=true` và giải mã được canary.
- Tiền đề: tab B đã được mở khóa trước đó. Không mở được tab chưa có khóa và không tạo ra truy cập từ xa.
- Hướng sửa: broadcast khóa toàn bộ tab cùng kho, chặn tác vụ muộn; hoặc đổi nhãn thành “Khóa tab này” và giải thích giới hạn. Ưu tiên broadcast nếu người dùng kỳ vọng khóa toàn bộ dữ liệu.

### A3 — Chấp nhận phát lại bản mã hợp lệ cũ

- Điểm: `cache-vault.js:16,58–66` xác thực origin/vault/record nhưng không có nguồn xác thực độ mới bên ngoài kho.
- Đo: lưu revision1, revision2 rồi thay ciphertext revision2 bằng bản revision1 đã chụp. Giải mã trả revision1, không báo lỗi.
- Tiền đề: có bản mã cũ hợp lệ và quyền ghi storage cùng origin. Không lấy được plaintext chỉ nhờ thao tác này; đây là rủi ro toàn vẹn/độ mới của quan hệ nguồn.
- Hướng xử lý: định nghĩa lại yêu cầu freshness; nếu cần chống rollback toàn bộ storage phải có trạng thái tin cậy bên ngoài dữ liệu kẻ tấn công có thể thay (counter localStorage cùng chỗ không đủ). Đối chiếu annotation sống khi điều hướng vẫn hữu ích nhưng không chứng minh nguồn lịch sử đúng.

### A4 — Mật khẩu đủ 12 ký tự vẫn có thể rất yếu

- Điểm: `cache-vault.js:29` chỉ kiểm độ dài. Header/verifier cho phép kiểm tra phỏng đoán offline khi đã sao chép storage; PBKDF2 làm chậm, không cấm điều này.
- Đo giới hạn: dùng mật khẩu giả cố tình yếu `123456789012`, đúng ở lần thử thứ3 trong danh sách3 ứng viên định trước. Không suy ra tốc độ phá mật khẩu mạnh hoặc tỷ lệ thành công trên dữ liệu thật.
- Hướng giảm rủi ro: khuyến khích passphrase ngẫu nhiên/unique, từ chối mật khẩu phổ biến/lặp/chuỗi số đơn giản. Giới hạn số lần nhập trên UI không chặn tấn công offline.

## Các cơ chế chặn được trong phép thử

Đọc vault chưa mở khóa; nhập sai mật khẩu; sửa ciphertext; tráo ciphertext job1 sang job2 đều bị từ chối. Không tìm thấy đường giải mã file cache khi không biết mật khẩu trong các phép thử này. Không tuyên bố AES hoặc toàn extension đã được chứng minh an toàn.

## Bằng chứng và tái hiện

- `node tests/cache-security-audit.cjs` exit0: 7 probes có kết quả đúng kỳ vọng; bốn bị chặn, ba ghi nhận giới hạn. Exit0 không có nghĩa không có vấn đề.
- [Node output](../planning/04_2026-10-23_encrypted-cache/evidence/security-audit/node-probes.txt).
- [MAIN world đọc mật khẩu/giải mã canary sau khóa](../planning/04_2026-10-23_encrypted-cache/evidence/security-audit/browser-password-capture.txt).
- [Hai tab thật, khóa một tab](../planning/04_2026-10-23_encrypted-cache/evidence/security-audit/browser-multitab-lock.txt).
- Browser fixture: `tests/cache-security-audit.html`, chỉ dùng localhost riêng. Scripts được nạp bằng CDP createIsolatedWorld; không dùng fixture MAIN-world của lượt kiểm UI trước để kết luận cách ly extension.
- Agent thẩm định độc lập tái hiện Node tamper/substitution/replay/lock-scope, không sửa code.

Các kiểm tra còn thiếu: cài unpacked Chrome thật, chính sách doanh nghiệp, extension độc hại khác, bảo vệ OS/swap, XSS thực tế của CVAT, kiểm toán mật mã chuyên sâu. Chưa commit/push bản mã hóa. Nên xử lý A1/A2 hoặc chấp nhận rõ giới hạn trước khi phát hành.


## Khắc phục sau audit (2026-10-23)
A1: bỏ input mật khẩu khỏi content.js, chuyển sang popup origin extension; kênh riêng kiểm sender và challenge một lần. A2: nút khóa mọi tab cùng origin, token thu hồi được kiểm mỗi thao tác và hủy import muộn. Reviewer độc lập tìm thêm reset kho rỗng không hủy proof cũ; đã sửa bằng thu hồi trước Web Lock. 147/147 Node, 0 fail/skip. Mutation reset cũ exit1 (evidence/security-audit/reset-mutation.txt trong plan04).

Bằng chứng browser ở trên ghi nhận bản trước sửa, không phải chạy lại bản mới. Chưa thử popup/messaging bằng extension cài thật: Ego báo Method not available khi loadUnpacked. A3 replay và A4 mật khẩu yếu vẫn còn; không tuyên bố chống mã độc đang kiểm soát trang/máy. Hướng dẫn người dùng chỉ nhập mật khẩu ở popup thật để giảm nguy cơ trang giả mạo biểu mẫu.
