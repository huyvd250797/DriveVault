# DriveVault Mobile V1.0.0

Web app mobile-first để lưu nhanh nội dung dùng lại và link ảnh/video Google Drive.

## Chức năng

- 3 loại lưu trữ: `Ảnh / Video`, `Nội dung`, `Khác`.
- Thêm mới bằng modal tối ưu điện thoại.
- Dashboard dạng block/card, mới nhất lên trước.
- Lọc theo loại và tìm kiếm theo tên/nội dung.
- `Nội dung`: sao chép toàn bộ nội dung chi tiết một chạm.
- `Ảnh / Video`: mở link Google Drive ở tab mới.
- `Khác`: có thể lưu nội dung, link hoặc cả hai.
- Backend là Google Apps Script; dữ liệu nằm trong Google Sheets trên Google Drive.
- Frontend Next.js, deploy Vercel.

## 1. Tạo Google Sheet làm database

1. Tạo một Google Sheet mới, ví dụ `DriveVault Database`.
2. Trong Sheet chọn **Extensions → Apps Script**.
3. Xóa code mặc định và dán toàn bộ file `google-apps-script/Code.gs`.
4. Vào **Project Settings → Script Properties** tạo:
   - Property: `DRIVEVAULT_API_KEY`
   - Value: một chuỗi bí mật dài, ví dụ chuỗi random 32+ ký tự.
5. **Deploy → New deployment → Web app**.
   - Execute as: **Me**.
   - Who has access: chọn mức truy cập phù hợp với tài khoản của bạn. Với frontend public trên Vercel, endpoint phải nhận request từ Vercel; API key trong payload là lớp bảo vệ ứng dụng.
6. Copy URL dạng `https://script.google.com/macros/s/.../exec`.

> Tab `Vault` và các cột sẽ tự tạo ở lần gọi đầu tiên.

## 2. Cấu hình Vercel

Tạo 2 Environment Variables:

```env
GOOGLE_SCRIPT_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
DRIVEVAULT_API_KEY=CHUOI_BI_MAT_GIONG_TRONG_SCRIPT_PROPERTIES
```

Sau đó import repo/folder này vào Vercel và deploy.

## 3. Chạy local

```bash
npm install
cp .env.example .env.local
npm run dev
```

Mở `http://localhost:3000`.

## Lưu ý link Google Drive

App lưu nguyên URL bạn nhập. Nếu cần người khác mở được file, hãy cấu hình quyền chia sẻ của file/folder trên Google Drive tương ứng.

## Cấu trúc dữ liệu Google Sheet

| id | type | name | detail | url | createdAt |
|---|---|---|---|---|---|
| UUID | media/content/other | Tên | Nội dung | Link Drive | ISO datetime |

## Phiên bản

`V1.0.0 - Mobile Quick Storage`
