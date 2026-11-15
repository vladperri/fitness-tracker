// Налаштування. Конфіг Firebase той самий, що в трекерах (він публічний за задумом:
// доступ до даних обмежують правила Firestore, а не секретність цих ключів).
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBtG3NAe-Eu9m2OuKLYt63zJjCBzMq9VF4",
  authDomain: "fitness-tracker-7ef81.firebaseapp.com",
  projectId: "fitness-tracker-7ef81",
  storageBucket: "fitness-tracker-7ef81.firebasestorage.app",
  messagingSenderId: "975830615739",
  appId: "1:975830615739:web:16a311c1bbfc2428bc8b9e",
};

// Адреса воркера Cloudflare, що передає запити в Claude з ключем Anthropic.
export const AI_URL = "https://mk-ai.wlad-semenyuk97.workers.dev";

// Модель для розпізнавання документів.
export const MODEL = "claude-sonnet-5-5";

// Профілі: одна й та сама сторінка для кількох людей, у кожного свій розділ у базі.
// Профіль задає атрибут data-profile на <html> (mk/oksana/index.html → "oksana").
// gen і dat — ім'я в родовому й давальному відмінку для промптів Claude.
export const PROFILES = {
  vlad: { root: ["medkartka", "data"], title: "", gen: "Влада", dat: "Владу", import: true },
  oksana: { root: ["medkartka", "oksana"], title: "Оксана", gen: "Оксани", dat: "Оксані", import: false },
};
const pid = (typeof document !== "undefined" && document.documentElement.dataset.profile) || "vlad";
export const PROFILE = { id: PROFILES[pid] ? pid : "vlad", ...(PROFILES[pid] || PROFILES.vlad) };
