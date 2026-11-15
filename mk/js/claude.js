// Розпізнавання документів через Claude: схема відповіді, промпт, запит через воркер і розбір стріму.
// Модуль не залежить від DOM і Firebase, тому його можна тестувати в Node.

/* ---------- схема відповіді (structured outputs) ---------- */
// Обмеження API: усі об'єкти з additionalProperties: false, усі поля required, без minimum/maxLength.
export const CATEGORIES = ["labs", "doctor", "skin", "body", "note"];
export const TONES = ["ok", "warn", "alert", "info"];
export const SECTION_TYPES = ["list", "table", "text"];

const sch = (description) => ({ type: "string", description });
const nullableNumber = (description) => ({ anyOf: [{ type: "number" }, { type: "null" }], description });

const HIGHLIGHT = {
  type: "object",
  additionalProperties: false,
  required: ["label", "value", "unit", "norm", "num", "min", "max", "flag", "tone", "note", "uncertain"],
  properties: {
    label: sch("Назва показника так, як на бланку (наприклад «Гемоглобін», «Феритин»)."),
    value: sch("Значення як текст, точно як на бланку (наприклад «142», «28.5»)."),
    unit: sch("Одиниця виміру з бланку або порожній рядок."),
    norm: sch("Референтний інтервал як текст з бланку (наприклад «130–170») або порожній рядок."),
    num: nullableNumber("Значення числом, якщо воно однозначне; інакше null."),
    min: nullableNumber("Нижня межа норми числом або null."),
    max: nullableNumber("Верхня межа норми числом або null."),
    flag: sch("Коротка позначка 1–3 слова: «норма», «вище норми», «нижче норми» тощо."),
    tone: { type: "string", enum: TONES, description: "ok — у нормі; warn — трохи поза нормою; alert — суттєво поза нормою; info — норми немає." },
    note: sch("Коротке пояснення або порожній рядок."),
    uncertain: { type: "boolean", description: "true, якщо значення погано читається або є сумнів." },
  },
};

const SECTION = {
  type: "object",
  additionalProperties: false,
  required: ["type", "title", "items", "head", "rows", "text"],
  properties: {
    type: { type: "string", enum: SECTION_TYPES },
    title: sch("Заголовок розділу."),
    items: { type: "array", items: { type: "string" }, description: "Пункти для type=list, інакше []." },
    head: { type: "array", items: { type: "string" }, description: "Заголовки колонок для type=table, інакше []." },
    rows: { type: "array", items: { type: "array", items: { type: "string" } }, description: "Рядки таблиці для type=table, інакше []." },
    text: sch("Текст для type=text, інакше порожній рядок."),
  },
};

export const RECORD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["date", "time", "category", "title", "brief", "summary", "source", "highlights", "sections", "captions", "warnings"],
  properties: {
    date: sch("Дата аналізу чи прийому з документа у форматі YYYY-MM-DD; порожній рядок, якщо дати немає."),
    time: sch("Час HH:MM з документа або порожній рядок."),
    category: { type: "string", enum: CATEGORIES },
    title: sch("Короткий заголовок 1–4 слова: «Аналіз ЗАК», «Дерматолог», «Феритин і вітамін D»."),
    brief: sch("Підсумок для згорнутого рядка: до 110 символів, 1–2 речення."),
    summary: sch("Підсумок 2–3 реченнями простою мовою."),
    source: sch("Лабораторія, клініка, лікар або апарат, як на документі."),
    highlights: { type: "array", items: HIGHLIGHT, description: "До 12 найважливіших показників." },
    sections: { type: "array", items: SECTION },
    captions: { type: "array", items: { type: "string" }, description: "Короткий підпис для кожного файлу в тому ж порядку." },
    warnings: { type: "array", items: { type: "string" }, description: "Що варто перевірити вручну: нечитабельні значення, відсутня дата тощо." },
  },
};

