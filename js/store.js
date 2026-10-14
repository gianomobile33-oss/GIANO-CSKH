// Lớp dữ liệu. Có 2 bản cùng giao diện:
//  - SupabaseStore: dữ liệu trên cloud (dùng thật).
//  - LocalStore: chế độ dùng thử khi chưa cấu hình cloud, dữ liệu chỉ nằm trong máy.
import { buildSearchText, fold, normalizePhone, startOfToday, endOfToday, uuid } from './util.js';

export const CUSTOMER_FIELDS = ['phone', 'zalo_name', 'name', 'current_issue', 'needs_support', 'note', 'next_followup_at'];
export const PURCHASE_FIELDS = ['purchase_date', 'model', 'storage', 'color', 'appearance', 'battery', 'replaced_parts', 'warranty', 'note'];
export const INTERACTION_FIELDS = ['happened_at', 'content', 'result', 'next_followup_at'];

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k] === '' ? null : o[k]]));

function prepCustomer(data, existing = {}) {
  const c = pick(data, CUSTOMER_FIELDS);
  if (c.phone !== undefined) {
    c.phone = normalizePhone(c.phone);
    if (!c.phone) throw new Error('Số điện thoại không hợp lệ');
  }
  c.search_text = buildSearchText({ ...existing, ...c });
  return c;
}

function splitDashboard(rows) {
  const s = startOfToday(), e = endOfToday();
  const overdue = [], today = [];
  for (const c of rows) {
    if (!c.next_followup_at) continue;
    const t = new Date(c.next_followup_at);
    if (t < s) overdue.push(c); else if (t <= e) today.push(c);
  }
  return { overdue, today };
}

export class DuplicatePhoneError extends Error {
  constructor(customer) { super('Số điện thoại đã có hồ sơ'); this.customer = customer; }
}

