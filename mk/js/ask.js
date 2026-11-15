// Плаваюча кнопка «Запитати AI» і чат, який бачить усю картку: план лікування й усі записи.
// Розмова живе лише в пам'яті сторінки: після перезавантаження чи виходу її немає.
import { h, put, plural, inertOutside, focusEl } from "./util.js";
import { S, findRecord, getToken } from "./data.js";
import { AI_URL, MODEL, PROFILE } from "./config.js";
import { kyivToday } from "./claude.js";
import { AUDIENCES, cardText, focusText, buildChatRequest, askClaude, parseMd, dmy } from "./askcore.js";

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M11 3.5l1.8 4.7 4.7 1.8-4.7 1.8L11 16.5l-1.8-4.7L4.5 10l4.7-1.8z"/><path d="M18 14.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/></svg>';
const SEND = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5.5 11.5L12 5l6.5 6.5"/></svg>';
const STOP = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg>';
const SHOW_ON = ["home", "record", "now"];

const A = { open: false, visible: false, pageId: null, focusId: null, msgs: [], busy: false, ctrl: null, audience: "doctor" };
try { const a = localStorage.getItem("medcard-ask-audience"); if (AUDIENCES[a]) A.audience = a; } catch { /* ignore */ }

let fab;
let root;
let log;
let input;
let sendBtn;
let focusBar;
let sub;
let seg;
let liveEl = null;
let title;
let status;
let raf = 0;

const finePointer = () => window.matchMedia?.("(pointer: fine)").matches;

/* ---------- кнопка й видимість ---------- */
export function initAsk() {
  fab = h("button", { class: "ask-fab", type: "button", id: "ask-fab", hidden: true, "aria-haspopup": "dialog", onclick: open });
  fab.innerHTML = `${ICON}<span>Запитати AI</span>`;
  document.body.append(fab);
  buildSheet();
  window.addEventListener("popstate", () => { if (A.open && !history.state?.mkAsk) close(true); });
  document.addEventListener("keydown", (e) => { if (A.open && e.key === "Escape") close(); });
}

/** Викликається при кожному показі сторінки: кнопка є на головній, у записі й у «Зараз». */
export function setAskRoute(rt) {
  A.pageId = rt?.name === "record" ? rt.id : null;
  A.visible = SHOW_ON.includes(rt?.name);
  fab.hidden = !A.visible || A.open;
  document.body.classList.toggle("has-fab", A.visible);
  if (!A.visible && A.open) close(true);
}

/** Ховає кнопку (екран входу, немає доступу). clear — стерти розмову, коли користувач вийшов. */
export function hideAsk({ clear = false } = {}) {
  A.visible = false;
  if (fab) fab.hidden = true;
  document.body.classList.remove("has-fab");
  if (A.open) close(true);
  if (clear) { A.ctrl?.abort(); A.msgs = []; }
}

/** Дані картки змінились: оновити підзаголовок і плашку запису, не чіпаючи розмову. */
export function refreshAsk() {
  if (!A.open) return;
  refreshSub();
  drawFocus();
}

function refreshSub() {
  const n = S.records.length;
  sub.textContent = `Бачить усю картку ${PROFILE.gen}: ${n} ${plural(n, "запис", "записи", "записів")}${S.status ? " і план лікування" : ""}`;
}

/* ---------- відкриття й закриття ---------- */
function open() {
  A.open = true;
  A.focusId = A.pageId && findRecord(A.pageId) ? A.pageId : null;
  if (!history.state?.mkAsk) history.pushState({ ...(history.state || {}), mkAsk: true }, "");
  root.hidden = false;
  inertOutside(root, true);
  fab.hidden = true;
  document.body.classList.add("ask-open");
  draw();
  scrollEnd(true);
  // На телефоні не викликаємо клавіатуру одразу, але фокус переходить у вікно (для VoiceOver).
  if (finePointer()) input.focus();
  else focusEl(title);
}

function close(fromHistory = false) {
  if (!fromHistory && history.state?.mkAsk) { history.back(); return; }
  A.open = false;
  root.hidden = true;
  inertOutside(null, false);
  document.body.classList.remove("ask-open");
  fab.hidden = !A.visible;
  if (A.visible) fab.focus({ preventScroll: true });
}