/* ---------- промпт ---------- */
// person: { gen, dat } — ім'я власника картки в родовому й давальному відмінку.
export const DEFAULT_PERSON = { gen: "Влада", dat: "Владу" };
export const systemPrompt = ({ gen, dat } = DEFAULT_PERSON) => `Ти допомагаєш вести особисту медичну картку ${gen}. Тобі надсилають фото або PDF медичних документів: результати аналізів, протоколи огляду лікаря, звіти апаратів (InBody, аналізатори шкіри тощо). Твоє завдання — перетворити їх на один запис медкартки за заданою схемою. Пиши українською.

Головне правило — точність. Переносиш значення, одиниці й норми рівно так, як вони надруковані. Нічого не вигадуєш і не «виправляєш». Якщо значення погано видно, став uncertain: true і додай пункт у warnings. Якщо в документі немає дати, лиши date порожнім і напиши про це у warnings.

Як заповнювати:
- title — коротко, як назвала б людина: «Аналіз ЗАК», «Феритин і вітамін D», «Дерматолог», «InBody».
- category: labs — лабораторні аналізи; doctor — огляд чи консультація лікаря; skin — апаратна діагностика шкіри; body — склад тіла, вага, тиск; note — інше.
- brief — до 110 символів, головне для згорнутого списку.
- summary — 2–3 речення простою мовою: що здавали і що головне в результатах.
- highlights — до 12 найважливіших показників. Спершу ті, що поза нормою. tone: ok — у нормі; warn — трохи поза нормою або на межі; alert — суттєво поза нормою; info — норми немає. num, min, max — числа, лише якщо вони однозначні, інакше null.
- sections — розділи сторінки запису:
  1. Для аналізів — таблиця «Результати» з колонками «Показник», «Результат», «Норма» з усіма показниками з документа, не лише важливими.
  2. Для протоколу лікаря — скарги, діагноз, призначення й рекомендації дослівно (type: list або text).
  3. Розділ «Коментар (не медичний висновок)» (type: list) — 3–6 пунктів простою мовою: що означають відхилення; порівняння з попередніми записами з контексту, якщо там є ті самі показники (з датами і значеннями); зв'язок із поточним діагнозом і лікуванням, якщо він очевидний. Без діагнозів і без порад змінювати ліки — для цього «обговорити з лікарем».
- captions — по одному короткому підпису на кожен файл у тому ж порядку («Бланк ЗАК, стор. 1»).
- warnings — що ${dat} варто перевірити вручну. Порожній масив, якщо все чітко.

Для порожніх полів використовуй порожній рядок або порожній масив, як вимагає схема.`;
export const SYSTEM_PROMPT = systemPrompt();

/**
 * Будує content повідомлення: спочатку файли, потім текст із підказкою й контекстом.
 * files: [{ type: "image/jpeg" | "application/pdf" | ..., data: base64, name }]
 */
function fileBlocks(files) {
  return files.map((f, i) => (f.type === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data }, title: f.name || `Документ ${i + 1}` }
    : { type: "image", source: { type: "base64", media_type: f.type, data: f.data } }));
}

export function buildUserContent({ files, note, context, today, person = DEFAULT_PERSON }) {
  const blocks = fileBlocks(files);
  const lines = [
    `Сьогодні: ${today}.`,
    `Файлів: ${files.length}. Порядок підписів у captions — як порядок файлів вище.`,
  ];
  if (note && note.trim()) lines.push(`Підказка від ${person.gen}: ${note.trim()}`);
  if (context) {
    lines.push("Контекст медкартки для порівняння (не переносити в запис як нові дані):");
    lines.push(JSON.stringify(context));
  }
  lines.push("Склади запис медкартки за схемою.");
  blocks.push({ type: "text", text: lines.join("\n") });
  return blocks;
}

/** Стискає попередні записи й поточне лікування до короткого контексту. */
export function compactContext({ status, records }) {
  const ctx = {};
  if (status) {
    ctx.diagnosis = status.diagnosis || "";
    ctx.treatment = Array.isArray(status.plan) ? status.plan.map((p) => `${p.title || ""} (${p.dates || ""})`) : [];
  }
  ctx.previous = (records || []).map((r) => ({
    date: r.date || "",
    title: r.title || "",
    category: r.category || "",
    values: (Array.isArray(r.highlights) ? r.highlights : []).slice(0, 12).map((x) =>
      [x.label, x.value, x.unit, x.norm ? `норма ${x.norm}` : ""].filter(Boolean).join(" ")),
  }));
  return ctx;
}

