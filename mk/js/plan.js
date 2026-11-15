// Редактор плану лікування (#plan): діагноз, етапи з датами, догляд, правила, справи.
// Можна заповнити з фото протоколу лікаря через Claude, а потім виправити вручну.
// Фото протоколу не зберігаються: щоб лишити сам протокол у картці, його додають окремим записом.
import { h, str, todayISO, prepareFile, blobToBase64, put } from "./util.js";
import { S, setStatus, removeStatus, getToken } from "./data.js";
import { buildPlanRequest, normalizePlan, analyzeDocuments, kyivToday } from "./claude.js";
import { AI_URL, MODEL, PROFILE } from "./config.js";

const MAX_FILES = 10;
const MAX_AI_BYTES = 20 * 1024 * 1024;

let P = null;
let BOX = null;

const blankStage = () => ({ title: "", how: "", dates: "", start: "", end: "" });
const blankCare = () => ({ when: "", what: "" });
const blankTodo = () => ({ id: "", text: "", note: "", due: "", done: false });

function fromStatus(st) {
  const n = normalizePlan(st || {}, { keepDone: true });
  delete n.warnings;
  return n;
}

export function renderPlan(box) {
  BOX = box;
  if (!P) {
    if (!S.statusLoaded) {
      put(box, backLink(), h("div", { class: "state" }, h("strong", { text: "Завантажую план…" })));
      return;
    }
    P = { form: fromStatus(S.status), exists: !!S.status, step: "form", files: [], note: "", warnings: [], error: "", chars: 0, confirmDelete: false };
  }
  document.title = "План лікування · Медкартка";
  draw();
}

/** Скидає чернетку, коли користувач іде зі сторінки плану. */
export function resetPlan() { P = null; }
/** Чи відкрита форма (тоді зміни даних її не перемальовують, щоб не стерти введене). */
export function isPlanOpen() { return !!P; }

function backLink() {
  return h("button", { class: "back", type: "button", onclick: leave }, h("span", { "aria-hidden": "true", text: "←" }), "Скасувати");
}
function leave() {
  P = null;
  location.hash = S.status ? "#now" : "";
}

function draw() {
  if (!BOX || !P) return;
  const head = h("header", { class: "rec-head" },
    h("h2", { text: P.exists ? "Редагування плану" : "Новий план лікування" }),
    h("span", { class: "src", text: "Сфотографуй протокол лікаря — Claude заповнить план, а ти перевіриш. Або заповни вручну." }));
  if (P.step === "work") {
    put(BOX, backLink(), head, h("div", { class: "panel", role: "status", "aria-live": "polite" },
      h("ul", { class: "steps" }, h("li", { class: "active", id: "plan-progress", text: progressText(P.chars) })),
      h("p", { class: "src", text: "Не закривай сторінку, поки не з'явиться форма." })));
    return;
  }
  put(BOX, backLink(), head, aiBox(), formView());
}

function progressText(chars) {
  return chars ? `Claude складає план: ${chars.toLocaleString("uk-UA")} символів` : "Claude читає протокол — зазвичай до хвилини";
}

/* ---------- заповнення з протоколу ---------- */
function aiBox() {
  const input = h("input", { type: "file", id: "plan-files", accept: "image/*,application/pdf", multiple: true });
  input.addEventListener("change", () => {
    const add = [...input.files].slice(0, MAX_FILES - P.files.length);
    P.files.push(...add);
    input.value = "";
    draw();
  });
  const note = h("textarea", { id: "plan-note", rows: 2, placeholder: "Напр.: Пімафукорт почала 11.11" });
  note.value = P.note;
  note.addEventListener("input", () => { P.note = note.value; });
  return h("div", { class: "panel" },
    h("h3", { text: "Заповнити з протоколу лікаря" }),
    h("label", { class: "drop", for: "plan-files" },
      h("strong", { text: P.files.length ? `Вибрано файлів: ${P.files.length}` : "Вибрати фото або PDF протоколу" }),
      h("span", { text: P.files.length ? P.files.map((f) => f.name).join(", ") : "Фото в картку не зберігаються — лише план." }), input),
    h("div", { class: "field" }, h("label", { for: "plan-note", text: "Підказка для Claude (необов'язково)" }), note),
    P.error ? h("p", { class: "err", text: P.error }) : null,
    h("div", { class: "actions" },
      h("button", { class: "btn", type: "button", id: "plan-ai", disabled: !P.files.length, text: P.exists ? "Оновити план з AI" : "Заповнити з AI", onclick: runAI }),
      P.files.length ? h("button", { class: "btn ghost small", type: "button", text: "Прибрати файли", onclick: () => { P.files = []; draw(); } }) : null));
}

