const DB_NAME = 'floortrace-db';
const DB_VERSION = 1;
const STORE_NAME = 'drafts';

let dbPromise = null;

/**
 * Gets a Promise that resolves to the opened IndexedDB database.
 */
function getDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not supported'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = (event) => {
      resolve(event.target.result);
    };
    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
  return dbPromise;
}

/**
 * Saves draft data to IndexedDB. Falls back to localStorage if IndexedDB fails.
 *
 * @param {string} key
 * @param {any} data
 * @returns {Promise<void>}
 */
export async function setDraft(key, data) {
  try {
    const db = await getDB();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(data, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn('IndexedDB setDraft failed, falling back to localStorage:', error);
    localStorage.setItem(key, JSON.stringify(data));
  }
}

/**
 * Retrieves draft data from IndexedDB. If not found in IndexedDB, check if there's
 * a legacy draft in localStorage, parse it, and return it.
 *
 * @param {string} key
 * @returns {Promise<any>}
 */
export async function getDraft(key) {
  try {
    const db = await getDB();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => {
        const val = request.result;
        if (val !== undefined) {
          resolve(val);
        } else {
          // If not found in IndexedDB, check and migrate from localStorage
          const localVal = localStorage.getItem(key);
          if (localVal) {
            try {
              const parsed = JSON.parse(localVal);
              resolve(parsed);
            } catch {
              resolve(null);
            }
          } else {
            resolve(null);
          }
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn('IndexedDB getDraft failed, falling back to localStorage:', error);
    const localVal = localStorage.getItem(key);
    if (localVal) {
      try {
        return JSON.parse(localVal);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Deletes a draft from both IndexedDB and localStorage.
 *
 * @param {string} key
 * @returns {Promise<void>}
 */
export async function removeDraft(key) {
  try {
    const db = await getDB();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn('IndexedDB removeDraft failed:', error);
  }
  localStorage.removeItem(key);
}
