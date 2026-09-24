(() => {
  'use strict';

  // ------------------------------------------------------------------
  // Sample data (replace with API data later)
  // ------------------------------------------------------------------
  const ITEMS = [
    { sku: 'NR-001', name: '신라면 멀티팩 (5입)', category: '라면·면류', stock: 184, safety: 60, price: 4480 },
    { sku: 'NR-002', name: '짜파게티 멀티팩 (5입)', category: '라면·면류', stock: 42, safety: 50, price: 4980 },
    { sku: 'NR-003', name: '불닭볶음면 (5입)', category: '라면·면류', stock: 0, safety: 40, price: 5280 },
    { sku: 'NR-004', name: '칼국수 생면 1kg', category: '라면·면류', stock: 36, safety: 20, price: 6900 },
    { sku: 'RM-001', name: '햇반 210g (12입)', category: '즉석식품', stock: 96, safety: 30, price: 14900 },
    { sku: 'RM-002', name: '비비고 왕교자 1.05kg', category: '냉동식품', stock: 18, safety: 25, price: 11980 },
    { sku: 'RM-003', name: '떡볶이 떡 500g', category: '냉장식품', stock: 55, safety: 30, price: 2980 },
    { sku: 'RM-004', name: '오뚜기 3분카레 (순한맛)', category: '즉석식품', stock: 120, safety: 40, price: 1480 },
    { sku: 'KM-001', name: '종가 포기김치 3kg', category: '냉장식품', stock: 12, safety: 15, price: 24900 },
    { sku: 'KM-002', name: '총각김치 1.5kg', category: '냉장식품', stock: 27, safety: 15, price: 15900 },
    { sku: 'KM-003', name: '깍두기 1kg', category: '냉장식품', stock: 0, safety: 10, price: 9900 },
    { sku: 'SC-001', name: '고추장 1kg', category: '소스·양념', stock: 64, safety: 20, price: 8980 },
    { sku: 'SC-002', name: '된장 1kg', category: '소스·양념', stock: 48, safety: 20, price: 7980 },
    { sku: 'SC-003', name: '진간장 1.8L', category: '소스·양념', stock: 9, safety: 20, price: 9480 },
    { sku: 'SC-004', name: '참기름 320ml', category: '소스·양념', stock: 33, safety: 15, price: 11900 },
    { sku: 'DR-001', name: '바나나맛 우유 (4입)', category: '음료', stock: 72, safety: 40, price: 5480 },
    { sku: 'DR-002', name: '식혜 1.5L', category: '음료', stock: 21, safety: 24, price: 4280 },
    { sku: 'DR-003', name: '보리차 티백 (50입)', category: '음료', stock: 58, safety: 20, price: 3980 },
    { sku: 'DR-004', name: '밀키스 (6캔)', category: '음료', stock: 88, safety: 30, price: 5980 },
    { sku: 'SN-001', name: '초코파이 (12입)', category: '과자·간식', stock: 140, safety: 40, price: 5980 },
    { sku: 'SN-002', name: '새우깡 대용량', category: '과자·간식', stock: 7, safety: 30, price: 3280 },
    { sku: 'SN-003', name: '허니버터칩', category: '과자·간식', stock: 64, safety: 30, price: 2480 },
    { sku: 'FZ-001', name: '냉동 붕어빵 (10입)', category: '냉동식품', stock: 30, safety: 12, price: 7980 },
    { sku: 'FZ-002', name: '양념 불고기 1kg', category: '냉동식품', stock: 0, safety: 10, price: 21900 },
  ];

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const nf = new Intl.NumberFormat('ko-KR');
  const won = new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 });
  const wonCompact = new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', notation: 'compact', maximumFractionDigits: 1 });
  const dayFmt = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric' });
  const fullFmt = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const svgIcon = (id, cls = 'icon') => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const statusOf = (it) => (it.stock === 0 ? 'out' : it.stock <= it.safety ? 'low' : 'ok');
  const STATUS = {
    ok: { label: '정상', icon: 'i-check-circle', rank: 2 },
    low: { label: '부족', icon: 'i-alert', rank: 1 },
    out: { label: '품절', icon: 'i-x-circle', rank: 0 },
  };
  const badge = (s) => `<span class="badge badge-${s}">${svgIcon(STATUS[s].icon)}${STATUS[s].label}</span>`;

  // Deterministic pseudo-random so the sample chart is stable between reloads.
  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rand = mulberry32(20260924);
  const TREND = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (29 - i));
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    return {
      date: d,
      in: Math.round((weekend ? 40 : 120) + rand() * 90),
      out: Math.round((weekend ? 150 : 95) + rand() * 70),
    };
  });

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------
  const state = {
    q: '',
    category: '',
    status: '',
    sortKey: 'status',
    sortDir: 'asc',
    range: 14,
    activeIdx: null,
    lastMove: null,
  };

  // ------------------------------------------------------------------
  // KPIs + nav badge
  // ------------------------------------------------------------------
  function renderKpis() {
    const totalQty = ITEMS.reduce((a, it) => a + it.stock, 0);
    const totalVal = ITEMS.reduce((a, it) => a + it.stock * it.price, 0);
    const low = ITEMS.filter((it) => statusOf(it) === 'low').length;
    const out = ITEMS.filter((it) => statusOf(it) === 'out').length;

    $('#kpiItems').textContent = nf.format(ITEMS.length);
    $('#kpiItemsSub').textContent = `총 수량 ${nf.format(totalQty)}개`;
    const v = $('#kpiValue');
    v.textContent = wonCompact.format(totalVal);
    v.title = won.format(totalVal);
    $('#kpiLow').textContent = nf.format(low);
    $('#kpiOut').textContent = nf.format(out);

    const badgeEl = $('#navAlertCount');
    badgeEl.textContent = low + out;
    badgeEl.setAttribute('aria-label', `알림 ${low + out}건`);
    badgeEl.dataset.zero = String(low + out === 0);
  }

  // ------------------------------------------------------------------
  // Alerts
  // ------------------------------------------------------------------
  function renderAlerts() {
    const list = ITEMS.filter((it) => statusOf(it) !== 'ok')
      .sort((a, b) => a.stock / a.safety - b.stock / b.safety);
    const ul = $('#alertList');
    if (!list.length) {
      ul.innerHTML = `<li class="alert-empty">${svgIcon('i-check-circle')}<p>모든 품목이 안전재고 이상입니다.</p></li>`;
      return;
    }
    ul.innerHTML = list.map((it) => {
      const s = statusOf(it);
      const need = Math.max(it.safety * 2 - it.stock, 1);
      return `<li class="alert-item">
        <span class="kpi-icon ${s === 'out' ? 'tone-danger' : 'tone-warn'}" aria-hidden="true">${svgIcon(STATUS[s].icon)}</span>
        <div>
          <p class="alert-name">${esc(it.name)} <span class="sr-only">(${STATUS[s].label})</span></p>
          <p class="alert-meta">현재 ${nf.format(it.stock)} / 안전 ${nf.format(it.safety)} · 권장 발주 ${nf.format(need)}개</p>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" data-restock="${it.sku}" data-qty="${need}" aria-label="${esc(it.name)} 입고 등록">입고</button>
      </li>`;
    }).join('');
  }

  // ------------------------------------------------------------------
  // Inventory table
  // ------------------------------------------------------------------
  const COLS = ['name', 'category', 'stock', 'safety', 'price', 'value', 'status'];
  const LABELS = { name: '품목', category: '카테고리', stock: '현재고', safety: '안전재고', price: '단가', value: '재고 금액', status: '상태' };

  function sortVal(it, key) {
    if (key === 'value') return it.stock * it.price;
    if (key === 'status') return STATUS[statusOf(it)].rank * 1e6 + it.stock / Math.max(it.safety, 1);
    return it[key];
  }

  function filtered() {
    const q = state.q.trim().toLowerCase();
    const rows = ITEMS.filter((it) =>
      (!q || it.name.toLowerCase().includes(q) || it.sku.toLowerCase().includes(q)) &&
      (!state.category || it.category === state.category) &&
      (!state.status || statusOf(it) === state.status));
    const dir = state.sortDir === 'asc' ? 1 : -1;
    return rows.sort((a, b) => {
      const va = sortVal(a, state.sortKey), vb = sortVal(b, state.sortKey);
      if (typeof va === 'string') return va.localeCompare(vb, 'ko') * dir;
      return (va - vb) * dir;
    });
  }

  function renderTable(flashSku) {
    const rows = filtered();
    $('#resultCount').textContent = `${nf.format(rows.length)}개 품목${rows.length !== ITEMS.length ? ` (전체 ${ITEMS.length}개 중)` : ''}`;
    $('#emptyState').hidden = rows.length > 0;
    $('#invTable').hidden = rows.length === 0;

    $('#invBody').innerHTML = rows.map((it) => {
      const s = statusOf(it);
      const pct = Math.min(100, Math.round((it.stock / (it.safety * 3)) * 100));
      return `<tr data-sku="${it.sku}"${it.sku === flashSku ? ' class="row-flash"' : ''}>
        <td class="cell-name"><div class="item-name">${esc(it.name)}</div><div class="item-sku">${it.sku}</div></td>
        <td data-label="${LABELS.category}">${esc(it.category)}</td>
        <td class="num" data-label="${LABELS.stock}"><span class="stock-cell"><strong>${nf.format(it.stock)}</strong><span class="meter" data-status="${s}" aria-hidden="true"><span style="width:${pct}%"></span></span></span></td>
        <td class="num" data-label="${LABELS.safety}">${nf.format(it.safety)}</td>
        <td class="num" data-label="${LABELS.price}">${won.format(it.price)}</td>
        <td class="num" data-label="${LABELS.value}">${won.format(it.stock * it.price)}</td>
        <td data-label="${LABELS.status}">${badge(s)}</td>
        <td class="cell-action"><button type="button" class="btn btn-secondary btn-sm" data-adjust="${it.sku}" aria-label="${esc(it.name)} 입출고 등록">입출고</button></td>
      </tr>`;
    }).join('');

    $$('#invTable thead th[data-key]').forEach((th) => {
      if (th.dataset.key === state.sortKey) {
        th.setAttribute('aria-sort', state.sortDir === 'asc' ? 'ascending' : 'descending');
        $('use', th).setAttribute('href', state.sortDir === 'asc' ? '#i-up' : '#i-down');
      } else {
        th.removeAttribute('aria-sort');
        $('use', th).setAttribute('href', '#i-sort');
      }
    });
  }

  // ------------------------------------------------------------------
  // Trend chart (inline SVG)
  // ------------------------------------------------------------------
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // Round a tick step up to 1/2/5 × 10^n so axis labels stay whole numbers.
  function niceStep(v) {
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  }

  function renderChart() {
    const svg = $('#chartSvg');
    const box = $('#chart').getBoundingClientRect();
    const W = Math.max(280, Math.round(box.width));
    const H = Math.round(box.height);
    const data = TREND.slice(-state.range);
    const narrow = W < 520;
    const m = { t: 12, r: narrow ? 40 : 48, b: 28, l: 40 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const peak = Math.max(...data.map((d) => Math.max(d.in, d.out))) * 1.05;
    const tickStep = niceStep(peak / 5);
    const ticks = Math.ceil(peak / tickStep);
    const max = tickStep * ticks;
    const x = (i) => m.l + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw);
    const y = (v) => m.t + ih - (v / max) * ih;

    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    let g = '';
    for (let i = 0; i <= ticks; i++) {
      const v = (max / ticks) * i;
      g += `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>`;
      g += `<text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${nf.format(v)}</text>`;
    }
    const maxLabels = narrow ? 4 : 8;
    const step = Math.max(1, Math.ceil(data.length / maxLabels));
    data.forEach((d, i) => {
      if ((data.length - 1 - i) % step === 0) {
        g += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${dayFmt.format(d.date)}</text>`;
      }
    });

    const path = (k) => data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join('');
    const area = `${path('in')}L${x(data.length - 1)},${y(0)}L${x(0)},${y(0)}Z`;
    const last = data[data.length - 1];
    // Direct labels at line ends; nudge apart if they collide.
    let yIn = y(last.in) + 4, yOut = y(last.out) + 4;
    if (Math.abs(yIn - yOut) < 14) {
      const mid = (yIn + yOut) / 2;
      if (last.in >= last.out) { yIn = mid - 7; yOut = mid + 7; } else { yIn = mid + 7; yOut = mid - 7; }
    }

    g += `<path class="area-in" d="${area}"/>`;
    g += `<path class="line-in" d="${path('in')}"/>`;
    g += `<path class="line-out" d="${path('out')}"/>`;
    g += `<text class="label-in" x="${W - m.r + 6}" y="${yIn}">입고</text>`;
    g += `<text class="label-out" x="${W - m.r + 6}" y="${yOut}">출고</text>`;
    g += `<g id="chartActive"></g>`;
    svg.innerHTML = g;

    const sumIn = data.reduce((a, d) => a + d.in, 0);
    const sumOut = data.reduce((a, d) => a + d.out, 0);
    svg.setAttribute('aria-label',
      `최근 ${state.range}일 입출고 추이 선 그래프. 입고 합계 ${nf.format(sumIn)}개, 출고 합계 ${nf.format(sumOut)}개. ` +
      `마지막 날 입고 ${nf.format(last.in)}개, 출고 ${nf.format(last.out)}개.`);

    svg._geom = { data, x, y, m, W, H };
    if (state.activeIdx != null) setActive(Math.min(state.activeIdx, data.length - 1));
    renderTrendTable(data);
  }

  function setActive(i) {
    const svg = $('#chartSvg');
    const { data, x, y, m, H, W } = svg._geom;
    const tip = $('#chartTip');
    const layer = $('#chartActive');
    if (i == null) {
      state.activeIdx = null;
      layer.innerHTML = '';
      tip.hidden = true;
      return;
    }
    state.activeIdx = i;
    const d = data[i];
    layer.innerHTML =
      `<line class="guide" x1="${x(i)}" x2="${x(i)}" y1="${m.t}" y2="${H - m.b}"/>` +
      `<circle class="dot-in" cx="${x(i)}" cy="${y(d.in)}" r="4"/>` +
      `<rect class="dot-out" x="${x(i) - 3.5}" y="${y(d.out) - 3.5}" width="7" height="7"/>`;
    tip.innerHTML = `<strong>${fullFmt.format(d.date)}</strong>
      <div class="row"><span>입고</span><span>${nf.format(d.in)}개</span></div>
      <div class="row"><span>출고</span><span>${nf.format(d.out)}개</span></div>`;
    tip.hidden = false;
    const tw = tip.offsetWidth;
    const left = x(i) + 12 + tw > W ? x(i) - 12 - tw : x(i) + 12;
    tip.style.left = `${Math.max(0, left)}px`;
  }

  function renderTrendTable(data) {
    $('#trendTable tbody').innerHTML = [...data].reverse().map((d) =>
      `<tr><td>${fullFmt.format(d.date)}</td><td class="num">${nf.format(d.in)}</td><td class="num">${nf.format(d.out)}</td></tr>`).join('');
  }

  function bindChart() {
    const svg = $('#chartSvg');
    const idxFromEvent = (e) => {
      const { data, x } = svg._geom;
      const r = svg.getBoundingClientRect();
      const px = e.clientX - r.left;
      let best = 0, bd = Infinity;
      data.forEach((_, i) => { const dd = Math.abs(x(i) - px); if (dd < bd) { bd = dd; best = i; } });
      return best;
    };
    svg.addEventListener('pointermove', (e) => setActive(idxFromEvent(e)));
    svg.addEventListener('pointerdown', (e) => setActive(idxFromEvent(e)));
    svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') setActive(null); });
    svg.addEventListener('focus', () => setActive(svg._geom.data.length - 1));
    svg.addEventListener('blur', () => setActive(null));
    svg.addEventListener('keydown', (e) => {
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
    new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(renderChart);
    }).observe($('#chart'));
  }

  // ------------------------------------------------------------------
  // Movement dialog
  // ------------------------------------------------------------------
  const dialog = $('#moveDialog');
  const form = $('#moveForm');
  let returnFocus = null;

  function fillItemSelect() {
    const sel = $('#fItem');
    const cats = [...new Set(ITEMS.map((i) => i.category))];
    sel.innerHTML = '<option value="">품목을 선택하세요</option>' + cats.map((c) =>
      `<optgroup label="${esc(c)}">${ITEMS.filter((i) => i.category === c)
        .map((i) => `<option value="${i.sku}">${esc(i.name)} (${i.sku})</option>`).join('')}</optgroup>`).join('');
  }

  function updateItemHelp() {
    const it = ITEMS.find((i) => i.sku === $('#fItem').value);
    $('#fItemHelp').textContent = it
      ? `현재고 ${nf.format(it.stock)}개 · 안전재고 ${nf.format(it.safety)}개 · ${STATUS[statusOf(it)].label}`
      : '현재고 —';
  }

  function openDialog({ sku = '', type = 'in', qty = '' } = {}) {
    returnFocus = document.activeElement;
    form.reset();
    clearErrors();
    $('#fItem').value = sku;
    $(`input[name="type"][value="${type}"]`).checked = true;
    $('#fQty').value = qty;
    updateItemHelp();
    dialog.showModal();
    (sku ? $('#fQty') : $('#fItem')).focus();
  }

  function closeDialog() {
    dialog.close();
  }
  dialog.addEventListener('close', () => {
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
  });
  // Close on backdrop click only when the press also started on the backdrop, so a drag
  // or layout shift between pointerdown/up inside the dialog never dismisses it.
  const onBackdrop = (e) => {
    if (e.target !== dialog) return false;
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  let downOnBackdrop = false;
  dialog.addEventListener('pointerdown', (e) => { downOnBackdrop = onBackdrop(e); });
  dialog.addEventListener('click', (e) => {
    if (downOnBackdrop && onBackdrop(e)) closeDialog();
    downOnBackdrop = false;
  });
  $$('[data-close]', dialog).forEach((b) => b.addEventListener('click', closeDialog));

  function setError(input, errEl, msg) {
    input.setAttribute('aria-invalid', 'true');
    errEl.textContent = msg;
    errEl.hidden = false;
  }
  function clearErrors(keepSummary = false) {
    $$('[aria-invalid]', form).forEach((el) => el.removeAttribute('aria-invalid'));
    $$('.err', form).forEach((el) => { el.hidden = true; el.textContent = ''; });
    // The summary stays until the next submit so blur re-validation doesn't shift the layout.
    if (!keepSummary) $('#errorSummary').hidden = true;
  }

  function validate({ keepSummary = false } = {}) {
    clearErrors(keepSummary);
    const errors = [];
    const item = ITEMS.find((i) => i.sku === $('#fItem').value);
    const type = $('input[name="type"]:checked').value;
    const raw = $('#fQty').value.trim();
    const qty = Number(raw);

    if (!item) {
      setError($('#fItem'), $('#fItemErr'), '입출고할 품목을 선택해 주세요.');
      errors.push({ id: 'fItem', msg: '품목을 선택해 주세요.' });
    }
    if (!raw || !Number.isInteger(qty) || qty < 1) {
      setError($('#fQty'), $('#fQtyErr'), '수량은 1 이상의 정수로 입력해 주세요.');
      errors.push({ id: 'fQty', msg: '수량을 1 이상의 정수로 입력해 주세요.' });
    } else if (item && type === 'out' && item.stock === 0) {
      setError($('#fQty'), $('#fQtyErr'), '품절 상태라 출고할 수 없습니다. 먼저 입고를 등록해 주세요.');
      errors.push({ id: 'fQty', msg: '품절 품목은 출고할 수 없습니다.' });
    } else if (item && type === 'out' && qty > item.stock) {
      setError($('#fQty'), $('#fQtyErr'), `출고 수량이 현재고(${nf.format(item.stock)}개)보다 많습니다. ${nf.format(item.stock)} 이하로 입력해 주세요.`);
      errors.push({ id: 'fQty', msg: '출고 수량이 현재고보다 많습니다.' });
    }
    return { errors, item, type, qty };
  }

  // Re-validate a flagged field on blur. Skip when focus moves to the submit button:
  // submit validates anyway, and re-rendering errors mid-click would shift the button away.
  ['#fItem', '#fQty'].forEach((sel) => $(sel).addEventListener('blur', (e) => {
    if (e.relatedTarget === $('#submitBtn')) return;
    if ($(sel).getAttribute('aria-invalid') === 'true') validate({ keepSummary: true });
  }));
  $('#fItem').addEventListener('change', updateItemHelp);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const { errors, item, type, qty } = validate();
    if (errors.length) {
      const sum = $('#errorSummary');
      $('ul', sum).innerHTML = errors.map((er) => `<li><a href="#${er.id}">${er.msg}</a></li>`).join('');
      sum.hidden = false;
      if (errors.length > 1) sum.focus(); else $('#' + errors[0].id).focus();
      return;
    }
    const btn = $('#submitBtn');
    btn.setAttribute('aria-busy', 'true');
    btn.disabled = true;
    // Simulated save; swap for an API call.
    setTimeout(() => {
      btn.removeAttribute('aria-busy');
      btn.disabled = false;
      applyMove(item, type, qty);
      closeDialog();
      toast(`${item.name} ${type === 'in' ? '입고' : '출고'} ${nf.format(qty)}개 등록됨`, () => undoMove());
    }, 350);
  });
  $('#errorSummary').addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    e.preventDefault();
    $(a.getAttribute('href')).focus();
  });

  function applyMove(item, type, qty) {
    const delta = type === 'in' ? qty : -qty;
    item.stock += delta;
    TREND[TREND.length - 1][type] += qty;
    state.lastMove = { sku: item.sku, type, qty, delta };
    refresh(item.sku);
  }
  function undoMove() {
    const mv = state.lastMove;
    if (!mv) return;
    const item = ITEMS.find((i) => i.sku === mv.sku);
    item.stock -= mv.delta;
    TREND[TREND.length - 1][mv.type] -= mv.qty;
    state.lastMove = null;
    refresh(item.sku);
    toast(`${item.name} 등록을 취소했습니다.`);
  }

  // ------------------------------------------------------------------
  // Toast
  // ------------------------------------------------------------------
  function toast(msg, onUndo) {
    const region = $('#toastRegion');
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `${svgIcon('i-check-circle')}<p>${esc(msg)}</p>${onUndo ? '<button type="button">실행 취소</button>' : ''}`;
    region.replaceChildren(el);
    let timer = setTimeout(() => el.remove(), onUndo ? 6000 : 4000);
    // Pause auto-dismiss while the user is interacting with the toast.
    el.addEventListener('mouseenter', () => clearTimeout(timer));
    el.addEventListener('focusin', () => clearTimeout(timer));
    el.addEventListener('mouseleave', () => { timer = setTimeout(() => el.remove(), 3000); });
    if (onUndo) $('button', el).addEventListener('click', () => { el.remove(); onUndo(); });
  }

  // ------------------------------------------------------------------
  // Filters, sorting, navigation
  // ------------------------------------------------------------------
  function bindTable() {
    const catSel = $('#cat');
    [...new Set(ITEMS.map((i) => i.category))].forEach((c) => catSel.add(new Option(c, c)));

    let t = 0;
    $('#q').addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => { state.q = e.target.value; renderTable(); }, 150);
    });
    catSel.addEventListener('change', (e) => { state.category = e.target.value; renderTable(); });
    $('#status').addEventListener('change', (e) => { state.status = e.target.value; renderTable(); });
    $('#clearFilters').addEventListener('click', () => {
      state.q = state.category = state.status = '';
      $('#q').value = ''; catSel.value = ''; $('#status').value = '';
      renderTable();
      $('#q').focus();
    });

    $$('#invTable thead th[data-key] .sort-btn').forEach((b) => b.addEventListener('click', () => {
      const key = b.closest('th').dataset.key;
      if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else { state.sortKey = key; state.sortDir = ['stock', 'safety', 'price', 'value'].includes(key) ? 'desc' : 'asc'; }
      renderTable();
    }));

    document.addEventListener('click', (e) => {
      const adj = e.target.closest('[data-adjust]');
      if (adj) openDialog({ sku: adj.dataset.adjust });
      const rs = e.target.closest('[data-restock]');
      if (rs) openDialog({ sku: rs.dataset.restock, type: 'in', qty: rs.dataset.qty });
    });

    $$('.kpi-action').forEach((b) => b.addEventListener('click', () => {
      state.status = b.dataset.filter;
      $('#status').value = state.status;
      renderTable();
      $('#inventory').scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth' });
      $('#inv-heading').setAttribute('tabindex', '-1');
      $('#inv-heading').focus({ preventScroll: true });
    }));
  }

  function bindShell() {
    const sidebar = $('#sidebar');
    const scrim = $('#scrim');
    const menuBtn = $('#menuBtn');
    const mq = window.matchMedia('(max-width: 1023px)');

    const setOpen = (open) => {
      sidebar.dataset.open = String(open);
      scrim.hidden = !open;
      menuBtn.setAttribute('aria-expanded', String(open));
      menuBtn.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기');
      if (open) $('.nav-link', sidebar).focus();
    };
    menuBtn.addEventListener('click', () => setOpen(sidebar.dataset.open !== 'true'));
    scrim.addEventListener('click', () => { setOpen(false); menuBtn.focus(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sidebar.dataset.open === 'true') { setOpen(false); menuBtn.focus(); }
    });
    mq.addEventListener('change', () => setOpen(false));

    const links = $$('.nav-link');
    links.forEach((a) => a.addEventListener('click', () => {
      links.forEach((l) => l.removeAttribute('aria-current'));
      a.setAttribute('aria-current', 'true');
      if (mq.matches) setOpen(false);
    }));

    // Highlight the nav item for the section in view.
    const sections = links.map((a) => $(a.getAttribute('href')));
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        links.forEach((l) => {
          if (l.getAttribute('href') === '#' + en.target.id) l.setAttribute('aria-current', 'true');
          else l.removeAttribute('aria-current');
        });
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    sections.forEach((s) => io.observe(s));

    // Theme toggle
    const themeBtn = $('#themeBtn');
    const isDark = () => {
      const t = document.documentElement.dataset.theme;
      return t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    };
    const syncThemeBtn = () => {
      const dark = isDark();
      $('use', themeBtn).setAttribute('href', dark ? '#i-sun' : '#i-moon');
      themeBtn.setAttribute('aria-label', dark ? '라이트 모드로 전환' : '다크 모드로 전환');
    };
    themeBtn.addEventListener('click', () => {
      const next = isDark() ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('hp-theme', next); } catch (e) {}
      syncThemeBtn();
    });
    syncThemeBtn();

    $('#newMoveBtn').addEventListener('click', () => openDialog());
    $('#asOf').textContent = `기준일 ${fullFmt.format(today)}`;
  }

  function refresh(flashSku) {
    renderKpis();
    renderAlerts();
    renderTable(flashSku);
    renderChart();
    updateItemHelp();
  }

  // ------------------------------------------------------------------
  // Init
  // ------------------------------------------------------------------
  fillItemSelect();
  bindShell();
  bindTable();
  bindChart();
  refresh();
})();