async function runAI() {
  const p = P;
  p.step = "work";
  p.error = "";
  p.chars = 0;
  draw();
  try {
    const prepared = [];
    for (const f of p.files) prepared.push(await prepareFile(f));
    const total = prepared.reduce((a, x) => a + x.blob.size, 0);
    if (total > MAX_AI_BYTES) throw new Error("Разом файли більші за 20 МБ. Вибери менше сторінок.");
    const files = await Promise.all(prepared.map(async (x, i) => ({ type: x.type, data: await blobToBase64(x.blob), name: p.files[i].name })));
    const current = p.exists ? fromStatus(S.status) : null;
    const body = buildPlanRequest({ model: MODEL, files, note: p.note, current, today: kyivToday(), person: PROFILE });
    const res = await analyzeDocuments({
      url: AI_URL,
      token: await getToken(),
      body,
      onProgress: ({ chars }) => { p.chars = chars; const el = document.getElementById("plan-progress"); if (el && P === p) el.textContent = progressText(chars); },
    });
    const plan = normalizePlan(res.data);
    p.warnings = plan.warnings;
    delete plan.warnings;
    p.form = plan;
    p.files = [];
    p.fromAI = true;
  } catch (e) {
    p.error = e?.message || "Не вдалося розпізнати протокол. Спробуй ще раз.";
  }
  p.step = "form";
  if (P === p) draw();
}

/* ---------- форма ---------- */
function bind(el, obj, key) {
  if (el.type === "checkbox") {
    el.checked = !!obj[key];
    el.addEventListener("change", () => { obj[key] = el.checked; });
  } else {
    el.value = str(obj[key]);
    el.addEventListener("input", () => { obj[key] = el.value; });
  }
  return el;
}
const cell = (label, input, wide) => h("label", { class: `cell${wide ? " wide" : ""}` }, h("span", { text: label }), input);
const delBtn = (list, i, what) => h("button", { class: "x", type: "button", "aria-label": `Видалити ${what}`, text: "×", onclick: () => { list.splice(i, 1); draw(); } });
const addBtn = (text, list, make) => h("div", null, h("button", { class: "btn ghost small", type: "button", text, onclick: () => { list.push(make()); draw(); } }));

