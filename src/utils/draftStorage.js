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
  // Memoise the *connection*, not a failure. A rejected promise cached here
  // was permanent: every later `getDB` returned the same rejection, so one
  // transient open failure — a version-change block from another tab, a
  // storage hiccup, a private-mode quirk — downgraded the rest of the session
  // to the synchronous localStorage fallback, which cannot hold a multi-MB
  // image and silently costs the user their draft. Dropping the handle on
  // rejection makes the next write retry instead.
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

const imageKeyFor = (key, hash) => `${key}::image::${hash}`;

/**
 * Saves draft data to IndexedDB. Falls back to localStorage if IndexedDB fails.
 *
 * The image is stored as its own record rather than inside the draft, because
 * `put` is a whole-record overwrite: with the base64 data URL inline, a pure
 * pan or zoom rewrote the entire image to disk. On the largest fixture the
 * image is 770 kB of a 789 kB payload — 97.6% of every debounced write, at a
 * rate of one per pause in interaction.
 *
 * `imageChanged` false leaves the existing image record untouched. Both records
 * go through one `readwrite` transaction, so a draft can never be half-written.
 *
 * @param {string} key
 * @param {any} data document state, with `image` omitted
 * @param {{ hash: string, dataUrl: string }} image
 * @param {boolean} imageChanged
 * @returns {Promise<void>}
 */
export async function setDraft(key, data, image, imageChanged) {
  const imageKey = image ? imageKeyFor(key, image.hash) : null;
  const record = imageKey ? { ...data, imageKey } : data;
  try {
    const db = await getDB();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      // The image key carries the image's hash, so editing the image writes a
      // new record. Drop the record the previous draft pointed at in the same
      // transaction, or every crop leaves an orphaned copy behind forever.
      const existing = store.get(key);
      existing.onsuccess = () => {
        const previousKey = existing.result?.imageKey;
        if (previousKey && previousKey !== imageKey) store.delete(previousKey);
        store.put(record, key);
        if (imageKey && imageChanged) store.put(image.dataUrl, imageKey);
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch (error) {
    console.warn('IndexedDB setDraft failed, falling back to localStorage:', error);
    // No transaction and no second record here, so the fallback writes the
    // combined payload. A state record with no image is one `restoreFromSaved`
    // rejects outright — the split must not turn a degraded path into a lost
    // draft.
    const combined = image
      ? { ...data, state: { ...data.state, image: image.dataUrl } }
      : data;
    delete combined.imageKey;
    localStorage.setItem(key, JSON.stringify(combined));
  }
}

/**
 * Retrieves draft data from IndexedDB. If not found in IndexedDB, check if there's
 * a legacy draft in localStorage, parse it, and return it.
 *
 * Recombines the split image record. Drafts written before the split have the
 * image inline and no `imageKey`, so they still restore unchanged.
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
          if (!val?.imageKey) {
            resolve(val);
            return;
          }
          const imageRequest = store.get(val.imageKey);
          imageRequest.onsuccess = () => {
            const { imageKey: _unused, ...rest } = val;
            resolve(imageRequest.result
              ? { ...rest, state: { ...rest.state, image: imageRequest.result } }
              : rest);
          };
          // A missing image record leaves a draft `restoreFromSaved` rejects,
          // which is the same outcome as no draft — never a wrong one.
          imageRequest.onerror = () => resolve(null);
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
      // Take the image record with it — it is the large half.
      const existing = store.get(key);
      existing.onsuccess = () => {
        if (existing.result?.imageKey) store.delete(existing.result.imageKey);
        store.delete(key);
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch (error) {
    console.warn('IndexedDB removeDraft failed:', error);
  }
  localStorage.removeItem(key);
}