/** Тіло запиту до Messages API (воркер передає його в Anthropic без змін). */
export function buildRequest({ model, files, note, context, today, person = DEFAULT_PERSON, effort = "medium", maxTokens = 16000 }) {
  return {
    model,
    max_tokens: maxTokens,
    stream: true,
    system: systemPrompt(person),
    messages: [{ role: "user", content: buildUserContent({ files, note, context, today, person }) }],
    output_config: { effort, format: { type: "json_schema", schema: RECORD_SCHEMA } },
  };
}

/** Сьогоднішня дата за Києвом у форматі YYYY-MM-DD. */
export function kyivToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/* ---------- план лікування з протоколу лікаря ---------- */
const nullableDate = (description) => sch(`${description} Формат YYYY-MM-DD або порожній рядок.`);
export const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["diagnosis", "diagnosis_short", "diagnosis_meta", "plan", "plan_note", "care", "rules", "todo", "warnings"],
  properties: {
    diagnosis: sch("Діагноз так, як у документі."),
    diagnosis_short: sch("Діагноз коротко, 2–4 слова, для заголовка."),
    diagnosis_meta: sch("«Попередній/Заключний діагноз · ДД.ММ.РРРР · спеціальність і ПІБ лікаря, клініка» з того, що є в документі."),
    plan: {
      type: "array",
      description: "Етапи лікування, що змінюються в часі, у порядку виконання.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "how", "dates", "start", "end"],
        properties: {
          title: sch("Препарат і кратність коротко: «Елідел 2 р/день»."),
          how: sch("Як застосовувати і скільки днів, як у документі."),
          dates: sch("Дати людською мовою: «15.11 → 21–24.11», «~22–25.11 → ~1–4.12»."),
          start: nullableDate("Дата початку етапу."),
          end: nullableDate("Найпізніша дата кінця етапу."),
        },
      },
    },
    plan_note: sch("Як пораховано дати і що може їх зсунути. Порожньо, якщо етапів немає."),
    care: {
      type: "array",
      description: "Щоденний догляд і постійні засоби.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["when", "what"],
        properties: { when: sch("Коли: «Ранок», «Вечір», «Вмивання», «Після гоління»…"), what: sch("Засіб і як застосовувати.") },
      },
    },
    rules: { type: "array", items: { type: "string" }, description: "Практичні правила з документа: як наносити, чого уникати." },
    todo: {
      type: "array",
      description: "Що треба зробити.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "note", "due"],
        properties: { text: sch("Справа коротко."), note: sch("Уточнення з документа або порожній рядок."), due: nullableDate("Термін.") },
      },
    },
    warnings: { type: "array", items: { type: "string" }, description: "Що перевірити вручну: нечитабельне, неоднозначні дати." },
  },
};

export const planSystemPrompt = ({ gen, dat } = DEFAULT_PERSON) => `Ти допомагаєш вести план лікування в особистій медичній картці ${gen}. Тобі надсилають фото або PDF протоколу огляду лікаря, рецепта чи листка призначень. Склади з них план за заданою схемою. Пиши українською.

Головне правило — точність. Назви препаратів, дозування, кратність і тривалість переносиш точно як у документі. Нічого не додаєш від себе і не змінюєш призначень. Якщо щось погано видно або неоднозначно, напиши про це у warnings.

Як заповнювати:
- plan — лише засоби, схема яких змінюється в часі (наприклад: мазь ще 3 дні → крем 2 р/день 7–10 днів → крем 1 р/день 10 днів). Кожен етап окремо. Дати рахуй від дати документа; якщо в підказці сказано, коли почали, — від неї. Якщо тривалість задана діапазоном, end — за найдовшим варіантом, а в dates познач орієнтовність знаком «~». Якщо тривалість не вказана, end порожній.
- care — засоби, які застосовують щодня без етапів: вмивання, креми зранку й увечері, спреї тощо.
- rules — практичні правила з документа: як наносити, де не наносити, чого уникати.
- todo — що треба зробити: призначені аналізи й обстеження; перехід на наступний етап (due — дата початку етапу); завершення курсу; повторний візит, якщо згадано. В note — коротке уточнення з документа.
- plan_note — одним-двома реченнями: від якої дати пораховано етапи і що їх зсуне.
- warnings — що ${dat} варто перевірити вручну. Порожній масив, якщо все чітко.

Для порожніх полів використовуй порожній рядок або порожній масив, як вимагає схема.`;

