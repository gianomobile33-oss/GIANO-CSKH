import {
  esc, extractPhones, normalizePhone, prettyPhone, fmtDate, fmtDateTime, relFollowup,
  toLocalInput, fromLocalInput, todayDateInput, startOfToday,
} from './util.js';
import { SupabaseStore, LocalStore, DuplicatePhoneError, PURCHASE_FIELDS } from './store.js';

const cfg = window.GIANO_CONFIG || {};
const store = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase
  ? new SupabaseStore(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
  : new LocalStore();
window.__store = store; // để kiểm thử

const $main = document.getElementById('main');
const $tabbar = document.getElementById('tabbar');
let user = null;

// ------------------------------------------------------------------ tiện ích giao diện
const ICON = {
  phone: '<svg viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z"/></svg>',
  cal: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  paste: '<svg viewBox="0 0 24 24"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
};

let toastTimer;
function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else o[el.name] = el.value.trim();
  }
  return o;
}
async function busy(btn, fn) {
  const label = btn?.innerHTML; if (btn) { btn.disabled = true; btn.textContent = 'Đang lưu…'; }
  try { return await fn(); }
  catch (e) { console.error(e); toast('Lỗi: ' + (e.message || e), 4000); }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = label; } }
}
async function copyText(s) {
  try { await navigator.clipboard.writeText(s); }
  catch {
    const ta = Object.assign(document.createElement('textarea'), { value: s });
    document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast('Đã sao chép ' + s);
}
async function readClipboard() {
  try { return await navigator.clipboard.readText(); }
  catch { toast('Không đọc được bộ nhớ tạm. Hãy nhấn giữ ô nhập và chọn Dán.', 3500); return ''; }
}
function displayName(c) { return c.name || c.zalo_name || prettyPhone(c.phone); }

function custItem(c, kind) {
  const sub = [c.name && c.zalo_name ? 'Zalo: ' + c.zalo_name : '', prettyPhone(c.phone), c.current_issue && c.needs_support ? '⚠ ' + c.current_issue : '']
    .filter(Boolean).join(' · ');
  let when = '';
  if (kind === 'overdue') when = `<span class="tag tag-red">${esc(relFollowup(c.next_followup_at))}</span>`;
  else if (kind === 'today' || kind === 'upcoming') when = `<span class="tag tag-gold">${esc(relFollowup(c.next_followup_at))}</span>`;
  else if (kind === 'support') when = '<span class="tag tag-amber">Cần hỗ trợ</span>';
  else if (c.next_followup_at) {
    const od = new Date(c.next_followup_at) < startOfToday();
    when = `<span class="tag ${od ? 'tag-red' : 'tag-gold'}">${esc(relFollowup(c.next_followup_at))}</span>`;
  }
  return `<a class="cust" href="#/c/${c.id}">
    <span class="cust-name">${esc(displayName(c))}</span>
    <span class="cust-when">${when}</span>
    <span class="cust-sub">${esc(sub)}</span></a>`;
}
function custList(rows, kind, emptyMsg) {
  return rows.length ? `<div class="list">${rows.map((c) => custItem(c, kind)).join('')}</div>` : `<div class="empty">${esc(emptyMsg)}</div>`;
}

/** Ô ngày giờ hẹn + nút chọn nhanh */
function followupField(name, value, label = 'Hẹn chăm sóc tiếp theo') {
  return `<label class="field">${esc(label)}
      <input type="datetime-local" name="${name}" value="${esc(toLocalInput(value))}"></label>
    <div class="chips" data-quick="${name}">
      <button type="button" class="chip" data-add="1">Ngày mai</button>
      <button type="button" class="chip" data-add="3">+3 ngày</button>
      <button type="button" class="chip" data-add="7">+1 tuần</button>
      <button type="button" class="chip" data-add="30">+1 tháng</button>
      <button type="button" class="chip" data-add="90">+3 tháng</button>
      <button type="button" class="chip" data-add="clear">Không hẹn</button>
    </div>`;
}
function bindQuickFollowup(root) {
  root.querySelectorAll('[data-quick]').forEach((box) => {
    const input = root.querySelector(`[name="${box.dataset.quick}"]`);
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-add]'); if (!b) return;
      if (b.dataset.add === 'clear') { input.value = ''; return; }
      const d = new Date(); d.setDate(d.getDate() + Number(b.dataset.add)); d.setHours(9, 0, 0, 0);
      input.value = toLocalInput(d.toISOString());
    });
  });
}

function calendarUrl(c) {
  const s = new Date(c.next_followup_at), e = new Date(s.getTime() + 15 * 60000);
  const f = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const details = [`SĐT: ${c.phone}`, c.zalo_name && `Zalo: ${c.zalo_name}`, c.current_issue && `Vấn đề: ${c.current_issue}`,
    `Mở hồ sơ: ${new URL('./#/c/' + c.id, location.href).href}`].filter(Boolean).join('\n');
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE'
    + `&text=${encodeURIComponent('CSKH: ' + displayName(c))}&dates=${f(s)}/${f(e)}&details=${encodeURIComponent(details)}`;
}

