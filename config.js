// Cấu hình kết nối cloud (Supabase). Để trống = chế độ dùng thử, dữ liệu chỉ lưu trên máy.
// "anon / publishable key" là khoá công khai, được phép nằm trong mã web; dữ liệu vẫn được
// bảo vệ bằng đăng nhập + quy tắc quyền truy cập trong cơ sở dữ liệu (supabase/schema.sql).
window.GIANO_CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
};
