// IndexedDB を使った蔵書データの永続化（端末内のみ・サーバー同期なし）
const DB_NAME = "book-collection-db";
const DB_VERSION = 1;
const STORE = "books";

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("indexeddb-unsupported"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("isbn", "isbn", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
        store.createIndex("title", "title", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function isStorageAvailable() {
  try {
    await openDB();
    return true;
  } catch {
    return false;
  }
}

function tx(storeMode) {
  return openDB().then((db) => db.transaction(STORE, storeMode).objectStore(STORE));
}

export async function getAllBooks() {
  const store = await tx("readonly");
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function getBook(id) {
  const store = await tx("readonly");
  return new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function findByIsbn(isbn) {
  if (!isbn) return null;
  const all = await getAllBooks();
  return all.find((b) => b.isbn && b.isbn === isbn) || null;
}

export async function saveBook(book) {
  const store = await tx("readwrite");
  return new Promise((resolve, reject) => {
    const req = store.put(book);
    req.onsuccess = () => resolve(book);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteBook(id) {
  const store = await tx("readwrite");
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function bulkPut(books) {
  const store = await tx("readwrite");
  return new Promise((resolve, reject) => {
    let remaining = books.length;
    if (remaining === 0) { resolve(); return; }
    books.forEach((book) => {
      const req = store.put(book);
      req.onsuccess = () => {
        remaining -= 1;
        if (remaining === 0) resolve();
      };
      req.onerror = () => reject(req.error);
    });
  });
}

export function makeId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}