// ------------------------------------------------------------------ đăng nhập
function viewLogin() {
  $tabbar.hidden = true;
  const demo = store.mode === 'demo';
  $main.innerHTML = `<div class="login">
    <img class="login-logo" src="icons/icon-192.png" alt="">
    <div class="center"><h1>GIANO CSKH</h1><p class="muted">Chăm sóc khách hàng</p></div>
    ${demo ? `<div class="notice notice-amber">Chưa kết nối cloud: đang ở <b>chế độ dùng thử</b>, dữ liệu chỉ lưu trên máy này. Nhấn Đăng nhập để thử.</div>` : ''}
    <form id="f" class="stack card">
      ${demo ? '' : `<label class="field">Email<input name="email" type="email" autocomplete="username" required></label>
      <label class="field">Mật khẩu<input name="password" type="password" autocomplete="current-password" required></label>`}
      <button class="btn btn-primary btn-block">Đăng nhập</button>
    </form></div>`;
  const f = $main.querySelector('#f');
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(f.querySelector('button'), async () => {
      const d = formData(f);
      user = await store.signIn(d.email, d.password);
      const next = sessionStorage.getItem('after-login') || '#/';
      sessionStorage.removeItem('after-login');
      go(next);
      startReminders();
    });
  });
}

// ------------------------------------------------------------------ trang chủ
async function viewHome() {
  $main.innerHTML = `<div class="stack">
    <form id="quick" class="card stack">
      <label class="field">Dán số điện thoại hoặc nội dung chia sẻ từ Zalo
        <input name="q" inputmode="tel" placeholder="VD: 0901 234 567" autocomplete="off"></label>
      <div class="row">
        <button type="button" class="btn btn-ghost" id="paste">${ICON.paste} Dán</button>
        <button class="btn btn-primary">Mở phiếu khách</button>
      </div>
    </form>
    <div id="dash"><div class="empty">Đang tải…</div></div></div>`;
  const qf = $main.querySelector('#quick');
  qf.querySelector('#paste').onclick = async () => {
    const t = await readClipboard(); if (t) { qf.q.value = t; qf.requestSubmit(); }
  };
  qf.addEventListener('submit', (e) => { e.preventDefault(); openFromText(qf.q.value); });

  const d = await store.dashboard();
  updateBadge(d.overdue.length + d.today.length);
  $main.querySelector('#dash').innerHTML = `
    <div class="stats">
      <a class="stat red" href="#overdue"><b>${d.overdue.length}</b><span>Quá hạn</span></a>
      <a class="stat gold" href="#today"><b>${d.today.length}</b><span>Hôm nay</span></a>
      <a class="stat amber" href="#support"><b>${d.support.length}</b><span>Cần hỗ trợ</span></a>
    </div>
    <section class="section" id="overdue"><div class="section-head"><h2>Quá hạn</h2><span class="count">${d.overdue.length}</span></div>
      ${custList(d.overdue, 'overdue', 'Không có khách quá hạn.')}</section>
    <section class="section" id="today"><div class="section-head"><h2>Cần chăm sóc hôm nay</h2><span class="count">${d.today.length}</span></div>
      ${custList(d.today, 'today', 'Hôm nay chưa có lịch chăm sóc.')}</section>
    <section class="section" id="support"><div class="section-head"><h2>Đang cần hỗ trợ</h2><span class="count">${d.support.length}</span></div>
      ${custList(d.support, 'support', 'Không có khách đang cần hỗ trợ.')}</section>`;
  $main.querySelectorAll('.stat').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault(); document.querySelector(a.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth' });
  }));
}

/** Từ đoạn văn bản (dán hoặc chia sẻ) → mở hồ sơ cũ hoặc phiếu mới. */
async function openFromText(text, { shared = false } = {}) {
  const phones = extractPhones(text);
  if (shared) sessionStorage.setItem('shared-text', text); else sessionStorage.removeItem('shared-text');
  if (phones.length === 1) return openPhone(phones[0]);
  if (phones.length > 1) return viewPickPhone(phones, text);
  if (!shared) toast('Không thấy số điện thoại trong nội dung này', 3000);
  go('#/new');
}
async function openPhone(phone) {
  const ex = await store.findByPhone(phone);
  if (ex) {
    sessionStorage.removeItem('shared-text');
    toast('Số này đã có hồ sơ. Thêm lần mua hoặc ghi chú bên dưới.', 3500);
    return go('#/c/' + ex.id);
  }
  go('#/new?phone=' + phone);
}
function viewPickPhone(phones, text) {
  $tabbar.hidden = false;
  $main.innerHTML = `<div class="stack">
    <h1>Chọn số điện thoại</h1>
    <p class="muted">Nội dung chia sẻ có nhiều số. Chọn số của khách:</p>
    ${phones.map((p) => `<button class="btn btn-block" data-p="${p}">${esc(prettyPhone(p))}</button>`).join('')}
    <div class="card small muted pre">${esc(text)}</div></div>`;
  $main.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => openPhone(b.dataset.p)));
}

// ------------------------------------------------------------------ nhận chia sẻ
async function viewShare(params) {
  const text = ['title', 'text', 'url'].map((k) => params.get(k)).filter(Boolean).join('\n');
  history.replaceState(null, '', location.pathname + location.search + '#/');
  await openFromText(text, { shared: true });
}

