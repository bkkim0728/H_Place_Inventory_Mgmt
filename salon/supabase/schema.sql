-- ============================================================================
-- H Place 헤어살롱 재고관리 — Supabase schema
--
-- Run once in Supabase Dashboard → SQL Editor (safe to re-run).
-- Designed for multiple branches (12개 지점) from day one; the prototype
-- starts with a single branch.
--
-- Roles
--   admin   (전체 관리자)  every branch: branches, users, product catalog, stock
--   manager (지점 관리자)  own branch only: branch info, its users, safety stock
--                          and storage locations, stock (incl. 재고 실사)
--   staff   (직원)         own branch stock movements
--
-- Security model
--   * Every table has Row Level Security. Users only see rows of the branch
--     assigned to them in `profiles`; admins see every branch. Deactivated
--     profiles (active = false) see nothing.
--   * Clients never write tables directly. Every change goes through a
--     security-definer function below that checks the caller's role, so
--     every stock change is logged in `stock_movements`.
--   * Accounts are created by an admin with a login ID and password through
--     the `admin-users` Edge Function (supabase/functions/admin-users), which
--     also changes login IDs and resets passwords. Public sign-up stays off.
--     An account's email is <login_id>@<LOGIN_DOMAIN>.
--   * Nobody can change their own role, branch or active flag, and the last
--     active admin cannot be demoted or deactivated.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.app_role as enum ('staff', 'manager', 'admin');
exception when duplicate_object then null; end $$;

