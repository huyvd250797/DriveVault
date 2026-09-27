# DriveVault Mobile V1.2.0

Bản nâng cấp tập trung vào tốc độ lưu dữ liệu, swipe action, floating controls và trải nghiệm bottom sheet trên mobile.

## Nâng cấp V1.2.0 – Instant Save & Mobile Polish

- Card chuyển sang nền solid, không còn nhìn xuyên thấy nút Sửa/Xóa phía dưới.
- Sửa/Xóa chỉ hiển thị khi người dùng thực sự swipe trái.
- Nút Thêm mới thu nhỏ thành FAB `+` ở góc phải dưới.
- Sau 0,5 giây không scroll, cụm floating button giảm opacity; khi đang scroll opacity trở lại 100%.
- Có nút mũi tên lên đầu trang; chỉ hiện khi đã scroll xuống và tự ẩn khi về đầu trang.
- Bottom sheet khóa scroll của background; chỉ phần sheet được phép cuộn.
- Thêm mới dùng optimistic UI: block xuất hiện ngay, không chờ Google Apps Script hoàn tất.
- Request tạo mới dùng ID do client sinh để retry an toàn, tránh ghi trùng nếu Apps Script phản hồi chậm.
- API có timeout, retry một lần cho create, kiểm tra URL `/exec` và thông báo lỗi JSON rõ hơn.
- API key được trim ở cả frontend server và Apps Script để tránh lỗi do khoảng trắng/ký tự xuống dòng.

## Bắt buộc khi nâng cấp từ V1.1.0

1. Mở Google Sheet database hiện tại.
2. Vào **Extensions → Apps Script**.
3. Thay code cũ bằng toàn bộ nội dung `google-apps-script/Code.gs` của V1.2.0.
4. Vào **Deploy → Manage deployments → Edit**.
5. Chọn **New version** và Deploy.
6. Giữ nguyên Web App URL nếu vẫn kết thúc bằng `/exec`.
7. Kiểm tra Script Property `DRIVEVAULT_API_KEY` giống hệt Environment Variable cùng tên trên Vercel.
8. Deploy source V1.2.0 lên Vercel.

> Dữ liệu V1.1.0 vẫn dùng nguyên, không cần migrate hay tạo Sheet mới.

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

`V1.2.0 - Instant Save & Mobile Polish`
