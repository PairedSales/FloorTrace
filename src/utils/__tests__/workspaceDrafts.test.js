import { describe, expect, it, beforeEach, vi } from 'vitest';
import { COLLIDE_A, COLLIDE_B } from './collidingDataUrls';
import { hashDataUrl } from '../hash';

// Same minimal IDB stub shape the draftStorage tests use: a Map behind an
// object store, so the assertions are about which records exist and what they
// point at rather than about IndexedDB itself.
const installIndexedDB = () => {
  const store = new Map();
  globalThis.indexedDB = {
    open() {
      const request = { onupgradeneeded: null, onsuccess: null, onerror: null };
      queueMicrotask(() => {
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
        request.result = {
          objectStoreNames: { contains: () => true },
          createObjectStore: () => objectStore,
          transaction: () => {
            queueMicrotask(() => tx.oncomplete?.());
            return tx;
          },
        };
        request.onsuccess?.({ target: request });
      });
      return request;
    },
  };
  return store;
};

const loadFresh = async () => {
  vi.resetModules();
  return import('../workspaceDrafts.js');
};

let store;

beforeEach(() => {
  store = installIndexedDB();
  globalThis.window = {
    sessionStorage: {
      _v: new Map(),
      getItem(k) { return this._v.get(k) ?? null; },
      setItem(k, v) { this._v.set(k, v); },
    },
  };
  globalThis.localStorage = {
    _v: new Map(),
    getItem(k) { return this._v.get(k) ?? null; },
    setItem(k, v) { this._v.set(k, v); },
    removeItem(k) { this._v.delete(k); },
    key(i) { return [...this._v.keys()][i] ?? null; },
    get length() { return this._v.size; },
  };
});

describe('session identity', () => {
  // Two tabs of this app share localStorage and coordinate through nothing, so
  // a session id kept there would be one workspace fought over by both.
  it('keeps the session id out of localStorage', async () => {
    const ws = await loadFresh();
    ws.getSessionId();
    expect(globalThis.localStorage.length).toBe(0);
    expect(globalThis.window.sessionStorage.getItem('floortrace:session')).toBeTruthy();
  });

  it('reuses the id across module loads within a browser tab', async () => {
    const first = (await loadFresh()).getSessionId();
    const second = (await loadFresh()).getSessionId();
    expect(second).toBe(first);
  });
});

describe('per-plan records', () => {
  it('gives each plan its own image record', async () => {
    const ws = await loadFresh();
    await ws.writeDocDraft('doc-1', { image: COLLIDE_A, projectName: 'A' }, true);
    await ws.writeDocDraft('doc-2', { image: COLLIDE_B, projectName: 'B' }, true);

    const a = await ws.readDocDraft('doc-1');
    const b = await ws.readDocDraft('doc-2');
    expect(a.state.image).toBe(COLLIDE_A);
    expect(b.state.image).toBe(COLLIDE_B);
  });

  // Two plans opened from the same file hold the same picture, and hashDataUrl
  // folds an 8 kB prefix into 32 bits — this repo has already shipped a bug
  // where a shared image namespace served one plan another's pixels.
  it('does not let one plan’s image evict another’s when hashes collide', async () => {
    expect(hashDataUrl(COLLIDE_A)).toBe(hashDataUrl(COLLIDE_B));
    const ws = await loadFresh();

    await ws.writeDocDraft('doc-1', { image: COLLIDE_A }, true);
    await ws.writeDocDraft('doc-2', { image: COLLIDE_B }, true);

    expect((await ws.readDocDraft('doc-1')).state.image).toBe(COLLIDE_A);
    expect((await ws.readDocDraft('doc-2')).state.image).toBe(COLLIDE_B);
  });

  it('closing one plan leaves the other’s image intact', async () => {
    const ws = await loadFresh();
    await ws.writeDocDraft('doc-1', { image: COLLIDE_A }, true);
    await ws.writeDocDraft('doc-2', { image: COLLIDE_A }, true);

    await ws.removePlan('doc-1');

    expect((await ws.readDocDraft('doc-1')).status).toBe('missing');
    expect((await ws.readDocDraft('doc-2')).state.image).toBe(COLLIDE_A);
  });

  it('skips rewriting an unchanged image', async () => {
    const ws = await loadFresh();
    await ws.writeDocDraft('doc-1', { image: COLLIDE_A, projectName: 'first' }, true);
    const imageKeys = [...store.keys()].filter((k) => k.includes('::image::'));

    await ws.writeDocDraft('doc-1', { image: COLLIDE_A, projectName: 'second' }, false);

    expect([...store.keys()].filter((k) => k.includes('::image::'))).toEqual(imageKeys);
    expect((await ws.readDocDraft('doc-1')).state.projectName).toBe('second');
  });
});

