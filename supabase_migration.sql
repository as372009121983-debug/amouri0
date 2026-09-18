-- =====================================================================
-- WarehouseManager — إعادة إنشاء قاعدة البيانات بالكامل (schema جديد فاضي)
-- شغّل هذا الملف مرة واحدة في: Supabase Dashboard → SQL Editor → New query
-- =====================================================================

create extension if not exists pgcrypto;

-- =====================================================================
-- 1) جدول ملفات المستخدمين (مرتبط بجدول auth.users بتاع Supabase)
-- =====================================================================
create table public.user_profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text,
  email       text unique,
  full_name   text,
  phone       text,
  role        text not null default 'worker'
              check (role in ('admin','warehouse_manager','driver','worker','boss')),
  active      boolean not null default true,
  owner_id    uuid references public.user_profiles(id),
  max_salary  numeric default 0,
  hire_date   date,
  created_at  timestamptz not null default now()
);
create index idx_user_profiles_owner on public.user_profiles(owner_id);

-- =====================================================================
-- 2) دالة معرفة "المالك" الفعلي للمستخدم (لعزل بيانات كل شركة عن التانية)
--    admin بدون owner_id يبقى هو نفسه المالك. أي حساب تابع (worker/driver..)
--    بياخد owner_id بتاع الأدمن اللي أنشأه.
-- =====================================================================
create or replace function public.get_owner_id(uid uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(owner_id, id) from public.user_profiles where id = uid;
$$;

-- إنشاء تلقائي لصف user_profiles عند تسجيل حساب جديد في auth.users
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, email, username, full_name, phone, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'phone', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'phone',
    coalesce(new.raw_user_meta_data->>'role', 'admin')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- تأكيد الإيميل تلقائياً (الحسابات بتتعمل بأرقام تليفون + إيميل وهمي @wms.local)
create or replace function public.confirm_user_email(user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update auth.users set email_confirmed_at = now()
  where id = user_id and email_confirmed_at is null;
end;
$$;

-- =====================================================================
-- 3) الجداول الرئيسية (كل واحد فيه owner_id لعزل بيانات كل عميل/شركة)
-- =====================================================================

create table public.warehouses (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  code        text,
  type        text default 'رئيسي',
  location    text,
  city        text,
  manager     text,
  capacity    numeric default 0,
  used        numeric default 0,
  status      text default 'نشط',
  phone       text,
  created_at  timestamptz not null default now(),
  owner_id    uuid default public.get_owner_id(auth.uid()) references public.user_profiles(id)
);

create table public.products (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  sku              text,
  barcode          text,
  category         text,
  unit             text,
  min_stock        numeric default 0,
  price            numeric default 0,
  purchase_price   numeric default 0,
  min_sale_price   numeric,
  max_sale_price   numeric,
  created_at       timestamptz not null default now(),
  owner_id         uuid default public.get_owner_id(auth.uid()) references public.user_profiles(id)
);

create table public.customers (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  phone          text,
  location       text,
  notes          text,
  balance        numeric default 0,
  max_debt_limit numeric default 0,
  created_at     timestamptz not null default now(),
  owner_id       uuid default public.get_owner_id(auth.uid()) references public.user_profiles(id)
);

create table public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  phone       text,
  location    text,
  notes       text,
  balance     numeric default 0,
  created_at  timestamptz not null default now(),
  owner_id    uuid default public.get_owner_id(auth.uid()) references public.user_profiles(id)
);

create table public.showrooms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  location    text,
  phone       text,
  notes       text,
  created_at  timestamptz not null default now(),
  owner_id    uuid default public.get_owner_id(auth.uid()) references public.user_profiles(id)
);

create table public.inventory (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid references public.products(id) on delete cascade,
  warehouse_id  uuid references public.warehouses(id) on delete cascade,
  quantity      numeric not null default 0,
  last_updated  timestamptz not null default now()
);
create index idx_inventory_product on public.inventory(product_id);
create index idx_inventory_warehouse on public.inventory(warehouse_id);

