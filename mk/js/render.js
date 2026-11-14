// Головна, сторінка запису, блок «Зараз», переглядач фото.
import { h, str, dparts, dm, dmy, plural, todayISO, put } from "./util.js";
import { S, CATS, catOf, fileUrl, thumbUrl, toggleTodo, removeRecord, findRecord } from "./data.js";

const $ = (id) => document.getElementById(id);
const photos = (r) => (Array.isArray(r.gallery) ? r.gallery.filter((g) => g && g.file) : []);
const safeId = (id) => (/^[A-Za-z0-9_-]+$/.test(str(id)) ? str(id) : null);

export function rememberHome() {
  S.fromList = true;
  S.homeScroll = window.scrollY || 0;
}
export function goHome() {
  if (S.fromList) { S.fromList = false; history.back(); }
  else location.hash = "";
}
export const backBtn = (label = "Усі записи") =>
  h("button", { class: "back", type: "button", onclick: goHome }, h("span", { "aria-hidden": "true", text: "←" }), label);

/* ---------- collapsed rows ---------- */
function rowEl({ href, date, title, meta, summary }) {
  const p = dparts(date);
  const el = h(href ? "a" : "div", { class: "row", href },
    h("div", { class: "row-date" },
      h("div", { class: "dm", text: p ? `${p.d}.${p.m}` : "—" }),
      h("div", { class: "y", text: p ? p.y : "" })),
    h("div", { class: "row-main" },
      h("span", { class: "row-title", text: title || "Без назви" }),
      h("div", { class: "row-meta" }, meta),
      summary ? h("p", { class: "row-sum", text: summary }) : null),
    h("span", { class: "chev", "aria-hidden": "true", text: "›" }));
  if (href) el.addEventListener("click", rememberHome);
  return el;
}

export function renderChips() {
  const present = {};
  S.records.forEach((r) => { present[catOf(r)] = true; });
  if (S.filter !== "all" && !present[S.filter]) S.filter = "all";
  const opts = [["all", "Усі"], ...Object.keys(CATS).filter((k) => present[k]).map((k) => [k, CATS[k]])];
  put($("chips"), ...opts.map(([k, label]) => h("button", {
    class: "chip", type: "button", "aria-pressed": S.filter === k ? "true" : "false", text: label,
    onclick: () => {
      S.filter = k;
      try { localStorage.setItem("medcard-filter", k); } catch { /* ignore */ }
      renderChips();
      renderList();
    },
  })));
}

export function renderList() {
  const tl = $("timeline");
  const nImg = S.records.reduce((a, r) => a + photos(r).length, 0);
  $("n-rec").textContent = S.loaded ? String(S.records.length) : "–";
  $("n-img").textContent = S.loaded ? String(nImg) : "–";
  if (!S.loaded) {
    put(tl, h("div", { class: "state" }, h("strong", { text: "Завантажую записи…" })));
    return;
  }
  if (S.error) {
    put(tl, h("div", { class: "state" }, h("strong", { text: "Не вдалося завантажити записи" }), h("span", { text: "Перевір з'єднання й онови сторінку." })));
    return;
  }
  const list = S.records.filter((r) => S.filter === "all" || catOf(r) === S.filter);
  if (!list.length) {
    put(tl, h("div", { class: "state" },
      h("strong", { text: "Записів поки немає" }),
      h("span", null, "Натисни «Додати запис», щоб сфотографувати бланк, або ", h("a", { href: "#import", text: "імпортуй записи з claude.ai" }), ".")));
    return;
  }
  put(tl, h("div", { class: "list" }, list.map((r) => {
    const id = safeId(r._id);
    const cat = catOf(r);
    const n = photos(r).length;
    return rowEl({
      href: id ? `#r-${id}` : null,
      date: r.date,
      title: str(r.title),
      meta: [h("span", { class: `cat ${cat}`, text: CATS[cat] }), n ? h("span", { class: "mono", text: `${n} ${plural(n, "файл", "файли", "файлів")}` }) : null],
      summary: str(r.brief || r.summary),
    });
  })));
}

