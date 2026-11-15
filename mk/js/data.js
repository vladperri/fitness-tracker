// Стан застосунку і робота з Firestore. Медкартка профілю лежить під medkartka/<профіль>/… (у Влада — medkartka/data):
//   records/{id}               записи
//   status/current             поточне лікування
//   files/{id}                 опис файлу + мініатюра
//   files/{id}/chunks/{n}      сам файл шматками до ~900 КБ (ліміт документа Firestore — 1 МБ)
import {
  fb, collection, doc, query, orderBy, onSnapshot, getDoc, getDocFromCache, setDoc, updateDoc, deleteDoc, serverTimestamp, Bytes,
} from "./fb.js";
import { shortId } from "./util.js";
import { PROFILE } from "./config.js";

export const CATS = { labs: "Аналізи", doctor: "Лікар", skin: "Шкіра", body: "Тіло", note: "Нотатка" };
export const catOf = (r) => (CATS[r?.category] ? r.category : "note");

export const S = {
  user: null,
  records: [],
  status: null,
  statusLoaded: false,
  loaded: false,
  denied: false,
  error: null,
  filter: "all",
  saving: false,
  lastDone: null,
  homeScroll: 0,
  fromList: false,
};

const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
const emit = (what) => listeners.forEach((fn) => fn(what));

const ROOT = PROFILE.root;

// Firestore не зберігає масиви в масивах, тому рядки таблиць лежать у базі як { c: [...] }.
const packSections = (secs) => (Array.isArray(secs)
  ? secs.map((x) => (x && Array.isArray(x.rows) ? { ...x, rows: x.rows.map((r) => ({ c: Array.isArray(r) ? r : [] })) } : x))
  : secs);
const unpackSections = (secs) => (Array.isArray(secs)
  ? secs.map((x) => (x && Array.isArray(x.rows) ? { ...x, rows: x.rows.map((r) => (Array.isArray(r) ? r : Array.isArray(r?.c) ? r.c : [])) } : x))
  : secs);
const col = (...segs) => collection(fb.db, ...ROOT, ...segs);
const ref = (...segs) => doc(fb.db, ...ROOT, ...segs);

let unsubs = [];
export function subscribe() {
  unsubscribe();
  const fail = (err) => {
    if (err.code === "permission-denied") S.denied = true;
    else S.error = err.message;
  };
  unsubs.push(onSnapshot(query(col("records"), orderBy("sort", "desc")), (snap) => {
    S.records = snap.docs.map((d) => {
      const r = { _id: d.id, ...d.data() };
      if (r.sections) r.sections = unpackSections(r.sections);
      return r;
    });
    S.loaded = true;
    S.error = null;
    emit("records");
  }, (err) => { S.loaded = true; fail(err); emit("records"); }));
  unsubs.push(onSnapshot(ref("status", "current"), (snap) => {
    S.status = snap.exists() ? snap.data() : null;
    S.statusLoaded = true;
    emit("status");
  }, (err) => { S.statusLoaded = true; fail(err); emit("status"); }));
}
export function unsubscribe() {
  unsubs.forEach((u) => u());
  unsubs = [];
  S.records = [];
  S.status = null;
  S.loaded = false;
  S.statusLoaded = false;
  S.denied = false;
  S.error = null;
}

export const findRecord = (id) => S.records.find((r) => r._id === id) || null;
export const getToken = () => fb.auth.currentUser.getIdToken();

/* ---------- файли ---------- */
export const CHUNK = 900 * 1024;

const toBytes = async (blob) => Bytes.fromUint8Array(new Uint8Array(await blob.arrayBuffer()));

/** Файли не змінюються після збереження, тому спершу читаємо з кешу на пристрої. */
async function cacheFirst(r) {
  try {
    const snap = await getDocFromCache(r);
    if (snap.exists()) return snap;
  } catch { /* немає в кеші */ }
  return getDoc(r);
}

/**
 * Зберігає підготовлений файл ({ blob, type, kind, thumb?, w?, h? }) і повертає його id.
 * id можна задати, щоб повторний імпорт перезаписував ті самі файли.
 */
