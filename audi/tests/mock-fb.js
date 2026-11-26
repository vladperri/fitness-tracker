// Тестова заміна js/fb.js: той самий інтерфейс (подія "audi:auth", window.AudiAuth), дані в пам'яті.
// Режим задає ?mock=in|out|empty|deny.
const MODE = new URLSearchParams(location.search).get("mock") || "in";
const seed = {
  records: {
    r20260328: { date: "2026-03-28", km: 179490, types: ["to", "repair"], title: "ТО й ремонт: фільтри, подушки двигуна", items: [{ n: "Масло Aral", s: "5 л", p: 2700 }, { n: "Подушка двигуна ліва FEBI", p: 5800 }], total: 22250, note: "Накладна № 10036", warn: "Без допуску VW 502 00", svc: ["engine_oil", "oil_filter", "air", "cabin"] },
    r20260624: { date: "2026-06-24", km: 182000, types: ["to"], title: "Мастило в коробці передач і Torsen", items: [{ n: "Заміна мастила", s: "ремкомплект ZF" }, { n: "Torsen", s: "оригінал", pt: "8 200 грн/л" }], total: null, note: "", warn: "", svc: ["atf", "transfer"] },
    r20261106: { date: "2026-11-06", km: 187690, types: ["to"], title: "Заміна мастила в двигуні з фільтрами", items: [{ n: "Фільтр Mahle", c: "OC 456", p: 670 }, { n: "Повітряний Wunder", c: "WH 142", p: 650 }], total: 4650, note: "Рахунок", warn: "Немає VW 502 00", svc: ["engine_oil", "oil_filter", "air", "cabin"] },
    r20261119: { date: "2026-11-19", km: 188054, types: ["repair"], title: "Передня підвіска й розвал-сходження", items: [{ n: "Наконечник рульової тяги", c: "35742 01", s: "Lemförder", p: 350 }, { n: "Підшипник маточини", c: "713 6109 00", s: "FAG", p: 1000 }], total: 5250, note: "", warn: "", svc: [] },
    r20261123: { date: "2026-11-23", km: null, types: ["to"], title: "Щітки склоочисника", items: [{ n: "Bosch Aerotwin" }], total: null, note: "", warn: "", svc: [] },
  },
  reminders: { m1: { title: "Діагностика задньої підвіски", date: "2026-11-30", km: null, note: "Шевчук", done: false } },
  settings: { main: { oilIntervalKm: 8000, oilIntervalMonths: 12 } },
};
const store = JSON.parse(JSON.stringify(MODE === "empty" ? { records: {}, reminders: {}, settings: {} } : seed));
window.__store = store; window.__writes = []; window.__unsubs = 0;
let listeners = [];
const coll = (n) => store[n] || (store[n] = {});
const copy = (x) => JSON.parse(JSON.stringify(x));
function notify() { setTimeout(() => listeners.forEach((l) => l.fn()), 5); }
function sub(fn) { const l = { fn }; listeners.push(l); setTimeout(fn, 15); return () => { window.__unsubs++; listeners = listeners.filter((x) => x !== l); }; }
const deny = (err) => { setTimeout(() => err && err({ code: "permission-denied" }), 15); return () => {}; };
function docApi(path) {
  const [c, id] = path.split("/");
  return {
    set(d) { if (window.__FAIL_WRITES) return Promise.reject({ code: "unavailable" }); window.__writes.push(["set", path, copy(d)]); coll(c)[id] = copy(d); notify(); return Promise.resolve(); },
    update(d) { window.__writes.push(["update", path, copy(d)]); if (!coll(c)[id]) return Promise.reject({ code: "not-found" }); Object.assign(coll(c)[id], copy(d)); notify(); return Promise.resolve(); },
    delete() { window.__writes.push(["delete", path]); delete coll(c)[id]; notify(); return Promise.resolve(); },
    onSnapshot(next, err) { if (MODE === "deny") return deny(err); return sub(() => { const x = coll(c)[id]; next({ id, exists: !!x, data: () => (x ? copy(x) : undefined), metadata: { fromCache: false } }); }); },
  };
}
const db = {
  collection: (name) => ({
    doc: (id) => docApi(name + "/" + id),
    onSnapshot(next, err) { if (MODE === "deny") return deny(err); return sub(() => { const c = coll(name); next({ metadata: { fromCache: false }, docs: Object.keys(c).sort().map((id) => ({ id, data: () => copy(c[id]) })) }); }); },
  }),
  doc: (path) => docApi(path),
};
function emit(s) { window.__audiAuth = s; window.dispatchEvent(new CustomEvent("audi:auth", { detail: s })); }
const IN = { user: { email: "vlad@example.com", name: "Vlad" }, db };
window.AudiAuth = {
  signIn: () => { setTimeout(() => emit(IN), 10); return Promise.resolve(); },
  signOut: () => { setTimeout(() => emit({ user: null, db: null }), 10); return Promise.resolve(); },
};
setTimeout(() => emit(MODE === "out" ? { user: null, db: null } : IN), 20);
