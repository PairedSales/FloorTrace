import { beforeEach, describe, expect, it } from 'vitest';
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
