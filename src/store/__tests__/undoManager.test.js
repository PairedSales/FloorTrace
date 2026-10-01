import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import useAppStore from '../appStore';
import * as undoManager from '../undoManager';
import { COLLIDE_A, COLLIDE_B } from '../../utils/__tests__/collidingDataUrls';
import { hashDataUrl } from '../../utils/hash';

const image = () => useAppStore.getState().image;

describe('undoManager image intern pool', () => {
  beforeEach(() => {
    undoManager.clear();
    useAppStore.getState().resetOverlays();
    useAppStore.setState({ image: null });
  });

  it('restores the image that was actually snapshotted when hashes collide', () => {
    expect(hashDataUrl(COLLIDE_A)).toBe(hashDataUrl(COLLIDE_B));

    useAppStore.setState({ image: COLLIDE_A });
    undoManager.save();
    useAppStore.setState({ image: COLLIDE_B });

    expect(undoManager.undo()).toBe(true);
    expect(image()).toBe(COLLIDE_A);

    expect(undoManager.redo()).toBe(true);
    expect(image()).toBe(COLLIDE_B);
  });

  it('keeps two colliding images in the pool at once', () => {
    useAppStore.setState({ image: COLLIDE_A });
    undoManager.save();
    useAppStore.setState({ image: COLLIDE_B });
    undoManager.save();

    const urls = undoManager.getHistoryState().imagePool.map(([, url]) => url);
    expect(new Set(urls)).toEqual(new Set([COLLIDE_A, COLLIDE_B]));
  });

  // The pool exists so repeated snapshots of an unchanged image share one copy;
  // verifying the occupant must not have turned that back into N copies.
  it('still stores one copy across many saves of an unchanged image', () => {
    useAppStore.setState({ image: COLLIDE_A });
    for (let i = 0; i < 10; i++) undoManager.save();
    expect(undoManager.getHistoryState().imagePool).toHaveLength(1);
  });
});

describe('undoManager subscription', () => {
  const unsubs = [];
  // Detach even when an expectation throws, or a leaked listener counts
  // emissions belonging to the next test.
  const listen = (fn) => {
    const unsubscribe = undoManager.subscribe(fn);
    unsubs.push(unsubscribe);
    return unsubscribe;
  };

  beforeEach(() => {
    undoManager.clear();
    useAppStore.getState().resetOverlays();
    useAppStore.setState({ image: null });
  });

  afterEach(() => {
    while (unsubs.length) unsubs.pop()();
  });

  it('fires a listener exactly once from each of the six mutation sites', () => {
    useAppStore.setState({ image: COLLIDE_A });

    let fired = 0;
    listen(() => { fired += 1; });

    const emissions = [];
    const count = (label, fn) => {
      fired = 0;
      fn();
      emissions.push([label, fired]);
    };

    count('save', () => undoManager.save());
    count('cancelLastSave', () => undoManager.cancelLastSave());
    undoManager.save(); // refill so undo has something to pop
    count('undo', () => undoManager.undo());
    count('redo', () => undoManager.redo());
    count('setHistoryState', () =>
      undoManager.setHistoryState({ undoStack: [], redoStack: [], imagePool: [] }));
    count('clear', () => undoManager.clear());

    expect(emissions).toEqual([
      ['save', 1],
      ['cancelLastSave', 1],
      ['undo', 1],
      ['redo', 1],
      ['setHistoryState', 1],
      ['clear', 1],
    ]);
  });

  it('reports canUndo/canRedo through save, undo, redo and clear', () => {
    useAppStore.setState({ image: COLLIDE_A });
    expect([undoManager.canUndo(), undoManager.canRedo()]).toEqual([false, false]);

    undoManager.save();
    expect([undoManager.canUndo(), undoManager.canRedo()]).toEqual([true, false]);

    undoManager.undo();
    expect([undoManager.canUndo(), undoManager.canRedo()]).toEqual([false, true]);

    undoManager.redo();
    expect([undoManager.canUndo(), undoManager.canRedo()]).toEqual([true, false]);

    undoManager.clear();
    expect([undoManager.canUndo(), undoManager.canRedo()]).toEqual([false, false]);
  });

  it('clears and emits exactly once when setHistoryState is given no history', () => {
    useAppStore.setState({ image: COLLIDE_A });
    undoManager.save();
    expect(undoManager.canUndo()).toBe(true);

    let fired = 0;
    listen(() => { fired += 1; });
    undoManager.setHistoryState(null);

    expect(fired).toBe(1);
    expect([undoManager.canUndo(), undoManager.canRedo()]).toEqual([false, false]);
  });

  // Without this emit the buttons would advertise the previous project's history.
  it('emits the restored availability when a project loads its history', () => {
    let fired = 0;
    listen(() => { fired += 1; });
    undoManager.setHistoryState({
      undoStack: [{ __imageRef: null, roomOverlay: null }],
      redoStack: [{ __imageRef: null, roomOverlay: null }],
      imagePool: [],
    });

    expect(fired).toBe(1);
    expect([undoManager.canUndo(), undoManager.canRedo()]).toEqual([true, true]);
  });

  it('stops calling a listener once it unsubscribes', () => {
    useAppStore.setState({ image: COLLIDE_A });

    let fired = 0;
    const unsubscribe = listen(() => { fired += 1; });
    undoManager.save();
    expect(fired).toBe(1);

    unsubscribe();
    undoManager.save();
    undoManager.undo();
    expect(fired).toBe(1);
  });
});

