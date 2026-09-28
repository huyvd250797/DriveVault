# DriveVault Mobile V2.1.0 – Media Library Pro

V2.1.0 nâng DriveVault từ kho lưu trữ cá nhân thành **thư viện media dùng thực tế trên mobile**, đồng thời xử lý lỗi thanh tìm kiếm/bộ lọc bị tràn vào vùng giờ/pin của iPhone khi sticky lúc scroll.

## Tính năng mới V2.1.0

### 1. Media Library Pro
- Khi chọn loại **Ảnh / Video**, DriveVault chuyển sang thư viện media chuyên dụng.
- Có 2 kiểu hiển thị:
  - **Gallery/Grid** để duyệt nhanh thumbnail.
  - **Danh sách** để dùng lại card chi tiết và swipe như trước.
- Media Grid tối ưu mobile 2 cột; màn hình lớn hiển thị 3 cột.
- Hiển thị thumbnail/cover, loại media, trạng thái ghim và phân loại.

### 2. Lọc Ảnh / Video
- Trong Media Library có bộ lọc nhanh:
  - Tất cả
  - Ảnh
  - Video
- Direct image/video, YouTube và nội dung có tag rõ ràng được nhận diện ngay.
- Với Google Drive file chưa xác định loại, app gọi metadata nhẹ qua `/api/media?meta=1` để đọc `Content-Type`, sau đó cache loại media trên thiết bị.

### 3. Gallery fullscreen + swipe
- Chạm thumbnail trong Grid mở **Gallery toàn màn hình trong app**.
- Vuốt trái/phải để chuyển media.
- Có nút Previous / Next.
- Có số thứ tự `x / tổng`.
- Có nút mở chi tiết block và mở link gốc.
- Player/ảnh trong Gallery tiếp tục hỗ trợ nút fullscreen thật của trình duyệt.

### 4. Video nhớ vị trí xem dở
- Với video chạy bằng player HTML5 (Google Drive stream/direct video), DriveVault lưu vị trí hiện tại vào localStorage.
- Mở lại video sẽ tiếp tục từ vị trí gần nhất nếu chưa xem xong.
- Khi video kết thúc, tiến độ được reset về đầu.
- Không ghi dữ liệu tiến độ vào Google Sheet nên không làm nặng database.

### 5. Cover / Thumbnail
- Giữ nguyên cơ chế chọn khung hình video từ V1.7/V2.0.
- Thumbnail tùy chỉnh tiếp tục được ưu tiên hiển thị trong Media Grid.
- Nếu chưa có cover tùy chỉnh, app dùng thumbnail Drive/YouTube khi có.

### 6. Bulk media actions
- Chế độ **Chọn nhiều** hiện có tiếp tục hoạt động với Media Grid.
- Có thể chọn trực tiếp từng tile trong Gallery Grid.
- Bulk pin / unpin / archive / move classification / delete tiếp tục dùng Offline Queue hiện tại.

### 7. Fix iPhone Safe Area – Search & Filter (Deploy Fix 2)
- **Khôi phục đầy đủ Header** ở đầu trang: logo/tên DriveVault, App Lock, Data/Backup, Dark/Light và Reload/Sync.
- Header là nội dung bình thường của trang, **không sticky** và không bị thanh tìm kiếm che.
- Chỉ riêng **Tìm kiếm + nút Bộ lọc** mới sticky khi người dùng bắt đầu scroll xuống.
- Khi sticky trên iPhone/PWA, thanh này tự hạ xuống dưới `safe-area-inset-top`, tránh vùng giờ / Dynamic Island / sóng / Wi‑Fi / pin.
- Bộ lọc loại lưu trữ và toolbar Media tiếp tục scroll theo nội dung, không chiếm vùng header cố định.

```css
--dv-sticky-safe-top: max(8px, env(safe-area-inset-top));
```

Cơ chế safe-area chỉ được kích hoạt khi đang scroll, nên lúc ở đầu trang bố cục Header vẫn hiển thị đúng như V2.0.

## Database / Google Apps Script

**Không thay đổi schema `Vault`.**

Schema vẫn là:

```text
id | type | name | detail | url | createdAt | updatedAt | tags | pinned | useCount | lastUsedAt | collection | archived | deleted | deletedAt | thumbnail | protected
```

V2.1 chỉ mở rộng `/api/media` ở Next.js để đọc metadata MIME của file Drive khi cần lọc Ảnh/Video. Không cần thêm cột Google Sheet.

## Nâng cấp từ V2.0.0

1. Deploy source V2.1.0 lên Vercel.
2. Giữ nguyên Environment Variables:

```env
GOOGLE_SCRIPT_URL=https://script.google.com/macros/s/xxxxx/exec
DRIVEVAULT_API_KEY=your-secret-key
```

3. **Không cần migrate Google Sheet.**
4. **Không bắt buộc redeploy Apps Script** nếu V2.0/V1.7 backend hiện tại đang chạy ổn, vì schema/API Apps Script không đổi.
5. Service Worker cache đã đổi sang namespace V2.1 để client nhận shell mới.

## Roadmap

- ✅ V1.0.0 – Mobile Quick Storage
- ✅ V1.1.0 – Fast Capture & Mobile UX
- ✅ V1.2.0 – Instant Save & Mobile Polish
- ✅ V1.3.0 – Smart Library & Reliability
- ✅ V1.4.0 – Search & Organization Pro
- ✅ V1.5.0 – Backup & Data Portability
- ✅ V1.6.0 – Media & Link Intelligence
- ✅ V1.7.0 – Security & App Lock + Media Pro
- ✅ V2.0.0 – Personal Vault Pro & Quick Capture
- ✅ **V2.1.0 – Media Library Pro**
- ⏭️ **V2.2.0 – Smart Rules & Automation**

### V2.2.0 dự kiến
- Rule tự động theo URL/domain/nội dung.
- Auto Classification.
- Auto Tag.
- Auto Pin theo điều kiện.
- Tự nhận diện Shopee/YouTube/Drive/TikTok sâu hơn.
- Chạy rule lại trên dữ liệu cũ.
- Preview kết quả trước khi apply hàng loạt.

## Kiểm tra source

- TypeScript/TSX đã qua syntax/transpile check bằng TypeScript compiler.
- `public/sw.js` đã qua `node --check`.
- `google-apps-script/Code.gs` đã qua JavaScript syntax check bằng bản sao `.js`.
- `npm install` trong môi trường đóng gói bị timeout khi tải dependency, nên chưa chạy được full `next build`; Vercel sẽ cài dependency thật khi deploy.