// ------------------------------------------------------------------ phiếu khách mới
const MODELS = ['iPhone 16 Pro Max', 'iPhone 16 Pro', 'iPhone 16 Plus', 'iPhone 16', 'iPhone 15 Pro Max', 'iPhone 15 Pro', 'iPhone 15 Plus', 'iPhone 15',
  'iPhone 14 Pro Max', 'iPhone 14 Pro', 'iPhone 14 Plus', 'iPhone 14', 'iPhone 13 Pro Max', 'iPhone 13 Pro', 'iPhone 13', 'iPhone 13 mini',
  'iPhone 12 Pro Max', 'iPhone 12 Pro', 'iPhone 12', 'iPhone 11 Pro Max', 'iPhone 11 Pro', 'iPhone 11', 'iPhone XS Max', 'iPhone XR',
  'Samsung Galaxy S25 Ultra', 'Samsung Galaxy S24 Ultra', 'Samsung Galaxy S23 Ultra', 'iPad', 'MacBook'];
const STORAGES = ['64GB', '128GB', '256GB', '512GB', '1TB'];
const COLORS = ['Đen', 'Trắng', 'Xanh', 'Vàng', 'Tím', 'Đỏ', 'Hồng', 'Titan tự nhiên', 'Titan đen', 'Titan trắng', 'Titan sa mạc', 'Xám', 'Bạc'];
const APPEARANCE = ['Đẹp như mới 99%', 'Đẹp 98%', 'Trầy xước nhẹ', 'Cấn móp nhẹ', 'Máy mới nguyên seal'];
const WARRANTY = ['1 đổi 1 trong 30 ngày', 'Bảo hành 3 tháng', 'Bảo hành 6 tháng', 'Bảo hành 12 tháng'];
const datalists = () => `
  <datalist id="dl-model">${MODELS.map((m) => `<option value="${m}">`).join('')}</datalist>
  <datalist id="dl-storage">${STORAGES.map((m) => `<option value="${m}">`).join('')}</datalist>
  <datalist id="dl-color">${COLORS.map((m) => `<option value="${m}">`).join('')}</datalist>
  <datalist id="dl-appearance">${APPEARANCE.map((m) => `<option value="${m}">`).join('')}</datalist>
  <datalist id="dl-warranty">${WARRANTY.map((m) => `<option value="${m}">`).join('')}</datalist>`;

function purchaseFields(p = {}) {
  return `<fieldset><legend>Máy đã mua</legend>
      <label class="field">Ngày mua
        <div class="row"><input type="date" name="purchase_date" value="${esc(p.purchase_date || '')}">
        <button type="button" class="btn btn-sm" style="flex:0 0 auto" data-today>Hôm nay</button></div></label>
      <label class="field">Dòng máy<input name="model" list="dl-model" value="${esc(p.model || '')}" placeholder="VD: iPhone 15 Pro Max"></label>
      <div class="grid-2">
        <label class="field">Dung lượng<input name="storage" list="dl-storage" value="${esc(p.storage || '')}" placeholder="256GB"></label>
        <label class="field">Màu<input name="color" list="dl-color" value="${esc(p.color || '')}"></label>
      </div></fieldset>
    <fieldset><legend>Tình trạng máy lúc bán</legend>
      <label class="field">Ngoại hình<input name="appearance" list="dl-appearance" value="${esc(p.appearance || '')}"></label>
      <label class="field">Pin<input name="battery" value="${esc(p.battery || '')}" placeholder="VD: 92%, pin zin"></label>
      <label class="field">Linh kiện đã thay<input name="replaced_parts" value="${esc(p.replaced_parts || '')}" placeholder="VD: thay màn, thay pin"></label>
      <label class="field">Bảo hành đã cam kết<input name="warranty" list="dl-warranty" value="${esc(p.warranty || '')}"></label>
    </fieldset>`;
}
function bindToday(root) {
  root.querySelectorAll('[data-today]').forEach((b) => (b.onclick = () => { root.querySelector('[name="purchase_date"]').value = todayDateInput(); }));
}
const hasPurchase = (d) => PURCHASE_FIELDS.some((k) => k !== 'note' && d[k]);

