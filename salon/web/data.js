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
    INVALID_BRANCH: '지점 정보를 확인해 주세요. 지점 코드는 영문 대문자·숫자·하이픈 2~12자입니다.',
    DUPLICATE_BRANCH_CODE: '이미 사용 중인 지점 코드입니다.',
    BRANCH_NOT_FOUND: '지점을 찾을 수 없거나 사용 중지된 지점입니다.',
    INVALID_EMAIL: '이메일 형식이 올바르지 않습니다.',
    USER_EXISTS: '이미 다른 지점에 배정된 사용자입니다. 전체 관리자에게 이동을 요청해 주세요.',
    INVITE_EXISTS: '이 이메일로 보낸 초대가 이미 대기 중입니다.',
    INVITE_NOT_FOUND: '초대를 찾을 수 없습니다. 이미 수락되었거나 취소되었습니다.',
    USER_NOT_FOUND: '사용자를 찾을 수 없습니다.',
    CANNOT_CHANGE_SELF: '본인의 역할·지점·사용 여부는 바꿀 수 없습니다. 다른 관리자에게 요청해 주세요.',
    LAST_ADMIN: '마지막 전체 관리자는 역할을 바꾸거나 중지할 수 없습니다.',
  };

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
    if (/invalid login credentials/i.test(text)) return new AppError('LOGIN_FAILED', '이메일 또는 비밀번호가 올바르지 않습니다.');
    if (/email not confirmed/i.test(text)) return new AppError('LOGIN_FAILED', '이메일 인증이 끝나지 않았습니다. 받은편지함의 인증 메일을 확인해 주세요.');
    if (/already registered|already been registered/i.test(text)) return new AppError('SIGNUP_FAILED', '이미 가입된 이메일입니다. 로그인해 주세요.');
    if (/password should be|weak password/i.test(text)) return new AppError('SIGNUP_FAILED', '비밀번호가 너무 짧거나 단순합니다. 8자 이상으로 입력해 주세요.');
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
  const INVITE_DAYS = 14;
  const inviteOpen = (i) => !i.accepted_at && Date.parse(i.created_at) > Date.now() - INVITE_DAYS * DAY;

  // ------------------------------------------------------------------
  // Supabase
  // ------------------------------------------------------------------
  function supabaseApi() {
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    const run = async (promise) => {
      let res;
      try { res = await promise; } catch (e) { throw toAppError(e); }
      if (res.error) throw toAppError(res.error);
      return res.data;
    };

    return {
      mode: 'supabase',
      async getUser() {
        const { data } = await sb.auth.getSession();
        return data.session ? data.session.user : null;
      },
      onAuthChange(cb) {
        sb.auth.onAuthStateChange((event, session) => cb(event, session ? session.user : null));
      },
      async signIn(email, password) {
        await run(sb.auth.signInWithPassword({ email, password }));
      },
      // Returns true when the user is signed in right away, false when the
      // project requires email confirmation first.
      async signUp(email, password, fullName) {
        const data = await run(sb.auth.signUp({
          email, password,
          options: { data: { full_name: fullName }, emailRedirectTo: location.origin + location.pathname },
        }));
        return Boolean(data.session);
      },
      async signOut() {
        await sb.auth.signOut();
      },
      async getContext(user) {
        const profile = await run(sb.from('profiles').select('user_id, email, full_name, role, branch_id, active').eq('user_id', user.id).maybeSingle());
        if (!profile || !profile.active) return { profile, branches: [] };
        // RLS returns only the branches this user may see (all of them for admins).
        const branches = await run(sb.from('branches').select('id, code, name, phone, address, active').order('code'));
        return { profile, branches };
      },
      listBranches: () => run(sb.from('branches').select('id, code, name, phone, address, active').order('code')),
      listInventory: (branchId) =>
        run(sb.from('inventory_view').select('*').eq('branch_id', branchId).order('category').order('name')),
      listMovements: (branchId, days) =>
        run(sb.from('movement_view').select('*').eq('branch_id', branchId)
          .gte('created_at', sinceIso(days))
          .order('created_at', { ascending: false }).order('id', { ascending: false })
          .limit(3000)),
      recordMovement: ({ branchId, productId, type, quantity, memo }) =>
        run(sb.rpc('record_movement', {
          p_branch_id: branchId, p_product_id: productId, p_type: type,
          p_quantity: quantity, p_memo: memo || null,
        })),
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
      async listInvitations(branchId) {
        let query = sb.from('invitations').select('id, email, full_name, branch_id, role, created_at, accepted_at')
          .is('accepted_at', null).order('created_at', { ascending: false });
        if (branchId) query = query.eq('branch_id', branchId);
        const rows = await run(query);
        return rows.filter(inviteOpen);
      },
      inviteUser: ({ email, fullName, branchId, role }) =>
        run(sb.rpc('invite_user', { p_email: email, p_full_name: fullName || null, p_branch_id: branchId || null, p_role: role })),
      cancelInvitation: (id) => run(sb.rpc('cancel_invitation', { p_invitation_id: id })),
      updateUser: ({ userId, fullName, branchId, role, active }) =>
        run(sb.rpc('update_user', { p_user_id: userId, p_full_name: fullName || null, p_branch_id: branchId || null, p_role: role, p_active: active })),
    };
  }

  // ------------------------------------------------------------------
  // Demo store (same catalog as supabase/seed.sql, plus a second branch and
  // sample users so every role can be tried)
  // ------------------------------------------------------------------
  const DEMO_KEY = 'hplace-salon-demo-v2';
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

  function buildDemoState() {
    const rand = mulberry32(20260924);
    const now = Date.now();
    const iso = (ms) => new Date(ms).toISOString();
    const branches = [
      { id: 'br01', code: 'BR01', name: '1호점', phone: '02-555-0101', address: '서울 강남구 테헤란로 101', active: true },
      { id: 'br02', code: 'BR02', name: '2호점', phone: '02-555-0202', address: '서울 마포구 양화로 202', active: true },
    ];
    const users = [
      { user_id: 'u-admin', email: 'hq@hplace.example', full_name: '본사 관리자', role: 'admin', branch_id: null, active: true, created_at: iso(now - 90 * DAY), last_sign_in_at: iso(now - 2 * 3600000) },
      { user_id: 'u-mgr1', email: 'manager1@hplace.example', full_name: '데모 점장', role: 'manager', branch_id: 'br01', active: true, created_at: iso(now - 80 * DAY), last_sign_in_at: iso(now - 20 * 60000) },
      { user_id: 'u-staff1', email: 'jisu@hplace.example', full_name: '김지수', role: 'staff', branch_id: 'br01', active: true, created_at: iso(now - 60 * DAY), last_sign_in_at: iso(now - 5 * 3600000) },
      { user_id: 'u-staff2', email: 'minjun@hplace.example', full_name: '박민준', role: 'staff', branch_id: 'br01', active: true, created_at: iso(now - 40 * DAY), last_sign_in_at: iso(now - 3 * DAY) },
      { user_id: 'u-staff4', email: 'haneul@hplace.example', full_name: '정하늘', role: 'staff', branch_id: 'br01', active: false, created_at: iso(now - 120 * DAY), last_sign_in_at: iso(now - 45 * DAY) },
      { user_id: 'u-mgr2', email: 'manager2@hplace.example', full_name: '이서연', role: 'manager', branch_id: 'br02', active: true, created_at: iso(now - 70 * DAY), last_sign_in_at: iso(now - DAY) },
      { user_id: 'u-staff3', email: 'yuna@hplace.example', full_name: '최유나', role: 'staff', branch_id: 'br02', active: true, created_at: iso(now - 30 * DAY), last_sign_in_at: iso(now - 6 * 3600000) },
      { user_id: 'u-new', email: 'newbie@gmail.example', full_name: '신규 가입자', role: 'staff', branch_id: null, active: true, created_at: iso(now - 3600000), last_sign_in_at: iso(now - 3600000) },
    ];
    const invitations = [
      { id: 'inv1', email: 'seoyoon@hplace.example', full_name: '윤서윤', branch_id: 'br01', role: 'staff', created_at: iso(now - 2 * DAY), accepted_at: null },
      { id: 'inv2', email: 'dohyun@hplace.example', full_name: '강도현', branch_id: 'br02', role: 'staff', created_at: iso(now - 5 * DAY), accepted_at: null },
    ];
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
    return { branches, users, invitations, products, inventory, movements, nextId: id, signedIn: false, demoRole: 'manager' };
  }

  function demoApi() {
    let state = null;
    let memoryOnly = false;
    try {
      const raw = localStorage.getItem(DEMO_KEY);
      if (raw) state = JSON.parse(raw);
    } catch (e) { memoryOnly = true; }
    if (!state || !Array.isArray(state.users)) state = buildDemoState();
    const save = () => {
      if (memoryOnly) return;
      try { localStorage.setItem(DEMO_KEY, JSON.stringify(state)); } catch (e) { memoryOnly = true; }
    };
    const delay = (v) => new Promise((r) => setTimeout(() => r(v), 150));
    const clone = (v) => JSON.parse(JSON.stringify(v));
    const me = () => state.users.find((u) => u.user_id === PERSONA[state.demoRole]);
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
      get demoRole() { return state.demoRole; },
      setDemoRole(role) { state.demoRole = role; save(); },
      async getUser() { return state.signedIn ? { id: me().user_id, email: me().email } : null; },
      onAuthChange() {},
      async signIn() { state.signedIn = true; save(); return delay(); },
      async signUp() { throw new AppError('SIGNUP_FAILED', '데모 모드에서는 가입할 수 없습니다. 로그인한 뒤 화면 위쪽의 "역할 보기"로 역할별 화면을 확인해 주세요.'); },
      async signOut() { state.signedIn = false; save(); },
      async getContext() {
        const profile = clone(me());
        const branches = profile.role === 'admin' ? state.branches : state.branches.filter((b) => b.id === profile.branch_id);
        return delay({ profile, branches: clone(branches) });
      },
      async listBranches() {
        return delay(clone(isAdmin() ? state.branches : state.branches.filter((b) => b.id === me().branch_id)));
      },
      async listInventory(branchId) {
        must(isMember(branchId), 'NOT_BRANCH_MEMBER');
        const rows = state.inventory.filter((i) => i.branch_id === branchId).map((i) => {
          const p = product(i.product_id);
          return {
            branch_id: i.branch_id, product_id: p.id, sku: p.sku, name: p.name, brand: p.brand,
            category: p.category, unit: p.unit, cost_price: p.cost_price, retail_price: p.retail_price,
            is_retail: p.is_retail, active: p.active, stock: i.stock, safety_stock: i.safety_stock,
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
            return { ...m, product_name: p.name, sku: p.sku, unit: p.unit, created_by_name: u ? u.full_name : null, reverted: reverted.has(m.id) };
          })
          .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id));
        return delay(clone(rows));
      },
      async recordMovement({ branchId, productId, type, quantity, memo }) {
        must(isMember(branchId), 'NOT_BRANCH_MEMBER');
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
        const m = insertMovement({ branch_id: branchId, product_id: productId, type, quantity: delta, stock_after: after, unit_cost: p.cost_price, memo: trimOrNull(memo) });
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
        const m = insertMovement({ branch_id: mv.branch_id, product_id: mv.product_id, type: mv.type, quantity: -mv.quantity, stock_after: after, unit_cost: mv.unit_cost, memo: `취소: #${mv.id}`, reverts_id: mv.id });
        save();
        return delay(clone(m));
      },
      async saveProduct(branchId, p) {
        must(isAdmin(), 'ADMIN_ONLY');
        const sku = (p.sku || '').trim().toUpperCase();
        must(sku && p.name.trim() && p.category.trim() && p.unit.trim() && p.costPrice >= 0 && (p.retailPrice ?? 0) >= 0 && p.safetyStock >= 0, 'INVALID_PRODUCT');
        must(!state.products.some((x) => x.sku === sku && x.id !== p.productId), 'DUPLICATE_SKU');
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
      async listInvitations(branchId) {
        const rows = state.invitations.filter((i) => inviteOpen(i)
          && (isAdmin() || (i.role !== 'admin' && i.branch_id && isManager(i.branch_id)))
          && (!branchId || i.branch_id === branchId));
        return delay(clone(rows));
      },
      async inviteUser({ email, fullName, branchId, role }) {
        const e = (email || '').trim().toLowerCase();
        must(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e), 'INVALID_EMAIL');
        const branch = role === 'admin' ? null : branchId;
        if (role === 'admin') must(isAdmin(), 'FORBIDDEN');
        else {
          must(branch && isManager(branch), 'FORBIDDEN');
          must(state.branches.some((b) => b.id === branch && b.active), 'BRANCH_NOT_FOUND');
        }
        const existing = state.users.find((u) => u.email.toLowerCase() === e);
        if (existing) {
          must(!existing.branch_id && existing.role !== 'admin', 'USER_EXISTS');
          Object.assign(existing, { branch_id: branch, role, active: true, full_name: trimOrNull(fullName) || existing.full_name });
          save();
          return delay('assigned');
        }
        state.invitations = state.invitations.filter((i) => !(i.email === e && !i.accepted_at && !inviteOpen(i)));
        must(!state.invitations.some((i) => i.email === e && inviteOpen(i)), 'INVITE_EXISTS');
        state.invitations.unshift({ id: `inv${Date.now()}`, email: e, full_name: trimOrNull(fullName), branch_id: branch, role, created_at: new Date().toISOString(), accepted_at: null });
        save();
        return delay('invited');
      },
      async cancelInvitation(id) {
        const i = state.invitations.find((x) => x.id === id && !x.accepted_at);
        must(i, 'INVITE_NOT_FOUND');
        must(isAdmin() || (i.role !== 'admin' && i.branch_id && isManager(i.branch_id)), 'FORBIDDEN');
        state.invitations = state.invitations.filter((x) => x.id !== id);
        save();
        return delay();
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
        const role = state.demoRole;
        state = buildDemoState();
        state.signedIn = true;
        state.demoRole = role;
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
  api.toAppError = toAppError;
  window.inventoryApi = api;
})();
