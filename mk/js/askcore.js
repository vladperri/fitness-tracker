// Питання до картки: текст картки для Claude, промпт, тіло запиту, розбір відповіді.
// Без DOM і Firebase, щоб це можна було перевірити тестами в Node.
import { DEFAULT_PERSON, AIError, anthropicError, streamMessage } from "./claude.js";

export const AUDIENCES = { doctor: "Для лікаря", plain: "Простою мовою" };
const CATS = { labs: "Аналізи", doctor: "Лікар", skin: "Шкіра", body: "Тіло", note: "Нотатка" };
const MAX_HISTORY = 12; // останні 6 пар «питання — відповідь»

const t = (v) => (v == null ? "" : String(v).trim());
const arr = (v) => (Array.isArray(v) ? v : []);
export const dmy = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t(iso));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
};

/* ---------- текст картки ---------- */
function planText(st) {
  if (!st) return "";
  const out = ["## План лікування (поточний)"];
  const diag = [t(st.diagnosis), t(st.diagnosis_meta)].filter(Boolean).join(". ");
  if (diag) out.push(`Діагноз: ${diag}`);
  const stages = arr(st.plan).filter((p) => t(p?.title));
  if (stages.length) {
    out.push("Етапи:");
    stages.forEach((p) => {
      const when = t(p.dates) || [dmy(p.start), dmy(p.end)].filter(Boolean).join("–");
      out.push(`- ${t(p.title)}${when ? ` (${when})` : ""}${t(p.how) ? `: ${t(p.how)}` : ""}`);
    });
  }
  if (t(st.plan_note)) out.push(`Примітка до плану: ${t(st.plan_note)}`);
  const care = arr(st.care).filter((c) => t(c?.what));
  if (care.length) {
    out.push("Щоденний догляд:");
    care.forEach((c) => out.push(`- ${t(c.when) ? `${t(c.when)}: ` : ""}${t(c.what)}`));
  }
  const rules = arr(st.rules).map(t).filter(Boolean);
  if (rules.length) {
    out.push("Правила:");
    rules.forEach((r) => out.push(`- ${r}`));
  }
  const todo = arr(st.todo).filter((x) => t(x?.text));
  if (todo.length) {
    out.push("Справи:");
    todo.forEach((x) => out.push(`- [${x.done ? "виконано" : "не виконано"}] ${t(x.text)}${x.due ? ` — до ${dmy(x.due)}` : ""}${t(x.note) ? `; ${t(x.note)}` : ""}`));
  }
  return out.length > 1 ? out.join("\n") : "";
}

function recordHead(r) {
  const when = [dmy(r.date) || "без дати", t(r.time)].filter(Boolean).join(" ");
  const cat = CATS[r.category] || CATS.note;
  return `### ${when} · ${cat} · ${t(r.title) || "Запис"}${t(r.source) ? ` — ${t(r.source)}` : ""}`;
}

function recordText(r) {
  const out = [recordHead(r)];
  if (t(r.summary)) out.push(`Підсумок: ${t(r.summary)}`);
  else if (t(r.brief)) out.push(`Підсумок: ${t(r.brief)}`);
  const hls = arr(r.highlights).filter((x) => t(x?.label) && t(x?.value));
  if (hls.length) {
    out.push("Показники:");
    hls.forEach((x) => {
      const val = [t(x.value), t(x.unit)].filter(Boolean).join(" ");
      out.push(`- ${t(x.label)}: ${val}${t(x.norm) ? ` (норма ${t(x.norm)})` : ""}${t(x.flag) ? ` — ${t(x.flag)}` : ""}${t(x.note) ? `. ${t(x.note)}` : ""}`);
    });
  }
  arr(r.sections).forEach((sec) => {
    if (!sec || typeof sec !== "object") return;
    const title = t(sec.title) || "Розділ";
    if (sec.type === "table") {
      const rows = arr(sec.rows).map((row) => (Array.isArray(row) ? row : arr(row?.c)).map(t));
      if (!rows.length) return;
      out.push(`${title} (таблиця):`);
      if (arr(sec.head).length) out.push(arr(sec.head).map(t).join(" | "));
      rows.forEach((row) => out.push(row.join(" | ")));
    } else if (sec.type === "text") {
      if (t(sec.text)) out.push(`${title}: ${t(sec.text)}`);
    } else {
      const items = arr(sec.items).map(t).filter(Boolean);
      if (!items.length) return;
      out.push(`${title}:`);
      items.forEach((it) => out.push(`- ${it}`));
    }
  });
  const caps = arr(r.gallery).map((g) => t(g?.caption)).filter(Boolean);
  if (caps.length) out.push(`Файли (${caps.length}): ${caps.slice(0, 12).join("; ")}${caps.length > 12 ? "; …" : ""}`);
  return out.join("\n");
}

