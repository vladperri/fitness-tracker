// Firebase для «Моя Audi A6 C7»: вхід через Google і Firestore з кешем на пристрої.
// Віддає app.js подію "audi:auth" з { user, db }, де db має простий інтерфейс:
// collection(name).onSnapshot / .doc(id).set, doc('a/b').set|update|delete|onSnapshot, batchSet([[path, data]]).
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut,
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, writeBatch,
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";
import { FIREBASE_CONFIG, ROOT } from "./config.js";

// Окреме ім'я застосунку, щоб вхід і кеш не перетиналися з трекерами на тому самому домені.
const app = initializeApp(FIREBASE_CONFIG, "audi-a6");
const auth = getAuth(app);
let db;
try {
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
} catch {
  db = initializeFirestore(app, {});
}

// Firestore не приймає undefined; JSON прибирає такі поля й лишає null.
const clean = (v) => JSON.parse(JSON.stringify(v));
const meta = (m) => ({ fromCache: m.fromCache, hasPendingWrites: m.hasPendingWrites });
const qsnap = (s) => ({ metadata: meta(s.metadata), docs: s.docs.map((d) => ({ id: d.id, data: () => d.data() })) });
const dsnap = (s) => ({ id: s.id, exists: s.exists(), data: () => s.data(), metadata: meta(s.metadata) });

function docApi(ref) {
  return {
    set: (d) => setDoc(ref, clean(d)),
    update: (d) => updateDoc(ref, clean(d)),
    delete: () => deleteDoc(ref),
    onSnapshot: (next, err) => onSnapshot(ref, { includeMetadataChanges: true }, (s) => next(dsnap(s)), err),
  };
}

function adapter(uid) {
  const base = [ROOT, uid];
  const at = (path) => doc(db, ...base, ...path.split("/"));
  return {
    collection(name) {
      const ref = collection(db, ...base, name);
      return {
        doc: (id) => docApi(doc(ref, id)),
        onSnapshot: (next, err) => onSnapshot(ref, { includeMetadataChanges: true }, (s) => next(qsnap(s)), err),
      };
    },
    doc: (path) => docApi(at(path)),
    async batchSet(entries) {
      // Firestore дозволяє до 500 операцій в одному пакеті.
      for (let i = 0; i < entries.length; i += 450) {
        const b = writeBatch(db);
        entries.slice(i, i + 450).forEach(([path, data]) => b.set(at(path), clean(data)));
        await b.commit();
      }
    },
  };
}

function emit(state) {
  window.__audiAuth = state;
  window.dispatchEvent(new CustomEvent("audi:auth", { detail: state }));
}

window.AudiAuth = {
  async signIn() {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      const code = e && e.code;
      if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
        return signInWithRedirect(auth, provider);
      }
      throw e;
    }
  },
  signOut: () => signOut(auth),
};

onAuthStateChanged(auth, (u) => {
  emit(u ? { user: { email: u.email, name: u.displayName, photo: u.photoURL }, db: adapter(u.uid) } : { user: null, db: null });
});
