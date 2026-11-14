// Новий запис через AI (фото/PDF → Claude → перевірка → збереження) і редагування запису.
// Файли зберігаються лише після «Зберегти запис»; до того вони живуть у браузері.
import { h, str, todayISO, parseNum, parseRange, shortId, prepareFile, blobToBase64, put } from "./util.js";
import { S, CATS, saveFile, deleteFile, saveRecord, findRecord, thumbUrl, getToken } from "./data.js";
import { backBtn, section, goHome } from "./render.js";
import { buildRequest, compactContext, normalizeDraft, analyzeDocuments, kyivToday } from "./claude.js";
import { AI_URL, MODEL } from "./config.js";

const TONES = { ok: "у нормі", warn: "увага", alert: "суттєво", info: "без норми" };
const MAX_FILES = 10;
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_AI_BYTES = 20 * 1024 * 1024;

let D = null;
let BOX = null;

function newDraft() {
  return { mode: "new", draftId: shortId(), files: [], note: "", step: "pick", progress: null, error: "", model: null, ...emptyForm() };
}
function emptyForm() {
  return {
    rec: { date: todayISO(), time: "", category: "labs", title: "", brief: "", summary: "", source: "" },
    highlights: [],
    sections: [],
    warnings: [],
  };
}
function editDraft(r) {
  return {
    mode: "edit",
    id: r._id,
    added_by: r.added_by || "user",
    model: r.model || null,
    step: "review",
    files: (r.gallery || []).filter((g) => g && g.file).map((g, i) => ({ fileId: g.file, caption: str(g.caption), kind: g.kind || "image", name: str(g.caption) || `Файл ${i + 1}` })),
    rec: { date: str(r.date), time: str(r.time), category: CATS[r.category] ? r.category : "note", title: str(r.title), brief: str(r.brief), summary: str(r.summary), source: str(r.source) },
    highlights: (r.highlights || []).map(fromStoredHl),
    sections: (r.sections || []).slice(),
    warnings: [],
  };
}
function fromStoredHl(hl) {
  return {
    label: str(hl.label), value: str(hl.value), unit: str(hl.unit), norm: str(hl.norm), flag: str(hl.flag),
    tone: TONES[hl.tone] ? hl.tone : "info", note: str(hl.note), uncertain: !!hl.uncertain,
    _orig: { value: str(hl.value), norm: str(hl.norm), num: hl.num, min: hl.min, max: hl.max, text: hl.text },
  };
}

export function renderNew(box) {
  BOX = box;
  if (!D || D.mode !== "new") D = newDraft();
  document.title = "Новий запис · Медкартка";
  draw();
}
export function renderEdit(box, id) {
  BOX = box;
  if (!D || D.mode !== "edit" || D.id !== id) {
    const r = findRecord(id);
    if (!r) {
      put(box, backBtn(), h("div", { class: "state" }, h("strong", { text: S.loaded ? "Запис не знайдено" : "Завантажую запис…" })));
      return;
    }
    D = editDraft(r);
  }
  document.title = "Редагування · Медкартка";
  draw();
}

function draw() {
  if (!BOX || !D) return;
  const title = D.mode === "edit" ? "Редагування запису" : "Новий запис";
  const head = h("header", { class: "rec-head" }, h("h2", { text: title }),
    D.mode === "new" && D.step === "pick" ? h("span", { class: "src", text: "Сфотографуй бланк, протокол або завантаж PDF. Claude розпізнає показники, а ти перевіриш перед збереженням." }) : null);
  const views = { pick: drawPick, work: drawWork, error: drawError, review: drawReview };
  const back = h("button", { class: "back", type: "button", onclick: cancel }, h("span", { "aria-hidden": "true", text: "←" }), "Скасувати");
  put(BOX, back, head, ...[].concat(views[D.step]()));
}