/* ---------- «Зараз» ---------- */
function stageInfo(st) {
  const today = todayISO();
  const plan = Array.isArray(st.plan) ? st.plan : [];
  let cur = -1;
  plan.forEach((p, i) => { if (str(p.start) && str(p.start) <= today) cur = i; });
  const last = plan[plan.length - 1];
  const finished = !!(last && str(last.end) && today > str(last.end));
  if (cur === -1 && plan.length) cur = 0;
  return { plan, cur, finished };
}

function todoItem(t, i, prefix, readOnly) {
  const id = `${prefix}-${str(t.id || i).replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const cb = h("input", { type: "checkbox", id });
  cb.checked = !!t.done;
  cb.disabled = readOnly || S.saving;
  cb.addEventListener("change", async () => {
    setTodoMsg("Зберігаю…");
    const res = await toggleTodo(i, cb.checked);
    setTodoMsg(res.ok ? "" : "Не вдалося зберегти. Спробуй ще раз.");
  });
  return h("li", { class: t.done ? "is-done" : null }, cb,
    h("label", { for: id }, str(t.text),
      t.due ? h("span", { class: "due", text: `до ${dm(t.due)}` }) : null,
      prefix === "todo" && t.note ? h("span", { class: "note", text: str(t.note) }) : null));
}
function setTodoMsg(t) {
  ["todo-msg", "now-todo-msg"].forEach((id) => { const m = $(id); if (m) m.textContent = t; });
}
function keepFocus(fn) {
  const id = document.activeElement?.id;
  fn();
  if (id) $(id)?.focus();
}

export function renderNowPanel() {
  const box = $("now-panel");
  const st = S.status;
  if (!st) { box.hidden = true; put(box, ); return; }
  keepFocus(() => {
    const si = stageInfo(st);
    let stageBlock = null;
    if (si.plan.length) {
      const p = si.plan[si.cur];
      const nx = !si.finished && si.cur + 1 < si.plan.length ? si.plan[si.cur + 1] : null;
      stageBlock = h("div", { class: "cur" },
        h("div", { class: "mini", style: `grid-template-columns:repeat(${si.plan.length},minmax(0,1fr))`, "aria-hidden": "true" },
          si.plan.map((_, i) => h("span", { class: si.finished || i < si.cur ? "seg-done" : i === si.cur ? "seg-now" : null }))),
        si.finished ? h("span", { class: "t", text: "Курс лікування завершено" }) : [
          h("span", { class: "k", text: `Етап ${si.cur + 1} з ${si.plan.length} · ${str(p.dates)}` }),
          h("span", { class: "t", text: str(p.title) }),
          p.how ? h("span", { class: "how", text: str(p.how) }) : null,
          nx ? h("span", { class: "next", text: `Далі: ${str(nx.title)}${nx.start ? ` з ${dm(nx.start)}` : ""}` }) : null,
        ]);
    }
    const care = Array.isArray(st.care) ? st.care : [];
    const careEl = care.length ? h("div", null, h("div", { class: "label", text: "Догляд" }),
      h("dl", { class: "care compact" }, care.flatMap((c) => [h("dt", { text: str(c.when) }), h("dd", { text: str(c.what) })]))) : null;
    const todo = Array.isArray(st.todo) ? st.todo : [];
    const open = todo.map((t, i) => (t.done ? -1 : i)).filter((i) => i >= 0);
    const shown = open.slice(0, 3);
    const undoT = S.lastDone != null && todo[S.lastDone]?.done ? todo[S.lastDone] : null;
    const todoEl = todo.length ? h("div", null,
      h("div", { class: "label", text: `Справи · ${open.length} з ${todo.length}` }),
      shown.length ? h("ul", { class: "todo compact" }, shown.map((i) => todoItem(todo[i], i, "ptodo", false))) : h("p", { class: "src", text: "Усі справи зроблено." }),
      open.length > shown.length ? h("a", { class: "more", href: "#now", onclick: rememberHome, text: `ще ${open.length - shown.length} ›` }) : null,
      undoT ? h("div", { class: "undo" }, h("span", { text: `Позначено: ${str(undoT.text)}` }),
        h("button", { class: "linkbtn", type: "button", id: "ptodo-undo", text: "Повернути", onclick: () => toggleTodo(S.lastDone, false) })) : null,
      h("div", { class: "saving", id: "now-todo-msg", role: "status" })) : null;
    put(box, 
      h("div", { class: "now-head" },
        h("div", null, h("div", { class: "eyebrow", text: "Зараз" }), h("h2", { id: "now-title", text: str(st.diagnosis_short || st.diagnosis) })),
        h("a", { class: "more", href: "#now", onclick: rememberHome, text: "Детальніше ›" })),
      h("div", { class: "now-grid" }, h("div", { class: "now-col" }, stageBlock, careEl), todoEl));
    box.hidden = false;
  });
}

export function renderNowPage(box) {
  const st = S.status;
  document.title = "Поточне лікування · Медкартка";
  if (!st) {
    put(box, backBtn(), h("div", { class: "state" }, h("strong", { text: S.statusLoaded ? "Даних про лікування поки немає" : "Завантажую…" })));
    return;
  }
  keepFocus(() => {
    const si = stageInfo(st);
    const todo = Array.isArray(st.todo) ? st.todo : [];
    const left = todo.filter((t) => !t.done).length;
    const care = Array.isArray(st.care) ? st.care : [];
    put(box, 
      backBtn(),
      h("header", { class: "rec-head" },
        h("div", { class: "row-meta" }, h("span", { class: "cat now", text: "Зараз" }), st.updated ? h("span", { class: "mono", text: `оновлено ${dmy(st.updated)}` }) : null),
        h("h2", { text: "Поточне лікування" }),
        st.diagnosis_meta ? h("span", { class: "src", text: str(st.diagnosis_meta) }) : null),
      st.diagnosis ? h("p", { class: "summary", text: `Діагноз: ${str(st.diagnosis)}.` }) : null,
      si.plan.length ? h("div", { class: "block" },
        h("h3", { text: si.finished ? "Курс лікування завершено" : "Курс лікування" }),
        h("div", { class: "stages" }, si.plan.map((p, i) => {
          const done = si.finished || i < si.cur;
          const now = !done && i === si.cur;
          return h("div", { class: `stage${done ? " done" : now ? " now" : ""}` },
            h("span", { class: "n", text: `Етап ${i + 1} · ${done ? "завершено" : now ? "зараз" : "далі"}` }),
            h("span", { class: "t", text: str(p.title) }),
            h("span", { class: "d", text: str(p.dates) }),
            p.how ? h("span", { class: "how", text: str(p.how) }) : null);
        })),
        st.plan_note ? h("p", { class: "plan-note", text: str(st.plan_note) }) : null) : null,
      todo.length ? h("div", { class: "block" },
        h("h3", { text: `Що зробити · ${left ? `${left} з ${todo.length}` : "усе зроблено"}` }),
        h("div", { class: "box" }, h("ul", { class: "todo" }, todo.map((t, i) => todoItem(t, i, "todo", false))), h("div", { class: "saving", id: "todo-msg", role: "status" }))) : null,
      care.length ? h("div", { class: "block" },
        h("h3", { text: "Щоденний догляд" }),
        h("div", { class: "box" },
          h("dl", { class: "care" }, care.flatMap((c) => [h("dt", { text: str(c.when) }), h("dd", { text: str(c.what) })])),
          Array.isArray(st.rules) && st.rules.length ? h("ul", { class: "rules" }, st.rules.map((r) => h("li", { text: str(r) }))) : null)) : null);
  });
}

/* ---------- record page ---------- */
function tile(hl) {
  const t = h("div", { class: `tile${hl.uncertain ? " uncertain" : ""}` },
    h("span", { class: "tile-label", text: str(hl.label) }),
    h("div", { class: "tile-value" },
      h("span", { class: `num${hl.text === true ? " text" : ""}`, text: str(hl.value) }),
      hl.unit ? h("span", { class: "unit", text: str(hl.unit) }) : null));
  if (typeof hl.min === "number" && typeof hl.max === "number" && typeof hl.num === "number" && hl.max > hl.min) {
    const span = hl.max - hl.min;
    let lo = hl.min === 0 ? 0 : hl.min - span * 0.6;
    let hi = hl.max + span * 0.6;
    if (hl.num > hi) hi = hl.num + span * 0.15;
    if (hl.num < lo) lo = hl.num - span * 0.15;
    const pc = (v) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
    t.append(h("div", { class: "range", role: "img", "aria-label": `Значення ${hl.num} при нормі ${hl.min}–${hl.max}` },
      h("div", { class: "track" }),
      h("div", { class: "band", style: `left:${pc(hl.min)}%;width:${pc(hl.max) - pc(hl.min)}%` }),
      h("div", { class: "mark", style: `left:${pc(hl.num)}%` })));
  }
  if (hl.norm) t.append(h("span", { class: "norm", text: `норма ${str(hl.norm)}` }));
  if (hl.flag) t.append(h("span", { class: `pill ${str(hl.tone || "info")}`, text: str(hl.flag) }));
  if (hl.uncertain) t.append(h("span", { class: "pill warn", text: "перевір" }));
  if (hl.note) t.append(h("span", { class: "tnote", text: str(hl.note) }));
  return t;
}

const listItem = (it) => (it && typeof it === "object" && !Array.isArray(it)
  ? h("li", null, it.b ? h("b", { text: str(it.b) }) : null, it.b && it.t ? " — " : null, it.t ? str(it.t) : null)
  : h("li", { text: str(it) }));

export function section(sec) {
  let body;
  if (sec.type === "table") {
    const num = Array.isArray(sec.num) ? sec.num : [];
    body = h("div", { class: "tablebox" }, h("table", null,
      Array.isArray(sec.head) && sec.head.length ? h("thead", null, h("tr", null, sec.head.map((c) => h("th", { scope: "col", text: str(c) })))) : null,
      h("tbody", null, (sec.rows || []).map((r) => h("tr", null, (Array.isArray(r) ? r : []).map((c, ci) => h("td", { class: num.includes(ci) ? "n" : null, text: str(c) })))))));
  } else if (sec.type === "links") {
    body = h("ul", null, (sec.items || []).map((l) => {
      const url = str(l.url);
      return h("li", null, /^https:\/\//.test(url) ? h("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: str(l.label || url) }) : str(l.label));
    }));
  } else if (sec.type === "text") {
    body = h("p", { text: str(sec.text) });
  } else {
    body = h("ul", null, (sec.items || []).map(listItem));
  }
  return h("section", { class: "sec" }, sec.title ? h("h4", { text: str(sec.title) }) : null, body);
}

/** Плитка файлу: фото відкривається в переглядачі, PDF — у новій вкладці. */
export function fileThumb(item, i, all) {
  const caption = str(item.caption) || `Файл ${i + 1}`;
  if (item.kind === "pdf") {
    const label = h("span", { text: caption });
    const a = h("a", { class: "thumb", href: "#", target: "_blank", rel: "noopener", "aria-label": `Відкрити PDF: ${caption}` },
      h("div", { class: "ph pdf", text: "PDF" }), label);
    let ready = false;
    a.addEventListener("click", (e) => { if (!ready) { e.preventDefault(); label.textContent = "Завантажую…"; } });
    fileUrl(item.file).then((u) => { a.href = u; ready = true; label.textContent = caption; })
      .catch(() => { label.textContent = "Не вдалося завантажити"; });
    return a;
  }
  const img = h("img", { class: "ph", alt: caption, decoding: "async" });
  thumbUrl(item.file).then((u) => (u ? u : fileUrl(item.file))).then((u) => { img.src = u; }).catch(() => {});
  const images = all.filter((g) => g.kind !== "pdf");
  return h("button", { class: "thumb", type: "button", "aria-label": `Відкрити: ${caption}`, onclick: (e) => openLb(images, images.indexOf(item), e.currentTarget) },
    img, h("span", { text: caption }));
}

export function renderRecord(box, id) {
  if (!S.loaded) { put(box, backBtn(), h("div", { class: "state" }, h("strong", { text: "Завантажую запис…" }))); return; }
  const r = findRecord(id);
  if (!r) { put(box, backBtn(), h("div", { class: "state" }, h("strong", { text: "Запис не знайдено" }), h("span", { text: "Можливо, його видалили." }))); return; }
  const cat = catOf(r);
  const gal = photos(r);
  const hls = Array.isArray(r.highlights) ? r.highlights : [];
  const secs = Array.isArray(r.sections) ? r.sections : [];
  document.title = `${str(r.title)} · Медкартка`;

  const confirmBox = h("div", { class: "confirm", hidden: true },
    h("span", { text: "Видалити запис разом із файлами? Відновити не вийде." }),
    h("button", { class: "btn danger small", type: "button", onclick: async (e) => {
      e.currentTarget.disabled = true;
      try { await removeRecord(r); goHome(); }
      catch { e.currentTarget.disabled = false; confirmBox.querySelector("span").textContent = "Не вдалося видалити. Спробуй ще раз."; }
    }, text: "Видалити" }),
    h("button", { class: "btn ghost small", type: "button", onclick: () => { confirmBox.hidden = true; }, text: "Скасувати" }));

  put(box, 
    backBtn(),
    h("header", { class: "rec-head" },
      h("div", { class: "row-meta" },
        h("span", { class: `cat ${cat}`, text: CATS[cat] }),
        h("span", { class: "mono", text: dmy(r.date) + (r.time ? `, ${r.time}` : "") }),
        gal.length ? h("span", { class: "mono", text: `${gal.length} ${plural(gal.length, "файл", "файли", "файлів")}` }) : null,
        r.added_by === "ai" ? h("span", { text: "розпізнано AI" }) : null),
      h("h2", { text: str(r.title) || "Без назви" }),
      r.source ? h("span", { class: "src", text: str(r.source) }) : null),
    r.summary ? h("p", { class: "summary", text: str(r.summary) }) : null,
    hls.length ? h("div", { class: "block" }, h("h3", { text: "Головні показники" }), h("div", { class: "tiles" }, hls.map(tile))) : null,
    gal.length ? h("div", { class: "block" }, h("h3", { text: "Фото та документи" }), h("div", { class: "photos" }, gal.map((g, i) => fileThumb(g, i, gal)))) : null,
    secs.length ? h("div", { class: "sections" }, secs.map(section)) : null,
    h("div", { class: "actions" },
      h("a", { class: "btn ghost small", href: `#edit-${r._id}`, text: "Редагувати" }),
      h("button", { class: "btn ghost small", type: "button", text: "Видалити", onclick: () => { confirmBox.hidden = false; } })),
    confirmBox);
}

