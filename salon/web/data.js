/* Data layer.
 * Uses Supabase when config.js provides a URL and anon key; otherwise a demo
 * store that lives in this browser and follows the same rules as the SQL
 * functions in supabase/schema.sql.
 */
(() => {
  'use strict';

  const cfg = window.APP_CONFIG || {};

  // Stable error codes raised by the SQL functions → messages for staff.
  const MESSAGES = {
    NOT_AUTHENTICATED: '로그인이 만료되었습니다. 다시 로그인해 주세요.',
    NOT_BRANCH_MEMBER: '이 지점의 재고를 변경할 권한이 없습니다.',
    MANAGER_ONLY: '지점 관리자 이상만 할 수 있는 작업입니다.',
    ADMIN_ONLY: '전체 관리자만 할 수 있는 작업입니다.',
    FORBIDDEN: '이 작업을 할 권한이 없습니다.',
    PRODUCT_NOT_FOUND: '품목을 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.',
    INVALID_QUANTITY: '수량은 1 이상의 정수로 입력해 주세요.',
    UNSUPPORTED_TYPE: '지원하지 않는 구분입니다.',
    INSUFFICIENT_STOCK: '현재고보다 많이 뺄 수 없습니다. 수량을 확인해 주세요.',
    NO_CHANGE: '실사 수량이 현재고와 같아 바꿀 내용이 없습니다.',
    MOVEMENT_NOT_FOUND: '취소할 기록을 찾을 수 없습니다.',
    ALREADY_REVERTED: '이미 취소된 기록입니다.',
    REVERT_WINDOW_PASSED: '본인이 10분 안에 등록한 기록만 취소할 수 있습니다. 지점 관리자에게 요청해 주세요.',
    INVALID_PRODUCT: '품목 정보를 다시 확인해 주세요.',
    DUPLICATE_SKU: '이미 사용 중인 품목 코드입니다. 다른 코드를 입력해 주세요.',
    INVALID_CATEGORY: '카테고리 이름을 1~30자로 입력해 주세요.',
    DUPLICATE_CATEGORY: '이미 있는 카테고리 이름입니다.',
    CATEGORY_NOT_FOUND: '카테고리를 찾을 수 없습니다. 카테고리 관리에서 확인해 주세요.',
    CATEGORY_IN_USE: '이 카테고리에 제품이 있어 삭제할 수 없습니다. 제품의 카테고리를 먼저 바꿔 주세요.',
    INVALID_BRANCH: '지점 정보를 확인해 주세요. 지점 코드는 영문 대문자·숫자·하이픈 2~12자입니다.',
    DUPLICATE_BRANCH_CODE: '이미 사용 중인 지점 코드입니다.',
    BRANCH_NOT_FOUND: '지점을 찾을 수 없거나 사용 중지된 지점입니다.',
    INVALID_LOGIN_ID: '아이디는 영문 소문자·숫자로 시작하고, 영문·숫자·마침표·밑줄·하이픈으로 2~30자입니다.',
    LOGIN_ID_TAKEN: '이미 사용 중인 아이디입니다. 다른 아이디를 입력해 주세요.',
    WEAK_PASSWORD: '비밀번호는 6자 이상 72자 이하로 입력해 주세요.',
    INVALID_ROLE: '역할을 다시 선택해 주세요.',
    CREATE_FAILED: '사용자를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.',
    UPDATE_FAILED: '계정 정보를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.',
    FUNCTION_NOT_DEPLOYED: '계정 관리 기능(admin-users Edge Function)이 아직 배포되지 않았습니다. README의 설치 순서를 확인해 주세요.',
    USER_NOT_FOUND: '사용자를 찾을 수 없습니다.',
    CANNOT_CHANGE_SELF: '본인의 역할·지점·사용 여부는 바꿀 수 없습니다. 다른 관리자에게 요청해 주세요.',
    LAST_ADMIN: '마지막 전체 관리자는 역할을 바꾸거나 중지할 수 없습니다.',
    INVALID_PHOTO: '사진은 JPG·PNG·WEBP 이미지로, 5MB 이하만 올릴 수 있습니다.',
    // Specific codes first: toAppError picks the first key found in the error text.
    INVALID_STAFF_NAME: '이름을 1~30자로 입력해 주세요.',
    INVALID_STAFF_POSITION: '이 직급을 저장할 수 없습니다. 직급 이름이 바뀐 뒤 데이터베이스가 아직 옛 설정이면 생기는 문제입니다. Supabase SQL Editor에서 최신 schema.sql을 다시 실행해 주세요.',
    INVALID_STAFF_RATE: '인센티브는 0~100% 사이로 입력해 주세요.',
    INVALID_STAFF_DATES: '퇴사일은 입사일과 같거나 그 이후여야 합니다.',
    INVALID_STAFF_LEAVE: '연차 일수는 0~60일 사이로 입력해 주세요.',
    INVALID_STAFF_PICK: '선택한 담당 디자이너를 이 지점에서 찾을 수 없습니다. 새로고침 후 다시 선택해 주세요.',
    INVALID_STAFF: '직원 정보를 저장하지 못했습니다. 직급·근무 상태·담당 시술·휴무 요일을 확인해 주세요. 계속되면 데이터베이스가 최신이 아닐 수 있으니 Supabase SQL Editor에서 최신 schema.sql을 다시 실행해 주세요.',
    STAFF_NOT_FOUND: '직원 정보를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.',
    INVALID_SCHEDULE: '근무표 항목을 다시 선택해 주세요.',
    INVALID_AMOUNT: '금액과 건수는 0 이상으로 입력해 주세요. 조정액은 ±1억 원까지입니다.',
    MONTH_CONFIRMED: '정산이 확정된 달입니다. 수정하려면 전체 관리자가 확정을 취소해야 합니다.',
    SCHEMA_OUTDATED: '데이터베이스 설정이 최신이 아닙니다. Supabase SQL Editor에서 최신 schema.sql을 다시 실행해 주세요.',
    PHOTO_UPLOAD_FAILED: '사진을 올리지 못했습니다. 잠시 후 다시 시도해 주세요.',
  };

  // Next product code for a category (mirrors next_sku() in schema.sql): 클리닉 → CN-004
  const SKU_PREFIX = { '염모제': 'CL', '펌제': 'PM', '샴푸·트리트먼트': 'SH', '클리닉': 'CN', '판매용 홈케어': 'RT', '소모품': 'SP', '도구': 'TL' };
  function nextSku(category, skus) {
    const pre = SKU_PREFIX[String(category || '').trim()] || 'P';
    const re = new RegExp(`^${pre}-(\\d+)$`);
    const max = skus.reduce((m, s) => { const x = re.exec(s || ''); return x ? Math.max(m, Number(x[1])) : m; }, 0);
    return `${pre}-${String(max + 1).padStart(3, '0')}`;
  }

  class AppError extends Error {
    constructor(code, message) {
      super(message || MESSAGES[code] || code);
      this.code = code;
    }
  }

  function toAppError(e) {
    if (e instanceof AppError) return e;
    const text = (e && (e.message || e.error_description || e.msg)) || String(e);
    const code = Object.keys(MESSAGES).find((k) => text.includes(k));
    if (code) return new AppError(code);
    if (/invalid login credentials/i.test(text)) return new AppError('LOGIN_FAILED', '아이디(이메일) 또는 비밀번호가 올바르지 않습니다.');
    if (/email not confirmed/i.test(text)) return new AppError('LOGIN_FAILED', '이메일 인증이 끝나지 않았습니다. 받은편지함의 인증 메일을 확인해 주세요.');
    if (/could not find the function|schema cache|column .* does not exist|bucket not found/i.test(text)) return new AppError('SCHEMA_OUTDATED', `${MESSAGES.SCHEMA_OUTDATED} (${text})`);
    if (/row-level security|unauthorized/i.test(text)) return new AppError('FORBIDDEN');
    if (/payload too large|exceeded the maximum|mime type/i.test(text)) return new AppError('INVALID_PHOTO');
    if (/rate limit/i.test(text)) return new AppError('RATE_LIMIT', '요청이 너무 많습니다. 몇 분 뒤 다시 시도해 주세요.');
    if (/failed to fetch|networkerror|load failed/i.test(text)) return new AppError('NETWORK', '서버에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.');
    return new AppError('UNKNOWN', `요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요. (${text})`);
  }

  // Start of the KST day `days - 1` days ago (Korea has no DST: UTC+9).
  const DAY = 86400000, KST = 9 * 3600000;
  function sinceIso(days) {
    const midnight = Math.floor((Date.now() + KST) / DAY) * DAY - KST;
    return new Date(midnight - (days - 1) * DAY).toISOString();
  }

  // Accepts an ID ("h001") or an email. IDs map to <id>@<loginDomain> so that
  // Supabase Auth, which signs in by email, can hold ID-style accounts.
  const LOGIN_DOMAIN = (cfg.loginDomain || 'hplace.local').toLowerCase();
  const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,29}$/i;
  const normLoginId = (v) => String(v || '').trim().toLowerCase();
  const passwordOk = (v) => typeof v === 'string' && v.length >= 6 && v.length <= 72;
  function toLoginEmail(input) {
    const v = String(input || '').trim().toLowerCase();
    return v.includes('@') ? v : `${v}@${LOGIN_DOMAIN}`;
  }
  const isLoginId = (input) => ID_PATTERN.test(String(input || '').trim());

  // ------------------------------------------------------------------
  // Supabase
  // ------------------------------------------------------------------
  function supabaseApi() {
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    const photos = sb.storage.from('branch-photos');
    const staffPhotos = sb.storage.from('staff-photos');
    const photoUrl = (path) => (path ? photos.getPublicUrl(path).data.publicUrl : null);
    // Branches are read with select('*') so sign-in still works on a database
    // set up before photo_path existed (the photo feature then asks for setup).
    const withPhoto = (b) => ({ ...b, photo_url: photoUrl(b.photo_path) });
    const run = async (promise) => {
      let res;
      try { res = await promise; } catch (e) { throw toAppError(e); }
      if (res.error) throw toAppError(res.error);
      return res.data;
    };

    return {
      mode: 'supabase',
      nextSku,
      async getUser() {
        const { data } = await sb.auth.getSession();
        return data.session ? data.session.user : null;
      },
      onAuthChange(cb) {
        sb.auth.onAuthStateChange((event, session) => cb(event, session ? session.user : null));
      },
      async signIn(login, password) {
        await run(sb.auth.signInWithPassword({ email: toLoginEmail(login), password }));
      },
      async signOut() {
        await sb.auth.signOut();
      },
      async getContext(user) {
        const profile = await run(sb.from('profiles').select('user_id, email, login_id, full_name, role, branch_id, active').eq('user_id', user.id).maybeSingle());
        if (!profile || !profile.active) return { profile, branches: [] };
        // RLS returns only the branches this user may see (all of them for admins).
        const branches = await run(sb.from('branches').select('*').order('code'));
        return { profile, branches: branches.map(withPhoto) };
      },
      // Active branch managers (지점 담당자); RLS limits managers to their own branch.
      listBranchManagers: () =>
        run(sb.from('profiles').select('branch_id, full_name, login_id').eq('role', 'manager').eq('active', true).not('branch_id', 'is', null).order('full_name')),
      // Staff photos are private: rows get a signed link valid for an hour.
      async listStaff(branchId) {
        const rows = await run(sb.from('staff').select('*').eq('branch_id', branchId).order('name'));
        const paths = rows.map((r) => r.photo_path).filter(Boolean);
        if (paths.length) {
          const { data } = await staffPhotos.createSignedUrls(paths, 3600);
          const urls = new Map((data || []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
          rows.forEach((r) => { r.photo_url = urls.get(r.photo_path) || null; });
        }
        return rows;
      },
      async setStaffPhoto(x, blob) {
        const path = `${x.branch_id}/${x.id}/${Date.now().toString(36)}.jpg`;
        await run(staffPhotos.upload(path, blob, { contentType: blob.type, upsert: false }));
        let old;
        try {
          old = await run(sb.rpc('set_staff_photo', { p_staff_id: x.id, p_path: path }));
        } catch (e) {
          await staffPhotos.remove([path]).catch(() => {});
          throw e;
        }
        if (old && old !== path) await staffPhotos.remove([old]).catch(() => {});
      },
      async removeStaffPhoto(x) {
        const old = await run(sb.rpc('set_staff_photo', { p_staff_id: x.id, p_path: null }));
        if (old) await staffPhotos.remove([old]).catch(() => {});
      },
      saveStaff: (x) =>
        run(sb.rpc('save_staff', {
          p_id: x.id || null, p_branch_id: x.branch_id, p_name: x.name, p_position: x.position, p_phone: x.phone || null,
          p_hired_on: x.hired_on || null, p_status: x.status, p_left_on: x.left_on || null, p_services: x.services || [],
          p_days_off: x.days_off || [], p_incentive_service: x.incentive_service ?? null, p_incentive_retail: x.incentive_retail ?? null,
          p_license_no: x.license_no || null, p_health_cert_expires: x.health_cert_expires || null, p_memo: x.memo || null,
          p_annual_leave_days: x.annual_leave_days ?? null,
        })),
      async deleteStaff(id) {
        const path = await run(sb.rpc('delete_staff', { p_id: id }));
        if (path) await staffPhotos.remove([path]).catch(() => {});
      },
      listBranches: async () => (await run(sb.from('branches').select('*').order('code'))).map(withPhoto),
      // Uploads a new photo, points the branch at it, then deletes the old file.
      async setBranchPhoto(branchId, blob) {
        const ext = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/png' ? 'png' : 'jpg';
        const path = `${branchId}/${Date.now().toString(36)}.${ext}`;
        await run(photos.upload(path, blob, { contentType: blob.type, cacheControl: '31536000', upsert: false }));
        let old;
        try {
          old = await run(sb.rpc('set_branch_photo', { p_branch_id: branchId, p_path: path }));
        } catch (e) {
          await photos.remove([path]).catch(() => {});
          throw e;
        }
        if (old && old !== path) await photos.remove([old]).catch(() => {});
        return photoUrl(path);
      },
      async removeBranchPhoto(branchId) {
        const old = await run(sb.rpc('set_branch_photo', { p_branch_id: branchId, p_path: null }));
        if (old) await photos.remove([old]).catch(() => {});
      },
      // Works before sign-in (granted to anon); failures just mean no photo.
      async loginPhotos() {
        try {
          const rows = await run(sb.rpc('login_photos'));
          return (rows || []).map((r) => ({ id: r.id, name: r.name, url: photoUrl(r.photo_path) }));
        } catch (e) { return []; }
      },
      listCategories: () => run(sb.from('categories').select('id, name, sort_order').order('sort_order').order('name')),
      saveCategory: (id, name) => run(sb.rpc('save_category', { p_category_id: id || null, p_name: name })),
      deleteCategory: (id) => run(sb.rpc('delete_category', { p_category_id: id })),
      reorderCategories: (ids) => run(sb.rpc('reorder_categories', { p_ids: ids })),
      // active = usable here: on in the catalog (catalog_active) and 사용 중 at this branch (in_use)
      listInventory: async (branchId) =>
        (await run(sb.from('inventory_view').select('*').eq('branch_id', branchId).order('category').order('name')))
          .map((r) => ({ ...r, catalog_active: r.active, in_use: r.in_use !== false, active: r.active && r.in_use !== false })),
      setItemInUse: (branchId, productId, inUse) =>
        run(sb.rpc('set_item_in_use', { p_branch_id: branchId, p_product_id: productId, p_in_use: inUse })),
      listMovements: (branchId, days) =>
        run(sb.from('movement_view').select('*').eq('branch_id', branchId)
          .gte('created_at', sinceIso(days))
          .order('created_at', { ascending: false }).order('id', { ascending: false })
          .limit(3000)),
      recordMovement: ({ branchId, productId, type, quantity, memo, staffId }) =>
        run(sb.rpc('record_movement', {
          p_branch_id: branchId, p_product_id: productId, p_type: type,
          p_quantity: quantity, p_memo: memo || null, p_staff_id: staffId || null,
        })),
      listStaffNames: (branchId) => run(sb.rpc('list_staff_names', { p_branch_id: branchId })),
      listSchedule: (branchId, from, to) =>
        run(sb.from('staff_schedule').select('staff_id, day, kind, memo').eq('branch_id', branchId).gte('day', from).lte('day', to)),
      setSchedule: (staffId, day, kind, memo) =>
        run(sb.rpc('set_schedule', { p_staff_id: staffId, p_day: day, p_kind: kind || null, p_memo: memo || null })),
      staffMonthReport: (branchId, month) => run(sb.rpc('staff_month_report', { p_branch_id: branchId, p_month: month })),
      saveStaffMonth: (staffId, month, v) =>
        run(sb.rpc('save_staff_month', {
          p_staff_id: staffId, p_month: month, p_service_sales: v.service_sales, p_service_count: v.service_count,
          p_adjustment: v.adjustment, p_memo: v.memo || null,
        })),
      confirmPayroll: (branchId, month) => run(sb.rpc('confirm_payroll', { p_branch_id: branchId, p_month: month })),
      reopenPayroll: (branchId, month) => run(sb.rpc('reopen_payroll', { p_branch_id: branchId, p_month: month })),
      revertMovement: (id) => run(sb.rpc('revert_movement', { p_movement_id: id })),
      saveProduct: (branchId, p) =>
        run(sb.rpc('save_product', {
          p_branch_id: branchId, p_product_id: p.productId || null, p_sku: p.sku, p_name: p.name,
          p_brand: p.brand || null, p_category: p.category, p_unit: p.unit,
          p_cost_price: p.costPrice, p_retail_price: p.retailPrice, p_is_retail: p.isRetail,
          p_safety_stock: p.safetyStock, p_location: p.location || null, p_active: p.active,
        })),
      setBranchItem: (branchId, productId, safetyStock, location) =>
        run(sb.rpc('set_branch_item', { p_branch_id: branchId, p_product_id: productId, p_safety_stock: safetyStock, p_location: location || null })),
      saveBranch: (b) =>
        run(sb.rpc('save_branch', {
          p_branch_id: b.id || null, p_code: b.code, p_name: b.name,
          p_phone: b.phone || null, p_address: b.address || null, p_active: b.active,
        })),
      listUsers: (branchId) => run(sb.rpc('list_users', { p_branch_id: branchId || null })),
      // Account operations that need the service role run in the admin-users
      // Edge Function; it answers { error: CODE } on failure.
      async adminUsers(body) {
        let res;
        try { res = await sb.functions.invoke('admin-users', { body }); } catch (e) { throw toAppError(e); }
        if (!res.error) return res.data;
        let code = null;
        try { code = (await res.error.context.json()).error; } catch (e) { /* no JSON body */ }
        if (!code && res.error.context && res.error.context.status === 404) code = 'FUNCTION_NOT_DEPLOYED';
        if (!code && /failed to send a request|relay error/i.test(res.error.message || '')) code = 'FUNCTION_NOT_DEPLOYED';
        throw toAppError(code || res.error);
      },
      createUser(u) {
        return this.adminUsers({ action: 'create', loginId: normLoginId(u.loginId), password: u.password, fullName: u.fullName, role: u.role, branchId: u.branchId || null });
      },
      changeLoginId(userId, loginId) {
        return this.adminUsers({ action: 'change_login', userId, loginId: normLoginId(loginId) });
      },
      setPassword(userId, password) {
        return this.adminUsers({ action: 'set_password', userId, password });
      },
      updateUser: ({ userId, fullName, branchId, role, active }) =>
        run(sb.rpc('update_user', { p_user_id: userId, p_full_name: fullName || null, p_branch_id: branchId || null, p_role: role, p_active: active })),
    };
  }

  // ------------------------------------------------------------------
  // Demo store (same catalog as supabase/seed.sql, plus a second branch and
  // sample users so every role can be tried)
  // ------------------------------------------------------------------
  const DEMO_KEY = 'hplace-salon-demo-v7';
  const PERSONA = { admin: 'u-admin', manager: 'u-mgr1', staff: 'u-staff1' };

  const CATALOG = [
    // sku, name, category, unit, cost, retail, isRetail, stock, safety, location
    ['CL-6N', '새치 염모제 6N 80g', '염모제', '개', 6800, null, false, 18, 12, '염색실 A'],
    ['CL-5NB', '새치 염모제 5NB 80g', '염모제', '개', 6800, null, false, 9, 10, '염색실 A'],
    ['CL-8B', '멋내기 염모제 8B 80g', '염모제', '개', 7200, null, false, 14, 8, '염색실 A'],
    ['CL-7AS', '멋내기 염모제 7Ash 80g', '염모제', '개', 7200, null, false, 0, 6, '염색실 A'],
    ['CL-BLP', '탈색 파우더 500g', '염모제', '통', 21000, null, false, 3, 4, '염색실 B'],
    ['CL-OX6', '산화제 6% 1000ml', '염모제', '병', 8500, null, false, 11, 6, '염색실 B'],
    ['CL-OX3', '산화제 3% 1000ml', '염모제', '병', 8500, null, false, 7, 4, '염색실 B'],
    ['PM-S1', '셋팅펌 1제 400ml', '펌제', '병', 11000, null, false, 6, 5, '펌 선반'],
    ['PM-S2', '셋팅펌 2제 400ml', '펌제', '병', 9000, null, false, 8, 5, '펌 선반'],
    ['PM-MG1', '매직 스트레이트 1제 500g', '펌제', '통', 18500, null, false, 2, 3, '펌 선반'],
    ['PM-NT', '열펌 중화제 500ml', '펌제', '병', 9800, null, false, 5, 3, '펌 선반'],
    ['SH-PRO', '업소용 샴푸 1500ml', '샴푸·트리트먼트', '병', 19000, null, false, 4, 4, '샴푸대'],
    ['SH-TRT', '업소용 트리트먼트 1000ml', '샴푸·트리트먼트', '병', 22000, null, false, 6, 3, '샴푸대'],
    ['SH-SCP', '두피 스케일링 샴푸 1000ml', '샴푸·트리트먼트', '병', 26000, null, false, 0, 2, '샴푸대'],
    ['CN-PPT', 'PPT 단백질 앰플 (10개입)', '클리닉', '박스', 15000, null, false, 5, 3, '클리닉장'],
    ['CN-KRT', '케라틴 클리닉 앰플 (10개입)', '클리닉', '박스', 18000, null, false, 3, 3, '클리닉장'],
    ['CN-SCP', '두피 토닉 앰플 (10개입)', '클리닉', '박스', 16500, null, false, 4, 2, '클리닉장'],
    ['RT-ESS', '헤어 에센스 100ml', '판매용 홈케어', '개', 9500, 24000, true, 12, 6, '카운터'],
    ['RT-OIL', '헤어 오일 50ml', '판매용 홈케어', '개', 8800, 22000, true, 4, 6, '카운터'],
    ['RT-SHP', '홈케어 샴푸 500ml', '판매용 홈케어', '개', 11000, 28000, true, 9, 4, '카운터'],
    ['RT-WAX', '스타일링 왁스 80g', '판매용 홈케어', '개', 6200, 16000, true, 7, 4, '카운터'],
    ['SP-FOIL', '염색 호일 롤 (30m)', '소모품', '롤', 7500, null, false, 6, 4, '창고'],
    ['SP-GLV', '일회용 니트릴 장갑 (100매)', '소모품', '박스', 9000, null, false, 3, 4, '창고'],
    ['SP-CAPE', '일회용 염색 케이프 (100매)', '소모품', '팩', 12000, null, false, 5, 3, '창고'],
    ['SP-NECK', '넥 페이퍼 (5롤)', '소모품', '팩', 6500, null, false, 8, 3, '창고'],
    ['SP-CAP', '비닐 헤어캡 (100매)', '소모품', '팩', 4500, null, false, 6, 3, '창고'],
    ['SP-TWL', '페이스 타월 (10매)', '소모품', '팩', 8000, null, false, 10, 5, '창고'],
    ['TL-BR', '롤 브러시 43mm', '도구', '개', 14000, null, false, 4, 2, '디자이너 서랍'],
    ['TL-CLP', '섹션 클립 (12개)', '도구', '세트', 7000, null, false, 3, 2, '디자이너 서랍'],
    ['TL-BWL', '염색 볼 · 브러시 세트', '도구', '세트', 5500, null, false, 6, 3, '염색실 A'],
  ];

  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Sample staff (same people as supabase/seed.sql for 1호점, plus 2호점)
  function buildDemoStaff() {
    const d = (days) => new Date(Date.now() + days * DAY + KST).toISOString().slice(0, 10);
    const row = (id, branch, name, position, phone, hired, services, days, s, r, license, cert, memo = null) => ({
      id, branch_id: branch, name, position, phone, hired_on: d(-hired), status: 'active', left_on: null, services, days_off: days,
      incentive_service: s, incentive_retail: r, license_no: license, health_cert_expires: cert == null ? null : d(cert), memo,
    });
    return [
      row('st1', 'br01', '한서윤', 'head_director', '010-1234-0001', 2900, ['color', 'cut', 'perm', 'updo'], [1], 45, 10, '서울-2015-01234', 200, '웨딩·업스타일 예약은 원장님 직접'),
      row('st2', 'br01', '정다은', 'deputy', '010-1234-0002', 1650, ['clinic', 'color', 'cut'], [1, 4], 40, 10, '서울-2018-04521', 18),
      row('st3', 'br01', '김도윤', 'stylist', '010-1234-0003', 820, ['cut', 'perm', 'styling'], [2], 35, 8, '경기-2020-11873', 95),
      row('st4', 'br01', '이하린', 'designer', '010-1234-0004', 400, ['clinic', 'color', 'scalp'], [3], 35, 8, '서울-2022-07765', -12),
      row('st5', 'br01', '박지후', 'staff', '010-1234-0005', 150, ['scalp', 'styling'], [1], null, 5, null, 240, '디자이너 승급 평가 예정'),
      row('st6', 'br01', '최유진', 'staff', '010-1234-0006', 300, [], [0], null, 3, null, null),
      { ...row('st7', 'br01', '오세라', 'designer', '010-1234-0007', 1300, ['cut', 'perm'], [5], 35, 8, '서울-2019-02210', -200), status: 'left', left_on: d(-60) },
      row('st8', 'br02', '이서연', 'deputy', '010-2345-0001', 1500, ['color', 'cut', 'perm'], [2], 40, 10, '서울-2017-09911', 150),
      row('st9', 'br02', '윤태오', 'senior_stylist', '010-2345-0002', 600, ['cut', 'styling'], [4], 35, 8, '인천-2021-03321', 7),
      { ...row('st10', 'br02', '강민서', 'designer', '010-2345-0003', 500, ['clinic', 'color'], [1], 35, 8, '서울-2022-01188', 300), status: 'leave' },
    ];
  }

  function buildDemoState() {
    const rand = mulberry32(20260924);
    const now = Date.now();
    const iso = (ms) => new Date(ms).toISOString();
    const branches = [
      { id: 'br01', code: 'BR01', name: '1호점', phone: '02-555-0101', address: '서울 강남구 테헤란로 101', active: true },
      { id: 'br02', code: 'BR02', name: '2호점', phone: '02-555-0202', address: '서울 마포구 양화로 202', active: true },
    ];
    const users = [
      { user_id: 'u-admin', login_id: 'h001', full_name: '본사 관리자', role: 'admin', branch_id: null, active: true, created_at: iso(now - 90 * DAY), last_sign_in_at: iso(now - 2 * 3600000) },
      { user_id: 'u-mgr1', login_id: 'm101', full_name: '데모 점장', role: 'manager', branch_id: 'br01', active: true, created_at: iso(now - 80 * DAY), last_sign_in_at: iso(now - 20 * 60000) },
      { user_id: 'u-staff1', login_id: 's101', full_name: '김지수', role: 'staff', branch_id: 'br01', active: true, created_at: iso(now - 60 * DAY), last_sign_in_at: iso(now - 5 * 3600000) },
      { user_id: 'u-staff2', login_id: 's102', full_name: '박민준', role: 'staff', branch_id: 'br01', active: true, created_at: iso(now - 40 * DAY), last_sign_in_at: iso(now - 3 * DAY) },
      { user_id: 'u-staff4', login_id: 's103', full_name: '정하늘', role: 'staff', branch_id: 'br01', active: false, created_at: iso(now - 120 * DAY), last_sign_in_at: iso(now - 45 * DAY) },
      { user_id: 'u-mgr2', login_id: 'm201', full_name: '이서연', role: 'manager', branch_id: 'br02', active: true, created_at: iso(now - 70 * DAY), last_sign_in_at: iso(now - DAY) },
      { user_id: 'u-staff3', login_id: 's201', full_name: '최유나', role: 'staff', branch_id: 'br02', active: true, created_at: iso(now - 30 * DAY), last_sign_in_at: iso(now - 6 * 3600000) },
    ].map((u) => ({ ...u, email: `${u.login_id}@${LOGIN_DOMAIN}` }));
    const products = CATALOG.map(([sku, name, category, unit, cost, retail, isRetail], i) => ({
      id: `p${i + 1}`, sku, name, brand: null, category, unit,
      cost_price: cost, retail_price: retail, is_retail: isRetail, active: true,
    }));
    const inventory = [];
    CATALOG.forEach((c, i) => {
      inventory.push({ branch_id: 'br01', product_id: `p${i + 1}`, stock: c[7], safety_stock: c[8], location: c[9], updated_at: iso(now) });
      inventory.push({ branch_id: 'br02', product_id: `p${i + 1}`, stock: Math.round(rand() * c[8] * 2.2), safety_stock: c[8], location: c[9], updated_at: iso(now) });
    });
    // History built backwards from the current stock, like seed.sql.
    const raw = [];
    const midnight = Math.floor((now + KST) / DAY) * DAY - KST;
    const staffByBranch = { br01: ['u-mgr1', 'u-staff1', 'u-staff2', null], br02: ['u-mgr2', 'u-staff3', null] };
    inventory.forEach((inv) => {
      const p = products.find((x) => x.id === inv.product_id);
      const chance = p.category === '도구' ? 0.1 : 0.55;
      const who = staffByBranch[inv.branch_id];
      let run = inv.stock;
      for (let d = 0; d < 14; d++) {
        const dayStart = midnight - d * DAY;
        if (rand() < chance) {
          const q = 1 + Math.floor(rand() * 2);
          const at = dayStart + 11 * 3600000 + Math.floor(rand() * 480) * 60000;
          if (at < now) {
            raw.push({ branch_id: inv.branch_id, product_id: p.id, type: p.is_retail ? 'sale' : 'use', quantity: -q, stock_after: run, created_at: at, created_by: who[Math.floor(rand() * who.length)] });
            run += q;
          }
        }
        if (rand() < 0.12 && run >= inv.safety_stock) {
          const q = Math.max(inv.safety_stock, 2);
          const at = dayStart + 10 * 3600000;
          if (run - q >= 0 && at < now) {
            raw.push({ branch_id: inv.branch_id, product_id: p.id, type: 'receive', quantity: q, stock_after: run, created_at: at, created_by: who[0] });
            run -= q;
          }
        }
      }
    });
    raw.sort((a, b) => a.created_at - b.created_at);
    let id = 1;
    const movements = raw.map((m) => ({
      id: id++, branch_id: m.branch_id, product_id: m.product_id, type: m.type,
      quantity: m.quantity, stock_after: m.stock_after,
      unit_cost: products.find((x) => x.id === m.product_id).cost_price,
      memo: '샘플 데이터', reverts_id: null, created_by: m.created_by, created_at: iso(m.created_at),
    }));
    const categories = [...new Set(CATALOG.map((c) => c[2]))].map((name, i) => ({ id: `cat${i + 1}`, name, sort_order: (i + 1) * 10 }));
    // 담당 디자이너 on sample 시술 사용·판매, and 판매가 on sample sales
    const staff = buildDemoStaff();
    const designersOf = (b) => staff.filter((x) => x.branch_id === b && x.status === 'active' && x.position !== 'staff');
    movements.forEach((m) => {
      if (m.type !== 'use' && m.type !== 'sale') return;
      const ds = designersOf(m.branch_id);
      if (ds.length) m.staff_id = ds[m.id % ds.length].id;
      if (m.type === 'sale') m.unit_price = products.find((p) => p.id === m.product_id).retail_price;
    });
    // This month's 시술 매출 so far (from the POS) and a few leave days
    const monthKey = new Date(now + KST).toISOString().slice(0, 7) + '-01';
    const staffMonthly = [
      ['st1', 4850000, 52, 0, null], ['st2', 3920000, 47, 0, null], ['st3', 2760000, 58, 0, null],
      ['st4', 2310000, 39, 30000, '고객 추천 이벤트'], ['st8', 3350000, 44, 0, null], ['st9', 1980000, 36, 0, null],
    ].map(([sid, sales, cnt, adj, memo]) => ({
      staff_id: sid, month: monthKey, branch_id: staff.find((x) => x.id === sid).branch_id,
      service_sales: sales, service_count: cnt, adjustment: adj, memo,
    }));
    const ym = monthKey.slice(0, 8);
    const schedule = [
      { staff_id: 'st3', day: `${ym}08`, kind: 'annual', memo: '가족 행사' },
      { staff_id: 'st3', day: `${ym}09`, kind: 'annual', memo: '가족 행사' },
      { staff_id: 'st2', day: `${ym}15`, kind: 'edu', memo: '염색 신제품 교육' },
      { staff_id: 'st4', day: `${ym}22`, kind: 'half', memo: '오후 반차' },
      { staff_id: 'st1', day: `${ym}13`, kind: 'work', memo: '웨딩 예약' },
      { staff_id: 'st5', day: `${ym}19`, kind: 'sick', memo: null },
      { staff_id: 'st8', day: `${ym}12`, kind: 'annual', memo: null },
    ].map((x) => ({ ...x, branch_id: staff.find((s) => s.id === x.staff_id).branch_id }));
    return {
      branches, users, categories, products, inventory, movements, staff, schedule, staffMonthly, payrollMonths: [],
      nextId: id, signedIn: false, meId: PERSONA.manager,
    };
  }

  function demoApi() {
    let state = null;
    let memoryOnly = false;
    try {
      const raw = localStorage.getItem(DEMO_KEY);
      if (raw) state = JSON.parse(raw);
    } catch (e) { memoryOnly = true; }
    if (!state || !Array.isArray(state.users)) state = buildDemoState();
    if (!Array.isArray(state.staff)) state.staff = buildDemoStaff();  // saved before 직원 관리 existed
    ['schedule', 'staffMonthly', 'payrollMonths'].forEach((k) => { if (!Array.isArray(state[k])) state[k] = []; });
    const save = () => {
      if (memoryOnly) return;
      try { localStorage.setItem(DEMO_KEY, JSON.stringify(state)); } catch (e) { memoryOnly = true; }
    };
    const delay = (v) => new Promise((r) => setTimeout(() => r(v), 150));
    const clone = (v) => JSON.parse(JSON.stringify(v));
    const me = () => state.users.find((u) => u.user_id === state.meId) || state.users.find((u) => u.user_id === PERSONA.manager);
    const product = (id) => state.products.find((p) => p.id === id);
    const inv = (branchId, pid) => state.inventory.find((i) => i.branch_id === branchId && i.product_id === pid);
    const statusOf = (i) => (i.stock === 0 ? 'out' : i.stock <= i.safety_stock ? 'low' : 'ok');
    const trimOrNull = (v) => (v == null ? null : String(v).trim() || null);

    // Permission helpers mirroring schema.sql
    const isAdmin = () => me().active && me().role === 'admin';
    const isMember = (b) => me().active && (me().role === 'admin' || me().branch_id === b);
    const isManager = (b) => me().active && (me().role === 'admin' || (me().role === 'manager' && me().branch_id === b));
    const must = (cond, code) => { if (!cond) throw new AppError(code); };

    function insertMovement(row) {
      const m = { id: state.nextId++, created_by: me().user_id, created_at: new Date().toISOString(), reverts_id: null, ...row };
      state.movements.push(m);
      return m;
    }

    return {
      mode: 'demo',
      nextSku,
      get demoRole() { return me().role; },
      setDemoRole(role) { state.meId = PERSONA[role]; save(); },
      async getUser() { return state.signedIn ? { id: me().user_id, email: me().email } : null; },
      onAuthChange() {},
      // Demo: signs in as the account with that ID (h001 = 전체 관리자). Unknown
      // IDs open the branch manager view. Passwords are not checked in the demo.
      async signIn(login) {
        const email = toLoginEmail(login);
        const user = state.users.find((u) => u.email === email);
        state.meId = user ? user.user_id : PERSONA.manager;
        state.signedIn = true;
        save();
        return delay();
      },
      async signOut() { state.signedIn = false; save(); },
      async getContext() {
        const profile = clone(me());
        const branches = profile.role === 'admin' ? state.branches : state.branches.filter((b) => b.id === profile.branch_id);
        return delay({ profile, branches: clone(branches) });
      },
      async listCategories() {
        return delay(clone([...state.categories].sort((a, b) => a.sort_order - b.sort_order)));
      },
      async saveCategory(id, value) {
        must(isAdmin(), 'ADMIN_ONLY');
        const name = String(value || '').trim();
        must(name && name.length <= 30, 'INVALID_CATEGORY');
        must(!state.categories.some((c) => c.name === name && c.id !== id), 'DUPLICATE_CATEGORY');
        if (!id) {
          const c = { id: `cat${Date.now()}`, name, sort_order: Math.max(0, ...state.categories.map((x) => x.sort_order)) + 10 };
          state.categories.push(c);
          save();
          return delay(c.id);
        }
        const c = state.categories.find((x) => x.id === id);
        must(c, 'CATEGORY_NOT_FOUND');
        state.products.forEach((p) => { if (p.category === c.name) p.category = name; });  // like ON UPDATE CASCADE
        c.name = name;
        save();
        return delay(id);
      },
      async deleteCategory(id) {
        must(isAdmin(), 'ADMIN_ONLY');
        const c = state.categories.find((x) => x.id === id);
        must(c, 'CATEGORY_NOT_FOUND');
        must(!state.products.some((p) => p.category === c.name), 'CATEGORY_IN_USE');
        state.categories = state.categories.filter((x) => x.id !== id);
        save();
        return delay();
      },
      async reorderCategories(ids) {
        must(isAdmin(), 'ADMIN_ONLY');
        ids.forEach((id, i) => { const c = state.categories.find((x) => x.id === id); if (c) c.sort_order = (i + 1) * 10; });
        save();
        return delay();
      },
      async listBranches() {
        return delay(clone(isAdmin() ? state.branches : state.branches.filter((b) => b.id === me().branch_id)));
      },
      async listStaff(branchId) {
        return delay(clone(isManager(branchId) ? state.staff.filter((x) => x.branch_id === branchId) : []));
      },
      async saveStaff(x) {
        must(x.branch_id && isManager(x.branch_id), 'FORBIDDEN');
        const row = x.id ? state.staff.find((r) => r.id === x.id) : null;
        must(!x.id || row, 'STAFF_NOT_FOUND');
        if (row) must(isManager(row.branch_id), 'FORBIDDEN');
        const name = String(x.name || '').trim();
        const rate = (v) => v == null || (v >= 0 && v <= 100);
        const status = x.status || 'active';
        must(name && name.length <= 30, 'INVALID_STAFF_NAME');
        must(['head_director', 'chief_deputy', 'deputy', 'senior_stylist', 'stylist', 'designer', 'staff'].includes(x.position), 'INVALID_STAFF_POSITION');
        must(rate(x.incentive_service) && rate(x.incentive_retail), 'INVALID_STAFF_RATE');
        must(!(x.left_on && x.hired_on && x.left_on < x.hired_on), 'INVALID_STAFF_DATES');
        must(x.annual_leave_days == null || (x.annual_leave_days >= 0 && x.annual_leave_days <= 60), 'INVALID_STAFF_LEAVE');
        must(['active', 'leave', 'left'].includes(status)
          && (x.services || []).every((v) => ['cut', 'perm', 'color', 'clinic', 'scalp', 'styling', 'updo'].includes(v))
          && (x.days_off || []).every((v) => Number.isInteger(v) && v >= 0 && v <= 6), 'INVALID_STAFF');
        const today = new Date(Date.now() + KST).toISOString().slice(0, 10);
        const next = {
          id: row ? row.id : `st${Date.now()}`, branch_id: x.branch_id, name, position: x.position, phone: trimOrNull(x.phone),
          hired_on: x.hired_on || null, status, left_on: status === 'left' ? x.left_on || today : null,
          services: [...new Set(x.services || [])].sort(), days_off: [...new Set(x.days_off || [])].sort((a, b) => a - b),
          incentive_service: x.incentive_service ?? null, incentive_retail: x.incentive_retail ?? null,
          license_no: trimOrNull(x.license_no), health_cert_expires: x.health_cert_expires || null, memo: trimOrNull(x.memo),
          annual_leave_days: x.annual_leave_days ?? null,
        };
        if (row) Object.assign(row, next); else state.staff.push(next);
        save();
        return delay(next.id);
      },
      async listStaffNames(branchId) {
        must(isMember(branchId), 'NOT_BRANCH_MEMBER');
        return delay(clone(state.staff.filter((x) => x.branch_id === branchId)
          .map(({ id, name, position, status, days_off, hired_on, left_on }) => ({ id, name, position, status, days_off, hired_on, left_on }))));
      },
      async listSchedule(branchId, from, to) {
        must(isMember(branchId), 'NOT_BRANCH_MEMBER');
        return delay(clone(state.schedule.filter((x) => x.branch_id === branchId && x.day >= from && x.day <= to)));
      },
      async setSchedule(staffId, day, kind, memo) {
        const st = state.staff.find((x) => x.id === staffId);
        must(st, 'STAFF_NOT_FOUND');
        must(isManager(st.branch_id), 'FORBIDDEN');
        must(day && (!kind || ['off', 'work', 'annual', 'half', 'sick', 'edu'].includes(kind)), 'INVALID_SCHEDULE');
        state.schedule = state.schedule.filter((x) => !(x.staff_id === staffId && x.day === day));
        if (kind) state.schedule.push({ branch_id: st.branch_id, staff_id: staffId, day, kind, memo: trimOrNull(memo) });
        save();
        return delay();
      },
      // Mirrors staff_month_report() in schema.sql
      async staffMonthReport(branchId, month) {
        must(isManager(branchId), 'FORBIDDEN');
        const m0 = month.slice(0, 7) + '-01';
        const next = new Date(Date.UTC(+m0.slice(0, 4), +m0.slice(5, 7), 1)).toISOString().slice(0, 10);
        const from = Date.parse(`${m0}T00:00:00Z`) - KST, to = Date.parse(`${next}T00:00:00Z`) - KST;
        const confirmed = state.payrollMonths.some((x) => x.branch_id === branchId && x.month === m0);
        const agg = new Map();
        state.movements.forEach((mv) => {
          const t = Date.parse(mv.created_at);
          if (mv.branch_id !== branchId || !mv.staff_id || t < from || t >= to) return;
          const a = agg.get(mv.staff_id) || { sales: 0, qty: 0, mat: 0 };
          if (mv.type === 'sale') { a.sales += -mv.quantity * (mv.unit_price ?? product(mv.product_id).retail_price ?? 0); a.qty += -mv.quantity; }
          if (mv.type === 'use') a.mat += -mv.quantity * (mv.unit_cost || 0);
          agg.set(mv.staff_id, a);
        });
        const rank = { head_director: 0, chief_deputy: 1, deputy: 2, senior_stylist: 3, stylist: 4, designer: 5, staff: 6 };
        const rows = state.staff.filter((s) => s.branch_id === branchId).map((s) => {
          const sm = state.staffMonthly.find((x) => x.staff_id === s.id && x.month === m0);
          const a = agg.get(s.id);
          const inMonth = (!s.hired_on || s.hired_on < next) && (s.status !== 'left' || !s.left_on || s.left_on >= m0);
          if (confirmed ? !sm : !(sm || a || inMonth)) return null;
          const rs = confirmed ? sm.rate_service_snap : s.incentive_service;
          const rr = confirmed ? sm.rate_retail_snap : s.incentive_retail;
          const ss = sm ? sm.service_sales : 0, sc = sm ? sm.service_count : 0, adj = sm ? sm.adjustment : 0;
          const rsales = confirmed ? sm.retail_sales_snap || 0 : a ? a.sales : 0;
          const iS = Math.round(ss * (rs || 0) / 100), iR = Math.round(rsales * (rr || 0) / 100);
          return {
            staff_id: s.id, name: s.name, position: s.position, status: s.status, rate_service: rs ?? null, rate_retail: rr ?? null,
            service_sales: ss, service_count: sc, adjustment: adj, memo: sm ? sm.memo : null,
            retail_sales: rsales, retail_qty: confirmed ? sm.retail_qty_snap || 0 : a ? a.qty : 0,
            material_cost: confirmed ? sm.material_cost_snap || 0 : a ? a.mat : 0,
            incentive_service: iS, incentive_retail: iR, incentive_total: iS + iR + adj, confirmed,
          };
        }).filter(Boolean).sort((x, y) => rank[x.position] - rank[y.position] || x.name.localeCompare(y.name, 'ko'));
        return delay(clone(rows));
      },
      async saveStaffMonth(staffId, month, v) {
        const st = state.staff.find((x) => x.id === staffId);
        must(st, 'STAFF_NOT_FOUND');
        must(isManager(st.branch_id), 'FORBIDDEN');
        const m0 = month.slice(0, 7) + '-01';
        must(v.service_sales >= 0 && v.service_count >= 0 && Math.abs(v.adjustment || 0) <= 1e8, 'INVALID_AMOUNT');
        must(!state.payrollMonths.some((x) => x.branch_id === st.branch_id && x.month === m0), 'MONTH_CONFIRMED');
        let row = state.staffMonthly.find((x) => x.staff_id === staffId && x.month === m0);
        if (!row) { row = { staff_id: staffId, month: m0, branch_id: st.branch_id }; state.staffMonthly.push(row); }
        Object.assign(row, { service_sales: v.service_sales, service_count: v.service_count, adjustment: v.adjustment || 0, memo: trimOrNull(v.memo) });
        save();
        return delay();
      },
      async confirmPayroll(branchId, month) {
        must(isManager(branchId), 'FORBIDDEN');
        const m0 = month.slice(0, 7) + '-01';
        must(!state.payrollMonths.some((x) => x.branch_id === branchId && x.month === m0), 'MONTH_CONFIRMED');
        const rows = await this.staffMonthReport(branchId, m0);
        rows.forEach((r) => {
          let row = state.staffMonthly.find((x) => x.staff_id === r.staff_id && x.month === m0);
          if (!row) { row = { staff_id: r.staff_id, month: m0, branch_id: branchId, service_sales: 0, service_count: 0, adjustment: 0, memo: null }; state.staffMonthly.push(row); }
          Object.assign(row, { retail_sales_snap: r.retail_sales, retail_qty_snap: r.retail_qty, material_cost_snap: r.material_cost, rate_service_snap: r.rate_service, rate_retail_snap: r.rate_retail });
        });
        state.payrollMonths.push({ branch_id: branchId, month: m0, confirmed_at: new Date().toISOString() });
        save();
        return delay();
      },
      async reopenPayroll(branchId, month) {
        must(isAdmin(), 'ADMIN_ONLY');
        const m0 = month.slice(0, 7) + '-01';
        state.payrollMonths = state.payrollMonths.filter((x) => !(x.branch_id === branchId && x.month === m0));
        save();
        return delay();
      },
      async setStaffPhoto(x, blob) {
        const row = state.staff.find((r) => r.id === x.id);
        must(row, 'STAFF_NOT_FOUND');
        must(isManager(row.branch_id), 'FORBIDDEN');
        must(/^image\/(jpeg|png|webp)$/.test(blob.type) && blob.size <= 5242880, 'INVALID_PHOTO');
        row.photo_url = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = () => reject(new AppError('PHOTO_UPLOAD_FAILED'));
          r.readAsDataURL(blob);
        });
        save();
        return delay();
      },
      async removeStaffPhoto(x) {
        const row = state.staff.find((r) => r.id === x.id);
        must(row, 'STAFF_NOT_FOUND');
        must(isManager(row.branch_id), 'FORBIDDEN');
        delete row.photo_url;
        save();
        return delay();
      },
      async deleteStaff(id) {
        const row = state.staff.find((r) => r.id === id);
        must(row, 'STAFF_NOT_FOUND');
        must(isManager(row.branch_id), 'FORBIDDEN');
        state.staff = state.staff.filter((r) => r.id !== id);
        save();
        return delay();
      },
      async listBranchManagers() {
        return delay(clone(state.users
          .filter((u) => u.role === 'manager' && u.active && u.branch_id && isMember(u.branch_id))
          .map((u) => ({ branch_id: u.branch_id, full_name: u.full_name, login_id: u.login_id }))));
      },
      // Demo photos are stored as data URLs in this browser.
      async setBranchPhoto(branchId, blob) {
        must(isManager(branchId), 'FORBIDDEN');
        const row = state.branches.find((b) => b.id === branchId);
        must(row, 'BRANCH_NOT_FOUND');
        must(/^image\/(jpeg|png|webp)$/.test(blob.type) && blob.size <= 5242880, 'INVALID_PHOTO');
        const url = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = () => reject(new AppError('PHOTO_UPLOAD_FAILED'));
          r.readAsDataURL(blob);
        });
        row.photo_url = url;
        save();
        return delay(url);
      },
      async removeBranchPhoto(branchId) {
        must(isManager(branchId), 'FORBIDDEN');
        const row = state.branches.find((b) => b.id === branchId);
        must(row, 'BRANCH_NOT_FOUND');
        delete row.photo_url;
        save();
        return delay();
      },
      async loginPhotos() {
        return state.branches.filter((b) => b.active !== false && b.photo_url).map((b) => ({ id: b.id, name: b.name, url: b.photo_url }));
      },
      async setItemInUse(branchId, productId, inUse) {
        must(isMember(branchId), 'NOT_BRANCH_MEMBER');
        const row = inv(branchId, productId);
        must(row, 'PRODUCT_NOT_FOUND');
        row.in_use = inUse !== false;
        row.updated_at = new Date().toISOString();
        save();
        return delay();
      },
      async listInventory(branchId) {
        must(isMember(branchId), 'NOT_BRANCH_MEMBER');
        const rows = state.inventory.filter((i) => i.branch_id === branchId).map((i) => {
          const p = product(i.product_id);
          return {
            branch_id: i.branch_id, product_id: p.id, sku: p.sku, name: p.name, brand: p.brand,
            category: p.category, unit: p.unit, cost_price: p.cost_price, retail_price: p.retail_price,
            is_retail: p.is_retail, catalog_active: p.active, in_use: i.in_use !== false, active: p.active && i.in_use !== false,
            stock: i.stock, safety_stock: i.safety_stock,
            location: i.location, updated_at: i.updated_at, status: statusOf(i),
          };
        });
        return delay(clone(rows));
      },
      async listMovements(branchId, days) {
        must(isMember(branchId), 'NOT_BRANCH_MEMBER');
        const since = sinceIso(days);
        const reverted = new Set(state.movements.filter((m) => m.reverts_id).map((m) => m.reverts_id));
        const rows = state.movements
          .filter((m) => m.branch_id === branchId && m.created_at >= since)
          .map((m) => {
            const p = product(m.product_id);
            const u = state.users.find((x) => x.user_id === m.created_by);
            const st = m.staff_id ? state.staff.find((x) => x.id === m.staff_id) : null;
            return { ...m, product_name: p.name, sku: p.sku, unit: p.unit, created_by_name: u ? u.full_name : null, reverted: reverted.has(m.id), staff_name: st ? st.name : null };
          })
          .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id));
        return delay(clone(rows));
      },
      async recordMovement({ branchId, productId, type, quantity, memo, staffId }) {
        must(isMember(branchId), 'NOT_BRANCH_MEMBER');
        must(!staffId || state.staff.some((x) => x.id === staffId && x.branch_id === branchId && x.status !== 'left'), 'INVALID_STAFF_PICK');
        must(type !== 'adjust' || isManager(branchId), 'MANAGER_ONLY');
        must(Number.isInteger(quantity) && quantity >= 0 && (type === 'adjust' || quantity > 0), 'INVALID_QUANTITY');
        const p = product(productId);
        must(p && p.active, 'PRODUCT_NOT_FOUND');
        let row = inv(branchId, productId);
        if (!row) { row = { branch_id: branchId, product_id: productId, stock: 0, safety_stock: 0, location: null }; state.inventory.push(row); }
        const delta = type === 'receive' ? quantity : type === 'adjust' ? quantity - row.stock : -quantity;
        const after = row.stock + delta;
        must(after >= 0, 'INSUFFICIENT_STOCK');
        must(delta !== 0, 'NO_CHANGE');
        row.stock = after;
        row.updated_at = new Date().toISOString();
        const m = insertMovement({
          branch_id: branchId, product_id: productId, type, quantity: delta, stock_after: after, unit_cost: p.cost_price,
          unit_price: type === 'sale' ? p.retail_price : null, staff_id: staffId || null, memo: trimOrNull(memo),
        });
        save();
        return delay(clone(m));
      },
      async revertMovement(id) {
        const mv = state.movements.find((m) => m.id === id);
        must(mv && !mv.reverts_id, 'MOVEMENT_NOT_FOUND');
        must(isMember(mv.branch_id), 'NOT_BRANCH_MEMBER');
        must(!state.movements.some((m) => m.reverts_id === id), 'ALREADY_REVERTED');
        must(isManager(mv.branch_id) || (mv.created_by === me().user_id && Date.now() - Date.parse(mv.created_at) < 10 * 60000), 'REVERT_WINDOW_PASSED');
        const row = inv(mv.branch_id, mv.product_id);
        const after = row.stock - mv.quantity;
        must(after >= 0, 'INSUFFICIENT_STOCK');
        row.stock = after;
        const m = insertMovement({
          branch_id: mv.branch_id, product_id: mv.product_id, type: mv.type, quantity: -mv.quantity, stock_after: after,
          unit_cost: mv.unit_cost, unit_price: mv.unit_price ?? null, staff_id: mv.staff_id ?? null, memo: `취소: #${mv.id}`, reverts_id: mv.id,
        });
        save();
        return delay(clone(m));
      },
      async saveProduct(branchId, p) {
        // New: admin or the branch's manager. Existing (shared catalog): admin only.
        if (p.productId) must(isAdmin(), 'ADMIN_ONLY');
        else must(isAdmin() || (branchId && isManager(branchId)), 'MANAGER_ONLY');
        const sku = (p.sku || '').trim().toUpperCase() || (!p.productId && p.category ? nextSku(p.category, state.products.map((x) => x.sku)) : '');
        must(sku && p.name.trim() && p.category.trim() && p.unit.trim() && p.costPrice >= 0 && (p.retailPrice ?? 0) >= 0 && p.safetyStock >= 0, 'INVALID_PRODUCT');
        must(!state.products.some((x) => x.sku === sku && x.id !== p.productId), 'DUPLICATE_SKU');
        must(state.categories.some((c) => c.name === p.category.trim()), 'CATEGORY_NOT_FOUND');
        let prod = p.productId ? product(p.productId) : null;
        must(!p.productId || prod, 'PRODUCT_NOT_FOUND');
        if (!prod) {
          prod = { id: `p${Date.now()}` };
          state.products.push(prod);
          state.branches.forEach((b) => state.inventory.push({ branch_id: b.id, product_id: prod.id, stock: 0, safety_stock: 0, location: null, updated_at: new Date().toISOString() }));
        }
        Object.assign(prod, {
          sku, name: p.name.trim(), brand: trimOrNull(p.brand), category: p.category.trim(), unit: p.unit.trim(),
          cost_price: p.costPrice, retail_price: p.retailPrice, is_retail: p.isRetail, active: p.active,
        });
        if (branchId) await this.setBranchItem(branchId, prod.id, p.safetyStock, p.location);
        save();
        return delay(prod.id);
      },
      async setBranchItem(branchId, productId, safetyStock, location) {
        must(isManager(branchId), 'MANAGER_ONLY');
        must(Number.isInteger(safetyStock) && safetyStock >= 0, 'INVALID_PRODUCT');
        must(product(productId), 'PRODUCT_NOT_FOUND');
        let row = inv(branchId, productId);
        if (!row) { row = { branch_id: branchId, product_id: productId, stock: 0 }; state.inventory.push(row); }
        row.safety_stock = safetyStock;
        row.location = trimOrNull(location);
        row.updated_at = new Date().toISOString();
        save();
        return delay();
      },
      async saveBranch(b) {
        const admin = isAdmin();
        must(admin || (b.id && isManager(b.id)), 'FORBIDDEN');
        const code = (b.code || '').trim().toUpperCase();
        must((b.name || '').trim() && (!admin || /^[A-Z0-9-]{2,12}$/.test(code)), 'INVALID_BRANCH');
        if (admin) must(!state.branches.some((x) => x.code === code && x.id !== b.id), 'DUPLICATE_BRANCH_CODE');
        let row = b.id ? state.branches.find((x) => x.id === b.id) : null;
        must(!b.id || row, 'BRANCH_NOT_FOUND');
        if (!row) {
          row = { id: `br${Date.now()}` };
          state.branches.push(row);
          state.products.forEach((p) => state.inventory.push({ branch_id: row.id, product_id: p.id, stock: 0, safety_stock: 0, location: null, updated_at: new Date().toISOString() }));
        }
        Object.assign(row, { name: b.name.trim(), phone: trimOrNull(b.phone), address: trimOrNull(b.address) });
        if (admin) Object.assign(row, { code, active: b.active !== false });
        state.branches.sort((x, y) => x.code.localeCompare(y.code));
        save();
        return delay(row.id);
      },
      async listUsers(branchId) {
        must(isAdmin() || (branchId && isManager(branchId)), 'FORBIDDEN');
        const rows = state.users
          .filter((u) => !branchId || u.branch_id === branchId)
          .map((u) => ({ ...u, branch_name: state.branches.find((b) => b.id === u.branch_id)?.name || null }));
        return delay(clone(rows));
      },
      async createUser(u) {
        must(isAdmin(), 'ADMIN_ONLY');
        const loginId = normLoginId(u.loginId);
        must(ID_PATTERN.test(loginId), 'INVALID_LOGIN_ID');
        must(passwordOk(u.password), 'WEAK_PASSWORD');
        must(['staff', 'manager', 'admin'].includes(u.role), 'INVALID_ROLE');
        const branch = u.role === 'admin' ? null : u.branchId;
        must(u.role === 'admin' || state.branches.some((b) => b.id === branch && b.active), 'BRANCH_NOT_FOUND');
        must(!state.users.some((x) => x.login_id === loginId), 'LOGIN_ID_TAKEN');
        const user = {
          user_id: `u${Date.now()}`, login_id: loginId, email: `${loginId}@${LOGIN_DOMAIN}`,
          full_name: trimOrNull(u.fullName) || loginId, role: u.role, branch_id: branch, active: true,
          created_at: new Date().toISOString(), last_sign_in_at: null,
        };
        state.users.push(user);
        save();
        return delay({ userId: user.user_id, loginId });
      },
      async changeLoginId(userId, value) {
        must(isAdmin(), 'ADMIN_ONLY');
        const t = state.users.find((u) => u.user_id === userId);
        must(t, 'USER_NOT_FOUND');
        const loginId = normLoginId(value);
        must(ID_PATTERN.test(loginId), 'INVALID_LOGIN_ID');
        must(!state.users.some((x) => x.login_id === loginId && x.user_id !== userId), 'LOGIN_ID_TAKEN');
        Object.assign(t, { login_id: loginId, email: `${loginId}@${LOGIN_DOMAIN}` });
        save();
        return delay({ userId, loginId });
      },
      async setPassword(userId, password) {
        must(isAdmin(), 'ADMIN_ONLY');
        must(state.users.some((u) => u.user_id === userId), 'USER_NOT_FOUND');
        must(passwordOk(password), 'WEAK_PASSWORD');
        // The demo does not check passwords at sign-in, so nothing is stored.
        return delay({ userId });
      },
      async updateUser({ userId, fullName, branchId, role, active }) {
        const t = state.users.find((u) => u.user_id === userId);
        must(t, 'USER_NOT_FOUND');
        const branch = role === 'admin' ? null : branchId || null;
        if (userId === me().user_id) {
          must(t.role === role && t.branch_id === branch && t.active === active, 'CANNOT_CHANGE_SELF');
        } else if (isAdmin()) {
          must(!branch || state.branches.some((b) => b.id === branch), 'BRANCH_NOT_FOUND');
          const admins = state.users.filter((u) => u.role === 'admin' && u.active).length;
          must(!(t.role === 'admin' && t.active && (role !== 'admin' || !active) && admins <= 1), 'LAST_ADMIN');
        } else {
          must(t.role !== 'admin' && t.branch_id && isManager(t.branch_id) && ['staff', 'manager'].includes(role) && (!branch || branch === t.branch_id), 'FORBIDDEN');
        }
        Object.assign(t, { full_name: trimOrNull(fullName) || t.full_name, branch_id: branch, role, active });
        save();
        return delay();
      },
      resetDemo() {
        const meId = state.meId;
        state = buildDemoState();
        state.signedIn = true;
        if (state.users.some((u) => u.user_id === meId)) state.meId = meId;
        save();
      },
    };
  }

  const configured = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
  let api;
  if (configured && window.supabase && typeof window.supabase.createClient === 'function') {
    api = supabaseApi();
  } else {
    api = demoApi();
    api.configProblem = configured ? 'Supabase 라이브러리를 불러오지 못해 데모 모드로 실행 중입니다.' : null;
  }
  api.AppError = AppError;
  api.toLoginEmail = toLoginEmail;
  api.isLoginId = isLoginId;
  api.loginDomain = LOGIN_DOMAIN;
  api.toAppError = toAppError;
  window.inventoryApi = api;
})();
