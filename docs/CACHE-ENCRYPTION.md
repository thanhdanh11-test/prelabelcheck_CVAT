# Cache mã hóa — v1.14.0

## Sử dụng

1. Reload extension và tất cả tab CVAT đang mở. Mở job CVAT rồi bấm **biểu tượng extension trên thanh Chrome**.
2. Đặt mật khẩu cache riêng (12–1024 ký tự), nhập lại để xác nhận. Không dùng mật khẩu CVAT. Bấm **Tạo / Mở khóa**.
3. Tool mã hóa các liên kết nguồn item cũ, kiểm tra đọc lại rồi mới bỏ bản rõ; cache point cloud cũ được dọn và tải lại dưới dạng mã hóa. Nếu báo lỗi, chưa được coi là đã chuyển xong.
4. Những lần mở trang sau, nhập mật khẩu để dùng cache/nguồn item đã lưu. Khi chưa mở khóa, xem/chỉnh vẫn dùng RAM; nguồn item mới chưa được lưu bền. Mở khóa trước khi đóng trang nếu cần giữ nguồn vừa tạo.
5. **Khóa mọi tab cùng server** thu hồi khóa ở mọi tab cùng origin và hủy yêu cầu mở khóa đang chờ, đóng preview và giải phóng cloud buffers; bản nháp annotation giữ trong tab. Có thể tiếp tục xem bằng RAM. **Save CVAT** vẫn cần để lưu annotation lên server.
6. **Xóa cache** chỉ xóa point cloud mã hóa, giữ mật khẩu/nguồn item. **Quên mật khẩu / Xóa kho** cần xác nhận, xóa point cloud và nguồn item đã lưu để đặt mật khẩu mới. Không xóa annotation trên CVAT. Quên mật khẩu không khôi phục được lịch sử nguồn item mã hóa.

## Phạm vi và giới hạn

Point cloud và nguồn item (bao gồm dấu hình học) được mã hóa trước khi ghi. Checklist ID “Đã kiểm tra” và vị trí panel vẫn ở localStorage không mã hóa. Metadata cache gồm job/frame, kích thước, thời gian và thông tin KDF vẫn nhìn thấy. Bản nháp annotation không được lưu bền.

Mã hóa bảo vệ bản lưu khi không có mật khẩu; không bảo vệ máy/trang đã bị chiếm quyền khi mở khóa, bộ nhớ hoán đổi hệ điều hành, dữ liệu do CVAT hoặc trình duyệt lưu ngoài tool, hay người đã biết mật khẩu. Không tuyên bố xóa vật lý không thể phục hồi trên ổ đĩa. Cùng origin dùng chung một kho; chưa cách ly theo tài khoản CVAT. Không truyền mật khẩu/khóa ra server. Đăng xuất CVAT không phải tín hiệu khóa được nhận diện riêng; chủ động **Khóa mọi tab cùng server** hoặc đóng trang.

Cache cũ chưa mã hóa có thể còn cho đến lần mở khóa/chuyển dữ liệu thành công. Đóng/reload các tab chạy bản cũ: nâng version database chặn bản cũ ghi point cloud, nhưng không ngăn code cũ ghi lại localStorage nguồn item. Nếu bản cũ và bản mã hóa khác nhau, tool dừng chuyển và giữ cả hai thay vì ghi đè.

## Contract và vận hành

`cache-vault.js` chạy trong isolated world trước cloud-cache/content. Popup riêng thuộc origin extension; thêm quyền `activeTab`, không thêm dependency. Mật khẩu không nhập trong DOM CVAT. `CvatCacheVault.create()` cung cấp `unlock(password)`, `lock()`, `seal(name,bytes)`, `open(name,envelope)`, `readOrigins(key)`, `writeOrigins(key,json)`, `migrateOrigins()`, `withLock(action)`, `reset(clearCloud)`, `wrapStore(store)`.

