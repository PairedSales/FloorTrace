import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

// `getDB` memoises its open promise. The hazard is memoising a *rejection*:
// one transient failure — a version-change block from another tab, a storage
// hiccup, a private-mode quirk — would otherwise downgrade the rest of the
// session to the synchronous localStorage fallback, which cannot hold a
// multi-MB image and silently costs the user their draft.

const loadFresh = async () => {
  vi.resetModules();
  return import('../draftStorage.js');
};

// Minimal IDB stub: `openBehaviour` decides whether each open succeeds.
const installIndexedDB = (openBehaviour) => {
  const store = new Map();
  globalThis.indexedDB = {
    open() {
      const request = { onupgradeneeded: null, onsuccess: null, onerror: null };
      queueMicrotask(() => {
        if (openBehaviour() === 'fail') {
          request.error = new Error('open failed');
          request.onerror?.({ target: request });
          return;
        }
        const objectStore = {
          get: (key) => {
            const r = { result: store.get(key), onsuccess: null, onerror: null };
            queueMicrotask(() => r.onsuccess?.());
            return r;
          },
          put: (value, key) => { store.set(key, value); return {}; },
          delete: (key) => { store.delete(key); return {}; },
        };
        const tx = {
          objectStore: () => objectStore,
          oncomplete: null, onerror: null, onabort: null,
        };
        const db = {
          objectStoreNames: { contains: () => true },
          createObjectStore: () => objectStore,
          transaction: () => {
            queueMicrotask(() => tx.oncomplete?.());
            return tx;
          },
        };
        request.result = db;
        request.onsuccess?.({ target: request });
      });
      return request;
    },
  };
  return store;
};

describe('draftStorage getDB', () => {
  let warn;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    globalThis.localStorage = {
      _v: new Map(),
      getItem(k) { return this._v.has(k) ? this._v.get(k) : null; },
      setItem(k, v) { this._v.set(k, v); },
      removeItem(k) { this._v.delete(k); },
    };
  });

  afterEach(() => {
    warn.mockRestore();
    delete globalThis.indexedDB;
    delete globalThis.localStorage;
  });

  it('recovers on the next call after a transient open failure', async () => {
    let attempt = 0;
    // Only the first open fails.
    const store = installIndexedDB(() => (++attempt === 1 ? 'fail' : 'ok'));
    const { setDraft, getDraft } = await loadFresh();

    // First write falls back to localStorage — that is the degraded path, and
    // it is allowed to happen once.
    await setDraft('k', { state: { a: 1 } }, null, false);
    expect(store.size).toBe(0);

    // The next write must reach IndexedDB rather than inherit the rejection.
    await setDraft('k', { state: { a: 2 } }, null, false);
    expect(store.get('k')).toEqual({ state: { a: 2 } });

    const back = await getDraft('k');
    expect(back).toEqual({ state: { a: 2 } });
  });

  it('still serves from localStorage while IndexedDB keeps failing', async () => {
    const store = installIndexedDB(() => 'fail');
    const { setDraft, getDraft } = await loadFresh();

    await setDraft('k', { state: { a: 1 } }, null, false);
    expect(store.size).toBe(0);
    expect(await getDraft('k')).toEqual({ state: { a: 1 } });
  });
});

// ---------------------------------------------------------------------------
// An open that settles neither way
// ---------------------------------------------------------------------------

describe('getDB when the open never answers', () => {
  let warn;
  beforeEach(() => {
    vi.useFakeTimers();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    globalThis.localStorage = {
      _v: new Map(),
      getItem(k) { return this._v.has(k) ? this._v.get(k) : null; },
      setItem(k, v) { this._v.set(k, v); },
      removeItem(k) { this._v.delete(k); },
    };
  });
  afterEach(() => {
    vi.useRealTimers();
    warn.mockRestore();
    delete globalThis.indexedDB;
    delete globalThis.localStorage;
  });

  /** An `indexedDB.open` that fires no event at all, or only `onblocked`. */
  const installSilentIndexedDB = ({ blocked = false } = {}) => {
    globalThis.indexedDB = {
      open() {
        const request = {
          onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null,
        };
        if (blocked) queueMicrotask(() => request.onblocked?.({ target: request }));
        return request;
      },
    };
  };

  // Every read at startup awaits this promise, and `_hasRestoredState` is set
  // downstream of all of them. A pending open does not throw and does not
  // retry: the restore simply never returns, autosave is gated off for the
  // session, and the status bar goes on saying the draft is saved.
  it('rejects rather than hanging forever', async () => {
    installSilentIndexedDB();
    const { getDraft } = await loadFresh();

    const pending = getDraft('anything');
    await vi.advanceTimersByTimeAsync(11000);

    // Falls back to localStorage rather than never settling.
    await expect(pending).resolves.toBeNull();
  });

  it('rejects when another tab is blocking the open', async () => {
    installSilentIndexedDB({ blocked: true });
    const { getDraft } = await loadFresh();
    await expect(getDraft('anything')).resolves.toBeNull();
  });
});
