// A tiny key-value store on IndexedDB (database 'promethea', store 'kv') for
// data too big for localStorage, such as saved stock price history.
//
// If IndexedDB is missing or refuses to work (some private-browsing modes),
// values are kept in memory for this tab instead, without any error.

const DB_NAME = 'promethea';
const STORE = 'kv';
const OPEN_TIMEOUT_MS = 4_000;

const mem = new Map();      // fallback values (and values whose IndexedDB write failed)
let dbPromise = null;
let unavailable = false;

function openDb() {
  if (unavailable) return Promise.resolve(null);
  dbPromise ??= new Promise((resolve) => {
    let settled = false;
    const done = (db) => { if (!settled) { settled = true; resolve(db); } else db?.close?.(); };
    // Some browsers never answer the open request in private mode.
    const timer = setTimeout(() => done(null), OPEN_TIMEOUT_MS);
    try {
      const idb = globalThis.indexedDB;
      if (!idb?.open) { clearTimeout(timer); done(null); return; }
      const req = idb.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        try { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); } catch { /* reported by onerror */ }
      };
      req.onsuccess = () => {
        clearTimeout(timer);
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) { db.close(); done(null); return; }
        // Another tab upgrading the database: let go so it is not blocked.
        db.onversionchange = () => { db.close(); dbPromise = null; };
        db.onclose = () => { dbPromise = null; };
        done(db);
      };
      req.onerror = () => { clearTimeout(timer); done(null); };
      req.onblocked = () => { clearTimeout(timer); done(null); };
    } catch {
      clearTimeout(timer);
      done(null);
    }
  }).then((db) => {
    if (!db) { unavailable = true; dbPromise = null; }
    return db;
  });
  return dbPromise;
}

function run(mode, op) {
  return openDb().then((db) => {
    if (!db) throw new Error('IndexedDB unavailable');
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = op(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? req.error);
      tx.onabort = () => reject(tx.error ?? req.error);
    });
  });
}

const copy = (v) => {
  try { return typeof structuredClone === 'function' ? structuredClone(v) : v; } catch { return v; }
};

export async function idbGet(key) {
  if (mem.has(key)) return copy(mem.get(key));
  try {
    const v = await run('readonly', (s) => s.get(key));
    return v === undefined ? null : v;
  } catch {
    return null;
  }
}

export async function idbSet(key, value) {
  try {
    await run('readwrite', (s) => s.put(value, key));
    mem.delete(key);
  } catch {
    mem.set(key, copy(value)); // storage full, private mode or no IndexedDB: keep it for this tab
  }
}

export async function idbDel(key) {
  mem.delete(key);
  try { await run('readwrite', (s) => s.delete(key)); } catch { /* nothing stored there */ }
}
