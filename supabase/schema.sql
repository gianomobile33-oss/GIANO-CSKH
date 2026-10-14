-- GIANO CSKH – cấu trúc dữ liệu cho Supabase (Postgres)
-- Chạy một lần trong Supabase → SQL Editor → New query → dán toàn bộ → Run.
-- Chạy lại nhiều lần vẫn an toàn.

-- ===== Khách hàng =====
create table if not exists public.customers (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  phone            text not null check (phone ~ '^[0-9]{8,12}$'),
  zalo_name        text,
  name             text,
  current_issue    text,
  needs_support    boolean not null default false,
  note             text,
  next_followup_at timestamptz,
  search_text      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (owner_id, phone)              -- không cho tạo khách trùng số
);
create index if not exists customers_followup_idx on public.customers (owner_id, next_followup_at);
create index if not exists customers_support_idx  on public.customers (owner_id) where needs_support;

-- ===== Lần mua =====
create table if not exists public.purchases (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  customer_id    uuid not null references public.customers (id) on delete cascade,
  purchase_date  date,
  model          text,
  storage        text,
  color          text,
  appearance     text,
  battery        text,
  replaced_parts text,
  warranty       text,
  note           text,
  created_at     timestamptz not null default now()
);
create index if not exists purchases_customer_idx on public.purchases (customer_id);

-- ===== Lịch sử chăm sóc =====
create table if not exists public.interactions (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  customer_id      uuid not null references public.customers (id) on delete cascade,
  happened_at      timestamptz not null default now(),
  content          text,
  result           text,
  next_followup_at timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists interactions_customer_idx on public.interactions (customer_id, happened_at desc);

-- ===== Tự cập nhật updated_at =====
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists customers_touch on public.customers;
create trigger customers_touch before update on public.customers
  for each row execute function public.touch_updated_at();

-- ===== Bảo vệ dữ liệu: mỗi tài khoản chỉ thấy và sửa dữ liệu của chính mình =====
alter table public.customers    enable row level security;
alter table public.purchases    enable row level security;
alter table public.interactions enable row level security;

drop policy if exists own_rows on public.customers;
create policy own_rows on public.customers for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists own_rows on public.purchases;
create policy own_rows on public.purchases for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid()
    and exists (select 1 from public.customers c where c.id = customer_id and c.owner_id = auth.uid()));

drop policy if exists own_rows on public.interactions;
create policy own_rows on public.interactions for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid()
    and exists (select 1 from public.customers c where c.id = customer_id and c.owner_id = auth.uid()));

-- Người chưa đăng nhập không có quyền gì.
revoke all on public.customers, public.purchases, public.interactions from anon;
grant select, insert, update, delete on public.customers, public.purchases, public.interactions to authenticated;