async function cancel() {
  const d = D;
  D = null;
  // Файли нового запису, які встигли зберегтися до збою, прибираємо.
  if (d && d.mode === "new") d.files.forEach((f) => { if (f.fileId) deleteFile(f.fileId).catch(() => {}); if (f.preview) URL.revokeObjectURL(f.preview); });
  goHome();
}

/* ---------- крок 1: файли ---------- */
function addFiles(list) {
  const msg = [];
  for (const file of list) {
    if (D.files.length >= MAX_FILES) { msg.push(`Не більше ${MAX_FILES} файлів.`); break; }
    if (file.size > MAX_BYTES) { msg.push(`«${file.name}» більший за 25 МБ.`); continue; }
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    D.files.push({ file, name: file.name, kind: isPdf ? "pdf" : "image", preview: isPdf ? "" : URL.createObjectURL(file), caption: "", prepared: null, fileId: null });
  }
  D.error = msg.join(" ");
  draw();
}

function drawPick() {
  const input = h("input", { type: "file", id: "pick-files", accept: "image/*,application/pdf", multiple: true });
  input.addEventListener("change", () => { addFiles([...input.files]); input.value = ""; });
  const drop = h("label", { class: "drop", for: "pick-files" },
    h("strong", { text: D.files.length ? "Додати ще файли" : "Вибрати фото або PDF" }),
    h("span", { text: "Можна кілька сторінок одного документа. До 10 файлів." }), input);
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); addFiles([...e.dataTransfer.files]); });

  const files = D.files.length ? h("div", { class: "files" }, D.files.map((f, i) => h("div", { class: "fchip" },
    f.kind === "pdf" ? h("div", { class: "ph pdfph", text: "PDF" })
      : h("img", { class: "ph", src: f.preview, alt: f.name }),
    h("span", { class: "name", text: f.name }),
    h("button", { class: "x", type: "button", "aria-label": `Прибрати ${f.name}`, text: "×", onclick: () => { if (f.preview) URL.revokeObjectURL(f.preview); D.files.splice(i, 1); draw(); } })))) : null;

  const note = h("textarea", { id: "pick-note", placeholder: "Напр.: аналізи з Ескулабу, здавав натщесерце", rows: 2 });
  note.value = D.note;
  note.addEventListener("input", () => { D.note = note.value; });

  return [
    drop,
    files,
    D.error ? h("p", { class: "err", text: D.error }) : null,
    h("div", { class: "field" }, h("label", { for: "pick-note", text: "Підказка для Claude (необов'язково)" }), note),
    h("div", { class: "actions" },
      h("button", { class: "btn", type: "button", disabled: !D.files.length, text: "Розпізнати з AI", onclick: () => run(true) }),
      h("button", { class: "btn ghost", type: "button", text: "Заповнити вручну", onclick: () => run(false) })),
  ];
}

/* ---------- крок 2: підготовка й розпізнавання ---------- */
async function prepareAll(d) {
  for (let i = 0; i < d.files.length; i++) {
    const f = d.files[i];
    if (f.prepared || f.fileId) continue;
    d.progress = { stage: "prep", i, n: d.files.length };
    if (D === d) draw();
    f.prepared = await prepareFile(f.file);
    f.kind = f.prepared.kind;
  }
}

