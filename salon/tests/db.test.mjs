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
ok((await err(mgr, () => q(`select save_product($1,null,'X-1','테스트','', '소모품','개',100,null,false,2,null)`, [b1])))?.includes('ADMIN_ONLY'), 'manager cannot create catalog products');
ok((await err(staff, () => q(`select save_product($1,null,'X-1','테스트','', '소모품','개',100,null,false,2,null)`, [b1])))?.includes('ADMIN_ONLY'), 'staff cannot create catalog products');
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
