# DriveVault Mobile V2.2.0 – Smart Rules & Automation

V2.2.0 nâng cấp trực tiếp từ V2.1.0 Header/Safe-Area Fix 2. Bản này tập trung vào tự động hóa thao tác lưu dữ liệu và sửa lại trình phát video để xem video Google Drive trực tiếp trong DriveVault ổn định hơn.

## Media Player Fix 1

- Khôi phục HTML5 player của DriveVault làm player chính cho video Google Drive.
- Chỉ còn **một** nút fullscreen do DriveVault quản lý trong player chính.
- Control fullscreen nằm cùng thanh điều khiển của app nên không bị progress/iframe che trên iPhone.
- Google Drive Preview chỉ được dùng làm **fallback tương thích** khi trình duyệt thật sự không giải mã được video gốc; ở fallback DriveVault không chèn thêm nút fullscreen để tránh trùng icon.
- Tự phát hiện trường hợp video có audio nhưng không có khung hình (`videoWidth = 0`) và chuyển fallback.


## 1. Smart Rules & Automation

Trong Header có thêm nút biểu tượng tia sét để mở **Smart Rules**.

Mỗi rule có thể kiểm tra:
- URL
- Tên
- Nội dung chi tiết
- Tên + Nội dung + URL

Điều kiện hỗ trợ:
- Chứa
- Bắt đầu bằng
- Kết thúc bằng
- Bằng chính xác

Khi rule khớp, DriveVault có thể tự:
- đổi Loại lưu trữ;
- gán Phân loại;
- thêm Tag;
- Ghim;
- Lưu trữ;
- Bảo vệ bằng App Lock (khi App Lock đã bật).

V2.2.0 có sẵn các rule mặc định cho Shopee, YouTube, Google Drive và TikTok. Có thể bật/tắt hoặc xóa các rule này và tự tạo rule mới.

Nút **Chạy trên dữ liệu cũ** cho phép áp dụng rule vào những block đã tồn tại. App sẽ hỏi xác nhận trước khi cập nhật.

Smart Rules được lưu local trên thiết bị, không làm thay đổi schema Google Sheet.

## 2. Fix xem video trực tiếp trong app

### Google Drive Video
V2.1 dùng raw stream qua `/api/media`. Một số video (đặc biệt video dùng codec mà Safari/Chrome không hỗ trợ trực tiếp) có thể phát được âm thanh nhưng không có hình.

V2.2 thay đổi cách phát:
- Google Drive video ưu tiên **Google Drive Preview nhúng trực tiếp trong DriveVault**.
- Drive xử lý/transcode video nên tương thích codec tốt hơn.
- Không mở tab ngoài khi xem bình thường.
- Giữ player ngay trong Bottom Sheet và Media Gallery.

### Fullscreen
Nút fullscreen đã được nâng cấp:
- Desktop/Android: dùng Fullscreen API khi trình duyệt hỗ trợ.
- iPhone/iOS: nếu Fullscreen API của phần tử không khả dụng, DriveVault chuyển player sang **app fullscreen 100dvh**.
- Video trực tiếp dùng native fullscreen của iOS khi có thể.
- Google Drive Preview vẫn có control fullscreen nội bộ của Google Drive.

### Google Drive resource key
`/api/media` hỗ trợ thêm `resourceKey` của Drive link và tiếp tục hỗ trợ HTTP Range để seek media/thumbnails.

> File Drive vẫn cần quyền truy cập phù hợp. Với app cá nhân không đăng nhập Google, cách ổn định nhất là file được chia sẻ “Bất kỳ ai có liên kết”. File Drive mới upload cũng có thể cần một lúc để Google xử lý video trước khi Preview phát được.

## 3. Không thay đổi database

V2.2.0 không thêm cột Google Sheet và không bắt buộc cập nhật `Code.gs` nếu Apps Script V2.1 đang hoạt động ổn.

Giữ nguyên Environment Variables trên Vercel:

```env
GOOGLE_SCRIPT_URL=https://script.google.com/macros/s/.../exec
DRIVEVAULT_API_KEY=...
```

## 4. Deploy

1. Deploy source V2.2.0 lên Vercel.
2. Giữ nguyên `GOOGLE_SCRIPT_URL` và `DRIVEVAULT_API_KEY`.
3. Không cần chạy migration.
4. Sau khi deploy, mở app → tia sét ở Header → kiểm tra Smart Rules.
5. Với video Drive, mở block hoặc Gallery để kiểm tra player và fullscreen.

## 5. Roadmap

- ✅ V1.0.0 – Mobile Quick Storage
- ✅ V1.1.0 – Fast Capture & Mobile UX
- ✅ V1.2.0 – Instant Save & Mobile Polish
- ✅ V1.3.0 – Smart Library & Reliability
- ✅ V1.4.0 – Search & Organization Pro
- ✅ V1.5.0 – Backup & Data Portability
- ✅ V1.6.0 – Media & Link Intelligence
- ✅ V1.7.0 – Security & App Lock + Media Pro
- ✅ V2.0.0 – Personal Vault Pro & Quick Capture
- ✅ V2.1.0 – Media Library Pro
- ✅ V2.2.0 – Smart Rules & Automation
- ⏭️ V2.3.0 – Version History & Recovery

## Phiên bản tiếp theo – V2.3.0

Đề xuất tập trung vào **Version History & Recovery**:
- lưu lịch sử sửa từng block;
- xem trước/sau khi chỉnh sửa;
- restore phiên bản cũ;
- audit thay đổi;
- snapshot trước bulk action lớn;
- lịch sử khôi phục/xóa để giảm rủi ro mất dữ liệu.
