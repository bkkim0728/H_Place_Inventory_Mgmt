-- ============================================================================
-- H Place 헤어살롱 재고관리 — Supabase schema
--
-- Run once in Supabase Dashboard → SQL Editor (safe to re-run).
-- Designed for multiple branches (12개 지점) from day one; the prototype
-- starts with a single branch.
--
-- Security model
--   * Every table has Row Level Security. Users only see rows of the branch
--     assigned to them in `profiles` (role 'admin' sees every branch).
--   * Clients never write tables directly. Stock changes go through
--     `record_movement()` so every change is logged in `stock_movements`,
--     and product edits go through `save_product()` (manager/admin only).
--   * New sign-ups get a profile with no branch (no data access) until a
--     manager/admin assigns one. See README.md.
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
  created_at  timestamptz not null default now()
);

create table if not exists public.profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  branch_id   uuid references public.branches(id) on delete set null,
  full_name   text,
  role        public.app_role not null default 'staff',
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

create table if not exists public.inventory (
  branch_id     uuid not null references public.branches(id) on delete cascade,
  product_id    uuid not null references public.products(id) on delete cascade,
  stock         integer not null default 0 check (stock >= 0),
  safety_stock  integer not null default 0 check (safety_stock >= 0),
  location      text,                                                 -- 보관 위치
  updated_at    timestamptz not null default now(),
  primary key (branch_id, product_id)
);

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

-- ---------------------------------------------------------------------------
-- Access helpers (security definer so policies don't recurse into profiles)
-- ---------------------------------------------------------------------------
create or replace function public.is_branch_member(p_branch_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and (p.role = 'admin' or p.branch_id = p_branch_id)
  );
$$;

create or replace function public.is_branch_manager(p_branch_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
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

drop policy if exists "branches: members read" on public.branches;
create policy "branches: members read" on public.branches
  for select to authenticated using (public.is_branch_member(id));

drop policy if exists "profiles: self and branch colleagues read" on public.profiles;
create policy "profiles: self and branch colleagues read" on public.profiles
  for select to authenticated
  using (user_id = auth.uid() or (branch_id is not null and public.is_branch_member(branch_id)));

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
revoke all on public.branches, public.profiles, public.products,
              public.inventory, public.stock_movements from anon, authenticated;
grant select on public.branches, public.profiles, public.products,
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
       else 'ok' end as status
from public.inventory i
join public.products p on p.id = i.product_id;

create or replace view public.movement_view with (security_invoker = true) as
select
  m.id, m.branch_id, m.product_id, m.type, m.quantity, m.stock_after,
  m.unit_cost, m.memo, m.reverts_id, m.created_by, m.created_at,
  p.name as product_name, p.sku, p.unit,
  pr.full_name as created_by_name,
  exists (select 1 from public.stock_movements r where r.reverts_id = m.id) as reverted
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
create or replace function public.record_movement(
  p_branch_id  uuid,
  p_product_id uuid,
  p_type       public.movement_type,
  p_quantity   integer,
  p_memo       text default null
)
returns public.stock_movements
language plpgsql security definer set search_path = public
as $$
declare
  v_stock  integer;
  v_delta  integer;
  v_after  integer;
  v_cost   integer;
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

  select cost_price into v_cost from public.products where id = p_product_id and active;
  if not found then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
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
    (branch_id, product_id, type, quantity, stock_after, unit_cost, memo, created_by)
  values
    (p_branch_id, p_product_id, p_type, v_delta, v_after, v_cost,
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
    (branch_id, product_id, type, quantity, stock_after, unit_cost, memo, reverts_id, created_by)
  values
    (v_mv.branch_id, v_mv.product_id, v_mv.type, -v_mv.quantity, v_after, v_mv.unit_cost,
     format('취소: #%s', v_mv.id), v_mv.id, auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- save_product: create/update a catalog item and its branch settings
-- (manager/admin). Returns the product id.
-- Errors: MANAGER_ONLY, INVALID_PRODUCT, DUPLICATE_SKU, PRODUCT_NOT_FOUND
-- ---------------------------------------------------------------------------
create or replace function public.save_product(
  p_branch_id     uuid,
  p_product_id    uuid,          -- null → create
  p_sku           text,
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
  if not public.is_branch_manager(p_branch_id) then
    raise exception 'MANAGER_ONLY' using errcode = '42501';
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
  exception when unique_violation then
    raise exception 'DUPLICATE_SKU' using errcode = '23505';
  end;

  insert into public.inventory (branch_id, product_id, safety_stock, location)
  values (p_branch_id, v_id, coalesce(p_safety_stock, 0), nullif(btrim(p_location), ''))
  on conflict (branch_id, product_id) do update
    set safety_stock = excluded.safety_stock,
        location     = excluded.location,
        updated_at   = now();

  return v_id;
end;
$$;

revoke all on function public.record_movement(uuid, uuid, public.movement_type, integer, text) from public, anon;
revoke all on function public.revert_movement(bigint) from public, anon;
revoke all on function public.save_product(uuid, uuid, text, text, text, text, text, integer, integer, boolean, integer, text, boolean) from public, anon;
grant execute on function public.record_movement(uuid, uuid, public.movement_type, integer, text) to authenticated;
grant execute on function public.revert_movement(bigint) to authenticated;
grant execute on function public.save_product(uuid, uuid, text, text, text, text, text, integer, integer, boolean, integer, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- New users get a profile without a branch (no data access until assigned)
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
