# DriveVault Mobile V1.4.0 – Search & Organization Pro

V1.4.0 nâng DriveVault từ thư viện dùng nhanh thành kho dữ liệu có tổ chức tốt hơn khi số lượng block tăng lớn: tìm kiếm nâng cao, sort, collection, archive và thao tác hàng loạt.

## Điểm mới V1.4.0

### 1. Tìm kiếm nâng cao
- Tìm theo nhiều từ khóa; mọi từ khóa phải xuất hiện trong phạm vi được chọn.
- Hỗ trợ cụm từ trong dấu ngoặc kép, ví dụ: `"mẫu email"`.
- Cho phép chọn phạm vi tìm trong: Tên, Nội dung, Link, Tag, Collection.
- Lọc theo khoảng ngày tạo.
- Lọc mục có link / không có link.
- Giữ tương thích với bộ lọc loại, tag, collection và chế độ thư viện.

### 2. Sort
Có các kiểu sắp xếp:
- Thông minh (giữ logic Pin + mới nhất; tự ưu tiên Recent/Frequent theo tab).
- Mới nhất / Cũ nhất.
- Tên A → Z / Z → A.
- Dùng gần đây.
- Dùng nhiều nhất.

### 3. Folder / Collection
- Mỗi item có thêm `collection`.
- Khi tạo/sửa có thể chọn collection cũ hoặc nhập collection mới.
- Dashboard lọc nhanh theo collection.
- Collection hiển thị ngay trên card và bottom sheet.
- Bulk Move cho phép chuyển nhiều mục sang collection có sẵn hoặc collection mới.

> V1.4 dùng mô hình **1 item thuộc 1 collection**. Tag vẫn dùng cho phân loại nhiều chiều.

### 4. Archive
- Mỗi item có trạng thái `archived`.
- Item archive được ẩn khỏi thư viện chính.
- Có tab **Lưu trữ** riêng.
- Trong bottom sheet có nút **Lưu trữ / Khôi phục**.
- Bulk Archive / Restore hỗ trợ nhiều mục cùng lúc.

### 5. Bulk Actions
Bấm **Chọn nhiều** để bật selection mode:
- Chọn từng item hoặc Chọn tất cả kết quả đang hiển thị.
- Ghim.
- Bỏ ghim.
- Lưu trữ.
- Khôi phục.
- Chuyển collection.
- Xóa nhiều mục.

Bulk action được gửi lên Google Apps Script theo **một batch request**, không gọi tuần tự từng item. Các action bulk là idempotent và đi qua Offline Queue nên có thể retry an toàn.

## Giữ nguyên tính năng V1.3
- Tag / Pin.
- Recent / Frequently Used.
- Offline Queue.
- Sync State.
- Undo Delete cho thao tác xóa đơn.
- Dark / Light mode.
- Swipe trái Sửa / Xóa.
- Bottom sheet chi tiết khóa scroll background.
- Optimistic save và cache local.

## Nâng cấp database từ V1.3.0

V1.3:

```text
id | type | name | detail | url | createdAt | updatedAt | tags | pinned | useCount | lastUsedAt
```

V1.4 tự mở rộng thành:

```text
id | type | name | detail | url | createdAt | updatedAt | tags | pinned | useCount | lastUsedAt | collection | archived
```

Dữ liệu cũ không bị xóa. Giá trị mặc định:
- `collection`: `Chưa phân loại`
- `archived`: `false`

## Bắt buộc khi nâng cấp từ V1.3.0

1. Mở Google Sheet database hiện tại.
2. Vào **Extensions → Apps Script**.
3. Thay toàn bộ code bằng file `google-apps-script/Code.gs` của V1.4.0.
4. Vào **Deploy → Manage deployments → Edit**.
5. Chọn **New version → Deploy**.
6. Giữ nguyên Web App URL `/exec` hiện tại.
7. Kiểm tra `DRIVEVAULT_API_KEY` trong Script Properties vẫn giống Environment Variable trên Vercel.
8. Deploy source V1.4.0 lên Vercel.
9. Mở app và bấm Refresh/Sync một lần. Backend sẽ tự thêm header mới.

## Environment Variables

```env
GOOGLE_SCRIPT_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
DRIVEVAULT_API_KEY=YOUR_SECRET_KEY
```

## Schema V1.4

| Cột | Ý nghĩa |
|---|---|
| `id` | UUID do client sinh |
| `type` | `media` / `content` / `other` |
| `name` | Tên mục |
| `detail` | Nội dung chi tiết |
| `url` | Link Drive |
| `createdAt` | Ngày tạo |
| `updatedAt` | Ngày cập nhật |
| `tags` | JSON array tag |
| `pinned` | Ghim |
| `useCount` | Số lượt sử dụng |
| `lastUsedAt` | Lần sử dụng gần nhất |
| `collection` | Collection chứa item |
| `archived` | Đã lưu trữ hay chưa |

## Roadmap

- ✅ **V1.0.0 – Mobile Quick Storage**: lưu Ảnh/Video, Nội dung, Khác; copy nhanh; mở link Drive; mobile-first.
- ✅ **V1.1.0 – Fast Capture & Mobile UX**: nội dung chi tiết cho media, swipe Sửa/Xóa, bottom sheet, dark/light mode.
- ✅ **V1.2.0 – Instant Save & Mobile Polish**: optimistic save, retry/idempotency, floating controls, khóa scroll background.
- ✅ **V1.3.0 – Smart Library & Reliability**: tag, pin, recent/frequent, offline queue, sync state, undo delete.
- ✅ **V1.4.0 – Search & Organization Pro**: advanced search, sort, collection, archive, bulk actions.
- ⏭️ **V1.5.0 – Backup & Data Portability**: export/import, backup snapshot, restore, duplicate detection và kiểm tra tính toàn vẹn dữ liệu.
- 🔜 **V2.0.0 – Google Account & Drive Integration**: đăng nhập Google, Drive Picker / upload trực tiếp và phân tách dữ liệu theo tài khoản nếu cần.

## Phiên bản tiếp theo – V1.5.0

**DriveVault Mobile V1.5.0 – Backup & Data Portability** nên tập trung vào bảo vệ và di chuyển dữ liệu:
- Export toàn bộ thư viện ra JSON và CSV.
- Import từ file backup.
- Preview trước khi import.
- Merge / Skip / Replace khi trùng ID hoặc nội dung.
- Backup snapshot có timestamp.
- Restore snapshot.
- Kiểm tra link Drive lỗi / trống.
- Duplicate detector theo tên + nội dung + URL.
- Báo cáo tổng quan dữ liệu trước/sau restore.

## Chạy local

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Deploy Vercel
Import project lên Vercel, giữ 2 Environment Variables hiện tại rồi Deploy.

## Phiên bản
`V1.4.0 – Search & Organization Pro`
