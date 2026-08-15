import { beforeEach, describe, expect, it } from 'vitest';
import useAppStore, { selectPerimeterOverlay, AUTOSAVE_FIELDS } from '../appStore';
import * as undoManager from '../undoManager';
import { calculateArea, holeRings } from '../../utils/areaCalculator';

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
// A 10 x 10 light well the user punched by hand: 100 px².
const lightWell = [
  { x: 10, y: 10 },
  { x: 20, y: 10 },
  { x: 20, y: 20 },
  { x: 10, y: 20 },
];
const autoHole = { id: 'hole-auto-0', ring: courtyard, source: 'auto' };
const userHole = { id: 'hole-user-0', ring: lightWell, source: 'user' };

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

  // The semantic change the void tool turns on: supplying holes replaces what
  // the detector found, and only that. A void the user punched is their
  // assertion about the building — the wall-mode toggle reaches this path in
  // one click and must not silently take it back.
  it('clears auto holes and keeps user holes when holes are supplied as empty', () => {
    useAppStore.getState().setPerimeterOverlay({ vertices: outer, holes: [autoHole, userHole] });

    useAppStore.getState().setPerimeterOverlay({ vertices: moved, holes: [] });

    const t = activeTrace();
    expect(t.holes).toEqual([userHole]);
    // 11000 px² of outline, minus only the 100 px² the user punched.
    expect(calculateArea(t.vertices, SCALE, t.holes)).toBe(10900);
  });

  it('replaces the detector voids on a re-trace and keeps the hand-punched one', () => {
    useAppStore.getState().setPerimeterOverlay({ vertices: outer, holes: [autoHole, userHole] });

    const reTraced = { id: 'hole-auto-0', ring: lightWell, source: 'auto' };
    useAppStore.getState().setPerimeterOverlay({ vertices: outer, holes: [reTraced] });

    const t = activeTrace();
    expect(t.holes).toEqual([userHole, reTraced]);
    expect(t.holes.filter((h) => h.source === 'auto')).toHaveLength(1);
  });

  it('drops an untagged hole on a re-trace — only a user tag survives', () => {
    seedTracedFloor();

    useAppStore.getState().setPerimeterOverlay({ vertices: outer, holes: [] });

    expect(activeTrace().holes).toEqual([]);
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

// One normalizer absorbs the two hole shapes, so a v1 `.floorplan` written
// before provenance existed keeps loading and still has its voids subtracted.
describe('holeRings', () => {
  it('accepts both a bare ring and a tagged one', () => {
    expect(holeRings([courtyard, userHole])).toEqual([courtyard, lightWell]);
  });

  it('is what makes the area agree across the two shapes', () => {
    expect(calculateArea(outer, SCALE, [courtyard])).toBe(9600);
    expect(calculateArea(outer, SCALE, [autoHole])).toBe(9600);
  });

  it('survives holes being absent or malformed', () => {
    expect(holeRings(null)).toEqual([]);
    expect(calculateArea(outer, SCALE, [null, {}, courtyard])).toBe(9600);
  });
});

describe('addHole / removeHole', () => {
  beforeEach(() => {
    useAppStore.getState().resetOverlays();
  });

  const traceId = () => useAppStore.getState().activeTraceId;

  it('tags a hand-punched void as the user\'s and appends it', () => {
    useAppStore.getState().setPerimeterOverlay({ vertices: outer, holes: [autoHole] });
    useAppStore.getState().addHole(traceId(), lightWell);

    const t = activeTrace();
    expect(t.holes).toHaveLength(2);
    expect(t.holes[1]).toMatchObject({ ring: lightWell, source: 'user' });
    expect(t.holes[1].id).toEqual(expect.any(String));
    expect(calculateArea(t.vertices, SCALE, t.holes)).toBe(9500);
  });

  it('refuses a ring with fewer than three corners', () => {
    useAppStore.getState().setPerimeterOverlay({ vertices: outer, holes: [] });
    useAppStore.getState().addHole(traceId(), [{ x: 0, y: 0 }, { x: 1, y: 1 }]);

    expect(activeTrace().holes).toEqual([]);
  });

  it('removes by id and leaves the others alone', () => {
    useAppStore.getState().setPerimeterOverlay({ vertices: outer, holes: [autoHole, userHole] });
    useAppStore.getState().removeHole(traceId(), 'hole-user-0');

    expect(activeTrace().holes).toEqual([autoHole]);
  });

  it('removes an untagged ring by its positional key', () => {
    useAppStore.getState().setPerimeterOverlay({ vertices: outer, holes: [courtyard, userHole] });
    useAppStore.getState().removeHole(traceId(), 'ring-0');

    expect(activeTrace().holes).toEqual([userHole]);
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