async function run(withAI) {
  const d = D;
  d.step = "work";
  d.withAI = withAI;
  d.error = "";
  d.progress = null;
  draw();
  try {
    await prepareAll(d);
    if (withAI) {
      const total = d.files.reduce((a, f) => a + (f.prepared?.blob.size || 0), 0);
      if (total > MAX_AI_BYTES) throw new Error("Разом файли більші за 20 МБ — це забагато для одного запиту до Claude. Вибери менше файлів або заповни запис вручну.");
      d.progress = { stage: "ai", chars: 0 };
      if (D === d) draw();
      const files = await Promise.all(d.files.map(async (f) => ({ type: f.prepared.type, data: await blobToBase64(f.prepared.blob), name: f.name })));
      const body = buildRequest({
        model: MODEL,
        files,
        note: d.note,
        context: compactContext({ status: S.status, records: S.records.slice(0, 8) }),
        today: kyivToday(),
      });
      const res = await analyzeDocuments({
        url: AI_URL,
        token: await getToken(),
        body,
        onProgress: ({ chars }) => { d.progress = { stage: "ai", chars }; if (D === d) setAiProgress(chars); },
      });
      applyAI(d, { draft: normalizeDraft(res.data, { fileCount: files.length }), model: res.model });
    }
    d.step = "review";
  } catch (e) {
    d.step = "error";
    d.error = e?.message || "Щось пішло не так. Спробуй ще раз.";
  }
  if (D === d) draw();
}

function aiProgressText(chars) {
  return chars ? `Claude заповнює запис: ${chars.toLocaleString("uk-UA")} символів` : "Claude читає документи — зазвичай до хвилини";
}
function setAiProgress(chars) {
  const el = document.getElementById("ai-progress");
  if (el) el.textContent = aiProgressText(chars);
}

function applyAI(D, res) {
  const d = res?.draft || {};
  D.model = res?.model || MODEL;
  D.rec = {
    date: d.date || todayISO(),
    time: d.time || "",
    category: CATS[d.category] ? d.category : "note",
    title: str(d.title),
    brief: str(d.brief),
    summary: str(d.summary),
    source: str(d.source),
  };
  D.highlights = (d.highlights || []).map(fromStoredHl);
  D.sections = d.sections || [];
  D.warnings = [...(d.warnings || [])];
  if (!d.date) D.warnings.unshift("У документі не знайшлося дати — поставлено сьогоднішню. Перевір.");
  (d.captions || []).forEach((c, i) => { if (D.files[i] && !D.files[i].caption) D.files[i].caption = c; });
}

function drawWork() {
  const p = D.progress || {};
  const steps = [{ text: p.stage === "prep" ? `Готую файли: ${p.i + 1} з ${p.n}` : "Готую файли" }];
  if (D.withAI) steps.push({ text: aiProgressText(p.chars || 0), id: "ai-progress" });
  const idx = p.stage === "ai" ? 1 : 0;
  return h("div", { class: "panel", role: "status", "aria-live": "polite" },
    h("ul", { class: "steps" }, steps.map((s, i) => h("li", { class: i < idx ? "done" : i === idx ? "active" : null, id: s.id, text: s.text }))),
    h("p", { class: "src", text: "Не закривай сторінку, поки не з'явиться форма перевірки." }));
}

function drawError() {
  return [
    h("div", { class: "panel" },
      h("p", { class: "err", text: D.error }),
      h("div", { class: "actions" },
        h("button", { class: "btn", type: "button", text: "Спробувати ще раз", onclick: () => run(true) }),
        h("button", { class: "btn ghost", type: "button", text: "Заповнити вручну", onclick: () => run(false) }))),
  ];
}

/* ---------- крок 3: перевірка й збереження ---------- */
function bind(el, obj, key, after) {
  el.value = str(obj[key]);
  el.addEventListener("input", () => { obj[key] = el.value; if (after) after(); });
  return el;
}

function counted(textarea, limit) {
  const c = h("span", { class: "counter" });
  const upd = () => { c.textContent = `${textarea.value.length} / ${limit}`; c.classList.toggle("over", textarea.value.length > limit); };
  textarea.addEventListener("input", upd);
  upd();
  return c;
}

