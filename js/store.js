// Datalag med to motorer:
//  - "cloud": Firebase Auth + Firestore (synk mellom enheter og brukere, offline-støtte)
//  - "local": IndexedDB i nettleseren (når firebase-config.js ikke er fylt ut)
import { firebaseConfig } from './firebase-config.js';
import { DEFAULT_SETTINGS } from './calc.js';
import { num } from './util.js';

const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
export const COLLS = ['settings', 'printers', 'materials', 'products', 'supplies', 'packages', 'movements', 'members',
  'events', 'eventStock', 'eventCosts', 'sales', 'orders'];

// Testmodus: på localhost brukes alltid en lokal testdatabase (ikke Firebase), med mindre ?sky er satt.
const DEV_HOST = ['localhost', '127.0.0.1'].includes(location.hostname);
const FORCE_CLOUD = new URLSearchParams(location.search).has('sky');
export const TEST_MODE = DEV_HOST && !FORCE_CLOUD;
const emptyCache = () => Object.fromEntries(COLLS.map(c => [c, new Map()]));
let cache = emptyCache();
const listeners = new Set();
let be = null;

export const state = {
  mode: firebaseConfig && firebaseConfig.apiKey && !TEST_MODE ? 'cloud' : 'local',
  user: null, member: null, ready: false, authReady: false, error: null, needsVerify: false,
};
export const auth = {};

export function emit() { listeners.forEach(f => { try { f(); } catch (e) { console.error(e); } }); }
export function subscribe(f) { listeners.add(f); return () => listeners.delete(f); }
export const list = c => [...cache[c].values()];
export const get = (c, id) => (id ? cache[c].get(id) : undefined);
export const settings = () => ({ ...DEFAULT_SETTINGS, ...(cache.settings.get('general') || {}) });
export const userEmail = () => state.user?.email || 'ukjent';
export const isAdmin = () => state.member?.role === 'admin';

// ops: [{t:'set'|'upd'|'del'|'inc', c, id, d, f, v}]
export const write = (ops, opts = {}) => be.write(ops, opts);
export const fetchAll = c => be.fetchAll(c);
export const images = {
  byItem: id => be.img.byItem(id),
  put: d => be.img.put(d),
  del: id => be.img.del(id),
  all: () => be.img.all(),
  delAll: () => be.img.delAll(),
};

export async function init() {
  try {
    be = state.mode === 'cloud' ? await cloud() : await local();
  } catch (e) {
    console.error(e);
    state.error = 'Klarte ikke å starte databasen: ' + (e.message || e);
    state.authReady = true;
    emit();
  }
}

function clean(d) {
  const o = {};
  for (const [k, v] of Object.entries(d || {})) {
    if (k === 'id' || v === undefined) continue;
    o[k] = v;
  }
  return o;
}

/* ---------------- Lokal motor (IndexedDB) ---------------- */
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = tx => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });

async function local() {
  const open = indexedDB.open('print3d-local', 1);
  open.onupgradeneeded = () => {
    const db = open.result;
    db.createObjectStore('docs', { keyPath: 'key' });
    db.createObjectStore('images', { keyPath: 'id' }).createIndex('itemId', 'itemId');
  };
  const db = await req(open);
  const rows = await req(db.transaction('docs').objectStore('docs').getAll());
  for (const r of rows) cache[r.c]?.set(r.id, { ...r.d, id: r.id });
  state.user = { email: 'lokal', name: 'Lokal bruker' };
  state.member = { role: 'admin' };
  state.authReady = true;
  state.ready = true;
  emit();
  const imgs = m => db.transaction('images', m).objectStore('images');
  return {
    async write(ops) {
      const tx = db.transaction('docs', 'readwrite');
      const st = tx.objectStore('docs');
      for (const o of ops) {
        const key = o.c + '|' + o.id;
        const cur = cache[o.c].get(o.id);
        if (o.t === 'del') { st.delete(key); cache[o.c].delete(o.id); continue; }
        let next;
        if (o.t === 'set') next = clean(o.d);
        else if (o.t === 'upd') next = { ...clean(cur), ...clean(o.d) };
        else if (o.t === 'inc') next = { ...clean(cur), [o.f]: Math.round((num(cur?.[o.f]) + o.v) * 1000) / 1000 };
        st.put({ key, c: o.c, id: o.id, d: next });
        cache[o.c].set(o.id, { ...next, id: o.id });
      }
      await done(tx);
      emit();
    },
    async fetchAll(c) { return list(c); },
    img: {
      byItem: id => req(imgs('readonly').index('itemId').getAll(id)),
      put: async d => { const tx = db.transaction('images', 'readwrite'); tx.objectStore('images').put(d); await done(tx); },
      del: async id => { const tx = db.transaction('images', 'readwrite'); tx.objectStore('images').delete(id); await done(tx); },
      all: () => req(imgs('readonly').getAll()),
      delAll: async () => { const tx = db.transaction('images', 'readwrite'); tx.objectStore('images').clear(); await done(tx); },
    },
  };
}

