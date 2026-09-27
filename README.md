# DriveVault Mobile V1.3.0 – Smart Library & Reliability

V1.3.0 nâng DriveVault từ kho lưu trữ nhanh thành thư viện cá nhân có tổ chức và có cơ chế chống mất thao tác khi mạng chập chờn.

## Điểm mới

### 1. Tag
- Mỗi mục có thể gắn nhiều tag, nhập cách nhau bằng dấu phẩy.
- Tag được hiển thị ngay trên card và trong bottom sheet.
- Dashboard có bộ lọc theo tag.
- Tìm kiếm cũng tìm trong tag.

### 2. Pin
- Có nút ghim ngay trên card và trong bottom sheet.
- Mục đã ghim được ưu tiên hiển thị trước ở chế độ mặc định.
- Có tab **Đã ghim** riêng.

### 3. Recent / Frequently Used
- App ghi nhận số lần sử dụng khi người dùng **Sao chép nội dung** hoặc **Truy cập Drive**.
- Tab **Gần đây** sắp xếp theo lần sử dụng gần nhất.
- Tab **Dùng nhiều** sắp xếp theo số lượt sử dụng.
- Thống kê tổng lượt sử dụng hiển thị trên dashboard.

### 4. Offline Queue
- Thêm mới, chỉnh sửa, ghim/bỏ ghim và ghi nhận lượt dùng được cập nhật ngay trên UI.
- Khi mất mạng, thao tác được lưu trong `localStorage` và chuyển sang trạng thái **Chờ đồng bộ**.
- Khi có mạng lại, app tự đồng bộ hàng đợi lên Google Sheet.
- Có nút **Đồng bộ ngay** để retry thủ công.
- Dữ liệu gần nhất cũng được cache local để mở app nhanh hơn.

> Offline queue hoạt động khi app đã được mở/tải trước đó trên thiết bị. V1.3 chưa phải PWA offline hoàn toàn.

### 5. Sync State
Mỗi card hiển thị một trong các trạng thái:
- `Đã đồng bộ`
- `Chờ đồng bộ`
- `Đang đồng bộ`
- `Lỗi đồng bộ`

Thanh trạng thái phía trên dashboard cho biết thiết bị đang online/offline và số thao tác đang chờ.

### 6. Undo Delete
- Swipe trái → Xóa: card biến mất ngay.
- App cho **5 giây Hoàn tác**.
- Chỉ sau thời gian này thao tác xóa mới được đưa lên Google Sheet.
- Nếu xóa một mục vừa tạo nhưng chưa sync, app hủy luôn thao tác tạo thay vì tạo rồi xóa trên server.

## Nâng cấp database từ V1.2.0

V1.3 giữ nguyên Sheet `Vault` và tự mở rộng header từ:

```text
id | type | name | detail | url | createdAt | updatedAt
```

thành:

```text
id | type | name | detail | url | createdAt | updatedAt | tags | pinned | useCount | lastUsedAt
```

Dữ liệu cũ không bị xóa. Các cột mới mặc định:
- `tags`: `[]`
- `pinned`: `false`
- `useCount`: `0`
- `lastUsedAt`: trống

## Bắt buộc khi nâng cấp từ V1.2.0

1. Mở Google Sheet database hiện tại.
2. Vào **Extensions → Apps Script**.
3. Thay code cũ bằng toàn bộ file `google-apps-script/Code.gs` của V1.3.0.
4. Vào **Deploy → Manage deployments → Edit**.
5. Chọn **New version → Deploy**.
6. Giữ nguyên Web App URL nếu URL hiện tại vẫn kết thúc bằng `/exec`.
7. Đảm bảo `DRIVEVAULT_API_KEY` trong **Script Properties** giống Environment Variable trên Vercel.
8. Deploy source V1.3.0 lên Vercel.
9. Mở app và bấm nút Refresh/Sync một lần để backend tự bổ sung header mới.

## Environment Variables

```env
GOOGLE_SCRIPT_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
DRIVEVAULT_API_KEY=CHUOI_BI_MAT_GIONG_TRONG_SCRIPT_PROPERTIES
```

## Cấu trúc dữ liệu V1.3

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
| `pinned` | Đã ghim hay chưa |
| `useCount` | Số lượt sử dụng |
| `lastUsedAt` | Lần sử dụng gần nhất |

## Lưu ý về thống kê lượt dùng

Để tránh retry làm tăng sai số khi mạng chập chờn, client gửi **mốc useCount hiện tại**, backend lấy giá trị lớn hơn giữa dữ liệu trên Sheet và dữ liệu client. Cơ chế này ưu tiên tính idempotent và phù hợp với app cá nhân/single-user.

## Chạy local

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Deploy Vercel

Import folder lên Vercel, khai báo 2 Environment Variables rồi Deploy.

## Phiên bản

`V1.3.0 – Smart Library & Reliability`