function hlRow(hl, i) {
  const mk = (key, ph, w) => {
    const inp = h("input", { type: "text", placeholder: ph, "aria-label": ph, id: `hl-${i}-${key}`, class: w });
    return bind(inp, hl, key, () => { if (key === "value" || key === "norm") hl.uncertain = false; row.classList.toggle("uncertain", hl.uncertain); });
  };
  const tone = h("select", { "aria-label": "Стан", id: `hl-${i}-tone` }, Object.entries(TONES).map(([k, v]) => h("option", { value: k, text: v })));
  bind(tone, hl, "tone");
  const row = h("div", { class: `hl-row${hl.uncertain ? " uncertain" : ""}` },
    mk("label", "Показник"), mk("value", "Значення"), mk("unit", "Од."), mk("norm", "Норма"), mk("flag", "Позначка"), tone,
    h("button", { class: "x", type: "button", "aria-label": `Видалити ${hl.label || "показник"}`, text: "×", onclick: () => { D.highlights.splice(i, 1); draw(); } }));
  return row;
}

function fileRowThumb(f) {
  if (f.kind === "pdf") return h("div", { class: "pdf", text: "PDF" });
  const img = h("img", { class: "ph", alt: "" });
  if (f.preview) img.src = f.preview;
  else if (f.fileId) thumbUrl(f.fileId).then((u) => { if (u) img.src = u; }).catch(() => {});
  return img;
}

function drawReview() {
  const r = D.rec;
  const date = bind(h("input", { type: "date", id: "f-date", required: true }), r, "date");
  const time = bind(h("input", { type: "time", id: "f-time" }), r, "time");
  const cat = bind(h("select", { id: "f-cat" }, Object.entries(CATS).map(([k, v]) => h("option", { value: k, text: v }))), r, "category");
  const title = bind(h("input", { type: "text", id: "f-title", placeholder: "Аналіз ЗАК", required: true }), r, "title");
  const brief = bind(h("textarea", { id: "f-brief", rows: 2 }), r, "brief");
  const summary = bind(h("textarea", { id: "f-summary", rows: 4 }), r, "summary");
  const source = bind(h("input", { type: "text", id: "f-source", placeholder: "Лабораторія, клініка, лікар" }), r, "source");
  const msg = h("p", { class: "err", id: "f-msg", role: "status" });

  return [
    D.warnings.length ? h("div", { class: "warnbox" }, h("strong", { text: "Перевір перед збереженням" }), h("ul", null, D.warnings.map((w) => h("li", { text: w })))) : null,
    D.mode === "new" && D.model ? h("p", { class: "src", text: "Поля заповнив Claude. Порівняй цифри з фото: поля з жовтим фоном він прочитав невпевнено." }) : null,
    h("div", { class: "panel" },
      h("div", { class: "grid3" },
        h("div", { class: "field" }, h("label", { for: "f-date", text: "Дата" }), date),
        h("div", { class: "field" }, h("label", { for: "f-time", text: "Час" }), time),
        h("div", { class: "field" }, h("label", { for: "f-cat", text: "Тип" }), cat)),
      h("div", { class: "field" }, h("label", { for: "f-title", text: "Заголовок" }), title),
      h("div", { class: "field" }, h("label", { for: "f-brief", text: "Короткий підсумок для списку" }), brief, counted(brief, 110)),
      h("div", { class: "field" }, h("label", { for: "f-summary", text: "Підсумок" }), summary),
      h("div", { class: "field" }, h("label", { for: "f-source", text: "Джерело" }), source)),
    h("div", { class: "block" },
      h("h3", { text: "Головні показники" }),
      D.highlights.length ? h("div", { class: "hl-row hl-head", "aria-hidden": "true" }, ["Показник", "Значення", "Од.", "Норма", "Позначка", "Стан", ""].map((t) => h("span", { text: t }))) : null,
      h("div", { class: "hl-list" }, D.highlights.map(hlRow)),
      h("div", null, h("button", { class: "btn ghost small", type: "button", text: "Додати показник", onclick: () => { D.highlights.push(fromStoredHl({ tone: "info" })); draw(); } }))),
    D.sections.length ? h("div", { class: "block" },
      h("h3", { text: "Розділи сторінки" }),
      h("div", { class: "sections" }, D.sections.map((s, i) => {
        const el = section(s);
        el.classList.add("sec-edit");
        el.append(h("button", { class: "sec-x", type: "button", "aria-label": `Прибрати розділ ${s.title || ""}`, text: "×", onclick: () => { D.sections.splice(i, 1); draw(); } }));
        return el;
      }))) : null,
    D.files.length ? h("div", { class: "block" },
      h("h3", { text: "Підписи до файлів" }),
      h("div", { class: "cap-list" }, D.files.map((f, i) => h("div", { class: "cap-row" }, fileRowThumb(f),
        bind(h("input", { type: "text", id: `cap-${i}`, placeholder: f.name, "aria-label": `Підпис до ${f.name}` }), f, "caption"))))) : null,
    msg,
    h("div", { class: "actions" },
      h("button", { class: "btn", type: "button", id: "f-save", text: "Зберегти запис", onclick: (e) => save(e.currentTarget, msg) }),
      h("button", { class: "btn ghost", type: "button", text: "Скасувати", onclick: cancel })),
  ];
}

