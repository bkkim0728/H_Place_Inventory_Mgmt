// Database tests: runs schema.sql + seed.sql in PGlite (Postgres in WASM) with a
// minimal stand-in for Supabase auth, then checks RLS, permissions and stock rules.
// Run: cd salon && npm install && npm test
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../supabase/', import.meta.url));
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

// --- Minimal Supabase stand-ins: auth schema, auth.uid(), anon/authenticated roles
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}', last_sign_in_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  -- Supabase Storage tables (just the columns the schema touches)
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated;
  grant select, insert, delete on storage.objects to authenticated;
`);
await db.exec(readFileSync(root + 'schema.sql', 'utf8'));
await db.exec(readFileSync(root + 'schema.sql', 'utf8'));   // must be re-runnable
await db.exec(readFileSync(root + 'seed.sql', 'utf8'));
await db.exec(readFileSync(root + 'seed.sql', 'utf8'));     // must be re-runnable
console.log('schema + seed applied twice');

const q = async (sql, p) => (await db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];
const b1 = (await one(`select id from branches where code='BR01'`)).id;
const b2 = (await one(`insert into branches(code,name) values('BR02','2호점') returning id`)).id;

// Users (trigger creates profiles with no branch)
const mk = async (email) => (await one(`insert into auth.users(email) values($1) returning id`, [email])).id;
const staff = await mk('staff@x.kr'), mgr = await mk('mgr@x.kr'), other = await mk('other@x.kr'), newbie = await mk('new@x.kr'), admin = await mk('Admin@X.kr');
ok((await q(`select * from profiles`)).length === 5, 'trigger created a profile per user');
ok((await one(`select email from profiles where user_id=$1`, [admin])).email === 'admin@x.kr', 'profile stores lower-cased email');
await db.query(`update profiles set role='admin' where user_id=$1`, [admin]);
await db.query(`update profiles set branch_id=$1, role='staff' where user_id=$2`, [b1, staff]);
await db.query(`update profiles set branch_id=$1, role='manager' where user_id=$2`, [b1, mgr]);
await db.query(`update profiles set branch_id=$1, role='manager' where user_id=$2`, [b2, other]);
await db.query(`insert into inventory(branch_id, product_id, stock) select $1, id, 5 from products where sku='CL-6N'`, [b2]);

async function as(uid, fn) {
  await db.exec(`begin`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? '']);
  await db.exec(`set local role ${uid ? 'authenticated' : 'anon'}`);
  try { return await fn(); } finally { await db.exec(`commit`); }
}
async function err(uid, fn) { try { await as(uid, fn); return null; } catch (e) { await db.exec('rollback').catch(()=>{}); return e.message; } }

console.log('seed consistency');
const bad = await one(`
  with m as (select product_id, stock_after, quantity, row_number() over (partition by product_id order by created_at desc, id desc) rn from stock_movements where branch_id=$1)
  select count(*)::int n from m join inventory i on i.product_id=m.product_id and i.branch_id=$1 where m.rn=1 and m.stock_after<>i.stock`, [b1]);
ok(bad.n === 0, 'latest stock_after equals current stock for every product');
ok((await one(`select count(*)::int n from stock_movements where stock_after<0`)).n === 0, 'no negative stock in history');
ok((await one(`select count(*)::int n from stock_movements`)).n > 100, 'sample history generated');

console.log('RLS reads');
ok((await as(staff, () => q(`select * from inventory_view`))).every(r => r.branch_id === b1), 'staff sees only own branch inventory');
ok((await as(staff, () => q(`select * from inventory_view`))).length === 30, 'staff sees all 30 items of 1호점');
ok((await as(other, () => q(`select * from inventory_view`))).length === 1, '2호점 manager sees only 2호점');
ok((await as(newbie, () => q(`select * from inventory_view`))).length === 0, 'unassigned user sees no inventory');
ok((await as(newbie, () => q(`select * from branches`))).length === 0, 'unassigned user sees no branches');
ok((await as(staff, () => q(`select * from movement_view`))).length > 0, 'staff reads movement history');
ok((await as(other, () => q(`select * from movement_view where branch_id=$1`, [b1]))).length === 0, 'other branch history hidden');
ok((await err(null, () => q(`select * from products`)))?.includes('permission denied'), 'anon cannot read products');

console.log('direct writes blocked');
ok((await err(staff, () => q(`update inventory set stock=999`)))?.includes('permission denied'), 'staff cannot update inventory directly');
ok((await err(staff, () => q(`insert into stock_movements(branch_id,product_id,type,quantity,stock_after) select $1,id,'receive',1,1 from products limit 1`, [b1])))?.includes('permission denied'), 'staff cannot insert movements directly');
ok((await err(staff, () => q(`update profiles set role='admin' where user_id=$1`, [staff])))?.includes('permission denied'), 'staff cannot promote self');

console.log('record_movement');
const p6n = (await one(`select id from products where sku='CL-6N'`)).id;
const stockOf = async (b, p) => (await one(`select stock from inventory where branch_id=$1 and product_id=$2`, [b, p])).stock;
const s0 = await stockOf(b1, p6n);
let mv = await as(staff, () => one(`select * from record_movement($1,$2,'receive',5,'택배 입고')`, [b1, p6n]));
ok(mv.quantity === 5 && mv.stock_after === s0 + 5 && (await stockOf(b1, p6n)) === s0 + 5, 'receive adds stock and logs +5');
ok(mv.created_by === staff && mv.unit_cost === 6800, 'logs author and cost snapshot');
mv = await as(staff, () => one(`select * from record_movement($1,$2,'use',2,null)`, [b1, p6n]));
ok(mv.quantity === -2 && (await stockOf(b1, p6n)) === s0 + 3, 'use subtracts stock');
ok((await err(staff, () => q(`select record_movement($1,$2,'use',9999,null)`, [b1, p6n])))?.includes('INSUFFICIENT_STOCK'), 'cannot go below zero');
ok((await stockOf(b1, p6n)) === s0 + 3, 'failed call leaves stock unchanged');
ok((await err(staff, () => q(`select record_movement($1,$2,'use',0,null)`, [b1, p6n])))?.includes('INVALID_QUANTITY'), 'zero quantity rejected');
ok((await err(staff, () => q(`select record_movement($1,$2,'adjust',3,null)`, [b1, p6n])))?.includes('MANAGER_ONLY'), 'staff cannot do 재고 실사');
mv = await as(mgr, () => one(`select * from record_movement($1,$2,'adjust',20,'월말 실사')`, [b1, p6n]));
ok(mv.stock_after === 20 && mv.quantity === 20 - (s0 + 3), 'manager adjust sets exact count and logs the difference');
ok((await err(mgr, () => q(`select record_movement($1,$2,'adjust',20,null)`, [b1, p6n])))?.includes('NO_CHANGE'), 'adjust to same count rejected');
ok((await err(staff, () => q(`select record_movement($1,$2,'receive',1,null)`, [b2, p6n])))?.includes('NOT_BRANCH_MEMBER'), 'cannot write to another branch');
ok((await err(null, () => q(`select record_movement($1,$2,'receive',1,null)`, [b1, p6n])))?.includes('permission denied'), 'anon cannot call record_movement');
ok((await err(staff, () => q(`select record_movement($1,$2,'transfer_in',1,null)`, [b1, p6n])))?.includes('UNSUPPORTED_TYPE'), 'transfers reserved for later');

console.log('revert_movement');
mv = await as(staff, () => one(`select * from record_movement($1,$2,'use',4,null)`, [b1, p6n]));
const rv = await as(staff, () => one(`select * from revert_movement($1)`, [mv.id]));
ok(rv.quantity === 4 && rv.reverts_id === mv.id && (await stockOf(b1, p6n)) === 20, 'author reverts own entry, stock restored');
ok((await err(staff, () => q(`select revert_movement($1)`, [mv.id])))?.includes('ALREADY_REVERTED'), 'double revert rejected');
ok((await err(staff, () => q(`select revert_movement($1)`, [rv.id])))?.includes('MOVEMENT_NOT_FOUND'), 'cannot revert a reversal');
ok((await as(staff, () => one(`select reverted from movement_view where id=$1`, [mv.id]))).reverted === true, 'view flags reverted entries');
const oldMv = (await one(`select id from stock_movements where branch_id=$1 and memo='샘플 데이터' and created_at < now() - interval '1 day' limit 1`, [b1])).id;
ok((await err(staff, () => q(`select revert_movement($1)`, [oldMv])))?.includes('REVERT_WINDOW_PASSED'), 'staff cannot revert old/other entries');

console.log('catalog (admin) and branch item settings (manager)');
const auto1 = await as(mgr, async () => (await one(`select save_product($1,null,'','자동 코드 앰플','', '클리닉','박스',15000,null,false,1,null) id`, [b1])).id);
const auto2 = await as(admin, async () => (await one(`select save_product($1,null,null,'자동 코드 앰플 2','', '클리닉','박스',15000,null,false,1,null) id`, [b1])).id);
const skus = (await q(`select sku from products where id in ($1,$2) order by sku`, [auto1, auto2])).map(r => r.sku);
ok(skus[0] === 'CN-001' && skus[1] === 'CN-002', 'blank code → next code for the category (CN-001, CN-002)');
ok((await as(mgr, () => one(`select next_sku('소모품') s`))).s === 'SP-001' && (await as(mgr, () => one(`select next_sku('새 분류') s`))).s === 'P-001', 'other categories get their own prefix');
ok((await err(admin, () => q(`select save_product($1,$2,'','이름','', '클리닉','박스',1,null,false,1,null)`, [b1, auto1])))?.includes('INVALID_PRODUCT'), 'editing still needs a code');
const mgrPid = await as(mgr, async () => (await one(`select save_product($1,null,'mg-1','지점 등록 제품','', '소모품','개',100,null,false,2,'창고') id`, [b1])).id);
ok((await one(`select count(*)::int n from inventory where product_id=$1`, [mgrPid])).n === (await one(`select count(*)::int n from branches`)).n, 'manager registers a new product (stock rows for every branch)');
ok((await one(`select safety_stock, location from inventory where product_id=$1 and branch_id=$2`, [mgrPid, b1])).location === '창고', 'the registering branch gets its safety stock and location');
await as(mgr, () => q(`select save_product($1,$2,'HACK-1','이름 변경','딴브랜드', '도구','통',200,2500,true,2,null,false)`, [b1, mgrPid]));
const mp = await one(`select sku, name, brand, category, unit, cost_price, retail_price, is_retail, active from products where id=$1`, [mgrPid]);
ok(mp.name === '이름 변경' && mp.category === '도구' && mp.cost_price === 200 && mp.retail_price === 2500 && mp.is_retail === true, 'manager changes name, category, prices and 고객 판매용');
ok(mp.sku === 'MG-1' && mp.brand === null && mp.unit === '개' && mp.active === true, 'code, brand, unit and 사용 stay as they were');
ok((await err(mgr, () => q(`select save_product($1,$2,'MG-1','이름 변경','', '없는분류','개',200,2500,true,2,null)`, [b1, mgrPid])))?.includes('CATEGORY_NOT_FOUND'), 'manager can only pick an existing category');
ok((await err(other, () => q(`select save_product($1,$2,'MG-1','x','', '소모품','개',1,null,false,0,null)`, [b1, mgrPid])))?.includes('MANAGER_ONLY'), 'manager of another branch cannot use this branch');
ok((await err(staff, () => q(`select save_product($1,$2,'MG-1','x','', '소모품','개',1,null,false,0,null)`, [b1, mgrPid])))?.includes('MANAGER_ONLY'), 'staff cannot change products');
ok((await err(other, () => q(`select save_product($1,null,'X-1','테스트','', '소모품','개',100,null,false,2,null)`, [b1])))?.includes('MANAGER_ONLY'), 'manager cannot register for another branch');
ok((await err(staff, () => q(`select save_product($1,null,'X-1','테스트','', '소모품','개',100,null,false,2,null)`, [b1])))?.includes('MANAGER_ONLY'), 'staff cannot register products');
const pid = await as(admin, async () => (await one(`select save_product($1,null,' tst-1 ','테스트 샴푸','브랜드','샴푸·트리트먼트','병',12000,null,false,3,'창고') id`, [b1])).id);
const created = await one(`select p.sku, i.safety_stock, i.stock, i.location from products p join inventory i on i.product_id=p.id and i.branch_id=$2 where p.id=$1`, [pid, b1]);
ok(created.sku === 'TST-1' && created.safety_stock === 3 && created.stock === 0 && created.location === '창고', 'admin creates product with 1호점 settings');
ok((await one(`select count(*)::int n from inventory where product_id=$1`, [pid])).n === 2, 'new product gets an inventory row in every branch');
ok((await err(admin, () => q(`select save_product($1,null,'TST-1','중복','', '소모품','개',100,null,false,0,null)`, [b1])))?.includes('DUPLICATE_SKU'), 'duplicate SKU rejected');
await as(admin, () => q(`select save_product($1,$2,'TST-1','테스트 샴푸 v2','브랜드','샴푸·트리트먼트','병',13000,null,false,5,null)`, [b1, pid]));
ok((await one(`select name from products where id=$1`, [pid])).name === '테스트 샴푸 v2', 'admin updates catalog item');
ok((await err(admin, () => q(`select save_product($1,null,'','','', '','',-1,null,false,0,null)`, [b1])))?.includes('INVALID_PRODUCT'), 'invalid product rejected');
await as(mgr, () => q(`select set_branch_item($1,$2,7,'샴푸대')`, [b1, pid]));
ok((await one(`select safety_stock, location from inventory where branch_id=$1 and product_id=$2`, [b1, pid])).safety_stock === 7, 'manager sets own branch safety stock');
ok((await err(mgr, () => q(`select set_branch_item($1,$2,7,null)`, [b2, pid])))?.includes('MANAGER_ONLY'), 'manager cannot set another branch item');
ok((await err(staff, () => q(`select set_branch_item($1,$2,7,null)`, [b1, pid])))?.includes('MANAGER_ONLY'), 'staff cannot set branch item');

console.log('categories');
ok((await as(staff, () => q(`select name from categories order by sort_order`))).map(r => r.name).join(',') === '염모제,펌제,샴푸·트리트먼트,클리닉,판매용 홈케어,소모품,도구', 'signed-in users read categories in order');
ok((await err(null, () => q(`select * from categories`)))?.includes('permission denied'), 'anon cannot read categories');
ok((await err(mgr, () => q(`select save_category(null,'두피케어')`)))?.includes('ADMIN_ONLY'), 'manager cannot add categories');
const catId = await as(admin, async () => (await one(`select save_category(null,'  두피케어 ') id`)).id);
ok((await one(`select name, sort_order from categories where id=$1`, [catId])).name === '두피케어', 'admin adds a category (trimmed)');
ok((await one(`select sort_order from categories where id=$1`, [catId])).sort_order > (await one(`select max(sort_order) m from categories where id<>$1`, [catId])).m, 'new category goes last');
ok((await err(admin, () => q(`select save_category(null,'펌제')`)))?.includes('DUPLICATE_CATEGORY'), 'duplicate category name rejected');
ok((await err(admin, () => q(`select save_category(null,'   ')`)))?.includes('INVALID_CATEGORY'), 'blank category rejected');
ok((await err(admin, () => q(`select save_product($1,null,'X-9','x','', '없는분류','개',100,null,false,0,null)`, [b1])))?.includes('CATEGORY_NOT_FOUND'), 'product must use an existing category');
const permId = (await one(`select id from categories where name='펌제'`)).id;
await as(admin, () => q(`select save_category($1,'펌·매직')`, [permId]));
ok((await one(`select count(*)::int n from products where category='펌·매직'`)).n === 4 && (await one(`select count(*)::int n from products where category='펌제'`)).n === 0, 'renaming a category renames it on its products');
ok((await as(staff, () => q(`select distinct category from inventory_view where category='펌·매직'`))).length === 1, 'inventory view shows the new category name');
ok((await err(admin, () => q(`select delete_category($1)`, [permId])))?.includes('CATEGORY_IN_USE'), 'category with products cannot be deleted');
await as(admin, () => q(`select delete_category($1)`, [catId]));
ok(!(await one(`select id from categories where id=$1`, [catId])), 'empty category deleted');
ok((await err(mgr, () => q(`select delete_category($1)`, [permId])))?.includes('ADMIN_ONLY'), 'manager cannot delete categories');
const ids = (await q(`select id from categories order by sort_order`)).map(r => r.id);
await as(admin, () => q(`select reorder_categories($1::uuid[])`, [[ids[6], ...ids.slice(0, 6)]]));
ok((await one(`select name from categories order by sort_order limit 1`)).name === '도구', 'admin reorders categories');
ok((await err(mgr, () => q(`select reorder_categories($1::uuid[])`, [ids])))?.includes('ADMIN_ONLY'), 'manager cannot reorder');
ok((await err(staff, () => q(`update categories set name='x'`)))?.includes('permission denied'), 'no direct writes to categories');
await as(admin, () => q(`select save_category($1,'펌제')`, [permId]));

console.log('branches');
const b3 = await as(admin, async () => (await one(`select save_branch(null,' br03 ','3호점','02-000-0000','서울',true) id`)).id);
ok((await one(`select code from branches where id=$1`, [b3])).code === 'BR03', 'admin creates branch (code normalised)');
ok((await one(`select count(*)::int n from inventory where branch_id=$1`, [b3])).n === (await one(`select count(*)::int n from products`)).n, 'new branch gets every product at 0 stock');
ok((await err(admin, () => q(`select save_branch(null,'BR03','중복',null,null,true)`)))?.includes('DUPLICATE_BRANCH_CODE'), 'duplicate branch code rejected');
ok((await err(admin, () => q(`select save_branch(null,'bad code!','x',null,null,true)`)))?.includes('INVALID_BRANCH'), 'invalid branch code rejected');
ok((await err(mgr, () => q(`select save_branch(null,'BR09','9호점',null,null,true)`)))?.includes('FORBIDDEN'), 'manager cannot create branches');
await as(mgr, () => q(`select save_branch($1,'HACK','1호점 강남','02-111-2222','서울 강남구',false)`, [b1]));
const br1 = await one(`select code, name, phone, active from branches where id=$1`, [b1]);
ok(br1.name === '1호점 강남' && br1.phone === '02-111-2222', 'manager edits own branch name and phone');
ok(br1.code === 'BR01' && br1.active === true, 'manager cannot change branch code or active flag');
ok((await err(mgr, () => q(`select save_branch($1,'BR02','x',null,null,true)`, [b2])))?.includes('FORBIDDEN'), 'manager cannot edit another branch');
ok((await err(staff, () => q(`select save_branch($1,'BR01','x',null,null,true)`, [b1])))?.includes('FORBIDDEN'), 'staff cannot edit branch');
ok((await as(admin, () => q(`select * from branches`))).length === 3, 'admin sees every branch');
ok((await as(mgr, () => q(`select * from branches`))).length === 1, 'manager sees only own branch');

console.log('list_users');
ok((await as(admin, () => q(`select * from list_users(null)`))).length === 5, 'admin lists every user incl. unassigned');
ok((await as(admin, () => q(`select * from list_users($1)`, [b2]))).every(u => u.branch_id === b2), 'admin filters by branch');
const mgrList = await as(mgr, () => q(`select * from list_users($1)`, [b1]));
ok(mgrList.length === 2 && mgrList.every(u => u.branch_id === b1), 'manager lists only own branch users');
ok((await err(mgr, () => q(`select * from list_users(null)`)))?.includes('FORBIDDEN'), 'manager cannot list all users');
ok((await err(mgr, () => q(`select * from list_users($1)`, [b2])))?.includes('FORBIDDEN'), 'manager cannot list another branch');
ok((await err(staff, () => q(`select * from list_users($1)`, [b1])))?.includes('FORBIDDEN'), 'staff cannot list users');

console.log('login_id');
ok((await one(`select login_id from profiles where user_id=$1`, [admin])).login_id === 'admin', 'trigger derives login_id from the email');
const dupLocal = await mk('admin@other.kr');
ok((await one(`select login_id from profiles where user_id=$1`, [dupLocal])).login_id === null, 'taken login_id is left empty instead of failing sign-up');
ok((await as(admin, () => q(`select login_id from list_users(null) where user_id=$1`, [staff])))[0].login_id === 'staff', 'list_users returns login_id');
let dupErr = null; try { await db.query(`update profiles set login_id='ADMIN' where user_id=$1`, [dupLocal]); } catch (e) { dupErr = e.message; }
ok(dupErr?.includes('profiles_login_id_idx'), 'login_id is unique (case-insensitive)');
await db.query(`delete from auth.users where id=$1`, [dupLocal]);
ok((await q(`select to_regclass('public.invitations') t`))[0].t === null, 'invitations table no longer exists');

// Users that the admin-users Edge Function would create and then assign
const kim = await mk('kim@hplace.local');
await db.query(`update profiles set branch_id=$2, role='staff', full_name='김디자이너' where user_id=$1`, [kim, b1]);
const stranger = await mk('stranger@hplace.local');

console.log('update_user');
await as(mgr, () => q(`select update_user($1,'김 디자이너',$2,'manager',true)`, [kim, b1]));
ok((await one(`select role from profiles where user_id=$1`, [kim])).role === 'manager', 'manager promotes own staff to manager');
ok((await err(mgr, () => q(`select update_user($1,null,$2,'admin',true)`, [kim, b1])))?.includes('FORBIDDEN'), 'manager cannot grant admin');
ok((await err(mgr, () => q(`select update_user($1,null,$2,'staff',true)`, [kim, b2])))?.includes('FORBIDDEN'), 'manager cannot move a user to another branch');
ok((await err(mgr, () => q(`select update_user($1,null,$2,'staff',true)`, [other, b2])))?.includes('FORBIDDEN'), 'manager cannot edit another branch user');
ok((await err(mgr, () => q(`select update_user($1,null,null,'admin',true)`, [admin])))?.includes('FORBIDDEN'), 'manager cannot edit an admin');
ok((await err(mgr, () => q(`select update_user($1,null,$2,'staff',true)`, [mgr, b1])))?.includes('CANNOT_CHANGE_SELF'), 'manager cannot demote self');
await as(mgr, () => q(`select update_user($1,'점장님',$2,'manager',true)`, [mgr, b1]));
ok((await one(`select full_name from profiles where user_id=$1`, [mgr])).full_name === '점장님', 'anyone can change own name');
await as(mgr, () => q(`select update_user($1,null,$2,'staff',false)`, [staff, b1]));
ok((await as(staff, () => q(`select * from inventory_view`))).length === 0, 'deactivated staff loses all access');
ok((await err(staff, () => q(`select record_movement($1,$2,'use',1,null)`, [b1, p6n])))?.includes('NOT_BRANCH_MEMBER'), 'deactivated staff cannot record movements');
await as(mgr, () => q(`select update_user($1,null,$2,'staff',true)`, [staff, b1]));
await db.query(`update profiles set branch_id=$2 where user_id=$1`, [stranger, b1]);
await as(mgr, () => q(`select update_user($1,null,null,'staff',true)`, [stranger]));
ok((await one(`select branch_id from profiles where user_id=$1`, [stranger])).branch_id === null, 'manager releases a user from the branch');

await as(admin, () => q(`select update_user($1,'이서연 점장',$2,'manager',false)`, [other, b3]));
const edited = await one(`select full_name, branch_id, role, active from profiles where user_id=$1`, [other]);
ok(edited.full_name === '이서연 점장' && edited.role === 'manager' && edited.active === false, 'admin edits name, role and active of another user');
await as(admin, () => q(`select update_user($1,null,$2,'manager',true)`, [other, b3]));
ok((await one(`select branch_id from profiles where user_id=$1`, [other])).branch_id === b3, 'admin moves a manager to another branch');
ok((await err(admin, () => q(`select update_user($1,null,null,'staff',true)`, [admin])))?.includes('CANNOT_CHANGE_SELF'), 'admin cannot demote self');
const admin2 = await mk('boss@hplace.local');
await db.query(`update profiles set role='admin' where user_id=$1`, [admin2]);
await as(admin, () => q(`select update_user($1,null,$2,'staff',true)`, [admin2, b1]));
ok((await one(`select role from profiles where user_id=$1`, [admin2])).role === 'staff', 'admin demotes another admin while one remains');
ok((await err(admin2, () => q(`select update_user($1,null,null,'staff',true)`, [admin])))?.includes('FORBIDDEN'), 'demoted admin (now staff) cannot touch the admin');
ok((await err(admin2, () => q(`select * from list_users(null)`)))?.includes('FORBIDDEN'), 'demoted admin loses user management');

console.log('branch photos');
ok((await one(`select public from storage.buckets where id='branch-photos'`)).public === true, 'public branch-photos bucket exists');
const put = (uid, name) => as(uid, () => q(`insert into storage.objects(bucket_id,name) values('branch-photos',$1)`, [name]));
await put(mgr, `${b1}/a.jpg`);
ok((await one(`select count(*)::int n from storage.objects where name=$1`, [`${b1}/a.jpg`])).n === 1, 'manager uploads a photo for own branch');
ok((await err(staff, () => put(staff, `${b1}/b.jpg`)))?.includes('row-level security'), 'staff cannot upload branch photos');
ok((await err(mgr, () => put(mgr, `${b2}/b.jpg`)))?.includes('row-level security'), 'manager cannot upload for another branch');
ok((await err(mgr, () => put(mgr, `misc/b.jpg`)))?.includes('row-level security'), 'files outside a branch folder are rejected');
await put(admin, `${b2}/c.jpg`);
ok((await one(`select count(*)::int n from storage.objects where name=$1`, [`${b2}/c.jpg`])).n === 1, 'admin uploads for any branch');
ok((await as(other, () => q(`delete from storage.objects where name=$1 returning id`, [`${b1}/a.jpg`]))).length === 0, 'manager cannot delete another branch photo');

ok((await as(mgr, () => one(`select set_branch_photo($1,$2) old`, [b1, `${b1}/a.jpg`]))).old === null, 'set_branch_photo records the path');
ok((await one(`select photo_path from branches where id=$1`, [b1])).photo_path === `${b1}/a.jpg`, 'branch keeps the photo path');
ok((await err(staff, () => q(`select set_branch_photo($1,$2)`, [b1, `${b1}/x.jpg`])))?.includes('FORBIDDEN'), 'staff cannot set the photo');
ok((await err(mgr, () => q(`select set_branch_photo($1,$2)`, [b2, `${b2}/x.jpg`])))?.includes('FORBIDDEN'), 'manager cannot set another branch photo');
ok((await err(mgr, () => q(`select set_branch_photo($1,$2)`, [b1, `${b2}/c.jpg`])))?.includes('INVALID_PHOTO'), 'path must be in the branch folder');
ok((await err(mgr, () => q(`select set_branch_photo($1,$2)`, [b1, `${b1}/../x.jpg`])))?.includes('INVALID_PHOTO'), 'path traversal rejected');
await as(admin, () => q(`select set_branch_photo($1,$2)`, [b2, `${b2}/c.jpg`]));

const lp = await as(null, () => q(`select * from login_photos()`));
ok(lp.length === 2 && lp.every(r => r.photo_path && r.name), 'anon reads sign-in photos (name + path only)');
ok(Object.keys(lp[0]).sort().join() === 'id,name,photo_path', 'login_photos exposes no other branch data');
await as(admin, () => q(`select save_branch($1,'BR02','2호점',null,null,false)`, [b2]));
ok((await as(null, () => q(`select * from login_photos()`))).length === 1, 'closed branches are left out of sign-in photos');
await as(admin, () => q(`select save_branch($1,'BR02','2호점',null,null,true)`, [b2]));
ok((await err(null, () => q(`select set_branch_photo($1,null)`, [b1])))?.includes('permission denied'), 'anon cannot change photos');
ok((await as(mgr, () => one(`select set_branch_photo($1,null) old`, [b1]))).old === `${b1}/a.jpg`, 'removing returns the old path for cleanup');
ok((await one(`select photo_path from branches where id=$1`, [b1])).photo_path === null, 'photo removed from the branch');
ok((await as(mgr, () => q(`delete from storage.objects where name=$1 returning id`, [`${b1}/a.jpg`]))).length === 1, 'manager deletes the old file');

console.log('staff');
ok((await one(`select count(*)::int n from staff where branch_id=$1`, [b1])).n === 6, 'seed adds 6 sample staff to 1호점 once');
const sv = (uid, a) => as(uid, () => one(`select save_staff($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) id`, a));
const base = (id, br, over = {}) => { const o = { name: '신입 디자이너', position: 'designer', phone: '010-0000-0000', hired: '2025-03-02', status: 'active', left: null,
  services: ['perm', 'cut', 'cut'], days: [3, 1, 1], s: 30, r: 5, lic: ' 서울-2025-1 ', cert: '2027-01-31', memo: '  ', ...over };
  return [id, br, o.name, o.position, o.phone, o.hired, o.status, o.left, o.services, o.days, o.s, o.r, o.lic, o.cert, o.memo]; };
const st1 = (await sv(mgr, base(null, b1))).id;
const r1 = await one(`select * from staff where id=$1`, [st1]);
ok(r1.services.join() === 'cut,perm' && r1.days_off.join() === '1,3', 'services and days off are de-duplicated and sorted');
ok(r1.license_no === '서울-2025-1' && r1.memo === null && Number(r1.incentive_service) === 30, 'text is trimmed, blanks become null');
ok((await as(staff, () => q(`select * from staff`))).length === 0, 'staff (직원 role) cannot read staff records');
ok((await as(mgr, () => q(`select * from staff`))).every(r => r.branch_id === b1), 'manager reads only own branch staff');
ok((await as(admin, () => q(`select distinct branch_id from staff`))).length >= 1, 'admin reads staff records');
ok((await err(staff, () => sv(staff, base(null, b1))))?.includes('FORBIDDEN'), 'staff role cannot add staff');
ok((await err(mgr, () => sv(mgr, base(null, b2))))?.includes('FORBIDDEN'), 'manager cannot add staff to another branch');
ok((await err(mgr, () => sv(mgr, base(st1, b2))))?.includes('FORBIDDEN'), 'manager cannot move staff to another branch');
ok((await err(mgr, () => sv(mgr, base(null, b1, { position: 'boss' }))))?.includes('INVALID_STAFF_POSITION'), 'unknown position rejected with its own code');
ok((await err(mgr, () => sv(mgr, base(null, b1, { services: ['massage'] }))))?.includes('INVALID_STAFF'), 'unknown service rejected');
ok((await err(mgr, () => sv(mgr, base(null, b1, { days: [7] }))))?.includes('INVALID_STAFF'), 'invalid weekday rejected');
ok((await err(mgr, () => sv(mgr, base(null, b1, { s: 120 }))))?.includes('INVALID_STAFF_RATE'), 'incentive over 100% rejected with its own code');
ok((await err(mgr, () => sv(mgr, base(null, b1, { name: ' ' }))))?.includes('INVALID_STAFF_NAME'), 'blank name rejected with its own code');
ok((await err(mgr, () => sv(mgr, base(null, b1, { status: 'left', left: '2024-01-01' }))))?.includes('INVALID_STAFF_DATES'), 'leave date before hire date rejected with its own code');
await sv(mgr, base(st1, b1, { status: 'left' }));
const r2 = await one(`select status, left_on::text d from staff where id=$1`, [st1]);
ok(r2.status === 'left' && r2.d === (await one(`select current_date::text d`)).d, 'marking 퇴사 without a date records today');
await sv(mgr, base(st1, b1, { status: 'active', left: '2026-01-01' }));
ok((await one(`select left_on from staff where id=$1`, [st1])).left_on === null, 'returning to 재직 clears the leave date');
ok((await err(staff, () => q(`update staff set name='x'`)))?.includes('permission denied'), 'no direct writes to staff');
ok((await err(other, () => q(`select delete_staff($1)`, [st1])))?.includes('FORBIDDEN'), 'other branch manager cannot delete');
await as(mgr, () => q(`select delete_staff($1)`, [st1]));
ok((await one(`select count(*)::int n from staff where id=$1`, [st1])).n === 0, 'manager deletes a mistaken record');
ok((await err(mgr, () => q(`select delete_staff($1)`, [st1])))?.includes('STAFF_NOT_FOUND'), 'deleting twice → STAFF_NOT_FOUND');
ok((await err(null, () => q(`select * from staff`)))?.includes('permission denied'), 'anon cannot read staff');

console.log('staff photos');
ok((await one(`select public from storage.buckets where id='staff-photos'`)).public === false, 'staff-photos bucket is private');
const stP = (await sv(mgr, base(null, b1, { name: '사진 직원' }))).id;
const sp = `${b1}/${stP}/a.jpg`;
await as(mgr, () => q(`insert into storage.objects(bucket_id,name) values('staff-photos',$1)`, [sp]));
ok((await as(mgr, () => q(`select name from storage.objects where bucket_id='staff-photos'`))).length === 1, 'manager uploads and reads own branch staff photo');
ok((await as(staff, () => q(`select name from storage.objects where bucket_id='staff-photos'`))).length === 0, 'staff role cannot read staff photos');
ok((await as(other, () => q(`select name from storage.objects where bucket_id='staff-photos'`))).length === 0, 'other branch manager cannot read them');
ok((await err(staff, () => q(`insert into storage.objects(bucket_id,name) values('staff-photos',$1)`, [`${b1}/${stP}/b.jpg`])))?.includes('row-level security'), 'staff role cannot upload staff photos');
ok((await as(mgr, () => one(`select set_staff_photo($1,$2) old`, [stP, sp]))).old === null, 'set_staff_photo records the path');
ok((await err(mgr, () => q(`select set_staff_photo($1,$2)`, [stP, `${b1}/other/a.jpg`])))?.includes('INVALID_PHOTO'), 'photo must be in the staff member folder');
ok((await err(other, () => q(`select set_staff_photo($1,$2)`, [stP, null])))?.includes('FORBIDDEN'), 'other branch manager cannot change the photo');
ok((await err(staff, () => q(`select set_staff_photo($1,$2)`, [stP, null])))?.includes('FORBIDDEN'), 'staff role cannot change the photo');
ok((await as(mgr, () => one(`select delete_staff($1) p`, [stP]))).p === sp, 'delete_staff returns the photo path for cleanup');

console.log('담당 디자이너 on movements');
const des = (await one(`select id from staff where branch_id=$1 and name='김도윤'`, [b1])).id;
const retail = (await one(`select id, retail_price from products where sku='RT-ESS'`));
const stockR = await stockOf(b1, retail.id);
let smv = await as(staff, () => one(`select * from record_movement($1,$2,'sale',2,null,$3)`, [b1, retail.id, des]));
ok(smv.staff_id === des && smv.unit_price === retail.retail_price, 'sale records the designer and the 판매가 at the time');
ok((await as(staff, () => one(`select staff_name from movement_view where id=$1`, [smv.id]))).staff_name === '김도윤', 'staff role sees the designer name in history');
const umv = await as(staff, () => one(`select * from record_movement($1,$2,'use',1,null,$3)`, [b1, p6n, des]));
ok(umv.staff_id === des && umv.unit_price === null, '시술 사용 records the designer, no 판매가');
const b2staff = (await as(admin, () => one(`select save_staff(null,$1,'2호점 디자이너','designer',null,null,'active',null,'{}','{}',30,5,null,null,null) id`, [b2]))).id;
ok((await err(staff, () => q(`select record_movement($1,$2,'use',1,null,$3)`, [b1, p6n, b2staff])))?.includes('INVALID_STAFF'), 'designer from another branch rejected');
const rev = await as(staff, () => one(`select * from revert_movement($1)`, [smv.id]));
ok(rev.staff_id === des && rev.unit_price === retail.retail_price && (await stockOf(b1, retail.id)) === stockR, 'revert keeps designer and price so totals net out');
smv = await as(staff, () => one(`select * from record_movement($1,$2,'sale',1,null,$3)`, [b1, retail.id, des]));

console.log('list_staff_names');
const names = await as(staff, () => q(`select * from list_staff_names($1)`, [b1]));
ok(names.length >= 6 && !('incentive_service' in names[0]), 'staff role lists names without pay data');
ok((await err(staff, () => q(`select * from list_staff_names($1)`, [b2])))?.includes('NOT_BRANCH_MEMBER'), 'names of another branch hidden');

console.log('근무표');
await as(mgr, () => q(`select set_schedule($1,'2026-09-10','annual','가족 여행')`, [des]));
await as(mgr, () => q(`select set_schedule($1,'2026-09-10','half',null)`, [des]));
ok((await one(`select kind, memo from staff_schedule where staff_id=$1 and day='2026-09-10'`, [des])).kind === 'half', 'setting the same day replaces the entry');
ok((await as(staff, () => q(`select * from staff_schedule where branch_id=$1`, [b1]))).length === 1, 'staff role reads the branch schedule');
ok((await as(other, () => q(`select * from staff_schedule where branch_id=$1`, [b1]))).length === 0, 'other branch cannot read it');
ok((await err(staff, () => q(`select set_schedule($1,'2026-09-11','off',null)`, [des])))?.includes('FORBIDDEN'), 'staff role cannot edit the schedule');
ok((await err(mgr, () => q(`select set_schedule($1,'2026-09-11','holiday',null)`, [des])))?.includes('INVALID_SCHEDULE'), 'unknown kind rejected');
await as(mgr, () => q(`select set_schedule($1,'2026-09-10',null,null)`, [des]));
ok((await one(`select count(*)::int n from staff_schedule where staff_id=$1`, [des])).n === 0, 'null kind clears the day');

console.log('실적·정산');
const month = (await one(`select to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-01') m`)).m;
const rep = async (uid = mgr, m = month) => as(uid, () => q(`select * from staff_month_report($1,$2)`, [b1, m]));
let rows = await rep();
let dr = rows.find(r => r.staff_id === des);
const expectRetail = (await one(`select coalesce(sum(-m.quantity * coalesce(m.unit_price, p.retail_price)),0)::int s from stock_movements m join products p on p.id=m.product_id
  where m.staff_id=$1 and m.type='sale' and m.created_at >= ($2::date)::timestamp at time zone 'Asia/Seoul'`, [des, month])).s;