describe('restore failures are told apart', () => {
  // These used to collapse into "no draft", which is indistinguishable from a
  // plan the user never had — and throws away traces and calibration that
  // survived perfectly well.
  it('reports a plan with no record as missing', async () => {
    const ws = await loadFresh();
    expect((await ws.readDocDraft('doc-nope')).status).toBe('missing');
  });

  it('reports a plan whose image record is gone, keeping the rest', async () => {
    const ws = await loadFresh();
    await ws.writeDocDraft('doc-1', { image: COLLIDE_A, projectName: 'kept' }, true);

    for (const key of [...store.keys()]) {
      if (key.includes('::image::')) store.delete(key);
    }

    const result = await ws.readDocDraft('doc-1');
    expect(result.status).toBe('no-image');
    expect(result.state.projectName).toBe('kept');
  });

  it('reports a malformed record without deleting it', async () => {
    const ws = await loadFresh();
    await ws.writeDocDraft('doc-1', { image: COLLIDE_A }, true);
    store.set(ws.docKey('doc-1'), { state: null });

    expect((await ws.readDocDraft('doc-1')).status).toBe('malformed');
    expect(store.has(ws.docKey('doc-1'))).toBe(true);
  });
});

describe('the index', () => {
  it('round-trips the open plans, their order and the active one', async () => {
    const ws = await loadFresh();
    const index = {
      order: ['doc-1', 'doc-2'],
      activeId: 'doc-2',
      docs: { 'doc-1': { title: 'A', hasWork: true }, 'doc-2': { title: 'B', hasWork: false } },
    };
    await ws.writeWorkspaceIndex(index);

    expect(await ws.readWorkspaceIndex()).toMatchObject({
      order: ['doc-1', 'doc-2'],
      activeId: 'doc-2',
    });
  });

  it('treats a record that is not an index as absent', async () => {
    const ws = await loadFresh();
    store.set(ws.workspaceKey(ws.getSessionId()), { nonsense: true });
    expect(await ws.readWorkspaceIndex()).toBeNull();
  });

  it('sweeps every plan the index names when the workspace is dropped', async () => {
    const ws = await loadFresh();
    await ws.writeDocDraft('doc-1', { image: COLLIDE_A }, true);
    await ws.writeDocDraft('doc-2', { image: COLLIDE_B }, true);
    await ws.writeHistoryRecord('doc-1', { undoStack: [1], redoStack: [], imagePool: [] });
    const index = { order: ['doc-1', 'doc-2'], activeId: 'doc-1', docs: {} };
    await ws.writeWorkspaceIndex(index);

    await ws.removeWorkspace(index);

    expect(await ws.readWorkspaceIndex()).toBeNull();
    expect((await ws.readDocDraft('doc-1')).status).toBe('missing');
    expect((await ws.readDocDraft('doc-2')).status).toBe('missing');
    expect(await ws.readHistoryRecord('doc-1')).toBeNull();
    expect([...store.keys()].filter((k) => k.includes('::image::'))).toEqual([]);
  });
});

describe('history records', () => {
  it('round-trips a plan’s stacks and pool separately from its state', async () => {
    const ws = await loadFresh();
    await ws.writeHistoryRecord('doc-1', {
      undoStack: [{ __imageRef: 'k1' }],
      redoStack: [],
      imagePool: new Map([['k1', COLLIDE_A]]),
    });

    const restored = await ws.readHistoryRecord('doc-1');
    expect(restored.undoStack).toHaveLength(1);
    expect(restored.imagePool).toEqual([['k1', COLLIDE_A]]);
  });

  it('reports no history rather than an empty one when none was written', async () => {
    const ws = await loadFresh();
    expect(await ws.readHistoryRecord('doc-1')).toBeNull();
  });
});
