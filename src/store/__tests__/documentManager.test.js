import { beforeEach, describe, expect, it } from 'vitest';
import useAppStore, { WORKING_STATE_KEYS, computeAreaByType, selectActiveAreaByType } from '../appStore';
import { documentLabel, newDocumentId } from '../documentManager';
import { newTraceId } from '../ids';

const app = () => useAppStore.getState();

describe('document identity', () => {
  beforeEach(() => {
    app().restart();
  });

  it('starts with exactly one document, active and ordered', () => {
    const s = app();
    expect(s.documentOrder).toHaveLength(1);
    expect(s.documentOrder[0]).toBe(s.activeDocumentId);
    expect(s.documents[s.activeDocumentId]).toMatchObject({ sourceFileName: null, hydrated: true });
  });

  it('mints unique ids at both levels', () => {
    const docs = new Set(Array.from({ length: 200 }, newDocumentId));
    const traces = new Set(Array.from({ length: 200 }, newTraceId));
    expect(docs.size).toBe(200);
    expect(traces.size).toBe(200);
    // The two namespaces must not be able to collide with each other either.
    expect([...docs].every((id) => id.startsWith('doc-'))).toBe(true);
    expect([...traces].every((id) => id.startsWith('trace-'))).toBe(true);
  });

  // The collision this replaces: every plan that had never had a trace added
  // shared the id 'trace-default', and trace ids are what focusedWarning, the
  // double-counting report and an exhibit's outline ids all key on.
  it('gives two fresh documents different default trace ids', () => {
    const first = app().perimeterTraces[0].id;
    app().restart();
    const second = app().perimeterTraces[0].id;

    expect(second).not.toBe(first);
    expect(app().activeTraceId).toBe(second);
  });

  it('keeps document metadata out of working state', () => {
    // Anything added to working state is auto-enrolled in undo, autosave and
    // the .floorplan by exclusion, which is wrong for all three here.
    for (const key of ['sourceFileName', 'activeDocumentId', 'documentOrder', 'documents']) {
      expect(WORKING_STATE_KEYS).not.toContain(key);
    }
  });

  describe('metadata', () => {
    it('records and clears the source file name', () => {
      app().setActiveDocumentMeta({ sourceFileName: 'Ranch on Elm.png' });
      expect(app().activeDocumentMeta().sourceFileName).toBe('Ranch on Elm.png');

      app().setActiveDocumentMeta({ sourceFileName: null });
      expect(app().activeDocumentMeta().sourceFileName).toBeNull();
    });

    it('ignores a write to a document that does not exist', () => {
      const before = app().documents;
      app().setDocumentMeta('doc-nope', { sourceFileName: 'x.png' });
      expect(app().documents).toBe(before);
    });

    // Closing a project must not leave its filename naming the empty plan that
    // replaces it.
    it('forgets the file name on restart, keeping the same document', () => {
      const id = app().activeDocumentId;
      app().setActiveDocumentMeta({ sourceFileName: 'Ranch on Elm.png' });

      app().restart();

      expect(app().activeDocumentId).toBe(id);
      expect(app().activeDocumentMeta().sourceFileName).toBeNull();
    });
  });

  describe('documentLabel', () => {
    it('prefers the subject line the user typed', () => {
      expect(documentLabel({ projectName: '123 Main St', sourceFileName: 'scan.png' }))
        .toBe('123 Main St');
    });

    it('falls back to the file name without its extension', () => {
      expect(documentLabel({ projectName: '  ', sourceFileName: 'Ranch on Elm.png' }))
        .toBe('Ranch on Elm');
      expect(documentLabel({ sourceFileName: 'plan.v2.floorplan' })).toBe('plan.v2');
    });

    it('keeps a dotfile name rather than reducing it to nothing', () => {
      expect(documentLabel({ sourceFileName: '.floorplan' })).toBe('.floorplan');
    });

    it('falls back to a positional placeholder, counting from one', () => {
      expect(documentLabel({ index: 0 })).toBe('Untitled 1');
      expect(documentLabel({ projectName: null, sourceFileName: null, index: 2 }))
        .toBe('Untitled 3');
    });

    it('resolves the active label through the same chain', () => {
      app().setProjectName('42 Oak Ave');
      expect(app().activeDocumentLabel()).toBe('42 Oak Ave');

      app().setProjectName('');
      app().setActiveDocumentMeta({ sourceFileName: 'oak.png' });
      expect(app().activeDocumentLabel()).toBe('oak');
    });
  });
});

describe('area selectors', () => {
  beforeEach(() => {
    app().restart();
  });

  const square = (n) => [
    { x: 0, y: 0 }, { x: n, y: 0 }, { x: n, y: n }, { x: 0, y: n },
  ];

  const seed = (size) => useAppStore.setState({
    perimeterTraces: [{
      id: newTraceId(), name: 'A', vertices: square(size), holes: [],
      visible: true, closed: true, type: 'gla', colorSource: 'type',
      nameSource: 'auto', color: '#BD93F9',
    }],
    calibration: { calibrated: true, feetPerPixel: { x: 1, y: 1 }, source: 'room-calibration' },
  });

  it('computes the same numbers as the memoised selector', () => {
    seed(10);
    const state = useAppStore.getState();
    expect(computeAreaByType(state)).toEqual(selectActiveAreaByType(state));
  });

  // The reason the exhibit stopped calling the memo: a memo keyed on nothing
  // but the last call answers for whichever state asked most recently, so a
  // caller handed a state must not go through it.
  it('describes the state it is given, not the state that asked last', () => {
    seed(10);
    const ten = useAppStore.getState();
    selectActiveAreaByType(ten);

    const twenty = { ...ten, perimeterTraces: [{ ...ten.perimeterTraces[0], vertices: square(20) }] };

    expect(computeAreaByType(twenty).total).toBe(400);
    expect(computeAreaByType(ten).total).toBe(100);
  });

  it('returns a fresh object each call, so nothing can be aliased', () => {
    seed(10);
    const state = useAppStore.getState();
    expect(computeAreaByType(state)).not.toBe(computeAreaByType(state));
  });

  it('still returns a stable reference from the memoised selector', () => {
    seed(10);
    const first = selectActiveAreaByType(useAppStore.getState());
    expect(selectActiveAreaByType(useAppStore.getState())).toBe(first);
  });
});
