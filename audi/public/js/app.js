/* Моя Audi A6 C7 — логіка екранів.
   Дані приходять із fb.js через подію "audi:auth": { user, db } або { user: null, db: null }.
   db має той самий вигляд для Firestore і для тестового моку:
   db.collection(name).onSnapshot(next, err) / .doc(id).set(data); db.doc('a/b').set|update|delete|onSnapshot. */
(function () {
  'use strict';
  var INFO = window.AUDI_INFO;
  var ITEMS = INFO.items;

  /* ---------- маршрути ---------- */
  var VIEWS = ['home', 'records', 'reminders', 'car', 'catalog'];
  var afterRoute = null;
  function route() {
    var h = '';
    try { h = decodeURIComponent(location.hash.slice(1)); } catch (e) { h = location.hash.slice(1); }
    var v = 'home', target = null;
    if (VIEWS.indexOf(h) >= 0) v = h;
    else if (h) {
      var el = document.getElementById(h);
      var host = el && el.closest('[data-view]');
      if (host) { v = host.getAttribute('data-view'); target = el; }
    }
    document.querySelectorAll('[data-view]').forEach(function (s) { s.hidden = s.getAttribute('data-view') !== v; });
    document.body.setAttribute('data-current', v);
    document.querySelectorAll('[data-tab]').forEach(function (a) {
      var on = a.getAttribute('data-tab') === v;
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    var job = afterRoute; afterRoute = null;
    requestAnimationFrame(function () {
      if (job) job();
      else if (target) target.scrollIntoView();
      else window.scrollTo(0, 0);
    });
  }
  function go(hash, then) {
    afterRoute = then || null;
    if (location.hash === hash) route(); else location.hash = hash;
  }
  window.addEventListener('hashchange', route);

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
  function setText(id, t) { var el = $(id); if (el) el.textContent = t; }
  function types(r) { return Array.isArray(r.types) ? r.types : (r.type ? [r.type] : ['other']); }
  function svc(r) { return Array.isArray(r.svc) ? r.svc : []; }
  function lower1(s) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
  function km(n) { return num(n) + ' км'; }
  function field(f, name) { return f.elements.namedItem(name); }
  function numOrNull(v) { if (v === '' || v == null) return null; var n = Number(String(v).replace(',', '.')); return isFinite(n) ? n : null; }
  function newId(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function failMsg(e) {
    var c = e && e.code ? String(e.code) : '';
    if (c.indexOf('permission-denied') >= 0) return 'Немає доступу до бази. Перевірте правила Firestore.';
    if (c.indexOf('resource-exhausted') >= 0 || c === 'quota_exceeded') return 'Вичерпано ліміт бази на сьогодні.';
    return 'Не вдалося зберегти. Спробуйте ще раз.';
  }

  /* ---------- стан ---------- */
  var S = { mode: 'loading', user: null, db: null, records: null, reminders: null, settings: { oilIntervalKm: 8000, oilIntervalMonths: 12 }, filter: 'all', unsubs: [] };

  function sorted() {
    return (S.records || []).slice().sort(function (a, b) {
      var c = String(b.date || '').localeCompare(String(a.date || ''));
      return c || ((b.km || 0) - (a.km || 0));
    });
  }
  function maxKm() { var m = null; (S.records || []).forEach(function (r) { if (isNum(r.km) && (m === null || r.km > m)) m = r.km; }); return m; }
  function lastOf(code) { var list = sorted(); for (var i = 0; i < list.length; i++) if (svc(list[i]).indexOf(code) >= 0) return list[i]; return null; }
  function lastText(r) { return r ? fd(r.date) + (isNum(r.km) ? ' · ' + km(r.km) : '') : 'немає запису'; }

  function oilInfo() {
    var last = lastOf('engine_oil');
    if (!last) return null;
    var iv = Number(S.settings.oilIntervalKm) || 8000, mo = Number(S.settings.oilIntervalMonths) || 12;
    var cur = maxKm();
    var nextKm = isNum(last.km) ? last.km + iv : null;
    var d = parseD(last.date), nextD = d ? new Date(d.getFullYear(), d.getMonth() + mo, d.getDate()) : null;
    var left = (nextKm !== null && cur !== null) ? nextKm - cur : null;
    var pct = left !== null ? Math.min(100, Math.max(0, (iv - left) / iv * 100)) : 0;
    var daysLeft = nextD ? Math.round((nextD - new Date()) / 86400000) : null;
    return { last: last, iv: iv, mo: mo, nextKm: nextKm, nextD: nextD, left: left, pct: pct, daysLeft: daysLeft, cur: cur };
  }
  function oilLate(o) { return !!o && ((o.left !== null && o.left < 0) || (o.daysLeft !== null && o.daysLeft < 0)); }

  function remSorted() {
    return (S.reminders || []).slice().sort(function (a, b) {
      if (!!a.done !== !!b.done) return a.done ? 1 : -1;
      return (a.date || '9999').localeCompare(b.date || '9999') || ((a.km || 9e9) - (b.km || 9e9));
    });
  }
  function remWhen(r) {
    var p = [];
    if (r.date) p.push(fd(r.date));
    if (isNum(r.km)) p.push('на ' + km(r.km));
    return p.join(' · ') || 'без строку';
  }
  function remState(r) {
    if (r.done) return '';
    var cur = maxKm(), d = parseD(r.date), today = new Date(); today.setHours(0, 0, 0, 0);
    if ((d && d < today) || (isNum(r.km) && cur !== null && cur >= r.km)) return 'late';
    if ((d && (d - today) / 86400000 <= 14) || (isNum(r.km) && cur !== null && r.km - cur <= 500)) return 'soon';
    return '';
  }
  var STATE_LABEL = { late: 'Час!', soon: 'Скоро' };
  function stateTag(r) { var s = remState(r); return s ? '<span class="rtag ' + s + '">' + STATE_LABEL[s] + '</span>' : ''; }

  /* ---------- головна ---------- */
  function renderHero() {
    var titleText, sub;
    var o = S.records ? oilInfo() : null;
    var open = (S.reminders || []).filter(function (r) { return !r.done; });
    if (S.mode === 'loading') { titleText = 'Завантажуємо журнал…'; sub = ' '; }
    else if (S.mode === 'out') {
      titleText = 'Увійдіть, щоб відкрити журнал';
      sub = 'Записи й нагадування зберігаються у вашому обліковому записі Google. Каталог і дані авто доступні й без входу.';
    } else if (!S.records) { titleText = 'Завантажуємо журнал…'; sub = ' '; }
    else if (!S.records.length) { titleText = 'Почніть журнал'; sub = 'Додайте перший запис, і тут з’явиться, що робити далі.'; }
    else if (oilLate(o)) { titleText = 'Час міняти мастило в двигуні'; sub = 'Остання заміна була ' + fd(o.last.date) + (isNum(o.last.km) ? ' на ' + km(o.last.km) : '') + '.'; }
    else {
      var lateRem = open.filter(function (r) { return remState(r) === 'late'; })[0];
      if (lateRem) { titleText = 'Є прострочене нагадування'; sub = lateRem.title; }
      else {
        titleText = 'Готова до дороги';
        sub = o ? 'Наступна заміна мастила в двигуні — на ' + (o.nextKm !== null ? km(o.nextKm) : '—') + (o.nextD ? ' або до ' + fd(isoOf(o.nextD)) : '') + ', що настане раніше.'
          : 'Додайте запис із заміною мастила в двигуні, щоб рахувати наступну.';
      }
    }
    setText('hero-title', titleText);
    setText('hero-sub', sub);

    var have = S.mode === 'in' && S.records;
    if (have && o && o.left !== null) { setText('st-oil', num(Math.abs(o.left))); setText('st-oil-unit', 'км'); setText('st-oil-sub', o.left >= 0 ? 'до заміни мастила в двигуні' : 'заміна мастила прострочена'); }
    else if (have && o && o.daysLeft !== null) { setText('st-oil', String(Math.abs(o.daysLeft))); setText('st-oil-unit', 'дн.'); setText('st-oil-sub', o.daysLeft >= 0 ? 'до заміни мастила в двигуні' : 'заміна мастила прострочена'); }
    else { setText('st-oil', '—'); setText('st-oil-unit', ''); setText('st-oil-sub', have ? 'заміни мастила ще немає в журналі' : 'до заміни мастила в двигуні'); }
    var lk = have ? sorted().filter(function (r) { return isNum(r.km); })[0] : null;
    setText('st-km', lk ? num(lk.km) : '—'); setText('st-km-unit', lk ? 'км' : '');
    setText('st-km-sub', lk ? 'пробіг на записі ' + fd(lk.date).slice(0, 5) : 'пробіг');
    setText('st-count', have ? String(S.records.length) : '—');
    setText('st-rem', S.mode === 'in' && S.reminders ? String(open.length) : '—');
    setText('st-miss', have ? String(INFO.yearly.filter(function (k) { return !lastOf(k); }).length) : '—');
    document.querySelectorAll('[data-add-record]').forEach(function (b) { b.textContent = S.mode === 'out' ? 'Увійти через Google' : 'Додати запис'; });
  }

  function signInRow(text) {
    return '<li class="mrow empty-row"><span class="t">' + esc(text) + '</span></li>';
  }
  function renderHome() {
    var hy = $('h-year'), hr = $('h-rem'), hl = $('h-last');
    if (S.mode !== 'in' || !S.records) {
      var msg = S.mode === 'out' ? 'Увійдіть, щоб побачити дані журналу.' : 'Завантажуємо…';
      hy.innerHTML = INFO.yearly.map(function (k) { return yearRow(k, null, false); }).join('');
      setText('h-year-sub', S.mode === 'out' ? 'Після входу тут буде видно, коли що міняли.' : 'Рідини й фільтри: коли міняли востаннє.');
      hr.innerHTML = signInRow(msg); hl.innerHTML = signInRow(msg);
      return;
    }
    var rows = INFO.yearly.map(function (k) { return { k: k, r: lastOf(k) }; });
    var miss = rows.filter(function (x) { return !x.r; }), done = rows.filter(function (x) { return x.r; });
    hy.innerHTML = miss.concat(done).map(function (x) { return yearRow(x.k, x.r, true); }).join('');
    setText('h-year-sub', done.length + ' з ' + rows.length + ' є в журналі' + (miss.length ? ', ' + miss.length + ' без запису. Спершу показано те, чого немає.' : '.'));

    if (S.reminders === null) hr.innerHTML = signInRow('Завантажуємо…');
    else {
      var rems = remSorted().filter(function (r) { return !r.done; }).slice(0, 3);
      hr.innerHTML = rems.length ? rems.map(function (r) {
        return '<li class="mrow"><span class="d">' + esc(r.date ? fd(r.date).slice(0, 5) : '—') + '</span><span class="t">' + esc(r.title) + stateTag(r) + '</span><span class="v">' + (isNum(r.km) ? esc(km(r.km)) : '') + '</span></li>';
      }).join('') : signInRow('Відкритих нагадувань немає.');
    }
    var last = sorted().slice(0, 3);
    hl.innerHTML = last.length ? last.map(function (r) {
      return '<li class="mrow"><span class="d">' + esc(fd(r.date).slice(0, 5)) + '</span><span class="t">' + esc(r.title) + '</span><span class="v">' + (isNum(r.km) ? esc(km(r.km)) : '<span aria-label="без пробігу">—</span>') + '</span></li>';
    }).join('') : signInRow('Записів ще немає.');
  }
  function yearRow(k, r, known) {
    var it = ITEMS[k];
    var miss = known && !r;
    var status = !known ? ' ' : lastText(r);
    return '<li class="yrow' + (miss ? ' miss' : '') + '"><span class="ydot" aria-hidden="true"></span><span class="ytext"><span class="ytitle">' + esc(it.title) + '</span><span class="ystatus">' + esc(status) + '</span></span>' +
      '<button class="icon-btn" type="button" data-info="' + k + '" aria-label="Що купити: ' + esc(lower1(it.title)) + '">' + ICON_INFO + '</button></li>';
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
    if (!list.length) { box.innerHTML = '<p class="empty">' + (S.filter === 'all' ? 'Записів ще немає. Натисніть «Додати запис».' : 'Записів такого типу немає.') + '</p>'; return; }
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
        '<div class="rec-actions"><button class="btn btn-ghost" type="button" data-edit="' + esc(r.id) + '">Редагувати</button><button class="btn btn-ghost btn-danger" type="button" data-del="records/' + esc(r.id) + '">Видалити</button></div>' +
        '</article>';
    }).join('');
  }
  function plural(n, one, few, many) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b === 1) return one;
    if (b >= 2 && b <= 4) return few;
    return many;
  }

  /* ---------- нагадування ---------- */
  function renderOilCard() {
    var o = S.mode === 'in' && S.records ? oilInfo() : null;
    var bar = $('r-oil-bar'), warn = $('r-oil-warn');
    if (!o) {
      setText('r-oil-km', '—'); setText('r-oil-unit', '');
      setText('r-oil-from', ''); setText('r-oil-to', '');
      bar.firstElementChild.style.width = '0%'; bar.setAttribute('aria-label', 'Інтервал заміни ще не розраховано');
      setText('r-oil-sub', S.mode === 'out' ? 'Увійдіть, щоб рахувати наступну заміну.' : (S.records ? 'Додайте запис і позначте «Мастило в двигуні».' : ' '));
      warn.hidden = true;
      return;
    }
    var late = oilLate(o);
    if (o.left !== null) { setText('r-oil-km', num(Math.abs(o.left))); setText('r-oil-unit', o.left >= 0 ? 'км залишилось' : 'км прострочено'); }
    else if (o.daysLeft !== null) { setText('r-oil-km', String(Math.abs(o.daysLeft))); setText('r-oil-unit', o.daysLeft >= 0 ? 'дн. залишилось' : 'дн. прострочено'); }
    else { setText('r-oil-km', '—'); setText('r-oil-unit', ''); }
    bar.classList.toggle('late', late);
    bar.firstElementChild.style.width = o.pct.toFixed(1) + '%';
    var used = o.left !== null ? o.iv - o.left : null;
    bar.setAttribute('aria-label', used !== null ? 'Пройдено ' + km(Math.max(0, used)) + ' з інтервалу ' + km(o.iv) : 'Пробіг до наступної заміни невідомий');
    setText('r-oil-from', isNum(o.last.km) ? num(o.last.km) + ' · заміна' : '');
    setText('r-oil-to', o.nextKm !== null ? num(o.nextKm) + ' · наступна' : '');
    setText('r-oil-sub', 'Остання заміна ' + fd(o.last.date) + (isNum(o.last.km) ? ' на ' + km(o.last.km) : '') + '. Наступна — на ' + (o.nextKm !== null ? km(o.nextKm) : '—') + (o.nextD ? ' або до ' + fd(isoOf(o.nextD)) : '') + ', що настане раніше.');
    warn.hidden = !o.last.warn; warn.textContent = o.last.warn ? 'Увага: ' + o.last.warn : '';
  }
  function renderReminders() {
    renderOilCard();
    var f = $('oil-set');
    if (!f.contains(document.activeElement)) {
      field(f, 'km').value = S.settings.oilIntervalKm || 8000;
      field(f, 'months').value = S.settings.oilIntervalMonths || 12;
    }
    var box = $('rem-list');
    if (S.mode === 'out') box.innerHTML = '<p class="sub">Увійдіть, щоб бачити свої нагадування.</p>';
    else if (S.reminders !== null) {
      var list = remSorted();
      box.innerHTML = list.length ? list.map(function (r) {
        return '<div class="rem' + (r.done ? ' done' : '') + '"><div class="rt"><b>' + esc(r.title) + stateTag(r) + '</b><span>' + esc(remWhen(r)) + (r.note ? ' · ' + esc(r.note) : '') + '</span></div>' +
          '<div class="rem-actions"><button class="btn btn-ghost" type="button" data-rem-edit="' + esc(r.id) + '">Редагувати</button><button class="btn btn-ghost" type="button" data-done="' + esc(r.id) + '" aria-pressed="' + (r.done ? 'true' : 'false') + '">' + (r.done ? 'Повернути' : 'Виконано') + '</button>' +
          '<button class="btn btn-ghost btn-danger" type="button" data-del="reminders/' + esc(r.id) + '">Видалити</button></div></div>';
      }).join('') : '<p class="sub">Поки порожньо. Додайте, наприклад, запис на СТО.</p>';
    }
    var known = S.mode === 'in' && S.records;
    $('where-list').innerHTML = INFO.where.map(function (k, i) {
      var it = ITEMS[k], tracked = INFO.yearly.indexOf(k) >= 0, r = known && tracked ? lastOf(k) : null;
      var lastLine = tracked && known ? '<span class="ylast' + (r ? '' : ' miss') + '">Остання заміна: ' + esc(lastText(r)) + '</span>' : '';
      return '<li class="yrow wrow"><span class="ytext"><span class="ytitle">' + esc(it.title) + '</span><span class="ystatus">' + esc(it.short) + '</span>' + lastLine + '</span>' +
        '<button class="icon-btn" type="button" data-info="' + k + '" aria-label="Що купити: ' + esc(lower1(it.title)) + '">' + ICON_INFO + '</button></li>';
    }).join('');
  }

  /* ---------- обліковий запис ---------- */
  function renderAccount() {
    var who = $('acc-who');
    if (S.mode === 'loading') who.textContent = 'Перевіряємо вхід…';
    else if (S.mode === 'out') who.textContent = 'Ви не увійшли. Каталог і дані авто працюють і без входу.';
    else who.textContent = 'Ви увійшли як ' + (S.user && (S.user.email || S.user.name) || 'користувач') + '. Дані бачите тільки ви.';
    $('acc-signin').hidden = S.mode !== 'out';
    $('acc-signout').hidden = S.mode !== 'in';
    $('acc-export').hidden = S.mode !== 'in';
    $('acc-import').hidden = S.mode !== 'in';
  }

  function renderAll() { renderHero(); renderHome(); renderRecords(); renderReminders(); renderAccount(); }

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
    }, onErr));
    S.unsubs.push(db.collection('reminders').onSnapshot(function (snap) {
      S.reminders = snap.docs.map(function (d) { var o = Object.assign({}, d.data()); o.id = d.id; return o; });
      renderAll();
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
    var st = $('acc-status');
    if (!window.AudiAuth) { note('Вхід ще завантажується. Спробуйте за мить.'); return; }
    window.AudiAuth.signIn().catch(function (e) {
      var c = e && e.code || '';
      if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') return;
      var msg = c === 'auth/unauthorized-domain' ? 'Цей домен не додано в Firebase → Authentication → Authorized domains.' : 'Не вдалося увійти. Спробуйте ще раз.';
      st.textContent = msg; st.className = 'status err'; note(msg);
    });
  }

  /* ---------- форма запису ---------- */
  function buildChecks() {
    var fs = $('svc-checks');
    INFO.yearly.forEach(function (k) {
      var l = document.createElement('label');
      l.innerHTML = '<input type="checkbox" name="svc" value="' + k + '">' + esc(ITEMS[k].title);
      fs.appendChild(l);
    });
  }
  function toggleForm(btnId, formId, open) {
    var f = $(formId), b = $(btnId);
    var show = open === undefined ? f.hidden : open;
    f.hidden = !show; b.setAttribute('aria-expanded', show ? 'true' : 'false');
    // Поки форма відкрита, кнопка «Додати» в шапці зайва: ховаємо її, не зсуваючи шапку.
    b.classList.toggle('is-hidden', show);
    if (show) { var st = f.querySelector('.status'); if (st) { st.textContent = ''; st.className = 'status'; } }
  }
  var EDIT = null;
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
  function setRecMode(rec, preset) {
    var f = $('rec-form');
    f.reset();
    var tmp = f.querySelector('option[data-tmp]'); if (tmp) tmp.remove();
    EDIT = rec ? rec.id : null;
    setText('rec-form-title', rec ? 'Редагувати запис' : 'Новий запис');
    setText('rec-submit', rec ? 'Зберегти зміни' : 'Зберегти');
    var del = $('rec-del-in-form');
    del.hidden = !rec; del.classList.remove('arm'); del.textContent = 'Видалити запис';
    var st = $('rec-status'); st.textContent = ''; st.className = 'status';
    var sel = field(f, 'type');
    if (!rec) {
      field(f, 'date').value = isoOf(new Date());
      var mk = maxKm(); if (mk !== null) field(f, 'km').placeholder = String(mk);
      if (preset) {
        if (preset.title) field(f, 'title').value = preset.title;
        if (preset.type) sel.value = preset.type;
        (preset.svc || []).forEach(function (k) { var c = f.querySelector('input[name="svc"][value="' + k + '"]'); if (c) c.checked = true; });
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
  function recById(id) { return (S.records || []).filter(function (r) { return r.id === id; })[0] || null; }
  function remById(id) { return (S.reminders || []).filter(function (r) { return r.id === id; })[0] || null; }
  var REM_EDIT = null;
  function setRemMode(rem) {
    var f = $('rem-form');
    f.reset();
    REM_EDIT = rem ? rem.id : null;
    setText('rem-form-title', rem ? 'Редагувати нагадування' : 'Нове нагадування');
    setText('rem-submit', rem ? 'Зберегти зміни' : 'Зберегти');
    var st = $('rem-status'); st.textContent = ''; st.className = 'status';
    if (!rem) return;
    field(f, 'title').value = rem.title || '';
    field(f, 'date').value = rem.date || '';
    field(f, 'km').value = isNum(rem.km) ? rem.km : '';
    field(f, 'note').value = rem.note || '';
  }
  function openNewRecord(preset) {
    if (S.mode === 'out') { signIn(); return; }
    go('#records', function () {
      setRecMode(null, preset);
      toggleForm('rec-add-toggle', 'rec-form', true);
      var f = $('rec-form');
      f.scrollIntoView({ block: 'start' });
      var first = preset && preset.title ? field(f, 'km') : field(f, 'title');
      if (first) first.focus({ preventScroll: true });
    });
  }

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
    if (INFO.yearly.indexOf(kind) >= 0) {
      var r = S.mode === 'in' && S.records ? lastOf(kind) : null;
      facts.push({ k: 'Остання заміна', v: S.mode === 'in' && S.records ? lastText(r) : 'після входу' });
    }
    if (it.fact) facts.push(it.fact);
    $('info-facts').innerHTML = facts.map(function (x) { return '<div class="fact"><span class="label-s">' + esc(x.k) + '</span><b>' + esc(x.v) + '</b></div>'; }).join('');
    var nt = $('info-note'); nt.hidden = !it.note; nt.textContent = it.note || '';
    var more = $('info-more'); more.hidden = !it.more; if (it.more) more.setAttribute('href', it.more);
    $('info-log').hidden = !!it.noLog;
    $('info-log').textContent = S.mode === 'out' ? 'Увійти, щоб записати заміну' : 'Записати заміну';
    if (typeof dlg.showModal === 'function') { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', '');
    $('info-close').focus();
  }
  function closeInfo() {
    if (typeof dlg.close === 'function' && dlg.open) dlg.close(); else dlg.removeAttribute('open');
  }
  dlg.addEventListener('close', function () { if (infoOpener && infoOpener.isConnected) infoOpener.focus(); infoOpener = null; });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) closeInfo(); });
  $('info-close').addEventListener('click', closeInfo);
  $('info-more').addEventListener('click', function () { infoOpener = null; closeInfo(); });
  $('info-log').addEventListener('click', function () {
    var it = ITEMS[infoKind];
    infoOpener = null; closeInfo();
    openNewRecord({ title: 'Заміна: ' + lower1(it.title), type: 'to', svc: [infoKind] });
  });

  /* ---------- події ---------- */
  buildChecks();
  route();
  renderAll();

  document.querySelectorAll('[data-add-record]').forEach(function (b) { b.addEventListener('click', function () { openNewRecord(null); }); });
  $('rec-add-toggle').addEventListener('click', function () {
    if (S.mode === 'out') { signIn(); return; }
    var f = $('rec-form');
    if (EDIT) { setRecMode(null); toggleForm('rec-add-toggle', 'rec-form', true); return; }
    if (f.hidden) setRecMode(null);
    toggleForm('rec-add-toggle', 'rec-form');
    if (!f.hidden) field(f, 'title').focus();
  });
  $('rec-del-in-form').addEventListener('click', function () {
    var b = this;
    if (!EDIT || !S.db) return;
    if (!b.classList.contains('arm')) {
      b.classList.add('arm'); b.textContent = 'Точно видалити?';
      setTimeout(function () { if (b.isConnected && b.classList.contains('arm')) { b.classList.remove('arm'); b.textContent = 'Видалити запис'; } }, 4000);
      return;
    }
    var id = EDIT; b.disabled = true;
    S.db.doc('records/' + id).delete().then(function () {
      b.disabled = false; setRecMode(null); toggleForm('rec-add-toggle', 'rec-form', false);
    }, function () { b.disabled = false; b.textContent = 'Не вдалося видалити'; });
  });
  $('rem-add-toggle').addEventListener('click', function () {
    if (S.mode === 'out') { signIn(); return; }
    if (REM_EDIT) { setRemMode(null); toggleForm('rem-add-toggle', 'rem-form', true); field($('rem-form'), 'title').focus(); return; }
    if ($('rem-form').hidden) setRemMode(null);
    toggleForm('rem-add-toggle', 'rem-form');
    if (!$('rem-form').hidden) field($('rem-form'), 'title').focus();
  });
  document.querySelectorAll('[data-close]').forEach(function (b) {
    b.addEventListener('click', function () {
      var id = b.getAttribute('data-close');
      toggleForm(id === 'rec-form' ? 'rec-add-toggle' : 'rem-add-toggle', id, false);
      if (id === 'rec-form') setRecMode(null); else setRemMode(null);
    });
  });
  document.querySelectorAll('[data-filter]').forEach(function (b) {
    b.addEventListener('click', function () {
      S.filter = b.getAttribute('data-filter');
      document.querySelectorAll('[data-filter]').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      renderRecords();
    });
  });

  $('rec-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var f = ev.target, st = $('rec-status');
    if (!S.db) { st.textContent = 'Увійдіть, щоб зберігати записи.'; st.className = 'status err'; return; }
    var data = {
      date: field(f, 'date').value, km: numOrNull(field(f, 'km').value), types: String(field(f, 'type').value).split(','),
      title: field(f, 'title').value.trim(), items: parseItems(field(f, 'items').value),
      total: numOrNull(field(f, 'total').value), note: field(f, 'note').value.trim(),
      svc: Array.prototype.slice.call(f.querySelectorAll('input[name="svc"]:checked')).map(function (c) { return c.value; })
    };
    if (!data.title || !data.date) { st.textContent = 'Вкажіть дату й що зробили.'; st.className = 'status err'; return; }
    var id, body;
    if (EDIT) {
      var orig = recById(EDIT);
      if (!orig) { st.textContent = 'Цей запис уже видалено.'; st.className = 'status err'; return; }
      id = EDIT;
      body = Object.assign({}, orig, data, { updatedAt: new Date().toISOString() });
      delete body.id;
    } else {
      id = newId('r');
      body = Object.assign({}, data, { createdAt: new Date().toISOString() });
    }
    var btn = f.querySelector('button[type="submit"]'); btn.disabled = true; st.className = 'status'; st.textContent = 'Зберігаємо…';
    S.db.collection('records').doc(id).set(body).then(function () {
      btn.disabled = false; setRecMode(null); toggleForm('rec-add-toggle', 'rec-form', false);
    }, function (e) { st.textContent = failMsg(e); st.className = 'status err'; btn.disabled = false; });
  });

  $('rem-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var f = ev.target, st = $('rem-status');
    if (!S.db) { st.textContent = 'Увійдіть, щоб зберігати нагадування.'; st.className = 'status err'; return; }
    var data = { title: field(f, 'title').value.trim(), date: field(f, 'date').value || null, km: numOrNull(field(f, 'km').value), note: field(f, 'note').value.trim() };
    if (!data.title) { st.textContent = 'Вкажіть, що зробити.'; st.className = 'status err'; return; }
    var id, body;
    if (REM_EDIT) {
      var orig = remById(REM_EDIT);
      if (!orig) { st.textContent = 'Це нагадування вже видалено.'; st.className = 'status err'; return; }
      id = REM_EDIT;
      body = Object.assign({}, orig, data, { updatedAt: new Date().toISOString() });
      delete body.id;
    } else {
      id = newId('m');
      body = Object.assign({}, data, { done: false, createdAt: new Date().toISOString() });
    }
    var btn = f.querySelector('button[type="submit"]'); btn.disabled = true; st.className = 'status'; st.textContent = 'Зберігаємо…';
    S.db.collection('reminders').doc(id).set(body).then(function () {
      setRemMode(null); btn.disabled = false; toggleForm('rem-add-toggle', 'rem-form', false);
    }, function (e) { st.textContent = failMsg(e); st.className = 'status err'; btn.disabled = false; });
  });

  $('oil-set').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var f = ev.target, st = $('oil-status');
    if (!S.db) { st.textContent = 'Увійдіть, щоб зберегти інтервал.'; st.className = 'status err'; return; }
    var kmv = numOrNull(field(f, 'km').value), mo = numOrNull(field(f, 'months').value);
    if (!kmv || !mo) { st.textContent = 'Вкажіть пробіг і місяці.'; st.className = 'status err'; return; }
    st.className = 'status'; st.textContent = 'Зберігаємо…';
    S.db.doc('settings/main').set({ oilIntervalKm: kmv, oilIntervalMonths: mo }).then(function () { st.textContent = 'Збережено.'; }, function (e) { st.textContent = failMsg(e); st.className = 'status err'; });
  });

  /* ---------- обліковий запис: вхід, вихід, резервна копія ---------- */
  $('acc-signin').addEventListener('click', signIn);
  $('acc-signout').addEventListener('click', function () { if (window.AudiAuth) window.AudiAuth.signOut(); });
  $('acc-export').addEventListener('click', function () {
    var strip = function (o) { var c = Object.assign({}, o); return c; };
    var out = { app: 'audi-a6', version: 1, exportedAt: new Date().toISOString(), records: (S.records || []).map(strip), reminders: (S.reminders || []).map(strip), settings: { main: S.settings } };
    var blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'audi-a6-backup-' + isoOf(new Date()) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    var st = $('acc-status'); st.className = 'status'; st.textContent = 'Резервну копію збережено у файл.';
  });
  $('acc-import').addEventListener('click', function () { $('acc-file').click(); });
  $('acc-file').addEventListener('change', function () {
    var file = this.files && this.files[0], input = this, st = $('acc-status');
    if (!file || !S.db) return;
    var rd = new FileReader();
    rd.onload = function () {
      input.value = '';
      var data;
      try { data = JSON.parse(String(rd.result)); } catch (e) { st.textContent = 'Це не файл резервної копії.'; st.className = 'status err'; return; }
      if (!data || data.app !== 'audi-a6' || !Array.isArray(data.records)) { st.textContent = 'Це не файл резервної копії цього застосунку.'; st.className = 'status err'; return; }
      var ok = /^[A-Za-z0-9_-]{1,64}$/;
      var writes = [];
      data.records.forEach(function (r) { if (r && ok.test(r.id || '')) { var b = Object.assign({}, r); delete b.id; writes.push(['records/' + r.id, b]); } });
      (Array.isArray(data.reminders) ? data.reminders : []).forEach(function (r) { if (r && ok.test(r.id || '')) { var b = Object.assign({}, r); delete b.id; writes.push(['reminders/' + r.id, b]); } });
      if (data.settings && data.settings.main && typeof data.settings.main === 'object') writes.push(['settings/main', data.settings.main]);
      st.className = 'status'; st.textContent = 'Відновлюємо…';
      var done = S.db.batchSet ? S.db.batchSet(writes) : Promise.all(writes.map(function (w) { return S.db.doc(w[0]).set(w[1]); }));
      done.then(function () {
        var nr = writes.filter(function (w) { return w[0].indexOf('records/') === 0; }).length;
        var nm = writes.filter(function (w) { return w[0].indexOf('reminders/') === 0; }).length;
        st.textContent = 'Відновлено: ' + nr + ' ' + plural(nr, 'запис', 'записи', 'записів') + ', ' + nm + ' ' + plural(nm, 'нагадування', 'нагадування', 'нагадувань') + '.';
      }, function (e) { st.textContent = failMsg(e); st.className = 'status err'; });
    };
    rd.readAsText(file);
  });

  /* ---------- делеговані кліки ---------- */
  var live = $('live');
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    var si = t.closest('[data-signin]');
    if (si) { signIn(); return; }
    var info = t.closest('[data-info]');
    if (info) { openInfo(info.getAttribute('data-info'), info); return; }
    var ed = t.closest('[data-edit]');
    if (ed) {
      var rec = recById(ed.getAttribute('data-edit'));
      if (!rec) return;
      setRecMode(rec);
      toggleForm('rec-add-toggle', 'rec-form', true);
      var fm = $('rec-form');
      requestAnimationFrame(function () { fm.scrollIntoView({ block: 'start' }); field(fm, 'title').focus({ preventScroll: true }); });
      return;
    }
    var re = t.closest('[data-rem-edit]');
    if (re) {
      var rem = remById(re.getAttribute('data-rem-edit'));
      if (!rem) return;
      setRemMode(rem);
      toggleForm('rem-add-toggle', 'rem-form', true);
      var rf = $('rem-form');
      requestAnimationFrame(function () { rf.scrollIntoView({ block: 'start' }); field(rf, 'title').focus({ preventScroll: true }); });
      return;
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
    var done = t.closest('[data-done]');
    if (done && S.db) {
      var on = done.getAttribute('aria-pressed') !== 'true';
      done.disabled = true;
      S.db.doc('reminders/' + done.getAttribute('data-done')).update({ done: on }).then(null, function () { done.disabled = false; });
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

  /* стан входу міг прийти раніше, ніж цей скрипт підписався */
  if (window.__audiAuth) onAuth(window.__audiAuth);
})();