ok(Number(dr.retail_sales) === expectRetail && expectRetail >= retail.retail_price, 'product sales come from tagged sales (reverted ones net out)');
ok(Number(dr.material_cost) > 0, 'material cost comes from tagged 시술 사용');
ok(rows.every(r => r.status !== 'left' || r.staff_id), 'report lists the branch staff');
await as(mgr, () => q(`select save_staff_month($1,$2,3200000,41,50000,'우수 사원 보너스')`, [des, month]));
dr = (await rep()).find(r => r.staff_id === des);
ok(Number(dr.incentive_service) === Math.round(3200000 * 0.35) && Number(dr.incentive_retail) === Math.round(expectRetail * 0.08), 'incentives use the staff rates');
ok(Number(dr.incentive_total) === Math.round(3200000 * 0.35) + Math.round(expectRetail * 0.08) + 50000, 'total adds the adjustment');
ok((await err(staff, () => rep(staff)))?.includes('FORBIDDEN'), 'staff role cannot see payroll');
ok((await err(other, () => rep(other)))?.includes('FORBIDDEN'), 'other branch manager cannot see payroll');
ok((await err(mgr, () => q(`select save_staff_month($1,$2,-1,0,0,null)`, [des, month])))?.includes('INVALID_AMOUNT'), 'negative sales rejected');
ok((await as(staff, () => q(`select * from staff_monthly`))).length === 0, 'staff role cannot read monthly figures');

