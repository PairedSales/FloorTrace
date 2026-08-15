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