/* ---------- розмітка ---------- */
function buildSheet() {
  const x = h("button", { class: "ask-x", type: "button", "aria-label": "Закрити", text: "×", onclick: () => close() });
  sub = h("p", { class: "ask-sub", id: "ask-sub" });
  seg = h("div", { class: "seg", role: "group", "aria-label": "Як відповідати" },
    Object.entries(AUDIENCES).map(([k, label]) => h("button", { type: "button", "data-aud": k, text: label, onclick: () => setAudience(k) })));
  const reset = h("button", { class: "linkbtn", type: "button", id: "ask-reset", text: "Нова розмова", onclick: resetChat });
  // Журнал без aria-live: під час стріму відповідь перемальовується, тож оголошуємо лише готову відповідь через status.
  log = h("div", { class: "ask-log", id: "ask-log" });
  status = h("div", { class: "sr-only", id: "ask-status", role: "status" });
  focusBar = h("div", { class: "ask-focus", id: "ask-focus", hidden: true });
  input = h("textarea", { id: "ask-input", rows: 1, placeholder: "Питання до картки…", "aria-label": "Питання до картки", maxlength: 4000 });
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && finePointer()) { e.preventDefault(); submit(); }
  });
  sendBtn = h("button", { class: "ask-send", type: "submit", id: "ask-send" });
  const form = h("form", { class: "ask-form", onsubmit: (e) => { e.preventDefault(); submit(); } }, input, sendBtn);
  const panel = h("div", { class: "ask-panel" },
    h("header", { class: "ask-head" }, h("div", null, title = h("h2", { id: "ask-title", text: "Запитати AI" }), sub), x),
    h("div", { class: "ask-bar" }, seg, reset),
    log,
    focusBar,
    form,
    h("p", { class: "ask-note", text: "AI може помилятися. Рішення щодо лікування приймає лікар." }),
    status);
  root = h("div", { class: "ask", id: "ask", role: "dialog", "aria-modal": "true", "aria-labelledby": "ask-title", hidden: true }, panel);
  root.addEventListener("click", (e) => { if (e.target === root) close(); });
  document.body.append(root);
}

function draw() {
  refreshSub();
  seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.aud === A.audience)));
  drawFocus();
  drawLog();
  drawSend();
}

function drawFocus() {
  const r = A.focusId ? findRecord(A.focusId) : null;
  focusBar.hidden = !r;
  if (!r) { focusBar.replaceChildren(); return; }
  const when = dmy(r.date);
  put(focusBar,
    h("span", { text: `Про запис «${r.title || "Запис"}»${when ? `, ${when}` : ""}` }),
    h("button", { type: "button", class: "ask-focus-x", "aria-label": "Питати про всю картку", text: "×", onclick: () => { A.focusId = null; drawFocus(); drawLog(); } }));
}

function drawSend() {
  sendBtn.innerHTML = A.busy ? STOP : SEND;
  sendBtn.setAttribute("aria-label", A.busy ? "Зупинити відповідь" : "Надіслати");
  sendBtn.classList.toggle("stop", A.busy);
}

function suggestions() {
  if (A.focusId) return ["Поясни цей запис коротко", "Що тут поза нормою і чому це може бути?", "Що змінилося порівняно з попередніми записами?"];
  return ["Коротко: стан і поточне лікування", "Що змінилося в останніх аналізах?", "Які призначення зараз і до коли?"];
}

function drawLog() {
  liveEl = null;
  if (!A.msgs.length) {
    put(log, h("div", { class: "ask-empty" },
      h("p", { text: A.audience === "doctor"
        ? "Запитайте про аналізи, призначення чи динаміку. AI відповідає з посиланням на записи картки."
        : "Запитайте що завгодно про записи й лікування. AI пояснить простою мовою." }),
      h("div", { class: "ask-sugg" }, suggestions().map((q) => h("button", { type: "button", text: q, onclick: () => send(q) })))));
    return;
  }
  put(log, A.msgs.map((m, i) => msgNode(m, i === A.msgs.length - 1)));
}

/** Текст відповіді без розмітки — для оголошення читалкою. */
const plainText = (text) => parseMd(text).map((b) => (b.t === "p" || b.t === "h" ? b.parts.map((p) => p.s).join("") : b.items.map((it) => it.map((p) => p.s).join("")).join(". "))).join(" ");

function mdNodes(text) {
  const inl = (parts) => parts.map((p) => (p.b ? h("strong", { text: p.s }) : document.createTextNode(p.s)));
  return parseMd(text).map((b) => {
    if (b.t === "p") return h("p", null, inl(b.parts));
    if (b.t === "h") return h("p", { class: "md-h" }, h("strong", null, inl(b.parts)));
    return h(b.t, b.t === "ol" && b.start > 1 ? { start: b.start } : null, b.items.map((it) => h("li", null, inl(it))));
  });
}