async function viewNew(params) {
  const shared = sessionStorage.getItem('shared-text') || '';
  const phone = params.get('phone') || '';
  $main.innerHTML = `${datalists()}<form id="f" class="stack" autocomplete="off">
    <h1>Khách mới</h1>
    ${shared ? `<details class="card small"><summary>Nội dung đã chia sẻ</summary><div class="pre muted" style="margin-top:8px">${esc(shared)}</div></details>` : ''}
    <div class="card stack">
      <label class="field"><span class="field-req">Số điện thoại</span>
        <div class="row"><input class="big" type="tel" name="phone" inputmode="tel" value="${esc(prettyPhone(phone))}" placeholder="0901 234 567" required>
        <button type="button" class="btn btn-sm" style="flex:0 0 auto" id="paste">${ICON.paste} Dán</button></div></label>
      <div id="dup"></div>
      <label class="field">Tên Zalo<input name="zalo_name" placeholder="Tên hiển thị trên Zalo"></label>
      <label class="field">Tên khách (nếu cần)<input name="name" autocapitalize="words"></label>
    </div>
    ${purchaseFields()}
    <fieldset><legend>Chăm sóc</legend>
      <label class="field">Tình trạng hiện tại / vấn đề cần hỗ trợ<textarea name="current_issue" placeholder="Để trống nếu máy đang ổn"></textarea></label>
      <label class="field">Ghi chú<textarea name="note"></textarea></label>
      ${followupField('next_followup_at', null)}
    </fieldset>
    <div class="sticky-save"><button class="btn btn-primary btn-block" id="save">Lưu hồ sơ khách</button></div>
  </form>`;
  const f = $main.querySelector('#f');
  bindQuickFollowup(f); bindToday(f);
  let existing = null;
  const check = async () => {
    const p = normalizePhone(f.phone.value);
    existing = p ? await store.findByPhone(p) : null;
    f.querySelector('#dup').innerHTML = existing ? `<div class="notice notice-gold stack">
        <div>Số này đã có hồ sơ: <b>${esc(displayName(existing))}</b>. Không tạo khách trùng.</div>
        <div class="row"><a class="btn btn-sm" href="#/c/${existing.id}">Mở hồ sơ cũ</a></div>
        <div class="small">Bấm Lưu để thêm lần mua, ghi chú và lịch hẹn này vào hồ sơ cũ.</div></div>` : '';
    f.querySelector('#save').textContent = existing ? 'Thêm vào hồ sơ cũ' : 'Lưu hồ sơ khách';
  };
  let t; f.phone.addEventListener('input', () => { clearTimeout(t); t = setTimeout(check, 300); });
  f.querySelector('#paste').onclick = async () => {
    const txt = await readClipboard(); if (!txt) return;
    const ps = extractPhones(txt);
    if (ps[0]) { f.phone.value = prettyPhone(ps[0]); check(); } else toast('Không thấy số điện thoại trong nội dung đã sao chép', 3000);
  };
  if (phone) check(); else setTimeout(() => f.phone.focus(), 50);

  f.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(f.querySelector('#save'), async () => {
      const d = formData(f);
      const phoneN = normalizePhone(d.phone);
      if (!phoneN) { toast('Số điện thoại không hợp lệ'); f.phone.focus(); return; }
      const followup = fromLocalInput(d.next_followup_at);
      let c = existing;
      if (!c) {
        try {
          c = await store.createCustomer({
            phone: phoneN, zalo_name: d.zalo_name, name: d.name, current_issue: d.current_issue,
            needs_support: !!d.current_issue, note: d.note, next_followup_at: followup,
          });
          if (hasPurchase(d)) await store.addPurchase(c.id, d);
          sessionStorage.removeItem('shared-text');
          toast('Đã lưu hồ sơ khách');
          return go('#/c/' + c.id);
        } catch (err) {
          if (!(err instanceof DuplicatePhoneError) || !err.customer) throw err;
          c = err.customer;
        }
      }
      await mergeInto(c, d, followup);
      sessionStorage.removeItem('shared-text');
      toast('Đã thêm vào hồ sơ cũ');
      go('#/c/' + c.id);
    });
  });
}

/** Số đã có hồ sơ: thêm lần mua / ghi chú / lịch hẹn vào hồ sơ cũ, không ghi đè thông tin đã có. */
async function mergeInto(c, d, followup) {
  const patch = {};
  if (d.zalo_name && !c.zalo_name) patch.zalo_name = d.zalo_name;
  if (d.name && !c.name) patch.name = d.name;
  if (d.current_issue) { patch.current_issue = d.current_issue; patch.needs_support = true; }
  if (followup) patch.next_followup_at = followup;
  if (Object.keys(patch).length) await store.updateCustomer(c.id, patch);
  if (hasPurchase(d)) await store.addPurchase(c.id, d);
  const content = [d.current_issue && 'Vấn đề: ' + d.current_issue, d.note && 'Ghi chú: ' + d.note].filter(Boolean).join('\n');
  if (content) await store.addInteraction(c.id, { content, next_followup_at: followup });
}