/* ---------- lightbox ---------- */
const LB = { items: [], i: 0, opener: null };
function showLb() {
  const it = LB.items[LB.i];
  if (!it) return;
  const img = $("lb-img");
  img.removeAttribute("src");
  img.alt = str(it.caption) || "Фото";
  // Спершу мініатюра (вона вже в пам'яті), потім повне фото.
  thumbUrl(it.file).then((u) => { if (u && LB.items[LB.i] === it && !img.dataset.full) img.src = u; }).catch(() => {});
  delete img.dataset.full;
  fileUrl(it.file).then((u) => { if (LB.items[LB.i] === it) { img.dataset.full = "1"; img.src = u; } }).catch(() => {});
  $("lb-cap").textContent = str(it.caption);
  $("lb-count").textContent = `${LB.i + 1} / ${LB.items.length}`;
  $("lb-prev").hidden = LB.items.length < 2;
  $("lb-next").hidden = LB.items.length < 2;
}
export function openLb(items, i, opener) {
  LB.items = items; LB.i = Math.max(0, i); LB.opener = opener || null;
  showLb();
  $("lb").hidden = false;
  document.body.style.overflow = "hidden";
  $("lb-close").focus();
}
export function closeLb() {
  if ($("lb").hidden) return;
  $("lb").hidden = true;
  $("lb-img").removeAttribute("src");
  document.body.style.overflow = "";
  if (LB.opener && document.body.contains(LB.opener)) LB.opener.focus();
}
function step(d) { if (LB.items.length < 2) return; LB.i = (LB.i + d + LB.items.length) % LB.items.length; showLb(); }
export function initLightbox() {
  $("lb-close").addEventListener("click", closeLb);
  $("lb-prev").addEventListener("click", () => step(-1));
  $("lb-next").addEventListener("click", () => step(1));
  $("lb").addEventListener("click", (e) => { if (e.target.id === "lb" || e.target.id === "lb-stage") closeLb(); });
  document.addEventListener("keydown", (e) => {
    if ($("lb").hidden) return;
    if (e.key === "Escape") closeLb();
    else if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "ArrowRight") step(1);
  });
  let tx = null;
  $("lb").addEventListener("touchstart", (e) => { tx = e.touches[0].clientX; }, { passive: true });
  $("lb").addEventListener("touchend", (e) => {
    if (tx == null) return;
    const dx = e.changedTouches[0].clientX - tx;
    tx = null;
    if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
  });
}
