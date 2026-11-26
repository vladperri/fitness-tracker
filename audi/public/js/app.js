/* Моя Audi A6 C7 — логіка екранів.
   Дані приходять із fb.js через подію "audi:auth": { user, db } або { user: null, db: null }.
   db має той самий вигляд для Firestore і для тестового моку:
   db.collection(name).onSnapshot(next, err) / .doc(id).set(data); db.doc('a/b').set|update|delete|onSnapshot.
   Маршрути — справжні адреси (History API); Firebase Hosting віддає index.html на будь-який шлях. */
(function () {
  'use strict';
  var INFO = window.AUDI_INFO;
  var ITEMS = INFO.items;

  /* ---------- допоміжне ---------- */
  var TYPE = { to: 'ТО', repair: 'Ремонт', inspect: 'Огляд', other: 'Інше' };
  var ICON_INFO = '<svg aria-hidden="true"><use href="#i-info"/></svg>';
  var ICON_COPY = '<svg aria-hidden="true"><use href="#i-copy"/></svg>';
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(n) { return Math.round(Number(n)).toLocaleString('uk-UA'); }
  function isNum(n) { return typeof n === 'number' && isFinite(n); }
  function fd(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? m[3] + '.' + m[2] + '.' + m[1] : ''; }
  function parseD(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  function isoOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function addMonths(d, mo) { return new Date(d.getFullYear(), d.getMonth() + mo, d.getDate()); }
  function monthYear(d) { return String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear(); }
  function today0() { var t = new Date(); t.setHours(0, 0, 0, 0); return t; }
  function setText(id, t) { var el = $(id); if (el) el.textContent = t; }
  function types(r) { return Array.isArray(r.types) ? r.types : (r.type ? [r.type] : ['other']); }
  function svc(r) { return Array.isArray(r.svc) ? r.svc : []; }
  function lower1(s) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
  function km(n) { return num(n) + ' км'; }
  function field(f, name) { return f.elements.namedItem(name); }
  function numOrNull(v) { if (v === '' || v == null) return null; var n = Number(String(v).replace(',', '.')); return isFinite(n) ? n : null; }
  function newId(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function plural(n, one, few, many) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b === 1) return one;
    if (b >= 2 && b <= 4) return few;
    return many;
  }
  function failMsg(e) {
    var c = e && e.code ? String(e.code) : '';
    if (c.indexOf('permission-denied') >= 0) return 'Немає доступу до бази. Перевірте правила Firestore.';
    if (c.indexOf('resource-exhausted') >= 0 || c === 'quota_exceeded') return 'Вичерпано ліміт бази на сьогодні.';
    return 'Не вдалося зберегти. Спробуйте ще раз.';
  }
  function status(id, text, err) { var st = $(id); st.textContent = text; st.className = 'status' + (err ? ' err' : ''); }

  /* ---------- стан ---------- */
  var S = { mode: 'loading', user: null, db: null, records: null, reminders: null, settings: { oilIntervalKm: 8000, oilIntervalMonths: 12 }, filter: 'all', unsubs: [], preset: null, view: 'home', navs: 0 };

  function sorted() {
    return (S.records || []).slice().sort(function (a, b) {
      return String(b.date || '').localeCompare(String(a.date || '')) || ((b.km || 0) - (a.km || 0));
    });
  }
  function maxKm() { var m = null; (S.records || []).forEach(function (r) { if (isNum(r.km) && (m === null || r.km > m)) m = r.km; }); return m; }
  function lastOf(code) { var list = sorted(); for (var i = 0; i < list.length; i++) if (svc(list[i]).indexOf(code) >= 0) return list[i]; return null; }
  function lastText(r) { return r ? fd(r.date) + (isNum(r.km) ? ' · ' + km(r.km) : '') : 'немає запису'; }
  function recById(id) { return (S.records || []).filter(function (r) { return r.id === id; })[0] || null; }
  function remById(id) { return (S.reminders || []).filter(function (r) { return r.id === id; })[0] || null; }
  function signedIn() { return S.mode === 'in'; }

  /* ---------- регламент ---------- */
  function intervalOf(k) {
    var iv = ITEMS[k].iv;
    if (!iv) return null;
    if (iv.oil) return { km: Number(S.settings.oilIntervalKm) || 8000, mo: Number(S.settings.oilIntervalMonths) || 12, src: 'ваш інтервал', label: km(Number(S.settings.oilIntervalKm) || 8000) + ' або ' + (Number(S.settings.oilIntervalMonths) || 12) + ' міс.' };
    return iv;
  }
  // Стан однієї планової заміни: коли була, коли наступна, скільки лишилося.
  function planOf(k) {
    var iv = intervalOf(k), cur = maxKm();
    var p = { k: k, iv: iv, last: lastOf(k), state: 'ok', rank: 3, left: Infinity, text: '' };
    if (!iv) { p.state = 'none'; p.rank = 4; p.text = 'За станом, без фіксованого інтервалу'; return p; }
    if (!p.last) { p.state = 'unknown'; p.rank = 1; p.text = 'Немає запису — варто замінити й записати'; return p; }
    var r = p.last, d = parseD(r.date), t = today0();
    p.nextKm = iv.km && isNum(r.km) ? r.km + iv.km : null;
    p.leftKm = p.nextKm !== null && cur !== null ? p.nextKm - cur : null;
    p.nextD = iv.mo && d ? addMonths(d, iv.mo) : null;
    p.leftDays = p.nextD ? Math.round((p.nextD - t) / 86400000) : null;
    var fracs = [];
    if (p.leftKm !== null) fracs.push(p.leftKm / iv.km);
    if (p.leftDays !== null) fracs.push(p.leftDays / (iv.mo * 30.4));
    p.left = fracs.length ? Math.min.apply(null, fracs) : Infinity;
    var late = (p.leftKm !== null && p.leftKm < 0) || (p.leftDays !== null && p.leftDays < 0);
    var soon = !late && ((p.leftKm !== null && p.leftKm <= 1000) || (p.leftDays !== null && p.leftDays <= 30));
    if (late) {
      p.state = 'late'; p.rank = 0;
      var bits = [];
      if (p.leftKm !== null && p.leftKm < 0) bits.push('на ' + km(-p.leftKm));
      if (p.leftDays !== null && p.leftDays < 0) bits.push('з ' + fd(isoOf(p.nextD)));
      p.text = 'Прострочено ' + bits.join(' і ');
    } else {
      p.state = soon ? 'soon' : 'ok'; p.rank = soon ? 2 : 3;
      var parts = [];
      if (p.leftKm !== null) parts.push('через ' + km(p.leftKm));
      if (p.nextD) parts.push((parts.length ? 'або до ' : 'до ') + monthYear(p.nextD));
      p.text = parts.length ? parts.join(' ').replace(/^ч/, 'Ч').replace(/^д/, 'Д') : 'Інтервал не розраховано';
    }
    return p;
  }
  function plans(keys) {
    return keys.map(planOf).sort(function (a, b) { return a.rank - b.rank || a.left - b.left; });
  }
  function planRow(p, meta) {
    var it = ITEMS[p.k];
    return '<li class="yrow ' + p.state + '"><span class="ydot" aria-hidden="true"></span><span class="ytext"><span class="ytitle">' + esc(it.title) + '</span><span class="ystatus">' + esc(p.text) + '</span>' +
      (meta ? '<span class="ymeta">' + esc(meta) + '</span>' : '') + '</span>' +
      '<button class="icon-btn" type="button" data-info="' + p.k + '" aria-label="Що купити: ' + esc(lower1(it.title)) + '">' + ICON_INFO + '</button></li>';
  }
  function metaOf(p) {
    if (!p.iv) return 'Інтервал: за станом';
    return 'Інтервал: ' + p.iv.label + (p.iv.src && p.iv.src !== 'ваш інтервал' ? ' · ' + p.iv.src : '');
  }

  function oilInfo() {
    var last = lastOf('engine_oil');
    if (!last) return null;
    var iv = intervalOf('engine_oil'), cur = maxKm();
    var nextKm = isNum(last.km) ? last.km + iv.km : null;
    var d = parseD(last.date), nextD = d ? addMonths(d, iv.mo) : null;
    var left = (nextKm !== null && cur !== null) ? nextKm - cur : null;
    var pct = left !== null ? Math.min(100, Math.max(0, (iv.km - left) / iv.km * 100)) : 0;
    var daysLeft = nextD ? Math.round((nextD - new Date()) / 86400000) : null;
    return { last: last, iv: iv.km, mo: iv.mo, nextKm: nextKm, nextD: nextD, left: left, pct: pct, daysLeft: daysLeft };
  }
  function oilLate(o) { return !!o && ((o.left !== null && o.left < 0) || (o.daysLeft !== null && o.daysLeft < 0)); }

  function remSorted() {
    return (S.reminders || []).slice().sort(function (a, b) {
      if (!!a.done !== !!b.done) return a.done ? 1 : -1;
      return (a.date || '9999').localeCompare(b.date || '9999') || ((a.km || 9e9) - (b.km || 9e9));
    });
  }
  function remState(r) {
    if (r.done) return '';
    var cur = maxKm(), d = parseD(r.date), t = today0();
    if ((d && d < t) || (isNum(r.km) && cur !== null && cur >= r.km)) return 'late';
    if ((d && (d - t) / 86400000 <= 14) || (isNum(r.km) && cur !== null && r.km - cur <= 500)) return 'soon';
    return '';
  }
  var STATE_LABEL = { late: 'Час!', soon: 'Скоро' };
  function stateTag(r) { var s = remState(r); return s ? '<span class="rtag ' + s + '">' + STATE_LABEL[s] + '</span>' : ''; }

  /* ---------- маршрути ---------- */
  var PATHS = { '/': 'home', '/records': 'records', '/planned-to': 'planned', '/car': 'car', '/catalog': 'catalog', '/profile': 'profile', '/create-fix': 'fix', '/create-reminder': 'remind' };
  var PATH_OF = {}; Object.keys(PATHS).forEach(function (p) { PATH_OF[PATHS[p]] = p; });
  var TAB_OF = { home: 'home', planned: 'home', remind: 'home', records: 'records', fix: 'records', car: 'car', catalog: 'catalog', profile: 'profile' };
  var TITLE_OF = { home: 'Моя Audi A6 C7', records: 'Записи', planned: 'Планові ТО', car: 'Авто', catalog: 'Каталог', profile: 'Профіль', fix: 'Запис', remind: 'Нагадування' };
  var FAB_VIEWS = { home: 1, records: 1, planned: 1 };
  var LEGACY = { home: '/', records: '/records', reminders: '/', car: '/car', catalog: '/catalog', where: '/planned-to', 'h-year-box': '/planned-to' };

  function viewOfPath() { var p = location.pathname.replace(/\/index\.html$/, '/').replace(/(.)\/+$/, '$1'); return PATHS[p] || 'home'; }
  function viewOfEl(el) { var host = el && el.closest('[data-view]'); return host ? host.getAttribute('data-view') : null; }
  function nav(url, replace) {
    S.navs++;
    if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
    route();
  }
  function goBack(fallback) {
    if (S.navs > 0) history.back(); else nav(fallback, true);
  }
  function route() {
    // старі адреси з # (#records, #s-oil…) переводимо на нові шляхи
    var h = location.hash.slice(1);
    if (h && (location.pathname === '/' || /index\.html$/.test(location.pathname))) {
      if (LEGACY[h]) { history.replaceState(null, '', LEGACY[h]); h = ''; }
      else { var el0 = document.getElementById(h), v0 = viewOfEl(el0); if (v0 && v0 !== 'home') history.replaceState(null, '', PATH_OF[v0] + '#' + h); }
    }
    var v = viewOfPath();
    S.view = v;
    document.querySelectorAll('main [data-view]').forEach(function (s) { s.hidden = s.getAttribute('data-view') !== v; });
    document.querySelectorAll('[data-tab]').forEach(function (a) {
      var on = a.getAttribute('data-tab') === TAB_OF[v];
      a.classList.toggle('on', on);
      if (a.getAttribute('data-tab') === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.title = v === 'home' ? TITLE_OF.home : TITLE_OF[v] + ' · Моя Audi A6 C7';
    closeFab();
    if (v === 'fix') enterFix();
    if (v === 'remind') enterRemind();
    renderFab();
    var hash = location.hash.slice(1), target = hash ? document.getElementById(hash) : null;
    requestAnimationFrame(function () {
      if (target && !target.closest('[hidden]')) target.scrollIntoView();
      else window.scrollTo(0, 0);
      if (v === 'fix' || v === 'remind') { var f = v === 'fix' ? $('rec-form') : $('rem-form'), first = field(f, 'title'); if (first && !first.value) first.focus({ preventScroll: true }); }
    });
  }
  window.addEventListener('popstate', route);

  /* ---------- головна ---------- */
  function renderHero() {
    var titleText, sub = '';
    var o = S.records ? oilInfo() : null;
    var open = (S.reminders || []).filter(function (r) { return !r.done; });
    if (S.mode === 'loading') titleText = 'Завантажуємо журнал…';
    else if (S.mode === 'out') { titleText = 'Увійдіть, щоб відкрити журнал'; sub = 'Записи й нагадування зберігаються у вашому обліковому записі Google. Каталог і дані авто доступні й без входу.'; }
    else if (!S.records) titleText = 'Завантажуємо журнал…';
    else if (!S.records.length) { titleText = 'Почніть журнал'; sub = 'Натисніть «+», щоб додати перший запис або нагадування.'; }
    else if (oilLate(o)) titleText = 'Час міняти мастило в двигуні';
    else if (open.some(function (r) { return remState(r) === 'late'; })) titleText = 'Є прострочене нагадування';
    else titleText = 'Готова до дороги';
    setText('hero-title', titleText);
    $('hero-sub').hidden = !sub; setText('hero-sub', sub);
    document.querySelectorAll('.hero-signin').forEach(function (b) { b.hidden = S.mode !== 'out'; });

    var have = signedIn() && S.records;
    if (have && o && o.left !== null) { setText('st-oil', num(Math.abs(o.left))); setText('st-oil-unit', 'км'); setText('st-oil-sub', o.left >= 0 ? 'до заміни мастила в двигуні' : 'заміна мастила прострочена'); }
    else if (have && o && o.daysLeft !== null) { setText('st-oil', String(Math.abs(o.daysLeft))); setText('st-oil-unit', 'дн.'); setText('st-oil-sub', o.daysLeft >= 0 ? 'до заміни мастила в двигуні' : 'заміна мастила прострочена'); }
    else { setText('st-oil', '—'); setText('st-oil-unit', ''); setText('st-oil-sub', have ? 'заміни мастила ще немає в журналі' : 'до заміни мастила в двигуні'); }
    var lk = have ? sorted().filter(function (r) { return isNum(r.km); })[0] : null;
    setText('st-km', lk ? num(lk.km) : '—'); setText('st-km-unit', lk ? 'км' : '');
    setText('st-km-sub', lk ? 'пробіг на записі ' + fd(lk.date).slice(0, 5) : 'пробіг');
  }
  function hint(text) { return '<li class="mrow empty-row"><span class="t">' + esc(text) + '</span></li>'; }
  function renderHome() {
    var box = $('h-rem-box'), next = $('h-next'), hl = $('h-last');
    if (!signedIn() || !S.records) {
      box.hidden = true;
      var msg = S.mode === 'out' ? 'Увійдіть, щоб бачити дані журналу.' : 'Завантажуємо…';
      next.innerHTML = '<ul class="plain">' + hint(msg) + '</ul>'; hl.innerHTML = hint(msg);
      return;
    }
    var open = remSorted().filter(function (r) { return !r.done; });
    box.hidden = !open.length;
    $('h-rem').innerHTML = open.map(function (r) {
      return '<li><a class="mlink" href="/create-reminder?id=' + encodeURIComponent(r.id) + '" aria-label="Змінити нагадування: ' + esc(r.title) + '"><span class="d">' + esc(r.date ? fd(r.date).slice(0, 5) : '—') + '</span><span class="t">' + esc(r.title) + stateTag(r) + '</span><span class="v">' + (isNum(r.km) ? esc(km(r.km)) : '') + '</span></a></li>';
    }).join('');
    // одне наступне планове ТО; мастило в двигуні вже показано в цифрах героя
    var p = plans(INFO.planned.filter(function (k) { return k !== 'oil_filter' && ITEMS[k].iv; }))[0];
    next.innerHTML = p ? '<ul class="plain next-one">' + planRow(p, ITEMS[p.k].short) + '</ul>' : '<ul class="plain">' + hint('Планових замін немає.') + '</ul>';
    var last = sorted().slice(0, 3);
    hl.innerHTML = last.length ? last.map(function (r) {
      return '<li class="mrow"><span class="d">' + esc(fd(r.date).slice(0, 5)) + '</span><span class="t">' + esc(r.title) + '</span><span class="v">' + (isNum(r.km) ? esc(km(r.km)) : '<span aria-label="без пробігу">—</span>') + '</span></li>';
    }).join('') : hint('Записів ще немає.');
  }

  /* ---------- записи ---------- */
  function itemRow(it) {
    if (typeof it === 'string') return '<li class="item"><span class="item-text"><span class="item-name">' + esc(it) + '</span></span></li>';
    var meta = [];
    if (it.s) meta.push(it.s);
    var price = isNum(it.p) ? num(it.p) + ' грн' : (it.pt || '');
    if (price) meta.push(price);
    var code = it.c ? '<button class="code" type="button" data-code="' + esc(it.c) + '" aria-label="Скопіювати номер ' + esc(it.c) + '">' + esc(it.c) + ICON_COPY + '</button>' : '';
    return '<li class="item"><span class="item-text"><span class="item-name">' + esc(it.n) + '</span>' + (meta.length ? '<span class="item-meta">' + esc(meta.join(' · ')) + '</span>' : '') + '</span>' + code + '</li>';
  }
  function renderRecords() {
    var box = $('rec-list');
    if (S.mode === 'out') { setText('rec-count', 'Увійдіть, щоб бачити й додавати записи.'); box.innerHTML = '<p class="empty">Журнал зберігається у вашому обліковому записі. <button class="btn btn-primary" type="button" data-signin>Увійти через Google</button></p>'; return; }
    if (!S.records) return;
    var list = sorted();
    setText('rec-count', list.length + ' ' + plural(list.length, 'запис', 'записи', 'записів') + ', нові зверху.');
    if (S.filter !== 'all') list = list.filter(function (r) { return types(r).indexOf(S.filter) >= 0; });
    if (!list.length) { box.innerHTML = '<p class="empty">' + (S.filter === 'all' ? 'Записів ще немає. Натисніть «+», щоб додати.' : 'Записів такого типу немає.') + '</p>'; return; }
    box.innerHTML = list.map(function (r) {
      var tags = types(r).map(function (t) { return '<span class="tag ' + esc(t) + '">' + esc(TYPE[t] || t) + '</span>'; }).join('');
      var rows = (Array.isArray(r.items) ? r.items : []).map(itemRow).join('');
      if (isNum(r.total)) rows += '<li class="item-total"><span>Разом</span><span>' + esc(num(r.total)) + ' грн</span></li>';
      return '<article class="rec">' +
        '<div class="rec-headline"><div class="rec-meta"><span class="rec-date">' + esc(fd(r.date)) + '</span><span class="rec-km">' + (isNum(r.km) ? esc(km(r.km)) : 'пробіг не записано') + '</span><span class="tags">' + tags + '</span></div>' +
        '<h3 class="rec-title">' + esc(r.title) + '</h3></div>' +
        (r.warn ? '<p class="warnline">' + esc(r.warn) + '</p>' : '') +
        (rows ? '<ul class="items">' + rows + '</ul>' : '') +
        (r.note ? '<p class="rec-note">' + esc(r.note) + '</p>' : '') +
        '<div class="rec-actions"><a class="btn btn-ghost" href="/create-fix?id=' + encodeURIComponent(r.id) + '">Редагувати</a><button class="btn btn-ghost btn-danger" type="button" data-del="records/' + esc(r.id) + '">Видалити</button></div>' +
        '</article>';
    }).join('');
  }

  /* ---------- планові ТО ---------- */
  function renderOilCard() {
    var o = signedIn() && S.records ? oilInfo() : null;
    var bar = $('r-oil-bar'), warn = $('r-oil-warn');
    if (!o) {
      setText('r-oil-km', '—'); setText('r-oil-unit', ''); setText('r-oil-from', ''); setText('r-oil-to', '');
      bar.firstElementChild.style.width = '0%'; bar.setAttribute('aria-label', 'Інтервал заміни ще не розраховано');
      setText('r-oil-sub', S.mode === 'out' ? 'Увійдіть, щоб рахувати наступну заміну.' : (S.records ? 'Додайте запис і позначте «Мастило в двигуні».' : ' '));
      warn.hidden = true;
      return;
    }
    if (o.left !== null) { setText('r-oil-km', num(Math.abs(o.left))); setText('r-oil-unit', o.left >= 0 ? 'км залишилось' : 'км прострочено'); }
    else if (o.daysLeft !== null) { setText('r-oil-km', String(Math.abs(o.daysLeft))); setText('r-oil-unit', o.daysLeft >= 0 ? 'дн. залишилось' : 'дн. прострочено'); }
    else { setText('r-oil-km', '—'); setText('r-oil-unit', ''); }
    bar.classList.toggle('late', oilLate(o));
    bar.firstElementChild.style.width = o.pct.toFixed(1) + '%';
    var used = o.left !== null ? o.iv - o.left : null;
    bar.setAttribute('aria-label', used !== null ? 'Пройдено ' + km(Math.max(0, used)) + ' з інтервалу ' + km(o.iv) : 'Пробіг до наступної заміни невідомий');
    setText('r-oil-from', isNum(o.last.km) ? num(o.last.km) + ' · заміна' : '');
    setText('r-oil-to', o.nextKm !== null ? num(o.nextKm) + ' · наступна' : '');
    setText('r-oil-sub', 'Остання заміна ' + fd(o.last.date) + (isNum(o.last.km) ? ' на ' + km(o.last.km) : '') + '. Наступна — на ' + (o.nextKm !== null ? km(o.nextKm) : '—') + (o.nextD ? ' або до ' + fd(isoOf(o.nextD)) : '') + ', що настане раніше.');
    warn.hidden = !o.last.warn; warn.textContent = o.last.warn ? 'Увага: ' + o.last.warn : '';
  }
  function renderPlanned() {
    renderOilCard();
    var f = $('oil-set');
    if (!f.contains(document.activeElement)) {
      field(f, 'km').value = S.settings.oilIntervalKm || 8000;
      field(f, 'months').value = S.settings.oilIntervalMonths || 12;
    }
    var known = signedIn() && S.records;
    var cur = known ? maxKm() : null;
    setText('plan-sub', 'За регламентом Audi of America для A6 2.0 TFSI 2015 і рекомендаціями ZF. Де Audi інтервал не задає, позначено «рекомендація».' + (cur !== null ? ' Поточний пробіг — з останнього запису: ' + km(cur) + '.' : ''));
    $('plan-list').innerHTML = known
      ? plans(INFO.planned).map(function (p) { return planRow(p, metaOf(p)); }).join('')
      : INFO.planned.map(function (k) {
        var it = ITEMS[k], iv = it.iv ? intervalOf(k) : null;
        return planRow({ k: k, state: 'none', text: S.mode === 'out' ? 'Увійдіть, щоб бачити, коли наступна заміна' : 'Завантажуємо…', iv: iv }, metaOf({ iv: iv }));
      }).join('');
  }

  /* ---------- профіль ---------- */
  function renderProfile() {
    var u = S.user, av = $('prof-avatar');
    if (S.mode === 'loading') { setText('prof-name', 'Перевіряємо вхід…'); setText('prof-email', ''); }
    else if (S.mode === 'out') { setText('prof-name', 'Ви не увійшли'); setText('prof-email', 'Каталог і дані авто працюють і без входу.'); }
    else { setText('prof-name', u.name || 'Обліковий запис Google'); setText('prof-email', u.email || ''); }
    if (u && u.photo) { av.style.backgroundImage = 'url("' + String(u.photo).replace(/"/g, '') + '")'; av.textContent = ''; }
    else { av.style.backgroundImage = ''; av.textContent = u && (u.name || u.email) ? (u.name || u.email).trim().charAt(0).toUpperCase() : '?'; }
    $('prof-hint').hidden = S.mode !== 'in';
    $('acc-signin').hidden = S.mode !== 'out';
    $('acc-signout').hidden = S.mode !== 'in';
    $('acc-export').hidden = S.mode !== 'in';
    $('acc-import').hidden = S.mode !== 'in';
  }

  function renderAll() { renderHero(); renderHome(); renderRecords(); renderPlanned(); renderProfile(); renderFab(); }

  /* ---------- дані ---------- */
  function note(t) { var n = $('db-note'); n.hidden = !t; n.textContent = t || ''; }
  function stopListeners() { S.unsubs.forEach(function (u) { try { if (typeof u === 'function') u(); } catch (e) { /* вже відписано */ } }); S.unsubs = []; }
  var loadTimer = null;
  function onAuth(state) {
    stopListeners();
    clearTimeout(loadTimer);
    S.user = state && state.user || null;
    S.db = state && state.db || null;
    S.records = null; S.reminders = null;
    S.settings = { oilIntervalKm: 8000, oilIntervalMonths: 12 };
    if (!S.user || !S.db) { S.mode = 'out'; note(''); renderAll(); return; }
    S.mode = 'in';
    renderAll();
    var db = S.db;
    loadTimer = setTimeout(function () { note('Дані ще не завантажилися. Можливо, немає з’єднання.'); }, 10000);
    function onErr(e) {
      clearTimeout(loadTimer);
      var denied = e && String(e.code || '').indexOf('permission-denied') >= 0;
      note(denied ? 'Немає доступу до бази: додайте правило для розділу audi у Firestore (див. README).' : 'Не вдалося завантажити дані журналу. Оновіть сторінку пізніше.');
      if (S.records === null) { S.records = []; renderAll(); }
    }
    S.unsubs.push(db.collection('records').onSnapshot(function (snap) {
      if (!snap.metadata || !snap.metadata.fromCache) { clearTimeout(loadTimer); note(''); }
      S.records = snap.docs.map(function (d) { var o = Object.assign({}, d.data()); o.id = d.id; return o; });
      renderAll();
      if (S.view === 'fix') enterFix(true);
    }, onErr));
    S.unsubs.push(db.collection('reminders').onSnapshot(function (snap) {
      S.reminders = snap.docs.map(function (d) { var o = Object.assign({}, d.data()); o.id = d.id; return o; });
      renderAll();
      if (S.view === 'remind') enterRemind(true);
    }, onErr));
    S.unsubs.push(db.doc('settings/main').onSnapshot(function (snap) {
      if (snap.exists) S.settings = Object.assign({ oilIntervalKm: 8000, oilIntervalMonths: 12 }, snap.data());
      renderAll();
    }, onErr));
  }
  window.addEventListener('audi:auth', function (e) { onAuth(e.detail); });
  var authWait = setTimeout(function () { if (S.mode === 'loading') note('Не вдалося підключитися до Firebase. Перевірте з’єднання й оновіть сторінку.'); }, 12000);
  window.addEventListener('audi:auth', function () { clearTimeout(authWait); }, { once: true });

  function signIn() {
    if (!window.AudiAuth) { note('Вхід ще завантажується. Спробуйте за мить.'); return; }
    window.AudiAuth.signIn().catch(function (e) {
      var c = e && e.code || '';
      if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') return;
      var msg = c === 'auth/unauthorized-domain' ? 'Цей домен не додано в Firebase → Authentication → Authorized domains.' : 'Не вдалося увійти. Спробуйте ще раз.';
      status('acc-status', msg, true); note(msg);
    });
  }

  /* ---------- кнопка «+» ---------- */
  var fab = $('fab'), fabMenu = $('fab-menu');
  function renderFab() {
    var show = signedIn() && !!FAB_VIEWS[S.view];
    $('fab-wrap').hidden = !show;
    document.body.classList.toggle('has-fab', show);
  }
  function openFab() { fabMenu.hidden = false; fab.setAttribute('aria-expanded', 'true'); var first = fabMenu.querySelector('a'); if (first) first.focus(); }
  function closeFab() { if (fabMenu.hidden) return; fabMenu.hidden = true; fab.setAttribute('aria-expanded', 'false'); }
  fab.addEventListener('click', function () { if (fabMenu.hidden) openFab(); else { closeFab(); fab.focus(); } });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !fabMenu.hidden) { closeFab(); fab.focus(); } });

  /* ---------- сторінка запису ---------- */
  var EDIT = null;
  function buildChecks() {
    var fs = $('svc-checks');
    INFO.tracked.forEach(function (k) {
      var l = document.createElement('label');
      l.innerHTML = '<input type="checkbox" name="svc" value="' + k + '">' + esc(ITEMS[k].title);
      fs.appendChild(l);
    });
  }
  function itemsToText(items) {
    return (Array.isArray(items) ? items : []).map(function (it) {
      if (typeof it === 'string') return it;
      var parts = [it.n || '', it.c || '', isNum(it.p) ? String(it.p) : (it.pt || ''), it.s || ''];
      while (parts.length > 1 && !parts[parts.length - 1]) parts.pop();
      return parts.join(' | ');
    }).join('\n');
  }
  function parseItems(text) {
    return String(text || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
      if (l.indexOf('|') < 0) return l;
      var p = l.split('|').map(function (x) { return x.trim(); });
      var o = { n: p[0] || '' };
      if (p[1]) o.c = p[1];
      if (p[2]) { var n = numOrNull(p[2].replace(/\s/g, '').replace(/(грн|₴)\.?$/i, '')); if (n !== null) o.p = n; else o.pt = p[2]; }
      if (p[3]) o.s = p.slice(3).join(' | ');
      return o;
    });
  }
  // Заповнює форму запису за адресою: /create-fix — новий, /create-fix?id=… — редагування.
  // refresh = true: дані щойно приїхали з бази; форму, яку вже почали заповнювати, не чіпаємо.
  var fixFilledFor = null;
  function enterFix(refresh) {
    var id = new URLSearchParams(location.search).get('id');
    var key = id || 'new';
    if (refresh && fixFilledFor === key) return;
    var f = $('rec-form'), rec = id ? recById(id) : null;
    if (refresh && id && !rec) return;
    f.reset();
    var tmp = f.querySelector('option[data-tmp]'); if (tmp) tmp.remove();
    EDIT = rec ? rec.id : null;
    fixFilledFor = id ? (rec ? key : null) : key;
    setText('fix-title', id ? 'Редагувати запис' : 'Новий запис');
    setText('rec-submit', id ? 'Зберегти зміни' : 'Зберегти');
    var del = $('rec-del'); del.hidden = !rec; del.classList.remove('arm'); del.textContent = 'Видалити запис'; del.disabled = false;
    status('rec-status', id && !rec ? (S.records ? 'Такого запису немає.' : 'Завантажуємо запис…') : '', id && !rec && !!S.records);
    var sel = field(f, 'type');
    if (!rec) {
      field(f, 'date').value = isoOf(new Date());
      var mk = maxKm(); if (mk !== null) field(f, 'km').placeholder = String(mk);
      var pre = S.preset; S.preset = null;
      if (pre && !id) {
        if (pre.title) field(f, 'title').value = pre.title;
        if (pre.type) sel.value = pre.type;
        (pre.svc || []).forEach(function (k) { var c = f.querySelector('input[name="svc"][value="' + k + '"]'); if (c) c.checked = true; });
      }
      return;
    }
    field(f, 'date').value = rec.date || '';
    field(f, 'km').value = isNum(rec.km) ? rec.km : '';
    var ts = types(rec);
    if (ts.length > 1) {
      var o = document.createElement('option'); o.value = ts.join(','); o.setAttribute('data-tmp', '1');
      o.textContent = ts.map(function (t) { return TYPE[t] || t; }).join(' + ');
      sel.appendChild(o); sel.value = o.value;
    } else sel.value = ts[0] || 'other';
    field(f, 'total').value = isNum(rec.total) ? rec.total : '';
    field(f, 'title').value = rec.title || '';
    field(f, 'items').value = itemsToText(rec.items);
    field(f, 'note').value = rec.note || '';
    var sv = svc(rec);
    f.querySelectorAll('input[name="svc"]').forEach(function (c) { c.checked = sv.indexOf(c.value) >= 0; });
  }
  $('rec-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var f = ev.target;
    if (!S.db) { status('rec-status', 'Увійдіть, щоб зберігати записи.', true); return; }
    var data = {
      date: field(f, 'date').value, km: numOrNull(field(f, 'km').value), types: String(field(f, 'type').value).split(','),
      title: field(f, 'title').value.trim(), items: parseItems(field(f, 'items').value),
      total: numOrNull(field(f, 'total').value), note: field(f, 'note').value.trim(),
      svc: Array.prototype.slice.call(f.querySelectorAll('input[name="svc"]:checked')).map(function (c) { return c.value; })
    };
    if (!data.title || !data.date) { status('rec-status', 'Вкажіть дату й що зробили.', true); return; }
    var id, body;
    if (EDIT) {
      var orig = recById(EDIT);
      if (!orig) { status('rec-status', 'Цей запис уже видалено.', true); return; }
      id = EDIT; body = Object.assign({}, orig, data, { updatedAt: new Date().toISOString() }); delete body.id;
    } else {
      id = newId('r'); body = Object.assign({}, data, { createdAt: new Date().toISOString() });
    }
    var btn = $('rec-submit'); btn.disabled = true; status('rec-status', 'Зберігаємо…');
    S.db.collection('records').doc(id).set(body).then(function () {
      btn.disabled = false; fixFilledFor = null; nav('/records', true);
    }, function (e) { status('rec-status', failMsg(e), true); btn.disabled = false; });
  });
  $('rec-del').addEventListener('click', function () {
    var b = this;
    if (!EDIT || !S.db) return;
    if (!b.classList.contains('arm')) {
      b.classList.add('arm'); b.textContent = 'Точно видалити?';
      setTimeout(function () { if (b.isConnected && b.classList.contains('arm')) { b.classList.remove('arm'); b.textContent = 'Видалити запис'; } }, 4000);
      return;
    }
    b.disabled = true;
    S.db.doc('records/' + EDIT).delete().then(function () { fixFilledFor = null; nav('/records', true); }, function () { b.disabled = false; b.textContent = 'Не вдалося видалити'; });
  });

  /* ---------- сторінка нагадування ---------- */
  var REM_EDIT = null, remFilledFor = null;
  function enterRemind(refresh) {
    var id = new URLSearchParams(location.search).get('id');
    var key = id || 'new';
    if (refresh && remFilledFor === key) return;
    var f = $('rem-form'), rem = id ? remById(id) : null;
    if (refresh && id && !rem) return;
    f.reset();
    REM_EDIT = rem ? rem.id : null;
    remFilledFor = id ? (rem ? key : null) : key;
    setText('rem-title', id ? 'Редагувати нагадування' : 'Нове нагадування');
    setText('rem-submit', id ? 'Зберегти зміни' : 'Зберегти');
    $('rem-del').hidden = !rem; $('rem-del').classList.remove('arm'); $('rem-del').textContent = 'Видалити'; $('rem-del').disabled = false;
    $('rem-done').hidden = !rem; $('rem-done').textContent = rem && rem.done ? 'Повернути в активні' : 'Позначити виконаним';
    status('rem-status', id && !rem ? (S.reminders ? 'Такого нагадування немає.' : 'Завантажуємо нагадування…') : '', id && !rem && !!S.reminders);
    if (!rem) return;
    field(f, 'title').value = rem.title || '';
    field(f, 'date').value = rem.date || '';
    field(f, 'km').value = isNum(rem.km) ? rem.km : '';
    field(f, 'note').value = rem.note || '';
  }
  $('rem-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var f = ev.target;
    if (!S.db) { status('rem-status', 'Увійдіть, щоб зберігати нагадування.', true); return; }
    var data = { title: field(f, 'title').value.trim(), date: field(f, 'date').value || null, km: numOrNull(field(f, 'km').value), note: field(f, 'note').value.trim() };
    if (!data.title) { status('rem-status', 'Вкажіть, що зробити.', true); return; }
    var id, body;
    if (REM_EDIT) {
      var orig = remById(REM_EDIT);
      if (!orig) { status('rem-status', 'Це нагадування вже видалено.', true); return; }
      id = REM_EDIT; body = Object.assign({}, orig, data, { updatedAt: new Date().toISOString() }); delete body.id;
    } else {
      id = newId('m'); body = Object.assign({}, data, { done: false, createdAt: new Date().toISOString() });
    }
    var btn = $('rem-submit'); btn.disabled = true; status('rem-status', 'Зберігаємо…');
    S.db.collection('reminders').doc(id).set(body).then(function () {
      btn.disabled = false; remFilledFor = null; nav('/', true);
    }, function (e) { status('rem-status', failMsg(e), true); btn.disabled = false; });
  });
  $('rem-done').addEventListener('click', function () {
    var rem = REM_EDIT && remById(REM_EDIT), b = this;
    if (!rem || !S.db) return;
    b.disabled = true;
    S.db.doc('reminders/' + rem.id).update({ done: !rem.done }).then(function () { b.disabled = false; remFilledFor = null; nav('/', true); }, function () { b.disabled = false; status('rem-status', 'Не вдалося зберегти.', true); });
  });
  $('rem-del').addEventListener('click', function () {
    var b = this;
    if (!REM_EDIT || !S.db) return;
    if (!b.classList.contains('arm')) {
      b.classList.add('arm'); b.textContent = 'Точно видалити?';
      setTimeout(function () { if (b.isConnected && b.classList.contains('arm')) { b.classList.remove('arm'); b.textContent = 'Видалити'; } }, 4000);
      return;
    }
    b.disabled = true;
    S.db.doc('reminders/' + REM_EDIT).delete().then(function () { remFilledFor = null; nav('/', true); }, function () { b.disabled = false; b.textContent = 'Не вдалося видалити'; });
  });

  /* ---------- інтервал мастила ---------- */
  $('oil-set').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var f = ev.target;
    if (!S.db) { status('oil-status', 'Увійдіть, щоб зберегти інтервал.', true); return; }
    var kmv = numOrNull(field(f, 'km').value), mo = numOrNull(field(f, 'months').value);
    if (!kmv || !mo) { status('oil-status', 'Вкажіть пробіг і місяці.', true); return; }
    status('oil-status', 'Зберігаємо…');
    S.db.doc('settings/main').set({ oilIntervalKm: kmv, oilIntervalMonths: mo }).then(function () { status('oil-status', 'Збережено.'); }, function (e) { status('oil-status', failMsg(e), true); });
  });

  /* ---------- вікно «Що купити» ---------- */
  var dlg = $('info'), infoKind = null, infoOpener = null;
  function openInfo(kind, opener) {
    var it = ITEMS[kind]; if (!it) return;
    infoKind = kind; infoOpener = opener || null;
    setText('info-title', it.title);
    setText('info-sub', it.sub);
    setText('info-where', it.where);
    $('info-buy').innerHTML = it.buy.map(function (b) {
      return '<li class="buy-row"><span class="item-text"><span class="item-name">' + esc(b.name) + '</span><span class="item-meta">' + esc(b.qty) + '</span></span>' +
        (b.code ? '<button class="code" type="button" data-code="' + esc(b.code) + '" aria-label="Скопіювати номер ' + esc(b.code) + '">' + esc(b.code) + ICON_COPY + '</button>' : '') + '</li>';
    }).join('');
    var facts = [];
    if (INFO.tracked.indexOf(kind) >= 0) facts.push({ k: 'Остання заміна', v: signedIn() && S.records ? lastText(lastOf(kind)) : 'після входу' });
    if (it.fact) facts.push(it.fact);
    $('info-facts').innerHTML = facts.map(function (x) { return '<div class="fact"><span class="label-s">' + esc(x.k) + '</span><b>' + esc(x.v) + '</b></div>'; }).join('');
    var nt = $('info-note'); nt.hidden = !it.note; nt.textContent = it.note || '';
    var more = $('info-more'); more.hidden = !it.more; if (it.more) more.setAttribute('href', it.more);
    $('info-log').hidden = !!it.noLog;
    $('info-log').textContent = signedIn() ? 'Записати заміну' : 'Увійти, щоб записати заміну';
    if (typeof dlg.showModal === 'function') { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', '');
    $('info-close').focus();
  }
  function closeInfo() { if (typeof dlg.close === 'function' && dlg.open) dlg.close(); else dlg.removeAttribute('open'); }
  dlg.addEventListener('close', function () { if (infoOpener && infoOpener.isConnected) infoOpener.focus(); infoOpener = null; });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) closeInfo(); });
  $('info-close').addEventListener('click', closeInfo);
  $('info-log').addEventListener('click', function () {
    var it = ITEMS[infoKind];
    infoOpener = null; closeInfo();
    if (!signedIn()) { signIn(); return; }
    S.preset = { title: 'Заміна: ' + lower1(it.title), type: 'to', svc: INFO.tracked.indexOf(infoKind) >= 0 ? [infoKind] : [] };
    fixFilledFor = null;
    nav('/create-fix');
  });

  /* ---------- профіль: вхід, вихід, резервна копія ---------- */
  $('acc-signin').addEventListener('click', signIn);
  $('acc-signout').addEventListener('click', function () { if (window.AudiAuth) window.AudiAuth.signOut(); });
  $('acc-export').addEventListener('click', function () {
    var copy = function (o) { return Object.assign({}, o); };
    var out = { app: 'audi-a6', version: 1, exportedAt: new Date().toISOString(), records: (S.records || []).map(copy), reminders: (S.reminders || []).map(copy), settings: { main: S.settings } };
    var blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'audi-a6-backup-' + isoOf(new Date()) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    status('acc-status', 'Резервну копію збережено у файл.');
  });
  $('acc-import').addEventListener('click', function () { $('acc-file').click(); });
  $('acc-file').addEventListener('change', function () {
    var file = this.files && this.files[0], input = this;
    if (!file || !S.db) return;
    var rd = new FileReader();
    rd.onload = function () {
      input.value = '';
      var data;
      try { data = JSON.parse(String(rd.result)); } catch (e) { status('acc-status', 'Це не файл резервної копії.', true); return; }
      if (!data || data.app !== 'audi-a6' || !Array.isArray(data.records)) { status('acc-status', 'Це не файл резервної копії цього застосунку.', true); return; }
      var ok = /^[A-Za-z0-9_-]{1,64}$/, writes = [];
      data.records.forEach(function (r) { if (r && ok.test(r.id || '')) { var b = Object.assign({}, r); delete b.id; writes.push(['records/' + r.id, b]); } });
      (Array.isArray(data.reminders) ? data.reminders : []).forEach(function (r) { if (r && ok.test(r.id || '')) { var b = Object.assign({}, r); delete b.id; writes.push(['reminders/' + r.id, b]); } });
      if (data.settings && data.settings.main && typeof data.settings.main === 'object') writes.push(['settings/main', data.settings.main]);
      status('acc-status', 'Підвантажуємо…');
      var done = S.db.batchSet ? S.db.batchSet(writes) : Promise.all(writes.map(function (w) { return S.db.doc(w[0]).set(w[1]); }));
      done.then(function () {
        var nr = writes.filter(function (w) { return w[0].indexOf('records/') === 0; }).length;
        var nm = writes.filter(function (w) { return w[0].indexOf('reminders/') === 0; }).length;
        status('acc-status', 'Підвантажено: ' + nr + ' ' + plural(nr, 'запис', 'записи', 'записів') + ', ' + nm + ' ' + plural(nm, 'нагадування', 'нагадування', 'нагадувань') + '.');
      }, function (e) { status('acc-status', failMsg(e), true); });
    };
    rd.readAsText(file);
  });

  /* ---------- фільтри записів ---------- */
  document.querySelectorAll('[data-filter]').forEach(function (b) {
    b.addEventListener('click', function () {
      S.filter = b.getAttribute('data-filter');
      document.querySelectorAll('[data-filter]').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      renderRecords();
    });
  });

  /* ---------- делеговані кліки ---------- */
  var live = $('live');
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!fabMenu.hidden && !t.closest('#fab-wrap')) closeFab();
    var si = t.closest('[data-signin]');
    if (si) { signIn(); return; }
    var info = t.closest('[data-info]');
    if (info) { openInfo(info.getAttribute('data-info'), info); return; }
    var back = t.closest('[data-back]');
    if (back && !ev.metaKey && !ev.ctrlKey) { ev.preventDefault(); goBack(back.getAttribute('data-back')); return; }
    var a = t.closest('a[href]');
    if (a && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey && !a.target && !a.hasAttribute('download')) {
      var href = a.getAttribute('href');
      if (href.charAt(0) === '/' && href.charAt(1) !== '/') {
        ev.preventDefault();
        if (a.closest('dialog')) { infoOpener = null; closeInfo(); }
        nav(href);
        return;
      }
      if (href.charAt(0) === '#' && href.length > 1) {
        var el = document.getElementById(href.slice(1)), v = viewOfEl(el);
        if (v && v !== S.view) { ev.preventDefault(); nav(PATH_OF[v] + href); return; }
      }
    }
    var del = t.closest('[data-del]');
    if (del && S.db) {
      if (!del.classList.contains('arm')) {
        del.classList.add('arm'); del.textContent = 'Точно видалити?';
        setTimeout(function () { if (del.isConnected) { del.classList.remove('arm'); del.textContent = 'Видалити'; } }, 4000);
        return;
      }
      del.disabled = true;
      S.db.doc(del.getAttribute('data-del')).delete().then(null, function () { del.disabled = false; del.textContent = 'Не вдалося'; });
      return;
    }
    var code = t.closest('[data-code]');
    if (code) {
      var txt = code.getAttribute('data-code');
      var ok = function () { code.classList.add('done'); if (live) live.textContent = 'Скопійовано: ' + txt; setTimeout(function () { code.classList.remove('done'); }, 1500); };
      var pick = function () { try { var r = document.createRange(); r.selectNodeContents(code); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); if (live) live.textContent = 'Код виділено, скопіюйте вручну'; } catch (e) { /* без виділення */ } };
      try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, pick); else pick(); } catch (e) { pick(); }
    }
  });

  /* ---------- старт ---------- */
  buildChecks();
  route();
  renderAll();
  if (window.__audiAuth) onAuth(window.__audiAuth);
})();
