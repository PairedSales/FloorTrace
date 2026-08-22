// Long enough that a cold open on a slow disk is never cut short, short enough
// that a browser which will never answer cannot hold startup indefinitely.
const OPEN_TIMEOUT_MS = 10000;

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
    // An open can settle neither way. `onblocked` fires when another tab holds
    // an older version open, and there are browser states that fire nothing at
    // all — and the promise below is awaited by every read the app performs at
    // startup. A pending promise here does not throw and does not retry: the
    // restore simply never returns, `_hasRestoredState` is never set, and every
    // write in the hook is gated off for the rest of the session while the
    // status bar goes on saying the draft is saved. That is a hang, and it was
    // indistinguishable from one.
    let settled = false;
    const settle = (fn) => (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const fail = settle(reject);
    const timer = setTimeout(
      () => fail(new Error('IndexedDB open timed out')),
      OPEN_TIMEOUT_MS,
    );

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = (event) => settle(resolve)(event.target.result);
    request.onerror = (event) => fail(event.target.error);
    request.onblocked = () => fail(new Error('IndexedDB open blocked by another tab'));
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
 * Whether a storage failure means "out of room" rather than "broken".
 * Checked by name and by legacy code because browsers disagree: Firefox has
 * historically thrown code 1014 under a different name.
 */
export const isQuotaError = (error) => (
  error?.name === 'QuotaExceededError'
  || error?.name === 'NS_ERROR_DOM_QUOTA_REACHED'
  || error?.code === 22
  || error?.code === 1014
);

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
    // Quota is the one failure the fallback cannot help with: localStorage is
    // roughly a tenth the size, so writing there is guaranteed to fail too —
    // and the attempt costs a synchronous serialisation of a multi-MB payload
    // on the main thread before it does. Reported so a caller can shed load and
    // tell the user, rather than swallowed as a fallback that never worked.
    if (isQuotaError(error)) throw error;
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
      // The write paths guard the transaction; this one did not, and it resolves
      // from inside nested handlers. An exception thrown in an IDB callback does
      // not abort the transaction and cannot reach the `try` below — the
      // executor returned long ago — so it left a promise that never settled,
      // on the path every startup read takes. `store.get` on a connection that
      // went away and `localStorage.getItem` under blocked site data both throw
      // exactly there.
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
      const request = store.get(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
       try {
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
       } catch (error) {
         reject(error);
       }
      };
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
 * Every key the store holds.
 *
 * Exists so a workspace whose session is gone can be found again. Nothing could
 * enumerate before, so a dead session's plans — images included — were
 * unreachable *and* undeletable: the index that named them was keyed by a
 * `sessionStorage` id that died with the browser, and no other record pointed
 * at them. They accumulated toward the quota with nothing able to sweep them
 * and nothing able to give them back.
 *
 * @returns {Promise<string[]>}
 */
export async function listDraftKeys() {
  try {
    const db = await getDB();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).getAllKeys();
      request.onsuccess = () => resolve(request.result.map(String));
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn('IndexedDB listDraftKeys failed:', error);
    return [];
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