await as(mgr, () => q(`select confirm_payroll($1,$2)`, [b1, month]));
const before = (await rep()).find(r => r.staff_id === des);
await as(staff, () => q(`select record_movement($1,$2,'sale',1,null,$3)`, [b1, retail.id, des]));
await db.query(`update staff set incentive_retail=50 where id=$1`, [des]);
const after = (await rep()).find(r => r.staff_id === des);
ok(before.confirmed && Number(after.retail_sales) === Number(before.retail_sales) && Number(after.incentive_total) === Number(before.incentive_total), 'a confirmed month keeps its figures after new sales and rate changes');
ok((await err(mgr, () => q(`select save_staff_month($1,$2,1,1,0,null)`, [des, month])))?.includes('MONTH_CONFIRMED'), 'confirmed month cannot be edited');
ok((await err(mgr, () => q(`select confirm_payroll($1,$2)`, [b1, month])))?.includes('MONTH_CONFIRMED'), 'cannot confirm twice');
ok((await err(mgr, () => q(`select reopen_payroll($1,$2)`, [b1, month])))?.includes('ADMIN_ONLY'), 'only an admin reopens a month');
await as(admin, () => q(`select reopen_payroll($1,$2)`, [b1, month]));
const reopened = (await rep()).find(r => r.staff_id === des);
ok(!reopened.confirmed && Number(reopened.retail_sales) > Number(before.retail_sales) && Number(reopened.rate_retail) === 50, 'reopened month shows live figures again');
await db.query(`update staff set incentive_retail=8 where id=$1`, [des]);
// KST month boundary: a sale at 23:30 KST on the last day belongs to that month
const prevMonth = (await one(`select to_char(($1::date - interval '1 month'), 'YYYY-MM-01') m`, [month])).m;
await db.query(`insert into stock_movements(branch_id,product_id,type,quantity,stock_after,unit_price,staff_id,created_at)
  values($1,$2,'sale',-1,0,10000,$3, ($4::date - interval '30 minutes')::timestamp at time zone 'Asia/Seoul')`, [b1, retail.id, des, month]);