/**
 * Уся картка одним текстом: план лікування і записи від нових до старих.
 * Якщо текст перевищує budget символів, старші записи йдуть лише заголовком і коротким підсумком.
 */
export function cardText({ records = [], status = null, person = DEFAULT_PERSON, today = "", budget = 150000 }) {
  const recs = arr(records);
  const parts = [`# Медична картка ${person.gen}`, `Сьогодні: ${today}. Записів у картці: ${recs.length}.`];
  const plan = planText(status);
  parts.push(plan || "## План лікування\nПлану лікування в картці немає.");
  parts.push(recs.length ? "## Записи, від нових до старих" : "## Записи\nЗаписів поки немає.");
  let size = parts.join("\n\n").length;
  let short = 0;
  recs.forEach((r) => {
    const full = recordText(r);
    if (size + full.length <= budget) {
      parts.push(full);
      size += full.length + 2;
    } else {
      const brief = `${recordHead(r)}\nКоротко: ${t(r.brief) || t(r.summary).slice(0, 200) || "—"}`;
      parts.push(brief);
      size += brief.length + 2;
      short += 1;
    }
  });
  if (short) parts.push(`(Ще ${short} старших записів показано скорочено: повний текст не вмістився.)`);
  return parts.join("\n\n");
}

/** Підказка про запис, відкритий на екрані, — іде перед питанням. */
export function focusText(r) {
  if (!r) return "";
  const when = dmy(r.date);
  return `Зараз на екрані відкритий запис «${t(r.title) || "Запис"}»${when ? ` від ${when}` : ""}. Слова «тут», «цей запис», «цей аналіз» стосуються саме його.`;
}

/* ---------- промпт і запит ---------- */
export const chatSystemPrompt = ({ gen } = DEFAULT_PERSON, audience = "doctor") => `Ти — медичний AI-помічник в особистій медичній картці ${gen}. Нижче — уся картка: поточний план лікування і записи (аналізи, висновки лікарів, звіти апаратів), розпізнані з документів.

${audience === "plain"
    ? `Хто питає: власник картки або хтось із рідних. Пояснюй простою мовою, без жаргону; медичні терміни коротко розшифровуй.`
    : `Хто питає: лікар на прийомі взяв телефон пацієнта і шукає відповіді швидко. Відповідай як колега: стисло, професійною термінологією, з конкретними значеннями, одиницями й датами.`}

Як відповідати:
- Спочатку пряма відповідь одним-двома реченнями, далі деталі. Зазвичай до 150–200 слів, якщо не просять докладніше.
- Факти про пацієнта бери лише з картки й називай джерело: назву і дату запису («ЗАК від 14.11.2026»).
- Чітко відділяй дані з картки від загальних медичних знань.
- Не вигадуй значень, дат, препаратів чи діагнозів. Якщо в картці цього немає — так і скажи й підкажи, яке обстеження чи питання це прояснить.
- Можна порівнювати показники в динаміці, звіряти з нормами з бланків, перелічувати можливі причини й диференційні варіанти, нагадувати про взаємодії та протипоказання препаратів.
- Не скасовуй і не змінюй призначень лікаря: остаточне рішення за лікарем.
- Якщо описане схоже на невідкладний стан, першим реченням порадь негайно звернутися по допомогу (103 або 112).
- Відповідай мовою питання, за замовчуванням українською.
- Формат: звичайний текст; можна **жирний** і списки «- » або «1. ». Без таблиць і без заголовків «#».`;