// ------------------------------------------------------------------ hồ sơ khách
async function viewCustomer(id) {
  const data = await store.getCustomer(id);
  if (!data) { $main.innerHTML = '<div class="empty">Không tìm thấy hồ sơ.</div>'; return; }
  const { customer: c, purchases, interactions } = data;
  const due = c.next_followup_at && new Date(c.next_followup_at) <= new Date();
  const od = c.next_followup_at && new Date(c.next_followup_at) < startOfToday();
  const nextDefault = c.next_followup_at && !due ? c.next_followup_at : null;
  $main.innerHTML = `<div class="stack">
    <div class="row" style="justify-content:space-between">
      <a class="btn btn-sm btn-ghost" style="flex:0 0 auto" href="javascript:history.back()">${ICON.back} Quay lại</a>
      <a class="btn btn-sm" style="flex:0 0 auto" href="#/c/${c.id}/edit">${ICON.edit} Sửa</a></div>
    <div class="card profile-head">
      <div class="profile-name">${esc(c.name || c.zalo_name || 'Khách chưa có tên')}</div>
      ${c.zalo_name && c.name ? `<div class="muted">Zalo: ${esc(c.zalo_name)}</div>` : c.zalo_name ? '<div class="muted small">Tên Zalo</div>' : ''}
      <div class="profile-phone">${esc(prettyPhone(c.phone))}</div>
      <div class="actions" style="margin-top:6px">
        <a class="btn btn-primary" href="tel:${esc(c.phone)}">${ICON.phone} Gọi</a>
        <button class="btn" id="copy">${ICON.copy} Sao chép</button>
        <a class="btn" href="https://zalo.me/${esc(c.phone)}" target="_blank" rel="noopener">${ICON.chat} Zalo</a>
      </div>
    </div>

    <div class="card stack">
      <div class="section-head"><h2>Lịch hẹn chăm sóc</h2>
        ${c.next_followup_at ? `<span class="tag ${od ? 'tag-red' : 'tag-gold'}">${esc(relFollowup(c.next_followup_at))}</span>` : '<span class="tag tag-green">Chưa hẹn</span>'}</div>
      ${c.next_followup_at ? `<div><b>${esc(fmtDateTime(c.next_followup_at))}</b></div>
        <div class="row"><a class="btn btn-sm" href="${esc(calendarUrl(c))}" target="_blank" rel="noopener">${ICON.cal} Thêm vào Lịch</a></div>` : ''}
    </div>

    ${c.needs_support || c.current_issue ? `<div class="notice ${c.needs_support ? 'notice-amber' : 'notice-gold'} stack">
      <div><b>${c.needs_support ? 'Đang cần hỗ trợ' : 'Vấn đề gần nhất (đã xử lý)'}</b></div>
      <div class="pre">${esc(c.current_issue || '')}</div>
      ${c.needs_support ? '<div class="row"><button class="btn btn-sm" id="resolve">Đã xử lý xong</button></div>' : ''}</div>` : ''}

    <form id="log" class="card stack">
      <h2>Ghi lại lần chăm sóc</h2>
      <label class="field">Nội dung trao đổi<textarea name="content" placeholder="Khách hỏi gì, mình tư vấn gì…"></textarea></label>
      <label class="field">Kết quả xử lý<input name="result" placeholder="VD: đã hướng dẫn, hẹn mang máy qua…"></label>
      ${followupField('next_followup_at', nextDefault, 'Hẹn lại')}
      <label class="check"><input type="checkbox" name="needs_support" ${c.needs_support ? 'checked' : ''}> Khách vẫn đang cần hỗ trợ</label>
      <button class="btn btn-primary btn-block" id="logsave">Lưu lần chăm sóc</button>
    </form>

    <section class="section">
      <div class="section-head"><h2>Lịch sử chăm sóc</h2><span class="count">${interactions.length}</span></div>
      ${interactions.length ? `<div class="timeline">${interactions.map((i) => `<div class="tl-item">
        <div class="tl-when">${esc(fmtDateTime(i.happened_at))}${i.next_followup_at ? ' · hẹn ' + esc(fmtDateTime(i.next_followup_at)) : ''}</div>
        ${i.content ? `<div class="pre">${esc(i.content)}</div>` : ''}
        ${i.result ? `<div class="pre"><span class="muted">Kết quả:</span> ${esc(i.result)}</div>` : ''}</div>`).join('')}</div>`
        : '<div class="empty">Chưa có lần chăm sóc nào.</div>'}
    </section>

    <section class="section">
      <div class="section-head"><h2>Lần mua</h2><a class="btn btn-sm" href="#/c/${c.id}/buy">+ Thêm lần mua</a></div>
      ${purchases.length ? purchases.map((p) => `<a class="card stack" style="color:inherit" href="#/c/${c.id}/buy/${p.id}">
        <div class="row"><span class="purchase-title">${esc([p.model, p.storage, p.color].filter(Boolean).join(' · ') || 'Máy chưa ghi tên')}</span>
        <span class="muted small" style="flex:0 0 auto">${esc(fmtDate(p.purchase_date))}</span></div>
        <dl class="kv">
          ${p.appearance ? `<dt>Ngoại hình</dt><dd>${esc(p.appearance)}</dd>` : ''}
          ${p.battery ? `<dt>Pin</dt><dd>${esc(p.battery)}</dd>` : ''}
          ${p.replaced_parts ? `<dt>Linh kiện thay</dt><dd>${esc(p.replaced_parts)}</dd>` : ''}
          ${p.warranty ? `<dt>Bảo hành</dt><dd>${esc(p.warranty)}</dd>` : ''}
          ${p.note ? `<dt>Ghi chú</dt><dd>${esc(p.note)}</dd>` : ''}
        </dl></a>`).join('') : '<div class="empty">Chưa có lần mua nào.</div>'}
    </section>

    <section class="section">
      <h2>Thông tin</h2>
      <div class="card"><dl class="kv">
        <dt>Tên Zalo</dt><dd>${esc(c.zalo_name || '—')}</dd>
        <dt>Tên khách</dt><dd>${esc(c.name || '—')}</dd>
        <dt>Ghi chú</dt><dd>${esc(c.note || '—')}</dd>
        <dt>Tạo hồ sơ</dt><dd>${esc(fmtDateTime(c.created_at))}</dd>
      </dl></div>
    </section></div>`;

  $main.querySelector('#copy').onclick = () => copyText(c.phone);
  const r = $main.querySelector('#resolve');
  if (r) r.onclick = () => busy(r, async () => { await store.updateCustomer(c.id, { needs_support: false }); toast('Đã đánh dấu xử lý xong'); viewCustomer(id); });
  const log = $main.querySelector('#log');
  bindQuickFollowup(log);
  log.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(log.querySelector('#logsave'), async () => {
      const d = formData(log);
      const followup = fromLocalInput(d.next_followup_at);
      if (!d.content && !d.result && followup === nextDefault && d.needs_support === c.needs_support) {
        toast('Nhập nội dung, kết quả hoặc ngày hẹn lại'); return;
      }
      await store.addInteraction(c.id, { content: d.content, result: d.result, next_followup_at: followup, happened_at: new Date().toISOString() });
      await store.updateCustomer(c.id, { next_followup_at: followup, needs_support: d.needs_support });
      toast(followup ? 'Đã lưu, hẹn lại ' + fmtDateTime(followup) : 'Đã lưu lần chăm sóc');
      viewCustomer(id); window.scrollTo(0, 0);
    });
  });
}

