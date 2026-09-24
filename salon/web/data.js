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
    MANAGER_ONLY: '점장 이상만 할 수 있는 작업입니다.',
    PRODUCT_NOT_FOUND: '품목을 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.',
    INVALID_QUANTITY: '수량은 1 이상의 정수로 입력해 주세요.',
    UNSUPPORTED_TYPE: '지원하지 않는 구분입니다.',
    INSUFFICIENT_STOCK: '현재고보다 많이 뺄 수 없습니다. 수량을 확인해 주세요.',
    NO_CHANGE: '실사 수량이 현재고와 같아 바꿀 내용이 없습니다.',
    MOVEMENT_NOT_FOUND: '취소할 기록을 찾을 수 없습니다.',
    ALREADY_REVERTED: '이미 취소된 기록입니다.',
    REVERT_WINDOW_PASSED: '본인이 10분 안에 등록한 기록만 취소할 수 있습니다. 점장에게 요청해 주세요.',
    INVALID_PRODUCT: '품목 정보를 다시 확인해 주세요.',
    DUPLICATE_SKU: '이미 사용 중인 품목 코드입니다. 다른 코드를 입력해 주세요.',
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
    if (/failed to fetch|networkerror|load failed/i.test(text)) return new AppError('NETWORK', '서버에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.');
    return new AppError('UNKNOWN', `요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요. (${text})`);
  }

  // Start of the KST day `days - 1` days ago (Korea has no DST: UTC+9).
  const DAY = 86400000, KST = 9 * 3600000;
  function sinceIso(days) {
    const midnight = Math.floor((Date.now() + KST) / DAY) * DAY - KST;
    return new Date(midnight - (days - 1) * DAY).toISOString();
  }

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
      async signOut() {
        await sb.auth.signOut();
      },
      async getContext(user) {
        const profile = await run(sb.from('profiles').select('user_id, full_name, role, branch_id').eq('user_id', user.id).maybeSingle());
        if (!profile) return { profile: null, branches: [] };
        // RLS returns only the branches this user may see (all of them for admins).
        const branches = await run(sb.from('branches').select('id, code, name').order('code'));
        return { profile, branches };
      },
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
    };
  }

  // ------------------------------------------------------------------
  // Demo store (same catalog as supabase/seed.sql)
  // ------------------------------------------------------------------
  const DEMO_KEY = 'hplace-salon-demo-v1';
  const DEMO_USER = { id: 'demo-user', email: 'demo@hplace.example' };
  const DEMO_BRANCH = { id: 'demo-br01', code: 'BR01', name: '1호점' };

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
    const products = CATALOG.map(([sku, name, category, unit, cost, retail, isRetail], i) => ({
      id: `p${i + 1}`, sku, name, brand: null, category, unit,
      cost_price: cost, retail_price: retail, is_retail: isRetail, active: true,
    }));
    const inventory = CATALOG.map((c, i) => ({
      branch_id: DEMO_BRANCH.id, product_id: `p${i + 1}`, stock: c[7], safety_stock: c[8], location: c[9],
      updated_at: new Date().toISOString(),
    }));
    // History built backwards from today, like seed.sql.
    const movements = [];
    const midnight = Math.floor((Date.now() + KST) / DAY) * DAY - KST;
    inventory.forEach((inv) => {
      const p = products.find((x) => x.id === inv.product_id);
      const chance = p.category === '도구' ? 0.1 : 0.55;
      let run = inv.stock;
      for (let d = 0; d < 14; d++) {
        const dayStart = midnight - d * DAY;
        if (rand() < chance) {
          const q = 1 + Math.floor(rand() * 2);
          const at = dayStart + 11 * 3600000 + Math.floor(rand() * 480) * 60000;
          if (at < Date.now()) {
            movements.push({ product_id: p.id, type: p.is_retail ? 'sale' : 'use', quantity: -q, stock_after: run, created_at: at });
            run += q;
          }
        }
        if (rand() < 0.12 && run >= inv.safety_stock) {
          const q = Math.max(inv.safety_stock, 2);
          const at = dayStart + 10 * 3600000;
          if (run - q >= 0 && at < Date.now()) {
            movements.push({ product_id: p.id, type: 'receive', quantity: q, stock_after: run, created_at: at });
            run -= q;
          }
        }
      }
    });
    movements.sort((a, b) => a.created_at - b.created_at);
    let id = 1;
    const rows = movements.map((m) => {
      const p = products.find((x) => x.id === m.product_id);
      return {
        id: id++, branch_id: DEMO_BRANCH.id, product_id: m.product_id, type: m.type,
        quantity: m.quantity, stock_after: m.stock_after, unit_cost: p.cost_price,
        memo: '샘플 데이터', reverts_id: null, created_by: null,
        created_at: new Date(m.created_at).toISOString(),
      };
    });
    return { products, inventory, movements: rows, nextId: id, signedIn: false };
  }

  function demoApi() {
    let state = null;
    let memoryOnly = false;
    try {
      const raw = localStorage.getItem(DEMO_KEY);
      if (raw) state = JSON.parse(raw);
    } catch (e) { memoryOnly = true; }
    if (!state || !Array.isArray(state.products)) state = buildDemoState();
    const save = () => {
      if (memoryOnly) return;
      try { localStorage.setItem(DEMO_KEY, JSON.stringify(state)); } catch (e) { memoryOnly = true; }
    };
    const delay = (v) => new Promise((r) => setTimeout(() => r(v), 180));
    const clone = (v) => JSON.parse(JSON.stringify(v));
    const product = (id) => state.products.find((p) => p.id === id);
    const inv = (pid) => state.inventory.find((i) => i.product_id === pid);
    const statusOf = (i) => (i.stock === 0 ? 'out' : i.stock <= i.safety_stock ? 'low' : 'ok');

    function insertMovement(row) {
      const m = { id: state.nextId++, branch_id: DEMO_BRANCH.id, created_by: DEMO_USER.id, created_at: new Date().toISOString(), reverts_id: null, ...row };
      state.movements.push(m);
      return m;
    }

    return {
      mode: 'demo',
      async getUser() { return state.signedIn ? DEMO_USER : null; },
      onAuthChange() {},
      async signIn() { state.signedIn = true; save(); return delay(); },
      async signOut() { state.signedIn = false; save(); },
      async getContext() {
        return delay({
          profile: { user_id: DEMO_USER.id, full_name: '데모 점장', role: 'manager', branch_id: DEMO_BRANCH.id },
          branches: [DEMO_BRANCH],
        });
      },
      async listInventory() {
        const rows = state.inventory.map((i) => {
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
        const since = sinceIso(days);
        const reverted = new Set(state.movements.filter((m) => m.reverts_id).map((m) => m.reverts_id));
        const rows = state.movements
          .filter((m) => m.created_at >= since)
          .map((m) => {
            const p = product(m.product_id);
            return {
              ...m, product_name: p.name, sku: p.sku, unit: p.unit,
              created_by_name: m.created_by ? '데모 점장' : null, reverted: reverted.has(m.id),
            };
          })
          .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id));
        return delay(clone(rows));
      },
      async recordMovement({ productId, type, quantity, memo }) {
        const p = product(productId);
        if (!p || !p.active) throw new AppError('PRODUCT_NOT_FOUND');
        if (!Number.isInteger(quantity) || quantity < 0 || (type !== 'adjust' && quantity === 0)) throw new AppError('INVALID_QUANTITY');
        let row = inv(productId);
        if (!row) { row = { branch_id: DEMO_BRANCH.id, product_id: productId, stock: 0, safety_stock: 0, location: null }; state.inventory.push(row); }
        const delta = type === 'receive' ? quantity : type === 'adjust' ? quantity - row.stock : -quantity;
        const after = row.stock + delta;
        if (after < 0) throw new AppError('INSUFFICIENT_STOCK');
        if (delta === 0) throw new AppError('NO_CHANGE');
        row.stock = after;
        row.updated_at = new Date().toISOString();
        const m = insertMovement({ product_id: productId, type, quantity: delta, stock_after: after, unit_cost: p.cost_price, memo: (memo || '').trim() || null });
        save();
        return delay(clone(m));
      },
      async revertMovement(id) {
        const mv = state.movements.find((m) => m.id === id);
        if (!mv || mv.reverts_id) throw new AppError('MOVEMENT_NOT_FOUND');
        if (state.movements.some((m) => m.reverts_id === id)) throw new AppError('ALREADY_REVERTED');
        const row = inv(mv.product_id);
        const after = row.stock - mv.quantity;
        if (after < 0) throw new AppError('INSUFFICIENT_STOCK');
        row.stock = after;
        const m = insertMovement({ product_id: mv.product_id, type: mv.type, quantity: -mv.quantity, stock_after: after, unit_cost: mv.unit_cost, memo: `취소: #${mv.id}`, reverts_id: mv.id });
        save();
        return delay(clone(m));
      },
      async saveProduct(branchId, p) {
        const sku = (p.sku || '').trim().toUpperCase();
        if (!sku || !p.name.trim() || !p.category.trim() || !p.unit.trim() || p.costPrice < 0 || (p.retailPrice ?? 0) < 0 || p.safetyStock < 0) throw new AppError('INVALID_PRODUCT');
        if (state.products.some((x) => x.sku === sku && x.id !== p.productId)) throw new AppError('DUPLICATE_SKU');
        let prod = p.productId ? product(p.productId) : null;
        if (p.productId && !prod) throw new AppError('PRODUCT_NOT_FOUND');
        if (!prod) { prod = { id: `p${Date.now()}` }; state.products.push(prod); }
        Object.assign(prod, {
          sku, name: p.name.trim(), brand: (p.brand || '').trim() || null, category: p.category.trim(), unit: p.unit.trim(),
          cost_price: p.costPrice, retail_price: p.retailPrice, is_retail: p.isRetail, active: p.active,
        });
        let row = inv(prod.id);
        if (!row) { row = { branch_id: DEMO_BRANCH.id, product_id: prod.id, stock: 0 }; state.inventory.push(row); }
        row.safety_stock = p.safetyStock;
        row.location = (p.location || '').trim() || null;
        row.updated_at = new Date().toISOString();
        save();
        return delay(prod.id);
      },
      resetDemo() {
        state = buildDemoState();
        state.signedIn = true;
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
