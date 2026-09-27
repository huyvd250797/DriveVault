# DriveVault Mobile V1.7.0 – Security & App Lock + Media Pro

V1.7.0 kế thừa toàn bộ V1.6.0 và tập trung vào 2 nhóm: **bảo mật truy cập trên thiết bị** và **xem/chọn media trực tiếp trong app**.

## Tính năng mới V1.7.0

### 1. Security & App Lock
- Tạo PIN từ 4–8 chữ số.
- PIN không lưu dạng plain text; app lưu hash PBKDF2 + salt trong `localStorage` của thiết bị.
- Auto-lock sau 1 / 5 / 15 / 30 / 60 phút không thao tác.
- Nút **Khóa ngay**.
- Đổi PIN / tắt App Lock bằng PIN hiện tại.
- Khi app đang khóa, toàn bộ dashboard bị che bởi màn hình mở khóa.

> App Lock là lớp khóa giao diện phía client, không phải mã hóa end-to-end database Google Sheet. PIN chỉ áp dụng trên thiết bị/trình duyệt hiện tại.

### 2. Protected Item
- Khi App Lock đã bật, lúc thêm/sửa có thể chọn **Bảo vệ mục này**.
- Block bảo vệ không hiển thị detail, link và thumbnail thật ở dashboard.
- Muốn mở block phải nhập lại PIN.
- Trường `protected` được đồng bộ vào Google Sheet để giữ trạng thái block.

### 3. Xem video trong app
Với media Google Drive app dùng chuỗi fallback:
1. Player HTML5 qua route `/api/media` cùng domain để hiển thị **hình + tiếng**.
2. Nếu stream trực tiếp không khả dụng, thử hiển thị file như ảnh.
3. Cuối cùng fallback về Google Drive Preview iframe.

Player có:
- Play/Pause, timeline, âm lượng bằng native controls.
- `playsInline` trên mobile.
- Nút **Fullscreen** riêng của DriveVault.
- Native fullscreen của browser/video vẫn dùng được.

### 4. Xem ảnh trong app
- Link ảnh trực tiếp hiển thị bằng image viewer trong Bottom Sheet.
- Google Drive image được thử đọc trực tiếp qua `/api/media`, sau đó fallback Google Drive Preview khi cần.
- Có nút fullscreen.

### 5. Chọn thumbnail từ video Drive
Khi thêm/sửa mục **Ảnh / Video**:
- Dán link Google Drive file.
- Player thumbnail picker xuất hiện.
- Kéo thanh timeline đến khung hình mong muốn.
- Bấm **Dùng khung hình này**.
- App chụp frame, resize/compress và lưu thumbnail dưới dạng JPEG data URL nhỏ trong Google Sheet.
- Thumbnail đã chọn được dùng ngay ở block dashboard.
- Có thể bấm **Dùng tự động** để quay lại thumbnail mặc định Drive.

Để kéo chọn frame từ video Drive, file cần cho phép server DriveVault đọc qua link, khuyến nghị quyền chia sẻ **Bất kỳ ai có liên kết**. File private vẫn có thể fallback sang Drive Preview trong trình duyệt, nhưng custom frame picker có thể không đọc được.

### 6. Media Proxy có hỗ trợ Range
Route mới:

```text
GET /api/media?fileId=GOOGLE_DRIVE_FILE_ID
```

Route forward HTTP `Range` sang Google Drive để video có thể seek mà không cần tải toàn bộ file trước.

## Database V1.7

Sheet `Vault` tự mở rộng thêm 2 cột cuối:

```text
thumbnail | protected
```

Schema đầy đủ:

```text
id | type | name | detail | url | createdAt | updatedAt | tags | pinned | useCount | lastUsedAt | collection | archived | deleted | deletedAt | thumbnail | protected
```

Không cần migrate thủ công. Dữ liệu V1.6 cũ giữ nguyên; hai cột mới sẽ trống/false.

`Backups` và `BackupData` tự kế thừa schema mới nên snapshot V1.7 chứa cả thumbnail/protected. Snapshot cũ vẫn restore được, hai trường mới sẽ mặc định rỗng/false.

## Nâng cấp từ V1.6.0

1. Mở Google Sheet → **Extensions → Apps Script**.
2. Thay toàn bộ `Code.gs` bằng file `google-apps-script/Code.gs` của V1.7.0.
3. **Deploy → Manage deployments → Edit → New version → Deploy**.
4. Giữ nguyên Web App URL `/exec`.
5. Giữ nguyên Script Property `DRIVEVAULT_API_KEY`.
6. Deploy source V1.7.0 lên Vercel.
7. Environment Variables giữ nguyên:

```env
GOOGLE_SCRIPT_URL=https://script.google.com/macros/s/xxxxx/exec
DRIVEVAULT_API_KEY=your-secret-key
```

## Lưu ý Google Drive media

- Google Drive file phải có quyền phù hợp để route server có thể stream trực tiếp.
- Với file chỉ cho tài khoản Google đăng nhập truy cập, player server-side có thể không đọc được; DriveVault sẽ fallback về Drive Preview iframe.
- Không nên dùng video cực lớn như một CDN. `/api/media` chỉ phục vụ trải nghiệm xem nhanh/thumbnail trong ứng dụng.
- Thumbnail custom được giới hạn khoảng 45 KB để không vượt giới hạn cell Google Sheets.

## Roadmap

- ✅ **V1.0.0 – Mobile Quick Storage** — Media / Content / Other, copy nhanh, link Drive.
- ✅ **V1.1.0 – Fast Capture & Mobile UX** — detail media, swipe, bottom sheet, light/dark.
- ✅ **V1.2.0 – Instant Save & Mobile Polish** — optimistic save, retry/idempotency, floating controls.
- ✅ **V1.3.0 – Smart Library & Reliability** — tag, pin, recent/frequent, offline queue, sync state, undo delete.
- ✅ **V1.4.0 – Search & Organization Pro** — advanced search, sort, collection, archive, bulk actions.
- ✅ **V1.5.0 – Backup & Data Portability** — export/import, snapshots, restore, diagnostics, recycle bin.
- ✅ **V1.6.0 – Media & Link Intelligence** — media/link intelligence, phân loại, compact dashboard.
- ✅ **V1.7.0 – Security & App Lock** — PIN lock, auto-lock, protected items, in-app media player, fullscreen, custom video thumbnail.
- ⏭️ **V2.0.0 – Google Account & Native Drive Integration** — Google Sign-In/OAuth, Drive Picker, upload file trực tiếp, quyền truy cập Drive theo tài khoản và đồng bộ đa thiết bị tốt hơn.

## Kiểm tra source

- `google-apps-script/Code.gs` đã qua JavaScript syntax check.
- TypeScript/TSX chính đã được kiểm tra bằng TypeScript compiler với dependency stubs trong môi trường đóng gói.
- `npm install` trong môi trường đóng gói bị timeout khi tải package nên chưa chạy được full `next build`; Vercel sẽ cài dependency thật khi deploy.
