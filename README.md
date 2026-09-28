# DriveVault Mobile V2.0.0 – Personal Vault Pro & Quick Capture

V2.0.0 là bản major dành đúng cho mô hình **app quản lý cá nhân, không cần đăng nhập**. App tiếp tục dùng Google Sheets/Google Drive theo kiến trúc hiện tại, nhưng tăng mạnh tốc độ ghi nhanh và trải nghiệm cài như ứng dụng trên điện thoại.

## Tính năng mới V2.0.0

### 1. PWA + branding DriveVault
- Dùng logo DriveVault người dùng cung cấp làm icon ứng dụng.
- Có `manifest.webmanifest`, app icon 192/512, Apple Touch Icon và favicon.
- Có Service Worker cache app shell để mở app nhanh hơn sau lần đầu.
- Có shortcut **Thêm nhanh** khi môi trường PWA hỗ trợ.
- Trong **Bộ lọc → Dashboard cá nhân**, nếu browser phát sự kiện cài đặt PWA sẽ có nút **Cài DriveVault lên thiết bị**.

### 2. Quick Capture
- Nút `+` vẫn là thao tác thêm chính.
- DriveVault nhớ **loại lưu trữ + phân loại + tag** của lần thêm gần nhất.
- Lần thêm sau tự điền lại các giá trị này.
- Khi đang ở loại Nội dung, có ô **Dán link nhanh**: dán URL hợp lệ sẽ tự chuyển loại phù hợp.

### 3. Smart Link
Tự nhận diện một số nguồn phổ biến:
- Google Drive file → `Ảnh / Video`, phân loại `Media`.
- YouTube → `Ảnh / Video`, tag `video`, `youtube`.
- TikTok → `Ảnh / Video`, tag `video`, `tiktok`.
- Shopee → `Khác`, phân loại `Shopee`, tag `shopee`, `mua sắm`.
- Lazada → `Khác`, phân loại `Mua sắm`.
- Ảnh/video direct URL → `Ảnh / Video`.
- Web link thông thường → `Khác`, phân loại `Liên kết`.

Auto-fill chỉ ưu tiên khi tạo mới và chưa có phân loại/tag thủ công để hạn chế ghi đè lựa chọn của người dùng.

### 4. Quick Templates
- Có thể bấm **Lưu form hiện tại thành mẫu**.
- Mẫu lưu cục bộ trên thiết bị, tối đa 20 mẫu.
- Chạm một mẫu để điền nhanh type/name/detail/link/tag/phân loại.
- Có thể xóa mẫu ngay trên Quick Capture.

### 5. Duplicate Warning
Trước khi thêm/sửa, DriveVault kiểm tra:
- URL trùng chính xác; hoặc
- tên + nội dung chuẩn hóa trùng.

Nếu phát hiện trùng, app hiển thị mục cũ và cho chọn:
- **Xem mục cũ**;
- **Vẫn lưu**.

### 6. Share to DriveVault
PWA khai báo Web Share Target:
- Share link/text từ ứng dụng/trình duyệt khác → chọn DriveVault (nếu nền tảng/browser hỗ trợ).
- Route `/share-target` nhận title/text/url rồi chuyển về `/?quick=1...`.
- Quick Capture tự nhận diện link và điền form.

### 7. Personal Dashboard
Khi dashboard không có filter/search, app có thể hiển thị các lane nhanh:
- Đã ghim.
- Gần đây.
- Dùng nhiều.
- Phân loại yêu thích.

Trong **Bộ lọc → Dashboard cá nhân** có thể:
- bật/tắt từng lane;
- chọn phân loại yêu thích;
- chọn mật độ `Gọn` hoặc `Thoải mái`.

### 8. Cache-first startup
V2.0 đọc cache V1.7 trước và hiển thị ngay, sau đó mới đồng bộ nền với API. Offline Queue từ V1.7 được migrate sang namespace V2.0 nên thao tác đang chờ không bị mất.

## Database / Google Apps Script

**V2.0.0 không thay đổi schema Google Sheet so với V1.7.0.**

Schema `Vault` vẫn là:

```text
id | type | name | detail | url | createdAt | updatedAt | tags | pinned | useCount | lastUsedAt | collection | archived | deleted | deletedAt | thumbnail | protected
```

Quick Templates, dashboard config và Quick Capture preferences là dữ liệu cá nhân trên thiết bị (`localStorage`), không làm nặng Google Sheet.

Vì backend schema/API không đổi, nếu V1.7.0 của bạn đang hoạt động ổn thì **không bắt buộc redeploy Apps Script chỉ để dùng V2.0.0**. File `Code.gs` vẫn được kèm trong source để triển khai mới khi cần.

## Nâng cấp từ V1.7.0

1. Deploy source V2.0.0 lên Vercel.
2. Giữ nguyên Environment Variables:

```env
GOOGLE_SCRIPT_URL=https://script.google.com/macros/s/xxxxx/exec
DRIVEVAULT_API_KEY=your-secret-key
```

3. Không cần migrate Google Sheet.
4. Cache/offline queue V1.7 sẽ tự migrate khi app V2.0 chạy lần đầu.
5. Nếu muốn cài PWA, mở site qua HTTPS/Vercel và dùng tùy chọn cài đặt của browser/DriveVault.

## Files quan trọng mới

```text
public/manifest.webmanifest
public/sw.js
public/icons/icon-192.png
public/icons/icon-512.png
public/icons/apple-touch-icon.png
public/icons/favicon-64.png
app/share-target/route.ts
```

## Roadmap

- ✅ V1.0.0 – Mobile Quick Storage
- ✅ V1.1.0 – Fast Capture & Mobile UX
- ✅ V1.2.0 – Instant Save & Mobile Polish
- ✅ V1.3.0 – Smart Library & Reliability
- ✅ V1.4.0 – Search & Organization Pro
- ✅ V1.5.0 – Backup & Data Portability
- ✅ V1.6.0 – Media & Link Intelligence
- ✅ V1.7.0 – Security & App Lock + Media Pro
- ✅ **V2.0.0 – Personal Vault Pro & Quick Capture**
- ⏭️ **V2.1.0 – Media Library Pro**

### V2.1.0 dự kiến
- Media Grid riêng.
- Album/Gallery.
- Swipe ảnh fullscreen.
- Nhớ vị trí xem video.
- Thumbnail/Cover manager nâng cao.
- Lọc và bulk actions riêng cho media.

## Kiểm tra source

- `google-apps-script/Code.gs` đã qua JavaScript syntax check (bằng bản sao `.js`).
- `public/sw.js` đã qua Node syntax check.
- TypeScript/TSX chính đã qua compiler với dependency stubs trong môi trường đóng gói.
- `npm install` trong môi trường đóng gói bị timeout khi tải package, nên chưa chạy được full `next build`; Vercel sẽ cài dependency thật khi deploy.