/* ---------------- Sky-motor (Firebase) ---------------- */
async function cloud() {
  const [App, A, F] = await Promise.all([
    import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js'),
  ]);
  const app = App.initializeApp(firebaseConfig);
  const au = A.getAuth(app);
  let fs;
  try {
    fs = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
  } catch (e) {
    console.warn('Offline-cache ikke tilgjengelig', e);
    fs = F.getFirestore(app);
  }
  const ref = (c, id) => F.doc(fs, c, id);
  let unsubs = [];

  Object.assign(auth, {
    async google() {
      const p = new A.GoogleAuthProvider();
      p.setCustomParameters({ prompt: 'select_account' });
      try {
        await A.signInWithPopup(au, p);
      } catch (e) {
        if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(e.code)) {
          await A.signInWithRedirect(au, p);
        } else throw e;
      }
    },
    email: (e, p) => A.signInWithEmailAndPassword(au, e, p),
    async signup(e, p) {
      const c = await A.createUserWithEmailAndPassword(au, e, p);
      await A.sendEmailVerification(c.user);
    },
    reset: e => A.sendPasswordResetEmail(au, e),
    resendVerify: () => au.currentUser && A.sendEmailVerification(au.currentUser),
    async reload() {
      if (!au.currentUser) return;
      await au.currentUser.reload();
      await au.currentUser.getIdToken(true);
      await handle(au.currentUser);
    },
    logout: () => A.signOut(au),
    async ownerExists() {
      try { return (await F.getDoc(ref('meta', 'owner'))).exists(); } catch { return true; }
    },
    async bootstrap() {
      const email = state.user.email;
      const b = F.writeBatch(fs);
      b.set(ref('meta', 'owner'), { email, at: Date.now() });
      b.set(ref('members', email), { role: 'admin', name: state.user.name || '', addedAt: Date.now(), addedBy: email });
      await b.commit();
      await handle(au.currentUser);
    },
  });

  async function handle(u) {
    unsubs.forEach(f => f());
    unsubs = [];
    cache = emptyCache();
    state.user = u ? { email: (u.email || '').toLowerCase(), name: u.displayName || u.email, uid: u.uid } : null;
    Object.assign(state, { member: null, ready: false, error: null, needsVerify: false, authReady: true });
    if (u) {
      const pw = u.providerData.some(p => p.providerId === 'password');
      if (pw && !u.emailVerified) { state.needsVerify = true; emit(); return; }
      try {
        const m = await F.getDoc(ref('members', state.user.email));
        if (m.exists()) { state.member = m.data(); start(); } else state.error = 'noaccess';
      } catch (e) {
        state.error = e.code === 'permission-denied' ? 'noaccess' : 'Feil ved innlogging: ' + e.message;
      }
    }
    emit();
  }

  function start() {
    const loaded = new Set();
    for (const c of COLLS) {
      const q = c === 'movements'
        ? F.query(F.collection(fs, c), F.orderBy('ts', 'desc'), F.limit(500))
        : F.collection(fs, c);
      unsubs.push(F.onSnapshot(q, snap => {
        const m = new Map();
        snap.forEach(d => m.set(d.id, { ...d.data(), id: d.id }));
        cache[c] = m;
        loaded.add(c);
        if (loaded.size >= COLLS.length) state.ready = true;
        emit();
      }, err => {
        console.error(c, err);
        state.error = `Databasefeil (${c}): ${err.message}`;
        emit();
      }));
    }
  }

  A.onAuthStateChanged(au, handle);
  A.getRedirectResult(au).catch(e => console.warn(e));

  const all = async c => (await F.getDocs(F.collection(fs, c))).docs.map(d => ({ ...d.data(), id: d.id }));
  return {
    write(ops, opts) {
      const commits = [];
      for (let i = 0; i < ops.length; i += 400) {
        const b = F.writeBatch(fs);
        for (const o of ops.slice(i, i + 400)) {
          const r = ref(o.c, o.id);
          if (o.t === 'set') b.set(r, clean(o.d));
          else if (o.t === 'upd') b.set(r, clean(o.d), { merge: true });
          else if (o.t === 'del') b.delete(r);
          else if (o.t === 'inc') b.set(r, { [o.f]: F.increment(o.v) }, { merge: true });
        }
        commits.push(b.commit());
      }
      const all = Promise.all(commits);
      // Uten venting: skrivingen vises lokalt med en gang og synkes når nett er tilgjengelig.
      all.catch(e => { console.error(e); window.dispatchEvent(new CustomEvent('store-error', { detail: e.message })); });
      return opts.wait ? all : Promise.resolve();
    },
    fetchAll: all,
    img: {
      byItem: async id => (await F.getDocs(F.query(F.collection(fs, 'images'), F.where('itemId', '==', id)))).docs.map(d => ({ ...d.data(), id: d.id })),
      put: d => F.setDoc(ref('images', d.id), clean(d)),
      del: id => F.deleteDoc(ref('images', id)),
      all: () => all('images'),
      async delAll() {
        const docs = (await F.getDocs(F.collection(fs, 'images'))).docs;
        for (let i = 0; i < docs.length; i += 400) {
          const b = F.writeBatch(fs);
          docs.slice(i, i + 400).forEach(d => b.delete(d.ref));
          await b.commit();
        }
      },
    },
  };
}
