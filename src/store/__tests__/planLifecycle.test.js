import { beforeEach, describe, expect, it } from 'vitest';
import useAppStore from '../appStore';
import { clearParked, newDocumentId, newDocumentMeta, MAX_OPEN_DOCUMENTS } from '../documentManager';
import { resetRequests } from '../documentRequests';
import * as undoManager from '../undoManager';

const app = () => useAppStore.getState();
const IMAGE = 'data:image/png;base64,PLAN';

const oneDocument = () => {
  clearParked();
  resetRequests();
  undoManager.clear();
  app().restart();
  const id = newDocumentId();
  useAppStore.setState({
    documents: { [id]: newDocumentMeta() },
    documentOrder: [id],
    activeDocumentId: id,
    _swappingDocument: false,
  });
  return id;
};

describe('plan lifecycle', () => {
  let docA;
  beforeEach(() => {
    docA = oneDocument();
  });

  describe('the cap', () => {
    it(`refuses to open more than ${MAX_OPEN_DOCUMENTS}`, () => {
      for (let i = 1; i < MAX_OPEN_DOCUMENTS; i += 1) {
        expect(app().openDocument()).toBeTruthy();
      }
      expect(app().documentOrder).toHaveLength(MAX_OPEN_DOCUMENTS);

      // Returns null rather than quietly doing nothing, so the caller can say
      // so — silent failure at a limit is the failure mode to avoid here.
      expect(app().openDocument()).toBeNull();
      expect(app().documentOrder).toHaveLength(MAX_OPEN_DOCUMENTS);
    });

    it('lets a plan open again after one closes', () => {
      const ids = [docA];
      for (let i = 1; i < MAX_OPEN_DOCUMENTS; i += 1) ids.push(app().openDocument());
      expect(app().openDocument()).toBeNull();

      app().closeDocument(ids[0]);
      expect(app().openDocument()).toBeTruthy();
    });
  });

  describe('metadata for plans that are not on screen', () => {
    // A tab has to say the right thing about a plan whose projectName is no
    // longer on the store root.
    it('records the title and whether a plan holds work when it is parked', () => {
      useAppStore.setState({ image: IMAGE, projectName: '42 Oak Ave' });

      const docB = app().openDocument();

      expect(app().documents[docA]).toMatchObject({
        title: '42 Oak Ave',
        hasWork: true,
        hydrated: true,
      });
      expect(app().documents[docB]).toMatchObject({ hasWork: false });
    });

    it('updates what it recorded when the plan changes and is parked again', () => {
      useAppStore.setState({ image: IMAGE, projectName: 'first' });
      const docB = app().openDocument();

      app().switchDocument(docA);
      useAppStore.setState({ projectName: 'second' });
      app().switchDocument(docB);

      expect(app().documents[docA].title).toBe('second');
    });
  });

  describe('a restored plan', () => {
    it('is marked unhydrated until its records are read back', () => {
      const restoredId = newDocumentId();
      app().adoptWorkspace([
        { docId: docA, meta: { hydrated: true } },
        { docId: restoredId, meta: { hydrated: false, title: 'On disk', hasWork: true } },
      ], docA);

      expect(app().documents[restoredId].hydrated).toBe(false);
      expect(app().documents[restoredId].title).toBe('On disk');
    });

    it('becomes switchable once its record is parked', () => {
      const restoredId = newDocumentId();
      app().adoptWorkspace([
        { docId: docA, meta: { hydrated: true } },
        { docId: restoredId, meta: { hydrated: false } },
      ], docA);

      app().parkRestoredDocument(restoredId, {
        state: { image: IMAGE, projectName: 'from disk' },
        history: null,
      });

      expect(app().documents[restoredId].hydrated).toBe(true);
      expect(app().switchDocument(restoredId)).toBe(true);
      expect(app().projectName).toBe('from disk');
      expect(app().image).toBe(IMAGE);
    });

    // Anything the parked record does not carry comes back at its default
    // rather than inheriting the plan that was on the root a moment ago.
    it('does not inherit the previous plan’s state', () => {
      useAppStore.setState({ image: IMAGE, unit: 'metric', showSideLengths: false });
      const restoredId = newDocumentId();
      app().adoptWorkspace([
        { docId: docA, meta: { hydrated: true } },
        { docId: restoredId, meta: { hydrated: false } },
      ], docA);
      app().parkRestoredDocument(restoredId, { state: { image: IMAGE }, history: null });

      app().switchDocument(restoredId);

      expect(app().unit).toBe('decimal');
      expect(app().showSideLengths).toBe(true);
    });
  });

  describe('adoptWorkspace', () => {
    it('replaces the open set wholesale and honours the active id', () => {
      const ids = [newDocumentId(), newDocumentId(), newDocumentId()];
      app().adoptWorkspace(ids.map((docId) => ({ docId, meta: {} })), ids[1]);

      expect(app().documentOrder).toEqual(ids);
      expect(app().activeDocumentId).toBe(ids[1]);
      expect(app().documents[docA]).toBeUndefined();
    });

    it('falls back to the first plan when the active id is not among them', () => {
      const ids = [newDocumentId(), newDocumentId()];
      app().adoptWorkspace(ids.map((docId) => ({ docId, meta: {} })), 'doc-gone');
      expect(app().activeDocumentId).toBe(ids[0]);
    });

    it('ignores an empty workspace rather than leaving no plan at all', () => {
      app().adoptWorkspace([], null);
      expect(app().documentOrder).toEqual([docA]);
    });
  });
});