async function viewEditCustomer(id) {
  const data = await store.getCustomer(id); if (!data) return go('#/');
  const c = data.customer;
  $main.innerHTML = `<form id="f" class="stack">
    <h1>Sửa thông tin khách</h1>
    <div class="card stack">
      <label class="field"><span class="field-req">Số điện thoại</span><input class="big" type="tel" name="phone" value="${esc(prettyPhone(c.phone))}" required></label>
      <label class="field">Tên Zalo<input name="zalo_name" value="${esc(c.zalo_name || '')}"></label>
      <label class="field">Tên khách<input name="name" value="${esc(c.name || '')}"></label>
      <label class="field">Tình trạng hiện tại / vấn đề cần hỗ trợ<textarea name="current_issue">${esc(c.current_issue || '')}</textarea></label>
      <label class="check"><input type="checkbox" name="needs_support" ${c.needs_support ? 'checked' : ''}> Đang cần hỗ trợ</label>
      <label class="field">Ghi chú<textarea name="note">${esc(c.note || '')}</textarea></label>
      ${followupField('next_followup_at', c.next_followup_at)}
    </div>
    <div class="row"><a class="btn" href="#/c/${c.id}">Huỷ</a><button class="btn btn-primary" id="save">Lưu</button></div>
    <button type="button" class="btn btn-danger btn-block" id="del" style="margin-top:24px">Xoá hồ sơ khách này</button>
  </form>`;
  const f = $main.querySelector('#f'); bindQuickFollowup(f);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(f.querySelector('#save'), async () => {
      const d = formData(f);
      try {
        await store.updateCustomer(c.id, { ...d, next_followup_at: fromLocalInput(d.next_followup_at) });
      } catch (err) {
        if (err instanceof DuplicatePhoneError) { toast('Số này đã thuộc hồ sơ khác: ' + displayName(err.customer || {}), 4000); return; }
        throw err;
      }
      toast('Đã lưu'); go('#/c/' + c.id);
    });
  });
  f.querySelector('#del').onclick = async () => {
    if (!confirm(`Xoá vĩnh viễn hồ sơ ${displayName(c)} cùng toàn bộ lần mua và lịch sử chăm sóc?`)) return;
    await store.deleteCustomer(c.id); toast('Đã xoá hồ sơ'); go('#/');
  };
}

async function viewPurchase(cid, pid) {
  const data = await store.getCustomer(cid); if (!data) return go('#/');
  const p = pid ? data.purchases.find((x) => x.id === pid) : {};
  if (!p) return go('#/c/' + cid);
  $main.innerHTML = `${datalists()}<form id="f" class="stack" autocomplete="off">
    <h1>${pid ? 'Sửa lần mua' : 'Thêm lần mua'}</h1>
    <div class="muted">${esc(displayName(data.customer))} · ${esc(prettyPhone(data.customer.phone))}</div>
    ${purchaseFields(p)}
    <label class="field">Ghi chú lần mua<textarea name="note">${esc(p.note || '')}</textarea></label>
    <div class="row"><a class="btn" href="#/c/${cid}">Huỷ</a><button class="btn btn-primary" id="save">Lưu</button></div>
    ${pid ? '<button type="button" class="btn btn-danger btn-block" id="del" style="margin-top:24px">Xoá lần mua này</button>' : ''}
  </form>`;
  const f = $main.querySelector('#f'); bindToday(f);
  if (!pid) f.purchase_date.value = todayDateInput();
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(f.querySelector('#save'), async () => {
      const d = formData(f);
      if (pid) await store.updatePurchase(pid, d); else await store.addPurchase(cid, d);
      toast('Đã lưu lần mua'); go('#/c/' + cid);
    });
  });
  const del = f.querySelector('#del');
  if (del) del.onclick = async () => { if (confirm('Xoá lần mua này?')) { await store.deletePurchase(pid); go('#/c/' + cid); } };
}

// ------------------------------------------------------------------ tìm kiếm
async function viewSearch(params) {
  const q0 = params.get('q') || '';
  $main.innerHTML = `<div class="stack">
    <input id="q" type="search" placeholder="Số điện thoại, tên hoặc tên Zalo" value="${esc(q0)}" autocomplete="off" enterkeyhint="search">
    <div id="res"></div></div>`;
  const q = $main.querySelector('#q'), res = $main.querySelector('#res');
  let seq = 0, t;
  const run = async () => {
    const my = ++seq; const v = q.value.trim();
    history.replaceState(null, '', '#/search' + (v ? '?q=' + encodeURIComponent(v) : ''));
    const rows = await store.search(v);
    if (my !== seq) return;
    const phone = normalizePhone(v);
    res.innerHTML = (v ? '' : '<h2 style="margin:6px 0 10px">Cập nhật gần đây</h2>')
      + custList(rows, 'search', v ? 'Không tìm thấy khách nào.' : 'Chưa có khách nào.')
      + (v && !rows.length && phone ? `<a class="btn btn-primary btn-block" style="margin-top:12px" href="#/new?phone=${phone}">+ Tạo khách ${esc(prettyPhone(phone))}</a>` : '');
  };
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 250); });
  run(); if (!q0) q.focus();
}

