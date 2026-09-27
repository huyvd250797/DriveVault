# DriveVault Mobile V1.6.0 – Media & Link Intelligence

V1.6.0 nâng cấp trải nghiệm media/link và tinh gọn dashboard mobile. Bản này kế thừa toàn bộ Backup & Data Portability V1.5.0, Search & Organization Pro V1.4.0 và Offline Queue/Sync State của V1.3.0.

## Tính năng mới V1.6.0

### 1. Dashboard gọn hơn
Ngoài dashboard chỉ giữ các điều khiển chính:
- Ô tìm kiếm.
- Nút **Bộ lọc**.
- Bộ lọc **Loại lưu trữ**: Tất cả / Ảnh & Video / Nội dung / Khác.

Các nội dung trước đây chiếm nhiều diện tích được chuyển vào Bottom Sheet Bộ lọc:
- Trạng thái thư viện: Tất cả / Đã ghim / Gần đây / Dùng nhiều / Lưu trữ / Thùng rác.
- Sắp xếp.
- Chọn nhiều.
- Phân loại.
- Tag.
- Phạm vi tìm kiếm nâng cao.
- Từ ngày / Đến ngày.
- Có link / Không có link.

Nút bộ lọc có badge hiển thị số điều kiện đang được áp dụng.

### 2. Ẩn ngày lưu khỏi card
`createdAt` vẫn được lưu đầy đủ trong database, backup và màn hình chi tiết, nhưng **không còn hiển thị ngoài dashboard** để tránh bị hiểu nhầm thành ngày diễn ra hoạt động/nội dung của block.

### 3. Phân loại độc lập
V1.6 dùng trường `collection` cũ làm giá trị phân loại trên item để giữ tương thích dữ liệu, nhưng bổ sung sheet riêng:

```text
Classifications
name | createdAt
```

Có thể:
- Tạo trước phân loại mới, ví dụ `Shopee`.
- Lọc dashboard theo phân loại.
- Chọn phân loại khi thêm/sửa item.
- Chọn nhiều item và chuyển hàng loạt sang một phân loại.
- Các collection cũ của V1.5 tự được nhận diện như phân loại hiện có, không mất dữ liệu.

### 4. Click logo/tên app để làm mới
Bấm logo hoặc tên **DriveVault / Kho dùng nhanh** sẽ:
- Xóa nội dung tìm kiếm.
- Đưa loại lưu trữ về `Tất cả`.
- Xóa Tag/Phân loại đang lọc.
- Đưa trạng thái thư viện về `Tất cả`.
- Đưa Sort về `Sắp xếp thông minh`.
- Xóa điều kiện ngày/link/tìm kiếm nâng cao.
- Thoát chế độ chọn nhiều.
- Scroll lên đầu trang.
- Đồng bộ queue và tải lại dữ liệu mới từ Google Sheet.

### 5. Media & Link Intelligence
Không cần Google OAuth/Drive API để có trải nghiệm preview cơ bản.

App tự nhận diện:
- Google Drive file.
- Google Drive folder.
- YouTube / YouTube Shorts.
- Link ảnh trực tiếp.
- Link web thông thường.
- Link không hợp lệ.

Đối với item **Ảnh/Video**:
- Google Drive file có thumbnail được tải **lazy** và không chặn quá trình lưu item.
- YouTube có thumbnail.
- Link ảnh trực tiếp có preview.
- Bottom Sheet chi tiết có preview/embed khi nhà cung cấp hỗ trợ.
- Hiển thị loại link, nhà cung cấp và File ID/Video ID khi có thể phân tích từ URL.

> Google Drive thumbnail/preview chỉ hiển thị nếu quyền chia sẻ của file cho phép trình duyệt truy cập. V1.6 không đọc nội dung file bằng Drive API và không thể xác nhận quyền truy cập file private chỉ từ URL.

### 6. Data Diagnostics V1.6
Data Tools tiếp tục phát hiện:
- dữ liệu nghi trùng;
- URL không hợp lệ;
- media link không nhận diện rõ ràng;
- Trash và backup snapshot.

## Database

Sheet `Vault` giữ nguyên schema V1.5:

```text
id | type | name | detail | url | createdAt | updatedAt | tags | pinned | useCount | lastUsedAt | collection | archived | deleted | deletedAt
```

V1.6 tự tạo thêm sheet:

```text
Classifications
name | createdAt
```

Không cần migrate thủ công.

## Nâng cấp từ V1.5.0

1. Mở Google Sheet database → **Extensions → Apps Script**.
2. Thay toàn bộ `Code.gs` bằng `google-apps-script/Code.gs` của V1.6.0.
3. Chọn **Deploy → Manage deployments → Edit → New version → Deploy**.
4. Giữ nguyên Web App URL `/exec` và Script Property `DRIVEVAULT_API_KEY`.
5. Deploy source V1.6.0 lên Vercel.
6. Environment Variables vẫn giữ nguyên:

```env
GOOGLE_SCRIPT_URL=https://script.google.com/macros/s/xxxxx/exec
DRIVEVAULT_API_KEY=your-secret-key
```

7. Sau lần mở đầu tiên, sheet `Classifications` sẽ được tạo tự động khi app tải danh sách phân loại.

## Roadmap

- ✅ **V1.0.0 – Mobile Quick Storage** — Media / Content / Other, copy nhanh, link Drive.
- ✅ **V1.1.0 – Fast Capture & Mobile UX** — detail cho media, swipe, bottom sheet, light/dark.
- ✅ **V1.2.0 – Instant Save & Mobile Polish** — optimistic save, retry/idempotency, floating controls.
- ✅ **V1.3.0 – Smart Library & Reliability** — tag, pin, recent/frequent, offline queue, sync state, undo delete.
- ✅ **V1.4.0 – Search & Organization Pro** — advanced search, sort, collection, archive, bulk actions.
- ✅ **V1.5.0 – Backup & Data Portability** — export/import, snapshots, restore, diagnostics, recycle bin.
- ✅ **V1.6.0 – Media & Link Intelligence** — lazy thumbnail/preview, link intelligence, phân loại riêng, dashboard filter compact.
- ⏭️ **V1.7.0 – Security & App Lock** — PIN lock, auto-lock, protected items và nền tảng xác thực tốt hơn trước khi đi lên V2.0.

## Kiểm tra source

- `google-apps-script/Code.gs` đã qua kiểm tra cú pháp JavaScript.
- TypeScript chính đã được kiểm tra bằng TypeScript compiler với dependency stubs trong môi trường đóng gói.
- `npm install` trong môi trường đóng gói bị timeout khi tải package nên chưa chạy được full `next build`; Vercel sẽ cài dependencies thật khi deploy.