- Header `cvat-cache-vault:v1`: salt ngẫu nhiên 16 byte, PBKDF2 SHA-256 600.000 vòng, vault ID ngẫu nhiên, verifier mã hóa. Khóa AES-256-GCM dùng trong tab không export được, chỉ trong RAM. Popup dẫn xuất khóa tạm có thể export để chuyển 32 byte qua Chrome runtime riêng; phía nhận import thành khóa không export được. Mảng byte được điền 0 sau xử lý, không cam kết xóa vật lý bộ nhớ/GC. Mật khẩu không được lưu.
- Envelope `{version:1,iv:number[12],data:base64}`; IV ngẫu nhiên mới cho mỗi lần ghi, tag 128 bit. AAD gắn origin/vault ID/tên record, chống tráo dữ liệu giữa record. Dùng [Web Cryptography API](https://www.w3.org/TR/webcrypto-1/).
- Cloud adapter ghi envelope dạng UTF-8 Uint8Array vào `cvat-track-resizer-clouds-encrypted-v1`; quota 1 GiB tính trên ciphertext, TTL 7 ngày dọn khi đọc/ghi. Mã hóa/giải mã ngoài IDB transaction. Tải cloud dùng `cache: no-store` để tránh yêu cầu lưu HTTP cache riêng từ tool; không kiểm soát cache của CVAT.
- Nguồn item mã hóa dưới `cvat-encrypted-origins:v1:<job>`. Toàn bộ read/merge/write và migration dùng cùng Web Lock với init/reset để tránh mất cập nhật giữa tab.
- Migration giữ bản rõ đến khi encrypted write/decrypt-verify thành công. Sau đó clear database cloud cũ và nâng version2; code cũ yêu cầu version1 bị từ chối. Bị tab cũ chặn upgrade thì báo đóng tab, không báo đã dọn.
- Reset đổi token thu hồi trước khi giữ Web Lock tới khi xóa cloud xong; token làm các tab khác khóa, kể cả kho chưa có header. Lock/clear vô hiệu hóa kết quả crypto đến muộn. Đóng trang bỏ khóa, không ghi mật khẩu để khôi phục tự động.

| Lỗi | Hành vi |
|---|---|
| Sai mật khẩu/verifier hỏng | Giữ nguyên dữ liệu, vẫn khóa |
| Ciphertext bị sửa hoặc sai context | Từ chối giải mã; cloud có thể tải từ CVAT vào RAM, không fallback ghi bản rõ |
| Crypto/Web Locks không có | Chỉ RAM, không tạo kho mã hóa |
| Storage/quota lỗi khi chuyển | Giữ bản rõ chưa chuyển và báo lỗi |
| Nguồn cũ khác bản mã hóa | Giữ cả hai, không ghi đè |
| Reset/khóa/đổi header giữa chừng | Loại kết quả muộn; mở khóa lại |

Rollback không khôi phục bản rõ: bản cũ không đọc được kho mới, database cloud version1 đã bị khóa bởi nâng version2. Không downgrade để tiếp tục ghi cache rõ.

## Kiểm chứng

147 Node tests, 0 fail/skip. Mutation cho adapter ghi XYZ rõ thay ciphertext làm test bảo mật đỏ. Review độc lập đã kiểm tráo AAD/ciphertext, đồng thời ghi nguồn và reset/unlock; hai race đã được sửa.

`tests/encrypted-cache-browser.html`: 5/5 trên Chromium/Ego thật — ciphertext IndexedDB, mở lại, tamper, nâng database cũ/chặn writer version1, migration nguồn và clear giữ nguồn. Chỉ dùng database/tên khóa test riêng.

`tests/cache-vault-ui.html`: fixture localhost riêng, không có annotation server; bản UI nhập mật khẩu cũ đã thử tạo/mở lại/sai mật khẩu/khóa/reset, tải nền 1/1 frame, ô mật khẩu rỗng sau submit, không lỗi JS. Chưa kiểm Apply/Save/reload trên server công ty hoặc cài unpacked Chrome thật. Mật khẩu demo trong fixture không phải mật khẩu người dùng.

## Audit đối kháng tiếp theo
Kiểm thử 2026-10-23 tìm được đường chụp mật khẩu khi trang đã bị chèn mã và xác nhận khóa chỉ áp dụng tab hiện tại; replay ciphertext cũ được nhận và mật khẩu yếu đoán offline được. Xem [CACHE-SECURITY-AUDIT.md](CACHE-SECURITY-AUDIT.md). Test chức năng xanh không có nghĩa không còn rủi ro bảo mật. A1/A2 đã được sửa ở code và kiểm thử Node; kiểm chứng popup với extension cài thật còn chờ. Replay và mật khẩu yếu vẫn là giới hạn.

## Kênh mở khóa riêng và thu hồi đa tab

`prepareUnlock(password, header, origin)` chỉ chạy trong popup, trả proof `{header,rawKey:number[32]}`. `acceptUnlock(proof, expectedHeader, expectedLock)` kiểm verifier, origin/header/token trước khi cài khóa. `lockAll()` đổi `cvat-cache-lock:v1`; `describe()` trả header/token công khai. `lock()` là primitive cục bộ dùng khi đóng trang; nút khóa gọi `lockAll()`.

`cache-channel.js` chỉ nhận `chrome.runtime.onMessage` từ đúng extension ID, đúng URL `cache-popup.html` và không có sender.tab. Challenge một lần hạn 120 giây gắn origin/job/header/token; thay job, khóa hoặc reset làm yêu cầu cũ mất hiệu lực. Không chuyển mật khẩu/khóa qua window.postMessage, DOM hoặc storage. Mỗi thao tác vault kiểm token trực tiếp nên không phụ thuộc storage event đến kịp. Popup không là web-accessible resource; không có externally_connectable.

Kiểm chứng mới: 147/147 Node, 0 fail/skip; gồm giả mạo sender, nonce replay/hết hạn, đổi job/header/token, khóa đa instance và reset khi đang tạo kho. Mutation bỏ thu hồi trong reset làm regression test thất bại. Ego từ chối API load unpacked (`Method not available`), nên chưa xác nhận luồng popup/messaging bằng extension cài thật. Các kết quả browser trước đây chỉ áp dụng lõi IDB và UI cũ.
