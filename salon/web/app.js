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
    dashboard: '재고 현황',
    workboard: '근무 현황',
    inventory: '재고 목록',
    movements: '입출고 내역',
    sales: '판매 내역',
    schedule: '근무표',
    products: '제품 관리',
    categories: '카테고리 관리',
    report: '매장 레포트',
    staff: '직원 관리',
    payroll: '실적·정산',
    users: '사용자 관리',
    branches: '지점 관리',
    manual: '사용 매뉴얼',
    hq: '전체현황',
    sns: 'SNS 홍보',
  };
  const MANAGER_ROUTES = ['report', 'staff', 'payroll', 'branches'];
  const ADMIN_ROUTES = ['categories', 'users', 'hq'];  // branch managers use 직원 관리 and 지점 관리 instead

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
    pd: { q: '', hideOff: (() => { try { return localStorage.getItem('hp-pd-hide-off') !== '0'; } catch (e) { return true; } })() },
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
    if (state.route === 'workboard') loadWorkboard();
    if (state.route === 'report') loadReport();
    if (state.route === 'schedule') loadSchedule();
    if (state.route === 'payroll') loadPayroll();
    if (state.route === 'sns') loadSns(); else refreshSnsBadge();
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
      // Names for 담당 디자이너; an outdated database just means no list.
      state.staffNames = await api.listStaffNames(state.branch.id).catch(() => []);
      if (state.mv.days === 'custom' && state.mv.from) loadMovementRange();
      $('#loadError').hidden = true;
      renderAll();
      if (state.route === 'sns') renderSns(); else refreshSnsBadge();
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
  // 새로고침: the branch's stock data plus whatever the current page shows
  async function refreshAll() {
    const btn = $('#refreshBtn');
    if (btn.dataset.busy) return;
    btn.dataset.busy = '1';
    try {
      await loadData();
      btn.setAttribute('aria-busy', 'true');
      const r = state.route;
      if (r === 'workboard') await loadWorkboard();
      else if (r === 'report') await loadReport();
      else if (r === 'schedule') await loadSchedule();
      else if (r === 'staff') await loadStaff();
      else if (r === 'payroll') await loadPayroll();
      else if (r === 'users') await loadUsers();
      else if (r === 'hq') await loadHq();
      else if (r === 'sns') await loadSns();
      else if (r === 'branches') {
        state.branches = await api.listBranches();
        state.branch = state.branches.find((b) => b.id === state.branch.id) || state.branch;
        fillBranchSelect();
        renderBranches();
        await loadBranchManagers();
      }
    } catch (e) {
      toast(api.toAppError(e).message, { error: true });
    } finally {
      delete btn.dataset.busy;
      btn.removeAttribute('aria-busy');
    }
  }
  $('#refreshBtn').addEventListener('click', refreshAll);

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
    if (state.route === 'sales') loadSales();  // new or cancelled sales
    renderProducts();
    if (state.route === 'products' && state.pc?.tab === 'compare') loadPriceCompare();
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
    document.body.dataset.route = route;
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
    if (route === 'workboard') loadWorkboard();
    if (route === 'report') loadReport();
    if (route === 'schedule') loadSchedule();
    if (route === 'payroll') loadPayroll();
    if (route === 'categories') renderCategories();
    if (route === 'manual') renderManual();
    if (route === 'sales') loadSales();
    if (route === 'hq') loadHq();
    if (route === 'sns') loadSns();
    closeSidebar();
    if (moveFocus) $('#main').focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', () => { if (!$('#screenApp').hidden) applyRoute(); });

  // ------------------------------------------------------------------
  // 사용 매뉴얼: role-aware (data-manager-only / data-admin-only hide the rest)
  // ------------------------------------------------------------------
  const ROLE_NAMES = { admin: '전체 관리자', manager: '지점 관리자', staff: '직원' };
  function renderManual() {
    const role = state.profile?.role || 'staff';
    $('#manRoleNote').textContent = `${ROLE_NAMES[role] || '직원'}${state.branch && role !== 'admin' ? ` · ${state.branch.name}` : ''} 권한에서 쓸 수 있는 단계만 보여 줍니다. 프로세스 번호 순서대로 따라 해 보세요.`;
    // Number the processes this role can see (매장 레포트 is hidden for staff)
    const procs = $$('.man-proc-card').filter((c) => getComputedStyle(c).display !== 'none').map((c) => c.dataset.manJump);
    procs.forEach((k, i) => { $$(`[data-man-jump="${k}"] .man-proc-no, #man-${k} > .man-proc-head .man-proc-no`).forEach((n) => { n.textContent = String(i + 1); }); });
    $$('.man-toc .man-chip').forEach((c) => { const i = procs.indexOf(c.dataset.manJump); if (i >= 0) c.textContent = c.textContent.replace(/^\d+\./, `${i + 1}.`); });
    // Number the steps this role can see and draw each process as a flow
    $$('.man-process').forEach((g) => {
      const steps = $$('.man-item', g).filter((d) => getComputedStyle(d).display !== 'none');
      steps.forEach((d, i) => { const n = d.querySelector('.man-no'); if (n) n.textContent = String(i + 1); });
      const flow = steps.map((d, i) => `<li><button type="button" class="man-flow-step" data-man-open="${d.id}"><span class="man-flow-no">${i + 1}</span>${esc(d.dataset.short)}</button></li>`).join('');
      $$(`[data-flow-for="${g.dataset.process}"]`).forEach((ol) => { ol.innerHTML = flow; });
    });
  }
  function filterManual() {
    const words = $('#manQ').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    $$('.man-item').forEach((d) => {
      const hit = !words.length || words.every((w) => d.textContent.toLowerCase().includes(w));
      d.hidden = !hit;
      if (words.length && hit) d.open = true;
      if (hit && getComputedStyle(d).display !== 'none') shown += 1;
    });
    $$('.man-group').forEach((g) => { g.classList.toggle('man-group-empty', words.length > 0 && !g.querySelector('.man-item:not([hidden])') && g.id !== 'man-terms'); });
    $('#man-terms').hidden = words.length > 0 && !words.every((w) => $('#man-terms').textContent.toLowerCase().includes(w));
    $('.man-overview').hidden = words.length > 0;
    $$('.man-flow', $('[data-view="manual"]')).forEach((f) => { f.hidden = words.length > 0; });
    $('#manEmpty').hidden = shown > 0 || !$('#man-terms').hidden;
  }
  let manTimer = 0;
  $('#manQ').addEventListener('input', () => { clearTimeout(manTimer); manTimer = setTimeout(filterManual, 120); });
  // Table of contents: scroll without touching the route hash
  $('[data-view="manual"]').addEventListener('click', (e) => {
    const go = (el, focusEl) => {
      el.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
      focusEl.setAttribute('tabindex', '-1');
      focusEl.focus({ preventScroll: true });
    };
    // A step in a flow: open that step's guide
    const s = e.target.closest('[data-man-open]');
    if (s) {
      const d = $(`#${s.dataset.manOpen}`);
      d.open = true;
      go(d, d.querySelector('summary'));
      return;
    }
    const a = e.target.closest('[data-man-jump]');
    if (!a) return;
    e.preventDefault();
    const target = $(`#man-${a.dataset.manJump}`);
    go(target, target.querySelector('h2'));
  });
  $('#manPrint').addEventListener('click', () => {
    const closed = $$('.man-item:not([open])');
    closed.forEach((d) => { d.open = true; });
    window.print();
    closed.forEach((d) => { d.open = false; });
  });

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
    $('#kpiValue').textContent = won.format(value);
    $('#kpiUse').textContent = `최근 7일 출고 ${won.format(outValue)}`;
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

  // Rows on screen: the loaded last 30 days, or a date range fetched on demand
  function movementRows() {
    const f = state.mv;
    const q = f.q.trim().toLowerCase();
    const custom = f.days === 'custom';
    const since = custom ? 0 : sinceMs(f.days);
    const source = custom ? (f.rangeRows || []) : state.movements;
    return source.filter((m) =>
      Date.parse(m.created_at) >= since && (!f.type || m.type === f.type) &&
      (!q || m.product_name.toLowerCase().includes(q) || (m.memo || '').toLowerCase().includes(q) || whoText(m).toLowerCase().includes(q)
        || (m.staff_name || '').toLowerCase().includes(q)));
  }

  function renderMovements() {
    const f = state.mv;
    const rows = movementRows();
    const custom = f.days === 'custom';
    $('#mvCount').textContent = custom
      ? (f.rangeLoading ? '불러오는 중…' : `${f.from.replace(/-/g, '.')} ~ ${f.to.replace(/-/g, '.')} · ${nf.format(rows.length)}건`)
      : `${nf.format(rows.length)}건`;
    $('#mvXlsx').disabled = rows.length === 0;
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
        <td data-label="등록 · 담당">${esc(whoText(m))}${m.staff_name ? `<small class="mv-staff">담당 ${esc(m.staff_name)}</small>` : ''}</td>
        <td data-label="메모"><span class="memo">${esc(m.memo || '—')}</span></td>
        <td class="cell-action">${canRevert(m) ? `<button type="button" class="btn btn-secondary btn-sm" data-revert="${m.id}" aria-label="${esc(m.product_name)} ${TYPES[m.type].label} 기록 취소">${svgIcon('i-undo')}취소</button>` : ''}</td>
      </tr>`;
    }).join('');
  }

  let mvTimer = 0;
  $('#mvQ').addEventListener('input', (e) => { clearTimeout(mvTimer); mvTimer = setTimeout(() => { state.mv.q = e.target.value; renderMovements(); }, 150); });
  $('#mvType').addEventListener('change', (e) => { state.mv.type = e.target.value; renderMovements(); });
  $('#mvDays').addEventListener('change', (e) => {
    const custom = e.target.value === 'custom';
    $('#mvRange').hidden = !custom;
    if (!custom) { state.mv.days = Number(e.target.value); renderMovements(); return; }
    state.mv.days = 'custom';
    if (!state.mv.from) {
      const today = keyFmt.format(new Date());
      state.mv.to = today;
      state.mv.from = new Date(Date.parse(`${today}T00:00:00Z`) - 29 * DAY).toISOString().slice(0, 10);
    }
    $('#mvFrom').value = state.mv.from;
    $('#mvTo').value = state.mv.to;
    loadMovementRange();
    $('#mvFrom').focus();
  });

  // 기간 직접 설정: up to one year at a time, fetched from the server
  async function loadMovementRange() {
    const f = state.mv;
    const err = $('#mvRangeErr');
    const from = $('#mvFrom').value, to = $('#mvTo').value;
    const today = keyFmt.format(new Date());
    let msg = '';
    if (!from || !to) msg = '시작일과 종료일을 모두 골라 주세요.';
    else if (from > to) msg = '시작일이 종료일보다 늦습니다.';
    else if ((Date.parse(to) - Date.parse(from)) / DAY > 366) msg = '한 번에 1년까지 조회할 수 있습니다.';
    else if (from > today) msg = '시작일이 오늘보다 늦습니다.';
    err.textContent = msg;
    err.hidden = !msg;
    [$('#mvFrom'), $('#mvTo')].forEach((el) => el.toggleAttribute('aria-invalid', Boolean(msg)));
    if (msg) return;
    f.from = from; f.to = to;
    f.rangeLoading = true;
    renderMovements();
    const ticket = (f.rangeTicket = (f.rangeTicket || 0) + 1);
    try {
      const rows = await api.listMovementsBetween(state.branch.id, from, to);
      if (ticket !== f.rangeTicket) return;  // a newer range was picked meanwhile
      f.rangeRows = rows;
    } catch (ex) {
      if (ticket !== f.rangeTicket) return;
      f.rangeRows = [];
      err.textContent = api.toAppError(ex).message;
      err.hidden = false;
    }
    f.rangeLoading = false;
    renderMovements();
  }
  ['mvFrom', 'mvTo'].forEach((id) => $('#' + id).addEventListener('change', loadMovementRange));

  // 엑셀 다운로드: what is on screen (period, 구분, search)
  $('#mvXlsx').addEventListener('click', () => {
    const rows = movementRows();
    if (!rows.length) { toast('내려받을 기록이 없습니다.', { error: true }); return; }
    const f = state.mv;
    const today = keyFmt.format(new Date());
    const from = f.days === 'custom' ? f.from : new Date(sinceMs(f.days) + 9 * 3600000).toISOString().slice(0, 10);
    const to = f.days === 'custom' ? f.to : today;
    const stamp = (iso) => { const d = new Date(iso); return `${keyFmt.format(d)} ${timeFmt.format(d)}`; };
    const blob = window.makeXlsx({
      sheetName: '입출고 내역',
      columns: [
        { header: '일시', width: 18 }, { header: '품목', width: 30 }, { header: '품목 코드', width: 12 },
        { header: '구분', width: 11 }, { header: '변동', width: 9, type: 'number' }, { header: '변동 후 재고', width: 12, type: 'number' },
        { header: '단위', width: 7 }, { header: '등록', width: 12 }, { header: '담당 디자이너', width: 13 },
        { header: '매입가', width: 11, type: 'number' }, { header: '판매가', width: 11, type: 'number' },
        { header: '메모', width: 34 }, { header: '취소', width: 10 },
      ],
      rows: rows.map((m) => [
        stamp(m.created_at), m.product_name, m.sku, TYPES[m.type]?.label || m.type, m.quantity, m.stock_after, m.unit,
        whoText(m), m.staff_name || '', m.unit_cost ?? '', m.unit_price ?? '', m.memo || '',
        m.reverts_id ? '취소 기록' : m.reverted ? '취소됨' : '',
      ]),
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `입출고내역_${state.branch.name}_${from}_${to}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`${nf.format(rows.length)}건을 엑셀 파일로 내려받았습니다.`);
  });

  // ------------------------------------------------------------------
  // 판매 내역: sales for a period, against the period just before it
  // ------------------------------------------------------------------
  state.sl = { period: '7', from: '', to: '', q: '', staff: '', rows: [], prev: [], ticket: 0, loading: false };

  const monthEnd = (key) => { const [y, m] = key.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
  const monthStart = (key) => `${key.slice(0, 7)}-01`;
  const prevMonthStart = (key) => { const [y, m] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10); };
  const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

  // { from, to, pFrom, pTo, label, prevLabel } in Korea dates
  function salesRange() {
    const f = state.sl, t = todayKey();
    const span = (from, to, label) => {
      const n = dayDiff(from, to) + 1;
      return { from, to, pFrom: addDays(from, -n), pTo: addDays(from, -1), label, prevLabel: `이전 ${nf.format(n)}일` };
    };
    if (f.period === 'today') return { ...span(t, t, '오늘'), prevLabel: '어제' };
    if (f.period === '7') return { ...span(addDays(t, -6), t, '최근 7일'), prevLabel: '이전 7일' };
    if (f.period === '30') return { ...span(addDays(t, -29), t, '최근 30일'), prevLabel: '이전 30일' };
    if (f.period === 'month') {
      const from = monthStart(t), pFrom = prevMonthStart(t);
      const pTo = [addDays(pFrom, dayDiff(from, t)), monthEnd(pFrom)].sort()[0];
      return { from, to: t, pFrom, pTo, label: '이번 달', prevLabel: '지난달 같은 기간' };
    }
    if (f.period === 'lastmonth') {
      const from = prevMonthStart(t), pFrom = prevMonthStart(from);
      return { from, to: monthEnd(from), pFrom, pTo: monthEnd(pFrom), label: '지난달', prevLabel: '그 전달' };
    }
    return span(f.from, f.to, '선택한 기간');
  }

  async function loadSales() {
    if (!state.branch) return;
    const f = state.sl;
    const r = salesRange();
    if (!r.from || !r.to) return renderSales();
    const ticket = (f.ticket += 1);
    f.loading = true;
    renderSales();
    try {
      const all = await api.listMovementsBetween(state.branch.id, r.pFrom, r.to);
      if (ticket !== f.ticket) return;
      const sales = all.filter((m) => m.type === 'sale');
      const inRange = (m, a, b) => { const k = keyFmt.format(new Date(m.created_at)); return k >= a && k <= b; };
      f.rows = sales.filter((m) => inRange(m, r.from, r.to));
      f.prev = sales.filter((m) => inRange(m, r.pFrom, r.pTo));
      $('#slError').hidden = true;
    } catch (ex) {
      if (ticket !== f.ticket) return;
      f.rows = []; f.prev = [];
      $('#slError').textContent = api.toAppError(ex).message;
      $('#slError').hidden = false;
    }
    f.loading = false;
    renderSales();
  }

  const salePrice = (m) => m.unit_price ?? itemById(m.product_id)?.retail_price ?? 0;
  function salesMatch(m) {
    const f = state.sl;
    const q = f.q.trim().toLowerCase();
    if (f.staff === '-' ? m.staff_id : f.staff && m.staff_id !== f.staff) return false;
    return !q || m.product_name.toLowerCase().includes(q) || (m.staff_name || '').toLowerCase().includes(q)
      || (m.memo || '').toLowerCase().includes(q) || whoText(m).toLowerCase().includes(q) || (m.sku || '').toLowerCase().includes(q);
  }
  // Sales that count: not a cancellation and not cancelled
  const salesTotals = (rows) => {
    const live = rows.filter((m) => !m.reverts_id && !m.reverted && salesMatch(m));
    const t = live.reduce((a, m) => ({ amt: a.amt + -m.quantity * salePrice(m), qty: a.qty + -m.quantity }), { amt: 0, qty: 0 });
    return { ...t, n: live.length, avg: live.length ? t.amt / live.length : 0, live };
  };

  function fillSalesStaff() {
    const sel = $('#slStaff');
    const cur = state.sl.staff;
    const seen = new Map((state.staffNames || []).filter((x) => x.status !== 'left').map((x) => [x.id, x.name]));
    state.sl.rows.forEach((m) => { if (m.staff_id && !seen.has(m.staff_id)) seen.set(m.staff_id, m.staff_name || '—'); });
    sel.innerHTML = '<option value="">전체</option>'
      + [...seen].sort((a, b) => a[1].localeCompare(b[1], 'ko')).map(([id, n]) => `<option value="${esc(id)}">${esc(n)}</option>`).join('')
      + '<option value="-">담당 미지정</option>';
    sel.value = [...sel.options].some((o) => o.value === cur) ? cur : '';
    state.sl.staff = sel.value;
  }

  function renderSales() {
    const f = state.sl;
    const r = salesRange();
    const dot = (k) => k.replace(/-/g, '.');
    $('#slPeriodText').textContent = f.loading ? '불러오는 중…'
      : r.from ? `${r.label} ${dot(r.from)}${r.to !== r.from ? ` ~ ${dot(r.to)}` : ''} · 비교 기준: ${r.prevLabel} ${dot(r.pFrom)}${r.pTo !== r.pFrom ? ` ~ ${dot(r.pTo)}` : ''}` : '';
    fillSalesStaff();
    const cur = salesTotals(f.rows), prev = salesTotals(f.prev);
    const vs = `${r.prevLabel} 대비`;
    $('#slAmt').textContent = won.format(cur.amt);
    $('#slAmtSub').textContent = `${r.prevLabel} ${won.format(prev.amt)}`;
    setDelta('slAmtDelta', deltaHtml(cur.amt, prev.amt), vs);
    $('#slCnt').textContent = `${nf.format(cur.n)}건`;
    $('#slCntSub').textContent = `${r.prevLabel} ${nf.format(prev.n)}건`;
    setDelta('slCntDelta', deltaHtml(cur.n, prev.n), vs);
    $('#slQty').textContent = `${nf.format(cur.qty)}개`;
    const kinds = new Set(cur.live.map((m) => m.product_id)).size;
    $('#slQtySub').textContent = `${nf.format(kinds)}개 품목`;
    setDelta('slQtyDelta', deltaHtml(cur.qty, prev.qty), vs);
    $('#slAvg').textContent = won.format(Math.round(cur.avg));
    $('#slAvgSub').textContent = `${r.prevLabel} ${won.format(Math.round(prev.avg))}`;
    setDelta('slAvgDelta', cur.n && prev.n ? deltaHtml(cur.avg, prev.avg) : deltaHtml(0, 0), vs);

    // Rankings (bar length relative to the top entry)
    const bars = (list, empty) => {
      if (!list.length) return `<li class="muted rp-empty">${empty}</li>`;
      const max = Math.max(...list.map((x) => x.amt), 1);
      return list.map((x, i) => `<li><div class="sl-bar-top"><span class="sl-rank">${i + 1}</span><span class="rp-name">${esc(x.name)}</span><span class="rp-val">${x.sub} · <strong>${won.format(x.amt)}</strong></span></div>
        <span class="sl-bar" aria-hidden="true"><span style="width:${Math.max(2, (x.amt / max) * 100).toFixed(1)}%"></span></span></li>`).join('');
    };
    const byProd = new Map(), byDes = new Map();
    cur.live.forEach((m) => {
      const p = byProd.get(m.product_id) || { name: m.product_name, unit: m.unit, qty: 0, amt: 0 };
      p.qty += -m.quantity; p.amt += -m.quantity * salePrice(m);
      byProd.set(m.product_id, p);
      const k = m.staff_id || '-';
      const d = byDes.get(k) || { name: m.staff_id ? m.staff_name || '—' : '담당 미지정', n: 0, qty: 0, amt: 0 };
      d.n += 1; d.qty += -m.quantity; d.amt += -m.quantity * salePrice(m);
      byDes.set(k, d);
    });
    const top = [...byProd.values()].sort((a, b) => b.amt - a.amt || b.qty - a.qty).slice(0, 10)
      .map((x) => ({ ...x, sub: `${nf.format(x.qty)}${esc(x.unit)}` }));
    $('#slTop').innerHTML = bars(top, '판매 기록이 없습니다.');
    const des = [...byDes.values()].sort((a, b) => b.amt - a.amt)
      .map((x) => ({ ...x, sub: `${nf.format(x.n)}건 · ${nf.format(x.qty)}개` }));
    $('#slDes').innerHTML = bars(des, '판매 기록이 없습니다.');

    // Records: cancellations are shown on the sale they undo
    const rows = f.rows.filter((m) => !m.reverts_id && salesMatch(m));
    $('#slCount').textContent = f.loading ? '' : `${nf.format(rows.length)}건${rows.some((m) => m.reverted) ? ` (취소 ${nf.format(rows.filter((m) => m.reverted).length)}건 포함)` : ''}`;
    $('#slXlsx').disabled = rows.length === 0;
    $('#slEmpty').hidden = rows.length > 0 || f.loading;
    $('#slTable').hidden = rows.length === 0;
    $('#slBody').innerHTML = rows.map((m) => {
      const d = new Date(m.created_at);
      const price = salePrice(m);
      return `<tr class="${m.reverted ? 'is-reverted' : ''}">
        <td class="cell-name when"><span class="item-name">${esc(m.product_name)}</span><small>${dayFmt.format(d)} ${timeFmt.format(d)} · ${esc(m.sku)}</small></td>
        <td class="num" data-label="수량">${nf.format(-m.quantity)}${esc(m.unit)}</td>
        <td class="num" data-label="판매가">${won.format(price)}</td>
        <td class="num" data-label="금액"><strong>${won.format(-m.quantity * price)}</strong>${m.reverted ? ' <span class="tag tag-note">취소됨</span>' : ''}</td>
        <td data-label="담당 · 등록">${m.staff_name ? esc(m.staff_name) : '<span class="muted">미지정</span>'}<small class="mv-staff">등록 ${esc(whoText(m))}</small></td>
        <td data-label="메모"><span class="memo">${esc(m.memo || '—')}</span></td>
        <td class="cell-action">${canRevert(m) ? `<button type="button" class="btn btn-secondary btn-sm" data-revert="${m.id}" aria-label="${esc(m.product_name)} 판매 기록 취소">${svgIcon('i-undo')}취소</button>` : ''}</td>
      </tr>`;
    }).join('');
  }

  let slTimer = 0;
  $('#slQ').addEventListener('input', (e) => { clearTimeout(slTimer); slTimer = setTimeout(() => { state.sl.q = e.target.value; renderSales(); }, 150); });
  $('#slStaff').addEventListener('change', (e) => { state.sl.staff = e.target.value; renderSales(); });
  $('#slPeriod').addEventListener('change', (e) => {
    const f = state.sl;
    f.period = e.target.value;
    const custom = f.period === 'custom';
    $('#slRange').hidden = !custom;
    if (custom) {
      if (!f.from) { f.to = todayKey(); f.from = addDays(f.to, -29); }
      $('#slFrom').value = f.from; $('#slTo').value = f.to; $('#slFrom').max = $('#slTo').max = todayKey();
      $('#slFrom').focus();
    }
    loadSales();
  });
  ['slFrom', 'slTo'].forEach((id) => $('#' + id).addEventListener('change', () => {
    const from = $('#slFrom').value, to = $('#slTo').value, err = $('#slRangeErr');
    let msg = '';
    if (!from || !to) msg = '시작일과 종료일을 모두 골라 주세요.';
    else if (from > to) msg = '시작일이 종료일보다 늦습니다.';
    else if (dayDiff(from, to) > 366) msg = '한 번에 1년까지 조회할 수 있습니다.';
    else if (from > todayKey()) msg = '시작일이 오늘보다 늦습니다.';
    err.textContent = msg; err.hidden = !msg;
    [$('#slFrom'), $('#slTo')].forEach((el) => el.toggleAttribute('aria-invalid', Boolean(msg)));
    if (msg) return;
    Object.assign(state.sl, { from, to });
    loadSales();
  }));

  $('#slXlsx').addEventListener('click', () => {
    const rows = state.sl.rows.filter((m) => !m.reverts_id && salesMatch(m));
    if (!rows.length) { toast('내려받을 판매 기록이 없습니다.', { error: true }); return; }
    const r = salesRange();
    const stamp = (iso) => { const d = new Date(iso); return `${keyFmt.format(d)} ${timeFmt.format(d)}`; };
    const blob = window.makeXlsx({
      sheetName: '판매 내역',
      columns: [
        { header: '일시', width: 18 }, { header: '품목', width: 30 }, { header: '품목 코드', width: 12 },
        { header: '수량', width: 8, type: 'number' }, { header: '단위', width: 7 },
        { header: '판매가', width: 11, type: 'number' }, { header: '금액', width: 13, type: 'number' },
        { header: '담당 디자이너', width: 13 }, { header: '등록', width: 12 }, { header: '메모', width: 30 }, { header: '상태', width: 9 },
      ],
      rows: rows.map((m) => [
        stamp(m.created_at), m.product_name, m.sku, -m.quantity, m.unit, salePrice(m), -m.quantity * salePrice(m),
        m.staff_name || '', whoText(m), m.memo || '', m.reverted ? '취소됨' : '',
      ]),
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `판매내역_${state.branch.name}_${r.from}_${r.to}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`${nf.format(rows.length)}건을 엑셀 파일로 내려받았습니다.`);
  });

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
    $('#pdNote').textContent = isManager()
      ? '제품 목록은 모든 지점이 함께 쓰고, 품목명·브랜드·카테고리·단위·매입가·판매가·고객 판매용은 지점마다 따로 정할 수 있습니다("지점 설정" 표시). 품목 코드는 전체 관리자가 바꿉니다. "이 지점 사용"을 끄면 이 지점의 재고 목록과 입출고 등록에서만 숨겨집니다.'
      : '"이 지점 사용"을 끄면 이 지점의 재고 목록과 입출고 등록에서 숨겨집니다. 다른 지점에는 영향이 없습니다. 제품 등록과 설정은 지점 관리자에게 요청해 주세요.';
    const q = state.pd.q.trim().toLowerCase();
    const found = state.inventory.filter((i) => !q || i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q));
    // 사용 안 함 제품 숨기기: display only (this branch's switch or 본사 사용 중지)
    const off = (i) => i.in_use === false || i.catalog_active === false;
    const hidden = state.pd.hideOff ? found.filter(off).length : 0;
    const rows = (state.pd.hideOff ? found.filter((i) => !off(i)) : found)
      .sort((a, b) => byCategory(a.category, b.category) || a.name.localeCompare(b.name, 'ko'));
    $('#pdHideOff').checked = state.pd.hideOff;
    $('#pdCount').innerHTML = `${nf.format(rows.length)}개 품목${hidden ? ` · 사용 안 함 ${nf.format(hidden)}개 숨김 <button type="button" class="link-btn pd-show-off" id="pdShowOff">모두 보기</button>` : ''}`
      + (!rows.length && hidden && !q ? '<span class="pd-none"> — 사용 중인 제품이 없습니다. 제품을 등록하거나 [모두 보기]에서 쓸 제품을 "사용"으로 켜세요.</span>' : '');
    $('#pdBody').innerHTML = rows.map((i) => `<tr class="${i.active ? '' : 'inactive-row'}">
      <td class="cell-name"><div class="item-name">${esc(i.name)}${i.own_prices ? `<span class="own-price" title="공통 값: ${esc(baseText(i))}">지점 설정</span>` : ''}</div><div class="item-sku">${esc(i.sku)}${i.brand ? ` · ${esc(i.brand)}` : ''}</div></td>
      <td data-label="카테고리">${esc(i.category)}</td>
      <td data-label="단위">${esc(i.unit)}</td>
      <td class="num" data-label="매입가">${won.format(i.cost_price)}${i.own_prices && i.cost_price !== i.base_cost_price ? `<small class="sub-num base-price">공통 ${won.format(i.base_cost_price)}</small>` : ''}</td>
      <td class="num" data-label="판매가">${i.retail_price != null ? won.format(i.retail_price) : '—'}${i.own_prices && i.retail_price !== i.base_retail_price ? `<small class="sub-num base-price">공통 ${i.base_retail_price != null ? won.format(i.base_retail_price) : '없음'}</small>` : ''}</td>
      <td class="num" data-label="안전재고">${nf.format(i.safety_stock)}</td>
      <td data-label="보관 위치">${esc(i.location || '—')}</td>
      <td data-label="이 지점 사용">${i.catalog_active === false
        ? '<span class="tag tag-off">본사 사용 중지</span>'
        : `<label class="switch"><input type="checkbox" role="switch" data-in-use="${i.product_id}" ${i.in_use !== false ? 'checked' : ''} aria-label="${esc(i.name)} ${esc(state.branch.name)}에서 사용" /><span class="switch-track" aria-hidden="true"></span><span class="switch-text">${i.in_use !== false ? '사용 중' : '사용 안 함'}</span></label>`}${i.is_retail ? '<small class="sub-num">판매용</small>' : ''}</td>
      <td class="cell-action">${isManager() ? `<button type="button" class="btn btn-secondary btn-sm" data-edit="${i.product_id}" aria-label="${esc(i.name)} ${isAdmin() ? '수정' : '지점 설정'}">${svgIcon('i-edit')}${isAdmin() ? '수정' : '설정'}</button>` : ''}</td>
    </tr>`).join('');
  }
  // 사용 중 switch: this branch only (everyone at the branch). Updates in place.
  document.addEventListener('change', async (e) => {
    const sw = e.target.closest('[data-in-use]');
    if (!sw) return;
    const item = itemById(sw.dataset.inUse);
    const on = sw.checked;
    let disposed = false;
    if (!on && item.stock > 0) {
      sw.checked = true;  // until the choice is made
      const ans = await confirmStockOff(item);
      if (!ans) { sw.focus(); return; }
      if (ans.choice === 'adjust') {
        openMove({ productId: item.product_id, type: 'adjust', qty: '' });
        toast('실제 수량을 맞춘 뒤 다시 "사용 안 함"으로 바꿔 주세요.');
        return;
      }
      sw.checked = false;
      if (ans.choice === 'dispose') {
        try { await disposeRest(item, ans.memo); disposed = true; } catch (ex) { sw.checked = true; toast(api.toAppError(ex).message, { error: true }); return; }
      }
    }
    sw.disabled = true;
    try {
      await api.setItemInUse(state.branch.id, item.product_id, on);
      if (disposed) {
        toast(`${item.name} ${nf.format(item.stock)}${item.unit}${eulReul(item.unit)} 폐기로 등록하고 ${state.branch.name}에서 사용하지 않습니다.`);
        await loadData();
        return;
      }
      item.in_use = on;
      item.active = item.catalog_active !== false && on;
      sw.nextElementSibling.nextElementSibling.textContent = on ? '사용 중' : '사용 안 함';
      sw.closest('tr').classList.toggle('inactive-row', !item.active);
      toast(`${item.name}을(를) ${state.branch.name}에서 ${on ? '다시 사용합니다' : '사용하지 않습니다. 재고 목록과 입출고 등록에서 숨겨집니다'}.`);
      renderKpis(); renderAlerts(); renderInventory(); fillMoveItems();
    } catch (ex) {
      sw.checked = !on;
      toast(api.toAppError(ex).message, { error: true });
    } finally {
      sw.disabled = false;
    }
  });
  // 사용 안 함 with stock left: dispose it first, keep it, or go count it (재고 실사)
  const offDialog = setupDialog($('#offDialog'));
  // 을/를 after a Korean word (받침 → 을)
  const eulReul = (w) => { const c = String(w).trim().slice(-1).charCodeAt(0); return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? '을' : '를'; };
  let offResolve = null;
  function confirmStockOff(item, { allBranches = false } = {}) {
    return new Promise((resolve) => {
      offResolve = resolve;
      const u = item.unit || '개';
      $('#offTitle').textContent = `${item.name} · 사용 안 함`;
      $('#offText').innerHTML = `${esc(state.branch.name)}에 <strong>${nf.format(item.stock)}${esc(u)}</strong>(재고 금액 ${won.format(item.stock * item.cost_price)})가 남아 있습니다.${allBranches ? ' 모든 지점에서 사용을 중지합니다. 다른 지점의 재고는 각 지점에서 정리해 주세요.' : ''}`;
      $('#offDisposeLabel').textContent = `남은 ${nf.format(item.stock)}${u}${eulReul(u)} 폐기로 등록하고 끄기`;
      $('#offForm').elements.offChoice.value = 'dispose';
      $('#offMemo').value = '사용 중지로 폐기';
      $('#offMemoField').hidden = false;
      $('#offError').hidden = true;
      offDialog.open();
      $('#offSubmit').focus();
    });
  }
  const offSettle = (v) => { const r = offResolve; offResolve = null; if (r) r(v); };
  $('#offDialog').addEventListener('close', () => offSettle(null));
  $('#offForm').addEventListener('change', (e) => { if (e.target.name === 'offChoice') $('#offMemoField').hidden = e.target.value !== 'dispose'; });
  $('#offForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const choice = $('#offForm').elements.offChoice.value;
    offSettle({ choice, memo: $('#offMemo').value.trim() });
    $('#offDialog').close();
  });
  $('#offAdjust').addEventListener('click', () => {
    const r = offResolve; offResolve = null;
    $('#offDialog').close();
    if (r) r({ choice: 'adjust' });
  });
  // Write off the rest of the stock (폐기) before switching off
  async function disposeRest(item, memo) {
    await api.recordMovement({ branchId: state.branch.id, productId: item.product_id, type: 'dispose', quantity: item.stock, memo: memo || '사용 중지로 폐기' });
  }

  let pdTimer = 0;
  const setHideOff = (on) => {
    state.pd.hideOff = on;
    try { localStorage.setItem('hp-pd-hide-off', on ? '1' : '0'); } catch (e) {}
    renderProducts();
  };
  $('#pdHideOff').addEventListener('change', (e) => setHideOff(e.target.checked));
  $('#pdCount').addEventListener('click', (e) => { if (e.target.closest('#pdShowOff')) { setHideOff(false); $('#pdHideOff').focus(); } });
  $('#pdQ').addEventListener('input', (e) => { clearTimeout(pdTimer); pdTimer = setTimeout(() => { state.pd.q = e.target.value; renderProducts(); }, 150); });

  // ------------------------------------------------------------------
  // 지점별 가격 비교 (admin): one product per row, one branch per column
  // ------------------------------------------------------------------
  state.pc = { tab: 'list', metric: 'cost_price', q: '', cat: '', only: true, branches: [], items: [], loading: false };

  async function loadPriceCompare() {
    if (!isAdmin()) return;
    const c = state.pc;
    c.loading = true;
    renderPriceCompare();
    try {
      const branches = state.branches.filter((b) => b.active !== false);
      const lists = await Promise.all(branches.map((b) => api.listInventory(b.id)));
      const byId = new Map();
      lists.forEach((rows, bi) => rows.forEach((r) => {
        const p = byId.get(r.product_id) || {
          id: r.product_id, sku: r.sku, name: r.base_name ?? r.name, category: r.base_category ?? r.category,
          unit: r.base_unit ?? r.unit, base: { cost_price: r.base_cost_price ?? r.cost_price, retail_price: r.base_retail_price ?? r.retail_price },
          catalog_active: r.catalog_active !== false, at: new Array(branches.length).fill(null),
        };
        p.at[bi] = { cost_price: r.cost_price, retail_price: r.retail_price ?? null, own: Boolean(r.own_prices), in_use: r.in_use !== false, name: r.name, unit: r.unit };
        byId.set(r.product_id, p);
      }));
      c.branches = branches;
      c.items = [...byId.values()];
      $('#pcError').hidden = true;
    } catch (ex) {
      c.items = [];
      $('#pcError').textContent = api.toAppError(ex).message;
      $('#pcError').hidden = false;
    }
    c.loading = false;
    const cats = [...new Set(c.items.map((p) => p.category))].sort(byCategory);
    $('#pcCat').innerHTML = '<option value="">전체</option>' + cats.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
    $('#pcCat').value = cats.includes(c.cat) ? c.cat : '';
    c.cat = $('#pcCat').value;
    renderPriceCompare();
  }

  // Values of one metric across branches (null = no price / not stocked)
  const pcValues = (p, m) => p.at.map((a) => (a ? a[m] ?? null : undefined));
  const pcDiffers = (p, m) => { const v = pcValues(p, m).filter((x) => x !== undefined); return new Set(v.map(String)).size > 1 || v.some((x) => x !== (p.base[m] ?? null)); };

  function renderPriceCompare() {
    const c = state.pc, m = c.metric, label = m === 'cost_price' ? '매입가' : '판매가';
    const all = c.items.filter((p) => p.catalog_active);
    const q = c.q.trim().toLowerCase();
    const diffCost = all.filter((p) => pcDiffers(p, 'cost_price')).length;
    const diffRetail = all.filter((p) => pcDiffers(p, 'retail_price')).length;
    const ownCells = all.reduce((a, p) => a + p.at.filter((x) => x?.own).length, 0);
    $('#pcSummary').innerHTML = c.loading ? '<span class="muted">모든 지점 가격을 불러오는 중…</span>' : `
      <div class="pc-stat"><span>비교 품목</span><strong>${nf.format(all.length)}개</strong><small>${nf.format(c.branches.length)}개 지점</small></div>
      <div class="pc-stat${diffCost ? ' is-hot' : ''}"><span>매입가가 다른 제품</span><strong>${nf.format(diffCost)}개</strong><small>${all.length ? pct1.format((diffCost / all.length) * 100) : '0.0'}%</small></div>
      <div class="pc-stat${diffRetail ? ' is-hot' : ''}"><span>판매가가 다른 제품</span><strong>${nf.format(diffRetail)}개</strong><small>${all.length ? pct1.format((diffRetail / all.length) * 100) : '0.0'}%</small></div>
      <div class="pc-stat"><span>지점 설정 사용</span><strong>${nf.format(ownCells)}건</strong><small>공통 값과 다르게 정한 지점·제품</small></div>`;

    const rows = all.filter((p) => (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
        && (!c.cat || p.category === c.cat) && (!c.only || pcDiffers(p, m)))
      .sort((a, b) => byCategory(a.category, b.category) || a.name.localeCompare(b.name, 'ko'));

    $('#pcHead').innerHTML = `<tr>
      <th scope="col" class="th-plain pc-sticky">품목</th>
      <th scope="col" class="th-plain num">공통 ${label}</th>
      ${c.branches.map((b) => `<th scope="col" class="th-plain num">${esc(b.name)}</th>`).join('')}
      <th scope="col" class="th-plain num">지점 간 차이</th>
    </tr>`;
    $('#pcBody').innerHTML = rows.map((p) => {
      const base = p.base[m] ?? null;
      const vals = pcValues(p, m).filter((v) => v != null);
      const lo = vals.length ? Math.min(...vals) : null, hi = vals.length ? Math.max(...vals) : null;
      const renamed = p.at.some((a) => a && a.own && a.name !== p.name);
      const cells = p.at.map((a, bi) => {
        const bn = esc(c.branches[bi].name);
        if (!a) return `<td class="num muted" data-label="${bn}">—</td>`;
        const v = a[m] ?? null;
        const dir = v == null || base == null ? (v === base ? '' : 'chg') : v > base ? 'up' : v < base ? 'down' : '';
        const mark = dir === 'up' ? '<span class="pc-up" aria-label="공통보다 높음">▲</span>' : dir === 'down' ? '<span class="pc-down" aria-label="공통보다 낮음">▼</span>' : '';
        const tip = [a.own ? `지점 설정${a.name !== p.name ? ` · 이름 "${a.name}"` : ''}${a.unit !== p.unit ? ` · 단위 ${a.unit}` : ''}` : '공통 값 사용', a.in_use ? '' : '이 지점에서 사용 안 함'].filter(Boolean).join(' · ');
        return `<td class="num pc-cell${dir ? ` pc-${dir}-cell` : ''}${a.in_use ? '' : ' pc-off'}" data-label="${bn}" title="${esc(tip)}">${mark}${v == null ? '<span class="muted">—</span>' : won.format(v)}</td>`;
      }).join('');
      const spread = lo != null && hi > lo
        ? `<strong>${won.format(hi - lo)}</strong><small>${lo ? `${pct1.format(((hi - lo) / lo) * 100)}%` : ''}</small>` : '<span class="muted">같음</span>';
      return `<tr>
        <th scope="row" class="cell-name pc-sticky"><div class="item-name">${esc(p.name)}${renamed ? '<span class="own-price" title="지점에서 이름을 바꾼 곳이 있습니다">이름 다름</span>' : ''}</div><div class="item-sku">${esc(p.sku)} · ${esc(p.category)} · ${esc(p.unit)}</div></th>
        <td class="num pc-base" data-label="공통 ${label}">${base == null ? '<span class="muted">—</span>' : won.format(base)}</td>
        ${cells}
        <td class="num pc-spread" data-label="지점 간 차이">${spread}</td>
      </tr>`;
    }).join('');
    const none = !c.loading && rows.length === 0;
    const wrap = $('.pc-wrap');
    wrap.classList.toggle('is-wide', $('#pcTable').scrollWidth > wrap.clientWidth + 1);
    $('#pcEmpty').hidden = !none;
    $('#pcTable').hidden = none;
    $('#pcEmptyText').textContent = q || c.cat ? '조건에 맞는 제품이 없습니다.' : c.only ? `모든 지점의 ${label}가 공통 값과 같습니다.` : '제품이 없습니다.';
  }

  $('[data-view="products"]').addEventListener('click', (e) => {
    const t = e.target.closest('[data-pd-tab]');
    if (t) {
      state.pc.tab = t.dataset.pdTab;
      $$('[data-pd-tab]').forEach((x) => x.setAttribute('aria-pressed', String(x === t)));
      $('#pdCompare').hidden = state.pc.tab !== 'compare';
      $('#pdList').hidden = state.pc.tab === 'compare';
      if (state.pc.tab === 'compare') loadPriceCompare();
      return;
    }
    const mb = e.target.closest('[data-pc-metric]');
    if (mb) {
      state.pc.metric = mb.dataset.pcMetric;
      $$('[data-pc-metric]').forEach((x) => x.setAttribute('aria-pressed', String(x === mb)));
      renderPriceCompare();
    }
  });
  let pcTimer = 0;
  $('#pcQ').addEventListener('input', (e) => { clearTimeout(pcTimer); pcTimer = setTimeout(() => { state.pc.q = e.target.value; renderPriceCompare(); }, 150); });
  $('#pcCat').addEventListener('change', (e) => { state.pc.cat = e.target.value; renderPriceCompare(); });
  $('#pcOnly').addEventListener('change', (e) => { state.pc.only = e.target.checked; renderPriceCompare(); });
  $('#pcXlsx').addEventListener('click', () => {
    const c = state.pc;
    const items = c.items.filter((p) => p.catalog_active).sort((a, b) => byCategory(a.category, b.category) || a.name.localeCompare(b.name, 'ko'));
    if (!items.length) { toast('내려받을 제품이 없습니다.', { error: true }); return; }
    const cols = [{ header: '품목', width: 28 }, { header: '품목 코드', width: 11 }, { header: '카테고리', width: 13 }, { header: '구분', width: 8 }, { header: '공통', width: 11, type: 'number' }];
    c.branches.forEach((b) => cols.push({ header: b.name, width: 11, type: 'number' }));
    cols.push({ header: '지점 간 차이', width: 12, type: 'number' });
    const out = [];
    items.forEach((p) => ['cost_price', 'retail_price'].forEach((m) => {
      const vals = pcValues(p, m).filter((v) => v != null);
      out.push([p.name, p.sku, p.category, m === 'cost_price' ? '매입가' : '판매가', p.base[m] ?? '',
        ...pcValues(p, m).map((v) => (v == null ? '' : v)), vals.length ? Math.max(...vals) - Math.min(...vals) : '']);
    }));
    const blob = window.makeXlsx({ sheetName: '지점별 가격 비교', columns: cols, rows: out });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `지점별가격비교_${todayKey()}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`${nf.format(items.length)}개 제품의 지점별 매입가·판매가를 엑셀 파일로 내려받았습니다.`);
  });

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
  $$('input[name="mType"]').forEach((r) => r.addEventListener('change', () => { updatePreview(); syncMoveStaff(); }));

  // 담당 디자이너: current staff of the branch, designers first; remembers the last pick.
  function fillMoveStaff() {
    const rank = { head_director: 0, chief_deputy: 1, deputy: 2, senior_stylist: 3, stylist: 4, designer: 5, staff: 6 };
    const list = (state.staffNames || []).filter((x) => x.status === 'active')
      .sort((a, b) => rank[a.position] - rank[b.position] || a.name.localeCompare(b.name, 'ko'));
    $('#mStaff').innerHTML = '<option value="">선택 안 함</option>'
      + list.map((x) => `<option value="${x.id}">${esc(x.name)} (${POSITIONS[x.position] || ''})</option>`).join('');
    $('#mStaff').value = list.some((x) => x.id === state.lastMoveStaff) ? state.lastMoveStaff : '';
  }
  function syncMoveStaff() {
    const t = moveType();
    $('#mStaffField').hidden = !(state.staffNames || []).some((x) => x.status === 'active') || (t !== 'use' && t !== 'sale');
  }

  function openMove({ productId = '', type = 'receive', qty = '' } = {}) {
    moveForm.reset();
    clearErrors(moveForm);
    fillMoveItems();
    fillMoveStaff();
    $('#mItem').value = productId;
    const radio = $(`input[name="mType"][value="${type}"]`);
    radio.checked = true;
    $('#mQty').value = qty;
    updatePreview();
    syncMoveStaff();
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
      const staffId = !$('#mStaffField').hidden && $('#mStaff').value ? $('#mStaff').value : null;
      if (staffId) state.lastMoveStaff = staffId;
      const mv = await api.recordMovement({ branchId: state.branch.id, productId: item.product_id, type, quantity: qty, memo: $('#mMemo').value, staffId });
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

  // 단위: common units, plus any already used in this branch
  const UNITS = ['개', '병', '통', '박스', '팩', '롤', '세트', '튜브', '봉', '장', '캔', '매'];
  function fillUnits(current) {
    const used = [...new Set(state.inventory.map((i) => i.unit).filter(Boolean))].filter((u) => !UNITS.includes(u)).sort((a, b) => a.localeCompare(b, 'ko'));
    const list = [...UNITS, ...used];
    if (current && !list.includes(current)) list.push(current);
    $('#pUnit').innerHTML = list.map((u) => `<option value="${esc(u)}">${esc(u)}</option>`).join('');
  }
  function setUnit(u) {
    fillUnits(u);
    $('#pUnit').value = u;
  }
  const unitValue = () => $('#pUnit').value;

  function openProduct(item) {
    productForm.reset();
    clearErrors(productForm);
    editingId = item ? item.product_id : null;
    $('#productTitle').textContent = item ? '제품 수정' : `제품 등록${isAdmin() ? '' : ` · ${state.branch.name}`}`;
    $('#pName').value = item?.name || '';
    $('#pSku').value = item?.sku || '';
    // New products get their code automatically (confirmed by the server on save).
    $('#pSku').readOnly = !item;
    $('#pSkuHelp').textContent = item ? '영문·숫자·하이픈. 예: CL-6N' : '카테고리를 고르면 자동으로 정해집니다. 저장할 때 확정됩니다.';
    $('#pBrand').value = item?.brand || '';
    const pc = $('#pCategory');
    if (item && !state.categories.some((c) => c.name === item.category)) pc.add(new Option(item.category, item.category));
    pc.value = item?.category || '';
    if (!item) previewSku();
    setUnit(item?.unit || '개');
    $('#pCost').value = item ? item.cost_price : '';
    $('#pRetail').value = item?.retail_price ?? '';
    $('#pSafety').value = item ? item.safety_stock : '';
    $('#pLocation').value = item?.location || '';
    $('#pRetailFlag').checked = Boolean(item?.is_retail);
    $('#pActive').checked = item ? item.catalog_active !== false : true;
    // 단위·매입가·판매가: shared on a new product; per branch afterwards
    priceItem = item;
    $('#pScopeSet').hidden = !(item && isAdmin());
    if (item && isAdmin()) {
      $('#pScopeBranch').textContent = `이 지점만 (${state.branch.name})`;
      productForm.elements.pScope.value = 'branch';
    }
    updatePriceHelp();
    const catalogLocked = !isAdmin() && Boolean(item);
    // Managers may change everything but the code and 사용 (shared by all branches)
    $$('[data-catalog]', productForm).forEach((el) => { el.disabled = catalogLocked && !el.hasAttribute('data-manager-edit'); });
    $('#productScopeNote').hidden = !catalogLocked;
    if (catalogLocked) $('#productTitle').textContent = `${item.name} 수정 · ${state.branch.name}`;
    // 사용 중: admins switch it for every branch; a branch manager switches it for
    // their own branch only (same as the list switch), so one branch can't hide
    // a product everywhere.
    activeScope = catalogLocked ? 'branch' : 'catalog';
    if (activeScope === 'branch') {
      const hqOff = item.catalog_active === false;
      $('#pActive').checked = !hqOff && item.in_use !== false;
      $('#pActive').disabled = hqOff;
      $('#pActiveText').textContent = hqOff
        ? '본사에서 모든 지점 사용을 중지한 제품입니다'
        : `${state.branch.name}에서 사용 중 (해제하면 이 지점의 재고 목록·입출고 등록에서만 숨김)`;
    } else {
      $('#pActiveText').textContent = '사용 중 · 모든 지점 (해제하면 모든 지점의 재고 목록·입출고 등록에서 숨김)';
    }
    productDialog.open();
    $('#pName').focus();
  }

  let activeScope = 'catalog';
  let priceItem = null;

  const priceScope = () => (!priceItem ? 'all' : isAdmin() ? productForm.elements.pScope.value || 'branch' : 'branch');
  const baseText = (i) => `${i.base_name}${i.base_brand ? ` (${i.base_brand})` : ''} · ${i.base_category} · ${i.base_unit} · 매입가 ${won.format(i.base_cost_price)} · 판매가 ${i.base_retail_price != null ? won.format(i.base_retail_price) : '없음'}${i.base_is_retail ? ' · 고객 판매용' : ''}`;
  function updatePriceHelp() {
    const i = priceItem;
    const help = $('#pPriceHelp');
    if (!i) help.textContent = '처음에는 모든 지점에 같은 값으로 등록됩니다. 등록한 뒤 지점마다 따로 바꿀 수 있습니다.';
    else if (priceScope() === 'all') help.textContent = `모든 지점에 같은 값으로 저장합니다. 지금 공통 값: ${baseText(i)}`;
    else help.textContent = `${state.branch.name}에만 적용됩니다. 공통 값(다른 지점 기본): ${baseText(i)}${i.own_prices ? ' · 지금 이 지점 값을 쓰는 중' : ''}`;
    $('#pPriceReset').hidden = !(i && i.own_prices && priceScope() === 'branch');
  }
  productForm.addEventListener('change', (e) => { if (e.target.name === 'pScope') updatePriceHelp(); });
  $('#pPriceReset').addEventListener('click', () => {
    const i = priceItem;
    $('#pName').value = i.base_name;
    $('#pBrand').value = i.base_brand || '';
    $('#pCategory').value = i.base_category;
    $('#pRetailFlag').checked = Boolean(i.base_is_retail);
    setUnit(i.base_unit);
    $('#pCost').value = i.base_cost_price;
    $('#pRetail').value = i.base_retail_price ?? '';
    $('#pPriceHelp').textContent = `공통 값을 채웠습니다. 저장하면 ${state.branch.name}도 공통 값(${baseText(i)})을 씁니다.`;
    $('#pUnit').focus();
  });

  function previewSku() {
    const cat = $('#pCategory').value;
    $('#pSku').value = cat ? api.nextSku(cat, state.inventory.map((i) => i.sku)) : '';
    $('#pSku').placeholder = cat ? '' : '카테고리를 먼저 고르세요';
  }
  $('#pCategory').addEventListener('change', () => { if (!editingId) previewSku(); });

  productForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(productForm);
    const errors = [];
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
    if (editingId && need('pSku', '품목 코드') && !/^[A-Za-z0-9-]+$/.test($('#pSku').value.trim())) {
      fieldError($('#pSku'), '품목 코드는 영문, 숫자, 하이픈(-)만 쓸 수 있습니다.');
      errors.push({ id: 'pSku', msg: '품목 코드 형식을 확인해 주세요.' });
    }
    if (!$('#pCategory').value) { fieldError($('#pCategory'), '카테고리를 선택해 주세요.'); errors.push({ id: 'pCategory', msg: '카테고리를 선택해 주세요.' }); }
    if (!unitValue()) { fieldError($('#pUnit'), '단위를 선택해 주세요.'); errors.push({ id: 'pUnit', msg: '단위를 선택해 주세요.' }); }
    const cost = intField('pCost', '매입가', true);
    const retail = intField('pRetail', '판매가', false);
    const safety = intField('pSafety', '안전재고', true);
    if (errors.length) return showSummary(productForm, errors);

    // Switching 사용 off while stock is left: ask what to do with it first
    let offAns = null;
    const cur = editingId ? itemById(editingId) : null;
    const turningOff = cur && cur.stock > 0 && !$('#pActive').checked && !$('#pActive').disabled
      && (activeScope === 'branch' ? cur.in_use !== false : cur.catalog_active !== false);
    if (turningOff) {
      offAns = await confirmStockOff(cur, { allBranches: activeScope !== 'branch' });
      if (!offAns) return;
      if (offAns.choice === 'adjust') {
        $('#productDialog').close();
        openMove({ productId: cur.product_id, type: 'adjust', qty: '' });
        toast('실제 수량을 맞춘 뒤 다시 제품 설정에서 사용을 꺼 주세요.');
        return;
      }
    }

    const btn = $('#productSubmit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      if (offAns?.choice === 'dispose') await disposeRest(cur, offAns.memo);
      const newId = await api.saveProduct(state.branch.id, {
        productId: editingId, sku: editingId ? $('#pSku').value : '', name: $('#pName').value, brand: $('#pBrand').value,
        category: $('#pCategory').value, unit: unitValue(), costPrice: cost, retailPrice: retail,
        isRetail: $('#pRetailFlag').checked, safetyStock: safety, location: $('#pLocation').value,
        active: activeScope === 'branch' ? itemById(editingId).catalog_active !== false : $('#pActive').checked,
        priceScope: priceScope(),
      });
      if (activeScope === 'branch' && !$('#pActive').disabled && $('#pActive').checked !== (itemById(editingId).in_use !== false)) {
        await api.setItemInUse(state.branch.id, editingId, $('#pActive').checked);
      }
      $('#productDialog').close();
      await loadData();
      const code = editingId ? '' : itemById(newId)?.sku;
      toast(editingId ? `${$('#pName').value.trim()} 제품을 수정했습니다.` : `${$('#pName').value.trim()} 제품을 등록했습니다${code ? ` (코드 ${code})` : ''}. 모든 지점에 재고 0으로 준비되었습니다.`);
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
  const POSITIONS = { head_director: '대표원장', chief_deputy: '수석 부원장', deputy: '부원장', senior_stylist: '수석 스타일리스트', stylist: '스타일리스트', designer: '디자이너', staff: '스태프' };
  const POS_RANK = { head_director: 0, chief_deputy: 1, deputy: 2, senior_stylist: 3, stylist: 4, designer: 5, staff: 6 };
  const DESIGNER_POS = ['head_director', 'chief_deputy', 'deputy', 'senior_stylist', 'stylist', 'designer'];  // take their own clients (스태프 assists)
  const SERVICES = { cut: '컷', perm: '펌', color: '염색', clinic: '클리닉', scalp: '두피 케어', styling: '드라이·스타일링', updo: '업스타일' };
  const WEEK = [1, 2, 3, 4, 5, 6, 0];  // 월 … 일
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const STATUS_RANK = { active: 0, leave: 1, left: 2 };
  state.staff = [];
  state.st = { q: '', pos: '', status: 'current', branch: 'all' };  // branch: admins pick a branch or 'all'
  const stAll = () => isAdmin() && state.st.branch === 'all';

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

  function fillStaffBranches() {
    if (!isAdmin()) return;
    const sel = $('#stBranch');
    sel.innerHTML = '<option value="all">전체 지점</option>'
      + state.branches.map((b) => `<option value="${b.id}">${esc(b.name)}${b.active === false ? ' (중지)' : ''}</option>`).join('');
    if (state.st.branch !== 'all' && !state.branches.some((b) => b.id === state.st.branch)) state.st.branch = 'all';
    sel.value = state.st.branch;
    $('#sBranch').innerHTML = state.branches.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
  }

  async function loadStaff() {
    if (!isManager() || !state.branch) return;
    fillStaffBranches();
    const box = $('#stError');
    try {
      if (stAll()) {
        // Every branch; today's schedule too, for 오늘 근무 per branch
        const today = todayKey();
        const list = await Promise.all(state.branches.map(async (b) => {
          const [people, sched] = await Promise.all([api.listStaff(b.id), api.listSchedule(b.id, today, today).catch(() => [])]);
          return { b, people, sched };
        }));
        const name = new Map(state.branches.map((b) => [b.id, b.name]));
        state.staff = list.flatMap((l) => l.people).map((x) => ({ ...x, branch_name: name.get(x.branch_id) }));
        state.stSched = list.flatMap((l) => l.sched);
      } else {
        const id = isAdmin() ? state.st.branch : state.branch.id;
        state.staff = await api.listStaff(id);
        state.stSched = [];
      }
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
    $('#stKpiDesignersSub').textContent = `스태프 제외 · 스태프 ${nf.format(active.filter((x) => x.position === 'staff').length)}명`;
    const offToday = active.filter((x) => isOff(x, dow));
    $('#stKpiToday').textContent = `${nf.format(active.length - offToday.length)}명`;
    $('#stKpiTodaySub').innerHTML = `${DOW[dow]}요일 · ${offToday.length ? `휴무 ${nameList(offToday)}` : '휴무 없음'}`;
    $('#stKpiCert').textContent = `${nf.format(all.filter(needsCert).length)}명`;
    const every = stAll();
    $('#stBranchPanel').hidden = !every;
    $('#stRosterPanel').hidden = every;
    if (every) renderStaffBranches(all);

    // Weekly day-off board
    $('#stRoster').innerHTML = WEEK.map((d) => {
      const off = active.filter((x) => isOff(x, d));
      const working = active.length - off.length;
      const des = designers.filter((x) => !isOff(x, d)).length;
      const gap = active.length > 0 && des === 0;
      return `<li class="roster-day${d === dow ? ' is-today' : ''}${gap ? ' is-gap' : ''}">
        <div class="roster-head"><strong>${DOW[d]}</strong>${d === dow ? '<span class="roster-today">오늘</span>' : ''}</div>
        <p class="roster-count"><span class="roster-num">${nf.format(working)}</span>명 근무</p>
        <p class="roster-des">${gap ? '<span class="tag tag-off">시술 인원 없음</span>' : `시술 ${nf.format(des)}명`} · 스태프 ${nf.format(working - des)}명</p>
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
          <div class="item-sku">${x.branch_name ? `<span class="tag st-branch-tag">${esc(x.branch_name)}</span>` : ''}${esc(x.phone || '연락처 없음')}</div>${x.memo ? `<div class="st-memo">${esc(x.memo)}</div>` : ''}</div></div></td>
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

  // 전체 지점 (admin): head count per branch and the 직급 mix
  function renderStaffBranches(all) {
    const today = todayKey();
    const sched = new Map((state.stSched || []).map((r) => [`${r.staff_id}|${r.day}`, r]));
    const months = (x) => { if (!x.hired_on) return null; const a = new Date(`${x.hired_on}T00:00:00Z`), b = new Date(`${today}T00:00:00Z`); return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth(); };
    const tenureText = (list) => {
      const m = list.map(months).filter((v) => v != null && v >= 0);
      if (!m.length) return '—';
      const avg = Math.round(m.reduce((s, v) => s + v, 0) / m.length);
      return avg >= 12 ? `${Math.floor(avg / 12)}년${avg % 12 ? ` ${avg % 12}개월` : ''}` : `${avg}개월`;
    };
    const stats = (list) => {
      const active = list.filter((x) => x.status === 'active');
      const des = active.filter((x) => DESIGNER_POS.includes(x.position));
      const on = active.filter((x) => { const st = dayState(x, today, sched); return st !== 'na' && workValue(st) > 0; });
      return {
        active: active.length, des: des.length, staff: active.length - des.length, on: on.length,
        onDes: on.filter((x) => DESIGNER_POS.includes(x.position)).length,
        leave: list.filter((x) => x.status === 'leave').length, left: list.filter((x) => x.status === 'left').length,
        cert: list.filter(needsCert).length, tenure: tenureText(active),
      };
    };
    const row = (label, s, id) => `<tr${id ? '' : ' class="hq-total-row"'}>
      <th scope="row" class="cell-name">${id ? `<button type="button" class="link-btn hq-branch" data-st-branch="${id}">${esc(label)}</button>` : label}</th>
      <td class="num" data-label="재직"><strong>${nf.format(s.active)}명</strong></td>
      <td class="num" data-label="시술 인원">${nf.format(s.des)}명</td>
      <td class="num" data-label="스태프">${nf.format(s.staff)}명</td>
      <td class="num" data-label="오늘 근무">${nf.format(s.on)}명${s.active && s.onDes === 0 && s.des ? ' <span class="tag tag-off">시술 인원 없음</span>' : ''}</td>
      <td class="num" data-label="휴직">${nf.format(s.leave)}명</td>
      <td class="num" data-label="퇴사">${nf.format(s.left)}명</td>
      <td class="num" data-label="보건증 확인">${s.cert ? `<span class="hq-warn">${nf.format(s.cert)}명</span>` : '0명'}</td>
      <td class="num" data-label="평균 근속">${s.tenure}</td>
    </tr>`;
    $('#stBranchBody').innerHTML = state.branches.map((b) => row(b.name, stats(all.filter((x) => x.branch_id === b.id)), b.id)).join('')
      || '<tr><td colspan="9" class="muted rp-empty">지점이 없습니다.</td></tr>';
    $('#stBranchFoot').innerHTML = state.branches.length > 1 ? row('전체', stats(all)) : '';

    // 직급 분포 (재직): one bar, segments in rank order, counts beside the names
    const active = all.filter((x) => x.status === 'active');
    const counts = Object.keys(POSITIONS).map((k) => ({ k, n: active.filter((x) => x.position === k).length })).filter((c) => c.n);
    $('#stPosMix').innerHTML = active.length ? `<p class="st-mix-title">직급 분포 <span class="muted">· 재직 ${nf.format(active.length)}명</span></p>
      <div class="st-mix-bar" role="img" aria-label="${counts.map((c) => `${POSITIONS[c.k]} ${c.n}명`).join(', ')}">${counts.map((c) => `<span class="pos-fill-${c.k}" style="flex:${c.n}" title="${POSITIONS[c.k]} ${c.n}명"></span>`).join('')}</div>
      <ul class="st-mix-legend">${counts.map((c) => `<li><i class="pos-fill-${c.k}"></i>${POSITIONS[c.k]} <b>${nf.format(c.n)}</b></li>`).join('')}</ul>` : '';
  }
  $('#stBranchPanel').addEventListener('click', (e) => {
    const b = e.target.closest('[data-st-branch]');
    if (!b) return;
    state.st.branch = b.dataset.stBranch;
    loadStaff();
  });
  $('#stBranch').addEventListener('change', (e) => { state.st.branch = e.target.value; loadStaff(); });

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
  // 퇴사일 is always shown; it can be filled in only when 퇴사 is chosen.
  // 스태프 has no 담당 시술: the choices are cleared and locked
  const syncServices = () => {
    const isStaff = $('#sPosition').value === 'staff';
    $$('input[name="sSvc"]').forEach((c) => { if (isStaff) c.checked = false; c.disabled = isStaff; });
    $('#sServicesHelp').hidden = !isStaff;
  };
  $('#sPosition').addEventListener('change', syncServices);
  const syncLeftField = () => {
    const left = staffForm.elements.sStatus.value === 'left';
    $('#sLeftOn').disabled = !left;
    $('#sLeftOnHelp').textContent = left ? '비워 두면 오늘 날짜로 기록합니다. 입사일보다 앞설 수 없습니다.' : "근무 상태를 '퇴사'로 고르면 입력할 수 있습니다.";
  };
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
    // 소속 지점 (admin): a new person joins the branch on screen; 전체 지점 → the top-bar branch
    const home = x?.branch_id || (isAdmin() && state.st.branch !== 'all' ? state.st.branch : state.branch.id);
    if (isAdmin()) $('#sBranch').value = home;
    const homeName = state.branches.find((b) => b.id === home)?.name || state.branch.name;
    $('#staffTitle').textContent = x ? `${x.name} 정보 수정` : `직원 추가${isAdmin() ? '' : ` · ${homeName}`}`;
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
    $('#sLeave').value = x?.annual_leave_days ?? '';
    $('#staffDelete').hidden = !x;
    syncLeftField();
    syncServices();
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
    const leaveRaw = $('#sLeave').value.trim();
    const leaveDays = leaveRaw === '' ? null : Number(leaveRaw);
    if (leaveDays != null && (!Number.isFinite(leaveDays) || leaveDays < 0 || leaveDays > 60 || (leaveDays * 2) % 1)) {
      fieldError($('#sLeave'), '연차 일수는 0~60 사이, 0.5일 단위로 입력해 주세요.');
      errors.push({ id: 'sLeave', msg: '연차 일수를 확인해 주세요.' });
    }
    const status = staffForm.elements.sStatus.value;
    const hired = $('#sHired').value, left = status === 'left' ? $('#sLeftOn').value : '';
    if (left && hired && left < hired) { fieldError($('#sLeftOn'), '퇴사일은 입사일 이후여야 합니다.'); errors.push({ id: 'sLeftOn', msg: '퇴사일을 확인해 주세요.' }); }
    if (errors.length) return showSummary(staffForm, errors);

    const btn = $('#staffSubmit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      const branchId = isAdmin() ? $('#sBranch').value : editingStaff?.branch_id || state.branch.id;
      const branchName = state.branches.find((b) => b.id === branchId)?.name || state.branch.name;
      const moved = editingStaff && editingStaff.branch_id !== branchId;
      const id = await api.saveStaff({
        id: editingStaff?.id || null, branch_id: branchId, name,
        position: $('#sPosition').value, phone: $('#sPhone').value, hired_on: hired || null, status, left_on: left || null,
        services: $('#sPosition').value === 'staff' ? [] : $$('input[name="sSvc"]:checked').map((c) => c.value),
        days_off: $$('input[name="sDay"]:checked').map((c) => Number(c.value)),
        incentive_service: incS, incentive_retail: incR,
        license_no: $('#sLicense').value, health_cert_expires: $('#sCert').value || null, memo: $('#sMemo').value,
        annual_leave_days: leaveDays,
      });
      let photoError = null;
      try {
        if (staffPhotoDraft === 'remove') await api.removeStaffPhoto({ id, branch_id: branchId });
        else if (staffPhotoDraft?.blob) await api.setStaffPhoto({ id, branch_id: branchId }, staffPhotoDraft.blob);
      } catch (px) { photoError = api.toAppError(px).message; }
      $('#staffDialog').close();
      setStaffPhotoDraft(null);
      const saved = !editingStaff ? `${name} 님을 ${branchName} 직원으로 추가했습니다.`
        : moved ? `${name} 님을 ${branchName}(으)로 옮겼습니다.` : `${name} 정보를 저장했습니다.`;
      if (photoError) toast(`${saved} 사진은 올리지 못했습니다: ${photoError}`, { error: true });
      else toast(saved);
      await loadStaff();
    } catch (ex) {
      const err = api.toAppError(ex);
      const field = { INVALID_STAFF_NAME: 'sName', INVALID_STAFF_POSITION: 'sPosition', INVALID_STAFF_RATE: 'sIncS', INVALID_STAFF_DATES: 'sLeftOn', INVALID_STAFF_LEAVE: 'sLeave' }[err.code];
      if (field) {
        fieldError($('#' + field), err.message);
        showSummary(staffForm, [{ id: field, msg: err.message }]);
      } else {
        showServerError(staffForm, err.message);
      }
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
  // 근무표·연차 (everyone at the branch reads; the manager edits)
  // ------------------------------------------------------------------
  const KIND = {
    off: { label: '추가 휴무', short: '휴' }, work: { label: '대체 근무', short: '근' }, annual: { label: '연차', short: '연' },
    half: { label: '반차', short: '반' }, sick: { label: '병가', short: '병' }, edu: { label: '교육', short: '교' },
  };
  state.sch = { month: todayKey().slice(0, 7), rows: [], year: null };
  const monthLabel = (ym) => `${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월`;
  const shiftMonth = (ym, n) => { const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
  const daysIn = (ym) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
  const dowOf = (day) => new Date(`${day}T00:00:00Z`).getUTCDay();

  // Where a person stands on a day: 'na' (not employed), a KIND key, 'reg' (regular day off) or '' (working)
  function dayState(x, day, sched) {
    if ((x.hired_on && day < x.hired_on) || (x.status === 'left' && x.left_on && day > x.left_on)) return 'na';
    const e = sched.get(`${x.id}|${day}`);
    if (e) return e.kind;
    return (x.days_off || []).includes(dowOf(day)) ? 'reg' : '';
  }
  const workValue = (st) => (st === '' || st === 'work' ? 1 : st === 'half' ? 0.5 : 0);

  // 연차 발생 (근로기준법 제60조, hire-date basis) as of a date
  function leaveEntitlement(x, asOf) {
    if (x.annual_leave_days != null) return { days: Number(x.annual_leave_days), auto: false };
    if (!x.hired_on) return null;
    const a = new Date(`${x.hired_on}T00:00:00Z`), b = new Date(`${asOf}T00:00:00Z`);
    let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
    if (b.getUTCDate() < a.getUTCDate()) months -= 1;
    if (months < 0) return { days: 0, auto: true };
    const years = Math.floor(months / 12);
    return { days: years < 1 ? Math.min(11, months) : Math.min(25, 15 + Math.floor((years - 1) / 2)), auto: true };
  }

  async function loadSchedule() {
    if (!state.branch) return;
    const year = state.sch.month.slice(0, 4);
    const box = $('#schError');
    try {
      const [people, rows] = await Promise.all([
        isManager() ? api.listStaff(state.branch.id) : api.listStaffNames(state.branch.id),
        api.listSchedule(state.branch.id, `${year}-01-01`, `${year}-12-31`),
      ]);
      state.sch.people = people;
      state.sch.rows = rows;
      box.hidden = true;
    } catch (e) {
      state.sch.people = [];
      state.sch.rows = [];
      box.textContent = api.toAppError(e).message;
      box.hidden = false;
    }
    renderSchedule();
  }

  function renderSchedule() {
    const ym = state.sch.month;
    $('#schMonth').textContent = monthLabel(ym);
    $('#schThis').disabled = ym === todayKey().slice(0, 7);
    const n = daysIn(ym), days = Array.from({ length: n }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`);
    const today = todayKey();
    const sched = new Map(state.sch.rows.map((r) => [`${r.staff_id}|${r.day}`, r]));
    const rank = { head_director: 0, chief_deputy: 1, deputy: 2, senior_stylist: 3, stylist: 4, designer: 5, staff: 6 };
    const people = (state.sch.people || [])
      .filter((x) => x.status !== 'leave' && days.some((d) => dayState(x, d, sched) !== 'na') && (x.status !== 'left' || (x.left_on && x.left_on >= days[0])))
      .sort((a, b) => rank[a.position] - rank[b.position] || a.name.localeCompare(b.name, 'ko'));
    const edit = isManager();
    $('#schEmpty').hidden = people.length > 0;
    $('#schWrap').hidden = people.length === 0;

    const head = `<thead><tr><th scope="col" class="sch-name">직원</th>${days.map((d) => {
      const w = dowOf(d);
      return `<th scope="col" class="sch-day${w === 0 ? ' is-sun' : w === 6 ? ' is-sat' : ''}${d === today ? ' is-today' : ''}"><span>${Number(d.slice(8))}</span><small>${DOW[w]}</small></th>`;
    }).join('')}<th scope="col" class="sch-sum">근무일</th></tr></thead>`;
    const personRow = (x) => {
      let worked = 0;
      const cells = days.map((d) => {
        const st = dayState(x, d, sched);
        worked += workValue(st);
        const e = sched.get(`${x.id}|${d}`);
        const label = st === 'na' ? '재직 전후' : st === 'reg' ? '정기 휴무' : st === '' ? '근무' : KIND[st].label;
        const text = st === 'na' ? '' : st === 'reg' ? '휴' : st === '' ? '' : KIND[st].short;
        const cls = `sc sc-${st || 'on'}${d === today ? ' is-today' : ''}`;
        const title = `${x.name} ${Number(d.slice(5, 7))}월 ${Number(d.slice(8))}일 ${label}${e?.memo ? ` · ${e.memo}` : ''}`;
        return edit && st !== 'na'
          ? `<td><button type="button" class="${cls}" data-sch="${x.id}|${d}" aria-label="${esc(title)}" title="${esc(title)}">${text}</button></td>`
          : `<td><span class="${cls}" title="${esc(title)}"><span class="sr-only">${esc(label)}</span><span aria-hidden="true">${text}</span></span></td>`;
      }).join('');
      return `<tr><th scope="row" class="sch-name"><span class="sch-person">${esc(x.name)}<small>${POSITIONS[x.position] || ''}</small></span></th>${cells}<td class="sch-sum">${nf.format(worked)}일</td></tr>`;
    };
    // Two groups: 시술 인원 (take clients) and 스태프 (assist)
    const designers = people.filter((x) => DESIGNER_POS.includes(x.position));
    const assistants = people.filter((x) => !DESIGNER_POS.includes(x.position));
    const group = (title, list) => (list.length
      ? `<tbody><tr class="sch-group"><th scope="rowgroup" colspan="${days.length + 2}"><span>${title} <small>${nf.format(list.length)}명</small></span></th></tr>${list.map(personRow).join('')}</tbody>`
      : '');
    const body = group('시술 인원', designers) + group('스태프', assistants);
    const countRow = (label, list, warn) => `<tr class="sch-foot"><th scope="row" class="sch-name">${label}</th>${days.map((d) => {
      const c = list.filter((x) => workValue(dayState(x, d, sched)) > 0).length;  // people present (반차 included)
      const gap = warn && designers.length > 0 && c === 0;
      return `<td class="${gap ? 'is-gap' : ''}">${gap ? '<span class="sr-only">시술 인원 없음 </span>' : ''}${nf.format(c)}</td>`;
    }).join('')}<td></td></tr>`;
    $('#schTable').innerHTML = head + body
      + `<tfoot>${countRow('전체 근무', people, false)}${countRow('시술 인원', designers, true)}${assistants.length ? countRow('스태프', assistants, false) : ''}</tfoot>`;

    // Leave summary (managers)
    if (!isManager()) return;
    const year = ym.slice(0, 4);
    const asOf = today.slice(0, 4) === year ? today : `${year}-12-31` < today ? `${year}-12-31` : today;
    $('#leaveSub').textContent = `${year}년 사용 기준 · 발생은 ${asOf.replace(/-/g, '.')} 기준`;
    const staffAll = (state.sch.people || []).filter((x) => x.status !== 'left' || (x.left_on && x.left_on.slice(0, 4) >= year))
      .sort((a, b) => rank[a.position] - rank[b.position] || a.name.localeCompare(b.name, 'ko'));
    $('#leaveBody').innerHTML = staffAll.map((x) => {
      const used = state.sch.rows.filter((r) => r.staff_id === x.id && (r.kind === 'annual' || r.kind === 'half'));
      const usedDays = used.reduce((a, r) => a + (r.kind === 'half' ? 0.5 : 1), 0);
      const ent = leaveEntitlement(x, x.status === 'left' && x.left_on && x.left_on < asOf ? x.left_on : asOf);
      const left = ent ? ent.days - usedDays : null;
      const list = used.sort((a, b) => (a.day < b.day ? -1 : 1)).map((r) => `${Number(r.day.slice(5, 7))}/${Number(r.day.slice(8))}${r.kind === 'half' ? '(반)' : ''}`).join(', ');
      return `<tr class="${x.status !== 'active' ? 'inactive-row' : ''}">
        <td class="cell-name"><div class="item-name">${esc(x.name)}<span class="tag pos-tag pos-${x.position}">${POSITIONS[x.position]}</span></div>${x.status === 'leave' ? '<div class="item-sku">휴직 중</div>' : ''}</td>
        <td data-label="입사·근속" class="when">${x.hired_on ? `${dateText(x.hired_on)}<small>${tenure(x.hired_on, x.status === 'left' ? x.left_on : null)}</small>` : '<span class="muted">입사일 없음</span>'}</td>
        <td data-label="발생">${ent ? `${nf.format(ent.days)}일${ent.auto ? '' : ' <span class="tag tag-note">직접 지정</span>'}` : '<span class="muted">입사일 필요</span>'}</td>
        <td data-label="사용">${nf.format(usedDays)}일</td>
        <td data-label="남음">${left == null ? '—' : left < 0 ? `<span class="tag tag-off">${nf.format(left)}일</span>` : `<strong>${nf.format(left)}일</strong>`}</td>
        <td data-label="사용한 날"><span class="memo">${list || '—'}</span></td>
      </tr>`;
    }).join('');
  }

  const goMonth = (n) => {
    const prevYear = state.sch.month.slice(0, 4);
    state.sch.month = n === 0 ? todayKey().slice(0, 7) : shiftMonth(state.sch.month, n);
    if (state.sch.month.slice(0, 4) !== prevYear) loadSchedule(); else renderSchedule();
  };
  $('#schPrev').addEventListener('click', () => goMonth(-1));
  $('#schNext').addEventListener('click', () => goMonth(1));
  $('#schThis').addEventListener('click', () => goMonth(0));

  const schDialog = setupDialog($('#schDialog'));
  const schForm = $('#schForm');
  let schTarget = null;
  function openScheduleDay(staffId, day, trigger) {
    const x = (state.sch.people || []).find((p) => p.id === staffId);
    if (!x) return;
    const e = state.sch.rows.find((r) => r.staff_id === staffId && r.day === day);
    schTarget = { staffId, day, trigger };
    clearErrors(schForm);
    const reg = (x.days_off || []).includes(dowOf(day));
    $('#schTitle').textContent = `${x.name} · ${Number(day.slice(5, 7))}월 ${Number(day.slice(8))}일 (${DOW[dowOf(day)]})`;
    $('#schInfo').textContent = reg ? '이날은 정기 휴무일입니다. 출근하면 "대체 근무"를 고르세요.' : '이날은 기본 근무일입니다.';
    schForm.elements.schKind.value = e ? e.kind : '';
    $('#schMemo').value = e?.memo || '';
    schDialog.open();
    (schForm.querySelector('input[name="schKind"]:checked') || schForm.querySelector('input[name="schKind"]')).focus();
  }
  schForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#schSubmit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      const kind = schForm.elements.schKind.value || null;
      await api.setSchedule(schTarget.staffId, schTarget.day, kind, $('#schMemo').value);
      state.sch.rows = state.sch.rows.filter((r) => !(r.staff_id === schTarget.staffId && r.day === schTarget.day));
      if (kind) state.sch.rows.push({ staff_id: schTarget.staffId, day: schTarget.day, kind, memo: $('#schMemo').value.trim() || null });
      $('#schDialog').close();
      renderSchedule();
      const again = $(`[data-sch="${schTarget.staffId}|${schTarget.day}"]`);
      if (again) again.focus();
    } catch (ex) {
      showServerError(schForm, api.toAppError(ex).message);
    } finally {
      btn.disabled = false; btn.removeAttribute('aria-busy');
    }
  });

  // ------------------------------------------------------------------
  // 근무 현황: this week's real attendance (regular days off + 근무표) and
  // one day's schedule. Everyone at the branch can see it.
  // ------------------------------------------------------------------
  const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
  const weekStartOf = (day) => addDays(day, -((dowOf(day) + 6) % 7));  // Monday
  const mdText = (day) => `${Number(day.slice(5, 7))}월 ${Number(day.slice(8))}일`;
  state.wb = { start: weekStartOf(todayKey()), day: todayKey(), people: [], rows: [] };

  async function loadWorkboard() {
    if (!state.branch) return;
    const box = $('#wbError');
    try {
      const [people, rows] = await Promise.all([
        isManager() ? api.listStaff(state.branch.id) : api.listStaffNames(state.branch.id),
        api.listSchedule(state.branch.id, state.wb.start, addDays(state.wb.start, 6)),
      ]);
      state.wb.people = people;
      state.wb.rows = rows;
      box.hidden = true;
    } catch (e) {
      state.wb.people = [];
      state.wb.rows = [];
      box.textContent = api.toAppError(e).message;
      box.hidden = false;
    }
    renderWorkboard();
  }

  // Everyone who could work that week (휴직 excluded), ordered by 직급
  function wbPeople(days) {
    const sched = new Map(state.wb.rows.map((r) => [`${r.staff_id}|${r.day}`, r]));
    const people = state.wb.people
      .filter((x) => x.status !== 'leave' && days.some((d) => dayState(x, d, sched) !== 'na'))
      .sort((a, b) => POS_RANK[a.position] - POS_RANK[b.position] || a.name.localeCompare(b.name, 'ko'));
    return { people, sched };
  }
  const offReason = (st) => (st === 'reg' ? '정기 휴무' : KIND[st]?.label || '');

  function renderWorkboard() {
    const today = todayKey();
    const days = Array.from({ length: 7 }, (_, i) => addDays(state.wb.start, i));
    if (!days.includes(state.wb.day)) state.wb.day = days.includes(today) ? today : days[0];
    const { people, sched } = wbPeople(days);
    $('#wbRange').textContent = `${state.wb.start.slice(0, 4)}년 ${mdText(days[0])} – ${mdText(days[6])}`;
    $('#wbThis').disabled = days.includes(today);

    $('#wbWeek').innerHTML = days.map((d) => {
      const states = people.map((x) => ({ x, st: dayState(x, d, sched) })).filter((o) => o.st !== 'na');
      // People present that day (반차 counts as present, noted separately)
      const working = states.filter((o) => workValue(o.st) > 0).length;
      const des = states.filter((o) => DESIGNER_POS.includes(o.x.position) && workValue(o.st) > 0).length;
      const halves = states.filter((o) => o.st === 'half').length;
      const staffOn = working - des;
      const hasDes = states.some((o) => DESIGNER_POS.includes(o.x.position));
      const gap = hasDes && des === 0;
      const away = states.filter((o) => workValue(o.st) < 1);
      const w = dowOf(d);
      return `<li class="roster-day${d === today ? ' is-today' : ''}${gap ? ' is-gap' : ''}${d === state.wb.day ? ' is-selected' : ''}">
        <button type="button" class="wb-pick" data-wb-day="${d}" aria-pressed="${d === state.wb.day}" aria-label="${mdText(d)} ${DOW[w]}요일 근무 스케줄 보기">
          <span class="roster-head"><strong class="${w === 0 ? 'is-sun' : w === 6 ? 'is-sat' : ''}">${DOW[w]} <span class="wb-date">${Number(d.slice(8))}</span></strong>${d === today ? '<span class="roster-today">오늘</span>' : ''}</span>
          <span class="roster-count"><span class="roster-num">${nf.format(working)}</span>명 근무</span>
          <span class="roster-des">${gap ? '<span class="tag tag-off">시술 인원 없음</span>' : `시술 ${nf.format(des)}명`} · 스태프 ${nf.format(staffOn)}명${halves ? `<span class="roster-half">반차 ${nf.format(halves)}</span>` : ''}</span>
          <span class="roster-off">${away.length ? away.map((o) => `<span class="off-name wb-off-${o.st}" title="${esc(offReason(o.st))}">${esc(o.x.name)}<small>${o.st === 'half' ? '반' : o.st === 'reg' ? '' : KIND[o.st].short}</small></span>`).join('') : '<span class="muted">휴무 없음</span>'}</span>
        </button>
      </li>`;
    }).join('');

    // Selected day
    const d = state.wb.day;
    const w = dowOf(d);
    const list = people.map((x) => ({ x, st: dayState(x, d, sched), e: sched.get(`${x.id}|${d}`) })).filter((o) => o.st !== 'na');
    const on = list.filter((o) => workValue(o.st) > 0);
    const off = list.filter((o) => workValue(o.st) === 0);
    const des = on.filter((o) => DESIGNER_POS.includes(o.x.position)).length;
    const halves = on.filter((o) => o.st === 'half').length;
    $('#wbDayHeading').textContent = `${mdText(d)} (${DOW[w]}) 근무 스케줄${d === today ? ' · 오늘' : ''}`;
    $('#wbDaySub').textContent = `근무 ${nf.format(on.length)}명${halves ? `(반차 ${nf.format(halves)})` : ''} · 시술 ${nf.format(des)}명 · 스태프 ${nf.format(on.length - des)}명 · 휴무·부재 ${nf.format(off.length)}명`;
    $('#wbOnCount').textContent = `${nf.format(on.length)}명`;
    $('#wbOffCount').textContent = `${nf.format(off.length)}명`;
    const item = (o) => {
      const chip = o.st === '' ? '<span class="tag wb-chip wb-chip-on">근무</span>'
        : o.st === 'work' ? '<span class="tag wb-chip wb-chip-work">대체 근무</span>'
        : o.st === 'half' ? '<span class="tag wb-chip wb-chip-half">반차</span>'
        : `<span class="tag wb-chip wb-chip-${o.st}">${esc(offReason(o.st))}</span>`;
      const svc = o.x.services && o.x.services.length ? `<span class="wb-svc">${Object.keys(SERVICES).filter((k) => o.x.services.includes(k)).map((k) => SERVICES[k]).join(' · ')}</span>` : '';
      return `<li class="wb-item">
        ${staffAvatar(o.x)}
        <div class="wb-who"><div class="item-name">${esc(o.x.name)}<span class="tag pos-tag pos-${o.x.position}">${POSITIONS[o.x.position] || ''}</span></div>${svc}${o.e?.memo ? `<div class="st-memo">${esc(o.e.memo)}</div>` : ''}</div>
        ${chip}
      </li>`;
    };
    $('#wbOn').innerHTML = on.length ? on.map(item).join('') : '<li class="wb-empty muted">근무하는 직원이 없습니다.</li>';
    $('#wbOff').innerHTML = off.length ? off.map(item).join('') : '<li class="wb-empty muted">모두 근무합니다.</li>';
    if (!people.length) $('#wbOn').innerHTML = `<li class="wb-empty muted">등록된 직원이 없습니다.${isManager() ? ' 직원 관리에서 직원을 먼저 등록해 주세요.' : ''}</li>`;
  }

  const wbGo = (n) => {
    state.wb.start = n === 0 ? weekStartOf(todayKey()) : addDays(state.wb.start, 7 * n);
    state.wb.day = n === 0 ? todayKey() : state.wb.start;
    loadWorkboard();
  };
  $('#wbPrev').addEventListener('click', () => wbGo(-1));
  $('#wbNext').addEventListener('click', () => wbGo(1));
  $('#wbThis').addEventListener('click', () => wbGo(0));

  // ------------------------------------------------------------------
  // 매장 레포트: one day at the branch (managers)
  // ------------------------------------------------------------------
  state.rp = { day: todayKey(), rows: [], all: [], sales: [], people: [], sched: [] };

  async function loadReport() {
    if (!isManager() || !state.branch) return;
    const d = state.rp.day, from = addDays(d, -13);
    const box = $('#rpError');
    try {
      const [all, sales, people, sched] = await Promise.all([
        api.listMovementsBetween(state.branch.id, from, d),
        api.listDailySales(state.branch.id, from, d).catch(() => []),
        api.listStaff(state.branch.id).catch(() => []),
        api.listSchedule(state.branch.id, d, d).catch(() => []),
      ]);
      const rows = all.filter((m) => keyFmt.format(new Date(m.created_at)) === d);
      Object.assign(state.rp, { rows, all, sales, people, sched });
      box.hidden = true;
    } catch (e) {
      Object.assign(state.rp, { rows: [], all: [], sales: [], people: [], sched: [] });
      box.textContent = api.toAppError(e).message;
      box.hidden = false;
    }
    renderReport();
  }

  // Per-day money for the 14 days ending on the report day.
  // 제품 판매 at the sale price, 재료 사용액 at cost; reversals net out, counts leave them out.
  function reportDays() {
    const d = state.rp.day;
    const price = (m) => m.unit_price ?? itemById(m.product_id)?.retail_price ?? 0;
    const days = new Map();
    for (let i = 13; i >= 0; i--) {
      const k = addDays(d, -i);
      days.set(k, { day: k, svc: 0, cnt: 0, entered: false, memo: '', prod: 0, prodN: 0, prodQty: 0, mat: 0, matN: 0 });
    }
    state.rp.sales.forEach((s) => {
      const x = days.get(s.day);
      if (!x) return;
      Object.assign(x, { svc: Number(s.service_sales) || 0, cnt: Number(s.service_count) || 0, entered: true, memo: s.memo || '' });
    });
    state.rp.all.forEach((m) => {
      const x = days.get(keyFmt.format(new Date(m.created_at)));
      if (!x) return;
      const counted = !m.reverts_id && !m.reverted;
      if (m.type === 'sale') { x.prod += -m.quantity * price(m); x.prodQty += -m.quantity; if (counted) x.prodN += 1; }
      if (m.type === 'use') { x.mat += -m.quantity * (m.unit_cost || 0); if (counted) x.matN += 1; }
    });
    days.forEach((x) => { x.total = x.svc + x.prod; });
    return [...days.values()];
  }
  const sumDays = (list) => {
    const s = list.reduce((a, x) => ({ svc: a.svc + x.svc, cnt: a.cnt + x.cnt, prod: a.prod + x.prod, mat: a.mat + x.mat, total: a.total + x.total }), { svc: 0, cnt: 0, prod: 0, mat: 0, total: 0 });
    s.avg = s.cnt ? s.svc / s.cnt : 0;
    s.ratio = s.svc ? (s.mat / s.svc) * 100 : null;
    return s;
  };
  const pct1 = new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  // Change badge. costly = a rise is bad (재료 사용액). pp = percentage-point difference.
  function deltaHtml(cur, base, { costly = false, pp = false, tag = 'span', id } = {}) {
    let cls = 'flat', text = '—', label = '변화 없음';
    if (pp) {
      if (cur != null && base != null) {
        const diff = cur - base;
        if (Math.abs(diff) >= 0.05) { cls = (diff > 0) !== costly ? 'pos' : 'neg'; text = `${diff > 0 ? '▲' : '▼'} ${pct1.format(Math.abs(diff))}%p`; label = `${pct1.format(Math.abs(diff))}%포인트 ${diff > 0 ? '상승' : '하락'}`; } else text = '0.0%p';
      }
    } else if (base === 0 && cur > 0) {
      cls = costly ? 'neg' : 'pos'; text = '신규'; label = '비교 기준 없음';
    } else if (base > 0) {
      const p = ((cur - base) / base) * 100;
      if (Math.abs(p) >= 0.05) { cls = (p > 0) !== costly ? 'pos' : 'neg'; text = `${p > 0 ? '▲' : '▼'} ${pct1.format(Math.abs(p))}%`; label = `${pct1.format(Math.abs(p))}% ${p > 0 ? '증가' : '감소'}`; } else text = '0.0%';
    }
    return { cls: `delta delta-${cls}`, text, label, html: `<${tag} class="delta delta-${cls}"${id ? ` id="${id}"` : ''} aria-label="${label}">${text}</${tag}>` };
  }
  function setDelta(id, d, suffix) {
    const el = $('#' + id);
    el.className = d.cls;
    el.textContent = d.text;
    el.setAttribute('aria-label', `${suffix} ${d.label}`);
    el.title = suffix;
  }
  const dayLabel = (k) => `${mdText(k)} (${DOW[dowOf(k)]})`;

  function renderReport() {
    const d = state.rp.day, today = todayKey();
    $('#rpDate').textContent = `${d.slice(0, 4)}년 ${mdText(d)} (${DOW[dowOf(d)]})${d === today ? ' · 오늘' : ''}`;
    $('#rpPick').value = d;
    $('#rpPick').max = today;
    $('#rpNext').disabled = d >= today;
    $('#rpToday').disabled = d === today;

    // KPIs: the day against the same weekday last week
    const days = reportDays();
    const cur = days[13], wk = days[6];
    const vs = `지난주 ${dayLabel(wk.day)} 대비`;
    $('#rpTotal').textContent = won.format(cur.total);
    $('#rpTotalSub').textContent = `지난주 ${dayLabel(wk.day)} ${won.format(wk.total)}`;
    setDelta('rpTotalDelta', deltaHtml(cur.total, wk.total), vs);
    if (cur.entered) {
      $('#rpService').textContent = won.format(cur.svc);
      $('#rpServiceSub').innerHTML = `${nf.format(cur.cnt)}건${cur.cnt ? ` · 객단가 ${won.format(Math.round(cur.svc / cur.cnt))}` : ''} <button type="button" class="link-btn rp-ds-edit" data-ds-open>수정</button>`;
      setDelta('rpServiceDelta', deltaHtml(cur.svc, wk.svc), vs);
    } else {
      $('#rpService').innerHTML = '<span class="rp-missing">미입력</span>';
      $('#rpServiceSub').innerHTML = '<button type="button" class="link-btn rp-ds-edit" data-ds-open>POS 마감 매출 입력하기</button>';
      setDelta('rpServiceDelta', { cls: 'delta', text: '', label: '' }, '');
    }
    $('#rpSales').textContent = won.format(cur.prod);
    $('#rpSalesSub').textContent = `${nf.format(cur.prodN)}건 · ${nf.format(cur.prodQty)}개`;
    setDelta('rpSalesDelta', deltaHtml(cur.prod, wk.prod), vs);
    $('#rpUse').textContent = won.format(cur.mat);
    $('#rpUseSub').textContent = `시술 사용 ${nf.format(cur.matN)}건${cur.svc ? ` · 재료비율 ${pct1.format((cur.mat / cur.svc) * 100)}%` : ''}`;
    setDelta('rpUseDelta', deltaHtml(cur.mat, wk.mat, { costly: true }), vs);

    // Last 7 days against the 7 before
    const thisWk = days.slice(7), prevWk = days.slice(0, 7);
    const a = sumDays(thisWk), b = sumDays(prevWk);
    $('#rpWeekSub').textContent = `최근 7일 ${mdText(thisWk[0].day)}~${mdText(d)} · 이전 7일 ${mdText(prevWk[0].day)}~${mdText(prevWk[6].day)} · 같은 요일끼리 비교`;
    const pctText = (v) => (v == null ? '—' : `${pct1.format(v)}%`);
    const cmp = [
      ['총매출', won.format(a.total), won.format(b.total), deltaHtml(a.total, b.total), true],
      ['시술 매출', won.format(a.svc), won.format(b.svc), deltaHtml(a.svc, b.svc)],
      ['시술 건수', `${nf.format(a.cnt)}건`, `${nf.format(b.cnt)}건`, deltaHtml(a.cnt, b.cnt)],
      ['객단가', a.cnt ? won.format(Math.round(a.avg)) : '—', b.cnt ? won.format(Math.round(b.avg)) : '—', a.cnt && b.cnt ? deltaHtml(a.avg, b.avg) : deltaHtml(0, 0)],
      ['제품 판매', won.format(a.prod), won.format(b.prod), deltaHtml(a.prod, b.prod)],
      ['재료 사용액', won.format(a.mat), won.format(b.mat), deltaHtml(a.mat, b.mat, { costly: true })],
      ['재료비율', pctText(a.ratio), pctText(b.ratio), deltaHtml(a.ratio, b.ratio, { costly: true, pp: true })],
    ];
    $('#rpCompare').innerHTML = cmp.map(([k, x, y, dl, main]) => `<tr${main ? ' class="rp-cmp-main"' : ''}><th scope="row" class="cell-name">${k}</th><td class="num" data-label="최근 7일">${x}</td><td class="num muted" data-label="이전 7일">${y}</td><td class="num" data-label="증감">${dl.html}</td></tr>`).join('');
    const missing = thisWk.filter((x) => !x.entered).map((x) => mdText(x.day));
    $('#rpChartNote').textContent = missing.length
      ? `시술 매출 미입력: ${missing.join(', ')} — 입력하지 않은 날은 제품 판매만 합산됩니다.`
      : '막대: 하루 총매출(시술 매출 + 제품 판매). 막대에 마우스를 올리면 자세히 보입니다.';
    state.rp.chart = { thisWk, prevWk };
    drawReportChart(true);
    renderUseDetail();

    // Amounts: 판매 at the sale price, everything else at cost. Reversals carry the
    // opposite quantity, so sums net out; counts leave both sides out.
    const rows = state.rp.rows;
    const price = (m) => m.unit_price ?? itemById(m.product_id)?.retail_price ?? 0;
    const counted = rows.filter((m) => !m.reverts_id && !m.reverted);
    const agg = {};
    ['receive', 'use', 'sale', 'dispose', 'adjust'].forEach((t) => { agg[t] = { n: 0, qty: 0, amt: 0 }; });
    rows.forEach((m) => {
      const a = agg[m.type];
      if (!a) return;
      const out = OUT_TYPES.includes(m.type);
      a.qty += out ? -m.quantity : m.quantity;
      a.amt += m.type === 'sale' ? -m.quantity * price(m) : (out ? -m.quantity : m.quantity) * (m.unit_cost || 0);
    });
    counted.forEach((m) => { if (agg[m.type]) agg[m.type].n += 1; });

    $('#rpTypes').innerHTML = ['receive', 'use', 'sale', 'dispose', 'adjust'].map((t) => {
      const a = agg[t];
      const qty = t === 'adjust' ? `${a.qty > 0 ? '+' : ''}${nf.format(a.qty)}` : nf.format(a.qty);
      const amt = t === 'adjust' ? `${a.amt > 0 ? '+' : a.amt < 0 ? '−' : ''}${won.format(Math.abs(a.amt))}` : won.format(a.amt);
      return `<tr class="${a.n ? '' : 'rp-zero'}"><td class="cell-name">${typeTag(t)}</td><td class="num" data-label="건수">${nf.format(a.n)}건</td><td class="num" data-label="수량">${qty}</td><td class="num" data-label="금액">${amt}</td></tr>`;
    }).join('');

    // Staffing that day
    const sched = new Map(state.rp.sched.map((r) => [`${r.staff_id}|${r.day}`, r]));
    const people = state.rp.people.filter((x) => x.status !== 'leave')
      .map((x) => ({ x, st: dayState(x, d, sched), e: sched.get(`${x.id}|${d}`) })).filter((o) => o.st !== 'na')
      .sort((a, b) => POS_RANK[a.x.position] - POS_RANK[b.x.position] || a.x.name.localeCompare(b.x.name, 'ko'));
    const on = people.filter((o) => workValue(o.st) > 0), off = people.filter((o) => workValue(o.st) === 0);
    const onDes = on.filter((o) => DESIGNER_POS.includes(o.x.position)).length;
    $('#rpOnCount').textContent = `${nf.format(on.length)}명`;
    $('#rpOffCount').textContent = `${nf.format(off.length)}명`;
    const nameItem = (o, note) => `<li><span class="rp-name">${esc(o.x.name)}</span><span class="tag pos-tag pos-${o.x.position}">${POSITIONS[o.x.position]}</span>${note ? `<small>${esc(note)}</small>` : ''}</li>`;
    $('#rpOn').innerHTML = on.length ? on.map((o) => nameItem(o, o.st === 'half' ? '반차' : o.st === 'work' ? '대체 근무' : '')).join('') : '<li class="muted">없음</li>';
    $('#rpOff').innerHTML = off.length ? off.map((o) => nameItem(o, `${offReason(o.st)}${o.e?.memo ? ` · ${o.e.memo}` : ''}`)).join('') : '<li class="muted">없음</li>';

    // Top products
    const top = (type) => {
      const m = new Map();
      rows.filter((r) => r.type === type).forEach((r) => {
        const cur = m.get(r.product_id) || { name: r.product_name, unit: r.unit, qty: 0, amt: 0 };
        cur.qty += -r.quantity;
        cur.amt += type === 'sale' ? -r.quantity * price(r) : -r.quantity * (r.unit_cost || 0);
        m.set(r.product_id, cur);
      });
      const list = [...m.values()].filter((x) => x.qty > 0).sort((a, b) => b.qty - a.qty || b.amt - a.amt).slice(0, 5);
      return list.length ? list.map((x) => `<li><span class="rp-name">${esc(x.name)}</span><span class="rp-val">${nf.format(x.qty)}${esc(x.unit)} · ${won.format(x.amt)}</span></li>`).join('') : '<li class="muted rp-empty">기록 없음</li>';
    };
    $('#rpTopSale').innerHTML = top('sale');
    $('#rpTopUse').innerHTML = top('use');

    // Per designer
    const byDes = new Map();
    rows.filter((r) => r.staff_id && (r.type === 'sale' || r.type === 'use')).forEach((r) => {
      const cur = byDes.get(r.staff_id) || { name: r.staff_name || '—', sales: 0, qty: 0, mat: 0 };
      if (r.type === 'sale') { cur.sales += -r.quantity * price(r); cur.qty += -r.quantity; } else cur.mat += -r.quantity * (r.unit_cost || 0);
      byDes.set(r.staff_id, cur);
    });
    const des = [...byDes.values()].filter((x) => x.sales || x.mat).sort((a, b) => b.sales - a.sales || b.mat - a.mat);
    $('#rpDesigners').innerHTML = des.length
      ? des.map((x) => `<tr><td class="cell-name">${esc(x.name)}</td><td class="num" data-label="제품 판매">${won.format(x.sales)}</td><td class="num" data-label="판매 수량">${nf.format(x.qty)}개</td><td class="num" data-label="재료 사용액">${won.format(x.mat)}</td></tr>`).join('')
      : '<tr><td colspan="4" class="muted rp-empty">담당 디자이너를 고른 기록이 없습니다.</td></tr>';

    // Things to check
    const alerts = [];
    const hasDes = people.some((o) => DESIGNER_POS.includes(o.x.position));
    if (hasDes && onDes === 0) alerts.push({ tone: 'danger', text: '시술 인원이 한 명도 없는 날입니다.', link: '#/schedule', linkText: '근무표' });
    if (d === today) {
      const outs = activeItems().filter((i) => i.status === 'out'), lows = activeItems().filter((i) => i.status === 'low');
      if (outs.length) alerts.push({ tone: 'danger', text: `품절 ${nf.format(outs.length)}개: ${outs.slice(0, 5).map((i) => i.name).join(', ')}${outs.length > 5 ? ' 외' : ''}`, link: '#/inventory', linkText: '재고 목록' });
      if (lows.length) alerts.push({ tone: 'warn', text: `안전재고 이하 ${nf.format(lows.length)}개: ${lows.slice(0, 5).map((i) => i.name).join(', ')}${lows.length > 5 ? ' 외' : ''}`, link: '#/inventory', linkText: '재고 목록' });
    }
    state.rp.people.filter((x) => x.status !== 'left' && x.health_cert_expires && daysUntil(x.health_cert_expires) <= 30).forEach((x) => {
      const n = daysUntil(x.health_cert_expires);
      alerts.push({ tone: n < 0 ? 'danger' : 'warn', text: `${x.name} 보건증 ${n < 0 ? `만료 ${nf.format(-n)}일 지남` : `D-${n}`} (${dateText(x.health_cert_expires)})`, link: '#/staff', linkText: '직원 관리' });
    });
    $('#rpAlerts').innerHTML = alerts.length
      ? alerts.map((a) => `<li class="rp-alert rp-${a.tone}"><span>${esc(a.text)}</span><a href="${a.link}" class="link-btn">${a.linkText}</a></li>`).join('')
      : `<li class="muted rp-empty">확인할 일이 없습니다.${d === today ? '' : ' (재고 알림은 오늘 날짜에서만 보여 줍니다)'}</li>`;

    // 폐기·실사·취소 records
    const notes = rows.filter((r) => r.type === 'dispose' || r.type === 'adjust' || r.reverts_id)
      .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    $('#rpNotes').innerHTML = notes.length
      ? notes.map((r) => `<li><span class="rp-time">${timeFmt.format(new Date(r.created_at))}</span>${r.reverts_id ? '<span class="tag tag-note">취소</span>' : typeTag(r.type)}<span class="rp-name">${esc(r.product_name)}</span><span class="rp-val">${qtyText(r.quantity, r.unit)}</span><small>${esc(whoText(r))}${r.memo ? ` · ${esc(r.memo)}` : ''}</small></li>`).join('')
      : '<li class="muted rp-empty">기록 없음</li>';
  }

  const rpGo = (day) => { state.rp.day = day > todayKey() ? todayKey() : day; loadReport(); };
  $('#rpPrev').addEventListener('click', () => rpGo(addDays(state.rp.day, -1)));
  $('#rpNext').addEventListener('click', () => rpGo(addDays(state.rp.day, 1)));
  $('#rpToday').addEventListener('click', () => rpGo(todayKey()));
  $('#rpPick').addEventListener('change', (e) => { if (e.target.value) rpGo(e.target.value); });
  $('#rpPrint').addEventListener('click', () => window.print());

  // ------------------------------------------------------------------
  // 재료 사용 상세 (시술 사용 기록) for the report day, 7 or 30 days
  // ------------------------------------------------------------------
  state.ru = { period: 'day', q: '', key: '', rows: null, sales: null, loading: false };

  async function loadUse30() {
    const r = state.ru, d = state.rp.day, key = `${state.branch.id}|${d}`;
    if (r.key === key && r.rows) return;
    r.loading = true; r.key = key; r.rows = null;
    renderUseDetail();
    try {
      const from = addDays(d, -29);
      const [rows, sales] = await Promise.all([
        api.listMovementsBetween(state.branch.id, from, d),
        api.listDailySales(state.branch.id, from, d).catch(() => []),
      ]);
      if (r.key !== key) return;
      r.rows = rows; r.sales = sales;
    } catch (ex) {
      if (r.key !== key) return;
      r.rows = []; r.sales = [];
      toast(api.toAppError(ex).message, { error: true });
    }
    r.loading = false;
    renderUseDetail();
  }

  function useWindow() {
    const d = state.rp.day, p = state.ru.period;
    const n = p === 'day' ? 1 : Number(p);
    return { from: addDays(d, -(n - 1)), to: d, n };
  }

  function useData() {
    const w = useWindow(), p = state.ru.period;
    const src = p === '30' ? state.ru.rows || [] : state.rp.all;
    const sales = p === '30' ? state.ru.sales || [] : state.rp.sales;
    const inWin = (k) => k >= w.from && k <= w.to;
    const rows = src.filter((m) => m.type === 'use' && inWin(keyFmt.format(new Date(m.created_at))));
    const live = rows.filter((m) => !m.reverts_id && !m.reverted);
    const svc = sales.filter((s) => inWin(s.day));
    return {
      w, rows, live,
      svc: svc.reduce((a, s) => a + (Number(s.service_sales) || 0), 0),
      cnt: svc.reduce((a, s) => a + (Number(s.service_count) || 0), 0),
      entered: svc.length,
    };
  }
  const useAmt = (m) => -m.quantity * (m.unit_cost || 0);

  function renderUseDetail() {
    const r = state.ru;
    if (r.period === '30' && r.key !== `${state.branch.id}|${state.rp.day}`) { loadUse30(); return; }
    const u = useData(), w = u.w;
    const dot = (k) => k.replace(/-/g, '.');
    $('#ruSub').textContent = r.loading ? '불러오는 중…'
      : `${w.n === 1 ? `${dot(w.to)} (${DOW[dowOf(w.to)]})` : `${dot(w.from)} ~ ${dot(w.to)} · ${w.n}일`} · 매입가 기준 · 취소된 기록은 빼고 계산`;
    const amt = u.live.reduce((a, m) => a + useAmt(m), 0);
    const qty = u.live.reduce((a, m) => a + -m.quantity, 0);
    const kinds = new Set(u.live.map((m) => m.product_id)).size;
    const stat = (label, value, sub, hot) => `<div class="pc-stat${hot ? ' is-hot' : ''}"><span>${label}</span><strong>${value}</strong><small>${sub}</small></div>`;
    $('#ruStats').innerHTML = [
      stat('재료 사용액', won.format(amt), w.n > 1 ? `하루 평균 ${won.format(Math.round(amt / w.n))}` : '보고 있는 날', true),
      stat('사용 건수 · 수량', `${nf.format(u.live.length)}건`, `${nf.format(qty)}개 · ${nf.format(kinds)}개 품목`),
      stat('시술 1건당 재료비', u.cnt ? won.format(Math.round(amt / u.cnt)) : '—', u.cnt ? `시술 ${nf.format(u.cnt)}건 기준` : '시술 건수 미입력'),
      stat('재료비율', u.svc ? `${pct1.format((amt / u.svc) * 100)}%` : '—', u.svc ? `시술 매출 ${won.format(u.svc)} 대비` : '시술 매출 미입력'),
    ].join('');

    // Trend: hours for one day, days otherwise
    drawUseChart(u);

    // By category
    const cat = new Map();
    u.live.forEach((m) => { const c = itemById(m.product_id)?.category || '기타'; cat.set(c, (cat.get(c) || 0) + useAmt(m)); });
    const cats = [...cat].sort((a, b) => b[1] - a[1]);
    const cmax = Math.max(1, ...cats.map((c) => c[1]));
    $('#ruCats').innerHTML = cats.length ? cats.map(([c, v], i) => `<li><div class="sl-bar-top"><span class="sl-rank">${i + 1}</span><span class="rp-name">${esc(c)}</span><span class="rp-val">${amt ? pct1.format((v / amt) * 100) : '0.0'}% · <strong>${won.format(v)}</strong></span></div>
      <span class="sl-bar" aria-hidden="true"><span style="width:${Math.max(2, (v / cmax) * 100).toFixed(1)}%"></span></span></li>`).join('') : '<li class="muted rp-empty">사용 기록이 없습니다.</li>';

    // By designer
    const des = new Map();
    u.live.forEach((m) => {
      const k = m.staff_id || '-';
      const x = des.get(k) || { name: m.staff_id ? m.staff_name || '—' : '담당 미지정', n: 0, amt: 0 };
      x.n += 1; x.amt += useAmt(m);
      des.set(k, x);
    });
    const dl = [...des.values()].sort((a, b) => b.amt - a.amt);
    $('#ruDes').innerHTML = dl.length ? dl.map((x) => `<tr><td class="cell-name">${esc(x.name)}</td><td class="num" data-label="건수">${nf.format(x.n)}건</td><td class="num" data-label="금액">${won.format(x.amt)}</td><td class="num" data-label="비중">${amt ? pct1.format((x.amt / amt) * 100) : '0.0'}%</td></tr>`).join('')
      : '<tr><td colspan="4" class="muted rp-empty">사용 기록이 없습니다.</td></tr>';

    // By product, with how long the stock lasts at this pace
    const items = new Map();
    u.live.forEach((m) => {
      const x = items.get(m.product_id) || { id: m.product_id, name: m.product_name, sku: m.sku, unit: m.unit, qty: 0, n: 0, amt: 0 };
      x.qty += -m.quantity; x.n += 1; x.amt += useAmt(m);
      items.set(m.product_id, x);
    });
    const il = [...items.values()].sort((a, b) => b.amt - a.amt || b.qty - a.qty);
    $('#ruItems').innerHTML = il.length ? il.map((x) => {
      const inv = itemById(x.id);
      const stock = inv ? inv.stock : null;
      const perDay = x.qty / w.n;
      const left = stock == null || perDay <= 0 ? null : stock / perDay;
      const leftText = left == null ? '—' : left < 1 ? '<span class="tag tag-off">1일 미만</span>' : `<span class="${left <= 7 ? 'hq-warn' : ''}">${nf.format(Math.floor(left))}일</span>`;
      return `<tr><td class="cell-name"><div class="item-name">${esc(x.name)}</div><div class="item-sku">${esc(x.sku)}${inv ? ` · ${esc(inv.category)}` : ''}</div></td>
        <td class="num" data-label="사용 수량">${nf.format(x.qty)}${esc(x.unit)}</td>
        <td class="num" data-label="건수">${nf.format(x.n)}건</td>
        <td class="num" data-label="금액"><strong>${won.format(x.amt)}</strong></td>
        <td class="num" data-label="비중">${amt ? pct1.format((x.amt / amt) * 100) : '0.0'}%</td>
        <td class="num" data-label="현재고">${stock == null ? '—' : `${nf.format(stock)}${esc(x.unit)}`}${inv && inv.status !== 'ok' ? ` ${badge(inv.status)}` : ''}</td>
        <td class="num" data-label="남은 일수">${w.n === 1 ? '—' : leftText}</td></tr>`;
    }).join('') : `<tr><td colspan="7" class="muted rp-empty">${r.loading ? '불러오는 중…' : '이 기간에 시술 사용 기록이 없습니다.'}</td></tr>`;

    // Records
    const q = r.q.trim().toLowerCase();
    const log = u.rows.filter((m) => !m.reverts_id && (!q || m.product_name.toLowerCase().includes(q) || (m.staff_name || '').toLowerCase().includes(q)
      || (m.memo || '').toLowerCase().includes(q) || whoText(m).toLowerCase().includes(q)))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const shown = log.slice(0, 200);
    $('#ruLog').innerHTML = shown.length ? shown.map((m) => {
      const d = new Date(m.created_at);
      return `<tr class="${m.reverted ? 'is-reverted' : ''}">
        <td class="cell-name when"><span class="item-name">${esc(m.product_name)}</span><small>${w.n === 1 ? '' : `${dayFmt.format(d)} `}${timeFmt.format(d)} · ${esc(m.sku)}</small></td>
        <td class="num" data-label="수량">${nf.format(-m.quantity)}${esc(m.unit)}</td>
        <td class="num" data-label="매입가">${won.format(m.unit_cost || 0)}</td>
        <td class="num" data-label="금액">${won.format(useAmt(m))}${m.reverted ? ' <span class="tag tag-note">취소됨</span>' : ''}</td>
        <td data-label="담당 · 등록">${m.staff_name ? esc(m.staff_name) : '<span class="muted">미지정</span>'}<small class="mv-staff">등록 ${esc(whoText(m))}</small></td>
        <td data-label="메모"><span class="memo">${esc(m.memo || '—')}</span></td></tr>`;
    }).join('') : `<tr><td colspan="6" class="muted rp-empty">${r.loading ? '불러오는 중…' : q ? '검색 결과가 없습니다.' : '사용 기록이 없습니다.'}</td></tr>`;
    $('#ruFoot').textContent = log.length > 200 ? `최근 200건만 표시합니다 (전체 ${nf.format(log.length)}건은 엑셀로 받을 수 있습니다).` : log.length ? `${nf.format(log.length)}건` : '';
    $('#ruXlsx').disabled = log.length === 0;
  }

  function drawUseChart(u) {
    const box = $('#ruChart');
    const w = u.w, oneDay = w.n === 1;
    let keys;
    if (oneDay) {
      const hrs = u.live.map((m) => Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: TZ }).format(new Date(m.created_at))));
      const lo = Math.min(10, ...hrs), hi = Math.max(20, ...hrs);
      keys = Array.from({ length: hi - lo + 1 }, (_, i) => ({ k: lo + i, label: `${lo + i}시`, v: 0 }));
      u.live.forEach((m, i) => { const b = keys.find((x) => x.k === hrs[i]); if (b) b.v += useAmt(m); });
    } else {
      keys = Array.from({ length: w.n }, (_, i) => { const k = addDays(w.from, i); return { k, label: `${Number(k.slice(5, 7))}/${Number(k.slice(8))}`, long: `${mdText(k)} (${DOW[dowOf(k)]})`, v: 0 }; });
      const idx = new Map(keys.map((x, i) => [x.k, i]));
      u.live.forEach((m) => { const i = idx.get(keyFmt.format(new Date(m.created_at))); if (i != null) keys[i].v += useAmt(m); });
    }
    $('#ruTrendWrap').querySelector('h3').firstChild.textContent = oneDay ? '시간대별 재료 사용액 ' : '일별 재료 사용액 ';
    const W = Math.max(280, Math.round(box.clientWidth || 700)), H = 190;
    const pad = { l: 12, r: 8, t: 10, b: 26 };
    const max = Math.max(1, ...keys.map((x) => x.v));
    const step = niceStep(max / 3), top = Math.ceil(max / step) * step;
    const ticks = []; for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
    pad.l = Math.max(...ticks.map((v) => won.format(v).length)) * 7 + 10;
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const y = (v) => pad.t + ih - (v / top) * ih;
    const slot = iw / keys.length, bw = Math.max(2, Math.min(32, slot * 0.6));
    const every = Math.ceil(keys.length / Math.max(1, Math.floor(iw / 48)));
    const avg = keys.reduce((a, x) => a + x.v, 0) / keys.length;
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${oneDay ? '시간대별' : '일별'} 재료 사용액, 최고 ${won.format(max === 1 ? 0 : max)}" class="${reduceMotion.matches ? '' : 'is-animated'}">
      ${ticks.map((v) => `<line class="rp-grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="${pad.l - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${won.format(v)}</text>`).join('')}
      ${keys.map((x, i) => {
        const h = x.v ? Math.max(2, pad.t + ih - y(x.v)) : 0;
        const cx = pad.l + slot * i + (slot - bw) / 2;
        return `<g>${h ? `<rect class="ru-bar" x="${cx.toFixed(1)}" y="${(pad.t + ih - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(4, bw / 2)}" style="--i:${i}"><title>${esc(x.long || x.label)} · ${won.format(x.v)}</title></rect>` : ''}
          ${i % every === 0 || i === keys.length - 1 ? `<text x="${(pad.l + slot * i + slot / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${x.label}</text>` : ''}</g>`;
      }).join('')}
      ${!oneDay && avg > 0 ? `<line class="ru-avg" x1="${pad.l}" x2="${W - pad.r}" y1="${y(avg).toFixed(1)}" y2="${y(avg).toFixed(1)}"/>` : ''}
    </svg>`;
    box.dataset.w = String(W);
    $('#ruTrendNote').textContent = !oneDay && avg > 0 ? `· 점선: 하루 평균 ${won.format(Math.round(avg))}` : '';
  }
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => {
      const box = $('#ruChart');
      if (box && box.clientWidth && state.route === 'report' && Math.abs(box.clientWidth - Number(box.dataset.w || 0)) > 4) drawUseChart(useData());
    }).observe($('#ruChart'));
  }

  $('#ruPeriod').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ru-period]');
    if (!b) return;
    $$('[data-ru-period]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    state.ru.period = b.dataset.ruPeriod;
    renderUseDetail();
  });
  let ruTimer = 0;
  $('#ruQ').addEventListener('input', (e) => { clearTimeout(ruTimer); ruTimer = setTimeout(() => { state.ru.q = e.target.value; renderUseDetail(); }, 150); });
  $('#rpUseJump').addEventListener('click', () => {
    $('#rpUseDetail').scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
    $('#ruHeading').setAttribute('tabindex', '-1');
    $('#ruHeading').focus({ preventScroll: true });
  });
  $('#ruXlsx').addEventListener('click', () => {
    const u = useData();
    const rows = u.rows.filter((m) => !m.reverts_id).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    if (!rows.length) { toast('내려받을 사용 기록이 없습니다.', { error: true }); return; }
    const stamp = (iso) => { const d = new Date(iso); return `${keyFmt.format(d)} ${timeFmt.format(d)}`; };
    const blob = window.makeXlsx({
      sheetName: '재료 사용',
      columns: [
        { header: '일시', width: 18 }, { header: '품목', width: 30 }, { header: '품목 코드', width: 12 }, { header: '카테고리', width: 13 },
        { header: '수량', width: 8, type: 'number' }, { header: '단위', width: 7 }, { header: '매입가', width: 11, type: 'number' },
        { header: '금액', width: 12, type: 'number' }, { header: '담당 디자이너', width: 13 }, { header: '등록', width: 12 },
        { header: '메모', width: 30 }, { header: '상태', width: 9 },
      ],
      rows: rows.map((m) => [stamp(m.created_at), m.product_name, m.sku, itemById(m.product_id)?.category || '', -m.quantity, m.unit,
        m.unit_cost || 0, useAmt(m), m.staff_name || '', whoText(m), m.memo || '', m.reverted ? '취소됨' : '']),
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `재료사용_${state.branch.name}_${u.w.from}_${u.w.to}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`${nf.format(rows.length)}건을 엑셀 파일로 내려받았습니다.`);
  });

  // Grouped bars: each weekday of the last 7 days next to the same weekday a week before
  function drawReportChart(animate) {
    const box = $('#rpChart');
    const data = state.rp.chart;
    if (!box || !data) return;
    const W = Math.max(280, Math.round(box.clientWidth || 560)), H = 240;
    const pad = { l: 12, r: 12, t: 16, b: 40 };
    const max = Math.max(1, ...data.thisWk.map((x) => x.total), ...data.prevWk.map((x) => x.total));
    const step = niceStep(max / 4), top = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
    // room for the widest tick label
    const labelW = Math.max(...ticks.map((v) => won.format(v).length)) * 7 + 8;
    pad.l = labelW;
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const y = (v) => pad.t + ih - (v / top) * ih;
    const slot = iw / 7, bw = Math.min(26, (slot - 10) / 2), gap = 3;
    const tip = (x, tag) => `${dayLabel(x.day)} ${tag}\n총매출 ${won.format(x.total)}\n시술 매출 ${x.entered ? won.format(x.svc) : '미입력'}${x.entered ? ` (${nf.format(x.cnt)}건)` : ''}\n제품 판매 ${won.format(x.prod)}`;
    const bar = (x, cx, cls, i, tag) => {
      const h = Math.max(x.total ? 2 : 0, pad.t + ih - y(x.total));
      return `<rect class="rp-bar ${cls}${x.entered ? '' : ' is-missing'}" x="${cx.toFixed(1)}" y="${(pad.t + ih - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3" style="--i:${i}"><title>${esc(tip(x, tag))}</title></rect>`;
    };
    const grid = ticks.map((v) => `<line class="rp-grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="${pad.l - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${won.format(v)}</text>`).join('');
    const bars = data.thisWk.map((x, i) => {
      const c = pad.l + slot * i + slot / 2;
      const p = data.prevWk[i];
      const isDay = i === 6;
      return `<g>${bar(p, c - bw - gap / 2, 'rp-bar-prev', i, '(지난주)')}${bar(x, c + gap / 2, 'rp-bar-this', i, '')}
        <text x="${c.toFixed(1)}" y="${H - pad.b + 18}" text-anchor="middle" class="${isDay ? 'rp-x-now' : ''}">${slot < 64 ? `${slot < 44 ? '' : `${Number(x.day.slice(5, 7))}/`}${Number(x.day.slice(8))}` : mdText(x.day)}</text>
        <text x="${c.toFixed(1)}" y="${H - pad.b + 33}" text-anchor="middle" class="rp-x-dow${dowOf(x.day) === 0 ? ' is-sun' : ''}">${DOW[dowOf(x.day)]}</text></g>`;
    }).join('');
    const a = data.thisWk.reduce((s, x) => s + x.total, 0), b = data.prevWk.reduce((s, x) => s + x.total, 0);
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="최근 7일 총매출 ${won.format(a)}, 이전 7일 ${won.format(b)}" class="${animate && !reduceMotion.matches ? 'is-animated' : ''}">${grid}${bars}</svg>`;
    box.dataset.w = String(W);
  }
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => {
      const box = $('#rpChart');
      if (box && state.rp.chart && box.clientWidth && Math.abs(box.clientWidth - Number(box.dataset.w || 0)) > 4) drawReportChart(false);
    }).observe($('#rpChart'));
  }

  // 시술 매출 입력 (the report day)
  const dsDialog = setupDialog($('#dsDialog'));
  const dsForm = $('#dsForm');
  let dsTrigger = null;
  function dsPreview() {
    const s = parseWon($('#dsSales').value), c = Number($('#dsCount').value);
    $('#dsAvg').textContent = Number.isFinite(s) && s > 0 && Number.isInteger(c) && c > 0 ? `객단가 ${won.format(Math.round(s / c))}` : '';
  }
  function openDailySales(trigger) {
    const d = state.rp.day;
    const e = state.rp.sales.find((x) => x.day === d);
    dsTrigger = trigger || null;
    dsForm.reset();
    clearErrors(dsForm);
    $('#dsTitle').textContent = `시술 매출 입력 · ${dayLabel(d)}`;
    $('#dsSales').value = e?.service_sales ? nf.format(e.service_sales) : '';
    $('#dsCount').value = e?.service_count || '';
    $('#dsMemo').value = e?.memo || '';
    dsPreview();
    dsDialog.open();
    $('#dsSales').focus();
  }
  $('#rpSalesBtn').addEventListener('click', (e) => openDailySales(e.currentTarget));
  $('#rpServiceSub').addEventListener('click', (e) => { const b = e.target.closest('[data-ds-open]'); if (b) openDailySales($('#rpSalesBtn')); });
  ['dsSales', 'dsCount'].forEach((id) => $('#' + id).addEventListener('input', dsPreview));
  $('#dsSales').addEventListener('blur', () => { const v = parseWon($('#dsSales').value); if (Number.isFinite(v) && v > 0) $('#dsSales').value = nf.format(v); });
  dsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(dsForm);
    const errors = [];
    const sales = parseWon($('#dsSales').value);
    const cntRaw = $('#dsCount').value.trim(), cnt = cntRaw === '' ? 0 : Number(cntRaw);
    if (!Number.isFinite(sales) || sales < 0 || sales > 1e10) { fieldError($('#dsSales'), '시술 매출은 0 이상의 숫자(원)로 입력해 주세요.'); errors.push({ id: 'dsSales', msg: '시술 매출을 확인해 주세요.' }); }
    if (!Number.isInteger(cnt) || cnt < 0 || cnt > 100000) { fieldError($('#dsCount'), '시술 건수는 0 이상의 정수로 입력해 주세요.'); errors.push({ id: 'dsCount', msg: '시술 건수를 확인해 주세요.' }); }
    if (errors.length) return showSummary(dsForm, errors);
    const btn = $('#dsSubmit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      const d = state.rp.day;
      await api.saveDailySales(state.branch.id, d, { service_sales: sales, service_count: cnt, memo: $('#dsMemo').value });
      $('#dsDialog').close();
      toast(`${dayLabel(d)} 시술 매출을 저장했습니다.`);
      await loadReport();
      if (dsTrigger) dsTrigger.focus();
    } catch (ex) {
      showServerError(dsForm, api.toAppError(ex).message);
    } finally {
      btn.disabled = false; btn.removeAttribute('aria-busy');
    }
  });

  // ------------------------------------------------------------------
  // SNS 홍보: a daily post plan built from the branch's own data (근무표,
  // 판매 내역, 재고, 재료 사용). Anyone at the branch drafts and edits, the
  // branch manager approves, anyone marks 게시 완료 after posting it.
  // ------------------------------------------------------------------
  const SNS_PLATFORM = {
    instagram: { label: '인스타그램', color: 1 },
    facebook: { label: '페이스북', color: 2 },
    tiktok: { label: '틱톡', color: 3 },
    naver: { label: '네이버 플레이스', color: 4 },
  };
  const SNS_FORMAT = { feed: '피드', carousel: '캐러셀', reels: '릴스', story: '스토리', post: '게시물', video: '영상', news: '소식' };
  const SNS_THEME = {
    designer: '디자이너 소개', lineup: '오늘의 라인업', best: '베스트 제품', product: '추천 제품', service: '시술 과정',
    before_after: '시술 전후', store: '매장 소개', tip: '홈케어 팁', booking: '예약 안내',
  };
  const SNS_STATUS = {
    draft: { label: '승인 대기', tag: 'tag-warn' },
    approved: { label: '승인됨', tag: 'tag-sale' },
    rejected: { label: '반려', tag: 'tag-off' },
    posted: { label: '게시 완료', tag: 'tag-receive' },
  };
  const SNS_TONE = { friendly: '친근하게', premium: '고급스럽게', trendy: '트렌디하게' };
  const CONSENT_SCOPE = { photo: '사진', video: '영상', both: '사진·영상' };
  const SVC_TAGS = {
    color: '#염색 #뿌리염색 #염색잘하는곳', perm: '#펌 #볼륨펌 #펌잘하는곳', clinic: '#헤어클리닉 #손상모케어',
    scalp: '#두피케어 #두피스케일링', cut: '#커트 #레이어드컷', styling: '#드라이 #헤어스타일링', updo: '#업스타일 #웨딩헤어',
  };
  const SVC_QUOTE = {
    color: '피부 톤에 맞는 컬러를 함께 찾아 드릴게요.', perm: '손질이 쉬운 자연스러운 컬을 만들어 드려요.',
    cut: '얼굴형에 맞춘 커트로 매일 아침이 편해져요.', clinic: '손상모도 꾸준히 관리하면 다시 건강해져요.',
    scalp: '건강한 모발은 건강한 두피에서 시작해요.', updo: '특별한 날, 가장 빛나는 스타일을 만들어 드려요.',
    styling: '평소에도 쉽게 따라 할 수 있는 스타일링을 알려 드려요.',
  };
  const SVC_TIPS = {
    color: ['염색 컬러 오래 유지하는 법', ['염색 당일에는 샴푸를 쉬어 주세요.', '뜨거운 물 대신 미지근한 물로 헹궈 주세요.', '드라이 전에 에센스를 발라 열로부터 컬러를 지켜 주세요.']],
    perm: ['펌 컬 살리는 드라이법', ['수건으로 비비지 말고 꾹꾹 눌러 물기를 빼 주세요.', '에센스를 바른 뒤 손으로 컬을 말아 쥐어 주세요.', '드라이어는 약한 바람으로 아래에서 위로 말려 주세요.']],
    clinic: ['손상모 홈케어 루틴', ['샴푸 후 트리트먼트는 끝부분 위주로 3분 두었다 헹궈 주세요.', '자기 전 오일을 한두 방울만 발라 주세요.', '고데기는 150도 이하로 짧게 사용하세요.']],
    scalp: ['두피 관리 루틴', ['샴푸는 저녁에, 손끝으로 두피를 마사지하듯 감아 주세요.', '두피부터 완전히 말린 뒤 잠자리에 드세요.', '일주일에 한 번 스케일링 샴푸로 각질을 정리해 주세요.']],
  };
  const catToService = (cat) => (/염|탈색/.test(cat) ? 'color' : /펌/.test(cat) ? 'perm' : /두피/.test(cat) ? 'scalp' : /클리닉|트리트먼트/.test(cat) ? 'clinic' : null);
  const hhmm = (t) => String(t || '').slice(0, 5);
  // 받침 → the first particle form (을/이/과/이에요), otherwise the second
  const josa = (w, withB, without) => { const c = String(w).trim().slice(-1).charCodeAt(0); return `${w}${c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? withB : without}`; };
  const dotDate = (k) => k.replace(/-/g, '.');

  state.sn = { day: '', platform: '', status: '', posts: [], consents: [], settings: null, people: [], sched: [], moves: [], loading: false, ticket: 0, loadedFor: '' };

  async function loadSns() {
    if (!state.branch) return;
    const f = state.sn;
    if (!f.day) f.day = todayKey();
    const bid = state.branch.id, day = f.day;
    const ticket = (f.ticket += 1);
    f.loading = true;
    renderSns();
    try {
      const [settings, posts, consents, people, sched, moves] = await Promise.all([
        api.getSnsSettings(bid),
        api.listSnsPosts(bid, day, day),
        api.listSnsConsents(bid),
        (isManager() ? api.listStaff(bid) : api.listStaffNames(bid)).catch(() => []),
        api.listSchedule(bid, day, addDays(day, 1)).catch(() => []),
        api.listMovementsBetween(bid, addDays(todayKey(), -27), todayKey()).catch(() => []),
      ]);
      if (ticket !== f.ticket) return;
      Object.assign(f, { settings, posts, consents, people, sched, moves, loadedFor: `${bid}|${day}` });
      $('#snError').hidden = true;
      if (day === todayKey()) setSnsBadge(posts);
    } catch (ex) {
      if (ticket !== f.ticket) return;
      Object.assign(f, { posts: [], consents: [], loadedFor: '' });
      $('#snError').textContent = api.toAppError(ex).message;
      $('#snError').hidden = false;
    }
    f.loading = false;
    renderSns();
  }

  // Nav badge: what waits on this person today (managers: 승인 대기, staff: 승인됨 · 게시 전)
  function setSnsBadge(posts) {
    const n = posts.filter((p) => p.status === (isManager() ? 'draft' : 'approved')).length;
    const b = $('#navSnsCount');
    b.textContent = n;
    b.dataset.zero = String(n === 0);
    b.setAttribute('aria-label', `${isManager() ? '승인 대기' : '게시 전'} ${n}개`);
  }
  async function refreshSnsBadge() {
    if (!state.branch) return;
    try { setSnsBadge(await api.listSnsPosts(state.branch.id, todayKey(), todayKey())); } catch (e) { /* SNS tables not installed yet */ }
  }

  // What the branch's own data says about the posting day
  function snsFacts() {
    const f = state.sn, day = f.day;
    const sched = new Map(f.sched.map((r) => [`${r.staff_id}|${r.day}`, r]));
    const designers = (d) => f.people
      .filter((x) => x.status !== 'leave' && DESIGNER_POS.includes(x.position) && workValue(dayState(x, d, sched)) > 0)
      .sort((a, b) => POS_RANK[a.position] - POS_RANK[b.position] || a.name.localeCompare(b.name, 'ko'));
    const working = designers(day), tomorrow = designers(addDays(day, 1));
    const live = f.moves.filter((m) => !m.reverts_id && !m.reverted);
    const sold = new Map();
    live.filter((m) => m.type === 'sale').forEach((m) => {
      const it = itemById(m.product_id);
      if (!it || !it.active || it.stock <= 0) return;
      const x = sold.get(m.product_id) || { item: it, qty: 0 };
      x.qty += -m.quantity;
      sold.set(m.product_id, x);
    });
    const best = [...sold.values()].sort((a, b) => b.qty - a.qty).slice(0, 3);
    const roomy = activeItems().filter((i) => i.is_retail && i.stock > i.safety_stock)
      .sort((a, b) => (b.stock - b.safety_stock) - (a.stock - a.safety_stock));
    const rec = roomy.find((i) => !best.some((x) => x.item.product_id === i.product_id)) || roomy[0] || null;
    const used = new Map();
    live.filter((m) => m.type === 'use').forEach((m) => {
      const cat = itemById(m.product_id)?.category || '';
      const svc = catToService(cat);
      if (!svc) return;
      const x = used.get(svc) || { svc, cat, qty: 0 };
      x.qty += -m.quantity;
      used.set(svc, x);
    });
    const top = [...used.values()].sort((a, b) => b.qty - a.qty)[0] || null;
    const svc = top?.svc || 'color';
    const seed = Math.round(Date.parse(`${day}T00:00:00Z`) / DAY);
    const spotlight = working.length ? working[seed % working.length] : null;
    const svcDesigner = working.find((x) => (x.services || []).includes(svc)) || spotlight;
    return { working, tomorrow, best, rec, svc, top, spotlight, svcDesigner, seed };
  }

  // Branch hashtags: from SNS 설정, otherwise from the branch name and address
  function snsBaseTags() {
    const set = state.sn.settings?.hashtags;
    if (set) return set.trim();
    const b = state.branch;
    const gu = (b.address || '').match(/([가-힣]{1,4})구(?:\s|$)/)?.[1];
    const words = b.name.split(/\s+/).map((w) => w.replace(/(지점|점)$/, '')).filter((w) => w.length >= 2 && !/\d/.test(w));
    const tags = ['#HPlace', `#HPlace${b.name.replace(/\s+/g, '')}`, ...words.map((w) => `#${w}미용실`)];
    if (gu) tags.push(`#${gu}미용실`, `#${gu}헤어샵`);
    return [...new Set(tags)].join(' ');
  }

  // One day's plan, most important first. Each entry is a ready-to-edit draft.
  function snsPlan() {
    const f = state.sn, day = f.day, b = state.branch;
    const facts = snsFacts();
    const tone = f.settings?.tone || 'friendly';
    const t = (o) => o[tone] ?? o.friendly;
    const place = `H Place ${b.name}`;
    const contact = [b.address ? `📍 ${b.address}` : '', b.phone ? `☎ ${b.phone}` : ''].filter(Boolean).join('\n');
    const base = snsBaseTags().split(/\s+/).filter(Boolean);
    const tags = (extra, n = 99) => [...new Set([...base.slice(0, n), ...String(extra || '').split(/\s+/).filter(Boolean)])].join(' ');
    const pos = (x) => POSITIONS[x.position] || '디자이너';
    const svcs = (x) => Object.keys(SERVICES).filter((k) => (x.services || []).includes(k)).map((k) => SERVICES[k]);
    const svcName = SERVICES[facts.svc] || '염색';
    const md = mdText(day), mdT = mdText(addDays(day, 1));
    const lineup = (list) => list.map((x) => `· ${x.name} ${pos(x)}${svcs(x).length ? ` — ${svcs(x).slice(0, 2).join('·')}` : ''}`).join('\n');
    const names = (list) => list.map((x) => `${x.name} ${pos(x)}`).join(', ');
    const out = [];
    const add = (o) => out.push({ day, hashtags: '', shoot_note: '', source_note: '', needs_consent: false, ...o });
    const W = facts.working, S = facts.spotlight, D = facts.svcDesigner, best = facts.best, rec = facts.rec;
    const useSrc = facts.top ? `재료 사용 최근 4주: ${facts.top.cat} ${nf.format(facts.top.qty)}개 사용 (1위)` : '재료 사용 기록이 적어 염색을 기본 주제로 정했습니다';

    // 1 오늘의 라인업 (story)
    if (W.length) {
      add({ platform: 'instagram', format: 'story', theme: 'lineup', slot: '10:00', title: '오늘의 디자이너 라인업',
        caption: t({
          friendly: `오늘 ${place}에서 만날 수 있는 디자이너예요 ✂️\n${lineup(W)}\n\n원하는 디자이너로 예약하세요!\n${contact}`,
          premium: `${place}, 오늘의 디자이너를 소개합니다.\n${lineup(W)}\n\n원하시는 디자이너로 예약해 주세요.\n${contact}`,
          trendy: `오늘 출근 완료 🙌 ${place} 라인업\n${lineup(W)}\n\n자리 있을 때 바로 예약 GO 👉\n${contact}`,
        }),
        hashtags: tags('#오늘의디자이너', 2), shoot_note: '매장 입구나 거울 앞 단체 사진 1장 + 이름 스티커. 예약 링크 스티커를 함께 붙이세요.',
        source_note: `근무표: ${md} 근무 디자이너 ${W.length}명` });
    } else {
      add({ platform: 'instagram', format: 'story', theme: 'booking', slot: '10:00', title: `${mdT} 예약 안내`,
        caption: t({
          friendly: `오늘(${md})은 쉬어 가는 날이에요 🌿\n${facts.tomorrow.length ? `내일 만날 디자이너\n${lineup(facts.tomorrow)}\n\n` : ''}내일 예약은 지금 받고 있어요!\n${contact}`,
          premium: `오늘(${md})은 휴무입니다.\n${facts.tomorrow.length ? `내일 근무 디자이너\n${lineup(facts.tomorrow)}\n\n` : ''}예약은 지금 받고 있습니다.\n${contact}`,
        }),
        hashtags: tags('#미용실예약', 2), shoot_note: '매장 내부 사진 1장 + "내일 예약 가능" 텍스트', source_note: `근무표: ${md} 근무 디자이너 없음` });
    }
    // 2 디자이너 소개 (feed) + 3 페이스북 같은 내용
    if (S) {
      const years = S.hired_on ? Math.floor(dayDiff(S.hired_on, day) / 365) : 0;
      const quote = SVC_QUOTE[(S.services || [])[0]] || '고객님께 꼭 맞는 스타일을 찾아 드릴게요.';
      const body = [svcs(S).length ? `전문 시술: ${svcs(S).join(' · ')}` : '', years >= 1 ? `${josa(place, '과', '와')} 함께한 지 ${years}년째` : ''].filter(Boolean).join('\n');
      const cap = t({
        friendly: `${place}의 ${josa(`${S.name} ${pos(S)}`, '을', '를')} 소개합니다 😊\n\n${body}${body ? '\n\n' : ''}"${quote}"\n\n${S.name} ${pos(S)} 상담·예약은 DM이나 전화로 편하게 문의하세요.\n${contact}`,
        premium: `${place} ${josa(`${S.name} ${pos(S)}`, '을', '를')} 소개합니다.\n\n${body}${body ? '\n\n' : ''}"${quote}"\n\n상담과 예약은 DM 또는 전화로 문의해 주세요.\n${contact}`,
        trendy: `오늘의 디자이너 👉 ${S.name} ${pos(S)}\n\n${body}${body ? '\n\n' : ''}"${quote}"\n\n지금 DM으로 예약 문의 💬\n${contact}`,
      });
      const tg = tags(`#헤어디자이너 #디자이너추천 ${SVC_TAGS[(S.services || [])[0]] || ''}`);
      const shoot = `${S.name} ${pos(S)} 상반신 사진 1장(자연광) + 대표 시술 결과 2장을 여러 장으로 올리기`;
      const src = `근무표: ${md} 근무 · 직원 관리: ${pos(S)}${svcs(S).length ? ', 담당 시술' : ''}`;
      add({ platform: 'instagram', format: 'feed', theme: 'designer', slot: '11:00', title: `디자이너 소개 · ${S.name} ${pos(S)}`, caption: cap, hashtags: tg, shoot_note: shoot, source_note: src });
      out.push({ ...out[out.length - 1], platform: 'facebook', format: 'post', slot: '11:10', hashtags: tags('#헤어디자이너', 3) });
    }
    // 4 네이버 플레이스 소식
    add({ platform: 'naver', format: 'news', theme: 'booking', slot: '09:30', title: `${md} ${place} 예약 안내`,
      caption: t({
        friendly: `안녕하세요, ${place}입니다.\n\n오늘(${md}) 근무 디자이너: ${W.length ? names(W) : '없음 (휴무)'}\n요즘 ${svcName} 시술 문의가 많아요. 원하는 시간이 있다면 미리 예약해 주세요.\n\n${contact}\n네이버 예약으로 원하는 시간을 바로 잡을 수 있어요.`,
        premium: `안녕하세요, ${place}입니다.\n\n오늘(${md}) 근무 디자이너: ${W.length ? names(W) : '없음 (휴무)'}\n최근 ${svcName} 시술 문의가 많아 예약을 권해 드립니다.\n\n${contact}\n네이버 예약으로 편하게 예약하실 수 있습니다.`,
      }),
      shoot_note: '매장 외관 또는 카운터 사진 1장', source_note: `근무표 · ${useSrc}` });
    // 5 추천 제품 (story)
    if (rec) {
      add({ platform: 'instagram', format: 'story', theme: 'product', slot: '13:00', title: `추천 홈케어 · ${rec.name}`,
        caption: t({
          friendly: `시술 후 집에서도 그대로 ✨\n${rec.name}${rec.retail_price ? `\n${won.format(rec.retail_price)}` : ''}\n\n${D ? `${josa(`${D.name} ${pos(D)}`, '이', '가')} 추천하는` : '디자이너가 추천하는'} 홈케어 아이템이에요. 매장에서 바로 구매할 수 있어요.`,
          premium: `시술 후의 컨디션을 집에서도.\n${rec.name}${rec.retail_price ? `\n${won.format(rec.retail_price)}` : ''}\n\n디자이너가 추천하는 홈케어 제품입니다. 매장에서 구매하실 수 있습니다.`,
          trendy: `요즘 디자이너 픽 💛\n${rec.name}${rec.retail_price ? ` · ${won.format(rec.retail_price)}` : ''}\n\n매장에서 바로 GET!`,
        }),
        hashtags: tags('#홈케어추천', 2), shoot_note: '카운터 조명 아래에서 제품을 손에 든 사진 또는 10초 영상',
        source_note: `재고: ${rec.name} ${nf.format(rec.stock)}${rec.unit} (안전재고 ${nf.format(rec.safety_stock)}) — 재고가 넉넉한 판매 제품` });
    }
    // 6 홈케어 팁 (tiktok)
    const [tipTitle, tipSteps] = SVC_TIPS[facts.svc] || SVC_TIPS.color;
    const tipBy = D || S;
    add({ platform: 'tiktok', format: 'video', theme: 'tip', slot: '12:30', title: `${tipBy ? `${tipBy.name} ${pos(tipBy)}의 ` : ''}${tipTitle}`,
      caption: t({
        friendly: `${tipTitle} 💡${tipBy ? ` by ${tipBy.name} ${pos(tipBy)}` : ''}\n${tipSteps.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\n더 궁금한 건 댓글로 물어봐 주세요!`,
        premium: `${tipTitle}${tipBy ? ` — ${tipBy.name} ${pos(tipBy)}` : ''}\n${tipSteps.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\n궁금하신 점은 댓글로 남겨 주세요.`,
        trendy: `이것만 알면 끝 ✅ ${tipTitle}\n${tipSteps.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\n저장해 두고 따라 해 보세요 📌`,
      }),
      hashtags: tags(`#헤어팁 #홈케어 ${SVC_TAGS[facts.svc] || ''}`, 3), shoot_note: '세로 영상 15~30초: 디자이너가 3단계를 직접 시연 (디자이너만 나오게)',
      source_note: useSrc });
    // 7 시술 과정 (reels) — shows a customer
    add({ platform: 'instagram', format: 'reels', theme: 'service', slot: '20:00', title: `${svcName} 시술 과정`, needs_consent: true,
      caption: t({
        friendly: `${svcName} 시술, 처음부터 끝까지 🎬\n${D ? `${D.name} ${pos(D)}의 ` : ''}${svcName} 과정을 담았어요.\n\n요즘 ${place}에서 가장 많이 찾는 시술이에요.\n예약은 프로필 링크 또는 전화로!${b.phone ? `\n☎ ${b.phone}` : ''}`,
        premium: `${svcName} 시술 과정을 소개합니다.\n${D ? `${josa(`${D.name} ${pos(D)}`, '이', '가')} ` : ''}처음부터 완성까지 정성껏 진행합니다.\n\n예약은 프로필 링크 또는 전화로 가능합니다.${b.phone ? `\n☎ ${b.phone}` : ''}`,
        trendy: `${svcName} 과정 풀버전 🎬 끝까지 보세요\n${D ? `by ${D.name} ${pos(D)}\n` : ''}\n요즘 제일 많이 하는 시술 1위!\n예약은 프로필 링크 👆`,
      }),
      hashtags: tags(`#헤어릴스 ${SVC_TAGS[facts.svc] || ''}`), shoot_note: '세로 영상 15~30초: 시술 전 → 과정 2컷 → 완성. 고객이 나오므로 게시 동의를 꼭 연결하세요.',
      source_note: useSrc });
    // 8 비포 애프터 (story) — shows a customer
    add({ platform: 'instagram', format: 'story', theme: 'before_after', slot: '15:00', title: '오늘의 비포 & 애프터', needs_consent: true,
      caption: t({
        friendly: `Before → After ✨\n${svcName}${D ? ` by ${D.name} ${pos(D)}` : ''}\n\n같은 시술이 궁금하면 DM 주세요!`,
        premium: `Before & After\n${svcName}${D ? ` — ${D.name} ${pos(D)}` : ''}\n\n상담은 DM으로 문의해 주세요.`,
      }),
      hashtags: tags('#비포애프터', 2), shoot_note: '같은 각도·같은 조명으로 전후 사진 2장. 얼굴이 나오면 동의서의 "얼굴 노출"을 확인하세요.',
      source_note: useSrc });
    // 9 베스트 제품 (carousel) + 10 페이스북
    if (best.length) {
      const list = best.map((x, i) => `${i + 1}위 ${x.item.name}${x.item.retail_price ? ` · ${won.format(x.item.retail_price)}` : ''}`).join('\n');
      add({ platform: 'instagram', format: 'carousel', theme: 'best', slot: '19:00', title: `이번 달 베스트 홈케어 TOP ${best.length}`,
        caption: t({
          friendly: `${place} 고객님들이 가장 많이 고른 홈케어 🛍️\n\n${list}\n\n매장에서 바로 구매할 수 있어요. 어떤 제품이 맞을지 디자이너에게 편하게 물어보세요!`,
          premium: `${place} 고객님들이 선택한 홈케어 제품입니다.\n\n${list}\n\n매장에서 구매하실 수 있으며, 모발 상태에 맞는 제품을 디자이너가 안내해 드립니다.`,
          trendy: `요즘 제일 잘 나가는 홈케어 TOP ${best.length} 🔥\n\n${list}\n\n품절 전에 매장에서 GET 🛒`,
        }),
        hashtags: tags('#홈케어추천 #헤어에센스 #미용실제품'), shoot_note: `제품 단독 사진 ${best.length}장 + 사용하는 모습 1장 (여러 장으로 올리기)`,
        source_note: `판매 내역 최근 4주: ${best.map((x) => `${x.item.name} ${nf.format(x.qty)}${x.item.unit}`).join(', ')}` });
      out.push({ ...out[out.length - 1], platform: 'facebook', format: 'post', slot: '19:10', hashtags: tags('#홈케어추천', 3) });
    }
    // 11 비포 애프터 숏폼 (tiktok) — shows a customer
    add({ platform: 'tiktok', format: 'video', theme: 'before_after', slot: '20:30', title: `${svcName} 비포 애프터`, needs_consent: true,
      caption: t({
        friendly: `${svcName} 전후 차이 실화? 😮\n${D ? `${D.name} ${pos(D)} 손길로 ` : ''}완성!\n\n${place}`,
        premium: `${svcName} 전후를 비교해 보세요.\n${D ? `${D.name} ${pos(D)} 시술\n` : ''}\n${place}`,
      }),
      hashtags: tags(`#비포애프터 #헤어변신 ${SVC_TAGS[facts.svc] || ''}`, 3), shoot_note: '세로 영상 10~15초: 전 → 손가락 튕기기 전환 → 후',
      source_note: useSrc });
    // 12 내일 예약 안내 (story)
    if (facts.tomorrow.length && W.length) {
      add({ platform: 'instagram', format: 'story', theme: 'booking', slot: '18:00', title: `${mdT} 예약 안내`,
        caption: t({
          friendly: `내일(${mdT}) 근무 디자이너예요 📅\n${lineup(facts.tomorrow)}\n\n원하는 시간 놓치기 전에 지금 예약하세요!\n${contact}`,
          premium: `내일(${mdT}) 근무 디자이너입니다.\n${lineup(facts.tomorrow)}\n\n원하시는 시간에 미리 예약해 주세요.\n${contact}`,
          trendy: `내일 예약 오픈 🔓 ${mdT}\n${lineup(facts.tomorrow)}\n\n빠른 예약 = 원하는 시간 👉\n${contact}`,
        }),
        hashtags: tags('#미용실예약', 2), shoot_note: '예약표 화면 또는 매장 사진 + 예약 링크 스티커', source_note: `근무표: ${mdT} 근무 디자이너 ${facts.tomorrow.length}명` });
    }
    // Extras when the target is higher than 12
    add({ platform: 'instagram', format: 'feed', theme: 'store', slot: '16:00', title: `${place} 매장 소개`,
      caption: t({
        friendly: `편하게 쉬었다 가는 곳, ${josa(place, '이에요', '예요')} 🤍\n\n${contact}`,
        premium: `머무는 시간까지 편안하도록, ${place}.\n\n${contact}`,
      }),
      hashtags: tags('#미용실인테리어 #헤어샵'), shoot_note: '오후 자연광이 들어올 때 매장 전체 사진 1장 + 시술 자리 1장', source_note: '지점 관리: 지점 정보' });
    add({ platform: 'facebook', format: 'video', theme: 'service', slot: '20:10', title: `${svcName} 시술 과정`, needs_consent: true,
      caption: `${svcName} 시술 과정을 영상으로 담았어요.\n${place}${b.phone ? `\n☎ ${b.phone}` : ''}`,
      hashtags: tags(SVC_TAGS[facts.svc] || '', 3), shoot_note: '인스타그램 릴스와 같은 영상을 올리세요.', source_note: useSrc });
    add({ platform: 'instagram', format: 'story', theme: 'tip', slot: '21:00', title: `오늘의 팁 · ${tipTitle}`,
      caption: `${tipTitle} 💡\n${tipSteps[facts.seed % tipSteps.length]}`,
      hashtags: tags('#헤어팁', 2), shoot_note: '틱톡 영상의 한 장면 캡처 + 텍스트', source_note: useSrc });
    if (rec) {
      add({ platform: 'naver', format: 'news', theme: 'product', slot: '17:00', title: `추천 홈케어 · ${rec.name}`,
        caption: `${place}에서 추천하는 홈케어 제품을 소개합니다.\n\n${rec.name}${rec.retail_price ? ` · ${won.format(rec.retail_price)}` : ''}\n시술 후 컨디션을 집에서도 유지할 수 있도록 디자이너가 사용법을 안내해 드립니다.\n\n${contact}`,
        shoot_note: '제품 사진 1장', source_note: `재고: ${rec.name} ${nf.format(rec.stock)}${rec.unit}` });
    }
    return out;
  }

  const snsKey = (p) => `${p.platform}|${p.format}|${p.theme}`;
  const snsTarget = () => state.sn.settings?.daily_target || 12;

  function renderSns() {
    const f = state.sn;
    if (!f.day) f.day = todayKey();
    const today = todayKey();
    $('#snDay').value = f.day;
    $('#snDay').min = addDays(today, -365);
    $('#snDay').max = addDays(today, 60);
    $('#snToday').disabled = f.day === today;
    const posts = f.posts;
    const target = snsTarget();
    const n = posts.length;
    const cnt = (st) => posts.filter((p) => p.status === st).length;
    $('#snGoal').textContent = `${nf.format(n)} / ${nf.format(target)}개`;
    $('#snGoalBar').style.width = `${Math.min(100, (n / target) * 100).toFixed(1)}%`;
    $('#snGoalSub').textContent = f.loading ? '불러오는 중…' : n >= target ? '하루 목표를 채웠어요' : `${nf.format(target - n)}개 더 만들 수 있어요`;
    const needC = posts.filter((p) => p.status !== 'posted' && p.needs_consent && !p.consent_id).length;
    $('#snWait').textContent = `${nf.format(cnt('draft'))}개`;
    $('#snWaitSub').textContent = needC ? `동의 연결 필요 ${nf.format(needC)}개` : cnt('rejected') ? `반려 ${nf.format(cnt('rejected'))}개` : '지점 관리자가 승인합니다';
    $('#snReady').textContent = `${nf.format(cnt('approved'))}개`;
    $('#snReadySub').textContent = cnt('approved') ? '올린 뒤 게시 완료로 표시하세요' : '—';
    $('#snDone').textContent = `${nf.format(cnt('posted'))}개`;
    $('#snDoneSub').textContent = n ? `오늘 계획의 ${Math.round((cnt('posted') / n) * 100)}%` : '—';

    $('#snMix').innerHTML = Object.entries(SNS_PLATFORM).map(([k, v]) => {
      const c = posts.filter((p) => p.platform === k).length;
      return `<li class="sn-mix-item" style="--br: var(--br-${v.color})"><span class="sn-dot" aria-hidden="true"></span>${v.label}<strong>${nf.format(c)}</strong></li>`;
    }).join('');

    // Generate button
    const past = f.day < today, far = f.day > addDays(today, 60);
    const gen = $('#snGenerate');
    gen.disabled = f.loading || past || far || n >= target;
    gen.lastChild.textContent = n ? '초안 더 만들기' : '초안 자동 만들기';
    gen.title = past ? '지난 날짜에는 초안을 만들 수 없습니다.' : n >= target ? '하루 목표만큼 게시물이 있습니다.' : '';

    // List
    const shown = posts.filter((p) => (!f.platform || p.platform === f.platform) && (!f.status || p.status === f.status));
    $('#snCount').textContent = f.loading ? '' : `${nf.format(shown.length)}개${shown.length !== n ? ` / 전체 ${nf.format(n)}개` : ''}`;
    $('#snApproveAll')?.remove();
    const waiting = posts.filter((p) => p.status === 'draft' && !(p.needs_consent && !p.consent_id));
    if (isManager() && waiting.length > 1 && !f.loading) {
      $('#snCount').insertAdjacentHTML('afterend', `<button type="button" class="btn btn-secondary btn-sm" id="snApproveAll">${svgIcon('i-check-circle')}승인 대기 ${nf.format(waiting.length)}개 모두 승인</button>`);
    }
    $('#snEmpty').hidden = f.loading || shown.length > 0;
    if (!shown.length && n) {
      $('#snEmptyTitle').textContent = '조건에 맞는 게시물이 없습니다.';
      $('#snEmptyText').textContent = '플랫폼이나 상태 필터를 바꿔 보세요.';
    } else {
      $('#snEmptyTitle').textContent = past ? '이 날짜에 기록된 게시물이 없습니다.' : '이 날짜의 게시물이 없습니다.';
      $('#snEmptyText').textContent = past ? '지난 날짜에는 초안을 새로 만들 수 없습니다.'
        : `[초안 자동 만들기]를 누르면 근무표·판매·재고·재료 사용 데이터로 하루 ${nf.format(target)}개의 게시물 초안을 만듭니다.`;
    }
    const consent = (id) => f.consents.find((c) => c.id === id);
    $('#snList').innerHTML = shown.map((p) => {
      const pf = SNS_PLATFORM[p.platform];
      const st = SNS_STATUS[p.status];
      const c = p.consent_id ? consent(p.consent_id) : null;
      const needs = p.needs_consent && !p.consent_id && p.status !== 'posted';
      const acts = [];
      acts.push(`<button type="button" class="btn btn-secondary btn-sm" data-sn-copy="${p.id}">${svgIcon('i-copy')}문구 복사</button>`);
      if (p.status !== 'posted') acts.push(`<button type="button" class="btn btn-secondary btn-sm" data-sn-edit="${p.id}">${svgIcon('i-edit')}수정</button>`);
      if (isManager() && ['draft', 'rejected'].includes(p.status)) {
        acts.push(needs
          ? `<button type="button" class="btn btn-secondary btn-sm" data-sn-edit="${p.id}" data-sn-focus="consent">${svgIcon('i-shield')}동의 연결</button>`
          : `<button type="button" class="btn btn-primary btn-sm" data-sn-status="approved" data-sn-id="${p.id}">${svgIcon('i-check-circle')}승인</button>`);
      }
      if (isManager() && ['draft', 'approved'].includes(p.status)) acts.push(`<button type="button" class="btn btn-secondary btn-sm" data-sn-reject="${p.id}">반려</button>`);
      if (isManager() && p.status === 'approved') acts.push(`<button type="button" class="btn btn-secondary btn-sm" data-sn-status="draft" data-sn-id="${p.id}">${svgIcon('i-undo')}승인 취소</button>`);
      if (p.status === 'approved') acts.push(`<button type="button" class="btn btn-primary btn-sm" data-sn-status="posted" data-sn-id="${p.id}">${svgIcon('i-send')}게시 완료</button>`);
      if (['draft', 'rejected'].includes(p.status) || (p.status === 'approved' && isManager())) {
        acts.push(`<button type="button" class="icon-btn sn-del" data-sn-delete="${p.id}" aria-label="${esc(p.title)} 삭제">${svgIcon('i-trash')}</button>`);
      }
      const when = p.status === 'posted' && p.posted_at ? `게시 ${timeFmt.format(new Date(p.posted_at))}`
        : p.status === 'approved' && p.approved_at ? `승인 ${timeFmt.format(new Date(p.approved_at))}` : '';
      return `<li class="sn-post is-${p.status}" style="--br: var(--br-${pf.color})">
        <div class="sn-when"><strong>${esc(hhmm(p.slot))}</strong><span class="sn-dot" aria-hidden="true"></span></div>
        <article class="sn-card" aria-label="${esc(hhmm(p.slot))} ${esc(pf.label)} ${esc(p.title)}">
          <div class="sn-meta">
            <span class="sn-pf">${esc(pf.label)} · ${esc(SNS_FORMAT[p.format] || p.format)}</span>
            <span class="tag tag-note">${esc(SNS_THEME[p.theme] || p.theme)}</span>
            <span class="tag ${st.tag}">${st.label}</span>
            ${needs ? `<span class="tag tag-off">${svgIcon('i-shield')}동의 연결 필요</span>` : c ? `<span class="tag tag-note">${svgIcon('i-shield')}동의 · ${esc(c.customer)}</span>` : ''}
            ${when ? `<span class="muted small">${when}</span>` : ''}
          </div>
          <h3 class="sn-title">${esc(p.title)}</h3>
          <p class="sn-caption">${esc(p.caption)}</p>
          ${p.hashtags ? `<p class="sn-tags">${esc(p.hashtags)}</p>` : ''}
          ${p.status === 'rejected' && p.review_note ? `<p class="sn-review">${svgIcon('i-alert')}반려 사유: ${esc(p.review_note)}</p>` : ''}
          <dl class="sn-notes">
            ${p.shoot_note ? `<div><dt>촬영 가이드</dt><dd>${esc(p.shoot_note)}</dd></div>` : ''}
            ${p.source_note ? `<div><dt>데이터 근거</dt><dd>${esc(p.source_note)}</dd></div>` : ''}
          </dl>
          <div class="sn-acts">${acts.join('')}</div>
        </article>
      </li>`;
    }).join('');
    if (f.loading && !posts.length) $('#snList').innerHTML = '<li class="muted small sn-loading">불러오는 중…</li>';

    renderSnsFacts();
    renderConsents();
  }

  function renderSnsFacts() {
    const f = state.sn;
    if (f.loading && !f.loadedFor) { $('#snFacts').innerHTML = '<li class="muted small">불러오는 중…</li>'; return; }
    const x = snsFacts();
    const pos = (p) => POSITIONS[p.position] || '';
    const fact = (icon, label, value, src) => `<li class="sn-fact">${svgIcon(icon)}<div><span class="sn-fact-label">${label}</span><strong>${value}</strong><small class="muted">${src}</small></div></li>`;
    const items = [
      fact('i-users', `${mdText(f.day)} 근무 디자이너`, x.working.length ? `${esc(x.working.slice(0, 3).map((p) => `${p.name} ${pos(p)}`).join(', '))}${x.working.length > 3 ? ` 외 ${x.working.length - 3}명` : ''}` : '근무하는 디자이너 없음', '근무표 · 정기 휴무 반영'),
      fact('i-receipt', '많이 팔린 판매 제품', x.best.length ? esc(x.best.map((b) => `${b.item.name} ${nf.format(b.qty)}${b.item.unit}`).join(' · ')) : '최근 4주 판매 기록 없음', '판매 내역 최근 4주'),
      fact('i-box', '재고가 넉넉한 추천 제품', x.rec ? `${esc(x.rec.name)} · ${nf.format(x.rec.stock)}${esc(x.rec.unit)}` : '추천할 판매 제품 없음', '재고 목록 · 안전재고보다 많은 판매 제품'),
      fact('i-scissors', '요즘 많이 한 시술', `${SERVICES[x.svc]}${x.top ? ` · ${esc(x.top.cat)} ${nf.format(x.top.qty)}개 사용` : ''}`, '재료 사용 최근 4주'),
      fact('i-megaphone', '하루 목표', `${nf.format(snsTarget())}개 · ${SNS_TONE[f.settings?.tone || 'friendly']}`, isManager() ? 'SNS 설정에서 바꿀 수 있어요' : 'SNS 설정 (지점 관리자)'),
    ];
    $('#snFacts').innerHTML = items.join('');
  }

  const consentState = (c, day) => (c.revoked_at ? 'revoked' : c.expires_on < day ? 'expired' : c.signed_on > day ? 'future' : 'valid');
  function renderConsents() {
    const f = state.sn, today = todayKey();
    const order = { valid: 0, future: 1, expired: 2, revoked: 3 };
    const list = [...f.consents].sort((a, b) => order[consentState(a, today)] - order[consentState(b, today)]);
    if (!list.length) { $('#scList').innerHTML = '<li class="muted small sc-empty">기록된 게시 동의가 없습니다.</li>'; return; }
    $('#scList').innerHTML = list.map((c) => {
      const s = consentState(c, today);
      const tag = s === 'valid' ? '<span class="tag tag-receive">유효</span>' : s === 'expired' ? '<span class="tag tag-note">만료</span>'
        : s === 'revoked' ? '<span class="tag tag-off">철회</span>' : '<span class="tag tag-note">예정</span>';
      return `<li class="sc-item is-${s}">
        <div class="sc-main"><strong>${esc(c.customer)}</strong>${tag}</div>
        <p class="muted small">${CONSENT_SCOPE[c.scope]} · ${c.show_face ? '얼굴 노출 가능' : '얼굴 제외'} · ${dotDate(c.signed_on)} ~ ${dotDate(c.expires_on)}${c.memo ? ` · ${esc(c.memo)}` : ''}</p>
        ${s !== 'revoked' ? `<div class="sc-acts">
          <button type="button" class="link-btn" data-sc-edit="${c.id}">수정</button>
          ${isManager() ? `<button type="button" class="link-btn sc-revoke" data-sc-revoke="${c.id}">철회 기록</button>` : ''}
        </div>` : ''}
      </li>`;
    }).join('');
  }

  // Day navigation & filters
  const snGo = (day) => { state.sn.day = day; loadSns(); };
  $('#snDay').addEventListener('change', (e) => { if (e.target.value) snGo(e.target.value); });
  $('#snPrev').addEventListener('click', () => snGo(addDays(state.sn.day || todayKey(), -1)));
  $('#snNext').addEventListener('click', () => { const n = addDays(state.sn.day || todayKey(), 1); if (n <= addDays(todayKey(), 60)) snGo(n); });
  $('#snToday').addEventListener('click', () => snGo(todayKey()));
  $('#snPlatform').addEventListener('change', (e) => { state.sn.platform = e.target.value; renderSns(); });
  $('#snStatus').addEventListener('change', (e) => { state.sn.status = e.target.value; renderSns(); });

  $('#snGenerate').addEventListener('click', async (e) => {
    const f = state.sn, btn = e.currentTarget;
    const have = new Set(f.posts.map(snsKey));
    const need = snsTarget() - f.posts.length;
    const fresh = snsPlan().filter((p) => !have.has(snsKey(p))).slice(0, Math.max(0, need));
    if (!fresh.length) { toast(need > 0 ? '더 만들 수 있는 새 주제가 없습니다. 직접 수정해서 채워 주세요.' : '이미 하루 목표만큼 게시물이 있습니다.'); return; }
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      const count = await api.addSnsPosts(state.branch.id, fresh);
      toast(`${mdText(f.day)} 게시물 초안 ${nf.format(count)}개를 만들었습니다. 내용을 확인하고 ${isManager() ? '승인해' : '지점 관리자에게 승인을 받아'} 주세요.`);
      await loadSns();
    } catch (ex) {
      toast(api.toAppError(ex).message, { error: true });
    } finally {
      btn.removeAttribute('aria-busy');
      renderSns();
    }
  });

  async function snsSetStatus(id, status, note, trigger) {
    const p = state.sn.posts.find((x) => x.id === id);
    if (!p) return;
    const msg = { approved: '게시물을 승인했습니다.', draft: '게시물 승인을 취소했습니다.', posted: '게시물을 게시 완료로 표시했습니다.', rejected: '게시물을 반려했습니다.' }[status];
    if (trigger) { trigger.disabled = true; trigger.setAttribute('aria-busy', 'true'); }
    try {
      await api.setSnsPostStatus(id, status, note);
      toast(`"${p.title}" ${msg}`);
      await loadSns();
    } catch (ex) {
      toast(api.toAppError(ex).message, { error: true });
      if (trigger && document.contains(trigger)) { trigger.disabled = false; trigger.removeAttribute('aria-busy'); }
    }
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall back below */ }
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }

  $('[data-view="sns"]').addEventListener('click', async (e) => {
    const cp = e.target.closest('[data-sn-copy]');
    if (cp) {
      const p = state.sn.posts.find((x) => x.id === cp.dataset.snCopy);
      const ok = await copyText([p.caption, p.hashtags].filter(Boolean).join('\n\n'));
      toast(ok ? `"${p.title}" 문구와 해시태그를 복사했습니다. ${SNS_PLATFORM[p.platform].label}에 붙여 넣으세요.` : '복사하지 못했습니다. 수정 창에서 직접 선택해 복사해 주세요.', { error: !ok });
      return;
    }
    const ed = e.target.closest('[data-sn-edit]');
    if (ed) return openSnsPost(state.sn.posts.find((x) => x.id === ed.dataset.snEdit), ed.dataset.snFocus);
    const stb = e.target.closest('[data-sn-status]');
    if (stb) return snsSetStatus(stb.dataset.snId, stb.dataset.snStatus, null, stb);
    const rj = e.target.closest('[data-sn-reject]');
    if (rj) return openSnsReject(state.sn.posts.find((x) => x.id === rj.dataset.snReject));
    const del = e.target.closest('[data-sn-delete]');
    if (del) {
      const p = state.sn.posts.find((x) => x.id === del.dataset.snDelete);
      return askConfirm({
        title: '게시물 삭제', text: `${hhmm(p.slot)} ${SNS_PLATFORM[p.platform].label} "${p.title}" 게시물을 삭제할까요?`,
        run: async () => { await api.deleteSnsPost(p.id); toast(`"${p.title}" 게시물을 삭제했습니다.`); await loadSns(); },
      });
    }
    if (e.target.closest('#snApproveAll')) {
      const btn = e.target.closest('#snApproveAll');
      const list = state.sn.posts.filter((p) => p.status === 'draft' && !(p.needs_consent && !p.consent_id));
      btn.disabled = true; btn.setAttribute('aria-busy', 'true');
      let done = 0, fail = '';
      for (const p of list) {
        try { await api.setSnsPostStatus(p.id, 'approved', null); done += 1; } catch (ex) { fail = api.toAppError(ex).message; }
      }
      const left = state.sn.posts.filter((p) => p.status === 'draft' && p.needs_consent && !p.consent_id).length;
      toast(fail ? `${nf.format(done)}개를 승인했고 일부는 승인하지 못했습니다. ${fail}` : `${nf.format(done)}개를 승인했습니다.${left ? ` 동의 연결이 필요한 ${nf.format(left)}개는 남겨 두었습니다.` : ''}`, { error: Boolean(fail) });
      await loadSns();
      return;
    }
    const sce = e.target.closest('[data-sc-edit]');
    if (sce) return openConsent(state.sn.consents.find((c) => c.id === sce.dataset.scEdit));
    const scr = e.target.closest('[data-sc-revoke]');
    if (scr) {
      const c = state.sn.consents.find((x) => x.id === scr.dataset.scRevoke);
      return askConfirm({
        title: '게시 동의 철회 기록', button: '철회 기록',
        text: `${c.customer} 고객의 게시 동의 철회를 기록할까요? 이 동의를 쓰는 승인된 게시물은 다시 승인 대기로 돌아갑니다. 이미 SNS에 올린 게시물은 각 SNS에서 직접 내려야 합니다.`,
        run: async () => {
          const live = await api.revokeSnsConsent(c.id);
          toast(live ? `철회를 기록했습니다. 이 고객이 나온 게시 완료 게시물 ${nf.format(live)}개를 SNS에서 직접 내려 주세요.` : '철회를 기록했습니다.', { error: live > 0 });
          await loadSns();
        },
      });
    }
  });
  $('#scNew').addEventListener('click', () => openConsent(null));
  $('#snSettingsBtn').addEventListener('click', openSnsSettings);

  // Edit a post (with a live preview)
  const snDialog = setupDialog($('#snDialog'));
  const snForm = $('#snForm');
  let snEditing = null;
  function snPreview() {
    const p = snEditing;
    if (!p) return;
    const handle = (state.sn.settings?.handle || `hplace_${state.branch.code || ''}`).replace(/^@/, '');
    $('#snPvHandle').textContent = handle.toLowerCase();
    $('#snPvPlatform').textContent = `${SNS_PLATFORM[p.platform].label} ${SNS_FORMAT[p.format]}`;
    $('#snPvShoot').textContent = $('#snShoot').value.trim() || '사진·영상';
    $('#snPvCaption').textContent = $('#snCaption').value;
    $('#snPvTags').textContent = $('#snTags').value;
    $('#snPvMedia').dataset.format = p.format;
    const len = $('#snCaption').value.length;
    $('#snCaptionHelp').textContent = `${nf.format(len)}자 / 2,200자`;
    const n = ($('#snTags').value.match(/#[^\s#]+/g) || []).length;
    $('#snTagsHelp').textContent = p.platform === 'instagram' && n > 30 ? `해시태그 ${n}개 — 인스타그램은 30개까지만 쓸 수 있어요.` : `해시태그 ${n}개`;
    $('#snTagsHelp').classList.toggle('is-warn', p.platform === 'instagram' && n > 30);
  }
  function openSnsPost(p, focus) {
    if (!p) return;
    snEditing = p;
    snForm.reset();
    clearErrors(snForm);
    $('#snDlgTitle').textContent = p.status === 'approved' && !isManager() ? '게시물 수정 (저장하면 다시 승인 대기)' : '게시물 수정';
    $('#snDlgMeta').innerHTML = `<span class="sn-pf" style="--br: var(--br-${SNS_PLATFORM[p.platform].color})"><span class="sn-dot" aria-hidden="true"></span>${esc(SNS_PLATFORM[p.platform].label)} · ${esc(SNS_FORMAT[p.format])}</span>
      <span class="tag tag-note">${esc(SNS_THEME[p.theme])}</span><span class="tag ${SNS_STATUS[p.status].tag}">${SNS_STATUS[p.status].label}</span><span class="muted small">${esc(dayLabel(p.day))}</span>`;
    $('#snSlot').value = hhmm(p.slot);
    $('#snTitle').value = p.title;
    $('#snCaption').value = p.caption;
    $('#snTags').value = p.hashtags || '';
    $('#snShoot').value = p.shoot_note || '';
    const valid = state.sn.consents.filter((c) => consentState(c, p.day) === 'valid');
    const cur = state.sn.consents.find((c) => c.id === p.consent_id);
    $('#snConsent').innerHTML = `<option value="">${p.needs_consent ? '선택하세요' : '연결 안 함'}</option>`
      + [...valid, ...(cur && !valid.includes(cur) ? [cur] : [])].map((c) => `<option value="${esc(c.id)}">${esc(c.customer)} · ${CONSENT_SCOPE[c.scope]}${c.show_face ? ' · 얼굴 O' : ''} · ~${dotDate(c.expires_on)}</option>`).join('');
    $('#snConsent').value = p.consent_id || '';
    $('#snConsentHelp').textContent = p.needs_consent
      ? `고객이 나오는 게시물이라 승인 전에 게시일(${mdText(p.day)})에 유효한 동의를 연결해야 합니다.${valid.length ? '' : ' 먼저 [고객 게시 동의]에서 동의를 기록하세요.'}`
      : '고객이 나오지 않으면 연결하지 않아도 됩니다.';
    snPreview();
    snDialog.open();
    (focus === 'consent' ? $('#snConsent') : $('#snCaption')).focus();
  }
  ['snCaption', 'snTags', 'snShoot'].forEach((id) => $('#' + id).addEventListener('input', snPreview));
  snForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(snForm);
    const p = snEditing;
    const errors = [];
    const title = $('#snTitle').value.trim(), caption = $('#snCaption').value.trim();
    if (!title) { fieldError($('#snTitle'), '제목을 입력해 주세요.'); errors.push({ id: 'snTitle', msg: '제목을 입력해 주세요.' }); }
    if (!caption) { fieldError($('#snCaption'), '본문을 입력해 주세요.'); errors.push({ id: 'snCaption', msg: '본문을 입력해 주세요.' }); }
    const cid = $('#snConsent').value;
    const c = state.sn.consents.find((x) => x.id === cid);
    if (c && ['reels', 'video'].includes(p.format) && c.scope === 'photo') {
      fieldError($('#snConsent'), '이 동의는 사진만 허용합니다. 영상 게시물에는 영상 동의가 필요합니다.');
      errors.push({ id: 'snConsent', msg: '영상 게시물에 사진 동의가 연결되었습니다.' });
    } else if (c && !['reels', 'video'].includes(p.format) && c.scope === 'video') {
      fieldError($('#snConsent'), '이 동의는 영상만 허용합니다. 사진 게시물에는 사진 동의가 필요합니다.');
      errors.push({ id: 'snConsent', msg: '사진 게시물에 영상 동의가 연결되었습니다.' });
    }
    if (errors.length) return showSummary(snForm, errors);
    const btn = $('#snSubmit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      const status = await api.updateSnsPost(p.id, {
        slot: $('#snSlot').value || null, title, caption, hashtags: $('#snTags').value, shoot_note: $('#snShoot').value, consent_id: cid || null,
      });
      $('#snDialog').close();
      toast(`"${title}" 게시물을 저장했습니다.${status === 'draft' && p.status !== 'draft' ? ' 다시 승인 대기로 바뀌었습니다.' : ''}`);
      await loadSns();
    } catch (ex) {
      showServerError(snForm, api.toAppError(ex).message);
    } finally {
      btn.disabled = false; btn.removeAttribute('aria-busy');
    }
  });

  // Reject with a note
  const snRejectDialog = setupDialog($('#snRejectDialog'));
  let snRejecting = null;
  function openSnsReject(p) {
    snRejecting = p;
    $('#snRejectForm').reset();
    $('#snRejError').hidden = true;
    $('#snRejText').textContent = `${hhmm(p.slot)} ${SNS_PLATFORM[p.platform].label} "${p.title}" 게시물을 작성자에게 돌려보냅니다. 수정해서 저장하면 다시 승인 대기로 올라옵니다.`;
    snRejectDialog.open();
    $('#snRejNote').focus();
  }
  $('#snRejectForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#snRejSubmit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      await api.setSnsPostStatus(snRejecting.id, 'rejected', $('#snRejNote').value);
      $('#snRejectDialog').close();
      toast(`"${snRejecting.title}" 게시물을 반려했습니다.`);
      await loadSns();
    } catch (ex) {
      $('#snRejError').textContent = api.toAppError(ex).message;
      $('#snRejError').hidden = false;
    } finally {
      btn.disabled = false; btn.removeAttribute('aria-busy');
    }
  });

  // 고객 게시 동의
  const scDialog = setupDialog($('#scDialog'));
  const scForm = $('#scForm');
  let scEditing = null;
  function openConsent(c) {
    scEditing = c;
    scForm.reset();
    clearErrors(scForm);
    $('#scTitle').textContent = c ? '게시 동의 수정' : '고객 게시 동의 기록';
    $('#scCustomer').value = c?.customer || '';
    $$('input[name="scScope"]').forEach((r) => { r.checked = r.value === (c?.scope || 'both'); });
    $('#scFace').checked = Boolean(c?.show_face);
    $('#scSigned').value = c?.signed_on || todayKey();
    $('#scSigned').max = todayKey();
    const days = c ? dayDiff(c.signed_on, c.expires_on) : 365;
    $('#scPeriod').value = days <= 190 ? '182' : days <= 400 ? '365' : '730';
    $('#scMemo').value = c?.memo || '';
    scDialog.open();
    $('#scCustomer').focus();
  }
  scForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(scForm);
    const errors = [];
    const customer = $('#scCustomer').value.trim(), signed = $('#scSigned').value;
    if (!customer) { fieldError($('#scCustomer'), '고객을 알아볼 수 있게 입력해 주세요.'); errors.push({ id: 'scCustomer', msg: '고객을 입력해 주세요.' }); }
    else if (/\d{3,4}-?\d{4}$/.test(customer.replace(/\s/g, '')) && /01\d/.test(customer)) { fieldError($('#scCustomer'), '전화번호 전체는 적지 마세요. 뒷번호 4자리만 적습니다.'); errors.push({ id: 'scCustomer', msg: '전화번호 전체가 들어 있습니다.' }); }
    if (!signed) { fieldError($('#scSigned'), '동의일을 골라 주세요.'); errors.push({ id: 'scSigned', msg: '동의일을 골라 주세요.' }); }
    else if (signed > todayKey()) { fieldError($('#scSigned'), '동의일은 오늘이나 그 이전이어야 합니다.'); errors.push({ id: 'scSigned', msg: '동의일을 확인해 주세요.' }); }
    if (errors.length) return showSummary(scForm, errors);
    const btn = $('#scSubmit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      await api.saveSnsConsent(state.branch.id, {
        id: scEditing?.id, customer, scope: $('input[name="scScope"]:checked').value, show_face: $('#scFace').checked,
        signed_on: signed, expires_on: addDays(signed, Number($('#scPeriod').value)), memo: $('#scMemo').value,
      });
      $('#scDialog').close();
      toast(scEditing ? '게시 동의를 수정했습니다.' : `${customer} 고객의 게시 동의를 기록했습니다.`);
      await loadSns();
    } catch (ex) {
      showServerError(scForm, api.toAppError(ex).message);
    } finally {
      btn.disabled = false; btn.removeAttribute('aria-busy');
    }
  });

  // SNS 설정 (managers)
  const snSetDialog = setupDialog($('#snSetDialog'));
  const snSetForm = $('#snSetForm');
  function openSnsSettings() {
    const s = state.sn.settings || {};
    snSetForm.reset();
    clearErrors(snSetForm);
    $('#snSetBranch').textContent = `${state.branch.name}에 적용됩니다. 새로 만드는 초안부터 반영돼요.`;
    $('#snSetHandle').value = s.handle || '';
    $('#snSetTarget').value = s.daily_target || 12;
    $('#snSetTags').value = s.hashtags || '';
    $('#snSetTags').placeholder = `비워 두면: ${snsBaseTagsDefault()}`;
    $$('input[name="snTone"]').forEach((r) => { r.checked = r.value === (s.tone || 'friendly'); });
    snSetDialog.open();
    $('#snSetHandle').focus();
  }
  function snsBaseTagsDefault() {
    const keep = state.sn.settings;
    state.sn.settings = keep ? { ...keep, hashtags: null } : null;
    const tags = snsBaseTags();
    state.sn.settings = keep;
    return tags;
  }
  snSetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(snSetForm);
    const target = Number($('#snSetTarget').value);
    if (!Number.isInteger(target) || target < 1 || target > 30) {
      fieldError($('#snSetTarget'), '하루 목표는 1~30개로 입력해 주세요.');
      return showSummary(snSetForm, [{ id: 'snSetTarget', msg: '하루 목표를 확인해 주세요.' }]);
    }
    const btn = $('#snSetSubmit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      const handle = $('#snSetHandle').value.trim();
      await api.saveSnsSettings(state.branch.id, {
        handle: handle && !handle.startsWith('@') ? `@${handle}` : handle, hashtags: $('#snSetTags').value,
        tone: $('input[name="snTone"]:checked').value, daily_target: target,
      });
      $('#snSetDialog').close();
      toast('SNS 설정을 저장했습니다. 새로 만드는 초안부터 반영됩니다.');
      await loadSns();
    } catch (ex) {
      showServerError(snSetForm, api.toAppError(ex).message);
    } finally {
      btn.disabled = false; btn.removeAttribute('aria-busy');
    }
  });

  // ------------------------------------------------------------------
  // 전체현황 (admin): every branch, one period against the one before
  // ------------------------------------------------------------------
  state.hq = { period: '7', from: '', to: '', data: [], loading: false, ticket: 0 };
  const BRANCH_COLORS = 8;  // --br-1 … --br-8 (validated categorical order); more branches reuse none

  function hqRange() {
    const t = todayKey(), p = state.hq.period;
    if (p === 'month') {
      const from = monthStart(t), pFrom = prevMonthStart(t);
      return { from, to: t, pFrom, pTo: [addDays(pFrom, dayDiff(from, t)), monthEnd(pFrom)].sort()[0], label: '이번 달', prevLabel: '지난달 같은 기간' };
    }
    if (p === 'lastmonth') {
      const from = prevMonthStart(t), pFrom = prevMonthStart(from);
      return { from, to: monthEnd(from), pFrom, pTo: monthEnd(pFrom), label: '지난달', prevLabel: '그 전달' };
    }
    if (p === 'custom') {
      const { from, to } = state.hq;
      const n = dayDiff(from, to) + 1;
      return { from, to, pFrom: addDays(from, -n), pTo: addDays(from, -1), label: '선택한 기간', prevLabel: `이전 ${nf.format(n)}일` };
    }
    const n = Number(p);
    const from = addDays(t, -(n - 1));
    return { from, to: t, pFrom: addDays(from, -n), pTo: addDays(from, -1), label: `최근 ${n}일`, prevLabel: `이전 ${n}일` };
  }

  async function loadHq() {
    if (!isAdmin()) return;
    const h = state.hq, r = hqRange(), today = todayKey();
    const ticket = (h.ticket += 1);
    h.loading = true;
    $('#hqSub').textContent = '전체 지점 자료를 불러오는 중…';
    const branches = state.branches.filter((b) => b.active !== false);
    try {
      const data = await Promise.all(branches.map(async (b, i) => {
        const [inv, mv, sales, staff, sched] = await Promise.all([
          api.listInventory(b.id),
          api.listMovementsBetween(b.id, r.pFrom, r.to),
          api.listDailySales(b.id, r.pFrom, r.to).catch(() => []),
          api.listStaff(b.id).catch(() => []),
          api.listSchedule(b.id, today, today).catch(() => []),
        ]);
        return { b, color: i < BRANCH_COLORS ? `var(--br-${i + 1})` : 'var(--fg-muted)', inv, mv, sales, staff, sched };
      }));
      if (ticket !== h.ticket) return;
      h.data = data;
      $('#hqError').hidden = true;
    } catch (ex) {
      if (ticket !== h.ticket) return;
      h.data = [];
      $('#hqError').textContent = api.toAppError(ex).message;
      $('#hqError').hidden = false;
    }
    h.loading = false;
    renderHq();
  }

  // Per-branch numbers for a date window
  function hqCalc(d, from, to) {
    const inWin = (k) => k >= from && k <= to;
    const byDay = new Map();
    const dayRow = (k) => { if (!byDay.has(k)) byDay.set(k, { svc: 0, prod: 0 }); return byDay.get(k); };
    const price = (m) => m.unit_price ?? d.inv.find((i) => i.product_id === m.product_id)?.retail_price ?? 0;
    let svc = 0, cnt = 0, prod = 0, prodN = 0, mat = 0, entered = 0;
    const products = new Map();
    d.sales.forEach((s) => {
      if (!inWin(s.day)) return;
      svc += Number(s.service_sales) || 0; cnt += Number(s.service_count) || 0; entered += 1;
      dayRow(s.day).svc += Number(s.service_sales) || 0;
    });
    d.mv.forEach((m) => {
      const k = keyFmt.format(new Date(m.created_at));
      if (!inWin(k)) return;
      if (m.type === 'sale') {
        const amt = -m.quantity * price(m);
        prod += amt; dayRow(k).prod += amt;
        if (!m.reverts_id && !m.reverted) prodN += 1;
        const p = products.get(m.sku) || { name: m.product_name, unit: m.unit, qty: 0, amt: 0 };
        p.qty += -m.quantity; p.amt += amt;
        products.set(m.sku, p);
      } else if (m.type === 'use') mat += -m.quantity * (m.unit_cost || 0);
    });
    return { svc, cnt, prod, prodN, mat, total: svc + prod, entered, avg: cnt ? svc / cnt : 0, ratio: svc ? (mat / svc) * 100 : null, byDay, products };
  }

  function renderHq() {
    const h = state.hq, r = hqRange(), today = todayKey();
    const dot = (k) => k.replace(/-/g, '.');
    const days = dayDiff(r.from, r.to) + 1;
    $('#hqSub').textContent = `${r.label} ${dot(r.from)} ~ ${dot(r.to)} · 비교 기준: ${r.prevLabel} ${dot(r.pFrom)} ~ ${dot(r.pTo)} · 운영 중 지점 ${nf.format(h.data.length)}곳`;
    const rows = h.data.map((d) => {
      const cur = hqCalc(d, r.from, r.to), prev = hqCalc(d, r.pFrom, r.pTo);
      const items = d.inv.filter((i) => i.active);
      const sched = new Map(d.sched.map((x) => [`${x.staff_id}|${x.day}`, x]));
      const people = d.staff.filter((x) => x.status !== 'leave').map((x) => ({ x, st: dayState(x, today, sched) })).filter((o) => o.st !== 'na');
      const on = people.filter((o) => workValue(o.st) > 0);
      return {
        ...d, cur, prev,
        stock: items.reduce((a, i) => a + i.stock * i.cost_price, 0), itemN: items.length,
        low: items.filter((i) => i.status === 'low'), out: items.filter((i) => i.status === 'out'),
        staffN: d.staff.filter((x) => x.status === 'active').length, on: on.length,
        onDes: on.filter((o) => DESIGNER_POS.includes(o.x.position)).length, off: people.length - on.length,
        certs: d.staff.filter((x) => x.status !== 'left' && x.health_cert_expires && daysUntil(x.health_cert_expires) <= 30),
        // days that should have a 시술 매출 entry (up to yesterday; today may still be open)
        due: Math.max(0, dayDiff(r.from, [r.to, addDays(today, -1)].sort()[0]) + 1),
      };
    });
    const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);
    const T = {
      total: sum(rows, (x) => x.cur.total), pTotal: sum(rows, (x) => x.prev.total),
      svc: sum(rows, (x) => x.cur.svc), pSvc: sum(rows, (x) => x.prev.svc),
      cnt: sum(rows, (x) => x.cur.cnt), pCnt: sum(rows, (x) => x.prev.cnt),
      prod: sum(rows, (x) => x.cur.prod), pProd: sum(rows, (x) => x.prev.prod),
      prodN: sum(rows, (x) => x.cur.prodN),
      mat: sum(rows, (x) => x.cur.mat), pMat: sum(rows, (x) => x.prev.mat),
      stock: sum(rows, (x) => x.stock), itemN: sum(rows, (x) => x.itemN),
      low: sum(rows, (x) => x.low.length), out: sum(rows, (x) => x.out.length),
      staffN: sum(rows, (x) => x.staffN), on: sum(rows, (x) => x.on), onDes: sum(rows, (x) => x.onDes), off: sum(rows, (x) => x.off),
      entered: sum(rows, (x) => x.cur.entered), due: sum(rows, (x) => Math.min(x.due, days)),
    };
    const ratio = T.svc ? (T.mat / T.svc) * 100 : null, pRatio = T.pSvc ? (T.pMat / T.pSvc) * 100 : null;
    const vs = `${r.prevLabel} 대비`;
    $('#hqTotal').textContent = won.format(T.total);
    $('#hqTotalSub').textContent = `${r.prevLabel} ${won.format(T.pTotal)} · 하루 평균 ${won.format(Math.round(T.total / days))}`;
    setDelta('hqTotalDelta', deltaHtml(T.total, T.pTotal), vs);
    $('#hqSvc').textContent = won.format(T.svc);
    $('#hqSvcSub').textContent = `${nf.format(T.cnt)}건 · 객단가 ${T.cnt ? won.format(Math.round(T.svc / T.cnt)) : '—'}`;
    setDelta('hqSvcDelta', deltaHtml(T.svc, T.pSvc), vs);
    $('#hqProd').textContent = won.format(T.prod);
    $('#hqProdSub').textContent = `${nf.format(T.prodN)}건 · 총매출의 ${T.total ? pct1.format((T.prod / T.total) * 100) : '0.0'}%`;
    setDelta('hqProdDelta', deltaHtml(T.prod, T.pProd), vs);
    $('#hqRatio').textContent = ratio == null ? '—' : `${pct1.format(ratio)}%`;
    $('#hqRatioSub').textContent = `재료 사용액 ${won.format(T.mat)}`;
    setDelta('hqRatioDelta', deltaHtml(ratio, pRatio, { costly: true, pp: true }), vs);
    $('#hqStock').textContent = won.format(T.stock);
    $('#hqStockSub').textContent = `${nf.format(T.itemN)}개 품목 · 매입가 기준 · 오늘`;
    $('#hqWarn').innerHTML = `${nf.format(T.low + T.out)}<small>개</small>`;
    $('#hqWarnSub').textContent = `부족 ${nf.format(T.low)} · 품절 ${nf.format(T.out)}`;
    $('#hqWork').textContent = `${nf.format(T.on)}명`;
    $('#hqWorkSub').textContent = `시술 ${nf.format(T.onDes)} · 스태프 ${nf.format(T.on - T.onDes)} · 휴무 ${nf.format(T.off)} · 재직 ${nf.format(T.staffN)}`;
    const entered = Math.min(T.entered, T.due);
    $('#hqEntry').innerHTML = T.due ? `${pct1.format((entered / T.due) * 100)}<small>%</small>` : '—';
    const perBranch = rows.length ? Math.min(rows[0].due, days) : 0;
    const missingN = rows.filter((x) => Math.min(x.due, days) > x.cur.entered).length;
    $('#hqEntrySub').textContent = T.due
      ? `입력 ${nf.format(entered)}건 / ${nf.format(T.due)}건 (${nf.format(rows.length)}개 지점 × ${nf.format(perBranch)}일)${r.to >= today ? ' · 오늘 제외' : ''}${missingN ? ` · 빠진 날이 있는 지점 ${nf.format(missingN)}곳` : ' · 모두 입력'}`
      : '입력할 날이 아직 없습니다 (오늘은 제외)';

    // Legend (a single branch needs none)
    $('#hqLegend').innerHTML = rows.length > 1 ? rows.map((x) => `<li><i style="background:${x.color}"></i>${esc(x.b.name)}</li>`).join('') : '';
    h.chart = { rows, from: r.from, days };
    drawHqChart(true);

    // Branch table, biggest first
    const sorted = [...rows].sort((a, b) => b.cur.total - a.cur.total);
    const pctText = (v) => (v == null ? '—' : `${pct1.format(v)}%`);
    const entry = (x) => { const due = Math.min(x.due, days); return due ? `${nf.format(Math.min(x.cur.entered, due))}/${nf.format(due)}일` : '—'; };
    $('#hqBody').innerHTML = sorted.length ? sorted.map((x) => {
      const share = T.total ? (x.cur.total / T.total) * 100 : 0;
      const missing = Math.min(x.due, days) - x.cur.entered;
      return `<tr>
        <th scope="row" class="cell-name"><button type="button" class="link-btn hq-branch" data-hq-branch="${x.b.id}"><i class="hq-dot" style="background:${x.color}" aria-hidden="true"></i>${esc(x.b.name)}</button></th>
        <td class="num" data-label="총매출"><strong>${won.format(x.cur.total)}</strong></td>
        <td class="num" data-label="이전 대비">${deltaHtml(x.cur.total, x.prev.total).html}</td>
        <td class="num" data-label="매출 비중"><span class="hq-share"><span class="hq-share-bar" aria-hidden="true"><span style="width:${share.toFixed(1)}%;background:${x.color}"></span></span>${pct1.format(share)}%</span></td>
        <td class="num" data-label="시술 매출">${won.format(x.cur.svc)}</td>
        <td class="num" data-label="시술 건수">${nf.format(x.cur.cnt)}건</td>
        <td class="num" data-label="객단가">${x.cur.cnt ? won.format(Math.round(x.cur.avg)) : '—'}</td>
        <td class="num" data-label="제품 판매">${won.format(x.cur.prod)}</td>
        <td class="num" data-label="재료비율">${pctText(x.cur.ratio)}</td>
        <td class="num" data-label="재고 금액">${won.format(x.stock)}</td>
        <td class="num" data-label="부족·품절">${x.low.length + x.out.length ? `<span class="hq-warn">${nf.format(x.low.length)} · ${nf.format(x.out.length)}</span>` : '0 · 0'}</td>
        <td class="num" data-label="오늘 근무">${nf.format(x.on)}/${nf.format(x.staffN)}명</td>
        <td class="num" data-label="매출 입력"><span class="${missing > 0 ? 'hq-warn' : ''}">${entry(x)}</span></td>
      </tr>`;
    }).join('') : `<tr><td colspan="13" class="muted rp-empty">${h.loading ? '불러오는 중…' : '운영 중인 지점이 없습니다.'}</td></tr>`;
    $('#hqFoot').innerHTML = rows.length > 1 ? `<tr class="hq-total-row">
      <th scope="row" class="cell-name">전체</th>
      <td class="num" data-label="총매출"><strong>${won.format(T.total)}</strong></td>
      <td class="num" data-label="이전 대비">${deltaHtml(T.total, T.pTotal).html}</td>
      <td class="num" data-label="매출 비중">100%</td>
      <td class="num" data-label="시술 매출">${won.format(T.svc)}</td>
      <td class="num" data-label="시술 건수">${nf.format(T.cnt)}건</td>
      <td class="num" data-label="객단가">${T.cnt ? won.format(Math.round(T.svc / T.cnt)) : '—'}</td>
      <td class="num" data-label="제품 판매">${won.format(T.prod)}</td>
      <td class="num" data-label="재료비율">${pctText(ratio)}</td>
      <td class="num" data-label="재고 금액">${won.format(T.stock)}</td>
      <td class="num" data-label="부족·품절">${nf.format(T.low)} · ${nf.format(T.out)}</td>
      <td class="num" data-label="오늘 근무">${nf.format(T.on)}/${nf.format(T.staffN)}명</td>
      <td class="num" data-label="매출 입력">${T.due ? `${nf.format(Math.min(T.entered, T.due))}/${nf.format(T.due)}일` : '—'}</td>
    </tr>` : '';

    // Best sellers across branches (same code = same product)
    const top = new Map();
    rows.forEach((x) => x.cur.products.forEach((p, sku) => {
      const t = top.get(sku) || { name: p.name, unit: p.unit, qty: 0, amt: 0, branches: new Set() };
      t.qty += p.qty; t.amt += p.amt; if (p.qty > 0) t.branches.add(x.b.name);
      top.set(sku, t);
    }));
    const list = [...top.values()].filter((x) => x.amt > 0).sort((a, b) => b.amt - a.amt).slice(0, 10);
    const max = Math.max(1, ...list.map((x) => x.amt));
    $('#hqTop').innerHTML = list.length ? list.map((x, i) => `<li><div class="sl-bar-top"><span class="sl-rank">${i + 1}</span><span class="rp-name">${esc(x.name)}</span><span class="rp-val">${nf.format(x.qty)}${esc(x.unit)} · ${nf.format(x.branches.size)}개 지점 · <strong>${won.format(x.amt)}</strong></span></div>
      <span class="sl-bar" aria-hidden="true"><span style="width:${Math.max(2, (x.amt / max) * 100).toFixed(1)}%"></span></span></li>`).join('')
      : '<li class="muted rp-empty">이 기간에 판매 기록이 없습니다.</li>';

    // Things to look at, most urgent first
    const alerts = [];
    rows.forEach((x) => {
      const n = x.b.name;
      if (x.out.length) alerts.push({ tone: 'danger', text: `${n} · 품절 ${nf.format(x.out.length)}개: ${x.out.slice(0, 3).map((i) => i.name).join(', ')}${x.out.length > 3 ? ' 외' : ''}`, id: x.b.id, to: 'inventory', link: '재고 목록' });
      const miss = Math.min(x.due, days) - x.cur.entered;
      if (miss > 0) alerts.push({ tone: 'warn', text: `${n} · 시술 매출 미입력 ${nf.format(miss)}일`, id: x.b.id, to: 'report', link: '매장 레포트' });
      if (x.low.length) alerts.push({ tone: 'warn', text: `${n} · 안전재고 이하 ${nf.format(x.low.length)}개`, id: x.b.id, to: 'inventory', link: '재고 목록' });
      if (x.cur.ratio != null && ratio != null && x.cur.ratio > ratio * 1.3 && x.cur.ratio - ratio >= 2) alerts.push({ tone: 'warn', text: `${n} · 재료비율 ${pct1.format(x.cur.ratio)}% (전체 평균 ${pct1.format(ratio)}%보다 높음)`, id: x.b.id, to: 'report', link: '매장 레포트' });
      if (x.prev.total > 0 && x.cur.total < x.prev.total * 0.8) alerts.push({ tone: 'warn', text: `${n} · 총매출 ${pct1.format((1 - x.cur.total / x.prev.total) * 100)}% 감소 (${r.prevLabel} 대비)`, id: x.b.id, to: 'report', link: '매장 레포트' });
      x.certs.forEach((s) => {
        const dd = daysUntil(s.health_cert_expires);
        alerts.push({ tone: dd < 0 ? 'danger' : 'warn', text: `${n} · ${s.name} 보건증 ${dd < 0 ? `만료 ${nf.format(-dd)}일 지남` : `D-${dd}`}`, id: x.b.id, to: 'staff', link: '직원 관리' });
      });
      if (x.staffN && x.onDes === 0 && x.staff.some((s) => DESIGNER_POS.includes(s.position) && s.status === 'active')) alerts.push({ tone: 'danger', text: `${n} · 오늘 시술 인원이 없습니다`, id: x.b.id, to: 'schedule', link: '근무표' });
    });
    alerts.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'danger' ? -1 : 1));
    $('#hqAlerts').innerHTML = alerts.length
      ? alerts.slice(0, 12).map((a) => `<li class="rp-alert rp-${a.tone}"><span>${esc(a.text)}</span><button type="button" class="link-btn" data-hq-branch="${a.id}" data-hq-to="${a.to}">${a.link}</button></li>`).join('')
        + (alerts.length > 12 ? `<li class="muted small">외 ${nf.format(alerts.length - 12)}건</li>` : '')
      : `<li class="muted rp-empty">${h.loading ? '불러오는 중…' : '모든 지점이 정상입니다.'}</li>`;
  }

  // Stacked bars: one column per day, one segment per branch (2px surface gap)
  function drawHqChart(animate) {
    const box = $('#hqChart'), c = state.hq.chart;
    if (!box || !c) return;
    const W = Math.max(300, Math.round(box.clientWidth || 800)), H = 260;
    const pad = { l: 12, r: 8, t: 12, b: 30 };
    const keys = hqBuckets(c.from, c.days);
    const valueOf = (x, k) => k.days.reduce((a, day) => { const d = x.cur.byDay.get(day); return a + (d ? d.svc + d.prod : 0); }, 0);
    const totals = keys.map((k) => c.rows.reduce((a, x) => a + valueOf(x, k), 0));
    const max = Math.max(1, ...totals);
    const step = niceStep(max / 4), top = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
    pad.l = Math.max(...ticks.map((v) => won.format(v).length)) * 7 + 10;
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const y = (v) => pad.t + ih - (v / top) * ih;
    const slot = iw / keys.length, bw = Math.max(1, Math.min(44, slot * 0.56));
    const every = Math.ceil(keys.length / Math.max(1, Math.floor(iw / 64)));
    const grid = ticks.map((v) => `<line class="rp-grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="${pad.l - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${won.format(v)}</text>`).join('');
    const cols = keys.map((k, i) => {
      const cx = pad.l + slot * i + (slot - bw) / 2;
      let acc = 0;
      const segs = c.rows.map((x) => ({ x, v: Math.max(0, valueOf(x, k)) })).filter((s) => s.v > 0);
      const rects = segs.map((s, j) => {
        const y0 = y(acc), y1 = y(acc + s.v);
        acc += s.v;
        const hgt = Math.max(1, y0 - y1 - (j > 0 && bw >= 4 ? 2 : 0));  // 2px surface gap under each upper segment
        return `<rect class="hq-seg" x="${cx.toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${hgt.toFixed(1)}" rx="${j === segs.length - 1 ? Math.min(4, bw / 2) : 0}" style="fill:${s.x.color};--i:${i}"/>`;
      }).join('');
      const label = i % every === 0 || i === keys.length - 1
        ? `<text x="${(pad.l + slot * i + slot / 2).toFixed(1)}" y="${H - 10}" text-anchor="middle" class="${k.days.includes(todayKey()) ? 'rp-x-now' : ''}">${k.short}</text>` : '';
      return `<g>${rects}${label}<rect class="hq-hit" data-hq-day="${i}" x="${(pad.l + slot * i).toFixed(1)}" y="${pad.t}" width="${slot.toFixed(1)}" height="${ih}"/></g>`;
    }).join('');
    const total = totals.reduce((a, b) => a + b, 0);
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${nf.format(c.days)}일간 전체 총매출 ${won.format(total)}. 지점별 수치는 아래 지점별 성과 표에 있습니다." class="${animate && !reduceMotion.matches ? 'is-animated' : ''}">${grid}${cols}</svg>`;
    box.dataset.w = String(W);
    c.keys = keys; c.totals = totals; c.valueOf = valueOf;
    $('#hqTrendHeading').textContent = `${keys[0]?.unit || '일별'} 총매출 · 지점별`;
  }

  // Chart columns: days up to 2 months, weeks up to ~7 months, months beyond
  function hqBuckets(from, days) {
    const all = Array.from({ length: days }, (_, i) => addDays(from, i));
    const md = (k) => `${Number(k.slice(5, 7))}/${Number(k.slice(8))}`;
    if (days <= 62) return all.map((k) => ({ days: [k], short: md(k), long: `${mdText(k)} (${DOW[dowOf(k)]})`, unit: '일별' }));
    if (days <= 210) {
      const out = [];
      for (let i = 0; i < all.length; i += 7) {
        const d = all.slice(i, i + 7);
        out.push({ days: d, short: md(d[0]), long: `${mdText(d[0])} ~ ${mdText(d[d.length - 1])}`, unit: '주별' });
      }
      return out;
    }
    const byMonth = new Map();
    all.forEach((k) => { const m = k.slice(0, 7); if (!byMonth.has(m)) byMonth.set(m, []); byMonth.get(m).push(k); });
    const years = new Set(all.map((k) => k.slice(0, 4))).size > 1;
    return [...byMonth].map(([m, d]) => ({
      days: d, unit: '월별',
      short: years ? `${m.slice(2, 4)}.${Number(m.slice(5))}` : `${Number(m.slice(5))}월`,
      long: `${m.slice(0, 4)}년 ${Number(m.slice(5))}월${d.length < Number(monthEnd(d[0]).slice(8)) ? ` (${Number(d[0].slice(8))}일~${Number(d[d.length - 1].slice(8))}일)` : ''}`,
    }));
  }

  // Hover: that day's total and each branch
  $('#hqChart').addEventListener('mousemove', (e) => {
    const hit = e.target.closest('[data-hq-day]');
    const tip = $('#hqTip'), c = state.hq.chart;
    $$('.hq-hit.is-on', $('#hqChart')).forEach((r) => r.classList.remove('is-on'));
    if (!hit || !c) { tip.hidden = true; return; }
    hit.classList.add('is-on');
    const i = Number(hit.dataset.hqDay), k = c.keys[i];
    const lines = c.rows.map((x) => ({ x, v: c.valueOf(x, k) })).sort((a, b) => b.v - a.v);
    tip.innerHTML = `<strong>${k.long} · ${won.format(c.totals[i])}</strong>`
      + lines.map((l) => `<span><i style="background:${l.x.color}"></i>${esc(l.x.b.name)}<b>${won.format(l.v)}</b></span>`).join('');
    tip.hidden = false;
    const panel = $('.hq-trend').getBoundingClientRect();
    const hr = hit.getBoundingClientRect();
    const left = hr.left - panel.left + hr.width / 2;
    tip.style.left = `${Math.min(Math.max(left, 110), panel.width - 110)}px`;
    tip.style.top = `${hr.top - panel.top + 8}px`;
  });
  $('#hqChart').addEventListener('mouseleave', () => { $('#hqTip').hidden = true; $$('.hq-hit.is-on', $('#hqChart')).forEach((r) => r.classList.remove('is-on')); });
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => {
      const box = $('#hqChart');
      if (box && state.hq.chart && box.clientWidth && Math.abs(box.clientWidth - Number(box.dataset.w || 0)) > 4) drawHqChart(false);
    }).observe($('#hqChart'));
  }

  $('#hqPeriod').addEventListener('click', (e) => {
    const b = e.target.closest('[data-hq-period]');
    if (!b) return;
    $$('[data-hq-period]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    const h = state.hq;
    h.period = b.dataset.hqPeriod;
    const custom = h.period === 'custom';
    $('#hqRange').hidden = !custom;
    if (custom) {
      if (!h.from) { h.to = todayKey(); h.from = addDays(h.to, -29); }
      $('#hqFrom').value = h.from; $('#hqTo').value = h.to;
      $('#hqFrom').max = $('#hqTo').max = todayKey();
      $('#hqFrom').focus();
    }
    loadHq();
  });
  // 기간 직접 설정: up to one year, compared with the same length just before
  ['hqFrom', 'hqTo'].forEach((id) => $('#' + id).addEventListener('change', () => {
    const from = $('#hqFrom').value, to = $('#hqTo').value, err = $('#hqRangeErr');
    let msg = '';
    if (!from || !to) msg = '시작일과 종료일을 모두 골라 주세요.';
    else if (from > to) msg = '시작일이 종료일보다 늦습니다.';
    else if (dayDiff(from, to) + 1 > 366) msg = '한 번에 최대 1년(366일)까지 조회할 수 있습니다.';
    else if (to > todayKey()) msg = '종료일은 오늘까지 고를 수 있습니다.';
    err.textContent = msg; err.hidden = !msg;
    [$('#hqFrom'), $('#hqTo')].forEach((el) => el.toggleAttribute('aria-invalid', Boolean(msg)));
    if (msg) return;
    Object.assign(state.hq, { from, to });
    loadHq();
  }));
  // Jump into one branch
  $('[data-view="hq"]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-hq-branch]');
    if (!b) return;
    const br = state.branches.find((x) => x.id === b.dataset.hqBranch);
    if (!br) return;
    if (state.branch.id !== br.id) {
      state.branch = br;
      $('#branchSelect').value = br.id;
      try { localStorage.setItem('hp-branch', br.id); } catch (err) {}
      loadData();
    }
    location.hash = `#/${b.dataset.hqTo || 'report'}`;
  });
  $('#hqPrint').addEventListener('click', () => window.print());
  $('#hqXlsx').addEventListener('click', () => {
    const c = state.hq.chart;
    if (!c || !c.rows.length) { toast('내려받을 자료가 없습니다.', { error: true }); return; }
    const r = hqRange();
    const blob = window.makeXlsx({
      sheetName: '지점별 성과',
      columns: [
        { header: '지점', width: 16 }, { header: '총매출', width: 14, type: 'number' }, { header: `${r.prevLabel} 총매출`, width: 16, type: 'number' },
        { header: '시술 매출', width: 14, type: 'number' }, { header: '시술 건수', width: 10, type: 'number' }, { header: '객단가', width: 12, type: 'number' },
        { header: '제품 판매', width: 13, type: 'number' }, { header: '재료 사용액', width: 13, type: 'number' }, { header: '재료비율(%)', width: 11, type: 'number' },
        { header: '재고 금액', width: 14, type: 'number' }, { header: '부족', width: 7, type: 'number' }, { header: '품절', width: 7, type: 'number' },
        { header: '재직 직원', width: 9, type: 'number' }, { header: '시술 매출 입력일', width: 14, type: 'number' },
      ],
      rows: c.rows.map((x) => [
        x.b.name, x.cur.total, x.prev.total, x.cur.svc, x.cur.cnt, Math.round(x.cur.avg), x.cur.prod, Math.round(x.cur.mat),
        x.cur.ratio == null ? '' : Math.round(x.cur.ratio * 10) / 10, x.stock, x.low.length, x.out.length, x.staffN, x.cur.entered,
      ]),
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `전체현황_${r.from}_${r.to}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('지점별 성과를 엑셀 파일로 내려받았습니다.');
  });

  // ------------------------------------------------------------------
  // 실적·정산 (managers; admins reopen a confirmed month)
  // ------------------------------------------------------------------
  state.pay = { month: todayKey().slice(0, 7), rows: [] };
  const krw = (v) => `${nf.format(Math.round(Number(v) || 0))}원`;
  const signedWon = (v) => (Number(v) > 0 ? `+${krw(v)}` : Number(v) < 0 ? `−${krw(-v)}` : '—');
  const pctText = (v) => (v == null ? '—' : `${Number(v)}%`);
  const parseWon = (raw) => { const t = String(raw).replace(/[,\s원]/g, ''); return t === '' || t === '-' ? 0 : /^-?\d+$/.test(t) ? Number(t) : NaN; };

  async function loadPayroll() {
    if (!isManager() || !state.branch) return;
    const box = $('#payError');
    try {
      state.pay.rows = await api.staffMonthReport(state.branch.id, `${state.pay.month}-01`);
      box.hidden = true;
    } catch (e) {
      state.pay.rows = [];
      box.textContent = api.toAppError(e).message;
      box.hidden = false;
    }
    renderPayroll();
  }

  function renderPayroll() {
    const rows = state.pay.rows;
    const ym = state.pay.month;
    const confirmed = rows.length > 0 && rows[0].confirmed;
    $('#payMonth').textContent = monthLabel(ym);
    $('#payStatus').innerHTML = confirmed ? '<span class="tag tag-ok-strong">정산 확정</span>' : '<span class="tag tag-note">집계 중</span>';
    $('#payConfirm').hidden = confirmed;
    $('#payConfirm').disabled = rows.length === 0;
    $('#payReopen').hidden = !confirmed;
    $('#payNext').disabled = ym >= todayKey().slice(0, 7);
    const sum = (k) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
    $('#payKpiService').textContent = krw(sum('service_sales'));
    $('#payKpiServiceSub').textContent = `${nf.format(sum('service_count'))}건`;
    $('#payKpiRetail').textContent = krw(sum('retail_sales'));
    $('#payKpiRetailSub').textContent = `${nf.format(sum('retail_qty'))}개 판매`;
    $('#payKpiIncentive').textContent = krw(sum('incentive_total'));
    $('#payKpiIncentiveSub').textContent = `${nf.format(rows.length)}명`;
    $('#payKpiMaterial').textContent = krw(sum('material_cost'));
    $('#payEmpty').hidden = rows.length > 0;
    $('#payTable').hidden = rows.length === 0;
    $('#payBody').innerHTML = rows.map((r) => `<tr class="${r.status === 'left' ? 'inactive-row' : ''}">
      <td class="cell-name"><div class="item-name">${esc(r.name)}<span class="tag pos-tag pos-${r.position}">${POSITIONS[r.position] || ''}</span></div>${r.memo ? `<div class="st-memo">${esc(r.memo)}</div>` : ''}</td>
      <td class="num" data-label="시술 매출">${krw(r.service_sales)}<small class="sub-num">${nf.format(r.service_count)}건</small></td>
      <td class="num" data-label="시술 인센티브">${krw(r.incentive_service)}<small class="sub-num">${pctText(r.rate_service)}</small></td>
      <td class="num" data-label="제품 판매">${krw(r.retail_sales)}<small class="sub-num">${nf.format(r.retail_qty)}개</small></td>
      <td class="num" data-label="판매 인센티브">${krw(r.incentive_retail)}<small class="sub-num">${pctText(r.rate_retail)}</small></td>
      <td class="num" data-label="조정">${signedWon(r.adjustment)}</td>
      <td class="num pay-total" data-label="인센티브 합계">${krw(r.incentive_total)}</td>
      <td class="num" data-label="재료 사용액">${krw(r.material_cost)}</td>
      <td class="cell-action">${confirmed ? '' : `<button type="button" class="btn btn-secondary btn-sm" data-pay-edit="${r.staff_id}" aria-label="${esc(r.name)} 실적 입력">${svgIcon('i-edit')}입력</button>`}</td>
    </tr>`).join('');
    $('#payFoot').innerHTML = rows.length ? `<tr class="pay-sum">
      <th scope="row">합계</th>
      <td class="num" data-label="시술 매출">${krw(sum('service_sales'))}</td>
      <td class="num" data-label="시술 인센티브">${krw(sum('incentive_service'))}</td>
      <td class="num" data-label="제품 판매">${krw(sum('retail_sales'))}</td>
      <td class="num" data-label="판매 인센티브">${krw(sum('incentive_retail'))}</td>
      <td class="num" data-label="조정">${signedWon(sum('adjustment'))}</td>
      <td class="num pay-total" data-label="인센티브 합계">${krw(sum('incentive_total'))}</td>
      <td class="num" data-label="재료 사용액">${krw(sum('material_cost'))}</td>
      <td></td></tr>` : '';
  }

  const payGo = (n) => { state.pay.month = shiftMonth(state.pay.month, n); loadPayroll(); };
  $('#payPrev').addEventListener('click', () => payGo(-1));
  $('#payNext').addEventListener('click', () => payGo(1));

  $('#payConfirm').addEventListener('click', () => {
    const total = state.pay.rows.reduce((a, r) => a + Number(r.incentive_total || 0), 0);
    askConfirm({
      title: `${monthLabel(state.pay.month)} 정산 확정`,
      text: `${state.branch.name} ${nf.format(state.pay.rows.length)}명, 인센티브 합계 ${krw(total)}으로 확정할까요? 확정하면 이 달의 제품 판매·인센티브율이 고정되고 실적을 고칠 수 없습니다. 확정 취소는 전체 관리자만 할 수 있습니다.`,
      button: '확정',
      run: async () => {
        await api.confirmPayroll(state.branch.id, `${state.pay.month}-01`);
        toast(`${monthLabel(state.pay.month)} 정산을 확정했습니다.`);
        await loadPayroll();
      },
    });
  });
  $('#payReopen').addEventListener('click', () => {
    askConfirm({
      title: `${monthLabel(state.pay.month)} 확정 취소`,
      text: '확정을 취소하면 현재 입출고 기록과 인센티브율로 다시 계산됩니다. 계속할까요?',
      button: '확정 취소',
      run: async () => {
        await api.reopenPayroll(state.branch.id, `${state.pay.month}-01`);
        toast(`${monthLabel(state.pay.month)} 정산 확정을 취소했습니다.`);
        await loadPayroll();
      },
    });
  });

  // CSV for the payroll team (UTF-8 with BOM so Excel reads Korean)
  $('#payCsv').addEventListener('click', () => {
    const rows = state.pay.rows;
    if (!rows.length) { toast('내보낼 실적이 없습니다.', { error: true }); return; }
    const head = ['정산월', '지점', '직원', '직급', '시술 매출', '시술 건수', '시술 인센티브율(%)', '시술 인센티브', '제품 판매', '판매 수량', '판매 인센티브율(%)', '판매 인센티브', '조정액', '인센티브 합계', '재료 사용액', '메모', '확정'];
    const cell = (v) => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const lines = [head, ...rows.map((r) => [state.pay.month, state.branch.name, r.name, POSITIONS[r.position] || r.position,
      r.service_sales, r.service_count, r.rate_service ?? '', r.incentive_service, r.retail_sales, r.retail_qty, r.rate_retail ?? '',
      r.incentive_retail, r.adjustment, r.incentive_total, r.material_cost, r.memo || '', r.confirmed ? '확정' : '집계 중'])];
    const blob = new Blob(['﻿' + lines.map((l) => l.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `실적정산_${state.branch.name}_${state.pay.month}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  const payDialog = setupDialog($('#payDialog'));
  const payForm = $('#payForm');
  let payTarget = null;
  function payPreview() {
    const r = payTarget;
    if (!r) return;
    const sales = parseWon($('#pSales').value), adj = parseWon($('#pAdj').value);
    if (!Number.isFinite(sales) || !Number.isFinite(adj)) { $('#pPreview').textContent = ''; return; }
    const iS = Math.round(sales * (r.rate_service || 0) / 100), iR = Number(r.incentive_retail || 0);
    $('#pPreview').innerHTML = `<dl>
      <div><dt>시술 인센티브 (${pctText(r.rate_service)})</dt><dd>${krw(iS)}</dd></div>
      <div><dt>판매 인센티브 (${pctText(r.rate_retail)} · 제품 ${krw(r.retail_sales)})</dt><dd>${krw(iR)}</dd></div>
      <div><dt>조정</dt><dd>${signedWon(adj)}</dd></div>
      <div class="pp-total"><dt>인센티브 합계</dt><dd>${krw(iS + iR + adj)}</dd></div></dl>`;
  }
  function openPayEdit(r) {
    payTarget = r;
    payForm.reset();
    clearErrors(payForm);
    $('#payTitle').textContent = `${r.name} · ${monthLabel(state.pay.month)} 실적`;
    $('#pSales').value = r.service_sales ? nf.format(r.service_sales) : '';
    $('#pCount').value = r.service_count || '';
    $('#pAdj').value = r.adjustment ? String(r.adjustment) : '';
    $('#pMemo').value = r.memo || '';
    payPreview();
    payDialog.open();
    $('#pSales').focus();
  }
  ['pSales', 'pAdj'].forEach((id) => $('#' + id).addEventListener('input', payPreview));
  $('#pSales').addEventListener('blur', () => { const v = parseWon($('#pSales').value); if (Number.isFinite(v) && v > 0) $('#pSales').value = nf.format(v); });
  payForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(payForm);
    const errors = [];
    const sales = parseWon($('#pSales').value), adj = parseWon($('#pAdj').value);
    const cntRaw = $('#pCount').value.trim(), cnt = cntRaw === '' ? 0 : Number(cntRaw);
    if (!Number.isFinite(sales) || sales < 0) { fieldError($('#pSales'), '시술 매출은 0 이상의 숫자(원)로 입력해 주세요.'); errors.push({ id: 'pSales', msg: '시술 매출을 확인해 주세요.' }); }
    if (!Number.isInteger(cnt) || cnt < 0) { fieldError($('#pCount'), '시술 건수는 0 이상의 정수로 입력해 주세요.'); errors.push({ id: 'pCount', msg: '시술 건수를 확인해 주세요.' }); }
    if (!Number.isFinite(adj) || Math.abs(adj) > 1e8) { fieldError($('#pAdj'), '조정액은 숫자로, ±1억 원까지 입력해 주세요.'); errors.push({ id: 'pAdj', msg: '조정액을 확인해 주세요.' }); }
    if (errors.length) return showSummary(payForm, errors);
    const btn = $('#paySubmit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      await api.saveStaffMonth(payTarget.staff_id, `${state.pay.month}-01`, { service_sales: sales, service_count: cnt, adjustment: adj, memo: $('#pMemo').value });
      $('#payDialog').close();
      toast(`${payTarget.name} 님의 ${monthLabel(state.pay.month)} 실적을 저장했습니다.`);
      const id = payTarget.staff_id;
      await loadPayroll();
      const again = $(`[data-pay-edit="${id}"]`);
      if (again) again.focus();
    } catch (ex) {
      showServerError(payForm, api.toAppError(ex).message);
    } finally {
      btn.disabled = false; btn.removeAttribute('aria-busy');
    }
  });

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
      <div><dt>재고 금액</dt><dd>${won.format(value)}</dd></div>
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
    const wd = e.target.closest('[data-wb-day]');
    if (wd) { state.wb.day = wd.dataset.wbDay; renderWorkboard(); const again = $(`[data-wb-day="${state.wb.day}"]`); if (again) again.focus(); return; }
    const sc = e.target.closest('[data-sch]');
    if (sc) { const [sid, day] = sc.dataset.sch.split('|'); return openScheduleDay(sid, day, sc); }
    const pe = e.target.closest('[data-pay-edit]');
    if (pe) return openPayEdit(state.pay.rows.find((r) => r.staff_id === pe.dataset.payEdit));
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
