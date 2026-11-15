// Дрібні помічники: DOM, дати, числа, стиснення фото.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "value" && "value" in el) el.value = v;
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c);
  };
  children.forEach(add);
  return el;
}

export const str = (v) => (v == null ? "" : String(v));
export const pad = (n) => String(n).padStart(2, "0");

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function nowHM() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function dparts(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(iso));
  return m ? { y: m[1], m: m[2], d: m[3] } : null;
}
export const dm = (iso) => { const p = dparts(iso); return p ? `${p.d}.${p.m}` : str(iso); };
export const dmy = (iso) => { const p = dparts(iso); return p ? `${p.d}.${p.m}.${p.y}` : str(iso); };

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/** «28,5» → 28.5; не число → null. */
export function parseNum(v) {
  const m = /^\s*[<>≤≥]?\s*(-?\d+(?:[.,]\d+)?)\s*$/.exec(str(v));
  return m ? Number(m[1].replace(",", ".")) : null;
}
/** «130–170», «130-170», «130 - 170» → [130, 170]; інакше null. */
export function parseRange(v) {
  const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*[–—-]\s*(-?\d+(?:[.,]\d+)?)\s*$/.exec(str(v));
  if (!m) return null;
  const a = Number(m[1].replace(",", "."));
  const b = Number(m[2].replace(",", "."));
  return b > a ? [a, b] : null;
}

export function safeName(name) {
  return str(name).normalize("NFKD").replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").slice(-60) || "file";
}
export function shortId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function drawJpeg(source, max, quality) {
  const bmp = await createImageBitmap(source);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  if (bmp.close) bmp.close();
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", quality));
  if (!blob) throw new Error("toBlob");
  return { blob, w: c.width, h: c.height };
}

/** Мініатюра для списку фото: до 480 px, JPEG. null, якщо браузер не прочитав формат. */
export async function makeThumb(file) {
  try { return (await drawJpeg(file, 480, 0.72)).blob; } catch { return null; }
}

/**
 * Готує файл до відправки й збереження: фото стискає до 2000 px у JPEG і робить мініатюру,
 * PDF лишає як є. Повертає { blob, type, kind, thumb, w, h }.
 */
export async function prepareFile(file) {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
  if (isPdf) return { blob: file, type: "application/pdf", kind: "pdf", thumb: null };
  try {
    const full = await drawJpeg(file, 2000, 0.86);
    return { blob: full.blob, type: "image/jpeg", kind: "image", thumb: await makeThumb(full.blob), w: full.w, h: full.h };
  } catch { /* формат, який браузер не розпізнав */ }
  if (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
    return { blob: file, type: file.type, kind: "image", thumb: null };
  }
  throw new Error(`Формат «${file.name}» не підтримується. Потрібні JPEG, PNG або PDF.`);
}

/** Вміст blob у base64 (без префікса data:). */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const u = String(r.result); resolve(u.slice(u.indexOf(",") + 1)); };
    r.onerror = () => reject(r.error || new Error("read"));
    r.readAsDataURL(blob);
  });
}

export function copyText(text, el) {
  const done = () => { if (el) { const t = el.textContent; el.textContent = "Скопійовано"; setTimeout(() => (el.textContent = t), 1400); } };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => {});
}

/** Замінює вміст елемента, пропускаючи порожні (null/false) частини. */
export function put(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
}

/* ---------- доступність ---------- */
const inerted = new Set();
/** Модальне вікно: усе на сторінці, крім keep, стає inert — фокус і читалка не виходять за межі вікна. */
export function inertOutside(keep, on) {
  if (!on) { inerted.forEach((el) => { el.inert = false; }); inerted.clear(); return; }
  for (const el of document.body.children) {
    if (el === keep || el.tagName === "SCRIPT" || el.inert) continue;
    el.inert = true;
    inerted.add(el);
  }
}

/** Програмний фокус на заголовок чи інший неінтерактивний елемент (без появи в порядку Tab). */
export function focusEl(el) {
  if (!el) return;
  if (!el.matches("a[href], button, input, select, textarea, [tabindex]")) el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: true });
}

/** Помилка валідації: поле позначається як некоректне, пов'язується з текстом помилки й отримує фокус. */
export function markInvalid(form, field, msg) {
  form.querySelectorAll("[aria-invalid]").forEach((el) => { el.removeAttribute("aria-invalid"); el.removeAttribute("aria-describedby"); });
  if (!field) return;
  field.setAttribute("aria-invalid", "true");
  if (msg?.id) field.setAttribute("aria-describedby", msg.id);
  field.focus();
}