export function finalizeHl(hl) {
  const out = { label: str(hl.label).trim(), value: str(hl.value).trim(), tone: TONES[hl.tone] ? hl.tone : "info" };
  for (const k of ["unit", "norm", "flag", "note"]) { const v = str(hl[k]).trim(); if (v) out[k] = v; }
  const o = hl._orig || {};
  let num = parseNum(out.value);
  if (num === null && out.value === o.value && typeof o.num === "number") num = o.num;
  if (num !== null) out.num = num;
  let range = parseRange(out.norm);
  if (!range && str(out.norm) === str(o.norm) && typeof o.min === "number" && typeof o.max === "number") range = [o.min, o.max];
  if (num !== null && range) { out.min = range[0]; out.max = range[1]; }
  if (num === null && !/\d/.test(out.value)) out.text = true;
  if (hl.uncertain) out.uncertain = true;
  return out;
}

async function save(btn, msg) {
  const d = D;
  const r = d.rec;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) { msg.textContent = "Вкажи дату."; return; }
  if (!r.title.trim()) { msg.textContent = "Вкажи заголовок."; return; }
  btn.disabled = true;
  msg.textContent = "";
  try {
    const todo = d.files.filter((f) => !f.fileId);
    for (let i = 0; i < todo.length; i++) {
      btn.textContent = `Зберігаю файли: ${i + 1} з ${todo.length}`;
      const f = todo[i];
      if (!f.prepared) f.prepared = await prepareFile(f.file);
      f.fileId = await saveFile(f.prepared, { name: f.name });
    }
    btn.textContent = "Зберігаю запис…";
    const data = {
      date: r.date,
      time: r.time || "",
      sort: `${r.date}T${r.time || "12:00"}`,
      category: r.category,
      title: r.title.trim(),
      brief: r.brief.trim(),
      summary: r.summary.trim(),
      source: r.source.trim(),
      highlights: d.highlights.filter((x) => str(x.label).trim() && str(x.value).trim()).map(finalizeHl),
      sections: d.sections,
      gallery: d.files.filter((f) => f.fileId).map((f) => ({ file: f.fileId, caption: str(f.caption).trim() || f.name, kind: f.kind })),
      added_by: d.mode === "edit" ? d.added_by : d.model ? "ai" : "user",
      model: d.model || null,
    };
    const id = d.mode === "edit" ? d.id : `${r.date}-${d.draftId}`;
    await saveRecord(id, data, { isNew: d.mode === "new" });
    d.files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
    if (D === d) D = null;
    S.fromList = false;
    location.replace(`#r-${id}`);
  } catch {
    btn.disabled = false;
    btn.textContent = "Зберегти запис";
    msg.textContent = "Не вдалося зберегти. Перевір інтернет і спробуй ще раз.";
  }
}