/**
 * The stacks are bounded together, not separately: `undo`/`redo` move one entry
 * between them and create none, and `save()` clears the redo stack, so the
 * combined total only ever falls after a save trims at the cap. That invariant
 * held everywhere except the one path that installs a history it did not build.
 */
describe('undoManager stack bounds', () => {
  const MAX_UNDO = 50;

  beforeEach(() => {
    undoManager.clear();
    useAppStore.getState().resetOverlays();
    useAppStore.setState({ image: COLLIDE_A });
  });

  const depth = () => {
    const { undoStack, redoStack } = undoManager.getHistoryState();
    return { undo: undoStack.length, redo: redoStack.length, total: undoStack.length + redoStack.length };
  };

  it('caps the undo stack', () => {
    for (let i = 0; i < MAX_UNDO + 20; i += 1) undoManager.save();
    expect(depth().undo).toBe(MAX_UNDO);
  });

  it('never exceeds the combined cap under any save/undo/redo sequence', () => {
    let worst = 0;
    const note = () => { worst = Math.max(worst, depth().total); };
    for (let round = 0; round < 4; round += 1) {
      for (let i = 0; i < 80; i += 1) { undoManager.save(); note(); }
      for (let i = 0; i < 80; i += 1) { undoManager.undo(); note(); }
      for (let i = 0; i < 40; i += 1) { undoManager.redo(); note(); }
      for (let i = 0; i < 40; i += 1) { undoManager.undo(); note(); }
    }
    expect(worst).toBe(MAX_UNDO);
  });

  it('caps an oversized imported history to the combined ceiling', () => {
    // The one path that can carry more than the app ever creates.
    const snapshot = () => ({ ...useAppStore.getState().createSnapshot(null), __imageRef: null });
    const oversized = Array.from({ length: MAX_UNDO + 30 }, snapshot);

    undoManager.setHistoryState({ undoStack: oversized, redoStack: oversized, imagePool: [] });

    const { undo, total } = depth();
    expect(total).toBe(MAX_UNDO);
    // Undo is served first: a step the user can still take beats one they have not.
    expect(undo).toBe(MAX_UNDO);
  });

  it('keeps the newest entries when trimming an import', () => {
    const tagged = (n) => Array.from({ length: n }, (_unused, i) => ({ __imageRef: null, projectName: `s${i}` }));
    undoManager.setHistoryState({ undoStack: tagged(MAX_UNDO + 5), redoStack: [], imagePool: [] });

    const { undoStack } = undoManager.getHistoryState();
    // `pop()` reaches the far end first, so the far end is what must survive.
    expect(undoStack[undoStack.length - 1].projectName).toBe(`s${MAX_UNDO + 4}`);
    expect(undoStack[0].projectName).toBe('s5');
  });

  it('installs copies of an imported history, not the caller’s arrays', () => {
    const caller = { undoStack: [], redoStack: [], imagePool: [] };
    undoManager.setHistoryState(caller);

    undoManager.save();

    expect(caller.undoStack).toHaveLength(0);
    expect(depth().undo).toBe(1);
  });
});
