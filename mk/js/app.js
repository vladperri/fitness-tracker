// Точка входу: вхід через Google, маршрути, підписка на дані.
import { initFirebase, fb, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "./fb.js";
import { h, put } from "./util.js";
import { S, onChange, subscribe, unsubscribe } from "./data.js";
import { renderChips, renderList, renderNowPanel, renderNowPage, renderRecord, initLightbox, closeLb } from "./render.js";
import { renderNew, renderEdit } from "./ai.js";
import { renderImport, isImporting } from "./import.js";
import { renderPlan, resetPlan, isPlanOpen } from "./plan.js";
import { PROFILE } from "./config.js";

const $ = (id) => document.getElementById(id);
const GOOGLE_ICON = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6C12.4 13.7 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.9-4.7l-7.8-6A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.2-13.5-10l-7.9 6C6.6 42.6 14.6 48 24 48z"/></svg>';

try { const f = localStorage.getItem("medcard-filter"); if (f) S.filter = f; } catch { /* ignore */ }

/* ---------- routing ---------- */
function route() {
  const hash = location.hash || "";
  if (hash === "#now") return { name: "now" };
  if (hash === "#new") return { name: "new" };
  if (hash === "#import" && PROFILE.import) return { name: "import" };
  if (hash === "#plan") return { name: "plan" };
  let m = /^#r-([A-Za-z0-9_-]+)$/.exec(hash);
  if (m) return { name: "record", id: m[1] };
  m = /^#edit-([A-Za-z0-9_-]+)$/.exec(hash);
  if (m) return { name: "edit", id: m[1] };
  return { name: "home" };
}

let current = null;
function render(reason) {
  if (!S.user) return;
  if (S.denied) return showDenied();
  $("gate").hidden = true;
  const rt = route();
  const home = $("home");
  const page = $("page");
  if (rt.name === "home") {
    document.title = "Медкартка";
    page.hidden = true;
    page.replaceChildren();
    home.hidden = false;
    renderNowPanel();
    renderChips();
    renderList();
  } else {
    home.hidden = true;
    page.hidden = false;
    // Форми не перемальовуємо від змін даних, щоб не стерти введене.
    if (reason && ["new", "edit", "import"].includes(rt.name)) return;
    if (rt.name === "import" && isImporting()) return;
    if (rt.name === "plan" && reason && isPlanOpen()) return;
    if (rt.name === "now") renderNowPage(page);
    else if (rt.name === "record") renderRecord(page, rt.id);
    else if (rt.name === "new") renderNew(page);
    else if (rt.name === "edit") renderEdit(page, rt.id);
    else if (rt.name === "import") renderImport(page);
    else if (rt.name === "plan") renderPlan(page);
  }
  current = rt;
}

window.addEventListener("hashchange", () => {
  closeLb();
  if (route().name !== "plan") resetPlan();
  const was = current;
  render();
  if (current?.name !== "home") window.scrollTo(0, 0);
  else if (was && was.name !== "home") window.scrollTo(0, S.homeScroll || 0);
});

onChange((what) => {
  const rt = route();
  if (rt.name === "home") {
    if (what === "status") renderNowPanel();
    else { renderChips(); renderList(); }
    if (S.denied) showDenied();
    return;
  }
  if (rt.name === "edit" && what === "records") { renderEdit($("page"), rt.id); return; }
  render(what);
});

/* ---------- auth ---------- */
function showGate(error) {
  $("home").hidden = true;
  $("page").hidden = true;
  const btn = h("button", { class: "btn gbtn", type: "button", id: "signin" });
  btn.innerHTML = `${GOOGLE_ICON}<span>Увійти через Google</span>`;
  btn.addEventListener("click", signIn);
  put($("gate"), 
    h("div", { class: "eyebrow", text: "Медична картка" }),
    h("h1", { text: "Медкартка" }),
    h("p", { text: "Доступ лише для власника." }),
    h("div", null, btn),
    error ? h("p", { class: "err", role: "alert", text: error }) : null);
  $("gate").hidden = false;
}

function showDenied() {
  $("home").hidden = true;
  $("page").hidden = true;
  put($("gate"),
    h("div", { class: "eyebrow", text: "Медкартка" }),
    h("h1", { text: "Немає доступу" }),
    h("p", { text: `Акаунт ${S.user?.email || ""} не має доступу до цієї сторінки.` }),
    h("div", { class: "actions" }, h("button", { class: "btn ghost small", type: "button", id: "denied-out", text: "Вийти", onclick: () => signOut(fb.auth) })));
  $("gate").hidden = false;
}

// Лише вікно входу (popup), як у трекерах. Перехід на сторінку входу (redirect) не працює в Safari й iOS:
// вони ізолюють сховище firebaseapp.com від github.io, і після входу сторінка показує «missing initial state».
let signingIn = false;
async function signIn(e) {
  if (signingIn) return; // подвійне натискання не запускає другий вхід
  signingIn = true;
  const btn = e?.currentTarget;
  if (btn) btn.disabled = true;
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await signInWithPopup(fb.auth, provider);
  } catch (err) {
    const code = err?.code || "";
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") showGate();
    else if (code === "auth/popup-blocked") showGate("Браузер не відкрив вікно входу. Натисни «Увійти через Google» ще раз.");
    else if (code === "auth/operation-not-supported-in-this-environment" || code === "auth/web-storage-unsupported") {
      showGate("Тут вхід не працює. Відкрий сторінку в Safari або Chrome (не у вбудованому браузері Telegram чи Instagram).");
    } else if (code === "auth/unauthorized-domain") showGate("Цей домен ще не додано в Firebase Authentication → Settings → Authorized domains.");
    else if (code === "auth/network-request-failed") showGate("Немає зв'язку. Перевір інтернет і спробуй ще раз.");
    else showGate("Не вдалося увійти. Спробуй ще раз.");
  } finally {
    signingIn = false;
    if (btn?.isConnected) btn.disabled = false;
  }
}

function setupHeader(user) {
  $("signout").onclick = () => signOut(fb.auth);
  // На сторінці іншої людини (профіль із назвою) показуємо її ім'я, а не того, хто увійшов.
  const name = PROFILE.title || user.displayName || user.email || "";
  $("who").textContent = name;
  const initials = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  $("avatar").textContent = initials || "•";
}

async function boot() {
  initLightbox();
  try {
    initFirebase();
  } catch {
    showGate("Не вдалося підключитися. Онови сторінку.");
    return;
  }
  onAuthStateChanged(fb.auth, (user) => {
    S.user = user;
    if (!user) {
      unsubscribe();
      showGate();
      return;
    }
    setupHeader(user);
    subscribe();
    render();
  });
}

boot();
