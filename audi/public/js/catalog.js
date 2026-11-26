/* Каталог запчастин: схеми кріплень щитів і підсвітка зон на оглядовій схемі.
   Копіювання кодів обробляє app.js (одна делегована подія для всіх кнопок [data-code]). */
(function () {
  /* ---------- per-segment fastener maps ----------
     u: 0 = front edge, 1 = rear edge (drawn left to right)
     w: 0 = top edge, 1 = bottom edge (top = driver side, as on the seller's diagram)
     positions traced from the Audi A6 4G workshop manual figures */
  var NAMES = { nut: 'гайка', rivet: 'пістон', bolt: 'болт', qr: 'фіксатор', clip: 'кліпса', spring: 'гайка-скоба' };
  /* wheel-arch side views: deg 180 = front bottom, 90 = top, 0 = rear bottom; r 1 = outer edge */
  var IN = 0.62;
  function arc(t, deg, r) {
    var a = deg * Math.PI / 180;
    return [t, 0.5 + 0.5 * r * Math.cos(a), 1 - r * Math.sin(a)];
  }
  var FIG = {
    p1: { L: 80, W: 300, top: 'ліва сторона', bottom: 'права сторона',
      shape: [[0.38,0],[1,0],[1,1],[0.38,1],[0.24,0.9],[0.14,0.8],[0.06,0.7],[0.015,0.6],[0,0.5],[0.015,0.4],[0.06,0.3],[0.14,0.2],[0.24,0.1]],
      f: [ ['bolt',0.44,0.06],['bolt',0.24,0.27],['bolt',0.15,0.5],['bolt',0.24,0.73],['bolt',0.44,0.94],
           ['bolt',0.86,0.08],['bolt',0.86,0.3],['bolt',0.86,0.7],['bolt',0.86,0.92] ],
      cap: 'Ліворуч — 5 гвинтів по дузі бампера (1,5 Нм), праворуч — 4 по задньому краю (5 Нм). Розташування приблизне.' },
    p2: { L: 96, W: 300, top: 'ліва сторона', bottom: 'права сторона',
      shape: [[0,0],[1,0],[1,1],[0,1]], ears: [[0,0,1,0.11],[0,0.89,1,1]],
      f: [ ['qr',0.08,0.15],['qr',0.08,0.5],['qr',0.08,0.85],
           ['bolt',0.12,0.05],['bolt',0.7,0.05],['bolt',0.12,0.95],['bolt',0.7,0.95],
           ['bolt',0.96,0.28,1],['bolt',0.96,0.5,1],['bolt',0.96,0.72,1],
           ['qr',0.3,0.035,0,1],['qr',0.55,0.035,0,1],['qr',0.3,0.965,0,1],['qr',0.55,0.965,0,1] ],
      cap: 'Квадрат із пунктиром — болти на стику з №3. Бліді трикутники на вухах — фіксатори спойлерів №12/13.' },
    p3: { L: 200, W: 300, top: 'ліва сторона', bottom: 'права сторона',
      shape: [[0,0],[0.8,0],[1,0.2],[1,0.8],[0.8,1],[0,1]],
      f: [ ['bolt',0.03,0.25,1],['bolt',0.03,0.48,1],['bolt',0.03,0.72,1],
           ['qr',0.5,0.5],['qr',0.28,0.09],['qr',0.61,0.11],['qr',0.28,0.91],['qr',0.61,0.89],['qr',0.96,0.31],['qr',0.96,0.68] ],
      cap: 'Квадрати з пунктиром — болти на стику з №2.' },
    p4: { L: 200, W: 180, top: 'поріг', bottom: 'тунель',
      shape: [[0.25,0],[1,0],[1,1],[0.05,1],[0.02,0.62],[0.1,0.25]],
      f: [ ['nut',0.4,0.47],['rivet',0.58,0.95] ] },
    p6: { L: 330, W: 120, top: 'поріг', bottom: 'тунель',
      shape: [[0,0],[1,0],[1,1],[0.88,0.98],[0.67,0.87],[0.25,0.84],[0.23,0.67],[0,0.67]],
      f: [ ['nut',0.11,0.06],['nut',0.3,0.06],['nut',0.52,0.06],['nut',0.75,0.06],['nut',0.96,0.06],
           ['nut',0.3,0.8],['nut',0.545,0.8],['nut',0.67,0.82],['nut',0.88,0.93],
           ['nut',0.36,0.28],
           ['rivet',0.05,0.6],['rivet',0.78,0.72] ] },
    p8: { L: 240, W: 170, top: 'поріг', bottom: 'тунель',
      shape: [[0,0],[0.8,0],[1,0.4],[1,0.87],[0.27,0.87],[0.18,0.96],[0,1]],
      f: [ ['bolt',0.34,0.85],['bolt',0.86,0.83],['bolt',0.97,0.8],['bolt',0.97,0.47],['bolt',0.78,0.08],
           ['nut',0.02,0.1,1] ],
      cap: 'Кружок із пунктиром — гайка на стику з №6.' },
    p9: { L: 240, W: 170, top: 'тунель', bottom: 'поріг',
      shape: [[0,1],[0,0],[0.42,0.34],[0.69,0.3],[0.95,0.04],[1,0.11],[1,1]],
      f: [ ['bolt',0.81,0.89],['bolt',0.97,0.53],['bolt',0.97,0.2],
           ['nut',0.02,0.88,1],['nut',0.9,0.12] ],
      cap: 'Кружок із пунктиром — гайка на стику з №7.' },
    p12: { L: 150, W: 120, top: 'крило', bottom: 'до щита №2',
      shape: [[0,0],[0.55,0],[0.85,0.12],[1,0.45],[1,1],[0,1]], wall: [[0.55,0],[0.85,0.12],[1,0.45]],
      f: [ ['qr',0.3,0.92],['qr',0.68,0.92],['spring',0.88,0.75],['bolt',0.06,0.08],['rivet',0.78,0.2],['clip',0.55,0.05],['clip',0.97,0.55] ],
      cap: 'Розташування приблизне: у посібнику спойлер показано в перспективі. Темна смуга — вертикальна стінка по краю арки.' },
    p14: { L: 220, W: 120, top: 'вид збоку · лівий бік', arch: true,
      f: [ arc('bolt',176,0.94), arc('bolt',164,0.95), arc('bolt',152,0.95), arc('bolt',140,0.95), arc('bolt',179,0.74),
           arc('rivet',163,0.74), arc('rivet',148,0.75),
           arc('nut',122,0.86), arc('nut',78,0.72),
           arc('bolt',64,0.95),
           arc('clip',22,0.86), arc('clip',8,0.84) ],
      cap: 'Квадрати спереду — саморізи до бампера, квадрат угорі праворуч — болт кронштейна до крила. Кліпси ззаду внизу.' },
    p16: { L: 220, W: 120, top: 'вид збоку · лівий бік', arch: true,
      f: [ arc('clip',172,0.86), arc('clip',152,0.86), arc('clip',132,0.86), arc('clip',112,0.86), arc('clip',92,0.86),
           arc('clip',72,0.86), arc('clip',52,0.86), arc('clip',34,0.86), arc('clip',18,0.88),
           arc('bolt',6,0.94), arc('bolt',4,0.78), arc('bolt',13,0.7) ],
      cap: '9 кліпс по краю арки, 3 саморізи ззаду внизу біля бампера.' }
  };
  FIG.p15 = flipFront(FIG.p14, 'вид збоку · правий бік');
  FIG.p15.cap = 'Квадрати праворуч — саморізи до бампера, квадрат угорі ліворуч — болт кронштейна до крила. Кліпси ззаду внизу.';
  FIG.p17 = flipFront(FIG.p16, 'вид збоку · правий бік');

  function flipFront(d, top) {
    var m = JSON.parse(JSON.stringify(d));
    m.f = m.f.map(function (f) { var g = f.slice(); g[1] = 1 - g[1]; return g; });
    m.frontRight = true; m.top = top;
    return m;
  }
  FIG.p5 = mirror(FIG.p4, 'тунель', 'поріг');
  FIG.p7 = mirror(FIG.p6, 'тунель', 'поріг');
  FIG.p13 = mirror(FIG.p12, 'до щита №2', 'крило');

  function mirror(d, top, bottom) {
    var m = JSON.parse(JSON.stringify(d));
    m.shape = m.shape.map(function (p) { return [p[0], 1 - p[1]]; });
    m.f = m.f.map(function (f) { var g = f.slice(); g[2] = 1 - g[2]; return g; });
    if (m.wall) m.wall = m.wall.map(function (p) { return [p[0], 1 - p[1]]; });
    m.top = top; m.bottom = bottom;
    return m;
  }

  var NS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function marker(g, t, x, y, s) {
    var cls = 't-' + t;
    if (t === 'nut') el('circle', { cx: x, cy: y, r: s, fill: 'currentColor', 'class': cls }, g);
    else if (t === 'rivet') el('polygon', { points: [x, y - s * 1.15, x + s * 1.15, y, x, y + s * 1.15, x - s * 1.15, y].join(' '), fill: 'currentColor', 'class': cls }, g);
    else if (t === 'bolt') el('rect', { x: x - s * 0.9, y: y - s * 0.9, width: s * 1.8, height: s * 1.8, fill: 'currentColor', 'class': cls }, g);
    else if (t === 'qr') el('polygon', { points: [x, y - s * 1.1, x + s * 1.05, y + s * 0.8, x - s * 1.05, y + s * 0.8].join(' '), fill: 'currentColor', 'class': cls }, g);
    else if (t === 'clip') el('circle', { cx: x, cy: y, r: s * 0.8, fill: 'none', stroke: 'currentColor', 'stroke-width': s * 0.5, 'class': cls }, g);
    else if (t === 'spring') el('rect', { x: x - s * 1.1, y: y - s * 0.6, width: s * 2.2, height: s * 1.2, rx: 2, fill: 'none', stroke: 'currentColor', 'stroke-width': s * 0.42, 'class': cls }, g);
  }

  function render(box) {
    var d = FIG[box.getAttribute('data-fig')];
    if (!d) return;
    var my = 22, s = 7;
    var ml = d.frontRight ? 16 : 34, mr = d.frontRight ? 34 : 16;
    var vw = d.L + ml + mr, vh = d.W + my * 2;
    var X = function (u) { return ml + u * d.L; };
    var Y = function (w) { return my + w * d.W; };
    var svg = el('svg', { viewBox: '0 0 ' + vw + ' ' + vh, role: 'img' });
    svg.style.maxWidth = Math.round(vw * 1.35) + 'px';
    el('title', {}, svg).textContent = d.arch ? 'Схема кріплень підкрилка, вид збоку' : 'Схема кріплень, вид знизу, перед ліворуч';
    var shape = d.shape;
    if (d.arch) {
      shape = [];
      for (var k = 0; k <= 36; k++) { var a1 = Math.PI - k * Math.PI / 36; shape.push([0.5 + 0.5 * Math.cos(a1), 1 - Math.sin(a1)]); }
      for (var j = 0; j <= 36; j++) { var a2 = j * Math.PI / 36; shape.push([0.5 + 0.5 * IN * Math.cos(a2), 1 - IN * Math.sin(a2)]); }
    }
    var pts = shape.map(function (p) { return X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1); }).join(' ');
    el('polygon', { points: pts, 'class': 'pshape' }, svg);
    (d.ears || []).forEach(function (r) {
      el('rect', { x: X(r[0]), y: Y(r[1]), width: X(r[2]) - X(r[0]), height: Y(r[3]) - Y(r[1]), 'class': 'pear' }, svg);
    });
    if (d.wall) {
      el('polyline', { points: d.wall.map(function (p) { return X(p[0]) + ',' + Y(p[1]); }).join(' '), fill: 'none', stroke: 'var(--muted)', 'stroke-width': 6, 'stroke-linejoin': 'round', opacity: '.55' }, svg);
    }
    var lx = d.frontRight ? vw - 12 : 12, ly = my + d.W / 2;
    var lt = el('text', { x: lx, y: ly, 'text-anchor': 'middle', 'class': 'plbl', transform: 'rotate(' + (d.frontRight ? 90 : -90) + ' ' + lx + ' ' + ly + ')' }, svg);
    lt.textContent = 'ПЕРЕД';
    if (d.top) el('text', { x: X(0.5), y: my - 8, 'text-anchor': 'middle', 'class': 'plbl' }, svg).textContent = d.top;
    if (d.bottom) el('text', { x: X(0.5), y: my + d.W + 16, 'text-anchor': 'middle', 'class': 'plbl' }, svg).textContent = d.bottom;
    if (d.arch) el('text', { x: X(0.5), y: Y(0.86), 'text-anchor': 'middle', 'class': 'plbl' }, svg).textContent = 'колесо';
    var used = {};
    d.f.forEach(function (f) {
      var g = el('g', f[4] ? { 'class': 'mk-other' } : {}, svg);
      var x = X(f[1]), y = Y(f[2]);
      if (f[3]) el('circle', { cx: x, cy: y, r: s * 1.9, 'class': 'shared-ring' }, g);
      marker(g, f[0], x, y, s);
      if (!f[4]) used[f[0]] = true;
    });
    box.appendChild(svg);
    var ul = document.createElement('ul');
    ul.className = 'fleg';
    ['nut', 'rivet', 'bolt', 'qr', 'clip', 'spring'].forEach(function (t) {
      if (!used[t]) return;
      var li = document.createElement('li');
      li.innerHTML = '<svg class="ico t-' + t + '" aria-hidden="true"><use href="#i-' + t + '"/></svg>' + NAMES[t];
      ul.appendChild(li);
    });
    box.appendChild(ul);
    if (d.cap) {
      var p = document.createElement('p');
      p.className = 'figcap';
      p.textContent = d.cap;
      box.appendChild(p);
    }
  }
  document.querySelectorAll('.pfig[data-fig]').forEach(function (b) { try { render(b); } catch (e) {} });

  /* ---------- overview hover (mouse only) ---------- */
  var canHover = false;
  try { canHover = window.matchMedia('(hover: hover)').matches; } catch (e) {}
  if (!canHover) return;
  var zones = document.querySelectorAll('.zone');
  function setOn(n, on) {
    zones.forEach(function (z) { if (z.getAttribute('data-zone') === n) z.classList.toggle('is-on', on); });
    var card = document.querySelector('.part[data-zone="' + n + '"]');
    if (card) card.classList.toggle('is-on', on);
  }
  document.querySelectorAll('.part[data-zone]').forEach(function (card) {
    var n = card.getAttribute('data-zone');
    card.addEventListener('mouseenter', function () { setOn(n, true); });
    card.addEventListener('mouseleave', function () { setOn(n, false); });
  });
  zones.forEach(function (z) {
    var n = z.getAttribute('data-zone');
    z.addEventListener('mouseenter', function () { setOn(n, true); });
    z.addEventListener('mouseleave', function () { setOn(n, false); });
  });
})();