create table public.showroom_inventory (
  id            uuid primary key default gen_random_uuid(),
  showroom_id   uuid references public.showrooms(id) on delete cascade,
  product_id    uuid references public.products(id) on delete cascade,
  product_name  text,
  quantity      numeric not null default 0,
  last_updated  timestamptz not null default now()
);
create index idx_showroom_inv_showroom on public.showroom_inventory(showroom_id);
create index idx_showroom_inv_product on public.showroom_inventory(product_id);

create table public.sales (
  id                    uuid primary key default gen_random_uuid(),
  customer_id           uuid references public.customers(id),
  customer_name         text,
  warehouse_id          uuid references public.warehouses(id),
  warehouse_name        text,
  total_amount          numeric default 0,
  paid_amount           numeric default 0,
  initial_paid_amount   numeric default 0,
  discount              numeric default 0,
  extra_amount          numeric default 0,
  status                text,
  notes                 text,
  sale_date             date default current_date,
  created_at            timestamptz not null default now(),
  invoice_type          text default 'بيع',
  manual_status         text,
  payment_method        text,
  wallet_from           text,
  wallet_to             text,
  owner_id              uuid default public.get_owner_id(auth.uid()) references public.user_profiles(id)
);
create index idx_sales_customer on public.sales(customer_id);
create index idx_sales_warehouse on public.sales(warehouse_id);

create table public.sale_items (
  id            uuid primary key default gen_random_uuid(),
  sale_id       uuid references public.sales(id) on delete cascade,
  product_id    uuid references public.products(id),
  product_name  text,
  quantity      numeric default 0,
  unit_price    numeric default 0,
  total_price   numeric default 0,
  unit          text
);
create index idx_sale_items_sale on public.sale_items(sale_id);

create table public.purchases (
  id              uuid primary key default gen_random_uuid(),
  supplier_id     uuid references public.suppliers(id),
  supplier_name   text,
  warehouse_id    uuid references public.warehouses(id),
  warehouse_name  text,
  total_amount    numeric default 0,
  paid_amount     numeric default 0,
  extra_amount    numeric default 0,
  status          text,
  notes           text,
  purchase_date   date default current_date,
  created_at      timestamptz not null default now(),
  payment_method  text,
  wallet_from     text,
  wallet_to       text,
  owner_id        uuid default public.get_owner_id(auth.uid()) references public.user_profiles(id)
);
create index idx_purchases_supplier on public.purchases(supplier_id);
create index idx_purchases_warehouse on public.purchases(warehouse_id);

create table public.purchase_items (
  id            uuid primary key default gen_random_uuid(),
  purchase_id   uuid references public.purchases(id) on delete cascade,
  product_id    uuid references public.products(id),
  product_name  text,
  quantity      numeric default 0,
  unit_price    numeric default 0,
  total_price   numeric default 0,
  unit          text
);
create index idx_purchase_items_purchase on public.purchase_items(purchase_id);

create table public.transfers (
  id                   uuid primary key default gen_random_uuid(),
  from_warehouse_id    uuid references public.warehouses(id),
  to_warehouse_id      uuid references public.warehouses(id),
  from_warehouse_name  text,
  to_warehouse_name    text,
  status               text default 'معلق',
  driver_id            uuid references public.user_profiles(id),
  driver_name          text,
  notes                text,
  total_items          numeric default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz
);

create table public.transfer_items (
  id            uuid primary key default gen_random_uuid(),
  transfer_id   uuid references public.transfers(id) on delete cascade,
  product_id    uuid references public.products(id),
  product_name  text,
  quantity      numeric default 0,
  unit          text
);
create index idx_transfer_items_transfer on public.transfer_items(transfer_id);

create table public.returns (
  id            uuid primary key default gen_random_uuid(),
  type          text check (type in ('مبيعات','مشتريات')),
  reference_id  uuid,
  customer_id   uuid references public.customers(id),
  supplier_id   uuid references public.suppliers(id),
  customer_name text,
  supplier_name text,
  total_amount  numeric default 0,
  reason        text,
  status        text,
  return_date   date default current_date,
  created_at    timestamptz not null default now(),
  owner_id      uuid default public.get_owner_id(auth.uid()) references public.user_profiles(id)
);

