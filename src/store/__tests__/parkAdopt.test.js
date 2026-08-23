import { beforeEach, describe, expect, it } from 'vitest';
import useAppStore, { PARK_FIELDS, PARK_ONLY_FIELDS, AUTOSAVE_FIELDS } from '../appStore';
import { parkedCount } from '../documentManager';
import { newTraceId } from '../ids';
import * as undoManager from '../undoManager';
import { app, oneDocument, IMAGE_A, IMAGE_B } from '../../hooks/__tests__/harness';

const history = () => undoManager.getHistoryState();

const trace = (name, vertices) => ({
  id: newTraceId(), name, vertices, holes: [], visible: true, closed: true,
  type: 'gla', colorSource: 'type', nameSource: 'auto', color: '#BD93F9',
});

const square = (n) => [{ x: 0, y: 0 }, { x: n, y: 0 }, { x: n, y: n }, { x: 0, y: n }];

describe('park and adopt', () => {
  let docA;
  beforeEach(() => {
    docA = oneDocument();
  });

  describe('the round trip', () => {
    // The whole correctness argument for this architecture, and it needs no UI:
    // if setting a plan aside and taking it straight back is lossless, then a
    // switch is lossless, because a switch is exactly that pair.
    it('returns every parked field by reference', () => {
      const only = trace('1st Floor', square(100));
      useAppStore.setState({
        image: IMAGE_A,
        projectName: '42 Oak Ave',
        perimeterTraces: [only],
        activeTraceId: only.id,
        calibration: { calibrated: true, feetPerPixel: { x: 0.05, y: 0.05 }, source: 'room-calibration', calibratedRoomId: null, createdAt: 1, quality: null },
        rooms: [{ rect: { left: 1, right: 2, top: 3, bottom: 4 } }],
        detectedDimensions: [{ width: 10, height: 12, text: "10' x 12'", bbox: { x: 1, y: 2, width: 3, height: 4 }, format: 'decimal' }],
        measurementLines: [{ start: { x: 0, y: 0 }, end: { x: 5, y: 5 } }],
        zoomScale: 2.5,
        stageX: -120,
        stageY: 40,
      });

      const before = {};
      for (const key of PARK_FIELDS) before[key] = app()[key];

      app().parkActiveDocument();
      app().adoptDocument(docA);

      for (const key of PARK_FIELDS) {
        // Reference identity, not deep equality: a park that rebuilt objects
        // would break every memo downstream and quietly re-render everything.
        expect(app()[key], `field ${key}`).toBe(before[key]);
      }
    });

    it('returns the undo history intact, with every image still resolvable', () => {
      useAppStore.setState({ image: IMAGE_A });
      undoManager.save();
      useAppStore.setState({ perimeterTraces: [trace('A', square(10))] });
      undoManager.save();
      undoManager.undo();

      const before = history();
      const couldUndo = undoManager.canUndo();
      const couldRedo = undoManager.canRedo();

      app().parkActiveDocument();
      app().adoptDocument(docA);

      const after = history();
      expect(after.undoStack).toHaveLength(before.undoStack.length);
      expect(after.redoStack).toHaveLength(before.redoStack.length);
      expect(undoManager.canUndo()).toBe(couldUndo);
      expect(undoManager.canRedo()).toBe(couldRedo);

      const pool = new Map(after.imagePool);
      for (const snap of [...after.undoStack, ...after.redoStack]) {
        if (snap.__imageRef) expect(pool.has(snap.__imageRef)).toBe(true);
      }
    });

    // Reference identity is the rule; repairing an impossible selection is the
    // one deliberate exception, and it is the same repair `applySnapshot` makes.
    it('repairs a selection pointing at a trace that no longer exists', () => {
      const only = trace('1st Floor', square(100));
      useAppStore.setState({
        image: IMAGE_A,
        perimeterTraces: [only],
        activeTraceId: 'trace-long-gone',
      });

      app().parkActiveDocument();
      app().adoptDocument(docA);

      expect(app().activeTraceId).toBe(only.id);
    });

    it('undoes across a park exactly as it would without one', () => {
      useAppStore.setState({ image: IMAGE_A, projectName: 'before' });
      undoManager.save();
      useAppStore.setState({ projectName: 'after' });

      app().parkActiveDocument();
      app().adoptDocument(docA);

      expect(undoManager.undo()).toBe(true);
      expect(app().projectName).toBe('before');
    });
  });

  describe('what PARK_FIELDS carries that AUTOSAVE_FIELDS does not', () => {
    it.each(PARK_ONLY_FIELDS)('parks %s', (field) => {
      expect(AUTOSAVE_FIELDS).not.toContain(field);
      expect(PARK_FIELDS).toContain(field);
    });

    // Parking through the autosave projection would launder away the fact that
    // a plan has unsaved work — checkUnsavedChanges reads exactly this.
    it('keeps a plan dirty across a park', () => {
      useAppStore.setState({ image: IMAGE_A, isDirty: true });

      app().parkActiveDocument();
      app().adoptDocument(docA);

      expect(app().isDirty).toBe(true);
    });

    // drawStrokes IS autosaved and drawModeActive is not, so parking one
    // without the other returns strokes on the plan and no brush in hand.
    it('keeps draw mode and its strokes together', () => {
      useAppStore.setState({
        image: IMAGE_A,
        drawModeActive: true,
        drawStrokes: [{ points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }],
      });

      app().parkActiveDocument();
      app().adoptDocument(docA);

      expect(app().drawModeActive).toBe(true);
      expect(app().drawStrokes).toHaveLength(1);
    });

    it('keeps vertex placement and the mode that explains it together', () => {
      useAppStore.setState({ image: IMAGE_A });
      app().setPerimeterVertices([{ x: 1, y: 1 }]);
      expect(app().traceInteractionMode).toBe('drawing');

      app().parkActiveDocument();
      app().adoptDocument(docA);

      expect(app().traceInteractionMode).toBe('drawing');
      expect(app().perimeterVertices).toHaveLength(1);
    });

    // A parked plan's work is abandoned, so returning to a spinner would be a
    // claim about work that is no longer running.
    it('does not return a stale spinner', () => {
      useAppStore.setState({ image: IMAGE_A });
      app().setIsProcessing(true, 'Tracing exterior walls…');

      app().parkActiveDocument();
      app().adoptDocument(docA);

      expect(app().isProcessing).toBe(false);
      expect(app().processingMessage).toBe('');
    });
  });

  describe('the cancel slot', () => {
    // save() and cancelLastSave() are used as a pair around actions that may
    // turn out to be no-ops. A pair straddling a switch would otherwise leave a
    // spurious undo point, with no error and nothing to see.
    it('gives up the option to cancel rather than carrying it across', () => {
      useAppStore.setState({ image: IMAGE_A });
      undoManager.save();
      const depth = history().undoStack.length;

      app().parkActiveDocument();
      app().adoptDocument(docA);

      undoManager.cancelLastSave();
      expect(history().undoStack).toHaveLength(depth);
    });
  });

  describe('two plans', () => {
    it('opens a second plan without disturbing the first', () => {
      useAppStore.setState({ image: IMAGE_A, projectName: 'Plan A' });

      const docB = app().openDocument();

      expect(app().activeDocumentId).toBe(docB);
      expect(app().documentOrder).toEqual([docA, docB]);
      expect(app().image).toBeNull();
      expect(app().projectName).toBe('');
      expect(parkedCount()).toBe(1);

      app().switchDocument(docA);
      expect(app().image).toBe(IMAGE_A);
      expect(app().projectName).toBe('Plan A');
    });

    it('keeps each plan’s undo stack to itself', () => {
      useAppStore.setState({ image: IMAGE_A });
      undoManager.save();
      undoManager.save();
      expect(history().undoStack).toHaveLength(2);

      const docB = app().openDocument();
      useAppStore.setState({ image: IMAGE_B });
      expect(history().undoStack).toHaveLength(0);

      undoManager.save();
      undoManager.undo();
      expect(undoManager.canUndo()).toBe(false);

      app().switchDocument(docA);
      expect(history().undoStack).toHaveLength(2);
      expect(undoManager.canUndo()).toBe(true);
      expect(docB).not.toBe(docA);
    });

    // The single strongest argument for this architecture: clear() and
    // setHistoryState() both wipe the intern pool, and both run on every image
    // load and project open. That is safe only because the pool always belongs
    // to the one live plan.
    it('does not let one plan’s image load evict another’s pooled images', () => {
      useAppStore.setState({ image: IMAGE_A });
      undoManager.save();
      const pooledA = new Map(history().imagePool).size;
      expect(pooledA).toBeGreaterThan(0);

      const docB = app().openDocument();
      useAppStore.setState({ image: IMAGE_B });
      undoManager.clear(); // what loading an image into B does

      app().switchDocument(docA);
      expect(new Map(history().imagePool).size).toBe(pooledA);
      expect(undoManager.undo()).toBe(true);
      expect(app().image).toBe(IMAGE_A);
      expect(docB).toBeTruthy();
    });

    it('treats switching to the live plan as a no-op', () => {
      useAppStore.setState({ image: IMAGE_A });
      const traces = app().perimeterTraces;

      expect(app().switchDocument(docA)).toBe(false);
      expect(app().perimeterTraces).toBe(traces);
      expect(parkedCount()).toBe(0);
    });

    it('refuses to switch to a plan that does not exist', () => {
      expect(app().switchDocument('doc-nope')).toBe(false);
      expect(app().activeDocumentId).toBe(docA);
    });
  });

  describe('closing', () => {
    it('selects the neighbour on the left, as closing an outline does', () => {
      const docB = app().openDocument();
      const docC = app().openDocument();
      expect(app().documentOrder).toEqual([docA, docB, docC]);

      app().closeDocument(docC);
      expect(app().activeDocumentId).toBe(docB);
      expect(app().documentOrder).toEqual([docA, docB]);
    });

    it('leaves a closed plan’s state unreachable', () => {
      useAppStore.setState({ image: IMAGE_A, projectName: 'doomed' });
      const docB = app().openDocument();

      app().closeDocument(docA);

      expect(app().documentOrder).toEqual([docB]);
      expect(app().documents[docA]).toBeUndefined();
      expect(parkedCount()).toBe(0);
    });

    it('keeps a plan on the root when the last one closes', () => {
      useAppStore.setState({ image: IMAGE_A });

      app().closeDocument(docA);

      expect(app().documentOrder).toHaveLength(1);
      expect(app().activeDocumentId).toBe(app().documentOrder[0]);
      expect(app().image).toBeNull();
    });

    it('ignores a plan that is not open', () => {
      expect(app().closeDocument('doc-nope')).toBe(false);
      expect(app().documentOrder).toEqual([docA]);
    });
  });

  describe('the swap flag', () => {
    it('is raised only while the root is between plans', () => {
      const seen = [];
      const unsub = useAppStore.subscribe(
        (s) => s._swappingDocument,
        (v) => seen.push(v),
      );

      app().openDocument();
      unsub();

      expect(seen).toEqual([true, false]);
      expect(app()._swappingDocument).toBe(false);
    });
  });
});
