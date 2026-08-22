// @vitest-environment happy-dom
//
// The workspace index is keyed by a `sessionStorage` id, so two tabs cannot
// fight over one — and so closing the browser stranded every plan in it. The
// records were still on disk and nothing could name them: unreachable *and*
// undeletable, one more workspace per restart.
//
// These cover the two halves of the answer: give an abandoned workspace back,
// and take out what nothing references — without ever touching a live tab's.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map();
vi.mock('../draftStorage', () => ({
  getDraft: vi.fn(async (k) => (store.has(k) ? store.get(k) : null)),
  setDraft: vi.fn(async (k, data) => { store.set(k, data); }),
  removeDraft: vi.fn(async (k) => { store.delete(k); }),
  listDraftKeys: vi.fn(async () => [...store.keys()]),
  isQuotaError: () => false,
}));

const { adoptAbandonedWorkspace, sweepOrphans, SWEEP_AFTER_MS } = await import('../workspaceDrafts');

const NOW = 1_700_000_000_000;
const wsKey = (sid) => `floortrace:workspace:v1:${sid}`;

const seedWorkspace = (sid, docIds, savedAt) => {
  store.set(wsKey(sid), { order: docIds, activeId: docIds[0], savedAt });
  for (const id of docIds) {
    store.set(`floortrace:doc:v1:${id}`, { state: { projectName: id } });
    store.set(`floortrace:doc:v1:${id}::image::h${id}`, 'data:image/png;base64,AAA');
    store.set(`floortrace:hist:v1:${id}`, { undoStack: [] });
  }
};

beforeEach(() => {
  store.clear();
  sessionStorage.clear();
  // No BroadcastChannel: exercise the age fallback deterministically.
  delete globalThis.BroadcastChannel;
});

describe('adoptAbandonedWorkspace', () => {
  it('gives back the workspace a closed browser left behind', async () => {
    seedWorkspace('dead', ['p1', 'p2'], NOW - 10 * 60 * 1000);
    const adopted = await adoptAbandonedWorkspace(NOW);
    expect(adopted?.order).toEqual(['p1', 'p2']);
    // Re-keyed under this session, and the stranded key gone — so the records
    // stop being garbage nothing can collect.
    expect(store.has(wsKey('dead'))).toBe(false);
    expect([...store.keys()].filter((k) => k.startsWith('floortrace:workspace:'))).toHaveLength(1);
  });

  it('takes the newest when a user has restarted more than once', async () => {
    seedWorkspace('older', ['old1'], NOW - 60 * 60 * 1000);
    seedWorkspace('newer', ['new1'], NOW - 10 * 60 * 1000);
    expect((await adoptAbandonedWorkspace(NOW))?.order).toEqual(['new1']);
  });

  it('leaves a workspace that was just written alone', async () => {
    // Without BroadcastChannel this is all we have to go on, and being slow to
    // recover beats taking a live tab's plans.
    seedWorkspace('maybe-live', ['p1'], NOW - 5 * 1000);
    expect(await adoptAbandonedWorkspace(NOW)).toBeNull();
    expect(store.has(wsKey('maybe-live'))).toBe(true);
  });

  it('has nothing to say when the store is empty', async () => {
    expect(await adoptAbandonedWorkspace(NOW)).toBeNull();
  });
});

describe('sweepOrphans', () => {
  it('deletes records no index names', async () => {
    seedWorkspace('mine', ['kept'], NOW - 1000);
    store.set('floortrace:doc:v1:ghost', { state: {} });
    store.set('floortrace:doc:v1:ghost::image::hghost', 'data:image/png;base64,AAA');
    store.set('floortrace:hist:v1:ghost', { undoStack: [] });

    const swept = await sweepOrphans(NOW);

    expect(swept.plans).toBe(3);
    expect(store.has('floortrace:doc:v1:kept')).toBe(true);
    expect(store.has('floortrace:doc:v1:ghost')).toBe(false);
    expect(store.has('floortrace:doc:v1:ghost::image::hghost')).toBe(false);
  });

  it('never touches a plan another workspace still references', async () => {
    seedWorkspace('other-tab', ['theirs'], NOW - 1000);
    const swept = await sweepOrphans(NOW);
    expect(swept.plans).toBe(0);
    expect(store.has('floortrace:doc:v1:theirs')).toBe(true);
  });

  it('clears a workspace that is a week cold, and its plans with it', async () => {
    seedWorkspace('ancient', ['gone'], NOW - SWEEP_AFTER_MS - 1000);
    const swept = await sweepOrphans(NOW);
    expect(swept.workspaces).toBe(1);
    expect(store.has(wsKey('ancient'))).toBe(false);
    expect(store.has('floortrace:doc:v1:gone')).toBe(false);
  });

  // An index written before `savedAt` existed has an UNKNOWN age, not an
  // ancient one. Treating absent as epoch swept real work on first run.
  it('refuses to age out an index that predates the stamp', async () => {
    store.set(wsKey('legacy'), { order: ['precious'], activeId: 'precious' });
    store.set('floortrace:doc:v1:precious', { state: { projectName: 'precious' } });

    const swept = await sweepOrphans(NOW);

    expect(swept.workspaces).toBe(0);
    expect(store.has(wsKey('legacy'))).toBe(true);
    expect(store.has('floortrace:doc:v1:precious')).toBe(true);
  });
});
