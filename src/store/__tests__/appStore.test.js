import { beforeEach, describe, expect, it } from 'vitest';
import useAppStore, { selectPerimeterOverlay, AUTOSAVE_FIELDS } from '../appStore';
import * as undoManager from '../undoManager';
import { calculateArea } from '../../utils/areaCalculator';

const SCALE = { x: 1, y: 1 };

// 100 x 100 outer ring with a 20 x 20 courtyard: 10000 - 400 = 9600 px².
const outer = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];
const courtyard = [
  { x: 40, y: 40 },
  { x: 60, y: 40 },
  { x: 60, y: 60 },
  { x: 40, y: 60 },
];
// One corner dragged out, the way handleVertexDragEnd hands back a new array.
const moved = [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

const activeTrace = () => {
  const s = useAppStore.getState();
  return s.perimeterTraces.find((t) => t.id === s.activeTraceId);
};

const seedTracedFloor = () => {
  useAppStore.getState().setPerimeterOverlay({
    vertices: outer,
    holes: [courtyard],
    quality: { source: 'auto', confidence: 0.9, warnings: [] },
  });
};

describe('setPerimeterOverlay', () => {
  beforeEach(() => {
    useAppStore.getState().resetOverlays();
  });

  it('keeps holes when a vertex edit supplies only vertices', () => {
    seedTracedFloor();
    expect(activeTrace().holes).toHaveLength(1);

    useAppStore.getState().setPerimeterOverlay({ vertices: moved });

    const t = activeTrace();
    expect(t.holes).toHaveLength(1);
    expect(t.holes[0]).toEqual(courtyard);
    // The void is still subtracted: 11000 px² of outline minus the 400 px² hole.
    expect(calculateArea(t.vertices, SCALE, t.holes)).toBe(10600);
    expect(calculateArea(t.vertices, SCALE)).toBe(11000);
  });

  it('clears holes when they are explicitly supplied as empty', () => {
    seedTracedFloor();

    useAppStore.getState().setPerimeterOverlay({ vertices: moved, holes: [] });

    const t = activeTrace();
    expect(t.holes).toEqual([]);
    expect(calculateArea(t.vertices, SCALE, t.holes)).toBe(11000);
  });

  it('clears holes when the overlay is cleared entirely', () => {
    seedTracedFloor();

    useAppStore.getState().setPerimeterOverlay(null);

    const t = activeTrace();
    expect(t.holes).toEqual([]);
    expect(t.vertices).toEqual([]);
  });

  // The deliberate asymmetry: a hand edit invalidates the detector's confidence
  // but not the rings it did not touch. Guards against collapsing the branches.
  it('nulls quality on a hand edit while keeping holes', () => {
    seedTracedFloor();
    expect(activeTrace().quality).not.toBeNull();

    useAppStore.getState().setPerimeterOverlay({ vertices: moved });

    const t = activeTrace();
    expect(t.quality).toBeNull();
    expect(t.holes).toHaveLength(1);
  });
});

describe('selectPerimeterOverlay', () => {
  beforeEach(() => {
    useAppStore.getState().resetOverlays();
  });

  it('carries holes and quality, not vertices alone', () => {
    seedTracedFloor();

    const overlay = selectPerimeterOverlay(useAppStore.getState());
    expect(overlay.vertices).toEqual(outer);
    expect(overlay.holes).toEqual([courtyard]);
    expect(overlay.quality).toMatchObject({ source: 'auto' });
  });

  it('re-derives when holes change even though vertices do not', () => {
    seedTracedFloor();
    const before = selectPerimeterOverlay(useAppStore.getState());

    useAppStore.getState().setPerimeterOverlay({ vertices: outer, holes: [] });
    const after = selectPerimeterOverlay(useAppStore.getState());

    expect(after).not.toBe(before);
    expect(after.holes).toEqual([]);
  });
});

describe('focusedWarning', () => {
  beforeEach(() => {
    useAppStore.getState().restart();
    useAppStore.getState().setFocusedWarning(null);
  });

  // Which warning is being inspected is a view of the document, not part of it:
  // undoing an edit must not restore a highlight, and reopening a project must
  // not start with one already on the canvas.
  it('reaches neither a snapshot nor a draft', () => {
    useAppStore.getState().setFocusedWarning({ traceId: 'trace-1', index: 2 });
    expect(useAppStore.getState().focusedWarning).toEqual({ traceId: 'trace-1', index: 2 });

    expect(AUTOSAVE_FIELDS).not.toContain('focusedWarning');
    expect(useAppStore.getState().getAutosaveState()).not.toHaveProperty('focusedWarning');
    expect(useAppStore.getState().createSnapshot(null)).not.toHaveProperty('focusedWarning');
  });

  it('survives an undo rather than being reverted by one', () => {
    useAppStore.getState().setFocusedWarning({ traceId: 'trace-1', index: 0 });
    undoManager.save();
    useAppStore.getState().setUnit('metric');
    undoManager.undo();
    expect(useAppStore.getState().focusedWarning).toEqual({ traceId: 'trace-1', index: 0 });
  });
});

// `tracedBoundaries` is the detector result the interior/exterior toggle
// re-applies. It is the heaviest field in a snapshot, so it is tempting to drop
// from the field sets — these pin down why it cannot be, and how it is made
// cheap instead.
describe('tracedBoundaries weight and lifetime', () => {
  const IMG_A = 'data:image/png;base64,AAAA';
  const IMG_B = 'data:image/png;base64,BBBB';
  const T_OLD = { tag: 'old', floors: [{ outer: { polygon: [{ x: 0, y: 0 }] } }] };
  const T_NEW = { tag: 'new', floors: [{ outer: { polygon: [{ x: 9, y: 9 }] } }] };

  beforeEach(() => {
    useAppStore.getState().restart();
    undoManager.clear();
  });

  it('is autosaved, so a restored draft can still toggle wall mode', () => {
    expect(AUTOSAVE_FIELDS).toContain('tracedBoundaries');
  });

  // The memory win: 50 snapshots share one detector result rather than holding
  // 50 deep clones of it. Safe only while nothing mutates it in place.
  it('is shared by reference across snapshots while other fields are cloned', () => {
    const s = useAppStore.getState();
    s.setImage(IMG_A);
    s.setTracedBoundaries(T_OLD);

    const snap = useAppStore.getState().createSnapshot(null);
    expect(snap.tracedBoundaries).toBe(T_OLD);
    expect(snap.perimeterTraces).not.toBe(useAppStore.getState().perimeterTraces);
    expect(snap.perimeterTraces).toEqual(useAppStore.getState().perimeterTraces);
  });

  // handleImageUpdate drops the trace because it describes the pre-crop image;
  // undo puts that image back, so it must put the trace back too.
  it('comes back with the image when a crop is undone', () => {
    const s = useAppStore.getState();
    s.setImage(IMG_A);
    s.setTracedBoundaries(T_OLD);

    undoManager.save();
    useAppStore.getState().setImage(IMG_B);
    useAppStore.getState().setTracedBoundaries(null);

    undoManager.undo();
    expect(useAppStore.getState().image).toBe(IMG_A);
    expect(useAppStore.getState().tracedBoundaries).toEqual(T_OLD);
  });

  // Left out of snapshots, undoing a trace leaves the new result in the store
  // and the next wall-mode toggle silently re-applies the undone geometry.
  it('does not survive undo as the newer result', () => {
    const s = useAppStore.getState();
    s.setImage(IMG_A);
    s.setTracedBoundaries(T_OLD);

    undoManager.save();
    useAppStore.getState().setTracedBoundaries(T_NEW);
    undoManager.save();
    useAppStore.getState().setTracedBoundaries(null);

    undoManager.undo();
    expect(useAppStore.getState().tracedBoundaries).toEqual(T_NEW);
    undoManager.undo();
    expect(useAppStore.getState().tracedBoundaries).toEqual(T_OLD);
  });
});