create table public.return_items (
  id           uuid primary key default gen_random_uuid(),
  return_id    uuid references public.returns(id) on delete cascade,
  product_id   uuid references public.products(id),
  product_name text,
  quantity     numeric default 0,
  unit_price   numeric default 0,
  unit         text
);
create index idx_return_items_return on public.return_items(return_id);

create table public.expenses (
  id            uuid primary key default gen_random_uuid(),
  description   text,
  amount        numeric default 0,
  category      text,
  expense_date  date default current_date,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.user_profiles(id),
  owner_id      uuid default public.get_owner_id(auth.uid()) references public.user_profiles(id)
);

create table public.damages (
  id              uuid primary key default gen_random_uuid(),
  product_name    text,
  warehouse_name  text,
  quantity        numeric default 0,
  reason          text,
  damage_date     date default current_date,
  created_at      timestamptz not null default now(),
  damage_type     text,
  unit            text,
  unit_cost       numeric default 0,
  created_by      uuid references public.user_profiles(id),
  owner_id        uuid default public.get_owner_id(auth.uid()) references public.user_profiles(id)
);

create table public.alerts (
  id              uuid primary key default gen_random_uuid(),
  type            text check (type in ('تحذير','خطأ','معلومة','نجاح')),
  message         text,
  warehouse_id    uuid references public.warehouses(id),
  warehouse_name  text,
  read            boolean default false,
  created_at      timestamptz not null default now(),
  owner_id        uuid default public.get_owner_id(auth.uid()) references public.user_profiles(id)
);

create table public.customer_payments (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid references public.customers(id),
  customer_name   text,
  amount          numeric default 0,
  type            text,
  notes           text,
  payment_date    date default current_date,
  created_at      timestamptz not null default now(),
  payment_method  text,
  wallet_from     text,
  wallet_to       text,
  sale_id         uuid references public.sales(id)
);
create index idx_customer_payments_customer on public.customer_payments(customer_id);

create table public.supplier_payments (
  id             uuid primary key default gen_random_uuid(),
  supplier_id    uuid references public.suppliers(id),
  supplier_name  text,
  amount         numeric default 0,
  notes          text,
  payment_date   date default current_date,
  created_at     timestamptz not null default now()
);
create index idx_supplier_payments_supplier on public.supplier_payments(supplier_id);

create table public.worker_transactions (
  id                uuid primary key default gen_random_uuid(),
  worker_id         uuid references public.user_profiles(id),
  worker_name       text,
  type              text,
  amount            numeric default 0,
  notes             text,
  transaction_date  date default current_date,
  created_at        timestamptz not null default now()
);
create index idx_worker_transactions_worker on public.worker_transactions(worker_id);

-- =====================================================================
-- 4) تفعيل RLS + سياسات عزل البيانات (كل شركة تشوف بياناتها بس)
-- =====================================================================
alter table public.user_profiles      enable row level security;
alter table public.warehouses         enable row level security;
alter table public.products           enable row level security;
alter table public.customers          enable row level security;
alter table public.suppliers          enable row level security;
alter table public.showrooms          enable row level security;
alter table public.inventory          enable row level security;
alter table public.showroom_inventory enable row level security;
alter table public.sales              enable row level security;
alter table public.sale_items         enable row level security;
alter table public.purchases          enable row level security;
alter table public.purchase_items     enable row level security;
alter table public.transfers          enable row level security;
alter table public.transfer_items     enable row level security;
alter table public.returns            enable row level security;
alter table public.return_items       enable row level security;
alter table public.expenses           enable row level security;
alter table public.damages            enable row level security;
alter table public.alerts             enable row level security;
alter table public.customer_payments  enable row level security;
alter table public.supplier_payments  enable row level security;
alter table public.worker_transactions enable row level security;

-- user_profiles: كل حد يشوف نفسه + زمايله في نفس الشركة
create policy "user_profiles_select" on public.user_profiles for select to authenticated
  using (id = auth.uid() or coalesce(owner_id, id) = public.get_owner_id(auth.uid()));