const prevRow = (await rep(mgr, prevMonth)).find(r => r.staff_id === des);
ok(Number(prevRow.retail_sales) >= 10000, 'month boundaries follow Korea time');

console.log('직급 rename');
await db.exec(`alter table staff drop constraint staff_position_chk`);
const oldPos = (await one(`insert into staff(branch_id,name,position) values($1,'옛 원장','director') returning id`, [b1])).id;
await db.query(`insert into staff(branch_id,name,position) values($1,'옛 데스크','desk')`, [b1]);
await db.exec(readFileSync(root + 'schema.sql', 'utf8'));
ok((await one(`select position from staff where id=$1`, [oldPos])).position === 'head_director', 're-running schema.sql converts 원장 → 대표원장');
ok((await one(`select count(*)::int n from staff where position in ('director','chief','intern','desk')`)).n === 0, 'no old position values remain');
const ss = (await sv(mgr, base(null, b1, { name: '수석', position: 'senior_stylist' }))).id;
ok((await one(`select position from staff where id=$1`, [ss])).position === 'senior_stylist', 'new titles accepted');
ok((await err(mgr, () => sv(mgr, base(null, b1, { position: 'director' }))))?.includes('INVALID_STAFF'), 'old titles rejected');
ok((await as(mgr, () => q(`select name from staff_month_report($1,$2)`, [b1, month])))[0].name !== undefined, 'report orders by the new titles');

console.log('지점별 사용 중');
const pUse = p6n;  // stocked by both test branches
await as(staff, () => q(`select set_item_in_use($1,$2,false)`, [b1, pUse]));
ok((await as(staff, () => one(`select in_use from inventory_view where branch_id=$1 and product_id=$2`, [b1, pUse]))).in_use === false, 'staff turns 사용 중 off for their branch');
ok((await one(`select in_use from inventory where branch_id=$1 and product_id=$2`, [b2, pUse])).in_use === true, 'other branches are not affected');
ok((await one(`select active from products where id=$1`, [pUse])).active === true, 'catalog-wide 사용 flag unchanged');
ok((await err(staff, () => q(`select set_item_in_use($1,$2,false)`, [b2, pUse])))?.includes('NOT_BRANCH_MEMBER'), 'cannot change another branch');
await as(mgr, () => q(`select set_item_in_use($1,$2,true)`, [b1, pUse]));
ok((await one(`select in_use from inventory where branch_id=$1 and product_id=$2`, [b1, pUse])).in_use === true, 'manager turns it back on');
ok((await err(null, () => q(`select set_item_in_use($1,$2,false)`, [b1, pUse])))?.includes('permission denied'), 'anon cannot change it');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