// ---------------------------------------------------------------- Supabase
export class SupabaseStore {
  constructor(url, key) {
    this.mode = 'cloud';
    this.sb = window.supabase.createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }
  async getUser() { const { data } = await this.sb.auth.getSession(); return data.session?.user || null; }
  async signIn(email, password) {
    const { data, error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Sai email hoặc mật khẩu' : error.message);
    return data.user;
  }
  async signOut() { await this.sb.auth.signOut(); }
  onAuth(cb) { this.sb.auth.onAuthStateChange((_e, s) => cb(s?.user || null)); }

  _ok({ data, error }) { if (error) throw new Error(error.message); return data; }

  async findByPhone(phone) {
    const p = normalizePhone(phone); if (!p) return null;
    return this._ok(await this.sb.from('customers').select('*').eq('phone', p).maybeSingle());
  }
  async search(q) {
    const f = fold(q).replace(/[\\%_]/g, (m) => '\\' + m);
    const digits = String(q).replace(/\D/g, '');
    let req = this.sb.from('customers').select('*').order('updated_at', { ascending: false }).limit(50);
    if (f) {
      // Gõ số có dấu cách/chấm hoặc +84 vẫn tìm được
      const term = digits.length >= 3 && /^[\d\s.+\-()]+$/.test(q) ? (normalizePhone(q) || digits).replace(/^0/, '') : f;
      req = req.ilike('search_text', `%${term}%`);
    }
    return this._ok(await req);
  }
  async getCustomer(id) {
    const c = this._ok(await this.sb.from('customers').select('*').eq('id', id).maybeSingle());
    if (!c) return null;
    const [purchases, interactions] = await Promise.all([
      this.sb.from('purchases').select('*').eq('customer_id', id).order('purchase_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }),
      this.sb.from('interactions').select('*').eq('customer_id', id).order('happened_at', { ascending: false }),
    ]);
    return { customer: c, purchases: this._ok(purchases), interactions: this._ok(interactions) };
  }
  async createCustomer(data) {
    const row = prepCustomer(data);
    const res = await this.sb.from('customers').insert(row).select().single();
    if (res.error?.code === '23505') throw new DuplicatePhoneError(await this.findByPhone(row.phone));
    return this._ok(res);
  }
  async updateCustomer(id, patch) {
    const cur = this._ok(await this.sb.from('customers').select('*').eq('id', id).single());
    const row = prepCustomer(patch, cur);
    const res = await this.sb.from('customers').update(row).eq('id', id).select().single();
    if (res.error?.code === '23505') throw new DuplicatePhoneError(await this.findByPhone(row.phone));
    return this._ok(res);
  }
  async deleteCustomer(id) { this._ok(await this.sb.from('customers').delete().eq('id', id)); }

  async addPurchase(customerId, data) {
    return this._ok(await this.sb.from('purchases').insert({ ...pick(data, PURCHASE_FIELDS), customer_id: customerId }).select().single());
  }
  async updatePurchase(id, data) { return this._ok(await this.sb.from('purchases').update(pick(data, PURCHASE_FIELDS)).eq('id', id).select().single()); }
  async deletePurchase(id) { this._ok(await this.sb.from('purchases').delete().eq('id', id)); }

  async addInteraction(customerId, data) {
    return this._ok(await this.sb.from('interactions').insert({ ...pick(data, INTERACTION_FIELDS), customer_id: customerId }).select().single());
  }
  async deleteInteraction(id) { this._ok(await this.sb.from('interactions').delete().eq('id', id)); }

  async dashboard() {
    const [due, support] = await Promise.all([
      this.sb.from('customers').select('*').not('next_followup_at', 'is', null)
        .lte('next_followup_at', endOfToday().toISOString()).order('next_followup_at'),
      this.sb.from('customers').select('*').eq('needs_support', true).order('updated_at', { ascending: false }),
    ]);
    return { ...splitDashboard(this._ok(due)), support: this._ok(support) };
  }
  async upcoming(limit = 30) {
    return this._ok(await this.sb.from('customers').select('*')
      .gt('next_followup_at', endOfToday().toISOString()).order('next_followup_at').limit(limit));
  }

  async _all(table) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const rows = this._ok(await this.sb.from(table).select('*').order('created_at').range(from, from + 999));
      out.push(...rows); if (rows.length < 1000) return out;
    }
  }
  async exportAll() {
    const [customers, purchases, interactions] = await Promise.all(['customers', 'purchases', 'interactions'].map((t) => this._all(t)));
    return { customers, purchases, interactions };
  }
  async importAll(dump) {
    // Khôi phục từ file sao lưu: ghi đè theo id, không tạo trùng.
    const strip = (r) => { const { owner_id, ...rest } = r; return rest; };
    for (const [t, rows] of [['customers', dump.customers], ['purchases', dump.purchases], ['interactions', dump.interactions]]) {
      for (let i = 0; i < (rows || []).length; i += 500) {
        this._ok(await this.sb.from(t).upsert(rows.slice(i, i + 500).map(strip), { onConflict: 'id' }));
      }
    }
  }
}

// ---------------------------------------------------------------- Local (dùng thử)
const LS_KEY = 'giano-cskh-demo-db';
export class LocalStore {
  constructor() {
    this.mode = 'demo';
    try { this.db = JSON.parse(localStorage.getItem(LS_KEY)) || null; } catch { this.db = null; }
    this.db = this.db || { customers: [], purchases: [], interactions: [] };
    this.user = { email: 'demo@giano' };
  }
  _save() { localStorage.setItem(LS_KEY, JSON.stringify(this.db)); }
  async getUser() { return sessionStorage.getItem('demo-auth') ? this.user : null; }
  async signIn() { sessionStorage.setItem('demo-auth', '1'); return this.user; }
  async signOut() { sessionStorage.removeItem('demo-auth'); }
  onAuth() {}