create policy "user_profiles_update" on public.user_profiles for update to authenticated
  using (id = auth.uid() or coalesce(owner_id, id) = public.get_owner_id(auth.uid()));
create policy "user_profiles_insert" on public.user_profiles for insert to authenticated
  with check (true);

-- الجداول اللي عندها owner_id مباشر: عزل كامل بالـ owner_id
do $$
declare t text;
begin
  foreach t in array array['warehouses','products','customers','suppliers','showrooms',
                            'sales','purchases','returns','expenses','damages','alerts']
  loop
    execute format($f$
      create policy "%1$s_all" on public.%1$s for all to authenticated
        using (owner_id = public.get_owner_id(auth.uid()))
        with check (owner_id = public.get_owner_id(auth.uid()));
    $f$, t);
  end loop;
end $$;

-- الجداول الفرعية (بتتبع الجدول الأب عن طريق foreign key)
create policy "inventory_all" on public.inventory for all to authenticated
  using (exists (select 1 from public.warehouses w where w.id = warehouse_id and w.owner_id = public.get_owner_id(auth.uid())))
  with check (exists (select 1 from public.warehouses w where w.id = warehouse_id and w.owner_id = public.get_owner_id(auth.uid())));

create policy "showroom_inventory_all" on public.showroom_inventory for all to authenticated
  using (exists (select 1 from public.showrooms s where s.id = showroom_id and s.owner_id = public.get_owner_id(auth.uid())))
  with check (exists (select 1 from public.showrooms s where s.id = showroom_id and s.owner_id = public.get_owner_id(auth.uid())));

create policy "sale_items_all" on public.sale_items for all to authenticated
  using (exists (select 1 from public.sales s where s.id = sale_id and s.owner_id = public.get_owner_id(auth.uid())))
  with check (exists (select 1 from public.sales s where s.id = sale_id and s.owner_id = public.get_owner_id(auth.uid())));

create policy "purchase_items_all" on public.purchase_items for all to authenticated
  using (exists (select 1 from public.purchases p where p.id = purchase_id and p.owner_id = public.get_owner_id(auth.uid())))
  with check (exists (select 1 from public.purchases p where p.id = purchase_id and p.owner_id = public.get_owner_id(auth.uid())));

create policy "return_items_all" on public.return_items for all to authenticated
  using (exists (select 1 from public.returns r where r.id = return_id and r.owner_id = public.get_owner_id(auth.uid())))
  with check (exists (select 1 from public.returns r where r.id = return_id and r.owner_id = public.get_owner_id(auth.uid())));

create policy "transfers_all" on public.transfers for all to authenticated
  using (
    exists (select 1 from public.warehouses w where w.id = from_warehouse_id and w.owner_id = public.get_owner_id(auth.uid()))
    or exists (select 1 from public.warehouses w where w.id = to_warehouse_id and w.owner_id = public.get_owner_id(auth.uid()))
  )
  with check (true);

create policy "transfer_items_all" on public.transfer_items for all to authenticated
  using (exists (select 1 from public.transfers t where t.id = transfer_id))
  with check (true);

create policy "customer_payments_all" on public.customer_payments for all to authenticated
  using (exists (select 1 from public.customers c where c.id = customer_id and c.owner_id = public.get_owner_id(auth.uid())))
  with check (true);

create policy "supplier_payments_all" on public.supplier_payments for all to authenticated
  using (exists (select 1 from public.suppliers s where s.id = supplier_id and s.owner_id = public.get_owner_id(auth.uid())))
  with check (true);

create policy "worker_transactions_all" on public.worker_transactions for all to authenticated
  using (exists (select 1 from public.user_profiles u where u.id = worker_id and coalesce(u.owner_id, u.id) = public.get_owner_id(auth.uid())))
  with check (true);

-- =====================================================================
-- خلاص. القاعدة دلوقتي فاضية وجاهزة بنفس هيكل التطبيق بالضبط.
-- =====================================================================