-- receive: 입고 · use: 시술 사용 · sale: 판매 · dispose: 폐기 · adjust: 재고 실사
-- transfer_in / transfer_out are reserved for 지점 간 이동 (later phase).
do $$ begin
  create type public.movement_type as enum
    ('receive', 'use', 'sale', 'dispose', 'adjust', 'transfer_in', 'transfer_out');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.branches (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  phone       text,
  address     text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
-- Columns added after the first version (keeps re-runs safe on older installs)
alter table public.branches add column if not exists phone   text;
alter table public.branches add column if not exists address text;
alter table public.branches add column if not exists active  boolean not null default true;
alter table public.branches add column if not exists photo_path text;  -- file in the branch-photos bucket

create table if not exists public.profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  branch_id   uuid references public.branches(id) on delete set null,
  email       text,
  login_id    text,                     -- sign-in ID, e.g. 'h001'
  full_name   text,
  role        public.app_role not null default 'staff',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table public.profiles add column if not exists email    text;
alter table public.profiles add column if not exists login_id text;
alter table public.profiles add column if not exists active   boolean not null default true;
create unique index if not exists profiles_login_id_idx on public.profiles (lower(login_id));
create index if not exists profiles_branch_idx on public.profiles (branch_id);
create index if not exists profiles_email_idx  on public.profiles (lower(email));

-- Invitations were replaced by admin-created accounts; remove them on older installs.
drop function if exists public.list_users(uuid);  -- return columns changed
drop function if exists public.invite_user(text, text, uuid, public.app_role);
drop function if exists public.cancel_invitation(uuid);
drop function if exists public.invitation_is_open(public.invitations);
drop table if exists public.invitations;

-- Product categories (shared by all branches). Products reference the name, so
-- renaming a category updates its products and a category in use can't be deleted.
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

-- Product catalog is shared by all branches; stock lives in `inventory`.
create table if not exists public.products (
  id            uuid primary key default gen_random_uuid(),
  sku           text not null unique,
  name          text not null,
  brand         text,
  category      text not null,
  unit          text not null default '개',
  cost_price    integer not null default 0 check (cost_price >= 0),   -- 매입가(원)
  retail_price  integer check (retail_price >= 0),                    -- 판매가(원)
  is_retail     boolean not null default false,                       -- 고객 판매용 여부
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- Older installs: register categories already used by products, then link them.
insert into public.categories (name, sort_order)
select c.category, 1000 + row_number() over (order by c.category)
  from (select distinct category from public.products) c
on conflict (name) do nothing;
do $$ begin
  alter table public.products
    add constraint products_category_fkey foreign key (category)
    references public.categories (name) on update cascade on delete restrict;
exception when duplicate_object then null; end $$;

create table if not exists public.inventory (
  branch_id     uuid not null references public.branches(id) on delete cascade,
  product_id    uuid not null references public.products(id) on delete cascade,
  stock         integer not null default 0 check (stock >= 0),
  safety_stock  integer not null default 0 check (safety_stock >= 0),
  location      text,                                                 -- 보관 위치
  updated_at    timestamptz not null default now(),
  primary key (branch_id, product_id)
);
-- 이 지점에서 사용 (a branch can stop using a product without affecting others)
alter table public.inventory add column if not exists in_use boolean not null default true;

create table if not exists public.stock_movements (
  id           bigint generated always as identity primary key,
  branch_id    uuid not null references public.branches(id) on delete cascade,
  product_id   uuid not null references public.products(id) on delete cascade,
  type         public.movement_type not null,
  quantity     integer not null,          -- signed change applied to stock
  stock_after  integer not null,
  unit_cost    integer,                   -- 매입가 snapshot at the time
  memo         text,
  reverts_id   bigint unique references public.stock_movements(id),
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists stock_movements_branch_created_idx
  on public.stock_movements (branch_id, created_at desc);
create index if not exists stock_movements_product_idx
  on public.stock_movements (product_id);

-- Staff (직원) records; the rest of 직원 관리 is further down.
create table if not exists public.staff (
  id                   uuid primary key default gen_random_uuid(),
  branch_id            uuid not null references public.branches(id) on delete cascade,
  name                 text not null,
  position             text not null default 'designer',
  phone                text,
  hired_on             date,
  status               text not null default 'active',
  left_on              date,
  services             text[] not null default '{}',
  days_off             smallint[] not null default '{}',
  incentive_service    numeric(4,1),
  incentive_retail     numeric(4,1),
  license_no           text,
  health_cert_expires  date,
  memo                 text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint staff_position_chk check (position in ('head_director', 'chief_deputy', 'deputy', 'senior_stylist', 'stylist', 'designer', 'staff')),
  constraint staff_status_chk check (status in ('active', 'leave', 'left')),
  constraint staff_services_chk check (services <@ array['cut', 'perm', 'color', 'clinic', 'scalp', 'styling', 'updo']::text[]),
  constraint staff_days_chk check (days_off <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  constraint staff_rates_chk check (coalesce(incentive_service, 0) between 0 and 100
                                    and coalesce(incentive_retail, 0) between 0 and 100)
);
create index if not exists staff_branch_idx on public.staff (branch_id);
alter table public.staff add column if not exists photo_path text;  -- file in the private staff-photos bucket
-- 직급 renamed (원장→대표원장, 실장→부원장, 인턴·데스크→스태프); converts older rows
alter table public.staff drop constraint if exists staff_position_chk;
update public.staff set position = case position
    when 'director' then 'head_director' when 'chief' then 'deputy'
    when 'intern' then 'staff' when 'desk' then 'staff' else position end
 where position in ('director', 'chief', 'intern', 'desk');
alter table public.staff add constraint staff_position_chk check (position in ('head_director', 'chief_deputy', 'deputy', 'senior_stylist', 'stylist', 'designer', 'staff'));
alter table public.staff add column if not exists annual_leave_days numeric(4,1);  -- 연차 일수 override (null = 자동 계산)

-- Designer who did the 시술 / made the sale, and the 판매가 at the time of a sale
alter table public.stock_movements add column if not exists staff_id uuid references public.staff(id) on delete set null;
alter table public.stock_movements add column if not exists unit_price integer;
create index if not exists stock_movements_staff_idx on public.stock_movements (staff_id, created_at);

-- ---------------------------------------------------------------------------
-- Access helpers (security definer so policies don't recurse into profiles)
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.active and p.role = 'admin'
  );
$$;

create or replace function public.is_branch_member(p_branch_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.active
      and (p.role = 'admin' or p.branch_id = p_branch_id)
  );
$$;

create or replace function public.is_branch_manager(p_branch_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.active
      and (p.role = 'admin' or (p.role = 'manager' and p.branch_id = p_branch_id))
  );
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.branches        enable row level security;
alter table public.profiles        enable row level security;
alter table public.products        enable row level security;
alter table public.inventory       enable row level security;
alter table public.stock_movements enable row level security;
alter table public.categories      enable row level security;

drop policy if exists "branches: members read" on public.branches;
create policy "branches: members read" on public.branches
  for select to authenticated using (public.is_branch_member(id));

drop policy if exists "profiles: self and branch colleagues read" on public.profiles;
create policy "profiles: self and branch colleagues read" on public.profiles
  for select to authenticated
  using (user_id = auth.uid() or (branch_id is not null and public.is_branch_member(branch_id)));

drop policy if exists "categories: signed-in users read" on public.categories;
create policy "categories: signed-in users read" on public.categories
  for select to authenticated using (true);

drop policy if exists "products: signed-in users read" on public.products;
create policy "products: signed-in users read" on public.products
  for select to authenticated using (true);

drop policy if exists "inventory: members read" on public.inventory;
create policy "inventory: members read" on public.inventory
  for select to authenticated using (public.is_branch_member(branch_id));

drop policy if exists "movements: members read" on public.stock_movements;
create policy "movements: members read" on public.stock_movements
  for select to authenticated using (public.is_branch_member(branch_id));

-- Reads only; all writes go through the functions below.
revoke all on public.branches, public.profiles, public.products, public.categories,
              public.inventory, public.stock_movements from anon, authenticated;
grant select on public.branches, public.profiles, public.products, public.categories,
                public.inventory, public.stock_movements to authenticated;

-- ---------------------------------------------------------------------------
-- Views (security_invoker: the caller's RLS applies)
-- ---------------------------------------------------------------------------
create or replace view public.inventory_view with (security_invoker = true) as
select
  i.branch_id,
  p.id            as product_id,
  p.sku, p.name, p.brand, p.category, p.unit,
  p.cost_price, p.retail_price, p.is_retail, p.active,
  i.stock, i.safety_stock, i.location, i.updated_at,
  case when i.stock = 0 then 'out'
       when i.stock <= i.safety_stock then 'low'
       else 'ok' end as status,
  i.in_use
from public.inventory i
join public.products p on p.id = i.product_id;

-- Staff names for a branch's members (the staff table itself is manager-only
-- because it holds pay rates).
create or replace function public.staff_display_name(p_staff_id uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select s.name from public.staff s
  where s.id = p_staff_id and public.is_branch_member(s.branch_id);
$$;

create or replace view public.movement_view with (security_invoker = true) as
select
  m.id, m.branch_id, m.product_id, m.type, m.quantity, m.stock_after,
  m.unit_cost, m.memo, m.reverts_id, m.created_by, m.created_at,
  p.name as product_name, p.sku, p.unit,
  pr.full_name as created_by_name,
  exists (select 1 from public.stock_movements r where r.reverts_id = m.id) as reverted,
  m.staff_id, public.staff_display_name(m.staff_id) as staff_name, m.unit_price
from public.stock_movements m
join public.products p on p.id = m.product_id
left join public.profiles pr on pr.user_id = m.created_by;

revoke all on public.inventory_view, public.movement_view from anon, authenticated;
grant select on public.inventory_view, public.movement_view to authenticated;

-- ---------------------------------------------------------------------------
-- record_movement: the only way stock changes
--   receive  → stock + qty          use / sale / dispose → stock − qty
--   adjust   → stock = qty (실사 결과, manager only)
-- Errors (message is a stable code the app translates):
--   NOT_AUTHENTICATED, NOT_BRANCH_MEMBER, MANAGER_ONLY, PRODUCT_NOT_FOUND,
--   INVALID_QUANTITY, UNSUPPORTED_TYPE, INSUFFICIENT_STOCK, NO_CHANGE
-- ---------------------------------------------------------------------------
drop function if exists public.record_movement(uuid, uuid, public.movement_type, integer, text);  -- before 담당 디자이너
create or replace function public.record_movement(
  p_branch_id  uuid,
  p_product_id uuid,
  p_type       public.movement_type,
  p_quantity   integer,
  p_memo       text default null,
  p_staff_id   uuid default null   -- 담당 디자이너 (optional; a current staff member of the branch)
)
returns public.stock_movements
language plpgsql security definer set search_path = public
as $$
declare
  v_stock  integer;
  v_delta  integer;
  v_after  integer;
  v_cost   integer;
  v_price  integer;
  v_row    public.stock_movements;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if not public.is_branch_member(p_branch_id) then
    raise exception 'NOT_BRANCH_MEMBER' using errcode = '42501';
  end if;
  if p_type in ('transfer_in', 'transfer_out') then
    raise exception 'UNSUPPORTED_TYPE' using errcode = '22023';
  end if;
  if p_type = 'adjust' and not public.is_branch_manager(p_branch_id) then
    raise exception 'MANAGER_ONLY' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity < 0 or (p_type <> 'adjust' and p_quantity = 0) then
    raise exception 'INVALID_QUANTITY' using errcode = '22023';
  end if;

  select cost_price, retail_price into v_cost, v_price from public.products where id = p_product_id and active;
  if not found then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_staff_id is not null and not exists (
       select 1 from public.staff s
       where s.id = p_staff_id and s.branch_id = p_branch_id and s.status <> 'left') then
    raise exception 'INVALID_STAFF_PICK' using errcode = '22023';
  end if;

  insert into public.inventory (branch_id, product_id)
  values (p_branch_id, p_product_id)
  on conflict do nothing;

  select stock into v_stock
  from public.inventory
  where branch_id = p_branch_id and product_id = p_product_id
  for update;

  v_delta := case p_type
               when 'receive' then p_quantity
               when 'adjust'  then p_quantity - v_stock
               else -p_quantity
             end;
  v_after := v_stock + v_delta;

  if v_after < 0 then
    raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001',
      detail = format('current stock %s', v_stock);
  end if;
  if v_delta = 0 then
    raise exception 'NO_CHANGE' using errcode = 'P0001';
  end if;

  update public.inventory
     set stock = v_after, updated_at = now()
   where branch_id = p_branch_id and product_id = p_product_id;

  insert into public.stock_movements
    (branch_id, product_id, type, quantity, stock_after, unit_cost, unit_price, staff_id, memo, created_by)
  values
    (p_branch_id, p_product_id, p_type, v_delta, v_after, v_cost,
     case when p_type = 'sale' then v_price end, p_staff_id,
     nullif(btrim(p_memo), ''), auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- revert_movement: undo by writing a reversing entry (history is never edited)
-- Allowed for the author within 10 minutes, or for a branch manager any time.
-- Errors: NOT_AUTHENTICATED, MOVEMENT_NOT_FOUND, NOT_BRANCH_MEMBER,
--         ALREADY_REVERTED, REVERT_WINDOW_PASSED, INSUFFICIENT_STOCK
-- ---------------------------------------------------------------------------
create or replace function public.revert_movement(p_movement_id bigint)
returns public.stock_movements
language plpgsql security definer set search_path = public
as $$
declare
  v_mv     public.stock_movements;
  v_stock  integer;
  v_after  integer;
  v_row    public.stock_movements;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_mv from public.stock_movements where id = p_movement_id;
  if not found or v_mv.reverts_id is not null then
    raise exception 'MOVEMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.is_branch_member(v_mv.branch_id) then
    raise exception 'NOT_BRANCH_MEMBER' using errcode = '42501';
  end if;
  if exists (select 1 from public.stock_movements where reverts_id = v_mv.id) then
    raise exception 'ALREADY_REVERTED' using errcode = 'P0001';
  end if;
  if not public.is_branch_manager(v_mv.branch_id)
     and (v_mv.created_by is distinct from auth.uid()
          or v_mv.created_at < now() - interval '10 minutes') then
    raise exception 'REVERT_WINDOW_PASSED' using errcode = '42501';
  end if;

  select stock into v_stock
  from public.inventory
  where branch_id = v_mv.branch_id and product_id = v_mv.product_id
  for update;

  v_after := v_stock - v_mv.quantity;
  if v_after < 0 then
    raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001';
  end if;

  update public.inventory
     set stock = v_after, updated_at = now()
   where branch_id = v_mv.branch_id and product_id = v_mv.product_id;

  insert into public.stock_movements
    (branch_id, product_id, type, quantity, stock_after, unit_cost, unit_price, staff_id, memo, reverts_id, created_by)
  values
    (v_mv.branch_id, v_mv.product_id, v_mv.type, -v_mv.quantity, v_after, v_mv.unit_cost,
     v_mv.unit_price, v_mv.staff_id, format('취소: #%s', v_mv.id), v_mv.id, auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;


-- ---------------------------------------------------------------------------
-- next_sku: the next free product code for a category, e.g. 클리닉 → CN-004.
-- Prefixes follow the sample catalog; other categories use P-.
-- ---------------------------------------------------------------------------
create or replace function public.next_sku(p_category text)
returns text
language sql stable security definer set search_path = public
as $$
  with pre as (
    select case btrim(p_category)
      when '염모제' then 'CL' when '펌제' then 'PM' when '샴푸·트리트먼트' then 'SH'
      when '클리닉' then 'CN' when '판매용 홈케어' then 'RT' when '소모품' then 'SP'
      when '도구' then 'TL' else 'P' end as p
  )
  select pre.p || '-' || lpad((coalesce(max(substring(pr.sku from '^' || pre.p || '-([0-9]+)$')::integer), 0) + 1)::text, 3, '0')
  from pre
  left join public.products pr on pr.sku ~ ('^' || pre.p || '-[0-9]+$')
  group by pre.p;
$$;
revoke all on function public.next_sku(text) from public, anon;
grant execute on function public.next_sku(text) to authenticated;

-- ---------------------------------------------------------------------------
-- save_product: create/update a catalog item (admin only; the catalog is shared
-- by every branch). A new product gets an inventory row in every branch.
-- p_branch_id / p_safety_stock / p_location also set that branch's settings.
-- Errors: ADMIN_ONLY, INVALID_PRODUCT, DUPLICATE_SKU, PRODUCT_NOT_FOUND,
--         CATEGORY_NOT_FOUND
-- ---------------------------------------------------------------------------
create or replace function public.save_product(
  p_branch_id     uuid,
  p_product_id    uuid,          -- null → create
  p_sku           text,          -- blank on create → next code for the category
  p_name          text,
  p_brand         text,
  p_category      text,
  p_unit          text,
  p_cost_price    integer,
  p_retail_price  integer,
  p_is_retail     boolean,
  p_safety_stock  integer,
  p_location      text,
  p_active        boolean default true
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  -- New products: admins, or a branch manager (registered for every branch).
  -- Changing an existing product (shared by all branches): admins only.
  -- Changing an existing product: admins change everything; a branch manager
  -- may change the name, prices and 고객 판매용 flag (shared by all branches).
  if p_product_id is null or not public.is_admin() then
    if not (public.is_admin() or (p_branch_id is not null and public.is_branch_manager(p_branch_id))) then
      raise exception 'MANAGER_ONLY' using errcode = '42501';
    end if;
  end if;
  -- A new product without a code gets the next one for its category.
  if p_product_id is null and coalesce(btrim(p_sku), '') = '' and coalesce(btrim(p_category), '') <> '' then
    perform pg_advisory_xact_lock(hashtext('public.next_sku'));  -- one code at a time
    p_sku := public.next_sku(p_category);
  end if;
  if coalesce(btrim(p_sku), '') = '' or coalesce(btrim(p_name), '') = ''
     or coalesce(btrim(p_category), '') = '' or coalesce(btrim(p_unit), '') = ''
     or coalesce(p_cost_price, 0) < 0 or coalesce(p_retail_price, 0) < 0
     or coalesce(p_safety_stock, 0) < 0 then
    raise exception 'INVALID_PRODUCT' using errcode = '22023';
  end if;

  begin
    if p_product_id is null then
      insert into public.products
        (sku, name, brand, category, unit, cost_price, retail_price, is_retail, active)
      values
        (upper(btrim(p_sku)), btrim(p_name), nullif(btrim(p_brand), ''), btrim(p_category),
         btrim(p_unit), coalesce(p_cost_price, 0), p_retail_price, coalesce(p_is_retail, false),
         coalesce(p_active, true))
      returning id into v_id;

      insert into public.inventory (branch_id, product_id)
      select b.id, v_id from public.branches b
      on conflict do nothing;
    elsif not public.is_admin() then
      update public.products
         set name = btrim(p_name), cost_price = coalesce(p_cost_price, 0),
             retail_price = p_retail_price, is_retail = coalesce(p_is_retail, false)
       where id = p_product_id
      returning id into v_id;
      if v_id is null then
        raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
      end if;
    else
      update public.products
         set sku = upper(btrim(p_sku)), name = btrim(p_name), brand = nullif(btrim(p_brand), ''),
             category = btrim(p_category), unit = btrim(p_unit),
             cost_price = coalesce(p_cost_price, 0), retail_price = p_retail_price,
             is_retail = coalesce(p_is_retail, false), active = coalesce(p_active, true)
       where id = p_product_id
      returning id into v_id;
      if v_id is null then
        raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
      end if;
    end if;
  exception
    when unique_violation then
      raise exception 'DUPLICATE_SKU' using errcode = '23505';
    when foreign_key_violation then
      raise exception 'CATEGORY_NOT_FOUND' using errcode = 'P0002';
  end;

  if p_branch_id is not null then
    perform public.set_branch_item(p_branch_id, v_id, coalesce(p_safety_stock, 0), p_location);
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_branch_item: a branch's own settings for a product (manager of that
-- branch, or admin). Errors: MANAGER_ONLY, INVALID_PRODUCT, PRODUCT_NOT_FOUND
-- ---------------------------------------------------------------------------
create or replace function public.set_branch_item(
  p_branch_id     uuid,
  p_product_id    uuid,
  p_safety_stock  integer,
  p_location      text
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_branch_manager(p_branch_id) then
    raise exception 'MANAGER_ONLY' using errcode = '42501';
  end if;
  if p_safety_stock is null or p_safety_stock < 0 then
    raise exception 'INVALID_PRODUCT' using errcode = '22023';
  end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.inventory (branch_id, product_id, safety_stock, location)
  values (p_branch_id, p_product_id, p_safety_stock, nullif(btrim(p_location), ''))
  on conflict (branch_id, product_id) do update
    set safety_stock = excluded.safety_stock,
        location     = excluded.location,
        updated_at   = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- set_item_in_use: 사용 중 on/off for one branch (anyone at that branch).
-- The catalog-wide 사용 flag on products stays with admins (save_product).
-- Errors: NOT_BRANCH_MEMBER, PRODUCT_NOT_FOUND
-- ---------------------------------------------------------------------------
create or replace function public.set_item_in_use(p_branch_id uuid, p_product_id uuid, p_in_use boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_branch_id is null or not public.is_branch_member(p_branch_id) then
    raise exception 'NOT_BRANCH_MEMBER' using errcode = '42501';
  end if;
  update public.inventory
     set in_use = coalesce(p_in_use, true), updated_at = now()
   where branch_id = p_branch_id and product_id = p_product_id;
  if not found then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.set_item_in_use(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_item_in_use(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- save_branch: admins create/update any branch; a branch manager may update
-- their own branch's name, phone and address (code and active stay as they are).
-- A new branch gets an inventory row for every product.
-- Errors: FORBIDDEN, INVALID_BRANCH, DUPLICATE_BRANCH_CODE, BRANCH_NOT_FOUND
-- ---------------------------------------------------------------------------
create or replace function public.save_branch(
  p_branch_id  uuid,          -- null → create (admin only)
  p_code       text,
  p_name       text,
  p_phone      text,
  p_address    text,
  p_active     boolean default true
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id    uuid;
  v_admin boolean := public.is_admin();
begin
  if not v_admin and (p_branch_id is null or not public.is_branch_manager(p_branch_id)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if coalesce(btrim(p_name), '') = ''
     or (v_admin and coalesce(upper(btrim(p_code)), '') !~ '^[A-Z0-9-]{2,12}$') then
    raise exception 'INVALID_BRANCH' using errcode = '22023';
  end if;

  begin
    if p_branch_id is null then
      insert into public.branches (code, name, phone, address, active)
      values (upper(btrim(p_code)), btrim(p_name), nullif(btrim(p_phone), ''),
              nullif(btrim(p_address), ''), coalesce(p_active, true))
      returning id into v_id;

      insert into public.inventory (branch_id, product_id)
      select v_id, p.id from public.products p
      on conflict do nothing;
    elsif v_admin then
      update public.branches
         set code = upper(btrim(p_code)), name = btrim(p_name),
             phone = nullif(btrim(p_phone), ''), address = nullif(btrim(p_address), ''),
             active = coalesce(p_active, true)
       where id = p_branch_id
      returning id into v_id;
    else
      update public.branches
         set name = btrim(p_name), phone = nullif(btrim(p_phone), ''),
             address = nullif(btrim(p_address), '')
       where id = p_branch_id
      returning id into v_id;
    end if;
  exception when unique_violation then
    raise exception 'DUPLICATE_BRANCH_CODE' using errcode = '23505';
  end;

  if v_id is null then
    raise exception 'BRANCH_NOT_FOUND' using errcode = 'P0002';
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- list_users: admins pass null for every user (including unassigned ones)
-- or a branch id; managers must pass their own branch id.
-- Errors: FORBIDDEN
-- ---------------------------------------------------------------------------
create or replace function public.list_users(p_branch_id uuid default null)
returns table (
  user_id          uuid,
  email            text,
  login_id         text,
  full_name        text,
  role             public.app_role,
  branch_id        uuid,
  branch_name      text,
  active           boolean,
  created_at       timestamptz,
  last_sign_in_at  timestamptz
)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
begin
  if not (public.is_admin() or (p_branch_id is not null and public.is_branch_manager(p_branch_id))) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  return query
    select p.user_id, coalesce(p.email, u.email::text), p.login_id, p.full_name, p.role, p.branch_id,
           b.name, p.active, p.created_at, u.last_sign_in_at
      from public.profiles p
      join auth.users u on u.id = p.user_id
      left join public.branches b on b.id = p.branch_id
     where p_branch_id is null or p.branch_id = p_branch_id
     order by b.code nulls first, p.role desc, p.full_name;
end;
$$;

-- ---------------------------------------------------------------------------
-- update_user: change another user's name, branch, role and active flag.
--   admin   → anyone; 'admin' role means no branch. Cannot remove the last
--             active admin.
--   manager → users of their own branch who are not admins; role staff or
--             manager; branch may only stay the same or be cleared (release).
--   Anyone may change only their own name.
-- Errors: USER_NOT_FOUND, CANNOT_CHANGE_SELF, FORBIDDEN, LAST_ADMIN,
--         BRANCH_NOT_FOUND
-- ---------------------------------------------------------------------------
create or replace function public.update_user(
  p_user_id    uuid,
  p_full_name  text,
  p_branch_id  uuid,
  p_role       public.app_role,
  p_active     boolean
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_target public.profiles;
  v_branch uuid := case when p_role = 'admin' then null else p_branch_id end;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  select * into v_target from public.profiles where user_id = p_user_id;
  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_user_id = auth.uid() then
    if v_target.role is distinct from p_role
       or v_target.branch_id is distinct from v_branch
       or v_target.active is distinct from p_active then
      raise exception 'CANNOT_CHANGE_SELF' using errcode = '42501';
    end if;
  elsif public.is_admin() then
    if v_branch is not null and not exists (select 1 from public.branches where id = v_branch) then
      raise exception 'BRANCH_NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_target.role = 'admin' and v_target.active
       and (p_role <> 'admin' or not p_active)
       and (select count(*) from public.profiles where role = 'admin' and active) <= 1 then
      raise exception 'LAST_ADMIN' using errcode = '42501';
    end if;
  else
    if v_target.role = 'admin'
       or v_target.branch_id is null
       or not public.is_branch_manager(v_target.branch_id)
       or p_role not in ('staff', 'manager')
       or (v_branch is not null and v_branch <> v_target.branch_id) then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
  end if;

  update public.profiles
     set full_name = coalesce(nullif(btrim(p_full_name), ''), full_name),
         branch_id = v_branch,
         role      = p_role,
         active    = p_active
   where user_id = p_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Categories (admin only). Renaming cascades to products through the foreign
-- key; a category that still has products can't be deleted.
-- Errors: ADMIN_ONLY, INVALID_CATEGORY, DUPLICATE_CATEGORY, CATEGORY_NOT_FOUND,
--         CATEGORY_IN_USE
-- ---------------------------------------------------------------------------
create or replace function public.save_category(p_category_id uuid, p_name text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_id   uuid;
begin
  if not public.is_admin() then
    raise exception 'ADMIN_ONLY' using errcode = '42501';
  end if;
  if v_name = '' or length(v_name) > 30 then
    raise exception 'INVALID_CATEGORY' using errcode = '22023';
  end if;

  begin
    if p_category_id is null then
      insert into public.categories (name, sort_order)
      values (v_name, coalesce((select max(sort_order) from public.categories), 0) + 10)
      returning id into v_id;
    else
      update public.categories set name = v_name where id = p_category_id
      returning id into v_id;
      if v_id is null then
        raise exception 'CATEGORY_NOT_FOUND' using errcode = 'P0002';
      end if;
    end if;
  exception when unique_violation then
    raise exception 'DUPLICATE_CATEGORY' using errcode = '23505';
  end;
  return v_id;
end;
$$;

create or replace function public.delete_category(p_category_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_name  text;
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'ADMIN_ONLY' using errcode = '42501';
  end if;
  select name into v_name from public.categories where id = p_category_id;
  if v_name is null then
    raise exception 'CATEGORY_NOT_FOUND' using errcode = 'P0002';
  end if;
  select count(*) into v_count from public.products where category = v_name;
  if v_count > 0 then
    raise exception 'CATEGORY_IN_USE' using errcode = '23503',
      detail = format('%s products', v_count);
  end if;
  delete from public.categories where id = p_category_id;
end;
$$;

-- p_ids lists category ids in the new order; ids not listed keep their place after.
create or replace function public.reorder_categories(p_ids uuid[])
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'ADMIN_ONLY' using errcode = '42501';
  end if;
  update public.categories c
     set sort_order = x.ord * 10
    from unnest(p_ids) with ordinality as x(id, ord)
   where c.id = x.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Branch photos. The file goes to the public Storage bucket `branch-photos`
-- under "<branch id>/<file>" (see the storage policies below); this function
-- records it on the branch and returns the previous path so the app can delete
-- the old file. Pass null to remove the photo. Admins, or the branch's manager.
-- Errors: FORBIDDEN, INVALID_PHOTO, BRANCH_NOT_FOUND
-- ---------------------------------------------------------------------------
create or replace function public.set_branch_photo(p_branch_id uuid, p_path text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_old text;
begin
  if p_branch_id is null or not public.is_branch_manager(p_branch_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_path is not null
     and p_path !~ ('^' || p_branch_id::text || '/[A-Za-z0-9._-]{1,80}$') then
    raise exception 'INVALID_PHOTO' using errcode = '22023';
  end if;
  select photo_path into v_old from public.branches where id = p_branch_id for update;
  if not found then
    raise exception 'BRANCH_NOT_FOUND' using errcode = 'P0002';
  end if;
  update public.branches set photo_path = p_path where id = p_branch_id;
  return v_old;
end;
$$;

-- Photos for the sign-in screen, readable before sign-in: only the name and
-- photo of operating branches that have one.
create or replace function public.login_photos()
returns table (id uuid, name text, photo_path text)
language sql stable security definer set search_path = public
as $$
  select b.id, b.name, b.photo_path
  from public.branches b
  where b.active and b.photo_path is not null
  order by b.code;
$$;

-- ---------------------------------------------------------------------------
-- Staff (직원 관리): everyone who works at a branch, with or without an app
-- account. Holds pay rates, so only admins and the branch's manager can see it.
--   position  head_director 대표원장 · chief_deputy 수석 부원장 · deputy 부원장 ·
--             senior_stylist 수석 스타일리스트 · stylist 스타일리스트 · designer 디자이너 · staff 스태프
--   status    active 재직 · leave 휴직 · left 퇴사 (records are kept, not deleted)
--   services  cut · perm · color · clinic · scalp · styling · updo
--   days_off  regular weekly days off, 0 = Sunday … 6 = Saturday
--   health_cert_expires  건강진단결과서(보건증) expiry — renewed every year
-- ---------------------------------------------------------------------------

alter table public.staff enable row level security;
drop policy if exists "staff: managers read" on public.staff;
create policy "staff: managers read" on public.staff
  for select to authenticated using (public.is_branch_manager(branch_id));
revoke all on public.staff from anon, authenticated;
grant select on public.staff to authenticated;

-- save_staff: create (p_id null) or update a staff record. Admins, or the
-- manager of the branch (and, on update, of the record's current branch).
-- Leaving (status 'left') without a date records today.
-- Errors: FORBIDDEN, STAFF_NOT_FOUND, INVALID_STAFF_NAME / _POSITION / _RATE / _DATES / _LEAVE, INVALID_STAFF
drop function if exists public.save_staff(uuid, uuid, text, text, text, date, text, date, text[], integer[], numeric, numeric, text, date, text);
create or replace function public.save_staff(
  p_id                  uuid,
  p_branch_id           uuid,
  p_name                text,
  p_position            text,
  p_phone               text,
  p_hired_on            date,
  p_status              text,
  p_left_on             date,
  p_services            text[],
  p_days_off            integer[],
  p_incentive_service   numeric,
  p_incentive_retail    numeric,
  p_license_no          text,
  p_health_cert_expires date,
  p_memo                text,
  p_annual_leave_days   numeric default null   -- null = 입사일 기준 자동 계산
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id     uuid;
  v_branch uuid;
  v_status text := coalesce(p_status, 'active');
begin
  if p_branch_id is null or not public.is_branch_manager(p_branch_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_id is not null then
    select branch_id into v_branch from public.staff where id = p_id;
    if not found then
      raise exception 'STAFF_NOT_FOUND' using errcode = 'P0002';
    end if;
    if not public.is_branch_manager(v_branch) then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
  end if;
  -- One code per problem so the app can point at the field
  if coalesce(btrim(p_name), '') = '' or length(btrim(p_name)) > 30 then
    raise exception 'INVALID_STAFF_NAME' using errcode = '22023';
  end if;
  if coalesce(p_position, '') not in ('head_director', 'chief_deputy', 'deputy', 'senior_stylist', 'stylist', 'designer', 'staff') then
    raise exception 'INVALID_STAFF_POSITION' using errcode = '22023';
  end if;
  if coalesce(p_incentive_service, 0) not between 0 and 100 or coalesce(p_incentive_retail, 0) not between 0 and 100 then
    raise exception 'INVALID_STAFF_RATE' using errcode = '22023';
  end if;
  if p_left_on is not null and p_hired_on is not null and p_left_on < p_hired_on then
    raise exception 'INVALID_STAFF_DATES' using errcode = '22023';
  end if;
  if coalesce(p_annual_leave_days, 0) not between 0 and 60 then
    raise exception 'INVALID_STAFF_LEAVE' using errcode = '22023';
  end if;
  if v_status not in ('active', 'leave', 'left')
     or not coalesce(p_services, '{}') <@ array['cut', 'perm', 'color', 'clinic', 'scalp', 'styling', 'updo']::text[]
     or not coalesce(p_days_off, '{}') <@ array[0, 1, 2, 3, 4, 5, 6] then
    raise exception 'INVALID_STAFF' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.staff (branch_id, name) values (p_branch_id, btrim(p_name))
    returning id into v_id;
  else
    v_id := p_id;
  end if;
  update public.staff
     set branch_id = p_branch_id,
         name = btrim(p_name),
         position = p_position,
         phone = nullif(btrim(p_phone), ''),
         hired_on = p_hired_on,
         status = v_status,
         left_on = case when v_status = 'left' then coalesce(p_left_on, current_date) end,
         services = coalesce((select array_agg(distinct s order by s) from unnest(p_services) s), '{}'),
         days_off = coalesce((select array_agg(distinct d::smallint order by d::smallint) from unnest(p_days_off) d), '{}'),
         incentive_service = p_incentive_service,
         incentive_retail = p_incentive_retail,
         license_no = nullif(btrim(p_license_no), ''),
         health_cert_expires = p_health_cert_expires,
         memo = nullif(btrim(p_memo), ''),
         annual_leave_days = p_annual_leave_days,
         updated_at = now()
   where id = v_id;
  return v_id;
end;
$$;

-- delete_staff: for records entered by mistake (people who leave are marked 퇴사).
-- Returns the photo path (if any) so the app can delete the file.
drop function if exists public.delete_staff(uuid);  -- older version returned void
create or replace function public.delete_staff(p_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_branch uuid;
  v_path   text;
begin
  select branch_id into v_branch from public.staff where id = p_id;
  if not found then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.is_branch_manager(v_branch) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  delete from public.staff where id = p_id returning photo_path into v_path;
  return v_path;
end;
$$;

-- set_staff_photo: records a photo uploaded to staff-photos under
-- "<branch id>/<staff id>/<file>" and returns the previous path for cleanup.
-- Pass null to remove. Admins, or the manager of the staff member's branch.
-- Errors: FORBIDDEN, INVALID_PHOTO, STAFF_NOT_FOUND
create or replace function public.set_staff_photo(p_staff_id uuid, p_path text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_branch uuid;
  v_old    text;
begin
  select branch_id, photo_path into v_branch, v_old from public.staff where id = p_staff_id for update;
  if not found then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.is_branch_manager(v_branch) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_path is not null
     and p_path !~ ('^' || v_branch::text || '/' || p_staff_id::text || '/[A-Za-z0-9._-]{1,80}$') then
    raise exception 'INVALID_PHOTO' using errcode = '22023';
  end if;
  update public.staff set photo_path = p_path, updated_at = now() where id = p_staff_id;
  return v_old;
end;
$$;

revoke all on function public.save_staff(uuid, uuid, text, text, text, date, text, date, text[], integer[], numeric, numeric, text, date, text, numeric) from public, anon;
revoke all on function public.delete_staff(uuid) from public, anon;
grant execute on function public.save_staff(uuid, uuid, text, text, text, date, text, date, text[], integer[], numeric, numeric, text, date, text, numeric) to authenticated;
grant execute on function public.delete_staff(uuid) to authenticated;
revoke all on function public.set_staff_photo(uuid, text) from public, anon;
grant execute on function public.set_staff_photo(uuid, text) to authenticated;

-- Names for everyone at the branch (근무표, 담당 디자이너 선택). No pay data.
create or replace function public.list_staff_names(p_branch_id uuid)
returns table (id uuid, name text, "position" text, status text, days_off smallint[], hired_on date, left_on date)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_branch_member(p_branch_id) then
    raise exception 'NOT_BRANCH_MEMBER' using errcode = '42501';
  end if;
  return query
    select s.id, s.name, s.position, s.status, s.days_off, s.hired_on, s.left_on
    from public.staff s where s.branch_id = p_branch_id
    order by s.name;
end;
$$;

-- ---------------------------------------------------------------------------
-- 근무표: exceptions to the regular weekly days off, one per person per day.
--   off 추가 휴무 · work 대체 근무 (works on a regular day off) · annual 연차 ·
--   half 반차 · sick 병가 · edu 교육
-- Everyone at the branch can read it; the manager (or an admin) edits it.
-- ---------------------------------------------------------------------------
create table if not exists public.staff_schedule (
  id          bigint generated always as identity primary key,
  branch_id   uuid not null references public.branches(id) on delete cascade,
  staff_id    uuid not null references public.staff(id) on delete cascade,
  day         date not null,
  kind        text not null,
  memo        text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint staff_schedule_kind_chk check (kind in ('off', 'work', 'annual', 'half', 'sick', 'edu')),
  constraint staff_schedule_day_key unique (staff_id, day)
);
create index if not exists staff_schedule_branch_day_idx on public.staff_schedule (branch_id, day);
alter table public.staff_schedule enable row level security;
drop policy if exists "schedule: members read" on public.staff_schedule;
create policy "schedule: members read" on public.staff_schedule
  for select to authenticated using (public.is_branch_member(branch_id));
revoke all on public.staff_schedule from anon, authenticated;
grant select on public.staff_schedule to authenticated;

-- set_schedule: p_kind null clears the day. Errors: FORBIDDEN, STAFF_NOT_FOUND, INVALID_SCHEDULE
create or replace function public.set_schedule(p_staff_id uuid, p_day date, p_kind text, p_memo text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_branch uuid;
begin
  select branch_id into v_branch from public.staff where id = p_staff_id;
  if not found then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.is_branch_manager(v_branch) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_day is null or (p_kind is not null and p_kind not in ('off', 'work', 'annual', 'half', 'sick', 'edu')) then
    raise exception 'INVALID_SCHEDULE' using errcode = '22023';
  end if;
  if p_kind is null then
    delete from public.staff_schedule where staff_id = p_staff_id and day = p_day;
  else
    insert into public.staff_schedule (branch_id, staff_id, day, kind, memo, created_by)
    values (v_branch, p_staff_id, p_day, p_kind, nullif(btrim(p_memo), ''), auth.uid())
    on conflict (staff_id, day) do update
      set kind = excluded.kind, memo = excluded.memo, created_by = excluded.created_by, created_at = now();
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 실적·정산 (monthly, per branch; manager or admin)
--   시술 매출·건수·조정액 are entered from the POS; 제품 판매 and 재료 사용액
--   come from stock movements tagged with the designer (Korea time months).
--   Incentive = 시술 매출 × 시술율 + 제품 판매 × 판매율 + 조정액 (원 단위 반올림).
--   Confirming a month stores the figures so later changes don't alter it;
--   only an admin can reopen a confirmed month.
-- ---------------------------------------------------------------------------
create table if not exists public.staff_monthly (
  staff_id        uuid not null references public.staff(id) on delete cascade,
  month           date not null,              -- first day of the month
  branch_id       uuid not null references public.branches(id) on delete cascade,
  service_sales   bigint not null default 0,
  service_count   integer not null default 0,
  adjustment      bigint not null default 0,
  memo            text,
  -- stored when the month is confirmed
  retail_sales_snap   bigint,
  retail_qty_snap     integer,
  material_cost_snap  bigint,
  rate_service_snap   numeric(4,1),
  rate_retail_snap    numeric(4,1),
  updated_at      timestamptz not null default now(),
  primary key (staff_id, month),
  constraint staff_monthly_amounts_chk check (service_sales >= 0 and service_count >= 0)
);
create table if not exists public.payroll_months (
  branch_id     uuid not null references public.branches(id) on delete cascade,
  month         date not null,
  confirmed_at  timestamptz not null default now(),
  confirmed_by  uuid references auth.users(id) on delete set null,
  primary key (branch_id, month)
);
alter table public.staff_monthly enable row level security;
alter table public.payroll_months enable row level security;
drop policy if exists "staff_monthly: managers read" on public.staff_monthly;
create policy "staff_monthly: managers read" on public.staff_monthly
  for select to authenticated using (public.is_branch_manager(branch_id));
drop policy if exists "payroll_months: managers read" on public.payroll_months;
create policy "payroll_months: managers read" on public.payroll_months
  for select to authenticated using (public.is_branch_manager(branch_id));
revoke all on public.staff_monthly, public.payroll_months from anon, authenticated;
grant select on public.staff_monthly, public.payroll_months to authenticated;

-- save_staff_month: 시술 매출·건수·조정액·메모. Errors: FORBIDDEN, STAFF_NOT_FOUND, INVALID_AMOUNT, MONTH_CONFIRMED
create or replace function public.save_staff_month(
  p_staff_id uuid, p_month date, p_service_sales bigint, p_service_count integer, p_adjustment bigint, p_memo text
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_branch uuid;
  v_month  date := date_trunc('month', p_month)::date;
begin
  select branch_id into v_branch from public.staff where id = p_staff_id;
  if not found then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.is_branch_manager(v_branch) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_month is null or coalesce(p_service_sales, 0) < 0 or coalesce(p_service_count, 0) < 0
     or abs(coalesce(p_adjustment, 0)) > 100000000 or coalesce(p_service_sales, 0) > 10000000000 then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;
  if exists (select 1 from public.payroll_months where branch_id = v_branch and month = v_month) then
    raise exception 'MONTH_CONFIRMED' using errcode = 'P0001';
  end if;
  insert into public.staff_monthly (staff_id, month, branch_id, service_sales, service_count, adjustment, memo)
  values (p_staff_id, v_month, v_branch, coalesce(p_service_sales, 0), coalesce(p_service_count, 0),
          coalesce(p_adjustment, 0), nullif(btrim(p_memo), ''))
  on conflict (staff_id, month) do update
    set service_sales = excluded.service_sales, service_count = excluded.service_count,
        adjustment = excluded.adjustment, memo = excluded.memo, updated_at = now();
end;
$$;

-- staff_month_report: one row per person who worked that month (or has figures).
create or replace function public.staff_month_report(p_branch_id uuid, p_month date)
returns table (
  staff_id uuid, name text, "position" text, status text,
  rate_service numeric, rate_retail numeric,
  service_sales bigint, service_count integer, adjustment bigint, memo text,
  retail_sales bigint, retail_qty integer, material_cost bigint,
  incentive_service bigint, incentive_retail bigint, incentive_total bigint,
  confirmed boolean
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_month     date := date_trunc('month', p_month)::date;
  v_from      timestamptz := (date_trunc('month', p_month)::date)::timestamp at time zone 'Asia/Seoul';
  v_to        timestamptz := ((date_trunc('month', p_month) + interval '1 month')::date)::timestamp at time zone 'Asia/Seoul';
  v_confirmed boolean;
begin
  if p_branch_id is null or not public.is_branch_manager(p_branch_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  v_confirmed := exists (select 1 from public.payroll_months pm where pm.branch_id = p_branch_id and pm.month = v_month);
  return query
  with mv as (
    select m.staff_id as sid,
           sum(case when m.type = 'sale' then -m.quantity * coalesce(m.unit_price, p.retail_price, 0) else 0 end)::bigint as r_sales,
           sum(case when m.type = 'sale' then -m.quantity else 0 end)::integer as r_qty,
           sum(case when m.type = 'use' then -m.quantity * coalesce(m.unit_cost, 0) else 0 end)::bigint as mat
    from public.stock_movements m
    join public.products p on p.id = m.product_id
    where m.branch_id = p_branch_id and m.staff_id is not null
      and m.created_at >= v_from and m.created_at < v_to
    group by m.staff_id
  ), base as (
    select s.id, s.name, s.position, s.status,
           case when v_confirmed then sm.rate_service_snap else s.incentive_service end as rs,
           case when v_confirmed then sm.rate_retail_snap else s.incentive_retail end as rr,
           coalesce(sm.service_sales, 0) as ss, coalesce(sm.service_count, 0) as sc,
           coalesce(sm.adjustment, 0) as adj, sm.memo as mm,
           case when v_confirmed then coalesce(sm.retail_sales_snap, 0) else coalesce(mv.r_sales, 0) end as rsales,
           case when v_confirmed then coalesce(sm.retail_qty_snap, 0) else coalesce(mv.r_qty, 0) end as rqty,
           case when v_confirmed then coalesce(sm.material_cost_snap, 0) else coalesce(mv.mat, 0) end as mcost
    from public.staff s
    left join public.staff_monthly sm on sm.staff_id = s.id and sm.month = v_month
    left join mv on mv.sid = s.id
    where s.branch_id = p_branch_id
      and (case when v_confirmed then sm.staff_id is not null
                else (sm.staff_id is not null or mv.sid is not null
                      or ((s.hired_on is null or s.hired_on < (v_month + interval '1 month')::date)
                          and (s.status <> 'left' or s.left_on is null or s.left_on >= v_month))) end)
  )
  select b.id, b.name, b.position, b.status, b.rs, b.rr, b.ss, b.sc, b.adj, b.mm,
         b.rsales, b.rqty, b.mcost,
         round(b.ss * coalesce(b.rs, 0) / 100)::bigint,
         round(b.rsales * coalesce(b.rr, 0) / 100)::bigint,
         (round(b.ss * coalesce(b.rs, 0) / 100) + round(b.rsales * coalesce(b.rr, 0) / 100) + b.adj)::bigint,
         v_confirmed
  from base b
  order by case b.position when 'head_director' then 0 when 'chief_deputy' then 1 when 'deputy' then 2 when 'senior_stylist' then 3 when 'stylist' then 4 when 'designer' then 5 else 6 end, b.name;
end;
$$;

-- confirm_payroll: stores the month's figures and locks it. Errors: FORBIDDEN, MONTH_CONFIRMED
create or replace function public.confirm_payroll(p_branch_id uuid, p_month date)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
begin
  if p_branch_id is null or not public.is_branch_manager(p_branch_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if exists (select 1 from public.payroll_months where branch_id = p_branch_id and month = v_month) then
    raise exception 'MONTH_CONFIRMED' using errcode = 'P0001';
  end if;
  insert into public.staff_monthly as sm (staff_id, month, branch_id, retail_sales_snap, retail_qty_snap,
                                          material_cost_snap, rate_service_snap, rate_retail_snap)
  select r.staff_id, v_month, p_branch_id, r.retail_sales, r.retail_qty, r.material_cost, r.rate_service, r.rate_retail
  from public.staff_month_report(p_branch_id, v_month) r
  on conflict (staff_id, month) do update
    set retail_sales_snap = excluded.retail_sales_snap, retail_qty_snap = excluded.retail_qty_snap,
        material_cost_snap = excluded.material_cost_snap, rate_service_snap = excluded.rate_service_snap,
        rate_retail_snap = excluded.rate_retail_snap, updated_at = now();
  insert into public.payroll_months (branch_id, month, confirmed_by) values (p_branch_id, v_month, auth.uid());
end;
$$;

-- reopen_payroll: admin only; the month goes back to live figures.
create or replace function public.reopen_payroll(p_branch_id uuid, p_month date)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
begin
  if not public.is_admin() then
    raise exception 'ADMIN_ONLY' using errcode = '42501';
  end if;
  delete from public.payroll_months where branch_id = p_branch_id and month = v_month;
  update public.staff_monthly
     set retail_sales_snap = null, retail_qty_snap = null, material_cost_snap = null,
         rate_service_snap = null, rate_retail_snap = null, updated_at = now()
   where branch_id = p_branch_id and month = v_month;
end;
$$;

revoke all on function public.list_staff_names(uuid) from public, anon;
revoke all on function public.set_schedule(uuid, date, text, text) from public, anon;
revoke all on function public.save_staff_month(uuid, date, bigint, integer, bigint, text) from public, anon;
revoke all on function public.staff_month_report(uuid, date) from public, anon;
revoke all on function public.confirm_payroll(uuid, date) from public, anon;
revoke all on function public.reopen_payroll(uuid, date) from public, anon;
revoke all on function public.staff_display_name(uuid) from public, anon;
grant execute on function public.list_staff_names(uuid) to authenticated;
grant execute on function public.set_schedule(uuid, date, text, text) to authenticated;
grant execute on function public.save_staff_month(uuid, date, bigint, integer, bigint, text) to authenticated;
grant execute on function public.staff_month_report(uuid, date) to authenticated;
grant execute on function public.confirm_payroll(uuid, date) to authenticated;
grant execute on function public.reopen_payroll(uuid, date) to authenticated;
grant execute on function public.staff_display_name(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Function privileges: signed-in users only (each function checks the role)
-- ---------------------------------------------------------------------------
revoke all on function public.record_movement(uuid, uuid, public.movement_type, integer, text, uuid) from public, anon;
revoke all on function public.revert_movement(bigint) from public, anon;
revoke all on function public.save_product(uuid, uuid, text, text, text, text, text, integer, integer, boolean, integer, text, boolean) from public, anon;
revoke all on function public.set_branch_item(uuid, uuid, integer, text) from public, anon;
revoke all on function public.save_branch(uuid, text, text, text, text, boolean) from public, anon;
revoke all on function public.save_category(uuid, text) from public, anon;
revoke all on function public.delete_category(uuid) from public, anon;
revoke all on function public.reorder_categories(uuid[]) from public, anon;
revoke all on function public.list_users(uuid) from public, anon;
revoke all on function public.update_user(uuid, text, uuid, public.app_role, boolean) from public, anon;
revoke all on function public.set_branch_photo(uuid, text) from public, anon;
revoke all on function public.login_photos() from public;
grant execute on function public.record_movement(uuid, uuid, public.movement_type, integer, text, uuid) to authenticated;
grant execute on function public.revert_movement(bigint) to authenticated;
grant execute on function public.save_product(uuid, uuid, text, text, text, text, text, integer, integer, boolean, integer, text, boolean) to authenticated;
grant execute on function public.set_branch_item(uuid, uuid, integer, text) to authenticated;
grant execute on function public.save_branch(uuid, text, text, text, text, boolean) to authenticated;
grant execute on function public.save_category(uuid, text) to authenticated;
grant execute on function public.delete_category(uuid) to authenticated;
grant execute on function public.reorder_categories(uuid[]) to authenticated;
grant execute on function public.list_users(uuid) to authenticated;
grant execute on function public.update_user(uuid, text, uuid, public.app_role, boolean) to authenticated;
grant execute on function public.set_branch_photo(uuid, text) to authenticated;
grant execute on function public.login_photos() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage bucket for branch photos. Public: anyone with the URL can view a
-- photo (the sign-in screen shows them). Uploading and deleting follow the
-- same rule as set_branch_photo: admins, or the manager of the branch whose
-- id is the first folder of the file name. JPG/PNG/WEBP up to 5 MB.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branch-photos', 'branch-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- "<uuid>/file.jpg" → the uuid; anything else → null
create or replace function public.photo_branch_id(p_name text)
returns uuid
language sql immutable
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;

drop policy if exists "branch photos: signed-in read" on storage.objects;
create policy "branch photos: signed-in read" on storage.objects
  for select to authenticated using (bucket_id = 'branch-photos');

drop policy if exists "branch photos: managers upload" on storage.objects;
create policy "branch photos: managers upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'branch-photos'
              and public.photo_branch_id(name) is not null
              and public.is_branch_manager(public.photo_branch_id(name)));

drop policy if exists "branch photos: managers delete" on storage.objects;
create policy "branch photos: managers delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'branch-photos'
         and public.photo_branch_id(name) is not null
         and public.is_branch_manager(public.photo_branch_id(name)));

-- ---------------------------------------------------------------------------
-- New auth users get a profile with no branch (no data access). The
-- admin-users Edge Function then sets role and branch; accounts added in the
-- Supabase dashboard are assigned with SQL (see README). login_id is the part
-- of the email before '@' unless another profile already uses it.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_login text := lower(split_part(new.email, '@', 1));
begin
  insert into public.profiles (user_id, email, login_id, full_name)
  values (
    new.id,
    lower(new.email),
    case when exists (select 1 from public.profiles where lower(login_id) = v_login) then null else v_login end,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), v_login)
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill email / login_id for profiles created by older versions.
update public.profiles p
   set email = lower(u.email)
  from auth.users u
 where u.id = p.user_id and p.email is null;
update public.profiles p
   set login_id = lower(split_part(p.email, '@', 1))
 where p.login_id is null and p.email is not null
   and not exists (select 1 from public.profiles o
                    where o.user_id <> p.user_id and lower(o.login_id) = lower(split_part(p.email, '@', 1)));

-- Private bucket for staff photos (personal data): no public URLs. The app
-- shows them through short-lived signed links. Reading, uploading and deleting
-- are limited to admins and the manager of the branch in the first folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('staff-photos', 'staff-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "staff photos: managers read" on storage.objects;
create policy "staff photos: managers read" on storage.objects
  for select to authenticated
  using (bucket_id = 'staff-photos'
         and public.photo_branch_id(name) is not null
         and public.is_branch_manager(public.photo_branch_id(name)));

drop policy if exists "staff photos: managers upload" on storage.objects;
create policy "staff photos: managers upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'staff-photos'
              and public.photo_branch_id(name) is not null
              and public.is_branch_manager(public.photo_branch_id(name)));

drop policy if exists "staff photos: managers delete" on storage.objects;
create policy "staff photos: managers delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'staff-photos'
         and public.photo_branch_id(name) is not null
         and public.is_branch_manager(public.photo_branch_id(name)));

-- Ask the Supabase API (PostgREST) to reload its schema cache right away, so
-- new tables and functions are usable without waiting.
notify pgrst, 'reload schema';
