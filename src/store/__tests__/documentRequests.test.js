import { beforeEach, describe, expect, it } from 'vitest';
import useAppStore from '../appStore';
import {
  beginWork, settleWork, deliver, isCurrent, signalOf,
  detachDocument, detachActiveDocument, workCount, resetRequests,
} from '../documentRequests';

const app = () => useAppStore.getState();

const IMAGE_A = 'data:image/png;base64,AAAA';
const IMAGE_B = 'data:image/png;base64,BBBB';

describe('documentRequests', () => {
  beforeEach(() => {
    resetRequests();
    app().restart();
    useAppStore.setState({ image: IMAGE_A });
  });

  it('applies a result whose plan and image are unchanged', () => {
    const work = beginWork('trace');
    let ran = false;
    expect(deliver(work, () => { ran = true; })).toBe('applied');
    expect(ran).toBe(true);
    expect(isCurrent(work)).toBe(true);
  });

  // The staleness the old `image !== startImage` guard was really testing: the
  // plan is the same, but a crop or an erase replaced the ink the work read.
  it('refuses a result whose image was replaced under it', () => {
    const work = beginWork('trace');
    useAppStore.setState({ image: IMAGE_B });

    let ran = false;
    expect(deliver(work, () => { ran = true; })).toBe('stale');
    expect(ran).toBe(false);
    expect(isCurrent(work)).toBe(false);
  });

  it('refuses a result whose plan is gone', () => {
    const work = beginWork('scan');
    useAppStore.setState({ activeDocumentId: 'doc-somewhere-else' });

    expect(deliver(work, () => {})).toBe('dropped');
  });

  // The case the image comparison cannot see, and the reason this layer exists:
  // two plans opened from the same file hold the same data URL, so each passes
  // the other's staleness test exactly.
  it('tells two plans holding identical images apart', () => {
    const work = beginWork('scan');
    // Same pixels, different plan.
    useAppStore.setState({ activeDocumentId: 'doc-the-other-one', image: IMAGE_A });

    expect(work.image).toBe(useAppStore.getState().image);
    expect(deliver(work, () => {})).toBe('dropped');
  });

  it('owns the image it was handed, not whatever is loaded', () => {
    // The scan is given an imgSrc and must report on that one.
    const work = beginWork('scan', { image: IMAGE_B });
    expect(isCurrent(work)).toBe(false);

    useAppStore.setState({ image: IMAGE_B });
    expect(isCurrent(work)).toBe(true);
  });

  describe('lifecycle', () => {
    it('tracks and releases in-flight work', () => {
      expect(workCount()).toBe(0);
      const a = beginWork('trace');
      const b = beginWork('scan');
      expect(workCount()).toBe(2);

      settleWork(a);
      expect(workCount()).toBe(1);
      settleWork(a); // idempotent
      expect(workCount()).toBe(1);
      settleWork(b);
      expect(workCount()).toBe(0);
    });

    // A settled token is no longer abortable, but is still a valid claim — the
    // synchronous tail of an async function runs after its own `finally`.
    it('keeps answering after it settles', () => {
      const work = beginWork('room');
      settleWork(work);
      expect(isCurrent(work)).toBe(true);

      useAppStore.setState({ image: IMAGE_B });
      expect(isCurrent(work)).toBe(false);
    });

    it('abandons every unit of work a plan holds', () => {
      const a = beginWork('trace');
      const b = beginWork('scan');

      expect(detachActiveDocument()).toBe(2);
      expect(workCount()).toBe(0);
      expect(deliver(a, () => {})).toBe('dropped');
      expect(deliver(b, () => {})).toBe('dropped');
      expect(signalOf(a).aborted).toBe(true);
    });

    it('leaves another plan’s work alone', () => {
      const mine = beginWork('trace');
      expect(detachDocument('doc-not-mine')).toBe(0);
      expect(deliver(mine, () => {})).toBe('applied');
    });

    it('exposes a signal for work that can stop early', () => {
      const work = beginWork('scan');
      expect(signalOf(work).aborted).toBe(false);
      detachActiveDocument();
      expect(signalOf(work).aborted).toBe(true);
    });
  });

  it('treats a missing token as dropped rather than throwing', () => {
    expect(deliver(null, () => {})).toBe('dropped');
    expect(isCurrent(undefined)).toBe(false);
    expect(() => settleWork(null)).not.toThrow();
  });
});
