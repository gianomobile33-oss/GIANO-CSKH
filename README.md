# GIANO CSKH

Ứng dụng chăm sóc khách hàng GIANO, chạy độc lập (PWA cài lên điện thoại). Không dùng chung mã, cấu hình hay dữ liệu với "GIANO quản lý" và "GIANO Shop".

- Giao diện: web tĩnh (HTML/CSS/JS, không cần build), lưu trữ trên GitHub Pages.
- Dữ liệu + đăng nhập: Supabase (Postgres trên cloud, gói miễn phí). Quy tắc quyền truy cập nằm trong `supabase/schema.sql`.
- Chưa điền `config.js` thì app chạy **chế độ dùng thử**: dữ liệu chỉ lưu trên máy đang mở.

## Cấu trúc

| Tệp | Nội dung |
|---|---|
| `index.html`, `css/app.css`, `js/app.js` | Giao diện và các màn hình |
| `js/store.js` | Lớp dữ liệu (Supabase hoặc chế độ dùng thử) |
| `js/util.js` | Chuẩn hoá/tách số điện thoại, ngày giờ, tìm không dấu |
| `share.html` | Nhận nội dung chia sẻ (Web Share Target) rồi chuyển vào app |
| `manifest.webmanifest`, `sw.js`, `icons/` | Cài app lên màn hình chính, biểu tượng, thông báo |
| `supabase/schema.sql` | Bảng dữ liệu + bảo vệ quyền truy cập (chạy một lần) |
| `vendor/supabase-2.45.4.js` | Thư viện Supabase (MIT) |

## Cài đặt cloud (một lần)

1. **Supabase**: tạo project mới (khu vực Singapore) → SQL Editor → dán toàn bộ `supabase/schema.sql` → Run.
2. Authentication → Users → **Add user** (email + mật khẩu, chọn Auto Confirm). Đây là tài khoản đăng nhập app.
3. Authentication → Sign In / Providers → tắt **Allow new users to sign up** (để người lạ không tự tạo tài khoản).
4. Project Settings → API: lấy **Project URL** và khoá **anon public** → điền vào `config.js`.
5. Đưa thư mục này lên một kho GitHub riêng → Settings → Pages → Deploy from branch `main`, thư mục `/ (root)`.

## Sao lưu

Cài đặt → **Xuất bản sao lưu đầy đủ (.json)** (khôi phục được) hoặc **Xuất bảng Excel (.csv)**.
