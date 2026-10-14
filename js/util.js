// Tiện ích dùng chung: chuẩn hoá số điện thoại, tách số từ nội dung chia sẻ, ngày giờ.

/** Bỏ dấu tiếng Việt + chữ thường, để tìm "tuan" ra "Tuấn". */
export function fold(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().trim();
}

/** Chuẩn hoá về dạng 0xxxxxxxxx. Trả '' nếu không phải số hợp lệ. */
export function normalizePhone(raw) {
  let d = String(raw || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  d = d.replace(/\D/g, '');
  if (d.startsWith('0084')) d = d.slice(4);
  if (d.startsWith('84') && (d.length === 11 || d.length === 12)) d = '0' + d.slice(2);
  if (!d.startsWith('0') && d.length === 9) d = '0' + d;          // thiếu số 0 đầu
  if (d.length < 8 || d.length > 12) return '';
  return d;
}

/** Tìm mọi số điện thoại trong một đoạn văn bản (nội dung Zalo chia sẻ, link zalo.me...). */
export function extractPhones(text) {
  const out = [];
  const s = String(text || '');
  const re = /(?:\+?84|0)(?:[\s.\-()]*\d){8,10}/g;
  for (const m of s.match(re) || []) {
    const p = normalizePhone(m);
    if (p && /^0\d{9,10}$/.test(p) && !out.includes(p)) out.push(p);
  }
  if (!out.length) {
    // Dự phòng: một dãy 9–11 chữ số bất kỳ
    for (const m of s.match(/\d[\d\s.\-]{7,14}\d/g) || []) {
      const p = normalizePhone(m);
      if (p && !out.includes(p)) out.push(p);
    }
  }
  return out;
}

/** Hiển thị số dạng 0901 234 567 */
export function prettyPhone(p) {
  const d = String(p || '');
  if (d.length === 10) return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  if (d.length === 11) return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  return d;
}

export function buildSearchText(c) {
  return fold([c.phone, c.name, c.zalo_name].filter(Boolean).join(' '));
}

export function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
export function endOfToday()   { const d = new Date(); d.setHours(23, 59, 59, 999); return d; }

/** ISO → giá trị cho <input type="datetime-local"> */
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** <input type="datetime-local"> → ISO (theo giờ máy) */
export function fromLocalInput(v) { return v ? new Date(v).toISOString() : null; }

export function todayDateInput() {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso); const p = (n) => String(n).padStart(2, '0');
  return `${WD[d.getDay()]} ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function fmtDate(v) {
  if (!v) return '';
  const [y, m, d] = String(v).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** "Quá hạn 2 ngày", "Hôm nay 15:00", "Ngày mai 09:00"… */
export function relFollowup(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  const day = (x) => { const t = new Date(x); t.setHours(0, 0, 0, 0); return t.getTime(); };
  const diff = Math.round((day(d) - day(new Date())) / 86400000);
  if (diff === 0) return (d < new Date() ? 'Đến giờ · ' : 'Hôm nay · ') + hm;
  if (diff === 1) return 'Ngày mai · ' + hm;
  if (diff < 0) return `Quá hạn ${-diff} ngày`;
  return fmtDateTime(iso);
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function uuid() {
  return crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}