/** Запит на розбір протоколу в план. current — чинний план (для довідки), може бути null. */
export function buildPlanRequest({ model, files, note, current, today, person = DEFAULT_PERSON, effort = "medium", maxTokens = 12000 }) {
  const lines = [`Сьогодні: ${today}.`];
  if (note && note.trim()) lines.push(`Підказка від ${person.gen}: ${note.trim()}`);
  if (current) {
    lines.push("Чинний план (для довідки; новий документ має пріоритет):");
    lines.push(JSON.stringify(current));
  }
  lines.push("Склади план лікування за схемою.");
  return {
    model,
    max_tokens: maxTokens,
    stream: true,
    system: planSystemPrompt(person),
    messages: [{ role: "user", content: [...fileBlocks(files), { type: "text", text: lines.join("\n") }] }],
    output_config: { effort, format: { type: "json_schema", schema: PLAN_SCHEMA } },
  };
}

/* ---------- нормалізація відповіді ---------- */
const s = (v, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strArr = (v, max = 400) => (Array.isArray(v) ? v.map((x) => s(x, max)).filter(Boolean) : []);

export function normalizeHighlight(h) {
  if (!h || typeof h !== "object") return null;
  const label = s(h.label, 80);
  const value = s(h.value, 60);
  if (!label || !value) return null;
  const out = { label, value, tone: TONES.includes(h.tone) ? h.tone : "info" };
  const unit = s(h.unit, 30);
  const norm = s(h.norm, 60);
  const flag = s(h.flag, 40);
  const note = s(h.note, 200);
  if (unit) out.unit = unit;
  if (norm) out.norm = norm;
  if (flag) out.flag = flag;
  if (note) out.note = note;
  const num = n(h.num);
  const min = n(h.min);
  const max = n(h.max);
  if (num !== null) out.num = num;
  if (num !== null && min !== null && max !== null && max > min) { out.min = min; out.max = max; }
  if (h.uncertain === true) out.uncertain = true;
  if (out.num === undefined && !/\d/.test(value)) out.text = true;
  return out;
}

export function normalizeSection(sec) {
  if (!sec || typeof sec !== "object") return null;
  const type = SECTION_TYPES.includes(sec.type) ? sec.type : "list";
  const title = s(sec.title, 120);
  if (type === "table") {
    const head = strArr(sec.head, 80);
    const rows = Array.isArray(sec.rows)
      ? sec.rows.filter(Array.isArray).map((r) => r.map((c) => s(c, 200))).filter((r) => r.some(Boolean))
      : [];
    return rows.length ? { type, title, head, rows } : null;
  }
  if (type === "text") {
    const text = s(sec.text, 4000);
    return text ? { type, title, text } : null;
  }
  const items = strArr(sec.items, 600);
  return items.length ? { type: "list", title, items } : null;
}

export function normalizeDraft(raw, { fileCount = 0 } = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  const captions = strArr(r.captions, 120);
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(r.date || "") ? r.date : "",
    time: /^\d{2}:\d{2}$/.test(r.time || "") ? r.time : "",
    category: CATEGORIES.includes(r.category) ? r.category : "note",
    title: s(r.title, 80) || "Новий запис",
    brief: s(r.brief, 200),
    summary: s(r.summary, 1500),
    source: s(r.source, 200),
    highlights: (Array.isArray(r.highlights) ? r.highlights : []).map(normalizeHighlight).filter(Boolean).slice(0, 16),
    sections: (Array.isArray(r.sections) ? r.sections : []).map(normalizeSection).filter(Boolean).slice(0, 20),
    captions: Array.from({ length: fileCount }, (_, i) => captions[i] || `Файл ${i + 1}`),
    warnings: strArr(r.warnings, 300).slice(0, 12),
  };
}

const isoDate = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
const objArr = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);

