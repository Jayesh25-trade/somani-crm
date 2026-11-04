(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const root = document.documentElement;
  const MQ = matchMedia('(max-width: 860px)');
  const MOBILE = () => MQ.matches;           // same breakpoint as the CSS

  // ---------- state ----------
  const S = {
    data: null, user: null, idx: null,
    view: get('view') || 'board',
    loc: get('loc') || 'all',
    f: { q: '', status: 'all', days: 'all' },   // shared filters for board / calendar / timeline
    boardStart: null, mDay: null, calMonth: null, calDay: null, tlStart: null, tlLimit: 60,
    pq: '', pFilter: 'all', pLimit: 100,
    drawer: null,
    planDraft: null, tplDraft: null, clinicSaved: null,
  };

  // ---------- utils ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const localDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => localDate(new Date());
  const toUTC = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const diff = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 864e5);
  const addDays = (s, n) => new Date(toUTC(s) + n * 864e5).toISOString().slice(0, 10);
  const dow = s => new Date(toUTC(s)).getUTCDay();             // 0 = Sun
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const fmt = s => { if (!s) return '—'; const y = s.slice(0, 4); return `${+s.slice(8, 10)} ${MONTHS[+s.slice(5, 7) - 1]}${y !== today().slice(0, 4) ? ' ' + y : ''}`; };
  const fmtTime = iso => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  const fmtWhen = iso => `${fmt(localDate(new Date(iso)))}, ${fmtTime(iso)}`;
  const phoneFmt = p => p ? `${p.slice(0, 5)} ${p.slice(5)}` : '';
  const initials = n => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const GENDER = { M: 'Male', F: 'Female', O: 'Other' };
  function get(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch {} }
  const clone = o => JSON.parse(JSON.stringify(o));
  const rid = () => Math.random().toString(36).slice(2, 9);

  // ---------- domain ----------
  const shortLoc = id => S.data.locations.find(l => l.id === id)?.name || id;
  const patient = id => S.idx.pat.get(id);
  const isOpen = c => c.status === 'active' || c.status === 'reminded';
  const coursesOf = pid => (S.idx.cbp.get(pid) || []).slice().sort((a, b) => b.startDate.localeCompare(a.startDate) || b.createdAt.localeCompare(a.createdAt));
  const openCourse = pid => (S.idx.cbp.get(pid) || []).find(isOpen);
  const plan = () => S.data.settings.schedule;                 // clinic default
  const planOf = c => c.plan || plan();                        // a course's own plan, else the default
  const stepNo = (c, st) => planOf(c).indexOf(st) + 1;
  const stepById = (c, id) => planOf(c).find(st => st.id === id);
  const tpl = id => S.data.settings.templates.find(t => t.id === id);
  const lastTablet = c => addDays(c.dueDate, -1);
  const stepDate = (c, st) => addDays(c.dueDate, st.offset);
  const sentFor = (c, st) => c.reminders.find(r => r.stepId === st.id);
  const offsetLabel = o => o === 0 ? 'On completion day' : o > 0 ? `${plural(o, 'day')} after completion` : `${plural(-o, 'day')} before completion`;
  const offsetShort = o => o === 0 ? 'Day 0' : o > 0 ? `+${o} day${o === 1 ? '' : 's'}` : `${-o} day${o === -1 ? '' : 's'} before`;
  const docName = id => S.data.doctors?.find(d => d.id === id)?.name || '';
  const docShort = id => (docName(id) || '').replace('Dr ', 'Dr ').split(' ').slice(0, 2).join(' ');
  // 14DR3 = 14-day plan, reminder 3 (day 42 of treatment)
  const code = (c, i) => `${c.days}DR${i + 1}`;
  const dayNo = (c, i) => c.days * (i + 1);
  const normName = n => String(n || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const defaultIntervals = days => S.data.settings.planDefaults?.intervals?.[days] || Math.max(1, Math.min(24, Math.round(168 / days)));
  const STATE_LABEL = { due: 'To send today', missed: 'Missed', sent: 'Sent', scheduled: 'Upcoming' };

  // One "occurrence" = one planned reminder (plan step) for one course on one date
  function occurrencesOf(c, p, all = false) {
    const out = [];
    const t = today();
    let future = false;
    planOf(c).forEach((st, i) => {
      const r = sentFor(c, st);
      if (!isOpen(c) && !r) return;               // patient already came back — unsent steps no longer apply
      const date = stepDate(c, st);
      const state = r ? 'sent' : date < t ? 'missed' : date === t ? 'due' : 'scheduled';
      if (state === 'scheduled' && !all) { if (future) return; future = true; }   // forecast only the next reminder; later ones depend on whether the patient comes back
      out.push({ c, p, st, i, date, r, state });
    });
    return out;
  }
  let _occ = null;
  function allOcc() {
    if (_occ) return _occ;
    _occ = [];
    for (const c of S.data.courses) {
      if (!isOpen(c) && !c.reminders.length) continue;
      const p = patient(c.patientId);
      if (!p || p.archived) continue;
      _occ.push(...occurrencesOf(c, p));
    }
    return _occ;
  }
  const inLoc = loc => S.loc === 'all' || loc === S.loc;
  function matchQuery(p, q) {
    q = q.trim().toLowerCase();
    if (!q) return true;
    if (p.name.toLowerCase().includes(q) || p.regNo.toLowerCase().includes(q) || p.regNo.toLowerCase().replace('-', '').includes(q.replace('-', ''))) return true;
    if (/^[a-z]{2,4}-?\d*$/i.test(q)) return false;
    let d = q.replace(/\D/g, '');
    if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
    if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    return d.length >= 3 && (p.phone.includes(d) || (p.altPhone || '').includes(d));
  }
  const daysMatch = c => S.f.days === 'all' || (S.f.days === 'other' ? ![14, 24].includes(c.days) : c.days === +S.f.days);
  const statusMatch = o => S.f.status === 'all' || (S.f.status === 'pending' ? (o.state === 'due' || o.state === 'missed') : o.state === S.f.status);
  const baseOk = o => inLoc(o.p.location) && matchQuery(o.p, S.f.q) && daysMatch(o.c);
  const viewOcc = () => allOcc().filter(o => baseOk(o) && statusMatch(o));
  const pendingAll = () => allOcc().filter(o => inLoc(o.p.location) && (o.state === 'due' || o.state === 'missed'));
  const filtersOn = () => !!(S.f.q || S.f.status !== 'all' || S.f.days !== 'all');

  function message(p, c, text) {
    const cl = S.data.settings.clinics[p.location] || {};
    const vars = { doctor: docName(p.doctor) || 'Dr Somani', name: p.name, first: p.name.split(/\s+/)[0], days: c.days, clinic: cl.name || shortLoc(p.location),
      clinicPhone: cl.phone || '', regNo: p.regNo, completed: fmt(c.dueDate), lastTablet: fmt(lastTablet(c)), medicine: c.medicine || '' };
    return text.split('\n')
      .filter(line => !(line.includes('{clinicPhone}') && !vars.clinicPhone))
      .join('\n')
      .replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  }
  const waUrl = (phone, text) => `https://wa.me/91${phone}${text ? '?text=' + encodeURIComponent(text) : ''}`;

  function patientStatus(p) {
    if (p.archived) return { k: 'closed', label: 'Archived', order: 9 };
    const c = openCourse(p.id);
    if (!c) return { k: 'closed', label: 'No active course', order: 8 };
    const os = occurrencesOf(c, p);
    if (os.some(o => o.state === 'due' || o.state === 'missed')) return { k: 'due', label: 'To remind', order: 0, c };
    const all = occurrencesOf(c, p, true), done = all.filter(o => o.date <= today()).length;
    if (done < all.length) return { k: 'course', label: `On treatment · ${done}/${all.length}`, order: 3, c };
    return { k: 'waiting', label: 'Plan complete · review', order: 1, c };
  }

  // ---------- data & API ----------
  function setData(d) {
    S.data = d;
    reindex();
  }
  function reindex() {
    const pat = new Map(), cbp = new Map();
    for (const p of S.data.patients) pat.set(p.id, p);
    for (const c of S.data.courses) { let a = cbp.get(c.patientId); if (!a) cbp.set(c.patientId, a = []); a.push(c); }
    S.idx = { pat, cbp };
    _occ = null;
  }
  // Server replies are either a full snapshot, a small per-patient patch, or new settings
  function applyResponse(d, delta = false) {
    if (d.rev != null && S.data && d.rev < (S.data.rev || 0)) return;   // older than what we have — ignore
    if (d.locations) { setData(d); return; }
    const expected = delta ? d.rev : (S.data.rev || 0) + 1;
    if (d.settings) S.data.settings = d.settings;
    if (d.patch) {
      const ids = new Set(d.patch.patientIds);
      for (const p of d.patch.patients) {
        const i = S.data.patients.findIndex(x => x.id === p.id);
        if (i >= 0) S.data.patients[i] = p; else S.data.patients.push(p);
      }
      S.data.courses = S.data.courses.filter(c => !ids.has(c.patientId)).concat(d.patch.courses);
    }
    S.data.rev = d.rev; S.data.today = d.today;
    reindex();
    if (d.rev !== expected) load(true, true).catch(() => {});   // someone else changed data meanwhile — fetch everything
  }
  async function api(method, url, body) {
    const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 401) { location.replace('/'); throw new Error('Signed out'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: res.status });
    return data;
  }
  async function mutate(method, url, body, { soft = false } = {}) {
    const d = await api(method, url, body);
    applyResponse(d);
    soft ? renderChrome() : render();
    return d;
  }

  // ---------- render plumbing ----------
  function focusKey(el) {
    if (!el || el === document.body || !el.dataset) return null;
    if (!el.dataset.act && !el.id) return null;
    const sel = el.id && !el.dataset.act ? '#' + CSS.escape(el.id)
      : ['act', 'pid', 'cid', 'sid', 'k', 'view', 'loc', 'f', 'v', 'd', 'i', 'tpl'].filter(k => el.dataset[k] != null).map(k => `[data-${k}="${CSS.escape(el.dataset[k])}"]`).join('');
    const tile = el.closest('.tile, .tl-cell');
    const pid = el.dataset.pid || tile?.dataset.pid || tile?.querySelector('[data-pid]')?.dataset.pid;
    return { sel, drawer: !!el.closest('#drawer'), pid, list: el.closest('[data-list]')?.dataset.list };
  }
  function restoreFocus(k) {
    if (!k) return;
    let t = (k.drawer ? $('drawer') : document).querySelector(k.sel);
    if (!t && k.pid) t = document.querySelector(`#view [data-pid="${CSS.escape(k.pid)}"]`);
    if (!t && k.list) t = document.querySelector(`[data-list="${CSS.escape(k.list)}"] button`);
    (t || (k.drawer && !$('drawer').hidden ? $('drawer').querySelector('[data-act="close-drawer"]') : $('view')))?.focus({ preventScroll: true });
  }
  function scrolls() {
    const b = document.querySelector('.board'), tl = document.querySelector('.tl-scroll'), ms = document.querySelector('.mstrip');
    return { b: b?.scrollLeft, tl: tl ? [tl.scrollLeft, tl.scrollTop] : null, ms: ms?.scrollLeft };
  }
  function render() {
    if (!S.data) return;
    _occ = null;
    const ae = document.activeElement;
    const fk = ae && ae !== document.body ? focusKey(ae) : null;
    const sc = scrolls();
    renderChrome();
    $('view').innerHTML = VIEWS[S.view].head() + `<div id="vbody">${VIEWS[S.view].body()}</div>`;
    afterBody(sc);
    if (S.drawer) renderDrawer();
    if (fk && (!document.activeElement || document.activeElement === document.body)) restoreFocus(fk);
  }
  // Re-render only the part below the filter bar (keeps the search box, its caret and focused selects)
  function renderBody() {
    _occ = null;
    const ae = document.activeElement;
    const fk = ae && ae !== document.body && $('vbody')?.contains(ae) ? focusKey(ae) : null;
    const sc = scrolls();
    $('vbody').innerHTML = VIEWS[S.view].body();
    afterBody(sc);
    if ($('fClear')) $('fClear').hidden = !filtersOn();
    renderChrome();
    if (fk) restoreFocus(fk);
  }
  function afterBody(sc = {}) {
    const jump = S._jumpToday; S._jumpToday = false;
    const b = document.querySelector('.board');
    if (b) {
      if (sc.b != null && !jump) b.scrollLeft = sc.b;
      else { const t = b.querySelector('.col.today'); if (t) b.scrollLeft = Math.max(0, t.offsetLeft - b.offsetLeft - 8); }
    }
    const ms = document.querySelector('.mstrip');
    if (ms) {
      if (sc.ms != null && !jump) ms.scrollLeft = sc.ms;
      const on = ms.querySelector('.on');
      if (on) {
        const a = on.getBoundingClientRect(), box = ms.getBoundingClientRect();
        if (jump || a.left < box.left || a.right > box.right) ms.scrollLeft += a.left - box.left - (box.width - a.width) / 2;
      }
    }
    const tl = document.querySelector('.tl-scroll');
    if (tl) {
      if (sc.tl && !jump) [tl.scrollLeft, tl.scrollTop] = sc.tl;
      else {
        const t = tl.querySelector('.tl-day.today'), corner = tl.querySelector('.tl-corner');
        if (t) tl.scrollLeft = Math.max(0, t.getBoundingClientRect().left - tl.getBoundingClientRect().left + tl.scrollLeft - corner.offsetWidth - 2 * 38);
      }
    }
  }

  function renderChrome() {
    const n = pendingAll().length;
    document.querySelectorAll('[data-badge]').forEach(el => { el.hidden = !n; el.textContent = n > 999 ? '999+' : n; });
    document.querySelectorAll('[data-act="nav"]').forEach(el => el.classList.toggle('on', el.dataset.view === S.view));
    $('pageTitle').textContent = { board: 'Reminders', calendar: 'Calendar', timeline: 'Timeline', patients: 'Patients', settings: 'Settings' }[S.view];
    document.title = (n ? `(${n}) ` : '') + 'Dr Somani\'s Homoeopathy';
    const opts = [{ id: 'all', name: 'Both' }, ...S.data.locations.map(l => ({ id: l.id, name: shortLoc(l.id) }))];
    $('locSeg').innerHTML = opts.map(o => `<button role="radio" aria-checked="${S.loc === o.id}" data-act="loc" data-loc="${o.id}"><span class="dot ${o.id}"></span>${esc(o.id === 'all' ? 'Both clinics' : o.name)}</button>`).join('');
  }

  // ---------- shared pieces ----------
  function filterBar() {
    return `<div class="filters">
      <label class="search">${ICON.search}<input id="fSearch" type="search" placeholder="Search name, mobile, reg. no." value="${esc(S.f.q)}" aria-label="Search" autocomplete="off" enterkeyhint="search"></label>
      <select class="select" data-act="f-status" aria-label="Status">
        ${[['all', 'All reminders'], ['pending', 'To send'], ['missed', 'Missed'], ['sent', 'Sent'], ['scheduled', 'Upcoming']].map(([v, l]) => `<option value="${v}" ${S.f.status === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <select class="select" data-act="f-days" aria-label="Course length">
        ${[['all', 'All courses'], ['14', '14-day'], ['24', '24-day'], ['other', 'Other']].map(([v, l]) => `<option value="${v}" ${S.f.days === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <button class="link-btn" data-act="f-clear" id="fClear" ${filtersOn() ? '' : 'hidden'}>Clear</button>
    </div>`;
  }
  const legend = (med = false) => `<div class="legend">${med ? '<span><i class="sw med"></i><i class="sw med p" style="margin-left:-4px"></i>On medicine</span>' : ''}<span><i class="sw due"></i>To send</span><span><i class="sw sent"></i>Sent</span><span><i class="sw missed"></i>Missed</span><span><i class="sw scheduled"></i>Upcoming</span></div>`;

  // Compact tile: one planned reminder for one patient
  function tile(o, { showDate = false } = {}) {
    const { c, p, st, i, r, state } = o;
    const n = planOf(c).length;
    const label = `${p.name}, ${code(c, i)}: reminder ${i + 1} of ${n} (day ${dayNo(c, i)}), ${STATE_LABEL[state]}`;
    const meta = `<b class="code">${code(c, i)}</b>${stepDots(c, i)}<span>${showDate ? fmt(o.date) + ' · ' : ''}${esc(p.regNo)}</span>`;
    let right;
    if (state === 'due' || state === 'missed') right = `<button class="t-go ${state}" data-act="send" data-cid="${c.id}" data-sid="${st.id}" aria-label="Send reminder to ${esc(p.name)}">${ICON.wa}</button>`;
    else if (state === 'sent') right = `<span class="t-time">${localDate(new Date(r.at)) === o.date ? fmtTime(r.at) : fmt(localDate(new Date(r.at)))}</span>`;
    else right = '';
    return `<article class="tile ${state} ${p.location}" aria-label="${esc(label)}" title="${esc(`${code(c, i)} · reminder ${i + 1} of ${n} · day ${dayNo(c, i)} · ${docName(p.doctor)}`)}">
      <span class="t-state" aria-hidden="true">${state === 'sent' ? ICON.check : state === 'missed' ? '!' : ''}</span>
      <button class="t-main" data-act="open" data-pid="${p.id}"><b>${esc(p.name)}</b><small>${meta}</small></button>
      ${right}
    </article>`;
  }
  // ● ● ○ — one dot per reminder in this course's plan: green sent, red missed, outlined due today; the ring marks this tile's reminder
  function stepDots(c, cur) {
    const t = today();
    return `<span class="steps-dots" aria-hidden="true">${planOf(c).map((st, k) => {
      const sent = sentFor(c, st), d = stepDate(c, st);
      const cls = sent ? 's' : !isOpen(c) ? 'x' : d < t ? 'm' : d === t ? 'd' : '';
      return `<i class="${cls}${k === cur ? ' c' : ''}"></i>`;
    }).join('')}</span>`;
  }
  const stateOrder = { missed: 0, due: 1, scheduled: 2, sent: 3 };
  const byState = (a, b) => stateOrder[a.state] - stateOrder[b.state] || a.p.name.localeCompare(b.p.name);
  const GROUP = { missed: 'Missed', due: 'To send', scheduled: 'Upcoming', sent: 'Sent' };
  // A day's tiles, grouped by state with small headers
  function dayList(list, key, opts = {}) {
    if (!list.length) return `<div class="col-empty">${opts.future ? 'Nothing scheduled' : 'No reminders'}</div>`;
    list.sort(byState);
    const groups = {};
    for (const o of list) (groups[o.state] ||= []).push(o);
    const keys = Object.keys(groups);
    return keys.map(k => `${keys.length > 1 || k === 'sent' ? `<div class="grp ${k}"><span>${GROUP[k]}</span><b>${groups[k].length}</b></div>` : ''}${groups[k].map(o => tile(o, opts)).join('')}`).join('');
  }

  // ---------- Board (kanban by day) ----------
  const BOARD_DAYS = 7;
  function boardHead() {
    return filterBar() + `<div class="board-nav">
      <button class="icon-btn sm" data-act="b-prev" aria-label="Earlier days">${ICON.left}</button>
      <button class="btn sm" data-act="b-today">Today</button>
      <button class="icon-btn sm" data-act="b-next" aria-label="Later days">${ICON.right}</button>
      <span class="range">${fmt(S.boardStart)} – ${fmt(addDays(S.boardStart, BOARD_DAYS - 1))}</span>
      ${legend()}
    </div>`;
  }
  function boardData() {
    const t = today(), start = S.boardStart;
    const occ = viewOcc();
    const days = Array.from({ length: BOARD_DAYS }, (_, k) => addDays(start, k));
    const byDate = {};
    for (const o of occ) (byDate[o.date] ||= []).push(o);
    const earlier = occ.filter(o => o.date < start && o.state === 'missed').sort((a, b) => a.date.localeCompare(b.date));
    return { t, start, days, byDate, earlier };
  }
  function summary() {
    const t = today();
    const todayAll = allOcc().filter(o => baseOk(o) && o.date === t);
    const tDone = todayAll.filter(o => o.state === 'sent').length;
    const missed = allOcc().filter(o => baseOk(o) && o.state === 'missed').length;
    const left = todayAll.length - tDone;
    const R = 22, C = 2 * Math.PI * R, pct = todayAll.length ? tDone / todayAll.length : 0;
    const h = new Date().getHours();
    return `<div class="summary">
      <div class="sum-today">
        <div class="ring" role="img" aria-label="${tDone} of ${todayAll.length} reminders sent today"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="${R}" fill="none" stroke="var(--line)" stroke-width="6"/><circle cx="26" cy="26" r="${R}" fill="none" stroke="var(--ok)" stroke-width="6" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/></svg><b>${Math.round(pct * 100)}%</b></div>
        <div><h2>${left ? `${plural(left, 'reminder')} to send today` : todayAll.length ? 'Today’s reminders are done ✓' : 'Nothing due today'}</h2>
        <p>${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}, ${esc(S.user.name)} · ${new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</p></div>
      </div>
      <div class="sum-pills">
        <div class="pill red"><b>${left}</b><span>to send</span></div>
        <button class="pill ${missed ? 'red' : ''}" data-act="f-missed"><b>${missed}</b><span>missed</span></button>
        <div class="pill green"><b>${tDone}</b><span>sent today</span></div>
      </div>
    </div>`;
  }
  function boardBody() {
    const { t, days, byDate, earlier, start } = boardData();
    if (MOBILE()) return summary() + mobileBoard({ t, days, byDate, earlier, start });
    const cols = [];
    if (earlier.length) cols.push(column({ key: 'earlier', title: 'Earlier', sub: `Missed before ${fmt(start)}`, list: earlier, cls: 'earlier', dateHtml: '!', showDate: true }));
    for (const d of days) {
      const rel = diff(t, d);
      const title = rel === 0 ? 'Today' : rel === -1 ? 'Yesterday' : rel === 1 ? 'Tomorrow' : DOW[dow(d)];
      cols.push(column({ key: d, title, sub: `${DOW[dow(d)]}, ${fmt(d)}`, list: byDate[d] || [], cls: d === t ? 'today' : '', dateHtml: `<small>${MONTHS[+d.slice(5, 7) - 1]}</small><b>${+d.slice(8, 10)}</b>`, future: d > t }));
    }
    return summary() + `<div class="board" role="list">${cols.join('')}</div>`;
  }
  function column({ key, title, sub, list, cls, dateHtml, future, showDate }) {
    const done = list.filter(o => o.state === 'sent').length;
    const total = list.length;
    const showBar = !future && key !== 'earlier';
    return `<section class="col ${cls}" role="listitem" aria-label="${esc(title)}, ${esc(sub)}">
      <div class="col-head">
        <span class="col-date">${dateHtml}</span>
        <span class="col-title">${esc(title)}</span>
        <span class="col-count ${showBar && total && done === total ? 'done' : ''}">${showBar ? `${done}/${total}` : total}</span>
        <span class="col-sub">${esc(sub)}</span>
      </div>
      <div class="col-bar ${showBar ? '' : 'off'}"><i style="width:${showBar && total ? Math.round(done / total * 100) : 0}%"></i></div>
      <div class="col-body" data-list="${key}">${dayList(list.slice(), key, { future, showDate })}</div>
    </section>`;
  }
  // Phone: a strip of day tabs (with done/total) and one list for the chosen day
  function mobileBoard({ t, days, byDate, earlier }) {
    if (S.mDay !== 'earlier' && !days.includes(S.mDay)) S.mDay = days.includes(t) ? t : days[0];
    if (S.mDay === 'earlier' && !earlier.length) S.mDay = days.includes(t) ? t : days[0];
    const chip = (key, top, mid, list, cls = '') => {
      const done = list.filter(o => o.state === 'sent').length, future = key !== 'earlier' && key > t;
      return `<button class="mchip ${cls} ${S.mDay === key ? 'on' : ''}" role="tab" aria-selected="${S.mDay === key}" data-act="m-day" data-d="${key}">
        <small>${top}</small><b>${mid}</b><i class="${!future && list.length && done === list.length ? 'done' : ''}">${key === 'earlier' || future ? list.length : `${done}/${list.length}`}</i></button>`;
    };
    const chips = (earlier.length ? chip('earlier', 'Earlier', '!', earlier, 'earlier') : '') + days.map(d => chip(d, d === t ? 'Today' : DOW[dow(d)], +d.slice(8, 10), byDate[d] || [], d === t ? 'today' : '')).join('');
    const key = S.mDay;
    const list = key === 'earlier' ? earlier : (byDate[key] || []);
    const done = list.filter(o => o.state === 'sent').length;
    const future = key !== 'earlier' && key > t;
    const title = key === 'earlier' ? 'Missed earlier' : key === t ? 'Today' : `${DOW[dow(key)]}, ${fmt(key)}`;
    const todayShown = days.includes(t);
    return `<div class="mnav">
        <button class="icon-btn sm" data-act="b-prev" aria-label="Earlier days">${ICON.left}</button>
        <div class="mstrip" role="tablist" aria-label="Day">${chips}</div>
        <button class="icon-btn sm" data-act="b-next" aria-label="Later days">${ICON.right}</button>
      </div>
      ${!todayShown || S.mDay !== t ? `<button class="btn sm mtoday" data-act="b-today">${ICON.left}Back to today</button>` : ''}
      <div class="mday">
        <div class="mday-head"><b>${esc(title)}</b><span>${future || key === 'earlier' ? plural(list.length, 'reminder') : `${done} of ${list.length} sent`}</span></div>
        ${!future && key !== 'earlier' ? `<div class="col-bar"><i style="width:${list.length ? Math.round(done / list.length * 100) : 0}%"></i></div>` : ''}
        <div class="mlist" data-list="${key}">${dayList(list.slice(), key, { future, showDate: key === 'earlier' })}</div>
      </div>`;
  }

  // ---------- Calendar ----------
  function calHead() {
    const [y, m] = S.calMonth.split('-').map(Number);
    return filterBar() + `<div class="cal-head">
      <button class="icon-btn sm" data-act="c-prev" aria-label="Previous month">${ICON.left}</button>
      <h2>${MONTHS_FULL[m - 1]} ${y}</h2>
      <button class="icon-btn sm" data-act="c-next" aria-label="Next month">${ICON.right}</button>
      <button class="btn sm" data-act="c-today">Today</button>
      ${legend()}
    </div>`;
  }
  function calBody() {
    const t = today();
    const [y, m] = S.calMonth.split('-').map(Number);
    const first = `${y}-${pad(m)}-01`;
    const gridStart = addDays(first, -((dow(first) + 6) % 7));    // Monday-first grid
    const byDate = {};
    for (const o of viewOcc()) (byDate[o.date] ||= []).push(o);
    let cells = '';
    for (let k = 0; k < 42; k++) {
      const d = addDays(gridStart, k);
      if (k >= 35 && d.slice(5, 7) !== pad(m)) break;
      const list = (byDate[d] || []).sort(byState);
      const unsent = list.filter(o => o.state !== 'sent').length;
      const sent = list.length - unsent;
      const missed = list.filter(o => o.state === 'missed').length;
      const pct = list.length ? Math.round(sent / list.length * 100) : 0;
      cells += `<button class="cal-cell ${d.slice(5, 7) !== pad(m) ? 'out' : ''} ${d === t ? 'today' : ''} ${d === S.calDay ? 'sel' : ''}" data-act="c-day" data-d="${d}"
        aria-label="${fmt(d)}: ${list.length} reminders, ${sent} sent${missed ? `, ${missed} missed` : ''}" aria-pressed="${d === S.calDay}">
        <span class="cal-num">${+d.slice(8, 10)}</span>
        ${list.length ? `<span class="cal-total">${list.length}</span>
        <span class="cal-meter ${d > t ? 'future' : ''}"><i style="width:${pct}%"></i>${missed ? `<em style="width:${Math.round(missed / list.length * 100)}%"></em>` : ''}</span>
        <span class="cal-counts">${d > t ? `<i class="f">${unsent} upcoming</i>` : `${sent ? `<i class="s">${sent} ✓</i>` : ''}${missed ? `<i class="m">${missed} missed</i>` : ''}${unsent - missed ? `<i class="p">${unsent - missed} to send</i>` : ''}`}</span>` : ''}
      </button>`;
    }
    const sel = (byDate[S.calDay] || []).slice();
    const sd = S.calDay;
    const selDone = sel.filter(o => o.state === 'sent').length;
    return `<div class="cal-wrap">
      <div class="cal"><div class="cal-dow">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<span>${MOBILE() ? d[0] : d}</span>`).join('')}</div><div class="cal-grid">${cells}</div></div>
      <aside class="day-panel" aria-live="polite">
        <div class="dp-head"><h3>${sd === t ? 'Today' : `${DOW[dow(sd)]}, ${fmt(sd)}`}</h3><span>${sel.length ? `${selDone} of ${sel.length} sent` : 'No reminders'}</span></div>
        <div class="dp-list" data-list="cal-${sd}">${sel.length ? dayList(sel, sd, { future: sd > t }) : ''}</div>
      </aside>
    </div>`;
  }

  // ---------- Timeline (patients × days) ----------
  const TL_DAYS = 28;
  function tlHead() {
    return filterBar() + `<div class="tl-head">
      <button class="icon-btn sm" data-act="t-prev" aria-label="Earlier">${ICON.left}</button>
      <button class="btn sm" data-act="t-today">Today</button>
      <button class="icon-btn sm" data-act="t-next" aria-label="Later">${ICON.right}</button>
      <span class="range">${fmt(S.tlStart)} – ${fmt(addDays(S.tlStart, TL_DAYS - 1))}</span>
      ${legend(true)}
    </div>`;
  }
  function tlBody() {
    const t = today();
    const start = S.tlStart, end = addDays(start, TL_DAYS - 1);
    const days = Array.from({ length: TL_DAYS }, (_, k) => addDays(start, k));
    const occByP = new Map();
    for (const o of allOcc()) if (o.date >= start && o.date <= end && baseOk(o)) { let a = occByP.get(o.p.id); if (!a) occByP.set(o.p.id, a = []); a.push(o); }
    const rows = [];
    for (const p of S.data.patients) {
      if (p.archived || !inLoc(p.location) || !matchQuery(p, S.f.q)) continue;
      const cs = (S.idx.cbp.get(p.id) || []).filter(c => daysMatch(c) && c.startDate <= end && c.dueDate > start);
      const po = occByP.get(p.id) || [];
      if (!cs.length && !po.length) continue;
      if (S.f.status !== 'all' && !po.some(statusMatch)) continue;
      const pend = po.filter(o => o.state === 'due' || o.state === 'missed').map(o => o.date).sort()[0];
      const next = pend ? '0' + pend : (po.filter(o => o.state === 'scheduled').map(o => o.date).sort()[0] || '9999');
      rows.push({ p, cs, po, next });
    }
    rows.sort((a, b) => a.next.localeCompare(b.next) || a.p.name.localeCompare(b.p.name));
    if (!rows.length) return `<div class="empty"><div class="e-ico">🗓️</div><b>No patients in this period</b>Try another date range or clear the filters.</div>`;
    const shown = rows.slice(0, S.tlLimit);
    const head = `<div class="tl-corner">Patients · ${rows.length}</div>` + days.map(d =>
      `<div class="tl-day ${d === t ? 'today' : ''} ${dow(d) === 1 ? 'mon' : ''}"><small>${d === t ? 'Today' : DOW[dow(d)][0] + (d.slice(8, 10) === '01' ? ' ' + MONTHS[+d.slice(5, 7) - 1] : '')}</small><b>${+d.slice(8, 10)}</b></div>`).join('');
    const body = shown.map(({ p, cs, po }) => {
      const nameCell = `<div class="tl-name"><span class="dot ${p.location}"></span><button data-act="open" data-pid="${p.id}"><b>${esc(p.name)}</b><small>${esc(p.regNo)}</small></button></div>`;
      const cells = days.map(d => {
        const c = cs.find(c => c.startDate <= d && d < c.dueDate);
        const med = c ? `<span class="med ${d === c.startDate ? 'first' : ''} ${d === lastTablet(c) ? 'last' : ''}"></span>` : '';
        const o = po.find(o => o.date === d);
        const cls = `tl-cell ${p.location} ${d === t ? 'today' : ''} ${dow(d) === 1 ? 'mon' : ''}`;
        if (!o) return `<div class="${cls}" ${c ? `title="${esc(p.name)} · on medicine (${c.days}-day course)"` : ''}>${med}</div>`;
        const label = `${p.name} · ${code(o.c, o.i)} (day ${dayNo(o.c, o.i)}) · ${STATE_LABEL[o.state]} · ${fmt(d)}`;
        const act = o.state === 'due' || o.state === 'missed' ? `data-act="send" data-cid="${o.c.id}" data-sid="${o.st.id}" data-pid="${p.id}"` : `data-act="open" data-pid="${p.id}" data-d="${d}"`;
        return `<button class="${cls}" ${act} title="${esc(label)}" aria-label="${esc(label)}">${med}<span class="blk ${o.state}">${o.state === 'sent' ? '✓' : o.state === 'missed' ? '!' : o.i + 1}</span></button>`;
      }).join('');
      return nameCell + cells;
    }).join('');
    return `<div class="tl-scroll"><div class="tl" style="grid-template-columns: var(--tl-name) repeat(${TL_DAYS}, var(--tl-day))">${head}${body}</div></div>
      ${rows.length > shown.length ? `<div class="more"><span>Showing ${shown.length} of ${rows.length} patients (most urgent first)</span><button class="btn sm" data-act="tl-more">Show ${Math.min(60, rows.length - shown.length)} more</button></div>` : ''}`;
  }

  // ---------- Patients ----------
  function patientsHead() {
    const filters = [['all', 'All'], ['due', 'To remind'], ['course', 'On medicine'], ['waiting', 'Waiting'], ['closed', 'No active course'], ['archived', 'Archived']];
    return `<div class="filters">
        <label class="search">${ICON.search}<input id="pSearch" type="search" placeholder="Search name, mobile or reg. no." value="${esc(S.pq)}" aria-label="Search patients" autocomplete="off" enterkeyhint="search"></label>
      </div>
      <div class="tabs" role="tablist" style="margin-bottom:12px">${filters.map(([k, l]) => `<button class="tab ${S.pFilter === k ? 'on' : ''}" role="tab" aria-selected="${S.pFilter === k}" data-act="pfilter" data-f="${k}">${l}</button>`).join('')}</div>`;
  }
  function patientsBody() {
    const rows = S.data.patients
      .filter(p => inLoc(p.location) && (S.pFilter === 'archived' ? p.archived : !p.archived) && matchQuery(p, S.pq))
      .map(p => ({ p, st: patientStatus(p) }))
      .filter(({ st }) => S.pFilter === 'all' || S.pFilter === 'archived' || st.k === S.pFilter)
      .sort((a, b) => a.st.order - b.st.order || a.p.name.localeCompare(b.p.name));
    const shown = rows.slice(0, S.pLimit);
    return `<div class="count" aria-live="polite">${plural(rows.length, 'patient')}</div>
      ${rows.length ? `<div class="ptable">
        <div class="prow head" aria-hidden="true"><span>Patient</span><span class="c-phone">Mobile</span><span class="c-loc">Clinic</span><span class="c-course">Current course</span><span>Status</span></div>
        ${shown.map(({ p, st }) => `<button class="prow" data-act="open" data-pid="${p.id}">
            <span class="p-who"><span class="avatar sm ${p.location}" aria-hidden="true">${esc(initials(p.name))}</span><span style="min-width:0"><b>${esc(p.name)}</b><span class="reg">${esc(p.regNo)} · ${esc(docName(p.doctor).replace('Dr ', 'Dr. '))}${p.age != null ? ` · ${p.age}y` : ''}${p.sample ? ' · sample' : ''}</span></span></span>
            <span class="p-cell c-phone">${phoneFmt(p.phone)}</span>
            <span class="p-cell c-loc"><span class="chip ${p.location}">${esc(shortLoc(p.location))}</span></span>
            <span class="p-cell c-course">${st.c ? `<strong>Every ${st.c.days} days</strong> × ${planOf(st.c).length}` : '—'}</span>
            <span><span class="chip ${st.k}">${st.label}</span></span>
          </button>`).join('')}
      </div>
      ${rows.length > shown.length ? `<div class="more"><span>Showing ${shown.length} of ${rows.length}</span><button class="btn sm" data-act="p-more">Show ${Math.min(100, rows.length - shown.length)} more</button></div>` : ''}`
      : `<div class="empty"><div class="e-ico">🔍</div><b>${S.pq ? 'No matching patients' : 'No patients here yet'}</b>${S.pq ? 'Try a different name or number.' : 'Tap “+” to add the first one.'}</div>`}`;
  }

  // ---------- Settings ----------
  const planDraftFrom = s => clone({ planDefaults: s.planDefaults, doctorDefault: s.doctorDefault });
  function settingsDirty() {
    if (S.view !== 'settings' || !S.planDraft) return false;
    const s = S.data.settings;
    if (JSON.stringify(S.planDraft) !== JSON.stringify(planDraftFrom(s))) return true;
    if (JSON.stringify(S.tplDraft) !== JSON.stringify(s.templates)) return true;
    return S.data.locations.some(l => {
      const n = document.querySelector(`[data-clinic-name="${l.id}"]`), ph = document.querySelector(`[data-clinic-phone="${l.id}"]`);
      return n && ph && (n.value !== (s.clinics[l.id]?.name || '') || ph.value !== (s.clinics[l.id]?.phone || ''));
    });
  }
  function settingsBody() {
    const s = S.data.settings;
    S.planDraft ||= planDraftFrom(s);
    S.tplDraft ||= clone(s.templates);
    const sample = S.data.patients.some(p => p.sample);
    return `<div class="settings">
      <section class="box" id="planBox">${planBox()}</section>
      <section class="box">
        <h3>Messages</h3>
        <p>Ready-made WhatsApp messages. You pick one before sending and can still edit it each time. Tap a tag to insert patient details.</p>
        <div id="tplList">${S.tplDraft.map((t, i) => tplEditor(t, i)).join('')}</div>
        <div class="actions">
          <button class="btn ghost" data-act="tpl-add" ${S.tplDraft.length >= 12 ? 'disabled' : ''}>${ICON.plus}New message</button>
          <button class="btn primary" data-act="tpl-save">Save messages</button>
        </div>
      </section>
      <section class="box">
        <h3>Clinics</h3>
        <p>Name and phone number used inside messages.</p>
        ${S.data.locations.map(l => `<div class="grid2" style="margin-bottom:12px">
            <label class="f"><span><span class="dot ${l.id}" style="margin-right:6px"></span>${esc(l.name)} — name in messages</span><input data-clinic-name="${l.id}" maxlength="60" value="${esc(s.clinics[l.id]?.name)}"></label>
            <label class="f"><span>${esc(l.name)} — phone</span><input data-clinic-phone="${l.id}" maxlength="20" inputmode="tel" value="${esc(s.clinics[l.id]?.phone)}"></label>
          </div>`).join('')}
        <div class="actions"><button class="btn primary" data-act="clinics-save">Save clinics</button></div>
      </section>
      <section class="box">
        <h3>Appearance & account</h3>
        <p>Signed in as ${esc(S.user.name)} (${esc(S.user.email)}).</p>
        <div class="actions" style="justify-content:flex-start">
          <button class="btn" data-act="theme">Switch light / dark</button>
          ${'Notification' in window && Notification.permission === 'default' ? `<button class="btn" data-act="notify">${ICON.bell}Turn on alerts</button>` : ''}
          <button class="btn danger" data-act="logout">Sign out</button>
        </div>
      </section>
      <section class="box">
        <h3>Data</h3>
        <p>Download all patients with their current course and reminder status (opens in Excel).</p>
        <div class="actions" style="justify-content:flex-start">
          <button class="btn" data-act="export">${ICON.download}Export patients (CSV)</button>
          ${sample ? `<button class="btn danger" data-act="clear-sample">Remove sample patients</button>` : ''}
        </div>
      </section>
    </div>`;
  }
  function planBox() {
    const d = S.planDraft, pd = d.planDefaults;
    const tpls = S.data.settings.templates;
    const nOpts = sel => Array.from({ length: 24 }, (_, k) => k + 1).map(n => `<option value="${n}" ${n === sel ? 'selected' : ''}>${n}</option>`).join('');
    const tOpts = sel => tpls.map(t => `<option value="${esc(t.id)}" ${t.id === sel ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
    return `<h3>Treatment defaults</h3>
      <p>Pre-filled when adding a patient — staff can change them for any patient. One reminder goes out on every refill day (14DR1 = day 14, 14DR2 = day 28 …).</p>
      <div class="grid2">
        <label class="f"><span>14-day plan · intervals</span><select class="select" data-act="pd" data-k="i14">${nOpts(+pd.intervals[14])}</select><small>${pd.intervals[14]} × 14 days ≈ ${Math.round(14 * pd.intervals[14] / 30)} months</small></label>
        <label class="f"><span>28-day plan · intervals</span><select class="select" data-act="pd" data-k="i28">${nOpts(+pd.intervals[28])}</select><small>${pd.intervals[28]} × 28 days ≈ ${Math.round(28 * pd.intervals[28] / 30)} months</small></label>
        <label class="f"><span>Message on each refill day</span><select class="select" data-act="pd" data-k="regularTpl">${tOpts(pd.regularTpl)}</select></label>
        <label class="f"><span>Message on the last refill</span><select class="select" data-act="pd" data-k="lastTpl">${tOpts(pd.lastTpl)}</select></label>
        ${S.data.locations.map(l => `<label class="f"><span><span class="dot ${l.id}" style="margin-right:6px"></span>Default doctor · ${esc(l.name)}</span><select class="select" data-act="pd" data-k="doc-${l.id}">${S.data.doctors.map(doc => `<option value="${doc.id}" ${d.doctorDefault[l.id] === doc.id ? 'selected' : ''}>${esc(doc.name)}</option>`).join('')}</select></label>`).join('')}
      </div>
      <div class="actions"><button class="btn primary" data-act="plan-save">Save defaults</button></div>`;
  }
  const VARS = ['first', 'name', 'days', 'clinic', 'clinicPhone', 'completed', 'lastTablet', 'medicine', 'regNo'];
  function tplEditor(t, i) {
    return `<div class="tpl-edit">
      <div class="te-head">
        <input data-act="te-name" data-i="${i}" value="${esc(t.name)}" maxlength="40" aria-label="Message name">
        <button class="icon-btn sm" data-act="tpl-del" data-i="${i}" aria-label="Delete message ${esc(t.name)}" ${S.tplDraft.length <= 1 ? 'disabled' : ''}>${ICON.trash}</button>
      </div>
      <textarea data-act="te-text" data-i="${i}" maxlength="1500" aria-label="Message text for ${esc(t.name)}">${esc(t.text)}</textarea>
      <div class="vars">${VARS.map(v => `<button type="button" data-act="var" data-i="${i}" data-v="${v}">{${v}}</button>`).join('')}</div>
    </div>`;
  }

  const VIEWS = {
    board: { head: boardHead, body: boardBody },
    calendar: { head: calHead, body: calBody },
    timeline: { head: tlHead, body: tlBody },
    patients: { head: patientsHead, body: patientsBody },
    settings: { head: () => '', body: settingsBody },
  };

  // ---------- Drawer ----------
  function openDrawer(pid) {
    S.drawer = pid;
    S._drawerReturn = focusKey(document.activeElement);
    renderDrawer();
    $('scrim').hidden = false;
    $('drawer').hidden = false;
    $('drawer').querySelector('[data-act="close-drawer"]').focus();
  }
  function closeDrawer() {
    S.drawer = null;
    $('drawer').hidden = true;
    if ($('modal').hidden) $('scrim').hidden = true;
    restoreFocus(S._drawerReturn);
  }
  function renderDrawer() {
    const p = patient(S.drawer);
    if (!p) return closeDrawer();
    const cs = coursesOf(p.id);
    const cur = cs.find(isOpen);
    let curHtml = `<div class="empty" style="padding:20px">${p.archived ? 'Patient is archived.' : 'No active course.'}${p.archived ? '' : `<div style="margin-top:10px"><button class="btn primary sm" data-act="renew" data-pid="${p.id}">${ICON.pill}Start new course</button></div>`}</div>`;
    if (cur) {
      const osAll = occurrencesOf(cur, p, true);
      const passed = osAll.filter(o => o.r).length;
      const day = passed, done = passed >= osAll.length;
      const R = 36, C = 2 * Math.PI * R;
      const os = occurrencesOf(cur, p, true);
      curHtml = `<div class="course-head">
          <div class="ring big" role="img" aria-label="${done ? 'Plan complete' : `${day} of ${osAll.length} refills`}"><svg viewBox="0 0 84 84"><circle cx="42" cy="42" r="${R}" fill="none" stroke="var(--soft)" stroke-width="8"/><circle cx="42" cy="42" r="${R}" fill="none" stroke="${done ? 'var(--ok)' : p.location === 'pune' ? 'var(--pun)' : 'var(--jal)'}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - day / Math.max(1, osAll.length))}"/></svg>
            <b>${done ? '✓' : day}<small>${done ? 'all sent' : `of ${osAll.length} sent`}</small></b></div>
          <div class="course-info">
            <div><b>${cur.days}-day medicine · ${plural(planOf(cur).length, 'interval')}</b></div>
            <div class="muted">Started ${fmt(cur.startDate)} · next refill ${fmt((os.find(o => o.state !== 'sent' && o.date >= today()) || os[os.length - 1]).date)} · plan ends ${fmt(os[os.length - 1].date)}</div>
            <div class="muted">${esc(docName(p.doctor))}</div>
            ${cur.medicine ? `<div class="rx">${esc(cur.medicine)}</div>` : ''}
          </div>
        </div>
        <div class="plan-label"><span>Every ${cur.days} days · ${plural(planOf(cur).length, 'interval')} · ${os.filter(o => o.r).length} sent</span><button class="link-btn" data-act="course-plan" data-cid="${cur.id}">Change intervals</button></div>
        <div class="plan">${os.map(o => {
          const t = o.r && tpl(o.r.templateId);
          const btn = o.state === 'due' || o.state === 'missed' ? `<button class="btn ${o.state === 'due' ? 'red' : ''} xs" data-act="send" data-cid="${cur.id}" data-sid="${o.st.id}">${ICON.wa}Send</button>`
            : o.state === 'sent' ? `<button class="btn ghost xs" data-act="unsent" data-cid="${cur.id}" data-sid="${o.st.id}">Undo</button>`
            : `<button class="btn ghost xs" data-act="send" data-cid="${cur.id}" data-sid="${o.st.id}">Send early</button>`;
          return `<div class="plan-row ${o.state}"><span class="n">${o.state === 'sent' ? '✓' : o.state === 'missed' ? '!' : o.i + 1}</span>
            <div><b>${code(cur, o.i)} · ${fmt(o.date)}</b><small>${o.r ? `Sent ${fmtWhen(o.r.at)} by ${esc(o.r.by)}${t ? ' · ' + esc(t.name) : ''}` : `${STATE_LABEL[o.state]} · day ${dayNo(cur, o.i)}`}</small></div>${btn}</div>`;
        }).join('')}</div>
        <div class="course-actions">
          <button class="btn primary sm" data-act="renew" data-pid="${p.id}">${ICON.pill}New treatment plan</button>
          <button class="btn ghost sm danger" data-act="stop" data-cid="${cur.id}">Stop course</button>
        </div>`;
    }
    const stepName = (c, r) => { const st = stepById(c, r.stepId); return st ? code(c, stepNo(c, st) - 1) : 'Reminder (earlier plan)'; };
    $('drawer').innerHTML = `
      <div class="dr-head">
        <span class="avatar ${p.location}" aria-hidden="true">${esc(initials(p.name))}</span>
        <div><h2 id="drawerTitle">${esc(p.name)}</h2><div class="row"><span class="reg">${esc(p.regNo)}</span><span class="chip ${p.location}">${esc(shortLoc(p.location))}</span>${p.archived ? '<span class="chip closed">Archived</span>' : ''}</div></div>
        <button class="icon-btn" data-act="close-drawer" aria-label="Close">${ICON.x}</button>
      </div>
      <div class="dr-body">
        <div class="contact-row">
          <a class="btn wa sm" href="${esc(waUrl(p.phone))}" target="_blank" rel="noopener">${ICON.wa}WhatsApp</a>
          <a class="btn sm" href="tel:+91${p.phone}">${ICON.phone}${phoneFmt(p.phone)}</a>
          <button class="btn sm" data-act="edit" data-pid="${p.id}">${ICON.edit}Edit</button>
        </div>
        <section class="box"><h3>Treatment plan & reminders</h3>${curHtml}</section>
        <section class="box"><h3>Details</h3><div class="info">
          <div><small>Doctor</small><span>${esc(docName(p.doctor)) || '—'}</span></div>
          <div><small>Age / Gender</small><span>${p.age != null ? p.age + ' yrs' : '—'}${p.gender ? ' · ' + GENDER[p.gender] : ''}</span></div>
          <div><small>Mobile</small><span>${phoneFmt(p.phone)}${p.altPhone ? `<br>${phoneFmt(p.altPhone)}` : ''}</span></div>
          <div class="full"><small>Chief complaint</small><span>${esc(p.complaint) || '—'}</span></div>
          <div class="full"><small>Address</small><span>${esc(p.address) || '—'}</span></div>
          ${p.notes ? `<div class="full"><small>Notes</small><span style="white-space:pre-wrap">${esc(p.notes)}</span></div>` : ''}
          <div><small>Registered</small><span>${fmt(localDate(new Date(p.createdAt)))}</span></div>
          <div><small>Total courses</small><span>${cs.length}</span></div>
        </div></section>
        <section class="box"><h3>History</h3><div class="hist">${cs.slice(0, 30).map(c => `<div class="hist-item ${c.status}">
            <b>Every ${c.days} days × ${planOf(c).length}</b> · from ${fmt(c.startDate)} <span class="chip ${isOpen(c) ? 'course' : 'closed'}">${isOpen(c) ? 'Current' : c.status === 'completed' ? 'Completed' : c.status === 'collected' ? 'Replaced' : 'Stopped'}</span>
            ${c.medicine ? `<p>℞ ${esc(c.medicine)}</p>` : ''}
            <p>Added by ${esc(c.createdBy)}${c.closedAt ? ` · ${c.status === 'stopped' ? 'stopped' : 'closed'} ${fmt(localDate(new Date(c.closedAt)))}${c.stopReason ? ` (${esc(c.stopReason)})` : ''}` : ''}</p>
            ${c.reminders.length ? `<ul>${c.reminders.map(r => `<li>✓ ${stepName(c, r)} sent ${fmtWhen(r.at)} by ${esc(r.by)}${tpl(r.templateId) ? ' · ' + esc(tpl(r.templateId).name) : ''}</li>`).join('')}</ul>` : ''}
            ${!isOpen(c) && !cur && !p.archived && c === cs[0] ? `<button class="btn ghost xs" style="margin-top:6px" data-act="reopen" data-cid="${c.id}">Reopen</button>` : ''}
          </div>`).join('')}</div></section>
        <div><button class="btn ghost sm ${p.archived ? '' : 'danger'}" data-act="archive" data-pid="${p.id}">${p.archived ? 'Restore patient' : 'Archive patient'}</button></div>
      </div>`;
  }

  // ---------- Modals ----------
  let modalReturn = null;
  function openModal(html, onSubmit, { wide = false } = {}) {
    modalReturn = focusKey(document.activeElement);
    const m = $('modal');
    m.innerHTML = `<form class="m-card ${wide ? 'wide' : ''}" novalidate>${html}</form>`;
    m.hidden = false;
    $('scrim').hidden = false;
    const form = m.querySelector('form');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (form.dataset.busy) return;
      const btn = form.querySelector('.m-foot:not([hidden]) [type="submit"]');
      const errBox = form.querySelector('.form-err');
      if (errBox) errBox.hidden = true;
      form.dataset.busy = '1';
      if (btn) btn.disabled = true;
      try { await onSubmit(form, e.submitter); closeModal(); }
      catch (err) {
        if (err.message === 'Signed out') return;
        if (errBox) { errBox.textContent = err.message; errBox.hidden = false; errBox.scrollIntoView({ block: 'nearest' }); } else toast(err.message);
      } finally { delete form.dataset.busy; if (btn) btn.disabled = false; }
    });
    (form.querySelector('[autofocus]') || form.querySelector('input:not([type="hidden"]), select, textarea'))?.focus();
    return form;
  }
  function closeModal() {
    $('modal').hidden = true;
    $('modal').innerHTML = '';
    if (!S.drawer) $('scrim').hidden = true;
    restoreFocus(modalReturn);
  }
  const modalHead = (title, sub) => `<div class="m-head"><div><h2 id="modalTitle">${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><button type="button" class="icon-btn" data-act="close-modal" aria-label="Close">${ICON.x}</button></div>`;

  // ---- treatment plan fields: medicine every N days × number of intervals (one reminder per refill day) ----
  function planFields(days, n) {
    const preset = [14, 28].includes(+days);
    return `<div class="f"><span>Medicine every <i>*</i></span>
        <div class="days" role="group" aria-label="Medicine interval">
          <button type="button" class="chip-btn" data-days="14" aria-pressed="${+days === 14}">14 days<small>2 weeks</small></button>
          <button type="button" class="chip-btn" data-days="28" aria-pressed="${+days === 28}">28 days<small>4 weeks</small></button>
          <input type="number" name="days" min="1" max="90" inputmode="numeric" value="${esc(days)}" aria-label="Days between refills" class="${preset ? 'quiet' : ''}">
        </div></div>
      <div class="f"><span>Number of intervals <i>*</i> <small class="muted" style="font-weight:500">· one reminder on each refill day</small></span>
        <div class="stepper">
          <button type="button" class="icon-btn" data-step="-1" aria-label="Fewer intervals">−</button>
          <input type="number" name="intervals" min="1" max="24" inputmode="numeric" value="${esc(n)}" aria-label="Number of intervals">
          <button type="button" class="icon-btn" data-step="1" aria-label="More intervals">+</button>
          <span class="muted" data-span></span>
        </div>
        <div class="due-preview" data-due></div>
      </div>`;
  }
  function wirePlan(form, startFn) {
    const dIn = form.querySelector('[name="days"]'), nIn = form.querySelector('[name="intervals"]');
    let touched = false;                                       // once staff set intervals by hand, don't override them
    const update = () => {
      form.querySelectorAll('[data-days]').forEach(b => b.setAttribute('aria-pressed', b.dataset.days === dIn.value));
      dIn.classList.toggle('quiet', ['14', '28'].includes(dIn.value));
      const d = +dIn.value, n = +nIn.value, start = startFn();
      const okD = d >= 1 && d <= 90, okN = n >= 1 && n <= 24;
      form.querySelector('[data-span]').textContent = okD && okN ? `≈ ${Math.round(d * n / 30)} month${Math.round(d * n / 30) === 1 ? '' : 's'} · ${d * n} days` : '';
      const out = form.querySelector('[data-due]');
      if (!okD || !okN || !start) { out.innerHTML = ''; return; }
      const items = Array.from({ length: n }, (_, k) => `<span><b>${d}DR${k + 1}</b> ${fmt(addDays(start, d * (k + 1)))}</span>`);
      out.innerHTML = `${plural(n, 'reminder')}: ${(n > 5 ? [...items.slice(0, 3), '<span>…</span>', items[n - 1]] : items).join('')}`;
    };
    form.querySelectorAll('[data-days]').forEach(b => b.addEventListener('click', () => { dIn.value = b.dataset.days; if (!touched) nIn.value = defaultIntervals(+dIn.value); update(); }));
    dIn.addEventListener('input', () => { if (!touched && +dIn.value >= 1) nIn.value = defaultIntervals(+dIn.value); update(); });
    form.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => { touched = true; nIn.value = Math.max(1, Math.min(24, (+nIn.value || 0) + +b.dataset.step)); update(); }));
    nIn.addEventListener('input', () => { touched = true; update(); });
    form.querySelector('[name="startDate"]')?.addEventListener('input', update);
    update();
  }

  function coursePlanForm(cid) {
    const c = S.data.courses.find(x => x.id === cid);
    const p = patient(c.patientId);
    const form = openModal(modalHead('Change intervals', `${esc(p.name)} · medicine every ${c.days} days · started ${fmt(c.startDate)}`) + `
      <div class="m-body"><div class="form-err" role="alert" hidden></div>
        <div class="f"><span>Number of intervals</span>
          <div class="stepper">
            <button type="button" class="icon-btn" data-step="-1" aria-label="Fewer intervals">−</button>
            <input type="number" name="intervals" min="1" max="24" inputmode="numeric" value="${planOf(c).length}" aria-label="Number of intervals">
            <button type="button" class="icon-btn" data-step="1" aria-label="More intervals">+</button>
          </div>
          <div class="due-preview" data-due></div>
        </div>
        ${c.reminders.length ? '<small class="muted">Reminders already sent stay as they are.</small>' : ''}
      </div>
      <div class="m-foot"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button type="submit" class="btn primary">Save</button></div>`, async f => {
      await mutate('PUT', `/api/courses/${cid}/plan`, { intervals: +f.intervals.value });
      toast(`${p.name} · ${plural(+f.intervals.value, 'interval')}`);
    });
    const nIn = form.intervals, out = form.querySelector('[data-due]');
    const upd = () => { const n = +nIn.value; out.innerHTML = n >= 1 && n <= 24 ? `Last reminder <b>${c.days}DR${n}</b> on <b>${fmt(addDays(c.startDate, c.days * n))}</b> (≈ ${Math.round(c.days * n / 30)} months)` : ''; };
    form.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => { nIn.value = Math.max(1, Math.min(24, (+nIn.value || 0) + +b.dataset.step)); upd(); }));
    nIn.addEventListener('input', upd); upd();
  }

  function patientForm(p) {
    const isNew = !p;
    p = p || { location: S.loc !== 'all' ? S.loc : (get('lastLoc') || 'jalgaon'), gender: '' };
    const form = openModal(modalHead(isNew ? 'New patient' : 'Edit patient') + `
      <div class="m-body">
        <div class="form-err" role="alert" hidden></div>
        <div class="f"><span>Clinic <i>*</i></span>
          <div class="seg" role="radiogroup" aria-label="Clinic">${S.data.locations.map(l => `<button type="button" role="radio" data-loc-pick="${l.id}" aria-checked="${p.location === l.id}"><span class="dot ${l.id}"></span>${esc(shortLoc(l.id))}</button>`).join('')}</div>
          <input type="hidden" name="location" value="${esc(p.location)}">
        </div>
        <div class="grid2">
          <label class="f"><span>Full name <i>*</i></span><input name="name" required maxlength="100" value="${esc(p.name)}" autocomplete="off" autocapitalize="words" autofocus></label>
          <label class="f"><span>Mobile number <i>*</i></span><input name="phone" required inputmode="tel" maxlength="14" value="${esc(p.phone)}" placeholder="10-digit mobile" autocomplete="off"><small data-phone-msg></small></label>
        </div>
        <div class="grid2 keep">
          <label class="f"><span>Age</span><input name="age" type="number" min="0" max="120" inputmode="numeric" value="${p.age ?? ''}"></label>
          <div class="f"><span>Gender</span>
            <div class="seg" role="radiogroup" aria-label="Gender">${[['M', 'Male'], ['F', 'Female'], ['O', 'Other']].map(([v, l]) => `<button type="button" role="radio" data-g="${v}" aria-checked="${p.gender === v}">${l}</button>`).join('')}</div>
            <input type="hidden" name="gender" value="${esc(p.gender)}">
          </div>
        </div>
        <label class="f"><span>Doctor <i>*</i></span><select name="doctor" class="select" style="width:100%;height:44px">${S.data.doctors.map(d => `<option value="${d.id}" ${(p.doctor || S.data.settings.doctorDefault[p.location]) === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>
        ${isNew ? `<div class="sect">Treatment plan</div>
          <div class="grid2">
            <label class="f"><span>Medicine given on <i>*</i></span><input type="date" name="startDate" value="${today()}" max="${addDays(today(), 1)}"></label>
            <label class="f"><span>Medicine / dosage</span><input name="medicine" maxlength="300" placeholder="e.g. Nat Mur 200 · 4 pills twice daily"></label>
          </div>${planFields(14, defaultIntervals(14))}<div class="sect">More details (optional)</div>` : ''}
        <label class="f"><span>Chief complaint</span><input name="complaint" maxlength="300" value="${esc(p.complaint)}" placeholder="e.g. Migraine, skin allergy"></label>
        <div class="grid2">
          <label class="f"><span>Alternate mobile</span><input name="altPhone" inputmode="tel" maxlength="14" value="${esc(p.altPhone)}"></label>
          <label class="f"><span>Address / area</span><input name="address" maxlength="200" value="${esc(p.address)}"></label>
        </div>
        <label class="f"><span>Notes</span><textarea name="notes" maxlength="1000">${esc(p.notes)}</textarea></label>
      </div>
      <div class="m-foot"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button type="submit" class="btn primary">${isNew ? 'Save patient' : 'Save changes'}</button></div>`, async f => {
      const v = Object.fromEntries(new FormData(f));
      if (!v.name.trim()) throw new Error('Enter the patient’s name.');
      const dup = S.data.patients.find(x => x.id !== p.id && normName(x.name) === normName(v.name));
      if (dup) throw new Error(`${dup.name} is already registered (${dup.regNo}). Open that patient instead of adding again.`);
      const body = { name: v.name, phone: v.phone, altPhone: v.altPhone, age: v.age, gender: v.gender, location: v.location, doctor: v.doctor, address: v.address, complaint: v.complaint, notes: v.notes };
      if (isNew) {
        body.course = { startDate: v.startDate, days: +v.days, intervals: +v.intervals, medicine: v.medicine };
        const d = await mutate('POST', '/api/patients', body);
        set('lastLoc', v.location);
        const np = d.patch?.patients[0];
        const c = np && openCourse(np.id);
        toast(np && c ? `${np.name} added · ${c.days}DR1 on ${fmt(stepDate(c, planOf(c)[0]))} · ${plural(planOf(c).length, 'reminder')}` : 'Patient added');
      } else {
        await mutate('PUT', `/api/patients/${p.id}`, body);
        toast('Patient updated');
      }
    });
    let docTouched = !isNew;
    form.doctor.addEventListener('change', () => { docTouched = true; });
    form.querySelectorAll('[data-loc-pick]').forEach(b => b.addEventListener('click', () => {
      form.querySelectorAll('[data-loc-pick]').forEach(x => x.setAttribute('aria-checked', x === b));
      form.location.value = b.dataset.locPick;
      if (!docTouched) form.doctor.value = S.data.settings.doctorDefault[b.dataset.locPick];   // default doctor per clinic
    }));
    // Duplicate name: warn as they type, block on save
    const nameMsg = document.createElement('small');
    form.querySelector('[name="name"]').after(nameMsg);
    form.querySelector('[name="name"]').addEventListener('input', e => {
      const dup = e.target.value.trim() && S.data.patients.find(x => x.id !== p.id && normName(x.name) === normName(e.target.value));
      nameMsg.className = dup ? 'warnmsg' : '';
      nameMsg.innerHTML = dup ? `Already registered: ${esc(dup.name)} (${esc(dup.regNo)}) · <button type="button" data-act="open-dup" data-pid="${dup.id}">Open</button>` : '';
    });
    form.querySelectorAll('[data-g]').forEach(b => b.addEventListener('click', () => {
      const on = form.gender.value === b.dataset.g;
      form.querySelectorAll('[data-g]').forEach(x => x.setAttribute('aria-checked', !on && x === b));
      form.gender.value = on ? '' : b.dataset.g;
    }));
    const msg = form.querySelector('[data-phone-msg]');
    form.phone.addEventListener('input', () => {
      const d = form.phone.value.replace(/\D/g, '').slice(-10);
      const dup = d.length === 10 && S.data.patients.find(x => x.phone === d && x.id !== p.id);
      msg.className = dup ? 'warnmsg' : '';
      msg.innerHTML = dup ? `Already registered: ${esc(dup.name)} (${esc(dup.regNo)}) · <button type="button" data-act="open-dup" data-pid="${dup.id}">Open</button>` : '';
    });
    if (isNew) wirePlan(form, () => form.startDate.value);
  }

  function renewForm(pid) {
    const p = patient(pid);
    const prev = coursesOf(pid)[0];
    const cur = openCourse(pid);
    const days = prev?.days || 14;
    const form = openModal(modalHead('New treatment plan', `${esc(p.name)} · ${esc(p.regNo)} · ${esc(shortLoc(p.location))} · ${esc(docName(p.doctor))}`) + `
      <div class="m-body">
        <div class="form-err" role="alert" hidden></div>
        ${cur ? `<p class="muted">The current plan (every ${cur.days} days) will be closed and its remaining reminders stop.</p>` : ''}
        <div class="grid2">
          <label class="f"><span>Medicine given on <i>*</i></span><input type="date" name="startDate" value="${today()}" max="${addDays(today(), 1)}"></label>
          <label class="f"><span>Medicine / dosage</span><input name="medicine" maxlength="300" value="${esc(prev?.medicine)}"></label>
        </div>
        ${planFields(days, defaultIntervals(days))}
      </div>
      <div class="m-foot"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button type="submit" class="btn primary">Start plan</button></div>`, async f => {
      const v = Object.fromEntries(new FormData(f));
      await mutate('POST', `/api/patients/${pid}/courses`, { startDate: v.startDate, days: +v.days, intervals: +v.intervals, medicine: v.medicine });
      toast(`New plan for ${p.name} · every ${v.days} days × ${v.intervals}`);
    });
    wirePlan(form, () => form.startDate.value);
    form.querySelector(`[data-days="${days}"]`)?.focus();
  }

  function stopForm(cid) {
    const c = S.data.courses.find(x => x.id === cid);
    const p = patient(c.patientId);
    openModal(modalHead('Stop this course?') + `
      <div class="m-body"><div class="form-err" role="alert" hidden></div>
        <p class="muted">${esc(p.name)} will get no more reminders for this course.</p>
        <label class="f"><span>Reason (optional)</span><input name="reason" maxlength="200" placeholder="e.g. Recovered, discontinued" autofocus></label>
      </div>
      <div class="m-foot"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button type="submit" class="btn primary">Stop course</button></div>`, async f => {
      await mutate('POST', `/api/courses/${cid}/stop`, { reason: f.reason.value });
      toast('Course stopped', { label: 'Undo', fn: () => mutate('POST', `/api/courses/${cid}/reopen`, {}) });
    });
  }

  // Pick a message → edit → open WhatsApp → confirm it was sent
  function sendModal(cid, sid) {
    const c = S.data.courses.find(x => x.id === cid);
    const st = c && stepById(c, sid);
    if (!c || !st) { toast('This reminder changed — refreshing'); load(true, true).catch(() => {}); return; }
    const p = patient(c.patientId);
    const n = planOf(c).length, i = stepNo(c, st) - 1;
    const tpls = S.data.settings.templates;
    const suggested = st.templateId;
    let chosen = tpl(suggested) ? suggested : tpls[0].id;
    let channel = 'whatsapp';
    const form = openModal(modalHead(`${code(c, i)} · ${esc(p.name)}`, `Reminder ${i + 1} of ${n} · day ${dayNo(c, i)} · due ${fmt(stepDate(c, st))} · ${esc(p.regNo)} · ${esc(docName(p.doctor))}`) + `
      <div class="form-err" role="alert" hidden></div>
      <div class="m-body" data-stage="compose">
        <div class="send">
          <div class="tpl-list" role="radiogroup" aria-label="Choose a message">
            ${tpls.map(t => `<button type="button" class="tpl-card" role="radio" data-tpl="${esc(t.id)}" aria-checked="${t.id === chosen}" tabindex="${t.id === chosen ? 0 : -1}">
              <b>${esc(t.name)}${t.id === suggested ? '<span class="sugg">Suggested</span>' : ''}</b><small>${esc(message(p, c, t.text).slice(0, 90))}</small></button>`).join('')}
          </div>
          <div class="phone-mock">
            <div class="pm-to">${ICON.wa}To ${esc(p.name)} · +91 ${phoneFmt(p.phone)}</div>
            <textarea class="bubble" name="text" aria-label="Message to send" maxlength="2000"></textarea>
            <div class="pm-hint">You can edit the message before sending.</div>
          </div>
        </div>
      </div>
      <div class="m-body" data-stage="confirm" hidden>
        <div class="confirm">
          <div class="big">${ICON.wa.replace('width="16" height="16"', 'width="30" height="30"')}</div>
          <h3>Did the message go?</h3>
          <p data-confirm-text>WhatsApp opened for ${esc(p.name)}. Once you’ve pressed send there, mark it here — the tile turns green.</p>
        </div>
      </div>
      <div class="m-foot" data-stage="compose">
        <button type="button" class="link-btn spacer" data-sx="other">Done by call / SMS</button>
        <button type="button" class="btn ghost hide-m" data-act="close-modal">Cancel</button>
        <a class="btn wa" data-sx="wa" target="_blank" rel="noopener" href="#">${ICON.wa}Send on WhatsApp & mark sent</a>
      </div>
      <div class="m-foot" data-stage="confirm" hidden>
        <button type="button" class="btn ghost" data-sx="back">Not yet</button>
        <button type="submit" class="btn primary">${ICON.check}Yes, mark as sent</button>
      </div>`, async () => {
      try {
        await mutate('POST', `/api/courses/${cid}/remind`, { stepId: sid, templateId: chosen, channel });
      } catch (err) {
        if (/already marked/.test(err.message)) { await load(true, true); toast('Someone already marked this reminder as sent'); return; }
        throw err;
      }
      toast(`${code(c, i)} sent · ${p.name}`, { label: 'Undo', fn: () => mutate('POST', `/api/courses/${cid}/unremind`, { stepId: sid }) });
    }, { wide: true });
    const ta = form.text;
    const wa = form.querySelector('[data-sx="wa"]');
    const cards = [...form.querySelectorAll('[data-tpl]')];
    const sync = () => { wa.href = waUrl(p.phone, ta.value); };
    const fill = () => { ta.value = message(p, c, tpl(chosen).text); sync(); };
    const choose = b => {
      chosen = b.dataset.tpl;
      cards.forEach(x => { x.setAttribute('aria-checked', x === b); x.tabIndex = x === b ? 0 : -1; });
      fill();
    };
    cards.forEach(b => b.addEventListener('click', () => choose(b)));
    form.querySelector('.tpl-list').addEventListener('keydown', e => {
      const k = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      if (!k) return;
      e.preventDefault();
      const j = (cards.findIndex(x => x.dataset.tpl === chosen) + k + cards.length) % cards.length;
      choose(cards[j]); cards[j].focus();
    });
    ta.addEventListener('input', sync);
    const stage = s => form.querySelectorAll('[data-stage]').forEach(el => { el.hidden = el.dataset.stage !== s; });
    const toConfirm = text => { if (text) form.querySelector('[data-confirm-text]').textContent = text; stage('confirm'); form.querySelector('.m-foot[data-stage="confirm"] [type="submit"]').focus(); };
    // Sending marks it as sent straight away (Undo is in the toast)
    wa.addEventListener('click', () => { channel = 'whatsapp'; setTimeout(() => form.requestSubmit(), 50); });
    form.querySelector('[data-sx="back"]').addEventListener('click', () => { stage('compose'); wa.focus(); });
    form.querySelector('[data-sx="other"]').addEventListener('click', () => { channel = 'other'; form.requestSubmit(); });
    fill();
    cards.find(x => x.dataset.tpl === chosen)?.focus();
  }

  function exportCsv() {
    const cell = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const head = ['Reg No', 'Name', 'Mobile', 'Alt Mobile', 'Age', 'Gender', 'Clinic', 'Address', 'Complaint', 'Status', 'Course days', 'Given on', 'Last tablet', 'Medicine', 'Reminders sent', 'Notes'];
    const rows = S.data.patients.filter(p => inLoc(p.location)).map(p => {
      const st = patientStatus(p); const c = st.c;
      return [p.regNo, p.name, p.phone, p.altPhone, p.age ?? '', GENDER[p.gender] || '', shortLoc(p.location), p.address, p.complaint, st.label, c?.days ?? '', c?.startDate ?? '', c ? lastTablet(c) : '', c?.medicine ?? '', c ? `${c.reminders.length} of ${planOf(c).length}` : '', p.notes];
    });
    const csv = '﻿' + [head, ...rows].map(r => r.map(cell).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `somani-patients-${S.loc}-${today()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- toast ----------
  let toastTimer;
  function toast(msg, action) {
    const t = $('toast');
    t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
    if (action) t.querySelector('button').onclick = () => { t.classList.remove('show'); t.innerHTML = ''; action.fn().catch(e => toast(e.message)); };
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.classList.remove('show'); setTimeout(() => { if (!t.classList.contains('show')) t.innerHTML = ''; }, 250); }, action ? 7000 : 3500);
  }

  // ---------- desktop notification (once per day, during clinic hours) ----------
  function maybeNotify() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (document.visibilityState !== 'visible' || new Date().getHours() < 8) return;
    const all = allOcc().filter(o => o.state === 'due' || o.state === 'missed');
    const key = 'notified:' + today();
    if (!all.length || get(key)) return;
    set(key, '1');
    const parts = S.data.locations.map(l => `${shortLoc(l.id)}: ${all.filter(o => o.p.location === l.id).length}`);
    const note = new Notification(`${plural(all.length, 'reminder')} to send today`, { body: parts.join(' · '), icon: '/brand/flower-96.png', tag: 'somani-due' });
    note.onclick = () => { window.focus(); go('board'); note.close(); };
  }

  function go(view) {
    if (view !== S.view && settingsDirty() && !confirm('You have unsaved changes in Settings. Leave without saving?')) return;
    S.view = view; set('view', view);
    if (view === 'settings') { S.planDraft = null; S.tplDraft = null; }
    if (view === 'board') { S._jumpToday = true; S.boardStart = addDays(today(), -1); S.mDay = today(); }
    if (S.drawer) closeDrawer();
    render();
    $('view').focus({ preventScroll: true });
    scrollTo(0, 0);
  }
  const resetPaging = () => { S.tlLimit = 60; S.pLimit = 100; };

  // ---------- events ----------
  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-act]');
    if (!el) { if (e.target === $('scrim')) { if (!$('modal').hidden) closeModal(); else closeDrawer(); } return; }
    if (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return;
    const act = el.dataset.act;
    try {
      switch (act) {
        case 'nav': go(el.dataset.view); break;
        case 'loc':
          S.loc = el.dataset.loc; set('loc', S.loc); resetPaging();
          S.view === 'settings' ? renderChrome() : render();
          break;
        case 'f-clear': S.f = { q: '', status: 'all', days: 'all' }; resetPaging(); render(); break;
        case 'f-missed': {
          S.f.status = 'missed'; resetPaging();
          if (MOBILE()) {
            const { days, byDate, earlier } = boardData();
            S.mDay = earlier.length ? 'earlier' : (days.find(d => (byDate[d] || []).length) || S.mDay);
          }
          render(); break;
        }
        case 'b-prev': S.boardStart = addDays(S.boardStart, -3); render(); break;
        case 'b-next': S.boardStart = addDays(S.boardStart, 3); render(); break;
        case 'b-today': S.boardStart = addDays(today(), -1); S.mDay = today(); S._jumpToday = true; render(); break;
        case 'm-day': S.mDay = el.dataset.d; renderBody(); break;
        case 'c-prev': case 'c-next': {
          const [y, m] = S.calMonth.split('-').map(Number);
          const d = new Date(Date.UTC(y, m - 1 + (act === 'c-next' ? 1 : -1), 1));
          S.calMonth = d.toISOString().slice(0, 7); S.calDay = S.calMonth + '-01'; render(); break;
        }
        case 'c-today': S.calMonth = today().slice(0, 7); S.calDay = today(); render(); break;
        case 'c-day':
          S.calDay = el.dataset.d; if (S.calDay.slice(0, 7) !== S.calMonth) S.calMonth = S.calDay.slice(0, 7);
          render();
          if (innerWidth < 1180) document.querySelector('.day-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          break;
        case 't-prev': S.tlStart = addDays(S.tlStart, -14); render(); break;
        case 't-next': S.tlStart = addDays(S.tlStart, 14); render(); break;
        case 't-today': S.tlStart = addDays(today(), -10); S._jumpToday = true; render(); break;
        case 'tl-more': S.tlLimit += 60; renderBody(); break;
        case 'p-more': {
          const firstNew = S.pLimit; S.pLimit += 100;
          $('vbody').innerHTML = patientsBody();
          (document.querySelectorAll('button.prow')[firstNew] || $('view')).focus();
          break;
        }
        case 'pfilter': S.pFilter = el.dataset.f; S.pLimit = 100; render(); break;
        case 'add': patientForm(); break;
        case 'edit': patientForm(patient(el.dataset.pid)); break;
        case 'open': openDrawer(el.dataset.pid); break;
        case 'open-dup': closeModal(); openDrawer(el.dataset.pid); break;
        case 'close-drawer': closeDrawer(); break;
        case 'close-modal': closeModal(); break;
        case 'renew': renewForm(el.dataset.pid); break;
        case 'course-plan': coursePlanForm(el.dataset.cid); break;
        case 'stop': stopForm(el.dataset.cid); break;
        case 'send': sendModal(el.dataset.cid, el.dataset.sid); break;
        case 'unsent': {
          el.disabled = true;
          const c = S.data.courses.find(x => x.id === el.dataset.cid);
          const st = stepById(c, el.dataset.sid);
          const r = st && sentFor(c, st);
          await mutate('POST', `/api/courses/${c.id}/unremind`, { stepId: el.dataset.sid });
          toast('Reminder marked as not sent', r ? { label: 'Redo', fn: () => mutate('POST', `/api/courses/${c.id}/remind`, { stepId: r.stepId, templateId: r.templateId, channel: r.channel }) } : null);
          break;
        }
        case 'reopen': await mutate('POST', `/api/courses/${el.dataset.cid}/reopen`, {}); toast('Course reopened'); break;
        case 'archive': {
          const p = patient(el.dataset.pid);
          const nowArchived = !p.archived;
          if (nowArchived && !confirm(`Archive ${p.name}? Their running course stops and they leave the reminder board.`)) break;
          await mutate('POST', `/api/patients/${p.id}/archive`, { archived: nowArchived });
          toast(nowArchived ? 'Patient archived' : 'Patient restored');
          break;
        }
        case 'notify': {
          const r = await Notification.requestPermission();
          if (r === 'granted') { try { localStorage.removeItem('notified:' + today()); } catch {} maybeNotify(); toast('Desktop alerts are on'); }
          break;
        }
        case 'theme': root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark'; set('theme', root.dataset.theme); break;
        case 'logout':
          if (settingsDirty() && !confirm('You have unsaved changes in Settings. Sign out anyway?')) break;
          await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); location.replace('/'); break;
        case 'plan-save': {
          await mutate('PUT', '/api/settings', S.planDraft, { soft: true });
          S.planDraft = planDraftFrom(S.data.settings); refreshPlan();
          toast('Defaults saved — used for new patients');
          break;
        }
        // settings: messages
        case 'tpl-add': {
          S.tplDraft.push({ id: 'm' + Date.now().toString(36), name: 'New message', text: 'Namaste {first} 🙏\n\n' });
          $('tplList').innerHTML = S.tplDraft.map((t, i) => tplEditor(t, i)).join('');
          const tas = $('tplList').querySelectorAll('textarea'); tas[tas.length - 1].focus();
          break;
        }
        case 'tpl-del': {
          const t = S.tplDraft[+el.dataset.i];
          if (!confirm(`Delete the message “${t.name}”?`)) break;
          S.tplDraft.splice(+el.dataset.i, 1);
          $('tplList').innerHTML = S.tplDraft.map((t, i) => tplEditor(t, i)).join('');
          break;
        }
        case 'tpl-save': {
          await mutate('PUT', '/api/settings', { templates: S.tplDraft }, { soft: true });
          S.tplDraft = clone(S.data.settings.templates);
          // keep unsaved plan edits, but point any step whose message was deleted at the server's fallback
          const ids = new Set(S.tplDraft.map(t => t.id)), pdd = S.planDraft.planDefaults;
          for (const k of ['regularTpl', 'lastTpl']) if (!ids.has(pdd[k])) pdd[k] = S.data.settings.planDefaults[k];
          refreshPlan(); toast('Messages saved'); break;
        }
        case 'var': {
          const ta = document.querySelector(`textarea[data-act="te-text"][data-i="${el.dataset.i}"]`);
          const ins = `{${el.dataset.v}}`;
          const [a, b] = ta.dataset.caret ? ta.dataset.caret.split(',').map(Number) : [ta.value.length, ta.value.length];
          ta.value = ta.value.slice(0, a) + ins + ta.value.slice(b);
          ta.focus(); ta.setSelectionRange(a + ins.length, a + ins.length); ta.dataset.caret = `${a + ins.length},${a + ins.length}`;
          S.tplDraft[+el.dataset.i].text = ta.value;
          break;
        }
        case 'clinics-save': {
          const clinics = {};
          for (const l of S.data.locations) clinics[l.id] = { name: document.querySelector(`[data-clinic-name="${l.id}"]`).value, phone: document.querySelector(`[data-clinic-phone="${l.id}"]`).value };
          await mutate('PUT', '/api/settings', { clinics }, { soft: true }); toast('Clinics saved'); break;
        }
        case 'export': exportCsv(); break;
        case 'clear-sample':
          if (confirm('Remove all sample patients? Your real patients are not affected.')) { await mutate('DELETE', '/api/sample', {}); toast('Sample patients removed'); }
          break;
      }
    } catch (err) {
      if (err.message !== 'Signed out') toast(err.message);
      if ('disabled' in el) el.disabled = false;
    }
  });
  function refreshPlan() {
    const box = $('planBox'); if (!box) return;
    const fk = focusKey(document.activeElement);
    box.innerHTML = planBox();
    const t = fk && box.querySelector(fk.sel);
    if (t) t.focus();
  }

  document.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.act === 'f-status') { S.f.status = el.value; resetPaging(); renderBody(); }
    if (el.dataset.act === 'f-days') { S.f.days = el.value; resetPaging(); renderBody(); }
    if (el.dataset.act === 'pd') {
      const k = el.dataset.k, d = S.planDraft;
      if (k === 'i14' || k === 'i28') d.planDefaults.intervals[k.slice(1)] = +el.value;
      else if (k.startsWith('doc-')) d.doctorDefault[k.slice(4)] = el.value;
      else d.planDefaults[k] = el.value;
      refreshPlan();
    }
  });
  document.addEventListener('input', e => {
    const el = e.target;
    if (el.id === 'fSearch') { S.f.q = el.value; resetPaging(); renderBody(); }
    if (el.id === 'pSearch') { S.pq = el.value; S.pLimit = 100; $('vbody').innerHTML = patientsBody(); }
    if (el.dataset.act === 'te-name') S.tplDraft[+el.dataset.i].name = el.value;
    if (el.dataset.act === 'te-text') S.tplDraft[+el.dataset.i].text = el.value;
  });
  document.addEventListener('focusout', e => { if (e.target.dataset?.act === 'te-text') e.target.dataset.caret = `${e.target.selectionStart},${e.target.selectionEnd}`; });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (!$('modal').hidden) closeModal(); else if (S.drawer) closeDrawer(); }
    if (e.key === 'Tab') trapFocus(e);
    if (e.key === '/' && !e.target.closest('input, textarea, select') && $('modal').hidden && !S.drawer) {
      const s = $('fSearch') || $('pSearch'); if (s) { e.preventDefault(); s.focus(); }
    }
  });
  addEventListener('beforeunload', e => { if (settingsDirty()) { e.preventDefault(); e.returnValue = ''; } });
  MQ.addEventListener('change', () => { if (S.data && S.view !== 'settings') render(); });
  function trapFocus(e) {
    const box = !$('modal').hidden ? $('modal') : S.drawer ? $('drawer') : null;
    if (!box) return;
    const f = [...box.querySelectorAll('a[href], button:not([disabled]):not([tabindex="-1"]), input:not([type="hidden"]), select, textarea')].filter(x => x.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    else if (!box.contains(document.activeElement)) { e.preventDefault(); f[0].focus(); }
  }

  // ---------- icons ----------
  const svg = (d, w = 16) => `<svg aria-hidden="true" viewBox="0 0 24 24" width="${w}" height="${w}">${d}</svg>`;
  const ICON = {
    wa: svg('<path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z"/>'),
    phone: svg('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z" fill="none" stroke="currentColor" stroke-width="1.8"/>'),
    check: svg('<path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>', 12),
    pill: svg('<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7ZM8.5 8.5l7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>', 14),
    bell: svg('<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9Zm4.3 13a1.94 1.94 0 0 0 3.4 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'),
    edit: svg('<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'),
    x: svg('<path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>', 18),
    plus: svg('<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'),
    trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'),
    left: svg('<path d="m15 18-6-6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>', 18),
    right: svg('<path d="m9 18 6-6-6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>', 18),
    search: svg('<circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>', 18),
    download: svg('<path d="M12 3v12m-5-5 5 5 5-5M5 21h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'),
  };

  // ---------- boot & live refresh ----------
  // background: re-render without disturbing typing; force: ignore the "unchanged" shortcut
  async function load(background, force) {
    const since = background && S.data?.rev ? `?since=${force ? 0 : S.data.rev}` : '';
    const d = await api('GET', '/api/data' + (force ? '' : since));
    if (d.unchanged) { if (today() !== S._renderedDay) { S._renderedDay = today(); bgRender(); } return; }
    if (S.data && d.rev < (S.data.rev || 0)) return;            // a newer change already arrived — this reply is stale
    const before = S.data && S.data.settings;
    d.locations ? setData(d) : applyResponse(d, true);
    S._renderedDay = today();
    syncDrafts(before);
    background ? bgRender() : render();
    maybeNotify();
  }
  // Re-render after background data without disturbing typing, open dialogs or Settings edits
  function bgRender() {
    const ae = document.activeElement;
    const typing = ae && ae.closest?.('#view textarea, #view input:not([type="search"])');
    if (S.view === 'settings' || !$('modal').hidden || typing) { renderChrome(); if (S.drawer && $('modal').hidden) renderDrawer(); }
    else if (ae && ae.closest?.('#vbody, .filters')) { renderBody(); if (S.drawer) renderDrawer(); }
    else render();
  }
  // Settings changed on another device: refresh untouched drafts, warn if this device has unsaved edits
  function syncDrafts(prev) {
    if (S.view !== 'settings' || !S.planDraft || !prev) return;
    const now = S.data.settings;
    let warned = false;
    if (JSON.stringify(planDraftFrom(prev)) !== JSON.stringify(planDraftFrom(now))) {
      if (JSON.stringify(S.planDraft) === JSON.stringify(planDraftFrom(prev))) { S.planDraft = planDraftFrom(now); refreshPlan(); }
      else warned = true;
    }
    if (JSON.stringify(prev.templates) !== JSON.stringify(now.templates)) {
      if (JSON.stringify(S.tplDraft) === JSON.stringify(prev.templates)) { S.tplDraft = clone(now.templates); if ($('tplList')) $('tplList').innerHTML = S.tplDraft.map((t, i) => tplEditor(t, i)).join(''); refreshPlan(); }
      else warned = true;
    }
    if (warned) toast('Settings were changed on another device — reload before saving to avoid overwriting them');
  }
  (async () => {
    try {
      const me = await api('GET', '/api/me');
      S.user = me.user;
      $('uName').textContent = me.user.name;
      $('uEmail').textContent = me.user.email;
      $('uAvatar').textContent = initials(me.user.name || me.user.email);
      if (!VIEWS[S.view]) S.view = 'board';
      S.boardStart = addDays(today(), -1); S.mDay = today();
      S.calMonth = today().slice(0, 7); S.calDay = today();
      S.tlStart = addDays(today(), -10);
      S._jumpToday = true;
      await load();
    } catch (err) {
      if (err.message !== 'Signed out') $('view').innerHTML = `<div class="empty"><b>Couldn’t load data</b>${esc(err.message)}</div>`;
    }
  })();
  let lastDay = today();
  setInterval(() => {
    if (today() !== lastDay) {
      lastDay = today(); S._renderedDay = today();
      S.boardStart = addDays(today(), -1); S.mDay = today();
      bgRender();
    }
  }, 60e3);
  setInterval(() => { if (!document.hidden) load(true).catch(() => {}); }, 60e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(true).catch(() => {}); });
})();