// ------------------------------------------------------------------ lịch hẹn
async function viewSchedule() {
  $main.innerHTML = '<div class="empty">Đang tải…</div>';
  const [d, up] = await Promise.all([store.dashboard(), store.upcoming(60)]);
  const groups = {};
  for (const c of up) { const k = fmtDate(toLocalInput(c.next_followup_at)); (groups[k] = groups[k] || []).push(c); }
  $main.innerHTML = `<div class="stack">
    <h1>Lịch hẹn chăm sóc</h1>
    <section class="section"><div class="section-head"><h2>Quá hạn</h2><span class="count">${d.overdue.length}</span></div>${custList(d.overdue, 'overdue', 'Không có.')}</section>
    <section class="section"><div class="section-head"><h2>Hôm nay</h2><span class="count">${d.today.length}</span></div>${custList(d.today, 'today', 'Không có.')}</section>
    ${Object.entries(groups).map(([k, rows]) => `<section class="section"><div class="section-head"><h2>${esc(k)}</h2><span class="count">${rows.length}</span></div>${custList(rows, 'upcoming', '')}</section>`).join('')}
    ${up.length ? '' : '<section class="section"><h2>Sắp tới</h2><div class="empty">Chưa có lịch hẹn sắp tới.</div></section>'}
  </div>`;
}

// ------------------------------------------------------------------ cài đặt, sao lưu
function download(name, content, type) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([content], { type })), download: name });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function toCSV(dump) {
  const cols = ['SĐT', 'Tên Zalo', 'Tên khách', 'Đang cần hỗ trợ', 'Vấn đề hiện tại', 'Ghi chú khách', 'Hẹn chăm sóc', 'Ngày mua', 'Dòng máy', 'Dung lượng', 'Màu',
    'Ngoại hình', 'Pin', 'Linh kiện đã thay', 'Bảo hành', 'Ghi chú lần mua', 'Lịch sử chăm sóc'];
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [cols.map(q).join(',')];
  for (const c of dump.customers) {
    const ps = dump.purchases.filter((p) => p.customer_id === c.id);
    const hist = dump.interactions.filter((i) => i.customer_id === c.id)
      .sort((a, b) => (a.happened_at > b.happened_at ? 1 : -1))
      .map((i) => `[${fmtDateTime(i.happened_at)}] ${[i.content, i.result && 'KQ: ' + i.result].filter(Boolean).join(' – ')}`).join('\n');
    for (const p of ps.length ? ps : [{}]) {
      lines.push([c.phone, c.zalo_name, c.name, c.needs_support ? 'Có' : '', c.current_issue, c.note, fmtDateTime(c.next_followup_at),
        fmtDate(p.purchase_date), p.model, p.storage, p.color, p.appearance, p.battery, p.replaced_parts, p.warranty, p.note, hist].map(q).join(','));
    }
  }
  return '﻿' + lines.join('\r\n');
}

