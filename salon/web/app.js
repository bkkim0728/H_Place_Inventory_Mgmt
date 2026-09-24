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
  const ROLE_LABEL = { staff: '직원', manager: '점장', admin: '본사 관리자' };
  const STATUS = {
    ok: { label: '정상', icon: 'i-check-circle', rank: 2 },
    low: { label: '부족', icon: 'i-alert', rank: 1 },
    out: { label: '품절', icon: 'i-x-circle', rank: 0 },
  };
  const ROUTES = {
    dashboard: '대시보드',
    inventory: '재고 목록',
    movements: '입출고 내역',
    products: '품목 관리',
  };

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
    range: 14,
    activeIdx: null,
    loading: false,
  };
  const isManager = () => ['manager', 'admin'].includes(state.profile?.role);
  const activeItems = () => state.inventory.filter((i) => i.active);
  const itemById = (id) => state.inventory.find((i) => i.product_id === id);

  // ------------------------------------------------------------------
  // Screens & auth
  // ------------------------------------------------------------------
  const SCREENS = ['screenLoading', 'screenLogin', 'screenPending', 'screenApp'];
  function show(id) { SCREENS.forEach((s) => { $('#' + s).hidden = s !== id; }); }

  function showLogin(message) {
    state.user = null;
    show('screenLogin');
    const err = $('#loginError');
    err.hidden = !message;
    err.textContent = message || '';
    if (api.mode === 'demo') {
      $('#loginDemoNote').hidden = false;
      if (!$('#loginEmail').value) $('#loginEmail').value = 'demo@hplace.example';
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
      err.textContent = '이메일과 비밀번호를 모두 입력해 주세요.';
      err.hidden = false;
      (!email ? $('#loginEmail') : $('#loginPassword')).focus();
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
    const assigned = state.profile && (state.profile.role === 'admin' ? state.branches.length > 0 : state.profile.branch_id);
    if (!assigned) {
      $('#pendingEmail').textContent = user.email || '';
      show('screenPending');
      return;
    }
    let saved = null;
    try { saved = localStorage.getItem('hp-branch'); } catch (e) {}
    state.branch = state.branches.find((b) => b.id === saved && state.profile.role === 'admin')
      || state.branches.find((b) => b.id === state.profile.branch_id)
      || state.branches[0];

    document.body.dataset.role = state.profile.role;
    const name = state.profile.full_name || (user.email || '').split('@')[0];
    $('#userName').textContent = name;
    $('#userInitial').textContent = name.slice(0, 1).toUpperCase();
    $('#userRole').textContent = `${ROLE_LABEL[state.profile.role]} · ${user.email || ''}`;
    const sel = $('#branchSelect');
    sel.innerHTML = state.branches.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
    sel.value = state.branch.id;
    sel.hidden = state.branches.length < 2;
    $('#demoBanner').hidden = api.mode !== 'demo';

    show('screenApp');
    applyRoute(false);
    await loadData();
  }

  $('#branchSelect').addEventListener('change', (e) => {
    state.branch = state.branches.find((b) => b.id === e.target.value);
    try { localStorage.setItem('hp-branch', state.branch.id); } catch (err) {}
    loadData();
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
      const [inventory, movements] = await Promise.all([
        api.listInventory(state.branch.id),
        api.listMovements(state.branch.id, 30),
      ]);
      state.inventory = inventory;
      state.movements = movements;
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
    renderChart();
    fillFilters();
    renderInventory();
    renderMovements();
    renderProducts();
    fillMoveItems();
  }

  // ------------------------------------------------------------------
  // Routing
  // ------------------------------------------------------------------
  function applyRoute(moveFocus = true) {
    let route = (location.hash.match(/^#\/(\w+)/) || [])[1] || 'dashboard';
    if (!ROUTES[route] || (route === 'products' && !isManager())) route = 'dashboard';
    state.route = route;
    $$('.view').forEach((v) => { v.hidden = v.dataset.view !== route; });
    $$('.nav-link').forEach((a) => {
      if (a.dataset.route === route) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    $('#pageTitle').textContent = ROUTES[route];
    document.title = `${ROUTES[route]} · H Place 살롱 재고`;
    if (route === 'dashboard') renderChart();
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

  function renderChart() {
    const svg = $('#chartSvg');
    const box = $('#chart').getBoundingClientRect();
    if (!box.width || $('#screenApp').hidden) return;
    const W = Math.max(280, Math.round(box.width));
    const H = Math.round(box.height);
    const data = trendData();
    const narrow = W < 520;
    const m = { t: 12, r: narrow ? 40 : 48, b: 28, l: 40 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const peak = Math.max(4, ...data.map((d) => Math.max(d.in, d.out))) * 1.05;
    const tickStep = niceStep(peak / 4);
    const ticks = Math.ceil(peak / tickStep);
    const max = tickStep * ticks;
    const x = (i) => m.l + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw);
    const y = (v) => m.t + ih - (v / max) * ih;

    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    let g = '';
    for (let i = 0; i <= ticks; i++) {
      const v = tickStep * i;
      g += `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>`;
      g += `<text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${nf.format(v)}</text>`;
    }
    const step = Math.max(1, Math.ceil(data.length / (narrow ? 4 : 8)));
    data.forEach((d, i) => {
      if ((data.length - 1 - i) % step === 0) g += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${dayFmt.format(d.date)}</text>`;
    });
    const path = (k) => data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join('');
    const last = data[data.length - 1];
    let yIn = y(last.in) + 4, yOut = y(last.out) + 4;
    if (Math.abs(yIn - yOut) < 14) {
      const mid = (yIn + yOut) / 2;
      if (last.in >= last.out) { yIn = mid - 7; yOut = mid + 7; } else { yIn = mid + 7; yOut = mid - 7; }
    }
    g += `<path class="area-in" d="${path('in')}L${x(data.length - 1)},${y(0)}L${x(0)},${y(0)}Z"/>`;
    g += `<path class="line-in" d="${path('in')}"/><path class="line-out" d="${path('out')}"/>`;
    g += `<text class="label-in" x="${W - m.r + 6}" y="${yIn}">입고</text><text class="label-out" x="${W - m.r + 6}" y="${yOut}">출고</text>`;
    g += '<g id="chartActive"></g>';
    svg.innerHTML = g;
    const sumIn = data.reduce((a, d) => a + d.in, 0), sumOut = data.reduce((a, d) => a + d.out, 0);
    svg.setAttribute('aria-label', `최근 ${state.range}일 입고·출고 수량 선 그래프. 입고 합계 ${nf.format(sumIn)}, 출고 합계 ${nf.format(sumOut)}.`);
    svg._geom = { data, x, y, m, W, H };
    if (state.activeIdx != null) setActive(Math.min(state.activeIdx, data.length - 1));
  }

  function setActive(i) {
    const svg = $('#chartSvg');
    if (!svg._geom) return;
    const { data, x, y, m, H, W } = svg._geom;
    const tip = $('#chartTip'), layer = $('#chartActive');
    if (i == null) { state.activeIdx = null; layer.innerHTML = ''; tip.hidden = true; return; }
    state.activeIdx = i;
    const d = data[i];
    layer.innerHTML = `<line class="guide" x1="${x(i)}" x2="${x(i)}" y1="${m.t}" y2="${H - m.b}"/>
      <circle class="dot-in" cx="${x(i)}" cy="${y(d.in)}" r="4"/>
      <rect class="dot-out" x="${x(i) - 3.5}" y="${y(d.out) - 3.5}" width="7" height="7"/>`;
    tip.innerHTML = `<strong>${fullFmt.format(d.date)}</strong>
      <div class="row"><span>입고</span><span>${nf.format(d.in)}</span></div>
      <div class="row"><span>출고</span><span>${nf.format(d.out)}</span></div>`;
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.max(0, x(i) + 12 + tw > W ? x(i) - 12 - tw : x(i) + 12)}px`;
  }

  (function bindChart() {
    const svg = $('#chartSvg');
    const idx = (e) => {
      const { data, x } = svg._geom;
      const px = e.clientX - svg.getBoundingClientRect().left;
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
      state.range = Number(b.dataset.range);
      state.activeIdx = null;
      $$('.segmented button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      renderChart();
    }));
    let raf = 0;
    new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(renderChart); }).observe($('#chart'));
  })();

  $$('.kpi-action').forEach((b) => b.addEventListener('click', () => {
    state.inv.status = b.dataset.filter;
    $('#invStatus').value = state.inv.status;
    location.hash = '#/inventory';
    renderInventory();
  }));

  // ------------------------------------------------------------------
  // Inventory list
  // ------------------------------------------------------------------
  function fillFilters() {
    const cats = [...new Set(state.inventory.map((i) => i.category))].sort((a, b) => a.localeCompare(b, 'ko'));
    const sel = $('#invCat');
    const cur = sel.value;
    sel.innerHTML = '<option value="">전체</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
    sel.value = cats.includes(cur) ? cur : '';
    $('#categoryList').innerHTML = cats.map((c) => `<option value="${esc(c)}"></option>`).join('');
  }

  function sortVal(i, key) {
    if (key === 'value') return i.stock * i.cost_price;
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
      .sort((a, b) => a.category.localeCompare(b.category, 'ko') || a.name.localeCompare(b.name, 'ko'));
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
      <td class="cell-action"><button type="button" class="btn btn-secondary btn-sm" data-edit="${i.product_id}" aria-label="${esc(i.name)} 수정">${svgIcon('i-edit')}수정</button></td>
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
    const cats = [...new Set(items.map((i) => i.category))];
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
    $('#pCategory').value = item?.category || '';
    $('#pUnit').value = item?.unit || '개';
    $('#pCost').value = item ? item.cost_price : '';
    $('#pRetail').value = item?.retail_price ?? '';
    $('#pSafety').value = item ? item.safety_stock : '';
    $('#pLocation').value = item?.location || '';
    $('#pRetailFlag').checked = Boolean(item?.is_retail);
    $('#pActive').checked = item ? item.active : true;
    productDialog.open();
    $('#pName').focus();
  }

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
    if (need('pSku', '품목 코드') && !/^[A-Za-z0-9-]+$/.test($('#pSku').value.trim())) {
      fieldError($('#pSku'), '품목 코드는 영문, 숫자, 하이픈(-)만 쓸 수 있습니다.');
      errors.push({ id: 'pSku', msg: '품목 코드 형식을 확인해 주세요.' });
    }
    need('pCategory', '카테고리');
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
  // Global click actions
  // ------------------------------------------------------------------
  document.addEventListener('click', (e) => {
    const mv = e.target.closest('[data-move]');
    if (mv) return openMove({ productId: mv.dataset.move, type: mv.dataset.type || (itemById(mv.dataset.move)?.is_retail ? 'sale' : 'use'), qty: mv.dataset.qty || '' });
    const rv = e.target.closest('[data-revert]');
    if (rv) return revert(rv.dataset.revert, rv);
    const ed = e.target.closest('[data-edit]');
    if (ed) return openProduct(itemById(ed.dataset.edit));
  });
  $('#newMoveBtn').addEventListener('click', () => openMove());
  $('#newProductBtn').addEventListener('click', () => openProduct(null));
  $('#demoReset').addEventListener('click', async () => {
    if (!api.resetDemo) return;
    api.resetDemo();
    toast('샘플 데이터로 초기화했습니다.');
    await loadData();
  });

  // ------------------------------------------------------------------
  // Toast
  // ------------------------------------------------------------------
  function toast(msg, { undo, error } = {}) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `${svgIcon(error ? 'i-alert' : 'i-check-circle')}<p></p>${undo ? '<button type="button">실행 취소</button>' : ''}`;
    $('p', el).textContent = msg;
    if (error) $('.icon', el).style.color = 'var(--danger)';
    $('#toastRegion').replaceChildren(el);
    let timer = setTimeout(() => el.remove(), undo || error ? 7000 : 4000);
    el.addEventListener('mouseenter', () => clearTimeout(timer));
    el.addEventListener('focusin', () => clearTimeout(timer));
    el.addEventListener('mouseleave', () => { timer = setTimeout(() => el.remove(), 3000); });
    if (undo) $('button', el).addEventListener('click', () => { el.remove(); undo(); });
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
