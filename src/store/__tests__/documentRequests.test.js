import { beforeEach, describe, expect, it } from 'vitest';
import useAppStore from '../appStore';
import {
  beginWork, settleWork, deliver, isCurrent, signalOf,
  detachDocument, detachActiveDocument, workCount, resetRequests,
} from '../documentRequests';
import { clearParked, parkedInboxSize } from '../documentManager';

const app = () => useAppStore.getState();

const IMAGE_A = 'data:image/png;base64,AAAA';
const IMAGE_B = 'data:image/png;base64,BBBB';

describe('documentRequests', () => {
  beforeEach(() => {
    resetRequests();
    clearParked();
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

  it('drops a result whose plan is gone', () => {
    const work = beginWork('scan');
    // Closed, not merely parked: the plan is no longer in `documents`.
    useAppStore.setState({ documents: {}, activeDocumentId: 'doc-somewhere-else' });

    expect(deliver(work, () => {})).toBe('dropped');
  });

  // The case the image comparison cannot see, and the reason this layer exists:
  // two plans opened from the same file hold the same data URL, so each passes
  // the other's staleness test exactly.
  it('tells two plans holding identical images apart', () => {
    const work = beginWork('scan');
    // Same pixels, different plan, and the owning plan is closed.
    useAppStore.setState({ documents: {}, activeDocumentId: 'doc-the-other-one', image: IMAGE_A });

    expect(work.image).toBe(useAppStore.getState().image);
    expect(deliver(work, () => {})).toBe('dropped');
  });

  // The distinction this layer gained once a plan could be open without being
  // live. Parking used to abort in-flight work, so switching tabs mid-trace
  // threw the trace away and cleared the spinner — you came back to a plan
  // where nothing had happened and nothing said so.
  describe('a plan that is open but parked', () => {
    it('holds the write instead of dropping it', () => {
      useAppStore.setState({ image: IMAGE_A });
      const work = beginWork('trace');

      const docB = app().openDocument();
      expect(app().activeDocumentId).toBe(docB);

      let ran = false;
      expect(deliver(work, () => { ran = true; })).toBe('routed');
      // Held, not run: the store's setters address whichever plan is live.
      expect(ran).toBe(false);
      expect(parkedInboxSize(work.docId)).toBe(1);
    });

    it('runs the held write when that plan is adopted', () => {
      useAppStore.setState({ image: IMAGE_A });
      const work = beginWork('trace');
      const docA = work.docId;

      app().openDocument();
      deliver(work, () => useAppStore.getState().setProjectName('traced while away'));

      app().switchDocument(docA);
      expect(app().projectName).toBe('traced while away');
    });

    it('refuses a write that must not survive a switch', () => {
      useAppStore.setState({ image: IMAGE_A });
      const work = beginWork('measure');
      app().openDocument();

      let ran = false;
      const verdict = deliver(work, () => { ran = true; }, { replayable: false });

      // A calibration is the case: area goes as scale squared, so applying one
      // late is a wrong number wearing the same green as a right one.
      expect(verdict).toBe('refused');
      expect(ran).toBe(false);
      expect(parkedInboxSize(work.docId)).toBe(0);
    });

    it('drops a held write when its plan is closed before it returns', () => {
      useAppStore.setState({ image: IMAGE_A });
      const work = beginWork('trace');
      const docA = work.docId;

      app().openDocument();
      deliver(work, () => useAppStore.getState().setProjectName('should never land'));
      app().closeDocument(docA);

      expect(app().projectName).toBe('');
      expect(parkedInboxSize(docA)).toBe(0);
    });

    it('still refuses a result whose parked plan has a different image', () => {
      useAppStore.setState({ image: IMAGE_A });
      const work = beginWork('trace');
      // A crop lands before the switch, so the result describes ink that is gone.
      useAppStore.setState({ image: IMAGE_B });
      app().openDocument();

      expect(deliver(work, () => {})).toBe('stale');
    });
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