/** Залишає останні пари «питання — відповідь»; історія завжди починається з питання. */
export function trimHistory(history) {
  const h = arr(history).filter((m) => (m?.role === "user" || m?.role === "assistant") && t(m.text)).slice(-MAX_HISTORY);
  while (h.length && h[0].role !== "user") h.shift();
  return h;
}

/** Тіло запиту до Messages API. Картка йде окремим блоком system із кешуванням, щоб наступні питання були дешевші. */
export function buildChatRequest({ model, person = DEFAULT_PERSON, audience = "doctor", card, history = [], question, focus = "", effort = "medium", maxTokens = 4000 }) {
  const messages = trimHistory(history).map((m) => ({ role: m.role, content: t(m.text) }));
  const content = [];
  if (focus) content.push({ type: "text", text: focus });
  content.push({ type: "text", text: t(question) });
  messages.push({ role: "user", content });
  return {
    model,
    max_tokens: maxTokens,
    stream: true,
    system: [
      { type: "text", text: chatSystemPrompt(person, audience) },
      { type: "text", text: card, cache_control: { type: "ephemeral" } },
    ],
    messages,
    output_config: { effort },
  };
}

/**
 * Надсилає питання і стрімить відповідь. onText(text) — уся відповідь на цей момент.
 * Повертає { text, model, usage, truncated }.
 */
export async function askClaude({ url, token, body, fetchImpl, onText, signal }) {
  const st = await streamMessage({ url, token, body, fetchImpl, onText, signal, what: "chat" });
  if (st.error) {
    const e = anthropicError(st.error.type, st.error.message, 0, "chat");
    e.partial = st.text;
    throw e;
  }
  if (st.stop === "refusal") throw new AIError("refusal", "Claude не відповів на це питання. Спробуй сформулювати інакше.", st.text);
  if (st.stop === "model_context_window_exceeded") throw new AIError("too_large", "Картка й розмова завеликі для одного запиту. Почни нову розмову.", st.text);
  if (!st.stop) throw new AIError("incomplete", "Відповідь обірвалась. Спробуй ще раз.", st.text);
  return { text: st.text.trim(), model: st.model, usage: st.usage, truncated: st.stop === "max_tokens" };
}

/* ---------- простий markdown відповіді ---------- */
/** Рядок → частини з позначкою жирного: [{ s, b? }]. */
export function inline(s) {
  const parts = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push({ s: s.slice(last, m.index) });
    parts.push({ s: m[1], b: true });
    last = re.lastIndex;
  }
  if (last < s.length) parts.push({ s: s.slice(last) });
  return parts;
}

/** Текст відповіді → блоки: абзаци (p), списки (ul, ol), підзаголовки (h). HTML не інтерпретується. */
export function parseMd(text) {
  const blocks = [];
  let para = [];
  let list = null;
  const flushPara = () => { if (para.length) { blocks.push({ t: "p", parts: inline(para.join("\n")) }); para = []; } };
  const flushList = () => { if (list) { blocks.push(list); list = null; } };
  for (const raw of t(text).split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    let m;
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) {
      flushPara();
      if (list?.t !== "ul") { flushList(); list = { t: "ul", items: [] }; }
      list.items.push(inline(m[1]));
      continue;
    }
    if ((m = /^\s*(\d+)[.)]\s+(.*)$/.exec(line))) {
      flushPara();
      if (list?.t !== "ol") { flushList(); list = { t: "ol", start: Number(m[1]), items: [] }; }
      list.items.push(inline(m[2]));
      continue;
    }
    if ((m = /^#{1,6}\s+(.*)$/.exec(line))) { flushPara(); flushList(); blocks.push({ t: "h", parts: inline(m[1]) }); continue; }
    if (list && /^\s{2,}\S/.test(raw)) { list.items.at(-1).push(...inline(` ${line.trim()}`)); continue; }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return blocks;
}
