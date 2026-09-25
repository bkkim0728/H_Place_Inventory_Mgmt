(() => {
  'use strict';

  const api = window.inventoryApi;

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const TZ = 'Asia/Seoul';
  const nf = new Intl.NumberFormat('ko-KR');
  const won = new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 });
  const wonCompact = new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', notation: 'compact', maximumFractionDigits: 1 });
  const dayFmt = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', timeZone: TZ });
  const fullFmt = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', timeZone: TZ });
  const timeFmt = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
  const keyFmt = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TZ });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const svgIcon = (id, cls = 'icon') => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const DAY = 86400000, KST = 9 * 3600000;
  const kstMidnight = () => Math.floor((Date.now() + KST) / DAY) * DAY - KST;
  const sinceMs = (days) => kstMidnight() - (days - 1) * DAY;

  const TYPES = {
    receive: { label: '입고', tag: 'receive' },
    use: { label: '시술 사용', tag: 'use' },
    sale: { label: '판매', tag: 'sale' },
    dispose: { label: '폐기', tag: 'dispose' },
    adjust: { label: '재고 실사', tag: 'adjust' },
    transfer_in: { label: '지점 이동 입고', tag: 'receive' },
    transfer_out: { label: '지점 이동 출고', tag: 'use' },
  };
  const OUT_TYPES = ['use', 'sale', 'dispose'];
  const ROLE_LABEL = { staff: '직원', manager: '지점 관리자', admin: '전체 관리자' };
  const roleTag = (r) => `<span class="tag tag-${r}">${ROLE_LABEL[r]}</span>`;
  const STATUS = {
    ok: { label: '정상', icon: 'i-check-circle', rank: 2 },
    low: { label: '부족', icon: 'i-alert', rank: 1 },
    out: { label: '품절', icon: 'i-x-circle', rank: 0 },
  };
  const ROUTES = {
    dashboard: '대시보드',
    inventory: '재고 목록',
    movements: '입출고 내역',
    products: '제품 관리',
    categories: '카테고리 관리',
    staff: '직원 관리',
    users: '사용자 관리',
    branches: '지점 관리',
  };
  const MANAGER_ROUTES = ['products', 'staff', 'users', 'branches'];
  const ADMIN_ROUTES = ['categories'];

  const badge = (s) => `<span class="badge badge-${s}">${svgIcon(STATUS[s].icon)}${STATUS[s].label}</span>`;
  const typeTag = (t) => `<span class="tag tag-${TYPES[t]?.tag || 'adjust'}">${TYPES[t]?.label || t}</span>`;
  const qtyText = (q, unit) => `<span class="qty ${q > 0 ? 'qty-pos' : 'qty-neg'}">${q > 0 ? '+' : '−'}${nf.format(Math.abs(q))}${esc(unit || '')}</span>`;

  const state = {
    user: null,
    profile: null,
    branches: [],
    branch: null,
    inventory: [],
    movements: [],
    route: 'dashboard',
    inv: { q: '', cat: '', status: '', sortKey: 'status', sortDir: 'asc' },
    mv: { q: '', type: '', days: 7 },
    pd: { q: '' },
    us: { q: '', branch: '' },
    users: [],
    categories: [],
    range: 14,
    activeIdx: null,
    loading: false,
  };
  const isManager = () => ['manager', 'admin'].includes(state.profile?.role);
  const isAdmin = () => state.profile?.role === 'admin';
  // Category display order (from 카테고리 관리); unknown names sort last.
  const catRank = (name) => { const i = state.categories.findIndex((c) => c.name === name); return i === -1 ? 1e6 : i; };
  const byCategory = (a, b) => catRank(a) - catRank(b) || a.localeCompare(b, 'ko');
  const branchName = (id) => state.branches.find((b) => b.id === id)?.name || '미배정';
  const activeItems = () => state.inventory.filter((i) => i.active);
  const itemById = (id) => state.inventory.find((i) => i.product_id === id);

  // ------------------------------------------------------------------
  // Screens & auth
  // ------------------------------------------------------------------
  const SCREENS = ['screenLoading', 'screenLogin', 'screenPending', 'screenApp'];
  function show(id) { SCREENS.forEach((s) => { $('#' + s).hidden = s !== id; }); }

  // Sign-in background: the photo of the branch last used on this device,
  // otherwise a random branch photo. Fades in once loaded; no photo → default.
  async function loadLoginPhoto() {
    const layer = $('#loginPhoto');
    const photos = await api.loginPhotos();
    if (!photos.length) { layer.classList.remove('is-on'); $('#screenLogin').classList.remove('has-photo'); return; }
    let last = null;
    try { last = localStorage.getItem('hp-login-branch'); } catch (e) {}
    const pick = photos.find((p) => p.id === last) || photos[Math.floor(Math.random() * photos.length)];
    if (layer.dataset.url === pick.url) return;
    const img = new Image();
    img.onload = () => {
      layer.dataset.url = pick.url;
      layer.style.backgroundImage = `url("${pick.url.replace(/"/g, '%22')}")`;
      $('#loginPhotoName').textContent = `H Place ${pick.name}`;
      $('#screenLogin').classList.add('has-photo');
      requestAnimationFrame(() => layer.classList.add('is-on'));
    };
    img.src = pick.url;
  }

  function showLogin(message) {
    state.user = null;
    show('screenLogin');
    loadLoginPhoto();
    const err = $('#loginError');
    err.hidden = !message;
    err.textContent = message || '';
    if (api.mode === 'demo') {
      $('#loginDemoNote').hidden = false;
      if (!$('#loginEmail').value) $('#loginEmail').value = 'h001';
      if (!$('#loginPassword').value) $('#loginPassword').value = 'demo';
    }
    $('#loginEmail').focus();
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#loginEmail').value.trim();
    const password = $('#loginPassword').value;
    const err = $('#loginError');
    if (!email || !password) {
      err.textContent = '아이디(또는 이메일)와 비밀번호를 모두 입력해 주세요.';
      err.hidden = false;
      (!email ? $('#loginEmail') : $('#loginPassword')).focus();
      return;
    }
    if (!email.includes('@') && !api.isLoginId(email)) {
      err.textContent = '아이디는 영문과 숫자, 마침표(.), 밑줄(_), 하이픈(-)으로 2~30자입니다.';
      err.hidden = false;
      $('#loginEmail').focus();
      return;
    }
    const btn = $('#loginBtn');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      await api.signIn(email, password);
      const user = await api.getUser();
      $('#loginPassword').value = '';
      await enter(user);
    } catch (ex) {
      err.textContent = api.toAppError(ex).message;
      err.hidden = false;
    } finally {
      btn.disabled = false; btn.removeAttribute('aria-busy');
    }
  });

  $('#pwToggle').addEventListener('click', (e) => {
    const input = $('#loginPassword');
    const showPw = input.type === 'password';
    input.type = showPw ? 'text' : 'password';
    e.currentTarget.setAttribute('aria-pressed', String(showPw));
    e.currentTarget.setAttribute('aria-label', showPw ? '비밀번호 숨기기' : '비밀번호 보기');
  });

  async function signOut() {
    await api.signOut();
    state.profile = null; state.branch = null; state.inventory = []; state.movements = [];
    showLogin();
  }
  $$('[data-signout]').forEach((b) => b.addEventListener('click', signOut));
  $('#pendingRetry').addEventListener('click', () => enter(state.user));

  async function enter(user) {
    if (!user) return showLogin();
    state.user = user;
    show('screenLoading');
    let ctx;
    try {
      ctx = await api.getContext(user);
    } catch (e) {
      return showLogin(api.toAppError(e).message);
    }
    state.profile = ctx.profile;
    state.branches = ctx.branches || [];
    if (api.mode === 'demo') $('#demoRole').value = api.demoRole;
    if (state.profile && state.profile.active === false) {
      $('#pendingTitle').textContent = '사용이 중지된 계정입니다';
      $('#pendingText').innerHTML = `<strong>${esc((user.email || '').split('@')[0])}</strong> 계정은 관리자가 사용을 중지했습니다. 다시 사용해야 하면 전체 관리자에게 요청해 주세요.`;
      show('screenPending');
      return;
    }
    const assigned = state.profile && (state.profile.role === 'admin' ? state.branches.length > 0 : state.profile.branch_id);
    if (!assigned) {
      $('#pendingTitle').textContent = '지점 배정을 기다리고 있어요';
      $('#pendingText').innerHTML = `<strong>${esc((user.email || '').split('@')[0])}</strong> 계정이 아직 지점에 배정되지 않았습니다. 전체 관리자에게 배정을 요청해 주세요.`;
      show('screenPending');
      return;
    }
    let saved = null;
    try { saved = localStorage.getItem('hp-branch'); } catch (e) {}
    state.branch = state.branches.find((b) => b.id === saved && state.profile.role === 'admin')
      || state.branches.find((b) => b.id === state.profile.branch_id)
      || state.branches[0];
    try { localStorage.setItem('hp-login-branch', state.branch.id); } catch (e) {}

    document.body.dataset.role = state.profile.role;
    const name = state.profile.full_name || (user.email || '').split('@')[0];
    $('#userName').textContent = name;
    $('#userInitial').textContent = name.slice(0, 1).toUpperCase();
    $('#userRole').textContent = `${ROLE_LABEL[state.profile.role]} · ${state.profile.login_id || (user.email || '').split('@')[0]}`;
    fillBranchSelect();
    $('#demoBanner').hidden = api.mode !== 'demo';

    show('screenApp');
    applyRoute(false);
    await loadData();
  }

  function fillBranchSelect() {
    const sel = $('#branchSelect');
    sel.innerHTML = state.branches.map((b) => `<option value="${b.id}">${esc(b.name)}${b.active === false ? ' (중지)' : ''}</option>`).join('');
    sel.value = state.branch.id;
    sel.hidden = state.branches.length < 2;
  }

  $('#branchSelect').addEventListener('change', (e) => {
    state.branch = state.branches.find((b) => b.id === e.target.value);
    try { localStorage.setItem('hp-branch', state.branch.id); localStorage.setItem('hp-login-branch', state.branch.id); } catch (err) {}
    loadData();
    if (state.route === 'users') loadUsers();
    if (state.route === 'staff') loadStaff();
  });

  $('#demoRole').addEventListener('change', async (e) => {
    api.setDemoRole(e.target.value);
    state.us.branch = '';
    await enter(await api.getUser());
    toast(`${ROLE_LABEL[state.profile.role]} 화면으로 전환했습니다.`);
  });

  // ------------------------------------------------------------------
  // Data loading
  // ------------------------------------------------------------------
  async function loadData() {
    if (!state.branch) return;
    state.loading = true;
    const refresh = $('#refreshBtn');
    refresh.setAttribute('aria-busy', 'true');
    $('#branchLine').textContent = `${state.branch.name} · 불러오는 중…`;
    try {
      const [inventory, movements, categories] = await Promise.all([
        api.listInventory(state.branch.id),
        api.listMovements(state.branch.id, 30),
        api.listCategories(),
      ]);
      state.inventory = inventory;
      state.movements = movements;
      state.categories = categories;
      $('#loadError').hidden = true;
      renderAll();
    } catch (e) {
      const err = api.toAppError(e);
      if (err.code === 'NOT_AUTHENTICATED') return showLogin(err.message);
      const box = $('#loadError');
      box.innerHTML = `${esc(err.message)} <button type="button" class="link-btn" id="retryLoad">다시 시도</button>`;
      box.hidden = false;
      $('#retryLoad').addEventListener('click', loadData);
    } finally {
      state.loading = false;
      refresh.removeAttribute('aria-busy');
      $('#branchLine').textContent = `${state.branch.name} · ${fullFmt.format(new Date())}`;
    }
  }
  $('#refreshBtn').addEventListener('click', loadData);

  function renderAll() {
    renderKpis();
    renderAlerts();
    renderRecent();
    // Sweep the chart in for a newly opened branch; after a save the totals just roll.
    const fresh = state.chartBranch !== state.branch.id;
    state.chartBranch = state.branch.id;
    renderChart(fresh);
    fillFilters();
    renderInventory();
    renderMovements();
    renderProducts();
    renderBranches();
    renderCategories();
    fillMoveItems();
  }

  // ------------------------------------------------------------------
  // Routing
  // ------------------------------------------------------------------
  function applyRoute(moveFocus = true) {
    let route = (location.hash.match(/^#\/(\w+)/) || [])[1] || 'dashboard';
    if (!ROUTES[route] || (MANAGER_ROUTES.includes(route) && !isManager()) || (ADMIN_ROUTES.includes(route) && !isAdmin())) route = 'dashboard';
    state.route = route;
    $$('.view').forEach((v) => { v.hidden = v.dataset.view !== route; });
    $$('.nav-link').forEach((a) => {
      if (a.dataset.route === route) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    $('#pageTitle').textContent = ROUTES[route];
    document.title = `${ROUTES[route]} · H Place 매장관리`;
    if (route === 'dashboard') renderChart(state.chartBranch != null);  // animate once data is in
    if (route === 'users') loadUsers();
    if (route === 'branches') { renderBranches(); loadBranchManagers(); }
    if (route === 'staff') loadStaff();
    if (route === 'categories') renderCategories();
    closeSidebar();
    if (moveFocus) $('#main').focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', () => { if (!$('#screenApp').hidden) applyRoute(); });

  // ------------------------------------------------------------------
  // Dashboard
  // ------------------------------------------------------------------
  function renderKpis() {
    const items = activeItems();
    const retail = items.filter((i) => i.is_retail).length;
    const low = items.filter((i) => i.status === 'low').length;
    const out = items.filter((i) => i.status === 'out').length;
    const value = items.reduce((a, i) => a + i.stock * i.cost_price, 0);
    const since7 = sinceMs(7);
    const outValue = state.movements
      .filter((m) => OUT_TYPES.includes(m.type) && Date.parse(m.created_at) >= since7)
      .reduce((a, m) => a + -m.quantity * (m.unit_cost || 0), 0);

    $('#kpiItems').textContent = nf.format(items.length);
    $('#kpiItemsSub').textContent = `업소용 ${nf.format(items.length - retail)} · 판매용 ${nf.format(retail)}`;
    const v = $('#kpiValue');
    v.textContent = wonCompact.format(value);
    v.title = won.format(value);
    $('#kpiUse').textContent = `최근 7일 출고 ${wonCompact.format(outValue)}`;
    $('#kpiLow').textContent = nf.format(low);
    $('#kpiOut').textContent = nf.format(out);
    const nb = $('#navAlertCount');
    nb.textContent = low + out;
    nb.dataset.zero = String(low + out === 0);
    nb.setAttribute('aria-label', `재고 부족·품절 ${low + out}건`);
  }

  function renderAlerts() {
    const list = activeItems().filter((i) => i.status !== 'ok')
      .sort((a, b) => a.stock / Math.max(a.safety_stock, 1) - b.stock / Math.max(b.safety_stock, 1));
    const ul = $('#alertList');
    if (!list.length) {
      ul.innerHTML = `<li class="alert-empty">${svgIcon('i-check-circle')}<p>모든 품목이 안전재고 이상입니다.</p></li>`;
      return;
    }
    ul.innerHTML = list.map((i) => {
      const need = Math.max(i.safety_stock * 2 - i.stock, 1);
      return `<li class="alert-item">
        <span class="kpi-icon ${i.status === 'out' ? 'tone-danger' : 'tone-warn'}" aria-hidden="true">${svgIcon(STATUS[i.status].icon)}</span>
        <div>
          <p class="alert-name">${esc(i.name)} <span class="sr-only">(${STATUS[i.status].label})</span></p>
          <p class="alert-meta">현재 ${nf.format(i.stock)} / 안전 ${nf.format(i.safety_stock)}${esc(i.unit)} · 권장 발주 ${nf.format(need)}${esc(i.unit)}</p>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" data-move="${i.product_id}" data-type="receive" data-qty="${need}" aria-label="${esc(i.name)} 입고 등록">입고</button>
      </li>`;
    }).join('');
  }

  function whoText(m) {
    if (m.created_by && m.created_by === state.user?.id) return '나';
    return m.created_by_name || (m.memo === '샘플 데이터' ? '샘플' : '—');
  }

  function renderRecent() {
    const rows = state.movements.slice(0, 8);
    const ul = $('#recentList');
    if (!rows.length) {
      ul.innerHTML = '<li class="recent-empty">최근 30일 동안 기록된 입출고가 없습니다.</li>';
      return;
    }
    ul.innerHTML = rows.map((m) => {
      const d = new Date(m.created_at);
      return `<li class="${m.reverted ? 'is-reverted' : ''}">
        ${typeTag(m.type)}
        <div><p class="r-name">${esc(m.product_name)}</p>
        <p class="r-meta">${dayFmt.format(d)} ${timeFmt.format(d)} · ${esc(whoText(m))}${m.reverts_id ? ' · 취소 기록' : ''}${m.reverted ? ' · 취소됨' : ''}</p></div>
        ${qtyText(m.quantity, m.unit)}
      </li>`;
    }).join('');
  }

  // Trend chart (inline SVG)
  const easeOut = (t) => 1 - Math.pow(1 - t, 4);

  function niceStep(v) {
    const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1e-9))));
    const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  }

  function trendData() {
    const days = state.range;
    const start = sinceMs(days);
    const buckets = Array.from({ length: days }, (_, i) => ({ date: new Date(start + i * DAY + 12 * 3600000), in: 0, out: 0 }));
    const index = new Map(buckets.map((b, i) => [keyFmt.format(b.date), i]));
    state.movements.forEach((m) => {
      const i = index.get(keyFmt.format(new Date(m.created_at)));
      if (i == null) return;
      if (m.type === 'receive') buckets[i].in += m.quantity;
      else if (OUT_TYPES.includes(m.type)) buckets[i].out += -m.quantity;
    });
    return buckets;
  }

  // Monotone cubic curve through every point: smooth, but never overshoots
  // (so a day with 0 never dips below the baseline).
  function smoothPath(pts) {
    const f = (v) => v.toFixed(1);
    const n = pts.length;
    if (n < 3) return pts.map((p, i) => `${i ? 'L' : 'M'}${f(p[0])},${f(p[1])}`).join('');
    const dx = [], s = [];
    for (let i = 0; i < n - 1; i++) { dx.push(pts[i + 1][0] - pts[i][0]); s.push((pts[i + 1][1] - pts[i][1]) / dx[i]); }
    const t = [s[0]];
    for (let i = 1; i < n - 1; i++) t.push(s[i - 1] * s[i] <= 0 ? 0 : (s[i - 1] + s[i]) / 2);
    t.push(s[n - 2]);
    for (let i = 0; i < n - 1; i++) {
      if (s[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
      const a = t[i] / s[i], b = t[i + 1] / s[i], h = a * a + b * b;
      if (h > 9) { const k = 3 / Math.sqrt(h); t[i] = k * a * s[i]; t[i + 1] = k * b * s[i]; }
    }
    let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
    for (let i = 0; i < n - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], h = dx[i] / 3;
      d += `C${f(x0 + h)},${f(y0 + t[i] * h)} ${f(x1 - h)},${f(y1 - t[i + 1] * h)} ${f(x1)},${f(y1)}`;
    }
    return d;
  }

  // Period totals above the chart; numbers roll to their new value.
  function countTo(el, to, signed = false) {
    const fmt = (v) => (signed && v > 0 ? `+${nf.format(v)}` : nf.format(v));
    const from = Number(el.dataset.v ?? to);
    el.dataset.v = to;
    cancelAnimationFrame(el._raf);
    if (reduceMotion.matches || from === to) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, Math.max(0, (now - t0) / 700));
      el.textContent = fmt(Math.round(from + (to - from) * easeOut(p)));
      if (p < 1) el._raf = requestAnimationFrame(tick);
    };
    el._raf = requestAnimationFrame(tick);
  }

  function renderChart(animate = false) {
    const svg = $('#chartSvg');
    const box = $('#chart').getBoundingClientRect();
    if (!box.width || $('#screenApp').hidden) return;
    const W = Math.max(280, Math.round(box.width));
    const H = Math.round(box.height);
    const data = trendData();
    const narrow = W < 520;
    const m = { t: 16, r: narrow ? 40 : 48, b: 28, l: 40 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const peak = Math.max(4, ...data.map((d) => Math.max(d.in, d.out))) * 1.08;
    const tickStep = niceStep(peak / 4);
    const ticks = Math.ceil(peak / tickStep);
    const max = tickStep * ticks;
    const x = (i) => m.l + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw);
    const y = (v) => m.t + ih - (v / max) * ih;
    const base = y(0), n = data.length, xN = x(n - 1);
    const last = data[n - 1];

    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    let g = `<defs>
      <linearGradient id="gradIn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="stop-in" stop-opacity="0.34"/><stop offset="1" class="stop-in" stop-opacity="0"/></linearGradient>
      <linearGradient id="gradOut" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="stop-out" stop-opacity="0.18"/><stop offset="1" class="stop-out" stop-opacity="0"/></linearGradient>
      <filter id="lineGlow" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">
        <feGaussianBlur in="SourceGraphic" stdDeviation="3.5" result="blur"/>
        <feComponentTransfer in="blur" result="soft"><feFuncA type="linear" slope="0.55"/></feComponentTransfer>
        <feMerge><feMergeNode in="soft"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <clipPath id="chartReveal"><rect id="chartRevealRect" x="0" y="0" width="${(animate && !reduceMotion.matches) || state.chartBranch == null ? 0 : W}" height="${H}"/></clipPath>
    </defs>`;
    for (let i = 0; i <= ticks; i++) {
      const v = tickStep * i;
      g += `<line class="${i ? 'gridline' : 'baseline'}" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>`;
      g += `<text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${nf.format(v)}</text>`;
    }
    const step = Math.max(1, Math.ceil(n / (narrow ? 4 : 8)));
    data.forEach((d, i) => {
      if ((n - 1 - i) % step === 0) g += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${dayFmt.format(d.date)}</text>`;
    });

    const lineIn = smoothPath(data.map((d, i) => [x(i), y(d.in)]));
    const lineOut = smoothPath(data.map((d, i) => [x(i), y(d.out)]));
    const close = `L${xN.toFixed(1)},${base.toFixed(1)}L${x(0).toFixed(1)},${base.toFixed(1)}Z`;
    g += `<g clip-path="url(#chartReveal)">
      <path class="area-out" d="${lineOut}${close}"/>
      <path class="area-in" d="${lineIn}${close}"/>
      <path class="line-out" d="${lineOut}" filter="url(#lineGlow)"/>
      <path class="line-in" d="${lineIn}" filter="url(#lineGlow)"/>
    </g>`;

    // Latest values: markers and direct labels at the right edge
    let yIn = y(last.in) + 4, yOut = y(last.out) + 4;
    if (Math.abs(yIn - yOut) < 14) {
      const mid = (yIn + yOut) / 2;
      if (last.in >= last.out) { yIn = mid - 7; yOut = mid + 7; } else { yIn = mid + 7; yOut = mid - 7; }
    }
    g += `<g transform="translate(${xN},${y(last.out)})"><rect class="pulse pulse-out" x="-4" y="-4" width="8" height="8"/><rect class="end-mark mark-out" x="-4" y="-4" width="8" height="8"/></g>
      <g transform="translate(${xN},${y(last.in)})"><circle class="pulse pulse-in" r="4.5"/><circle class="end-mark mark-in" r="4.5"/></g>
      <text class="end-label label-in" x="${W - m.r + 8}" y="${yIn}">입고</text>
      <text class="end-label label-out" x="${W - m.r + 8}" y="${yOut}">출고</text>`;

    // Hover / keyboard cursor, moved with transforms so it glides between days
    const band = Math.max(8, Math.min(40, n > 1 ? iw / (n - 1) : iw));
    g += `<g class="cursor" id="chartCursor">
      <g class="cursor-x"><rect class="cursor-band" x="${-band / 2}" y="${m.t}" width="${band}" height="${base - m.t}" rx="6"/>
        <line class="guide" x1="0" x2="0" y1="${m.t}" y2="${base}"/></g>
      <g class="cursor-dot cursor-out"><rect class="halo" x="-9" y="-9" width="18" height="18" rx="4"/><rect class="mark-out" x="-4" y="-4" width="8" height="8"/></g>
      <g class="cursor-dot cursor-in"><circle class="halo" r="10"/><circle class="mark-in" r="4.5"/></g>
    </g>`;

    cancelAnimationFrame(svg._raf);
    svg.innerHTML = g;
    svg.classList.toggle('is-entering', animate && !reduceMotion.matches);
    if (animate && !reduceMotion.matches) {
      const rect = svg.querySelector('#chartRevealRect'), t0 = performance.now();
      const tick = (now) => {
        const p = Math.min(1, Math.max(0, (now - t0) / 1100));
        rect.setAttribute('width', (W * easeOut(p)).toFixed(1));
        if (p < 1) svg._raf = requestAnimationFrame(tick);
      };
      svg._raf = requestAnimationFrame(tick);
    }

    const sumIn = data.reduce((a, d) => a + d.in, 0), sumOut = data.reduce((a, d) => a + d.out, 0);
    countTo($('#sumIn'), sumIn);
    countTo($('#sumOut'), sumOut);
    countTo($('#sumNet'), sumIn - sumOut, true);
    $('#sumRange').textContent = `최근 ${state.range}일 합계`;
    svg.setAttribute('aria-label', `최근 ${state.range}일 입고·출고 수량 선 그래프. 입고 합계 ${nf.format(sumIn)}, 출고 합계 ${nf.format(sumOut)}.`);
    svg._geom = { data, x, y, m, W, H };
    if (state.activeIdx != null) setActive(Math.min(state.activeIdx, n - 1));
    else $('#chartTip').classList.remove('is-on');
  }

  function setActive(i) {
    const svg = $('#chartSvg');
    if (!svg._geom) return;
    const { data, x, y, W } = svg._geom;
    const tip = $('#chartTip'), cursor = $('#chartCursor');
    if (i == null) {
      state.activeIdx = null;
      cursor?.classList.remove('is-on');
      tip.classList.remove('is-on');
      return;
    }
    // Appearing from hidden: jump into place instead of sliding in from the old spot.
    const jump = !cursor.classList.contains('is-on');
    cursor.classList.toggle('no-anim', jump);
    tip.classList.toggle('no-anim', jump);
    state.activeIdx = i;
    const d = data[i], net = d.in - d.out;
    cursor.querySelector('.cursor-x').style.transform = `translate(${x(i)}px, 0)`;
    cursor.querySelector('.cursor-in').style.transform = `translate(${x(i)}px, ${y(d.in)}px)`;
    cursor.querySelector('.cursor-out').style.transform = `translate(${x(i)}px, ${y(d.out)}px)`;
    tip.innerHTML = `<strong>${fullFmt.format(d.date)}</strong>
      <div class="row"><span class="k"><span class="tip-mk tip-in"></span>입고</span><span>${nf.format(d.in)}</span></div>
      <div class="row"><span class="k"><span class="tip-mk tip-out"></span>출고</span><span>${nf.format(d.out)}</span></div>
      <div class="row net"><span class="k">순증감</span><span>${net > 0 ? '+' : ''}${nf.format(net)}</span></div>`;
    const tw = tip.offsetWidth;
    const left = Math.max(0, x(i) + 14 + tw > W ? x(i) - 14 - tw : x(i) + 14);
    tip.style.transform = `translate(${left}px, 0)`;
    if (jump) { void tip.offsetWidth; cursor.getBoundingClientRect(); }
    cursor.classList.add('is-on');
    tip.classList.add('is-on');
    if (jump) requestAnimationFrame(() => { cursor.classList.remove('no-anim'); tip.classList.remove('no-anim'); });
  }

  (function bindChart() {
    const svg = $('#chartSvg');
    const idx = (e) => {
      const { data, x } = svg._geom;
      const px = (e.clientX - svg.getBoundingClientRect().left) * (svg._geom.W / svg.getBoundingClientRect().width);
      let best = 0, bd = Infinity;
      data.forEach((_, i) => { const dd = Math.abs(x(i) - px); if (dd < bd) { bd = dd; best = i; } });
      return best;
    };
    svg.addEventListener('pointermove', (e) => svg._geom && setActive(idx(e)));
    svg.addEventListener('pointerdown', (e) => svg._geom && setActive(idx(e)));
    svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') setActive(null); });
    svg.addEventListener('focus', () => svg._geom && setActive(svg._geom.data.length - 1));
    svg.addEventListener('blur', () => setActive(null));
    svg.addEventListener('keydown', (e) => {
      if (!svg._geom) return;
      const n = svg._geom.data.length;
      let i = state.activeIdx ?? n - 1;
      if (e.key === 'ArrowLeft') i = Math.max(0, i - 1);
      else if (e.key === 'ArrowRight') i = Math.min(n - 1, i + 1);
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = n - 1;
      else if (e.key === 'Escape') { setActive(null); return; }
      else return;
      e.preventDefault();
      setActive(i);
    });
    $$('.segmented button').forEach((b) => b.addEventListener('click', () => {
      if (Number(b.dataset.range) === state.range) return;
      state.range = Number(b.dataset.range);
      state.activeIdx = null;
      $$('.segmented button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      renderChart(true);
    }));
    // Redraw on real size changes only, so an entrance animation isn't cut short.
    let raf = 0;
    new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const box = $('#chart').getBoundingClientRect(), gm = svg._geom;
        if (gm && Math.max(280, Math.round(box.width)) === gm.W && Math.round(box.height) === gm.H) return;
        renderChart();
      });
    }).observe($('#chart'));
  })();

  $$('.kpi-action[data-filter]').forEach((b) => b.addEventListener('click', () => {
    state.inv.status = b.dataset.filter;
    $('#invStatus').value = state.inv.status;
    location.hash = '#/inventory';
    renderInventory();
  }));

  // ------------------------------------------------------------------
  // Inventory list
  // ------------------------------------------------------------------
  function fillFilters() {
    const cats = [...new Set(state.inventory.map((i) => i.category))].sort(byCategory);
    const sel = $('#invCat');
    const cur = sel.value;
    sel.innerHTML = '<option value="">전체</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
    sel.value = cats.includes(cur) ? cur : '';
    const pc = $('#pCategory');
    const curP = pc.value;
    pc.innerHTML = '<option value="">카테고리를 선택하세요</option>' + state.categories.map((c) => `<option>${esc(c.name)}</option>`).join('');
    pc.value = state.categories.some((c) => c.name === curP) ? curP : '';
  }

  function sortVal(i, key) {
    if (key === 'value') return i.stock * i.cost_price;
    if (key === 'category') return catRank(i.category);
    if (key === 'status') return STATUS[i.status].rank * 1e6 + i.stock / Math.max(i.safety_stock, 1);
    return i[key];
  }

  function renderInventory() {
    const f = state.inv;
    const q = f.q.trim().toLowerCase();
    const dir = f.sortDir === 'asc' ? 1 : -1;
    const rows = activeItems().filter((i) =>
      (!q || i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q) || (i.location || '').toLowerCase().includes(q)) &&
      (!f.cat || i.category === f.cat) && (!f.status || i.status === f.status))
      .sort((a, b) => {
        const va = sortVal(a, f.sortKey), vb = sortVal(b, f.sortKey);
        return (typeof va === 'string' ? va.localeCompare(vb, 'ko') : va - vb) * dir;
      });
    const total = activeItems().length;
    $('#invCount').textContent = `${nf.format(rows.length)}개 품목${rows.length !== total ? ` (전체 ${nf.format(total)}개 중)` : ''}`;
    $('#invEmpty').hidden = rows.length > 0;
    $('#invTable').hidden = rows.length === 0;
    $('#invBody').innerHTML = rows.map((i) => {
      const pct = Math.min(100, Math.round((i.stock / Math.max(i.safety_stock * 3, 1)) * 100));
      return `<tr>
        <td class="cell-name"><div class="item-name">${esc(i.name)}</div><div class="item-sku">${esc(i.sku)}${i.location ? ` · ${esc(i.location)}` : ''}</div></td>
        <td data-label="카테고리">${esc(i.category)}</td>
        <td class="num" data-label="현재고"><span class="stock-cell"><strong>${nf.format(i.stock)}<small class="muted"> ${esc(i.unit)}</small></strong><span class="meter" data-status="${i.status}" aria-hidden="true"><span style="width:${pct}%"></span></span></span></td>
        <td class="num" data-label="안전재고">${nf.format(i.safety_stock)}</td>
        <td class="num" data-label="매입가">${won.format(i.cost_price)}</td>
        <td class="num" data-label="재고 금액">${won.format(i.stock * i.cost_price)}</td>
        <td data-label="상태">${badge(i.status)}</td>
        <td class="cell-action"><button type="button" class="btn btn-secondary btn-sm" data-move="${i.product_id}" aria-label="${esc(i.name)} 입출고 등록">입출고</button></td>
      </tr>`;
    }).join('');
    $$('#invTable thead th[data-key]').forEach((th) => {
      const on = th.dataset.key === f.sortKey;
      if (on) th.setAttribute('aria-sort', f.sortDir === 'asc' ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
      $('use', th).setAttribute('href', on ? (f.sortDir === 'asc' ? '#i-up' : '#i-down') : '#i-sort');
    });
  }

  let invTimer = 0;
  $('#invQ').addEventListener('input', (e) => { clearTimeout(invTimer); invTimer = setTimeout(() => { state.inv.q = e.target.value; renderInventory(); }, 150); });
  $('#invCat').addEventListener('change', (e) => { state.inv.cat = e.target.value; renderInventory(); });
  $('#invStatus').addEventListener('change', (e) => { state.inv.status = e.target.value; renderInventory(); });
  $('#invClear').addEventListener('click', () => {
    Object.assign(state.inv, { q: '', cat: '', status: '' });
    $('#invQ').value = ''; $('#invCat').value = ''; $('#invStatus').value = '';
    renderInventory();
    $('#invQ').focus();
  });
  $$('#invTable thead th[data-key] .sort-btn').forEach((b) => b.addEventListener('click', () => {
    const key = b.closest('th').dataset.key;
    if (state.inv.sortKey === key) state.inv.sortDir = state.inv.sortDir === 'asc' ? 'desc' : 'asc';
    else { state.inv.sortKey = key; state.inv.sortDir = ['stock', 'safety_stock', 'cost_price', 'value'].includes(key) ? 'desc' : 'asc'; }
    renderInventory();
  }));

  // ------------------------------------------------------------------
  // Movements history
  // ------------------------------------------------------------------
  function canRevert(m) {
    if (m.reverted || m.reverts_id) return false;
    if (isManager()) return true;
    return m.created_by === state.user?.id && Date.now() - Date.parse(m.created_at) < 10 * 60000;
  }

  function renderMovements() {
    const f = state.mv;
    const q = f.q.trim().toLowerCase();
    const since = sinceMs(f.days);
    const rows = state.movements.filter((m) =>
      Date.parse(m.created_at) >= since && (!f.type || m.type === f.type) &&
      (!q || m.product_name.toLowerCase().includes(q) || (m.memo || '').toLowerCase().includes(q) || whoText(m).toLowerCase().includes(q)));
    $('#mvCount').textContent = `${nf.format(rows.length)}건`;
    $('#mvEmpty').hidden = rows.length > 0;
    $('#mvTable').hidden = rows.length === 0;
    $('#mvBody').innerHTML = rows.map((m) => {
      const d = new Date(m.created_at);
      const cls = [m.reverted ? 'is-reverted' : '', m.reverts_id ? 'is-reversal' : ''].join(' ').trim();
      return `<tr class="${cls}">
        <td class="cell-name when"><span class="item-name">${esc(m.product_name)}</span><small>${dayFmt.format(d)} ${timeFmt.format(d)}</small></td>
        <td data-label="품목 코드">${esc(m.sku)}</td>
        <td data-label="구분">${typeTag(m.type)}${m.reverts_id ? ' <span class="tag tag-note">취소 기록</span>' : ''}${m.reverted ? ' <span class="tag tag-note">취소됨</span>' : ''}</td>
        <td class="num" data-label="변동">${qtyText(m.quantity, m.unit)}</td>
        <td class="num" data-label="변동 후">${nf.format(m.stock_after)}${esc(m.unit)}</td>
        <td data-label="담당자">${esc(whoText(m))}</td>
        <td data-label="메모"><span class="memo">${esc(m.memo || '—')}</span></td>
        <td class="cell-action">${canRevert(m) ? `<button type="button" class="btn btn-secondary btn-sm" data-revert="${m.id}" aria-label="${esc(m.product_name)} ${TYPES[m.type].label} 기록 취소">${svgIcon('i-undo')}취소</button>` : ''}</td>
      </tr>`;
    }).join('');
  }

  let mvTimer = 0;
  $('#mvQ').addEventListener('input', (e) => { clearTimeout(mvTimer); mvTimer = setTimeout(() => { state.mv.q = e.target.value; renderMovements(); }, 150); });
  $('#mvType').addEventListener('change', (e) => { state.mv.type = e.target.value; renderMovements(); });
  $('#mvDays').addEventListener('change', (e) => { state.mv.days = Number(e.target.value); renderMovements(); });

  async function revert(id, button) {
    if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
    try {
      await api.revertMovement(Number(id));
      toast('기록을 취소하고 재고를 되돌렸습니다.');
      await loadData();
    } catch (e) {
      toast(api.toAppError(e).message, { error: true });
      if (button) { button.disabled = false; button.removeAttribute('aria-busy'); }
    }
  }

  // ------------------------------------------------------------------
  // Products (manager)
  // ------------------------------------------------------------------
  function renderProducts() {
    const q = state.pd.q.trim().toLowerCase();
    const rows = state.inventory.filter((i) => !q || i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q))
      .sort((a, b) => byCategory(a.category, b.category) || a.name.localeCompare(b.name, 'ko'));
    $('#pdCount').textContent = `${nf.format(rows.length)}개 품목`;
    $('#pdBody').innerHTML = rows.map((i) => `<tr class="${i.active ? '' : 'inactive-row'}">
      <td class="cell-name"><div class="item-name">${esc(i.name)}</div><div class="item-sku">${esc(i.sku)}${i.brand ? ` · ${esc(i.brand)}` : ''}</div></td>
      <td data-label="카테고리">${esc(i.category)}</td>
      <td data-label="단위">${esc(i.unit)}</td>
      <td class="num" data-label="매입가">${won.format(i.cost_price)}</td>
      <td class="num" data-label="판매가">${i.retail_price != null ? won.format(i.retail_price) : '—'}</td>
      <td class="num" data-label="안전재고">${nf.format(i.safety_stock)}</td>
      <td data-label="보관 위치">${esc(i.location || '—')}</td>
      <td data-label="사용">${i.active ? '사용 중' : '사용 안 함'}${i.is_retail ? ' · 판매용' : ''}</td>
      <td class="cell-action"><button type="button" class="btn btn-secondary btn-sm" data-edit="${i.product_id}" aria-label="${esc(i.name)} ${isAdmin() ? '수정' : '지점 설정'}">${svgIcon('i-edit')}${isAdmin() ? '수정' : '설정'}</button></td>
    </tr>`).join('');
  }
  let pdTimer = 0;
  $('#pdQ').addEventListener('input', (e) => { clearTimeout(pdTimer); pdTimer = setTimeout(() => { state.pd.q = e.target.value; renderProducts(); }, 150); });

  // ------------------------------------------------------------------
  // Dialog helpers
  // ------------------------------------------------------------------
  function setupDialog(dialog) {
    let returnFocus = null;
    const onBackdrop = (e) => {
      if (e.target !== dialog) return false;
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    let downOnBackdrop = false;
    dialog.addEventListener('pointerdown', (e) => { downOnBackdrop = onBackdrop(e); });
    dialog.addEventListener('click', (e) => { if (downOnBackdrop && onBackdrop(e)) dialog.close(); downOnBackdrop = false; });
    $$('[data-close]', dialog).forEach((b) => b.addEventListener('click', () => dialog.close()));
    dialog.addEventListener('close', () => { if (returnFocus && document.contains(returnFocus)) returnFocus.focus(); });
    return { open() { returnFocus = document.activeElement; dialog.showModal(); } };
  }

  function clearErrors(form) {
    $$('[aria-invalid]', form).forEach((el) => el.removeAttribute('aria-invalid'));
    $$('.err', form).forEach((el) => { el.hidden = true; el.textContent = ''; });
    $('.error-summary', form).hidden = true;
  }
  function fieldError(input, msg) {
    input.setAttribute('aria-invalid', 'true');
    const err = document.getElementById(`${input.id}Err`);
    if (err) { err.textContent = msg; err.hidden = false; }
  }
  function showSummary(form, errors) {
    const sum = $('.error-summary', form);
    $('ul', sum).innerHTML = errors.map((e) => `<li><a href="#${e.id}">${esc(e.msg)}</a></li>`).join('');
    sum.hidden = false;
    if (errors.length > 1) sum.focus(); else $('#' + errors[0].id).focus();
  }
  function showServerError(form, message) {
    const sum = $('.error-summary', form);
    $('ul', sum).innerHTML = `<li>${esc(message)}</li>`;
    sum.hidden = false;
    sum.focus();
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('.error-summary a');
    if (!a) return;
    e.preventDefault();
    $(a.getAttribute('href')).focus();
  });
  // Clear a field's error as soon as the user edits it.
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.getAttribute && el.getAttribute('aria-invalid') === 'true') {
      el.removeAttribute('aria-invalid');
      const err = document.getElementById(`${el.id}Err`);
      if (err) err.hidden = true;
    }
  });

  // ------------------------------------------------------------------
  // Movement dialog
  // ------------------------------------------------------------------
  const moveDialog = setupDialog($('#moveDialog'));
  const moveForm = $('#moveForm');

  function fillMoveItems() {
    const items = activeItems();
    const cats = [...new Set(items.map((i) => i.category))].sort(byCategory);
    const sel = $('#mItem');
    const cur = sel.value;
    sel.innerHTML = '<option value="">품목을 선택하세요</option>' + cats.map((c) =>
      `<optgroup label="${esc(c)}">${items.filter((i) => i.category === c)
        .map((i) => `<option value="${i.product_id}">${esc(i.name)} · 현재 ${nf.format(i.stock)}${esc(i.unit)}</option>`).join('')}</optgroup>`).join('');
    sel.value = items.some((i) => i.product_id === cur) ? cur : '';
  }

  const moveType = () => $('input[name="mType"]:checked').value;

  function updatePreview() {
    const item = itemById($('#mItem').value);
    const type = moveType();
    const raw = $('#mQty').value.trim();
    const qty = Number(raw);
    $('#mQtyLabel').firstChild.textContent = type === 'adjust' ? '실제 수량 (실사 결과) ' : '수량 ';
    const p = $('#mPreview');
    if (!item) { p.textContent = '품목을 선택하면 등록 후 재고를 미리 보여 줍니다.'; return; }
    const u = esc(item.unit);
    if (!raw || !Number.isInteger(qty) || qty < 0) {
      p.innerHTML = `현재고 <strong>${nf.format(item.stock)}${u}</strong>`;
      return;
    }
    const after = type === 'receive' ? item.stock + qty : type === 'adjust' ? qty : item.stock - qty;
    const diff = after - item.stock;
    if (after < 0) {
      p.innerHTML = `현재고 <strong>${nf.format(item.stock)}${u}</strong> · <span class="warn">현재고보다 ${nf.format(-after)}${u} 많습니다</span>`;
    } else {
      p.innerHTML = `현재고 <strong>${nf.format(item.stock)}${u}</strong> → 등록 후 <strong>${nf.format(after)}${u}</strong>${type === 'adjust' ? ` (차이 ${diff > 0 ? '+' : diff < 0 ? '−' : ''}${nf.format(Math.abs(diff))}${u})` : ''}`;
    }
  }
  ['#mItem', '#mQty'].forEach((s) => $(s).addEventListener('input', updatePreview));
  $$('input[name="mType"]').forEach((r) => r.addEventListener('change', updatePreview));

  function openMove({ productId = '', type = 'receive', qty = '' } = {}) {
    moveForm.reset();
    clearErrors(moveForm);
    fillMoveItems();
    $('#mItem').value = productId;
    const radio = $(`input[name="mType"][value="${type}"]`);
    radio.checked = true;
    $('#mQty').value = qty;
    updatePreview();
    moveDialog.open();
    (productId ? $('#mQty') : $('#mItem')).focus();
  }

  moveForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(moveForm);
    const item = itemById($('#mItem').value);
    const type = moveType();
    const raw = $('#mQty').value.trim();
    const qty = Number(raw);
    const errors = [];
    if (!item) { fieldError($('#mItem'), '입출고할 품목을 선택해 주세요.'); errors.push({ id: 'mItem', msg: '품목을 선택해 주세요.' }); }
    if (type === 'adjust') {
      if (raw === '' || !Number.isInteger(qty) || qty < 0) { fieldError($('#mQty'), '실사한 실제 수량을 0 이상의 정수로 입력해 주세요.'); errors.push({ id: 'mQty', msg: '실제 수량을 입력해 주세요.' }); }
      else if (item && qty === item.stock) { fieldError($('#mQty'), '현재고와 같습니다. 실사 결과가 다를 때만 등록해 주세요.'); errors.push({ id: 'mQty', msg: '현재고와 같은 수량입니다.' }); }
    } else if (raw === '' || !Number.isInteger(qty) || qty < 1) {
      fieldError($('#mQty'), '수량은 1 이상의 정수로 입력해 주세요.'); errors.push({ id: 'mQty', msg: '수량을 1 이상의 정수로 입력해 주세요.' });
    } else if (item && type !== 'receive' && qty > item.stock) {
      const msg = item.stock === 0 ? '재고가 0이라 뺄 수 없습니다. 먼저 입고를 등록해 주세요.' : `현재고(${nf.format(item.stock)}${item.unit})보다 많습니다. ${nf.format(item.stock)} 이하로 입력해 주세요.`;
      fieldError($('#mQty'), msg); errors.push({ id: 'mQty', msg: '현재고보다 많은 수량입니다.' });
    }
    if (errors.length) return showSummary(moveForm, errors);

    const btn = $('#moveSubmit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      const mv = await api.recordMovement({ branchId: state.branch.id, productId: item.product_id, type, quantity: qty, memo: $('#mMemo').value });
      $('#moveDialog').close();
      const verb = type === 'adjust' ? `실사 반영 (${mv.quantity > 0 ? '+' : '−'}${nf.format(Math.abs(mv.quantity))}${item.unit})` : `${TYPES[type].label} ${nf.format(qty)}${item.unit}`;
      toast(`${item.name} ${verb} 등록됨`, { undo: () => revert(mv.id) });
      await loadData();
    } catch (ex) {
      showServerError(moveForm, api.toAppError(ex).message);
    } finally {
      btn.disabled = false; btn.removeAttribute('aria-busy');
    }
  });

  // ------------------------------------------------------------------
  // Product dialog
  // ------------------------------------------------------------------
  const productDialog = setupDialog($('#productDialog'));
  const productForm = $('#productForm');
  let editingId = null;

  function openProduct(item) {
    productForm.reset();
    clearErrors(productForm);
    editingId = item ? item.product_id : null;
    $('#productTitle').textContent = item ? '품목 수정' : '품목 추가';
    $('#pName').value = item?.name || '';
    $('#pSku').value = item?.sku || '';
    $('#pBrand').value = item?.brand || '';
    const pc = $('#pCategory');
    if (item && !state.categories.some((c) => c.name === item.category)) pc.add(new Option(item.category, item.category));
    pc.value = item?.category || '';
    $('#pUnit').value = item?.unit || '개';
    $('#pCost').value = item ? item.cost_price : '';
    $('#pRetail').value = item?.retail_price ?? '';
    $('#pSafety').value = item ? item.safety_stock : '';
    $('#pLocation').value = item?.location || '';
    $('#pRetailFlag').checked = Boolean(item?.is_retail);
    $('#pActive').checked = item ? item.active : true;
    const catalogLocked = !isAdmin();
    $$('[data-catalog]', productForm).forEach((el) => { el.disabled = catalogLocked; });
    $('#productScopeNote').hidden = !catalogLocked;
    if (catalogLocked) $('#productTitle').textContent = `${state.branch.name} 품목 설정`;
    productDialog.open();
    (catalogLocked ? $('#pSafety') : $('#pName')).focus();
  }

  productForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(productForm);
    const errors = [];
    if (!isAdmin()) {
      const raw = $('#pSafety').value.trim();
      const n = Number(raw);
      if (raw === '' || !Number.isInteger(n) || n < 0) {
        fieldError($('#pSafety'), '안전재고는 0 이상의 정수로 입력해 주세요.');
        return showSummary(productForm, [{ id: 'pSafety', msg: '안전재고를 확인해 주세요.' }]);
      }
      const btn = $('#productSubmit');
      btn.disabled = true; btn.setAttribute('aria-busy', 'true');
      try {
        await api.setBranchItem(state.branch.id, editingId, n, $('#pLocation').value);
        $('#productDialog').close();
        toast(`${$('#pName').value.trim()}의 ${state.branch.name} 설정을 저장했습니다.`);
        await loadData();
      } catch (ex) {
        showServerError(productForm, api.toAppError(ex).message);
      } finally {
        btn.disabled = false; btn.removeAttribute('aria-busy');
      }
      return;
    }
    const need = (id, label) => {
      const el = $('#' + id);
      if (!el.value.trim()) { fieldError(el, `${label}을(를) 입력해 주세요.`); errors.push({ id, msg: `${label}을(를) 입력해 주세요.` }); return false; }
      return true;
    };
    const intField = (id, label, required) => {
      const el = $('#' + id);
      const raw = el.value.trim();
      if (!raw) {
        if (required) { fieldError(el, `${label}을(를) 입력해 주세요.`); errors.push({ id, msg: `${label}을(를) 입력해 주세요.` }); }
        return null;
      }
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) { fieldError(el, `${label}은(는) 0 이상의 정수로 입력해 주세요.`); errors.push({ id, msg: `${label}을(를) 확인해 주세요.` }); return null; }
      return n;
    };
    need('pName', '품목명');
    if (need('pSku', '품목 코드') && !/^[A-Za-z0-9-]+$/.test($('#pSku').value.trim())) {
      fieldError($('#pSku'), '품목 코드는 영문, 숫자, 하이픈(-)만 쓸 수 있습니다.');
      errors.push({ id: 'pSku', msg: '품목 코드 형식을 확인해 주세요.' });
    }
    if (!$('#pCategory').value) { fieldError($('#pCategory'), '카테고리를 선택해 주세요.'); errors.push({ id: 'pCategory', msg: '카테고리를 선택해 주세요.' }); }
    need('pUnit', '단위');
    const cost = intField('pCost', '매입가', true);
    const retail = intField('pRetail', '판매가', false);
    const safety = intField('pSafety', '안전재고', true);
    if (errors.length) return showSummary(productForm, errors);

    const btn = $('#productSubmit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      await api.saveProduct(state.branch.id, {
        productId: editingId, sku: $('#pSku').value, name: $('#pName').value, brand: $('#pBrand').value,
        category: $('#pCategory').value, unit: $('#pUnit').value, costPrice: cost, retailPrice: retail,
        isRetail: $('#pRetailFlag').checked, safetyStock: safety, location: $('#pLocation').value,
        active: $('#pActive').checked,
      });
      $('#productDialog').close();
      toast(editingId ? `${$('#pName').value.trim()} 품목을 수정했습니다.` : `${$('#pName').value.trim()} 품목을 추가했습니다.`);
      await loadData();
    } catch (ex) {
      const err = api.toAppError(ex);
      if (err.code === 'DUPLICATE_SKU') { fieldError($('#pSku'), err.message); showSummary(productForm, [{ id: 'pSku', msg: err.message }]); }
      else showServerError(productForm, err.message);
    } finally {
      btn.disabled = false; btn.removeAttribute('aria-busy');
    }
  });

  // ------------------------------------------------------------------
  // Users (admin: every branch, every field · manager: own branch role/active)
  // ------------------------------------------------------------------
  const ROLE_RANK = { admin: 0, manager: 1, staff: 2 };
  const LOGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{1,29}$/;
  const relFmt = new Intl.RelativeTimeFormat('ko-KR', { numeric: 'auto' });
  function relTime(iso) {
    if (!iso) return '로그인 기록 없음';
    const diff = (Date.parse(iso) - Date.now()) / 1000;
    const abs = Math.abs(diff);
    if (abs < 60) return '방금';
    if (abs < 3600) return relFmt.format(Math.round(diff / 60), 'minute');
    if (abs < 86400) return relFmt.format(Math.round(diff / 3600), 'hour');
    return relFmt.format(Math.round(diff / 86400), 'day');
  }
  const loginOf = (u) => u.login_id || (u.email || '').split('@')[0];

  function fillUserBranchFilter() {
    const sel = $('#usBranch');
    sel.innerHTML = '<option value="">전체 지점</option><option value="none">미배정</option>'
      + state.branches.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
    sel.value = state.us.branch;
  }

  async function loadUsers() {
    if (!isManager() || !state.branch) return;
    $('#usCount').textContent = '불러오는 중…';
    try {
      state.users = await api.listUsers(isAdmin() ? null : state.branch.id);
    } catch (e) {
      $('#usCount').textContent = '';
      toast(api.toAppError(e).message, { error: true });
      return;
    }
    fillUserBranchFilter();
    renderUsers();
  }

  function renderUsers() {
    const q = state.us.q.trim().toLowerCase();
    const f = state.us.branch;
    const rows = state.users
      .filter((u) => (!q || (u.full_name || '').toLowerCase().includes(q) || loginOf(u).includes(q))
        && (!f || (f === 'none' ? !u.branch_id && u.role !== 'admin' : u.branch_id === f)))
      .sort((a, b) => Number(b.active) - Number(a.active) || ROLE_RANK[a.role] - ROLE_RANK[b.role] || (a.full_name || '').localeCompare(b.full_name || '', 'ko'));
    const unassigned = state.users.filter((u) => !u.branch_id && u.role !== 'admin').length;
    $('#usCount').textContent = `${nf.format(rows.length)}명${isAdmin() && unassigned ? ` · 미배정 ${nf.format(unassigned)}명` : ''}`;
    $('#usEmpty').hidden = rows.length > 0;
    $('#usTable').hidden = rows.length === 0;
    $('#usBody').innerHTML = rows.map((u) => {
      const self = u.user_id === state.user.id;
      const branch = u.role === 'admin' ? '<span class="muted">전체 지점</span>'
        : u.branch_id ? esc(u.branch_name || branchName(u.branch_id)) : '<span class="tag tag-warn">미배정</span>';
      return `<tr class="${u.active ? '' : 'inactive-row'}">
        <td class="cell-name"><div class="item-name">${esc(u.full_name || '(이름 없음)')}${self ? '<span class="you">나</span>' : ''}</div><div class="item-sku">아이디 ${esc(loginOf(u))}</div></td>
        <td data-label="지점">${branch}</td>
        <td data-label="역할">${roleTag(u.role)}</td>
        <td data-label="상태">${u.active ? '사용 중' : '<span class="tag tag-off">중지</span>'}</td>
        <td data-label="최근 로그인">${relTime(u.last_sign_in_at)}</td>
        <td class="cell-action"><button type="button" class="btn btn-secondary btn-sm" data-edit-user="${u.user_id}" aria-label="${esc(u.full_name || loginOf(u))} 수정">${svgIcon('i-edit')}수정</button></td>
      </tr>`;
    }).join('');
  }

  let usTimer = 0;
  $('#usQ').addEventListener('input', (e) => { clearTimeout(usTimer); usTimer = setTimeout(() => { state.us.q = e.target.value; renderUsers(); }, 150); });
  $('#usBranch').addEventListener('change', (e) => { state.us.branch = e.target.value; renderUsers(); });

  // Password helpers shared by both dialogs
  function generatePassword() {
    // Skips look-alike characters (0/O, 1/l/I) so it can be read out loud.
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const buf = new Uint32Array(10);
    crypto.getRandomValues(buf);
    return Array.from(buf, (n) => chars[n % chars.length]).join('');
  }
  document.addEventListener('click', (e) => {
    const gen = e.target.closest('[data-pw-generate]');
    if (gen) {
      const pw = generatePassword();
      gen.dataset.pwGenerate.split(' ').forEach((id) => { const el = $('#' + id); el.value = pw; el.type = 'text'; el.dispatchEvent(new Event('input', { bubbles: true })); });
      const toggle = $(`[data-pw-toggle="${gen.dataset.pwGenerate}"]`);
      if (toggle) { toggle.setAttribute('aria-pressed', 'true'); toggle.setAttribute('aria-label', '비밀번호 숨기기'); }
      return;
    }
    const tog = e.target.closest('[data-pw-toggle]');
    if (tog) {
      const showPw = tog.getAttribute('aria-pressed') !== 'true';
      tog.dataset.pwToggle.split(' ').forEach((id) => { $('#' + id).type = showPw ? 'text' : 'password'; });
      tog.setAttribute('aria-pressed', String(showPw));
      tog.setAttribute('aria-label', showPw ? '비밀번호 숨기기' : '비밀번호 보기');
    }
  });
  function resetPasswordFields(ids) {
    ids.forEach((id) => { const el = $('#' + id); el.value = ''; el.type = 'password'; });
    $$('[data-pw-toggle]').forEach((t) => { t.setAttribute('aria-pressed', 'false'); t.setAttribute('aria-label', '비밀번호 보기'); });
  }
  // Validates a new password pair; returns an error list entry or null.
  function checkPasswordPair(id1, id2, required) {
    const a = $('#' + id1).value, b = $('#' + id2).value;
    if (!a && !b && !required) return [];
    if (a.length < 6 || a.length > 72) { fieldError($('#' + id1), '비밀번호는 6자 이상 72자 이하로 입력해 주세요.'); return [{ id: id1, msg: '비밀번호 길이를 확인해 주세요.' }]; }
    if (a !== b) { fieldError($('#' + id2), '두 비밀번호가 다릅니다. 같은 비밀번호를 입력해 주세요.'); return [{ id: id2, msg: '비밀번호 확인이 일치하지 않습니다.' }]; }
    return [];
  }
  function checkLoginId(id) {
    const el = $('#' + id);
    const v = el.value.trim().toLowerCase();
    if (!LOGIN_ID_RE.test(v)) { fieldError(el, '아이디는 영문 소문자·숫자로 시작하고, 영문·숫자·마침표·밑줄·하이픈으로 2~30자입니다.'); return [{ id, msg: '아이디 형식을 확인해 주세요.' }]; }
    return [];
  }

  // Create user dialog (admin)
  const createUserDialog = setupDialog($('#createUserDialog'));
  const createUserForm = $('#createUserForm');
  const cuRole = () => $('input[name="cuRole"]:checked').value;
  function syncCreateBranch() {
    const admin = cuRole() === 'admin';
    $('#cuBranch').disabled = admin;
    $('#cuBranchHelp').textContent = admin ? '전체 관리자는 특정 지점 없이 모든 지점을 관리합니다.' : '';
  }
  $$('input[name="cuRole"]').forEach((r) => r.addEventListener('change', syncCreateBranch));

  function openCreateUser() {
    createUserForm.reset();
    clearErrors(createUserForm);
    resetPasswordFields(['cuPassword', 'cuPassword2']);
    const choices = state.branches.filter((b) => b.active !== false);
    $('#cuBranch').innerHTML = choices.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
    const preferred = state.us.branch && state.us.branch !== 'none' ? state.us.branch : state.branch.id;
    $('#cuBranch').value = choices.some((b) => b.id === preferred) ? preferred : choices[0]?.id || '';
    syncCreateBranch();
    createUserDialog.open();
    $('#cuLogin').focus();
  }

  createUserForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(createUserForm);
    const role = cuRole();
    const errors = [...checkLoginId('cuLogin')];
    if (!$('#cuName').value.trim()) { fieldError($('#cuName'), '이름을 입력해 주세요.'); errors.push({ id: 'cuName', msg: '이름을 입력해 주세요.' }); }
    errors.push(...checkPasswordPair('cuPassword', 'cuPassword2', true));
    if (role !== 'admin' && !$('#cuBranch').value) { fieldError($('#cuBranch'), '지점을 선택해 주세요.'); errors.push({ id: 'cuBranch', msg: '지점을 선택해 주세요.' }); }
    if (errors.length) return showSummary(createUserForm, errors);

    const btn = $('#createUserSubmit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    const loginId = $('#cuLogin').value.trim().toLowerCase();
    try {
      await api.createUser({
        loginId, password: $('#cuPassword').value, fullName: $('#cuName').value.trim(),
        role, branchId: role === 'admin' ? null : $('#cuBranch').value,
      });
      $('#createUserDialog').close();
      const where = role === 'admin' ? '전체 관리자' : `${branchName($('#cuBranch').value)} ${ROLE_LABEL[role]}`;
      toast(`${$('#cuName').value.trim()}(${loginId}) 계정을 ${where}(으)로 만들었습니다. 아이디와 비밀번호를 본인에게 전달해 주세요.`);
      resetPasswordFields(['cuPassword', 'cuPassword2']);
      await loadUsers();
    } catch (ex) {
      const err = api.toAppError(ex);
      if (['INVALID_LOGIN_ID', 'LOGIN_ID_TAKEN'].includes(err.code)) { fieldError($('#cuLogin'), err.message); showSummary(createUserForm, [{ id: 'cuLogin', msg: err.message }]); }
      else if (err.code === 'WEAK_PASSWORD') { fieldError($('#cuPassword'), err.message); showSummary(createUserForm, [{ id: 'cuPassword', msg: err.message }]); }
      else showServerError(createUserForm, err.message);
    } finally {
      btn.disabled = false; btn.removeAttribute('aria-busy');
    }
  });

  // User edit dialog
  const userDialog = setupDialog($('#userDialog'));
  const userForm = $('#userForm');
  let editingUser = null;
  const userRole = () => $('input[name="uRole"]:checked')?.value;

  function syncUserBranch() {
    const self = editingUser && editingUser.user_id === state.user.id;
    const sel = $('#uBranch');
    const help = $('#uBranchHelp');
    if (userRole() === 'admin') {
      sel.disabled = true;
      help.textContent = '전체 관리자는 특정 지점 없이 모든 지점을 관리합니다.';
    } else {
      sel.disabled = self;
      help.textContent = isAdmin() ? '' : '다른 지점으로 옮기는 것은 전체 관리자가 합니다.';
    }
  }
  $$('input[name="uRole"]').forEach((r) => r.addEventListener('change', syncUserBranch));

  function openUser(u) {
    editingUser = u;
    userForm.reset();
    clearErrors(userForm);
    resetPasswordFields(['uPassword', 'uPassword2']);
    const self = u.user_id === state.user.id;
    $('#userTitle').textContent = self ? '내 계정' : `${u.full_name || loginOf(u)} 수정`;
    $('#uSelfNote').hidden = !self;
    $('#uLogin').value = loginOf(u);
    $('#uLogin').readOnly = !isAdmin();
    $('#uLoginHelp').textContent = isAdmin() ? '바꾸면 다음 로그인부터 새 아이디를 씁니다.' : '아이디는 전체 관리자가 바꿀 수 있습니다.';
    $('#uName').value = u.full_name || '';
    const options = isAdmin()
      ? '<option value="">미배정</option>' + state.branches.map((b) => `<option value="${b.id}">${esc(b.name)}${b.active === false ? ' (중지)' : ''}</option>`).join('')
      : `<option value="${state.branch.id}">${esc(state.branch.name)}</option><option value="">지점에서 제외</option>`;
    $('#uBranch').innerHTML = options;
    $('#uBranch').value = u.branch_id || '';
    $$('input[name="uRole"]').forEach((r) => { r.checked = r.value === u.role; r.disabled = self; });
    $('#uActive').checked = u.active;
    $('#uActive').disabled = self;
    syncUserBranch();
    userDialog.open();
    (isAdmin() ? $('#uLogin') : $('#uName')).focus();
  }

  userForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(userForm);
    const u = editingUser;
    const role = userRole();
    const newLogin = $('#uLogin').value.trim().toLowerCase();
    const loginChanged = isAdmin() && newLogin !== loginOf(u);
    const password = isAdmin() ? $('#uPassword').value : '';
    const errors = [];
    if (loginChanged) errors.push(...checkLoginId('uLogin'));
    if (isAdmin()) errors.push(...checkPasswordPair('uPassword', 'uPassword2', false));
    if (errors.length) return showSummary(userForm, errors);

    const btn = $('#userSubmit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    const done = [];
    try {
      if (loginChanged) { await api.changeLoginId(u.user_id, newLogin); done.push(`아이디를 ${newLogin}(으)로`); }
      await api.updateUser({
        userId: u.user_id, fullName: $('#uName').value, role,
        branchId: role === 'admin' ? null : $('#uBranch').value || null,
        active: $('#uActive').checked,
      });
      if (password) { await api.setPassword(u.user_id, password); done.push('비밀번호를'); }
      $('#userDialog').close();
      const name = $('#uName').value.trim() || loginOf(u);
      toast(done.length ? `${name}: ${done.join(', ')} 바꾸고 정보를 저장했습니다.` : `${name} 정보를 저장했습니다.`);
      if (u.user_id === state.user.id) {
        state.profile.full_name = $('#uName').value.trim() || state.profile.full_name;
        $('#userName').textContent = state.profile.full_name;
      }
      resetPasswordFields(['uPassword', 'uPassword2']);
      await loadUsers();
    } catch (ex) {
      const err = api.toAppError(ex);
      const partial = done.length ? ` (${done.join(', ')} 바꾼 뒤 멈췄습니다.)` : '';
      if (['INVALID_LOGIN_ID', 'LOGIN_ID_TAKEN'].includes(err.code)) { fieldError($('#uLogin'), err.message); showSummary(userForm, [{ id: 'uLogin', msg: err.message + partial }]); }
      else if (err.code === 'WEAK_PASSWORD') { fieldError($('#uPassword'), err.message); showSummary(userForm, [{ id: 'uPassword', msg: err.message + partial }]); }
      else showServerError(userForm, err.message + partial);
      if (done.length) loadUsers();
    } finally {
      btn.disabled = false; btn.removeAttribute('aria-busy');
    }
  });

  // ------------------------------------------------------------------
  // Branches (admin: all · manager: own branch info)
  // ------------------------------------------------------------------
  // 지점 담당자 = the branch's active managers (set in 사용자 관리).
  async function loadBranchManagers() {
    try { state.branchManagers = await api.listBranchManagers(); } catch (e) { state.branchManagers = false; }
    if (state.route === 'branches') renderBranches();
  }
  function managerCell(branchId) {
    if (state.branchManagers === false) return '—';
    if (!state.branchManagers) return '<span class="muted">…</span>';
    const names = state.branchManagers.filter((u) => u.branch_id === branchId).map((u) => esc(u.full_name || u.login_id));
    return names.length ? names.join(', ') : '<span class="muted">미지정</span>';
  }

  function renderBranches() {
    if (!isManager()) return;
    $('#branchNote').textContent = isAdmin()
      ? '전체 관리자는 지점을 추가하고 모든 지점의 정보와 운영 여부를 바꿀 수 있습니다. 새 지점에는 모든 품목이 재고 0으로 준비됩니다.'
      : '지점 관리자는 이 지점의 이름, 전화번호, 주소를 수정할 수 있습니다. 지점 코드와 운영 여부는 전체 관리자가 바꿉니다.';
    $('#brBody').innerHTML = state.branches.map((b) => `<tr class="${b.active === false ? 'inactive-row' : ''}">
      <td class="cell-name"><div class="branch-cell">${b.photo_url
        ? `<img class="branch-thumb" src="${esc(b.photo_url)}" alt="" loading="lazy" />`
        : `<span class="branch-thumb branch-thumb-empty" aria-hidden="true">${svgIcon('i-image')}</span>`}
        <div><div class="item-name">${esc(b.name)}</div><div class="item-sku">${esc(b.code)}</div></div></div></td>
      <td data-label="지점 담당자">${managerCell(b.id)}</td>
      <td data-label="연락처">${esc(b.phone || '—')}</td>
      <td data-label="주소"><span class="memo">${esc(b.address || '—')}</span></td>
      <td data-label="상태">${b.active === false ? '<span class="tag tag-off">중지</span>' : '운영 중'}</td>
      <td class="cell-action"><button type="button" class="btn btn-secondary btn-sm" data-edit-branch="${b.id}" aria-label="${esc(b.name)} 수정">${svgIcon('i-edit')}수정</button></td>
    </tr>`).join('');
  }

  const branchDialog = setupDialog($('#branchDialog'));
  const branchForm = $('#branchForm');
  let editingBranch = null;

  function openBranch(b) {
    editingBranch = b;
    branchForm.reset();
    clearErrors(branchForm);
    $('#branchTitle').textContent = b ? `${b.name} 정보 수정` : '지점 추가';
    $('#bCode').value = b?.code || '';
    $('#bName').value = b?.name || '';
    $('#bPhone').value = b?.phone || '';
    $('#bAddress').value = b?.address || '';
    $('#bActive').checked = b ? b.active !== false : true;
    $('#bCode').disabled = !isAdmin();
    setPhotoDraft(null);
    branchDialog.open();
    (isAdmin() && !b ? $('#bCode') : $('#bName')).focus();
  }

  // Branch photo: chosen in the dialog, resized in the browser, uploaded on save.
  // photoDraft: null = unchanged, { blob, url } = new photo, 'remove' = delete.
  let photoDraft = null;
  function setPhotoDraft(draft) {
    if (photoDraft?.url) URL.revokeObjectURL(photoDraft.url);
    photoDraft = draft;
    const current = draft === 'remove' ? null : draft?.url || editingBranch?.photo_url || null;
    const box = $('#bPhotoPreview');
    box.style.backgroundImage = current ? `url("${current.replace(/"/g, '%22')}")` : '';
    box.classList.toggle('is-empty', !current);
    $('#bPhotoRemove').hidden = !current;
    $('#bPhotoPick').textContent = current ? '사진 바꾸기' : '사진 선택';
    $('#bPhotoFile').value = '';
    $('#bPhotoFileErr').hidden = true;
    $('#bPhotoFile').removeAttribute('aria-invalid');
  }

  // Longest side at most 1920px, re-encoded as JPEG (~200-500 KB): quick to
  // load on the sign-in screen and small enough for the free storage tier.
  // square: centre-crop to a square (staff portraits).
  async function preparePhoto(file, { max = 1920, square = false } = {}) {
    if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) throw new Error('이미지 파일만 올릴 수 있습니다.');
    if (file.size > 30 * 1024 * 1024) throw new Error('30MB 이하의 사진을 선택해 주세요.');
    const src = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = src;
      try { await img.decode(); } catch (e) { throw new Error('이 사진 형식을 읽을 수 없습니다. JPG나 PNG 사진으로 올려 주세요.'); }
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const sw = square ? side : img.naturalWidth, sh = square ? side : img.naturalHeight;
      const sx = (img.naturalWidth - sw) / 2, sy = square ? Math.max(0, (img.naturalHeight - sh) / 3) : 0;  // faces sit high
      const scale = Math.min(1, max / Math.max(sw, sh));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(sw * scale);
      canvas.height = Math.round(sh * scale);
      canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
      if (!blob) throw new Error('사진을 처리하지 못했습니다. 다른 사진으로 시도해 주세요.');
      return blob;
    } finally {
      URL.revokeObjectURL(src);
    }
  }

  $('#bPhotoFile').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const pick = $('#bPhotoPick');
    pick.setAttribute('aria-busy', 'true');
    try {
      const blob = await preparePhoto(file);
      setPhotoDraft({ blob, url: URL.createObjectURL(blob) });
    } catch (ex) {
      $('#bPhotoFile').value = '';
      fieldError($('#bPhotoFile'), ex.message);
      $('#bPhotoPick').focus();
    } finally {
      pick.removeAttribute('aria-busy');
    }
  });
  $('#bPhotoRemove').addEventListener('click', () => { setPhotoDraft('remove'); $('#bPhotoPick').focus(); });
  $('#bPhotoPick').addEventListener('click', () => $('#bPhotoFile').click());

  branchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(branchForm);
    const code = $('#bCode').value.trim().toUpperCase();
    const errors = [];
    if (isAdmin() && !/^[A-Z0-9-]{2,12}$/.test(code)) { fieldError($('#bCode'), '지점 코드는 영문 대문자·숫자·하이픈 2~12자로 입력해 주세요.'); errors.push({ id: 'bCode', msg: '지점 코드를 확인해 주세요.' }); }
    if (!$('#bName').value.trim()) { fieldError($('#bName'), '지점명을 입력해 주세요.'); errors.push({ id: 'bName', msg: '지점명을 입력해 주세요.' }); }
    if (errors.length) return showSummary(branchForm, errors);

    const btn = $('#branchSubmit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      const id = await api.saveBranch({
        id: editingBranch?.id || null, code: code || editingBranch?.code, name: $('#bName').value,
        phone: $('#bPhone').value, address: $('#bAddress').value, active: $('#bActive').checked,
      });
      let photoError = null;
      try {
        if (photoDraft === 'remove') await api.removeBranchPhoto(id);
        else if (photoDraft?.blob) await api.setBranchPhoto(id, photoDraft.blob);
      } catch (px) { photoError = api.toAppError(px).message; }
      $('#branchDialog').close();
      setPhotoDraft(null);
      const saved = editingBranch ? `${$('#bName').value.trim()} 정보를 저장했습니다.` : `새 지점 "${$('#bName').value.trim()}"을 추가했습니다. 모든 품목이 재고 0으로 준비되었습니다.`;
      if (photoError) toast(`${saved} 사진은 올리지 못했습니다: ${photoError}`, { error: true });
      else toast(saved);
      state.branches = await api.listBranches();
      state.branch = state.branches.find((b) => b.id === state.branch.id) || state.branches[0];
      fillBranchSelect();
      renderBranches();
      $('#branchLine').textContent = `${state.branch.name} · ${fullFmt.format(new Date())}`;
    } catch (ex) {
      const err = api.toAppError(ex);
      if (err.code === 'DUPLICATE_BRANCH_CODE' || err.code === 'INVALID_BRANCH') {
        fieldError($('#bCode'), err.message);
        showSummary(branchForm, [{ id: 'bCode', msg: err.message }]);
      } else {
        showServerError(branchForm, err.message);
      }
    } finally {
      btn.disabled = false; btn.removeAttribute('aria-busy');
    }
  });

  // ------------------------------------------------------------------
  // Staff (직원 관리 · admin and the branch's manager)
  // ------------------------------------------------------------------
  const POSITIONS = { director: '원장', chief: '실장', designer: '디자이너', intern: '인턴', desk: '데스크' };
  const POS_RANK = { director: 0, chief: 1, designer: 2, intern: 3, desk: 4 };
  const DESIGNER_POS = ['director', 'chief', 'designer'];  // take their own clients
  const SERVICES = { cut: '컷', perm: '펌', color: '염색', clinic: '클리닉', scalp: '두피 케어', styling: '드라이·스타일링', updo: '업스타일' };
  const WEEK = [1, 2, 3, 4, 5, 6, 0];  // 월 … 일
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const STATUS_RANK = { active: 0, leave: 1, left: 2 };
  state.staff = [];
  state.st = { q: '', pos: '', status: 'current' };

  const todayKey = () => keyFmt.format(new Date());  // YYYY-MM-DD in Korea
  const todayDow = () => new Date(`${todayKey()}T00:00:00Z`).getUTCDay();
  const daysUntil = (date) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${todayKey()}T00:00:00Z`)) / DAY);
  const isOff = (x, dow) => (x.days_off || []).includes(dow);
  function certState(x) {
    if (!x.health_cert_expires) return 'none';
    const d = daysUntil(x.health_cert_expires);
    return d < 0 ? 'expired' : d <= 30 ? 'soon' : 'ok';
  }
  const needsCert = (x) => x.status !== 'left' && certState(x) !== 'ok';
  function tenure(from, to) {
    if (!from) return '';
    const a = new Date(`${from}T00:00:00Z`), b = new Date(`${to || todayKey()}T00:00:00Z`);
    let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
    if (b.getUTCDate() < a.getUTCDate()) m -= 1;
    if (m < 1) return '1개월 미만';
    return m >= 12 ? `${Math.floor(m / 12)}년${m % 12 ? ` ${m % 12}개월` : ''}` : `${m}개월`;
  }
  const dateText = (d) => d.replace(/-/g, '.');
  const daysText = (days) => (days && days.length ? WEEK.filter((d) => days.includes(d)).map((d) => DOW[d]).join('·') : '없음');
  const rateText = (v) => (v == null ? '—' : `${Number(v)}%`);
  const nameList = (xs) => xs.map((x) => esc(x.name)).join(', ');
  const staffAvatar = (x, cls = '') => (x.photo_url
    ? `<img class="st-avatar ${cls}" src="${esc(x.photo_url)}" alt="" loading="lazy" />`
    : `<span class="st-avatar st-avatar-empty pos-${x.position} ${cls}" aria-hidden="true">${esc((x.name || '?').slice(0, 1))}</span>`);

  async function loadStaff() {
    if (!isManager() || !state.branch) return;
    const box = $('#stError');
    try {
      state.staff = await api.listStaff(state.branch.id);
      box.hidden = true;
    } catch (e) {
      state.staff = [];
      box.textContent = api.toAppError(e).message;
      box.hidden = false;
    }
    renderStaff();
  }

  function certCell(x) {
    const c = certState(x);
    if (c === 'none') return x.status === 'left' ? '—' : '<span class="tag tag-warn">미등록</span>';
    const d = daysUntil(x.health_cert_expires);
    const date = `<small class="muted">${dateText(x.health_cert_expires)}</small>`;
    if (x.status === 'left') return date;
    if (c === 'expired') return `<span class="tag tag-off">만료 ${nf.format(-d)}일 지남</span>${date}`;
    if (c === 'soon') return `<span class="tag tag-warn">D-${d}</span>${date}`;
    return `<span class="cert-ok">${dateText(x.health_cert_expires)}</span>`;
  }

  function renderStaff() {
    if (!isManager()) return;
    const all = state.staff;
    const active = all.filter((x) => x.status === 'active');
    const dow = todayDow();

    // Summary cards
    $('#stKpiActive').textContent = `${nf.format(active.length)}명`;
    $('#stKpiActiveSub').textContent = `휴직 ${nf.format(all.filter((x) => x.status === 'leave').length)}명 · 퇴사 ${nf.format(all.filter((x) => x.status === 'left').length)}명`;
    const designers = active.filter((x) => DESIGNER_POS.includes(x.position));
    $('#stKpiDesigners').textContent = `${nf.format(designers.length)}명`;
    $('#stKpiDesignersSub').textContent = `원장·실장 포함 · 인턴 ${nf.format(active.filter((x) => x.position === 'intern').length)}명`;
    const offToday = active.filter((x) => isOff(x, dow));
    $('#stKpiToday').textContent = `${nf.format(active.length - offToday.length)}명`;
    $('#stKpiTodaySub').innerHTML = `${DOW[dow]}요일 · ${offToday.length ? `휴무 ${nameList(offToday)}` : '휴무 없음'}`;
    $('#stKpiCert').textContent = `${nf.format(all.filter(needsCert).length)}명`;

    // Weekly day-off board
    $('#stRoster').innerHTML = WEEK.map((d) => {
      const off = active.filter((x) => isOff(x, d));
      const working = active.length - off.length;
      const des = designers.filter((x) => !isOff(x, d)).length;
      const gap = active.length > 0 && des === 0;
      return `<li class="roster-day${d === dow ? ' is-today' : ''}${gap ? ' is-gap' : ''}">
        <div class="roster-head"><strong>${DOW[d]}</strong>${d === dow ? '<span class="roster-today">오늘</span>' : ''}</div>
        <p class="roster-count"><span class="roster-num">${nf.format(working)}</span>명 근무</p>
        <p class="roster-des">${gap ? '<span class="tag tag-off">디자이너 없음</span>' : `디자이너 ${nf.format(des)}명`}</p>
        <p class="roster-off">${off.length ? `<span class="sr-only">휴무: </span>${off.map((x) => `<span class="off-name">${staffAvatar(x, 'st-avatar-xs')}${esc(x.name)}</span>`).join('')}` : '<span class="muted">휴무 없음</span>'}</p>
      </li>`;
    }).join('');

    // List
    const q = state.st.q.trim().toLowerCase();
    const f = state.st.status;
    const rows = all
      .filter((x) => (!q || x.name.toLowerCase().includes(q) || (x.phone || '').replace(/-/g, '').includes(q.replace(/-/g, '')))
        && (!state.st.pos || x.position === state.st.pos)
        && (f === '' || (f === 'current' && x.status !== 'left') || (f === 'left' && x.status === 'left') || (f === 'cert' && needsCert(x))))
      .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || POS_RANK[a.position] - POS_RANK[b.position] || a.name.localeCompare(b.name, 'ko'));
    $('#stCount').textContent = `${nf.format(rows.length)}명`;
    $('#stEmpty').hidden = rows.length > 0;
    $('#stTable').hidden = rows.length === 0;
    $('#stEmptyText').textContent = all.length ? '조건에 맞는 직원이 없습니다.' : '아직 등록된 직원이 없습니다. 직원 추가로 시작해 보세요.';
    $('#stBody').innerHTML = rows.map((x) => {
      const status = x.status === 'active' ? '재직'
        : x.status === 'leave' ? '<span class="tag tag-warn">휴직</span>'
        : `<span class="tag tag-off">퇴사</span><small class="muted">${x.left_on ? dateText(x.left_on) : ''}</small>`;
      const svc = (x.services || []).length
        ? `<div class="svc-chips">${Object.keys(SERVICES).filter((k) => x.services.includes(k)).map((k) => `<span class="svc-chip">${SERVICES[k]}</span>`).join('')}</div>` : '<span class="muted">—</span>';
      return `<tr class="${x.status === 'left' ? 'inactive-row' : ''}">
        <td class="cell-name"><div class="st-cell">${staffAvatar(x)}<div><div class="item-name">${esc(x.name)}<span class="tag pos-tag pos-${x.position}">${POSITIONS[x.position]}</span></div>
          <div class="item-sku">${esc(x.phone || '연락처 없음')}</div>${x.memo ? `<div class="st-memo">${esc(x.memo)}</div>` : ''}</div></div></td>
        <td data-label="담당 시술">${svc}</td>
        <td data-label="정기 휴무">${daysText(x.days_off)}</td>
        <td data-label="입사·근속" class="when">${x.hired_on ? `${dateText(x.hired_on)}<small>${tenure(x.hired_on, x.status === 'left' ? x.left_on : null)}</small>` : '<span class="muted">—</span>'}</td>
        <td data-label="인센티브"><span class="rates">시술 ${rateText(x.incentive_service)}<br>제품 ${rateText(x.incentive_retail)}</span></td>
        <td data-label="보건증"><div class="cert-cell">${certCell(x)}</div></td>
        <td data-label="상태"><div class="cert-cell">${status}</div></td>
        <td class="cell-action"><button type="button" class="btn btn-secondary btn-sm" data-edit-staff="${x.id}" aria-label="${esc(x.name)} 수정">${svgIcon('i-edit')}수정</button></td>
      </tr>`;
    }).join('');
  }

  // Filters
  $('#stPos').insertAdjacentHTML('beforeend', Object.entries(POSITIONS).map(([k, v]) => `<option value="${k}">${v}</option>`).join(''));
  let stTimer = 0;
  $('#stQ').addEventListener('input', (e) => { clearTimeout(stTimer); stTimer = setTimeout(() => { state.st.q = e.target.value; renderStaff(); }, 150); });
  $('#stPos').addEventListener('change', (e) => { state.st.pos = e.target.value; renderStaff(); });
  $('#stStatus').addEventListener('change', (e) => { state.st.status = e.target.value; renderStaff(); });
  $('#stKpiCertBtn').addEventListener('click', () => {
    state.st.status = 'cert'; $('#stStatus').value = 'cert';
    renderStaff();
    $('#stStatus').focus();
    $('#stTable').scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
  });

  // Dialog
  const staffDialog = setupDialog($('#staffDialog'));
  const staffForm = $('#staffForm');
  let editingStaff = null;
  $('#sPosition').innerHTML = Object.entries(POSITIONS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $('#sServices').innerHTML = Object.entries(SERVICES).map(([k, v]) => `<label class="radio"><input type="checkbox" name="sSvc" value="${k}" /> ${v}</label>`).join('');
  $('#sDays').innerHTML = WEEK.map((d) => `<label class="radio day-chip"><input type="checkbox" name="sDay" value="${d}" /> ${DOW[d]}</label>`).join('');
  const syncLeftField = () => { $('#sLeftField').hidden = staffForm.elements.sStatus.value !== 'left'; };
  $$('input[name="sStatus"]').forEach((r) => r.addEventListener('change', syncLeftField));

  // Portrait: square-cropped to 480px JPEG in the browser, uploaded on save.
  let staffPhotoDraft = null;  // null = unchanged, { blob, url } = new, 'remove'
  function setStaffPhotoDraft(draft) {
    if (staffPhotoDraft?.url) URL.revokeObjectURL(staffPhotoDraft.url);
    staffPhotoDraft = draft;
    const current = draft === 'remove' ? null : draft?.url || editingStaff?.photo_url || null;
    const box = $('#sPhotoPreview');
    box.style.backgroundImage = current ? `url("${current.replace(/"/g, '%22')}")` : '';
    box.classList.toggle('is-empty', !current);
    box.textContent = current ? '' : ($('#sName').value.trim() || '?').slice(0, 1);
    $('#sPhotoRemove').hidden = !current;
    $('#sPhotoPick').textContent = current ? '사진 바꾸기' : '사진 선택';
    $('#sPhotoFile').value = '';
    $('#sPhotoFileErr').hidden = true;
  }
  $('#sPhotoFile').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const pick = $('#sPhotoPick');
    pick.setAttribute('aria-busy', 'true');
    try {
      const blob = await preparePhoto(file, { max: 480, square: true });
      setStaffPhotoDraft({ blob, url: URL.createObjectURL(blob) });
    } catch (ex) {
      $('#sPhotoFile').value = '';
      fieldError($('#sPhotoFile'), ex.message);
      pick.focus();
    } finally {
      pick.removeAttribute('aria-busy');
    }
  });
  $('#sPhotoPick').addEventListener('click', () => $('#sPhotoFile').click());
  $('#sPhotoRemove').addEventListener('click', () => { setStaffPhotoDraft('remove'); $('#sPhotoPick').focus(); });
  $('#sName').addEventListener('input', () => { if ($('#sPhotoPreview').classList.contains('is-empty')) $('#sPhotoPreview').textContent = ($('#sName').value.trim() || '?').slice(0, 1); });

  function openStaff(x) {
    editingStaff = x;
    staffForm.reset();
    clearErrors(staffForm);
    $('#staffTitle').textContent = x ? `${x.name} 정보 수정` : `직원 추가 · ${state.branch.name}`;
    $('#sName').value = x?.name || '';
    $('#sPosition').value = x?.position || 'designer';
    $('#sPhone').value = x?.phone || '';
    $('#sHired').value = x?.hired_on || '';
    staffForm.elements.sStatus.value = x?.status || 'active';
    $('#sLeftOn').value = x?.left_on || '';
    $$('input[name="sSvc"]').forEach((c) => { c.checked = !!x?.services?.includes(c.value); });
    $$('input[name="sDay"]').forEach((c) => { c.checked = !!x?.days_off?.includes(Number(c.value)); });
    $('#sIncS').value = x?.incentive_service ?? '';
    $('#sIncR').value = x?.incentive_retail ?? '';
    $('#sLicense').value = x?.license_no || '';
    $('#sCert').value = x?.health_cert_expires || '';
    $('#sMemo').value = x?.memo || '';
    $('#staffDelete').hidden = !x;
    syncLeftField();
    setStaffPhotoDraft(null);
    staffDialog.open();
    $('#sName').focus();
  }

  staffForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(staffForm);
    const errors = [];
    const name = $('#sName').value.trim();
    if (!name) { fieldError($('#sName'), '이름을 입력해 주세요.'); errors.push({ id: 'sName', msg: '이름을 입력해 주세요.' }); }
    const rate = (id, label) => {
      const raw = $('#' + id).value.trim();
      if (raw === '') return null;
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0 || v > 100) {
        fieldError($('#' + id), `${label}는 0~100 사이로 입력해 주세요.`);
        errors.push({ id, msg: `${label}를 확인해 주세요.` });
      }
      return v;
    };
    const incS = rate('sIncS', '시술 인센티브'), incR = rate('sIncR', '제품 판매 인센티브');
    const status = staffForm.elements.sStatus.value;
    const hired = $('#sHired').value, left = status === 'left' ? $('#sLeftOn').value : '';
    if (left && hired && left < hired) { fieldError($('#sLeftOn'), '퇴사일은 입사일 이후여야 합니다.'); errors.push({ id: 'sLeftOn', msg: '퇴사일을 확인해 주세요.' }); }
    if (errors.length) return showSummary(staffForm, errors);

    const btn = $('#staffSubmit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      const branchId = editingStaff?.branch_id || state.branch.id;
      const id = await api.saveStaff({
        id: editingStaff?.id || null, branch_id: branchId, name,
        position: $('#sPosition').value, phone: $('#sPhone').value, hired_on: hired || null, status, left_on: left || null,
        services: $$('input[name="sSvc"]:checked').map((c) => c.value),
        days_off: $$('input[name="sDay"]:checked').map((c) => Number(c.value)),
        incentive_service: incS, incentive_retail: incR,
        license_no: $('#sLicense').value, health_cert_expires: $('#sCert').value || null, memo: $('#sMemo').value,
      });
      let photoError = null;
      try {
        if (staffPhotoDraft === 'remove') await api.removeStaffPhoto({ id, branch_id: branchId });
        else if (staffPhotoDraft?.blob) await api.setStaffPhoto({ id, branch_id: branchId }, staffPhotoDraft.blob);
      } catch (px) { photoError = api.toAppError(px).message; }
      $('#staffDialog').close();
      setStaffPhotoDraft(null);
      const saved = editingStaff ? `${name} 정보를 저장했습니다.` : `${name} 님을 ${state.branch.name} 직원으로 추가했습니다.`;
      if (photoError) toast(`${saved} 사진은 올리지 못했습니다: ${photoError}`, { error: true });
      else toast(saved);
      await loadStaff();
    } catch (ex) {
      showServerError(staffForm, api.toAppError(ex).message);
    } finally {
      btn.disabled = false; btn.removeAttribute('aria-busy');
    }
  });

  $('#staffDelete').addEventListener('click', () => {
    const x = editingStaff;
    if (!x) return;
    $('#staffDialog').close();
    askConfirm({
      title: '직원 기록 삭제',
      text: `${x.name} 님의 기록을 삭제할까요? 잘못 등록한 경우에만 삭제하세요. 그만둔 직원은 '퇴사'로 바꾸면 기록이 남습니다.`,
      run: async () => {
        await api.deleteStaff(x.id);
        toast(`${x.name} 님의 기록을 삭제했습니다.`);
        await loadStaff();
      },
    });
  });
  $('#addStaffBtn').addEventListener('click', () => openStaff(null));

  // ------------------------------------------------------------------
  // Categories (admin)
  // ------------------------------------------------------------------
  function renderCategories() {
    if (!isAdmin()) return;
    const counts = {};
    state.inventory.forEach((i) => { counts[i.category] = (counts[i.category] || 0) + 1; });
    const list = state.categories;
    $('#catCount').textContent = `${nf.format(list.length)}개 카테고리`;
    $('#catBody').innerHTML = list.map((c, i) => {
      const n = counts[c.name] || 0;
      return `<tr data-cat-open="${c.id}">
        <td data-label="순서"><span class="order-btns">
          <span class="pos">${i + 1}</span>
          <button type="button" class="icon-btn" data-cat-move="${c.id}" data-dir="-1" aria-label="${esc(c.name)} 위로" ${i === 0 ? 'disabled' : ''}>${svgIcon('i-up')}</button>
          <button type="button" class="icon-btn" data-cat-move="${c.id}" data-dir="1" aria-label="${esc(c.name)} 아래로" ${i === list.length - 1 ? 'disabled' : ''}>${svgIcon('i-down')}</button>
        </span></td>
        <td class="cell-name"><button type="button" class="cat-open-btn" data-cat-open-btn="${c.id}" aria-haspopup="dialog">${esc(c.name)}</button></td>
        <td class="num" data-label="제품 수">${nf.format(n)}</td>
        <td class="cell-action"><span class="row-actions">
          <button type="button" class="btn btn-secondary btn-sm" data-cat-edit="${c.id}" aria-label="${esc(c.name)} 이름 변경">${svgIcon('i-edit')}이름 변경</button>
          <button type="button" class="btn btn-sm btn-ghost-danger" data-cat-delete="${c.id}" aria-label="${esc(c.name)} 삭제" ${n ? `aria-describedby="catInUse-${c.id}"` : ''}>${svgIcon('i-trash')}삭제</button>
          ${n ? `<span class="sr-only" id="catInUse-${c.id}">제품 ${n}개가 있어 삭제할 수 없습니다</span>` : ''}
        </span></td>
      </tr>`;
    }).join('');
  }

  async function reloadCategories(focusSel) {
    state.categories = await api.listCategories();
    fillFilters();
    fillMoveItems();
    renderInventory();
    renderProducts();
    renderCategories();
    if (focusSel) { const el = $(focusSel); if (el && !el.disabled) el.focus(); }
  }

  async function moveCategory(id, dir, button) {
    const ids = state.categories.map((c) => c.id);
    const i = ids.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    button.disabled = true;
    try {
      await api.reorderCategories(ids);
      await reloadCategories(`[data-cat-move="${id}"][data-dir="${dir}"]`);
    } catch (e) {
      toast(api.toAppError(e).message, { error: true });
      button.disabled = false;
    }
  }

  const categoryDialog = setupDialog($('#categoryDialog'));
  const categoryForm = $('#categoryForm');
  let editingCategory = null;
  function openCategory(c) {
    editingCategory = c;
    categoryForm.reset();
    clearErrors(categoryForm);
    $('#categoryTitle').textContent = c ? `${c.name} 이름 변경` : '카테고리 추가';
    $('#cName').value = c?.name || '';
    $('#cNameHelp').textContent = c ? '이 카테고리의 모든 제품에 새 이름이 바로 반영됩니다.' : '예: 염모제, 두피케어';
    categoryDialog.open();
    $('#cName').focus();
  }
  categoryForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(categoryForm);
    const name = $('#cName').value.trim();
    if (!name) { fieldError($('#cName'), '카테고리 이름을 입력해 주세요.'); return showSummary(categoryForm, [{ id: 'cName', msg: '카테고리 이름을 입력해 주세요.' }]); }
    if (editingCategory && name === editingCategory.name) { $('#categoryDialog').close(); return; }
    const btn = $('#categorySubmit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      await api.saveCategory(editingCategory?.id || null, name);
      $('#categoryDialog').close();
      toast(editingCategory ? `"${editingCategory.name}"을(를) "${name}"(으)로 바꿨습니다.` : `"${name}" 카테고리를 추가했습니다.`);
      if (editingCategory) await loadData(); else await reloadCategories();
    } catch (ex) {
      const err = api.toAppError(ex);
      if (['DUPLICATE_CATEGORY', 'INVALID_CATEGORY'].includes(err.code)) { fieldError($('#cName'), err.message); showSummary(categoryForm, [{ id: 'cName', msg: err.message }]); }
      else showServerError(categoryForm, err.message);
    } finally {
      btn.disabled = false; btn.removeAttribute('aria-busy');
    }
  });

  // Category detail: products of one category in the selected branch
  const catDetailDialog = setupDialog($('#catDetailDialog'));
  let detailCategory = null;
  function openCategoryDetail(c) {
    detailCategory = c;
    const items = state.inventory
      .filter((i) => i.category === c.name)
      .sort((a, b) => Number(b.active) - Number(a.active) || STATUS[a.status].rank - STATUS[b.status].rank || a.name.localeCompare(b.name, 'ko'));
    const active = items.filter((i) => i.active);
    const value = active.reduce((a, i) => a + i.stock * i.cost_price, 0);
    const low = active.filter((i) => i.status === 'low').length;
    const out = active.filter((i) => i.status === 'out').length;
    $('#catDetailTitle').textContent = `${c.name} 제품 현황`;
    $('#catDetailSub').textContent = `${state.branch.name} 기준 · ${fullFmt.format(new Date())}`;
    $('#catDetailStats').innerHTML = `
      <div><dt>제품</dt><dd>${nf.format(active.length)}개</dd></div>
      <div><dt>재고 금액</dt><dd title="${won.format(value)}">${wonCompact.format(value)}</dd></div>
      <div class="${low ? 'warn' : ''}"><dt>재고 부족</dt><dd>${nf.format(low)}</dd></div>
      <div class="${out ? 'out' : ''}"><dt>품절</dt><dd>${nf.format(out)}</dd></div>`;
    $('#catDetailEmpty').hidden = items.length > 0;
    $('#catDetailTable').hidden = items.length === 0;
    $('#catDetailBody').innerHTML = items.map((i) => {
      const pct = Math.min(100, Math.round((i.stock / Math.max(i.safety_stock * 3, 1)) * 100));
      return `<tr class="${i.active ? '' : 'inactive-row'}">
        <td class="cell-name"><div class="item-name">${esc(i.name)}</div><div class="item-sku">${esc(i.sku)}${i.location ? ` · ${esc(i.location)}` : ''}${i.active ? '' : ' · 사용 안 함'}</div></td>
        <td class="num" data-label="현재고"><span class="stock-cell"><strong>${nf.format(i.stock)}<small class="muted"> ${esc(i.unit)}</small></strong><span class="meter" data-status="${i.status}" aria-hidden="true"><span style="width:${pct}%"></span></span></span></td>
        <td class="num" data-label="안전재고">${nf.format(i.safety_stock)}</td>
        <td data-label="상태">${badge(i.status)}</td>
        <td class="num" data-label="재고 금액">${won.format(i.stock * i.cost_price)}</td>
      </tr>`;
    }).join('');
    $('#catDetailGo').hidden = items.length === 0;
    catDetailDialog.open();
    $('#catDetailDialog .icon-btn[data-close]').focus();
  }
  $('#catDetailGo').addEventListener('click', () => {
    if (!detailCategory) return;
    Object.assign(state.inv, { q: '', status: '', cat: detailCategory.name });
    $('#invQ').value = ''; $('#invStatus').value = ''; $('#invCat').value = detailCategory.name;
    $('#catDetailDialog').close();
    location.hash = '#/inventory';
    renderInventory();
  });

  // Generic confirm dialog (window.confirm is not used so it works everywhere)
  const confirmDialog = setupDialog($('#confirmDialog'));
  let confirmAction = null;
  function askConfirm({ title, text, button = '삭제', run }) {
    $('#confirmTitle').textContent = title;
    $('#confirmText').textContent = text;
    $('#confirmSubmit').textContent = button;
    $('#confirmError').hidden = true;
    confirmAction = run;
    confirmDialog.open();
    $('#confirmSubmit').focus();
  }
  $('#confirmForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#confirmSubmit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      await confirmAction();
      $('#confirmDialog').close();
    } catch (ex) {
      const box = $('#confirmError');
      box.textContent = api.toAppError(ex).message;
      box.hidden = false;
    } finally {
      btn.disabled = false; btn.removeAttribute('aria-busy');
    }
  });

  function deleteCategory(c) {
    const n = state.inventory.filter((i) => i.category === c.name).length;
    if (n) {
      toast(`"${c.name}"에 제품 ${nf.format(n)}개가 있어 삭제할 수 없습니다. 제품 관리에서 카테고리를 먼저 바꿔 주세요.`, { error: true });
      return;
    }
    askConfirm({
      title: '카테고리 삭제',
      text: `"${c.name}" 카테고리를 삭제할까요? 이 카테고리에는 제품이 없습니다.`,
      run: async () => {
        await api.deleteCategory(c.id);
        toast(`"${c.name}" 카테고리를 삭제했습니다.`);
        await reloadCategories('#newCategoryBtn');
      },
    });
  }

  // ------------------------------------------------------------------
  // Global click actions
  // ------------------------------------------------------------------
  document.addEventListener('click', (e) => {
    const mv = e.target.closest('[data-move]');
    if (mv) return openMove({ productId: mv.dataset.move, type: mv.dataset.type || (itemById(mv.dataset.move)?.is_retail ? 'sale' : 'use'), qty: mv.dataset.qty || '' });
    const rv = e.target.closest('[data-revert]');
    if (rv) return revert(rv.dataset.revert, rv);
    const ed = e.target.closest('[data-edit]');
    if (ed) return openProduct(itemById(ed.dataset.edit));
    const eu = e.target.closest('[data-edit-user]');
    if (eu) return openUser(state.users.find((u) => u.user_id === eu.dataset.editUser));
    const cob = e.target.closest('[data-cat-open-btn]');
    if (cob) return openCategoryDetail(state.categories.find((c) => c.id === cob.dataset.catOpenBtn));
    const row = e.target.closest('tr[data-cat-open]');
    if (row && !e.target.closest('button, a, input, select')) {
      // Focus the row's name button first so closing the popup returns focus to this row.
      $('.cat-open-btn', row)?.focus({ preventScroll: true });
      return openCategoryDetail(state.categories.find((c) => c.id === row.dataset.catOpen));
    }
    const cm = e.target.closest('[data-cat-move]');
    if (cm) return moveCategory(cm.dataset.catMove, Number(cm.dataset.dir), cm);
    const ce = e.target.closest('[data-cat-edit]');
    if (ce) return openCategory(state.categories.find((c) => c.id === ce.dataset.catEdit));
    const cd = e.target.closest('[data-cat-delete]');
    if (cd) return deleteCategory(state.categories.find((c) => c.id === cd.dataset.catDelete));
    const es = e.target.closest('[data-edit-staff]');
    if (es) return openStaff(state.staff.find((x) => x.id === es.dataset.editStaff));
    const eb = e.target.closest('[data-edit-branch]');
    if (eb) return openBranch(state.branches.find((b) => b.id === eb.dataset.editBranch));
  });
  $('#addUserBtn').addEventListener('click', openCreateUser);
  $('#newBranchBtn').addEventListener('click', () => openBranch(null));
  $('#newCategoryBtn').addEventListener('click', () => openCategory(null));
  $('#newMoveBtn').addEventListener('click', () => openMove());
  $('#newProductBtn').addEventListener('click', () => openProduct(null));
  $('#demoReset').addEventListener('click', async () => {
    if (!api.resetDemo) return;
    api.resetDemo();
    await enter(await api.getUser());
    toast('샘플 데이터로 초기화했습니다.');
  });

  // ------------------------------------------------------------------
  // Toast
  // ------------------------------------------------------------------
  function toast(msg, { undo, error, action } = {}) {
    if (undo) action = { label: '실행 취소', run: undo };
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `${svgIcon(error ? 'i-alert' : 'i-check-circle')}<p></p>${action ? '<button type="button"></button>' : ''}`;
    if (action) $('button', el).textContent = action.label;
    $('p', el).textContent = msg;
    if (error) $('.icon', el).style.color = 'var(--danger)';
    $('#toastRegion').replaceChildren(el);
    let timer = setTimeout(() => el.remove(), action || error ? 7000 : 4000);
    el.addEventListener('mouseenter', () => clearTimeout(timer));
    el.addEventListener('focusin', () => clearTimeout(timer));
    el.addEventListener('mouseleave', () => { timer = setTimeout(() => el.remove(), 3000); });
    if (action) $('button', el).addEventListener('click', () => { el.remove(); action.run(); });
  }

  // ------------------------------------------------------------------
  // Shell: sidebar, theme
  // ------------------------------------------------------------------
  const sidebar = $('#sidebar'), scrim = $('#scrim'), menuBtn = $('#menuBtn');
  const mqDrawer = window.matchMedia('(max-width: 1023px)');
  function setSidebar(open) {
    sidebar.dataset.open = String(open);
    scrim.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기');
    if (open) $('.nav-link', sidebar).focus();
  }
  function closeSidebar() { if (sidebar.dataset.open === 'true') setSidebar(false); }
  menuBtn.addEventListener('click', () => setSidebar(sidebar.dataset.open !== 'true'));
  scrim.addEventListener('click', () => { setSidebar(false); menuBtn.focus(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sidebar.dataset.open === 'true') { setSidebar(false); menuBtn.focus(); } });
  mqDrawer.addEventListener('change', () => setSidebar(false));

  const themeBtn = $('#themeBtn');
  const isDark = () => document.documentElement.dataset.theme !== 'light';
  function syncThemeBtn() {
    $('use', themeBtn).setAttribute('href', isDark() ? '#i-sun' : '#i-moon');
    themeBtn.setAttribute('aria-label', isDark() ? '라이트 모드로 전환' : '다크 모드로 전환');
  }
  themeBtn.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('hp-theme', next); } catch (e) {}
    syncThemeBtn();
  });
  syncThemeBtn();

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------
  api.onAuthChange((event) => {
    if (event === 'SIGNED_OUT' && state.user) { state.user = null; showLogin('로그아웃되었습니다. 다시 로그인해 주세요.'); }
  });
  (async () => {
    if (api.configProblem) console.warn(api.configProblem);
    try {
      const user = await api.getUser();
      if (user) await enter(user); else showLogin();
    } catch (e) {
      showLogin(api.toAppError(e).message);
    }
  })();
})();
