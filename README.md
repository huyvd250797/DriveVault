# DriveVault Mobile V1.1.0

Phiên bản nâng cấp của DriveVault theo hướng mobile-first, tối ưu thao tác nhanh và quản lý nội dung bằng Google Sheets trên Google Drive.

## Nâng cấp V1.1.0 – Fast Capture & Mobile UX

- Tối ưu tốc độ thêm mới: sau khi Google Apps Script trả bản ghi vừa tạo, giao diện cập nhật ngay, **không tải lại toàn bộ Google Sheet**.
- Loại `Ảnh / Video` có thêm **Nội dung chi tiết**.
- Swipe trái trên block để hiện **Sửa / Xóa**.
- Bấm vào block mở **bottom sheet** hiển thị toàn bộ nội dung.
- Cho phép sửa dữ liệu và xóa dữ liệu trên Google Sheet.
- Dark mode / Light mode, ghi nhớ lựa chọn trên thiết bị.
- Dashboard mới: card hiện đại, thống kê nhanh, search, filter, action rõ ràng, tối ưu thao tác một tay.
- Xử lý lỗi API tốt hơn khi Google Apps Script trả HTML thay vì JSON.

## Quan trọng khi nâng cấp từ V1.0.0

Frontend V1.1.0 cần backend Apps Script mới để dùng được **Sửa / Xóa**.

1. Mở Google Sheet database hiện tại.
2. Vào **Extensions → Apps Script**.
3. Thay code cũ bằng toàn bộ nội dung file `google-apps-script/Code.gs` của V1.1.0.
4. Chọn **Deploy → Manage deployments → Edit**.
5. Chọn **New version** rồi Deploy lại.
6. Nếu URL `/exec` không đổi thì không cần đổi `GOOGLE_SCRIPT_URL` trên Vercel.
7. Redeploy frontend Vercel với source V1.1.0.

Tab `Vault` cũ vẫn dùng được. Cột `updatedAt` sẽ được bổ sung tự động khi backend V1.1.0 chạy.

## Cấu hình Vercel

```env
GOOGLE_SCRIPT_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
DRIVEVAULT_API_KEY=CHUOI_BI_MAT_GIONG_TRONG_SCRIPT_PROPERTIES
```

## Cấu trúc dữ liệu

| id | type | name | detail | url | createdAt | updatedAt |
|---|---|---|---|---|---|---|
| UUID | media/content/other | Tên | Nội dung chi tiết | Link Drive | ISO datetime | ISO datetime |

## Quy tắc từng loại

- **Ảnh / Video**: Tên + Link Drive bắt buộc; nội dung chi tiết tùy chọn.
- **Nội dung**: Tên + nội dung chi tiết bắt buộc; hỗ trợ copy nhanh.
- **Khác**: Tên bắt buộc; cần ít nhất nội dung hoặc link.

## Chạy local

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Deploy Vercel

Import repository/folder lên Vercel, khai báo Environment Variables rồi Deploy.

## Phiên bản

`V1.1.0 - Fast Capture & Mobile UX`
