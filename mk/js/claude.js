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
export const SYSTEM_PROMPT = `Ти допомагаєш вести особисту медичну картку Влада. Тобі надсилають фото або PDF медичних документів: результати аналізів, протоколи огляду лікаря, звіти апаратів (InBody, аналізатори шкіри тощо). Твоє завдання — перетворити їх на один запис медкартки за заданою схемою. Пиши українською.

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
- warnings — що Владу варто перевірити вручну. Порожній масив, якщо все чітко.

Для порожніх полів використовуй порожній рядок або порожній масив, як вимагає схема.`;

/**
 * Будує content повідомлення: спочатку файли, потім текст із підказкою й контекстом.
 * files: [{ type: "image/jpeg" | "application/pdf" | ..., data: base64, name }]
 */
export function buildUserContent({ files, note, context, today }) {
  const blocks = files.map((f, i) => (f.type === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data }, title: f.name || `Документ ${i + 1}` }
    : { type: "image", source: { type: "base64", media_type: f.type, data: f.data } }));
  const lines = [
    `Сьогодні: ${today}.`,
    `Файлів: ${files.length}. Порядок підписів у captions — як порядок файлів вище.`,
  ];
  if (note && note.trim()) lines.push(`Підказка від Влада: ${note.trim()}`);
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
export function buildRequest({ model, files, note, context, today, effort = "medium", maxTokens = 16000 }) {
  return {
    model,
    max_tokens: maxTokens,
    stream: true,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserContent({ files, note, context, today }) }],
    output_config: { effort, format: { type: "json_schema", schema: RECORD_SCHEMA } },
  };
}

/** Сьогоднішня дата за Києвом у форматі YYYY-MM-DD. */
export function kyivToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
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
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Перекладає помилку Anthropic (type + message) у зрозумілий текст. */
function anthropicError(type, message, status) {
  const msg = typeof message === "string" ? message : "";
  if (/credit balance/i.test(msg)) return new AIError("billing", "На рахунку Anthropic закінчились кошти. Поповни баланс у console.anthropic.com.");
  if (status === 401 || status === 403 || type === "authentication_error" || type === "permission_error") {
    return new AIError("api_key", "Ключ Anthropic не працює. Перевір секрет ANTHROPIC_API_KEY у воркері.");
  }
  if (status === 429 || type === "rate_limit_error") return new AIError("rate_limit", "Забагато запитів до Claude. Спробуй за хвилину.");
  if (status === 529 || type === "overloaded_error") return new AIError("overloaded", "Claude зараз перевантажений. Спробуй за хвилину.");
  if (status === 413 || type === "request_too_large") return new AIError("too_large", "Файли завеликі для одного запиту. Спробуй менше файлів за раз.");
  if (status === 400 || type === "invalid_request_error") {
    return new AIError("invalid", `Claude не прийняв запит${msg ? `: ${msg}` : "."} Спробуй інші фото або менший PDF.`);
  }
  return new AIError("api", `Не вдалося розпізнати документ${status ? ` (помилка ${status})` : ""}. Спробуй ще раз.`);
}

async function httpError(res) {
  let j = null;
  try { j = await res.json(); } catch { /* не JSON */ }
  // Помилки самого воркера мають поле code.
  const code = j && typeof j.code === "string" ? j.code : "";
  if (code === "auth") return new AIError("auth", "Сесія застаріла. Вийди й увійди ще раз.");
  if (code === "forbidden") return new AIError("forbidden", "Цей акаунт не має доступу до AI.");
  if (code === "config") return new AIError("config", "Воркер не налаштований: немає ключа Anthropic.");
  if (code === "too_large") return new AIError("too_large", "Файли завеликі. Спробуй менше або менші файли.");
  if (code === "origin") return new AIError("origin", "Воркер не приймає запити з цієї адреси (ALLOWED_ORIGIN).");
  return anthropicError(j?.error?.type, j?.error?.message, res.status);
}

/**
 * Надсилає запит через воркер і збирає відповідь зі стріму.
 * onProgress({ chars }) — скільки символів відповіді вже прийшло.
 * Повертає { data (розібраний JSON), model, usage }.
 */
export async function analyzeDocuments({ url, token, body, fetchImpl = globalThis.fetch, onProgress, signal }) {
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
    if (e?.name === "AbortError") throw new AIError("aborted", "Розпізнавання скасовано.");
    throw new AIError("network", "Немає зв'язку з сервером AI. Перевір інтернет і спробуй ще раз.");
  }
  if (!res.ok) throw await httpError(res);

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
        if (onProgress) onProgress({ chars: st.text.length });
      }
    } else {
      parser.push(await res.text());
    }
    parser.push(decoder.decode());
    parser.end();
  } catch (e) {
    if (e?.name === "AbortError") throw new AIError("aborted", "Розпізнавання скасовано.");
    throw new AIError("network", "З'єднання обірвалось, поки Claude відповідав. Спробуй ще раз.");
  }

  if (st.error) throw anthropicError(st.error.type, st.error.message, 0);
  if (st.stop === "refusal") throw new AIError("refusal", "Claude відмовився обробляти ці файли.");
  if (st.stop === "max_tokens") throw new AIError("max_tokens", "Відповідь вийшла задовгою. Спробуй менше файлів за раз.");
  if (st.stop === "model_context_window_exceeded") throw new AIError("too_large", "Файли завеликі для одного запиту. Спробуй менше файлів за раз.");
  if (!st.stop) throw new AIError("incomplete", "Відповідь обірвалась. Спробуй ще раз.");
  let data;
  try { data = JSON.parse(st.text); } catch { throw new AIError("bad_json", "Не вдалося розібрати відповідь Claude. Спробуй ще раз."); }
  return { data, model: st.model, usage: st.usage };
}