/** Чистить план (від Claude або з форми) до формату, який зберігається в status/current. */
export function normalizePlan(raw, { keepDone = false } = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    diagnosis: s(r.diagnosis, 300),
    diagnosis_short: s(r.diagnosis_short, 60),
    diagnosis_meta: s(r.diagnosis_meta, 300),
    plan: objArr(r.plan).map((p) => ({ title: s(p.title, 120), how: s(p.how, 300), dates: s(p.dates, 60), start: isoDate(p.start), end: isoDate(p.end) }))
      .filter((p) => p.title).slice(0, 12),
    plan_note: s(r.plan_note, 600),
    care: objArr(r.care).map((c) => ({ when: s(c.when, 60), what: s(c.what, 300) })).filter((c) => c.what).slice(0, 20),
    rules: strArr(r.rules, 300).slice(0, 20),
    todo: objArr(r.todo).map((t, i) => ({ id: s(t.id, 40) || `t${i + 1}`, text: s(t.text, 200), note: s(t.note, 300), due: isoDate(t.due), done: keepDone ? t.done === true : false }))
      .filter((t) => t.text).slice(0, 30),
    warnings: strArr(r.warnings, 300).slice(0, 12),
  };
}

/* ---------- стрім (server-sent events) ---------- */
/** Розбирає SSE на події. onEvent(type, data) викликається для кожної повної події. */
export function createSseParser(onEvent) {
  let buf = "";
  const flush = (block) => {
    let name = "";
    const data = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) name = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (!data.length) return;
    let obj;
    try { obj = JSON.parse(data.join("\n")); } catch { return; }
    onEvent(obj?.type || name, obj);
  };
  return {
    push(chunk) {
      buf += chunk;
      const re = /\r?\n\r?\n/g;
      let m;
      let start = 0;
      while ((m = re.exec(buf))) { flush(buf.slice(start, m.index)); start = m.index + m[0].length; }
      buf = buf.slice(start);
    },
    end() { if (buf.trim()) flush(buf); buf = ""; },
  };
}

/* ---------- помилки ---------- */
export class AIError extends Error {
  constructor(code, message, partial = "") {
    super(message);
    this.code = code;
    this.partial = partial; // що Claude встиг написати до обриву
  }
}

/** Перекладає помилку Anthropic (type + message) у зрозумілий текст. what: "doc" — розпізнавання, "chat" — питання до картки. */
export function anthropicError(type, message, status, what = "doc") {
  const msg = typeof message === "string" ? message : "";
  const chat = what === "chat";
  if (/credit balance/i.test(msg)) return new AIError("billing", "На рахунку Anthropic закінчились кошти. Поповни баланс у console.anthropic.com.");
  if (status === 401 || status === 403 || type === "authentication_error" || type === "permission_error") {
    return new AIError("api_key", "Ключ Anthropic не працює. Перевір секрет ANTHROPIC_API_KEY у воркері.");
  }
  if (status === 429 || type === "rate_limit_error") return new AIError("rate_limit", "Забагато запитів до Claude. Спробуй за хвилину.");
  if (status === 529 || type === "overloaded_error") return new AIError("overloaded", "Claude зараз перевантажений. Спробуй за хвилину.");
  if (status === 413 || type === "request_too_large") {
    return new AIError("too_large", chat ? "Запит завеликий для Claude. Почни нову розмову." : "Файли завеликі для одного запиту. Спробуй менше файлів за раз.");
  }
  if (status === 400 || type === "invalid_request_error") {
    return new AIError("invalid", `Claude не прийняв запит${msg ? `: ${msg}` : "."}${chat ? "" : " Спробуй інші фото або менший PDF."}`);
  }
  return new AIError("api", `${chat ? "Не вдалося отримати відповідь" : "Не вдалося розпізнати документ"}${status ? ` (помилка ${status})` : ""}. Спробуй ще раз.`);
}

async function httpError(res, what) {
  let j = null;
  try { j = await res.json(); } catch { /* не JSON */ }
  // Помилки самого воркера мають поле code.
  const code = j && typeof j.code === "string" ? j.code : "";
  if (code === "auth") return new AIError("auth", "Сесія застаріла. Вийди й увійди ще раз.");
  if (code === "forbidden") return new AIError("forbidden", "Цей акаунт не має доступу до AI.");
  if (code === "config") return new AIError("config", "Воркер не налаштований: немає ключа Anthropic.");
  if (code === "too_large") return new AIError("too_large", what === "chat" ? "Запит завеликий. Почни нову розмову." : "Файли завеликі. Спробуй менше або менші файли.");
  if (code === "origin") return new AIError("origin", "Воркер не приймає запити з цієї адреси (ALLOWED_ORIGIN).");
  return anthropicError(j?.error?.type, j?.error?.message, res.status, what);
}

