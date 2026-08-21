// @vitest-environment jsdom
//
// The autosave hook decides two things nothing else can check: which plan a
// debounced write names, and when the workspace index is rewritten. Both were
// wrong in #225, and neither is reachable from a store-level test — the logic
// lives inside effects.
//
// Only the persistence layer is replaced. The store, the park/adopt path and
// the hook itself are real, so a failure here means the decision was wrong.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutosave } from '../useAutosave';
import { app, oneDocument, addParkedDocument, IMAGE_A, IMAGE_B } from './harness';

const drafts = vi.hoisted(() => ({
  readWorkspaceIndex: vi.fn(async () => null),
  writeWorkspaceIndex: vi.fn(async () => {}),
  removeWorkspaceIndex: vi.fn(async () => {}),
  removeWorkspace: vi.fn(async () => {}),
  writeDocDraft: vi.fn(async () => {}),
  readDocDraft: vi.fn(async () => ({ status: 'missing' })),
  removeDocDraft: vi.fn(async () => {}),
  writeHistoryRecord: vi.fn(async () => {}),
  readHistoryRecord: vi.fn(async () => null),
  removeHistoryRecord: vi.fn(async () => {}),
  removePlan: vi.fn(async () => {}),
  isQuotaError: vi.fn(() => false),
  LEGACY_DRAFT_KEY: 'floortrace:autosave:v1',
}));
vi.mock('../../utils/workspaceDrafts', () => drafts);

const storage = vi.hoisted(() => ({
  getDraft: vi.fn(async () => null),
  setDraft: vi.fn(async () => {}),
  removeDraft: vi.fn(async () => {}),
}));
vi.mock('../../utils/draftStorage', () => storage);

vi.mock('../../utils/notify', () => ({
  notify: vi.fn(),
  flash: vi.fn(),
}));

/** Mount the hook and let its startup restore settle. */
const mountAutosave = async () => {
  const rendered = renderHook(() => useAutosave());
  await act(async () => { await Promise.resolve(); });
  return rendered;
};

const settle = async (ms = 2500) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};

/**
 * Flush microtasks without advancing the clock.
 *
 * The index tests below settle this way on purpose. Before #225 the index was
 * repaired by accident, by the debounced write that fired two seconds after a
 * close — so a test that advances the clock cannot tell the fix from the bug it
 * replaced. Writing the index has to be a consequence of the close itself.
 */
const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
};

describe('useAutosave', () => {
  let docA;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers();
    docA = oneDocument();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with the workspace restored so later edits are written', async () => {
    await mountAutosave();
    expect(app()._hasRestoredState).toBe(true);
  });

  it('writes an edit under the plan that made it', async () => {
    await mountAutosave();
    act(() => { app().setImage(IMAGE_A); });
    await settle();

    const written = drafts.writeDocDraft.mock.calls.filter(([id]) => id === docA);
    expect(written.length).toBeGreaterThan(0);
    expect(written.at(-1)[1].image).toBe(IMAGE_A);
  });

  // The defect: the id was captured when the timer was armed, but the state was
  // read when it fired — off the live root. Switching tabs inside the 2 s window
  // put the incoming plan's image, traces and calibration under the outgoing
  // plan's key, while its tab went on showing the outgoing plan's title.
  it('never writes the incoming plan under the outgoing plan\u2019s key', async () => {
    const { unmount } = await mountAutosave();
    act(() => { app().setImage(IMAGE_A); });

    const docB = addParkedDocument({ image: IMAGE_B });
    act(() => { app().switchDocument(docB); });
    expect(app().image).toBe(IMAGE_B);

    await settle();

    const crossed = drafts.writeDocDraft.mock.calls.find(
      ([id, state]) => id === docA && state.image === IMAGE_B,
    );
    expect(crossed).toBeUndefined();

    // And the plan that was parked was still written — with its own drawing.
    const parkWrite = drafts.writeDocDraft.mock.calls.find(([id]) => id === docA);
    expect(parkWrite?.[1].image).toBe(IMAGE_A);
    unmount();
  });

  // `restart` empties the last plan in place and keeps its id, so the guard
  // above never trips for it. What covers it is cancelling the pending write
  // before the records are removed.
  it('does not rewrite the records of a plan emptied in place', async () => {
    await mountAutosave();
    act(() => { app().setImage(IMAGE_A); });
    drafts.writeDocDraft.mockClear();

    act(() => { app().restart(); });
    await settle();

    expect(drafts.removePlan).toHaveBeenCalledWith(docA);
    expect(drafts.writeDocDraft).not.toHaveBeenCalled();
  });

  it('rewrites the index when a plan is emptied, so it stops naming it', async () => {
    await mountAutosave();
    act(() => { app().setImage(IMAGE_A); });
    await settle();
    drafts.writeWorkspaceIndex.mockClear();

    act(() => { app().restart(); });
    await flush();

    expect(drafts.writeWorkspaceIndex).toHaveBeenCalled();
    const index = drafts.writeWorkspaceIndex.mock.calls.at(-1)[0];
    expect(index.docs[docA].hasWork).toBe(false);
  });

  // `removePlan` deletes a plan's own records and never touches the index. No
  // close path wrote it; it was repaired by accident by the very write that had
  // to go. A stale index makes a restore discard the whole workspace.
  it('rewrites the index when a background plan closes', async () => {
    await mountAutosave();
    act(() => { app().setImage(IMAGE_A); });
    const docB = addParkedDocument({ image: IMAGE_B });
    await settle();
    drafts.writeWorkspaceIndex.mockClear();

    act(() => { app().closeDocument(docB); });
    await flush();

    expect(drafts.writeWorkspaceIndex).toHaveBeenCalled();
    const index = drafts.writeWorkspaceIndex.mock.calls.at(-1)[0];
    expect(index.order).not.toContain(docB);
    expect(index.order).toContain(docA);
  });

  it('rewrites the index when the active plan closes, naming its successor', async () => {
    await mountAutosave();
    act(() => { app().setImage(IMAGE_A); });
    const docB = addParkedDocument({ image: IMAGE_B });
    act(() => { app().switchDocument(docB); });
    await settle();
    drafts.writeWorkspaceIndex.mockClear();

    act(() => { app().closeDocument(docB); });
    await flush();

    expect(drafts.writeWorkspaceIndex).toHaveBeenCalled();
    const index = drafts.writeWorkspaceIndex.mock.calls.at(-1)[0];
    expect(index.order).toEqual([docA]);
    // `closeDocument` trims the order and *then* adopts a successor. A write
    // that ran synchronously on the first of those stamped `activeId` with the
    // id of the plan being closed — a stale index on every close.
    expect(index.activeId).toBe(docA);
  });
});