function formView() {
  const f = P.form;
  const diag = bind(h("input", { type: "text", id: "p-diag", placeholder: "Себорейний дерматит обличчя" }), f, "diagnosis");
  const short = bind(h("input", { type: "text", id: "p-short", placeholder: "Себорейний дерматит" }), f, "diagnosis_short");
  const meta = bind(h("input", { type: "text", id: "p-meta", placeholder: "Попередній діагноз · 11.11.2026 · дерматолог, клініка" }), f, "diagnosis_meta");
  const planNote = bind(h("textarea", { id: "p-plan-note", rows: 2 }), f, "plan_note");
  const msg = h("p", { class: "err", id: "p-msg", role: "status" });

  return [
    P.warnings.length ? h("div", { class: "warnbox" }, h("strong", { text: "Перевір перед збереженням" }), h("ul", null, P.warnings.map((w) => h("li", { text: w })))) : null,
    P.fromAI ? h("p", { class: "src", text: "Поля заповнив Claude. Звір назви препаратів, кратність і дати з протоколом." }) : null,
    h("div", { class: "panel" },
      h("div", { class: "field" }, h("label", { for: "p-diag", text: "Діагноз" }), diag),
      h("div", { class: "grid2" },
        h("div", { class: "field" }, h("label", { for: "p-short", text: "Коротко (для головної)" }), short),
        h("div", { class: "field" }, h("label", { for: "p-meta", text: "Хто й коли поставив" }), meta))),

    h("div", { class: "block" },
      h("h3", { text: "Етапи лікування" }),
      h("p", { class: "src", text: "Засоби, схема яких змінюється в часі. Поточний етап на головній визначається за датою початку." }),
      h("div", { class: "ed-list" }, f.plan.map((p, i) => h("div", { class: "ed-row ed-stage" },
        cell("Препарат", bind(h("input", { type: "text", id: `st-${i}-title`, placeholder: "Елідел 2 р/день" }), p, "title"), true),
        cell("Як застосовувати", bind(h("input", { type: "text", id: `st-${i}-how` }), p, "how"), true),
        cell("Дати текстом", bind(h("input", { type: "text", id: `st-${i}-dates`, placeholder: "15.11 → 24.11" }), p, "dates"), true),
        cell("Початок", bind(h("input", { type: "date", id: `st-${i}-start` }), p, "start")),
        cell("Кінець", bind(h("input", { type: "date", id: `st-${i}-end` }), p, "end")),
        delBtn(f.plan, i, `етап ${i + 1}`)))),
      addBtn("Додати етап", f.plan, blankStage),
      f.plan.length ? h("div", { class: "field" }, h("label", { for: "p-plan-note", text: "Примітка до дат" }), planNote) : null),

    h("div", { class: "block" },
      h("h3", { text: "Щоденний догляд" }),
      h("div", { class: "ed-list" }, f.care.map((c, i) => h("div", { class: "ed-row ed-care" },
        cell("Коли", bind(h("input", { type: "text", id: `care-${i}-when`, placeholder: "Ранок" }), c, "when")),
        cell("Що", bind(h("input", { type: "text", id: `care-${i}-what`, placeholder: "Зволожувальний крем" }), c, "what"), true),
        delBtn(f.care, i, `пункт догляду ${i + 1}`)))),
      addBtn("Додати пункт", f.care, blankCare)),

    h("div", { class: "block" },
      h("h3", { text: "Правила" }),
      h("div", { class: "ed-list" }, f.rules.map((_, i) => {
        const inp = h("input", { type: "text", id: `rule-${i}`, placeholder: "Наносити тонким шаром" });
        inp.value = str(f.rules[i]);
        inp.addEventListener("input", () => { f.rules[i] = inp.value; });
        return h("div", { class: "ed-row ed-rule" }, cell(`Правило ${i + 1}`, inp, true), delBtn(f.rules, i, `правило ${i + 1}`));
      })),
      addBtn("Додати правило", f.rules, () => "")),

    h("div", { class: "block" },
      h("h3", { text: "Справи" }),
      h("div", { class: "ed-list" }, f.todo.map((t, i) => h("div", { class: "ed-row ed-todo" },
        cell("Зроблено", bind(h("input", { type: "checkbox", id: `todo-${i}-done` }), t, "done")),
        cell("Справа", bind(h("input", { type: "text", id: `todo-${i}-text`, placeholder: "Здати аналізи" }), t, "text"), true),
        cell("Уточнення", bind(h("input", { type: "text", id: `todo-${i}-note` }), t, "note"), true),
        cell("До", bind(h("input", { type: "date", id: `todo-${i}-due` }), t, "due")),
        delBtn(f.todo, i, `справу ${i + 1}`)))),
      addBtn("Додати справу", f.todo, blankTodo)),

    msg,
    h("div", { class: "actions" },
      h("button", { class: "btn", type: "button", id: "p-save", text: "Зберегти план", onclick: (e) => save(e.currentTarget, msg) }),
      h("button", { class: "btn ghost", type: "button", text: "Скасувати", onclick: leave })),
    P.exists ? deleteBlock() : null,
  ];
}

function deleteBlock() {
  if (!P.confirmDelete) {
    return h("div", { class: "actions" }, h("button", { class: "linkbtn danger-link", type: "button", id: "p-delete", text: "Видалити план лікування", onclick: () => { P.confirmDelete = true; draw(); } }));
  }
  return h("div", { class: "confirm" },
    h("span", { text: "Видалити весь план? Записи в картці залишаться." }),
    h("button", { class: "btn danger small", type: "button", id: "p-delete-yes", text: "Видалити", onclick: async (e) => {
      e.currentTarget.disabled = true;
      try { await removeStatus(); P = null; location.replace("#"); } catch { e.currentTarget.disabled = false; }
    } }),
    h("button", { class: "btn ghost small", type: "button", text: "Скасувати", onclick: () => { P.confirmDelete = false; draw(); } }));
}

async function save(btn, msg) {
  const clean = normalizePlan(P.form, { keepDone: true });
  delete clean.warnings;
  // id справ: зберігаємо наявні, новим даємо унікальні.
  const used = new Set();
  clean.todo.forEach((t, i) => { let id = t.id || `t${i + 1}`; while (used.has(id)) id = `${id}x`; used.add(id); t.id = id; });
  if (!clean.diagnosis && !clean.diagnosis_short && !clean.plan.length && !clean.care.length && !clean.todo.length) {
    msg.textContent = "План порожній: додай діагноз, етап, догляд або справу.";
    return;
  }
  const bad = clean.plan.find((p) => p.start && p.end && p.end < p.start);
  if (bad) { msg.textContent = `У етапі «${bad.title}» кінець раніше за початок.`; return; }
  btn.disabled = true;
  btn.textContent = "Зберігаю…";
  try {
    await setStatus({ ...clean, updated: todayISO() });
    P = null;
    location.replace("#now");
  } catch {
    btn.disabled = false;
    btn.textContent = "Зберегти план";
    msg.textContent = "Не вдалося зберегти. Перевір інтернет і спробуй ще раз.";
  }
}