export async function saveFile(prepared, { name, id = `f${shortId()}` } = {}) {
  const buf = new Uint8Array(await prepared.blob.arrayBuffer());
  const chunks = Math.max(1, Math.ceil(buf.length / CHUNK));
  for (let i = 0; i < chunks; i++) {
    await setDoc(ref("files", id, "chunks", String(i)), { d: Bytes.fromUint8Array(buf.slice(i * CHUNK, (i + 1) * CHUNK)) });
  }
  const meta = { name: name || "", type: prepared.type, kind: prepared.kind, size: buf.length, chunks, created: serverTimestamp() };
  if (prepared.thumb) meta.thumb = await toBytes(prepared.thumb);
  if (prepared.w && prepared.h) { meta.w = prepared.w; meta.h = prepared.h; }
  // Опис пишемо останнім: якщо він є, значить усі шматки вже збережено.
  await setDoc(ref("files", id), meta);
  metaCache.delete(id);
  return id;
}

const metaCache = new Map();
export function fileMeta(id) {
  if (!metaCache.has(id)) {
    const p = cacheFirst(ref("files", id)).then((s) => (s.exists() ? s.data() : null));
    p.catch(() => metaCache.delete(id));
    metaCache.set(id, p);
  }
  return metaCache.get(id);
}

const thumbCache = new Map();
/** URL мініатюри або null (PDF, файл без мініатюри). */
export function thumbUrl(id) {
  if (!thumbCache.has(id)) {
    const p = fileMeta(id).then((m) => (m?.thumb ? URL.createObjectURL(new Blob([m.thumb.toUint8Array()], { type: "image/jpeg" })) : null));
    p.catch(() => thumbCache.delete(id));
    thumbCache.set(id, p);
  }
  return thumbCache.get(id);
}

const fullCache = new Map();
/** URL повного файлу (зібраного з шматків). */
export function fileUrl(id) {
  if (!fullCache.has(id)) {
    const p = (async () => {
      const m = await fileMeta(id);
      if (!m) throw new Error("Файл не знайдено");
      const parts = [];
      for (let i = 0; i < (m.chunks || 1); i++) {
        const s = await cacheFirst(ref("files", id, "chunks", String(i)));
        if (!s.exists()) throw new Error("Файл пошкоджено");
        parts.push(s.data().d.toUint8Array());
      }
      return URL.createObjectURL(new Blob(parts, { type: m.type || "application/octet-stream" }));
    })();
    p.catch(() => fullCache.delete(id));
    fullCache.set(id, p);
  }
  return fullCache.get(id);
}

export async function deleteFile(id) {
  const m = await fileMeta(id).catch(() => null);
  const n = m?.chunks || 1;
  await deleteDoc(ref("files", id));
  await Promise.allSettled(Array.from({ length: n }, (_, i) => deleteDoc(ref("files", id, "chunks", String(i)))));
  for (const c of [thumbCache, fullCache]) {
    c.get(id)?.then((u) => u && URL.revokeObjectURL(u)).catch(() => {});
    c.delete(id);
  }
  metaCache.delete(id);
}

/* ---------- записи ---------- */
export async function saveRecord(id, data, { isNew }) {
  const body = { ...data, updated: serverTimestamp() };
  if ("sections" in body) body.sections = packSections(body.sections);
  if (isNew) body.created = serverTimestamp();
  await setDoc(ref("records", id), body, { merge: !isNew });
}

export async function removeRecord(rec) {
  await deleteDoc(ref("records", rec._id));
  await Promise.allSettled((rec.gallery || []).map((g) => g?.file && deleteFile(g.file)));
}

export async function setStatus(data) {
  await setDoc(ref("status", "current"), data);
}

export async function removeStatus() {
  await deleteDoc(ref("status", "current"));
}

export async function toggleTodo(i, done) {
  if (S.saving || !S.status) return { ok: false };
  const prev = S.status;
  const list = (S.status.todo || []).map((t) => ({ ...t }));
  if (!list[i]) return { ok: false };
  list[i].done = done;
  S.saving = true;
  S.lastDone = done ? i : null;
  S.status = { ...S.status, todo: list };
  emit("status");
  try {
    await updateDoc(ref("status", "current"), { todo: list });
    S.saving = false;
    emit("status");
    return { ok: true };
  } catch (e) {
    S.saving = false;
    S.status = prev;
    S.lastDone = null;
    emit("status");
    return { ok: false, error: e };
  }
}