  async findByPhone(phone) { const p = normalizePhone(phone); return this.db.customers.find((c) => c.phone === p) || null; }
  async search(q) {
    const f = fold(q);
    const digits = String(q).replace(/\D/g, '');
    const term = digits.length >= 3 && /^[\d\s.+\-()]+$/.test(q) ? (normalizePhone(q) || digits).replace(/^0/, '') : f;
    return this.db.customers.filter((c) => !term || (c.search_text || '').includes(term))
      .sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1)).slice(0, 50);
  }
  async getCustomer(id) {
    const customer = this.db.customers.find((c) => c.id === id); if (!customer) return null;
    return {
      customer,
      purchases: this.db.purchases.filter((p) => p.customer_id === id)
        .sort((a, b) => String(b.purchase_date || '').localeCompare(String(a.purchase_date || '')) || (b.created_at > a.created_at ? 1 : -1)),
      interactions: this.db.interactions.filter((i) => i.customer_id === id).sort((a, b) => (b.happened_at > a.happened_at ? 1 : -1)),
    };
  }
  async createCustomer(data) {
    const row = prepCustomer(data);
    const dup = await this.findByPhone(row.phone); if (dup) throw new DuplicatePhoneError(dup);
    const now = new Date().toISOString();
    const c = { id: uuid(), needs_support: false, created_at: now, updated_at: now, ...row };
    this.db.customers.push(c); this._save(); return c;
  }
  async updateCustomer(id, patch) {
    const c = this.db.customers.find((x) => x.id === id);
    const row = prepCustomer(patch, c);
    if (row.phone && row.phone !== c.phone) { const dup = await this.findByPhone(row.phone); if (dup) throw new DuplicatePhoneError(dup); }
    Object.assign(c, row, { updated_at: new Date().toISOString() }); this._save(); return c;
  }
  async deleteCustomer(id) {
    this.db.customers = this.db.customers.filter((c) => c.id !== id);
    this.db.purchases = this.db.purchases.filter((c) => c.customer_id !== id);
    this.db.interactions = this.db.interactions.filter((c) => c.customer_id !== id);
    this._save();
  }
  async addPurchase(customerId, data) {
    const p = { id: uuid(), customer_id: customerId, created_at: new Date().toISOString(), ...pick(data, PURCHASE_FIELDS) };
    this.db.purchases.push(p); this._save(); return p;
  }
  async updatePurchase(id, data) { const p = this.db.purchases.find((x) => x.id === id); Object.assign(p, pick(data, PURCHASE_FIELDS)); this._save(); return p; }
  async deletePurchase(id) { this.db.purchases = this.db.purchases.filter((x) => x.id !== id); this._save(); }
  async addInteraction(customerId, data) {
    const i = { id: uuid(), customer_id: customerId, created_at: new Date().toISOString(), happened_at: new Date().toISOString(), ...pick(data, INTERACTION_FIELDS) };
    this.db.interactions.push(i); this._save(); return i;
  }
  async deleteInteraction(id) { this.db.interactions = this.db.interactions.filter((x) => x.id !== id); this._save(); }
  async dashboard() {
    const due = this.db.customers.filter((c) => c.next_followup_at && new Date(c.next_followup_at) <= endOfToday())
      .sort((a, b) => (a.next_followup_at > b.next_followup_at ? 1 : -1));
    return { ...splitDashboard(due), support: this.db.customers.filter((c) => c.needs_support) };
  }
  async upcoming(limit = 30) {
    return this.db.customers.filter((c) => c.next_followup_at && new Date(c.next_followup_at) > endOfToday())
      .sort((a, b) => (a.next_followup_at > b.next_followup_at ? 1 : -1)).slice(0, limit);
  }
  async exportAll() { return JSON.parse(JSON.stringify(this.db)); }
  async importAll(dump) {
    for (const t of ['customers', 'purchases', 'interactions']) {
      for (const r of dump[t] || []) {
        const i = this.db[t].findIndex((x) => x.id === r.id);
        if (i >= 0) this.db[t][i] = r; else this.db[t].push(r);
      }
    }
    this._save();
  }
}