function viewSettings() {
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  $main.innerHTML = `<div class="stack">
    <h1>Cài đặt</h1>
    <div class="card stack">
      <h2>Tài khoản</h2>
      <div>${store.mode === 'demo' ? '<span class="tag tag-amber">Chế độ dùng thử – dữ liệu chỉ trên máy này</span>' : esc(user?.email || '')}</div>
      <button class="btn" id="logout">Đăng xuất</button>
    </div>
    <div class="card stack">
      <h2>Nhắc lịch</h2>
      <div class="small muted">App báo khi có khách đến hạn chăm sóc lúc bạn mở app (và số khách cần chăm sóc hiện trên biểu tượng app).
        Để được nhắc cả khi app đang đóng, trong hồ sơ khách bấm <b>Thêm vào Lịch</b> để đưa lịch hẹn vào Google Lịch / Samsung Lịch.</div>
      <div>Thông báo: <b id="perm">${{ granted: 'Đã bật', denied: 'Đã chặn (bật lại trong Cài đặt Chrome)', default: 'Chưa bật', unsupported: 'Máy không hỗ trợ' }[perm]}</b></div>
      ${perm === 'default' ? '<button class="btn btn-primary" id="notif">Bật thông báo nhắc lịch</button>' : ''}
    </div>
    <div class="card stack">
      <h2>Sao lưu dữ liệu</h2>
      <button class="btn" id="exjson">Xuất bản sao lưu đầy đủ (.json)</button>
      <button class="btn" id="excsv">Xuất bảng Excel (.csv)</button>
      <label class="btn btn-ghost">Khôi phục từ file .json<input type="file" id="imp" accept=".json,application/json" hidden></label>
      <div class="small muted">Nên xuất bản sao lưu định kỳ và cất vào Google Drive.</div>
    </div>
    <div class="card stack small">
      <h2>Thêm khách nhanh từ Zalo</h2>
      <div>1. Trong Zalo, mở hồ sơ hoặc tin nhắn có số điện thoại → <b>Chia sẻ</b> → chọn <b>GIANO CSKH</b>.</div>
      <div>2. Nếu Zalo không có nút Chia sẻ: nhấn giữ số điện thoại → <b>Sao chép</b> → mở GIANO CSKH → bấm <b>Dán</b>.</div>
    </div>
    <div class="center small muted">GIANO CSKH · phiên bản 1.0</div>
  </div>`;
  $main.querySelector('#logout').onclick = async () => { await store.signOut(); user = null; go('#/login'); };
  const n = $main.querySelector('#notif');
  if (n) n.onclick = async () => { await Notification.requestPermission(); checkReminders(true); viewSettings(); };
  const stamp = new Date().toISOString().slice(0, 10);
  $main.querySelector('#exjson').onclick = async () => {
    const dump = await store.exportAll();
    download(`giano-cskh-saoluu-${stamp}.json`, JSON.stringify({ app: 'giano-cskh', version: 1, exported_at: new Date().toISOString(), ...dump }, null, 1), 'application/json');
    toast(`Đã xuất ${dump.customers.length} khách`);
  };
  $main.querySelector('#excsv').onclick = async () => {
    const dump = await store.exportAll();
    download(`giano-cskh-${stamp}.csv`, toCSV(dump), 'text/csv;charset=utf-8');
  };
  $main.querySelector('#imp').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const dump = JSON.parse(await file.text());
      if (!Array.isArray(dump.customers)) throw new Error('File không đúng định dạng sao lưu GIANO CSKH');
      if (!confirm(`Khôi phục ${dump.customers.length} khách từ file này? Hồ sơ cùng mã sẽ được ghi đè.`)) return;
      await store.importAll(dump); toast('Đã khôi phục dữ liệu');
    } catch (err) { toast('Lỗi: ' + err.message, 4000); }
  };
}

// ------------------------------------------------------------------ nhắc lịch
async function updateBadge(n) {
  try { if (navigator.setAppBadge) n ? await navigator.setAppBadge(n) : await navigator.clearAppBadge(); } catch {}
}
async function checkReminders(force = false) {
  if (!user) return;
  try {
    const d = await store.dashboard();
    updateBadge(d.overdue.length + d.today.length);
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const now = new Date();
    const seen = JSON.parse(localStorage.getItem('notified') || '{}');
    const reg = await navigator.serviceWorker?.getRegistration();
    for (const c of [...d.overdue, ...d.today]) {
      if (new Date(c.next_followup_at) > now) continue;
      const key = c.id + '@' + c.next_followup_at;
      if (seen[key] && !force) continue;
      seen[key] = Date.now();
      const opts = { body: `${prettyPhone(c.phone)} · ${relFollowup(c.next_followup_at)}${c.current_issue ? '\n' + c.current_issue : ''}`,
        tag: 'cskh-' + c.id, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: './#/c/' + c.id } };
      const title = 'Chăm sóc: ' + displayName(c);
      if (reg) reg.showNotification(title, opts); else new Notification(title, opts);
    }
    localStorage.setItem('notified', JSON.stringify(seen));
  } catch (e) { console.warn(e); }
}
let reminderTimer;
function startReminders() {
  clearInterval(reminderTimer);
  checkReminders(); reminderTimer = setInterval(checkReminders, 60000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkReminders(); });

// ------------------------------------------------------------------ điều hướng
async function route() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const params = new URLSearchParams(qs || '');
  const parts = path.split('/').filter(Boolean);

  if (!user && parts[0] !== 'login') {
    sessionStorage.setItem('after-login', location.hash || '#/');
    return viewLogin();
  }
  if (parts[0] === 'login') return user ? go('#/') : viewLogin();

  $tabbar.hidden = false;
  const tab = { '': 'home', search: 'search', new: 'new', schedule: 'schedule', settings: 'settings' }[parts[0] || ''];
  $tabbar.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  window.scrollTo(0, 0);
  try {
    switch (parts[0] || '') {
      case '': return await viewHome();
      case 'share': return await viewShare(params);
      case 'new': return await viewNew(params);
      case 'search': return await viewSearch(params);
      case 'schedule': return await viewSchedule();
      case 'settings': return viewSettings();
      case 'c':
        if (parts[2] === 'edit') return await viewEditCustomer(parts[1]);
        if (parts[2] === 'buy') return await viewPurchase(parts[1], parts[3]);
        return await viewCustomer(parts[1]);
      default: return go('#/');
    }
  } catch (e) {
    console.error(e);
    if (/JWT|session|auth/i.test(e.message)) { user = null; return viewLogin(); }
    $main.innerHTML = `<div class="notice notice-red">Không tải được dữ liệu: ${esc(e.message)}<br>Kiểm tra kết nối mạng rồi thử lại.</div>
      <button class="btn btn-block" style="margin-top:12px" onclick="location.reload()">Thử lại</button>`;
  }
}

async function boot() {
  document.getElementById('mode-badge').hidden = store.mode !== 'demo';
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  user = await store.getUser();
  store.onAuth((u) => { const was = user; user = u; if (was && !u) go('#/login'); });
  window.addEventListener('hashchange', route);
  await route();
  if (user) startReminders();
}
boot();
