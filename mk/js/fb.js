// Підключення Firebase (проєкт трекерів). Окреме ім'я застосунку, щоб вхід і кеш медкартки
// не перетиналися з трекерами на тому самому сайті.
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut,
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, query, orderBy, onSnapshot,
  getDoc, getDocFromCache, setDoc, updateDoc, deleteDoc, serverTimestamp, Bytes,
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";
import { FIREBASE_CONFIG } from "./config.js";

export const fb = { app: null, auth: null, db: null };

export function initFirebase() {
  fb.app = initializeApp(FIREBASE_CONFIG, "medkartka");
  fb.auth = getAuth(fb.app);
  try {
    // Кеш на пристрої: записи й фото відкриваються швидко й рахуються в безкоштовні ліміти лише раз.
    fb.db = initializeFirestore(fb.app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager(), cacheSizeBytes: 200 * 1024 * 1024 }),
    });
  } catch {
    fb.db = initializeFirestore(fb.app, {});
  }
  return fb;
}

export {
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut,
  collection, doc, query, orderBy, onSnapshot, getDoc, getDocFromCache, setDoc, updateDoc, deleteDoc, serverTimestamp, Bytes,
};
