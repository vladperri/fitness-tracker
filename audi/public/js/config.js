// Конфіг Firebase — той самий проєкт, що й трекери та медкартка (fitness-tracker-7ef81).
// Ключі веб-застосунку публічні за задумом: доступ до даних обмежують правила Firestore.
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBtG3NAe-Eu9m2OuKLYt63zJjCBzMq9VF4",
  authDomain: "fitness-tracker-7ef81.firebaseapp.com",
  projectId: "fitness-tracker-7ef81",
  storageBucket: "fitness-tracker-7ef81.firebasestorage.app",
  messagingSenderId: "975830615739",
  appId: "1:975830615739:web:16a311c1bbfc2428bc8b9e",
};

// Окремий розділ бази для цього застосунку: audi/{uid}/records, audi/{uid}/reminders, audi/{uid}/settings/main.
// Так дані авто не перетинаються з трекерами (users, workouts…) і медкарткою (medkartka).
export const ROOT = "audi";