describe('reading a parked plan for saving', () => {
  let docA;
  beforeEach(() => {
    docA = oneDocument();
  });

  // The one legitimate way to see a plan that is not on the root, and narrow
  // on purpose: writing a plan out to a file, never rendering one.
  it('exposes a parked plan’s state without adopting it', async () => {
    const { parkedStateFor } = await import('../documentManager');
    useAppStore.setState({ image: IMAGE, projectName: 'Parked plan' });

    const docB = app().openDocument();

    expect(parkedStateFor(docA)?.projectName).toBe('Parked plan');
    expect(parkedStateFor(docA)?.image).toBe(IMAGE);
    // Reading it does not make it live.
    expect(app().activeDocumentId).toBe(docB);
    expect(app().projectName).toBe('');
  });

  it('reports nothing for a plan that is live or unknown', async () => {
    const { parkedStateFor } = await import('../documentManager');
    expect(parkedStateFor(docA)).toBeNull();
    expect(parkedStateFor('doc-nope')).toBeNull();
  });
});

describe('a parked plan’s history is still readable', () => {
  let docA;
  beforeEach(() => {
    docA = oneDocument();
  });

  // The bug this pins: undo history lives in module state belonging to
  // whichever plan is live, so once another plan has adopted the stacks there
  // is nothing left to read. If it is not captured at park time it is gone —
  // which is why every background plan came back from a reload with an empty
  // undo stack even though its geometry restored perfectly.
  it('exposes the parked history so it can be written to disk', async () => {
    const { parkedHistoryFor } = await import('../documentManager');
    useAppStore.setState({ image: IMAGE });
    undoManager.save();
    undoManager.save();

    app().openDocument();

    const parked = parkedHistoryFor(docA);
    expect(parked).toBeTruthy();
    expect(parked.undoStack).toHaveLength(2);
    // The live stacks belong to the new plan now, so this is the only copy.
    expect(undoManager.getHistoryState().undoStack).toHaveLength(0);
  });

  it('reports nothing for a plan that is live or unknown', async () => {
    const { parkedHistoryFor } = await import('../documentManager');
    expect(parkedHistoryFor(docA)).toBeNull();
    expect(parkedHistoryFor('doc-nope')).toBeNull();
  });

  it('records when a plan was parked, per plan', async () => {
    useAppStore.setState({ image: IMAGE });
    const docB = app().openDocument();

    expect(app().documents[docA].updatedAt).toEqual(expect.any(Number));
    // The plan that has never been parked has no timestamp to report.
    expect(app().documents[docB].updatedAt).toBeNull();
  });
});

describe('reordering plans', () => {
  let docA;
  beforeEach(() => {
    docA = oneDocument();
  });

  it('moves a plan and keeps every other plan in order', () => {
    const docB = app().openDocument();
    const docC = app().openDocument();
    expect(app().documentOrder).toEqual([docA, docB, docC]);

    expect(app().moveDocument(docC, 0)).toBe(true);
    expect(app().documentOrder).toEqual([docC, docA, docB]);

    expect(app().moveDocument(docC, 2)).toBe(true);
    expect(app().documentOrder).toEqual([docA, docB, docC]);
  });

  // Order is workspace state; which plan you are looking at is not part of it.
  it('does not change which plan is active', () => {
    const docB = app().openDocument();
    app().moveDocument(docB, 0);
    expect(app().activeDocumentId).toBe(docB);
  });

  it('clamps a target beyond either end rather than losing the plan', () => {
    const docB = app().openDocument();
    app().moveDocument(docA, 99);
    expect(app().documentOrder).toEqual([docB, docA]);
    app().moveDocument(docA, -5);
    expect(app().documentOrder).toEqual([docA, docB]);
  });

  it('reports no move for a no-op or an unknown plan', () => {
    app().openDocument();
    expect(app().moveDocument(docA, 0)).toBe(false);
    expect(app().moveDocument('doc-nope', 0)).toBe(false);
  });
});