/**
 * Надсилає запит через воркер і читає відповідь зі стріму.
 * onText(text) — уся відповідь, що вже прийшла (після кожного шматка).
 * what: "doc" або "chat" — від цього залежать тексти помилок.
 * Повертає { text, model, stop, error, usage }; помилки HTTP і мережі кидає як AIError.
 */
export async function streamMessage({ url, token, body, fetchImpl = globalThis.fetch, onText, signal, what = "doc" }) {
  const aborted = what === "chat" ? "Зупинено." : "Розпізнавання скасовано.";
  if (!url) throw new AIError("no_url", "AI ще не налаштовано: немає адреси воркера.");
  let res;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e?.name === "AbortError") throw new AIError("aborted", aborted);
    throw new AIError("network", "Немає зв'язку з сервером AI. Перевір інтернет і спробуй ще раз.");
  }
  if (!res.ok) throw await httpError(res, what);

  const st = { text: "", model: body?.model || "", stop: null, error: null, usage: { input_tokens: 0, output_tokens: 0 } };
  const parser = createSseParser((type, ev) => {
    if (type === "message_start") {
      st.model = ev.message?.model || st.model;
      st.usage.input_tokens = ev.message?.usage?.input_tokens ?? 0;
    } else if (type === "content_block_start" && ev.content_block?.type === "text" && ev.content_block.text) {
      st.text += ev.content_block.text;
    } else if (type === "content_block_delta" && ev.delta?.type === "text_delta") {
      st.text += ev.delta.text || "";
    } else if (type === "message_delta") {
      if (ev.delta?.stop_reason) st.stop = ev.delta.stop_reason;
      if (typeof ev.usage?.output_tokens === "number") st.usage.output_tokens = ev.usage.output_tokens;
    } else if (type === "error") {
      st.error = ev.error || { type: "api_error" };
    }
  });

  const decoder = new TextDecoder();
  try {
    if (res.body && typeof res.body.getReader === "function") {
      const reader = res.body.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
        if (onText) onText(st.text);
      }
    } else {
      parser.push(await res.text());
    }
    parser.push(decoder.decode());
    parser.end();
  } catch (e) {
    if (e?.name === "AbortError") throw new AIError("aborted", aborted, st.text);
    throw new AIError("network", "З'єднання обірвалось, поки Claude відповідав. Спробуй ще раз.", st.text);
  }
  if (onText) onText(st.text);
  return st;
}

/**
 * Розпізнає документи: стрім відповіді у форматі JSON за схемою.
 * onProgress({ chars }) — скільки символів відповіді вже прийшло.
 * Повертає { data (розібраний JSON), model, usage }.
 */
export async function analyzeDocuments({ url, token, body, fetchImpl = globalThis.fetch, onProgress, signal }) {
  const st = await streamMessage({ url, token, body, fetchImpl, signal, onText: onProgress ? (t) => onProgress({ chars: t.length }) : undefined });
  if (st.error) throw anthropicError(st.error.type, st.error.message, 0);
  if (st.stop === "refusal") throw new AIError("refusal", "Claude відмовився обробляти ці файли.");
  if (st.stop === "max_tokens") throw new AIError("max_tokens", "Відповідь вийшла задовгою. Спробуй менше файлів за раз.");
  if (st.stop === "model_context_window_exceeded") throw new AIError("too_large", "Файли завеликі для одного запиту. Спробуй менше файлів за раз.");
  if (!st.stop) throw new AIError("incomplete", "Відповідь обірвалась. Спробуй ще раз.");
  let data;
  try { data = JSON.parse(st.text); } catch { throw new AIError("bad_json", "Не вдалося розібрати відповідь Claude. Спробуй ще раз."); }
  return { data, model: st.model, usage: st.usage };
}
