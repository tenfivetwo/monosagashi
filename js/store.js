// 登録した品物の保存（端末の中の IndexedDB）

const DB_NAME = 'monosagashi';
const STORE = 'items';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(result.result); };
    t.onerror = () => { db.close(); reject(t.error); };
    t.onabort = () => { db.close(); reject(t.error); };
  });
}

export function listItems() {
  return tx('readonly', (s) => s.getAll()).then((rows) => rows.sort((a, b) => b.createdAt - a.createdAt));
}
export function getItem(id) { return tx('readonly', (s) => s.get(id)); }
export function saveItem(item) { return tx('readwrite', (s) => s.put(item)); }
export function deleteItem(id) { return tx('readwrite', (s) => s.delete(id)); }