function msgNode(m, last) {
  if (m.role === "user") {
    return h("div", { class: "msg me" }, m.about ? h("span", { class: "msg-about", text: m.about }) : null, h("span", { text: m.text }));
  }
  const body = h("div", { class: "msg-body" });
  if (m.text) body.append(...mdNodes(m.text));
  else if (m.status === "streaming") body.append(h("p", { class: "typing", text: "Claude читає картку…" }));
  const box = h("div", { class: `msg ai${m.status === "streaming" ? " live" : ""}` }, body);
  if (m.status === "streaming") liveEl = body;
  if (m.truncated) box.append(h("p", { class: "msg-note", text: "Відповідь обрізано через довжину. Попроси продовжити." }));
  if (m.stopped) box.append(h("p", { class: "msg-note", text: "Зупинено." }));
  if (m.status === "error") {
    box.append(h("p", { class: "err", role: "alert", text: m.error }));
    if (last) box.append(h("button", { class: "btn ghost small", type: "button", text: "Спробувати ще раз", onclick: retry }));
  }
  return box;
}

function renderLive() {
  raf = 0;
  const m = A.msgs.at(-1);
  if (!liveEl || !m || m.status !== "streaming") return;
  const stick = nearEnd();
  if (m.text) liveEl.replaceChildren(...mdNodes(m.text));
  if (stick) scrollEnd(true);
}

const nearEnd = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;
function scrollEnd(force) { if (force || nearEnd()) log.scrollTop = log.scrollHeight; }

function autosize() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
}

/* ---------- дії ---------- */
function setAudience(k) {
  A.audience = k;
  try { localStorage.setItem("medcard-ask-audience", k); } catch { /* ignore */ }
  draw();
}

function resetChat() {
  A.ctrl?.abort();
  A.msgs = [];
  status.textContent = "Розмову очищено.";
  draw();
  if (finePointer()) input.focus();
}

function submit() {
  if (A.busy) { A.ctrl?.abort(); return; }
  const q = input.value.trim();
  if (!q) { input.focus(); return; }
  input.value = "";
  autosize();
  send(q);
}

function retry() {
  const a = A.msgs.at(-1);
  const u = A.msgs.at(-2);
  if (!a || a.role !== "assistant" || u?.role !== "user") return;
  A.msgs.splice(-2, 2);
  send(u.text, u.focusId);
}

/** Пари «питання — відповідь», на які Claude відповів повністю: це історія для наступного запиту. */
function pastTurns() {
  const out = [];
  for (let i = 0; i + 1 < A.msgs.length; i += 1) {
    const u = A.msgs[i];
    const a = A.msgs[i + 1];
    if (u.role === "user" && a.role === "assistant" && a.status === "done" && a.text) {
      out.push({ role: "user", text: u.text }, { role: "assistant", text: a.text });
      i += 1;
    }
  }
  return out;
}

async function send(q, focusId = A.focusId) {
  if (A.busy) return;
  const rec = focusId ? findRecord(focusId) : null;
  const prior = pastTurns();
  const user = { role: "user", text: q, focusId: rec ? focusId : null, about: rec ? `про «${rec.title || "запис"}»` : "" };
  const m = { role: "assistant", text: "", status: "streaming" };
  A.msgs.push(user, m);
  const ctrl = new AbortController();
  A.ctrl = ctrl;
  A.busy = true;
  log.setAttribute("aria-busy", "true");
  status.textContent = "Claude відповідає…";
  drawLog();
  drawSend();
  scrollEnd(true);
  try {
    const today = kyivToday();
    const body = buildChatRequest({
      model: MODEL,
      person: PROFILE,
      audience: A.audience,
      card: cardText({ records: S.records, status: S.status, person: PROFILE, today }),
      history: prior,
      question: q,
      focus: focusText(rec),
    });
    const res = await askClaude({
      url: AI_URL,
      token: await getToken(),
      body,
      signal: ctrl.signal,
      onText: (text) => { m.text = text; if (!raf) raf = requestAnimationFrame(renderLive); },
    });
    m.text = res.text;
    m.truncated = res.truncated;
    m.status = "done";
    if (A.msgs.includes(m)) status.textContent = `Відповідь: ${plainText(res.text)}`;
  } catch (e) {
    if (e?.partial) m.text = e.partial;
    if (e?.code === "aborted" && m.text) { m.status = "done"; m.stopped = true; }
    else { m.status = "error"; m.error = e?.message || "Не вдалося отримати відповідь. Спробуй ще раз."; }
  } finally {
    if (A.ctrl === ctrl) { A.ctrl = null; A.busy = false; log.removeAttribute("aria-busy"); }
    if (m.stopped) status.textContent = "Зупинено.";
    if (A.msgs.includes(m)) { drawLog(); scrollEnd(); }
    drawSend();
  }
}
