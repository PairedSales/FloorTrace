import { beforeEach, describe, expect, it } from 'vitest';
import useAppStore, {
  selectAreaByType,
  selectCombinedArea,
  selectPerimeterOverlay,
  AUTOSAVE_FIELDS,
  CALIBRATION_SOURCES,
  PERSISTENT_FLOOR_FIELDS,
} from '../appStore';
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

describe('selectAreaByType', () => {
  const box = (n) => [{ x: 0, y: 0 }, { x: n, y: 0 }, { x: n, y: n }, { x: 0, y: n }];
  const trace = (id, type, size, visible = true) => ({
    id,
    name: id,
    vertices: box(size),
    holes: [],
    closed: true,
    visible,
    locked: false,
    type,
    colorSource: 'type',
    color: '#BD93F9',
  });

  const seed = (list) => useAppStore.setState({
    perimeterTraces: list,
    activeTraceId: list[0]?.id ?? null,
    calibration: {
      calibrated: true,
      feetPerPixel: SCALE,
      source: 'room-calibration',
      calibratedRoomId: null,
      createdAt: 1,
      quality: null,
    },
  });

  beforeEach(() => {
    useAppStore.getState().restart();
  });

  it('splits area by type and keeps the grand total', () => {
    seed([
      trace('a', 'gla', 10),      // 100
      trace('b', 'gla', 20),      // 400
      trace('c', 'garage', 30),   // 900
    ]);

    const areas = selectAreaByType(useAppStore.getState());
    expect(areas.byType).toEqual({ gla: 500, garage: 900 });
    expect(areas.counts).toEqual({ gla: 2, garage: 1 });
    expect(areas.gla).toBe(500);
    expect(areas.total).toBe(1400);
    expect(selectCombinedArea(useAppStore.getState())).toBe(1400);
  });

  it('treats an untyped trace as GLA', () => {
    const untyped = trace('legacy', undefined, 10);
    delete untyped.type;
    seed([untyped]);

    expect(selectAreaByType(useAppStore.getState()).gla).toBe(100);
  });

  it('drops a hidden trace from its own subtotal and from the total', () => {
    seed([trace('a', 'gla', 10), trace('b', 'garage', 20, false)]);

    const areas = selectAreaByType(useAppStore.getState());
    expect(areas.byType.garage).toBeUndefined();
    expect(areas.counts.garage).toBeUndefined();
    expect(areas.total).toBe(100);
  });

  // The memo is the correctness requirement: this returns an object, so without
  // a stable reference zustand's `Object.is` re-renders every consumer on every
  // unrelated `set()`.
  it('returns a reference-stable object across an unrelated set()', () => {
    seed([trace('a', 'gla', 10)]);
    const before = selectAreaByType(useAppStore.getState());

    useAppStore.getState().setIsProcessing(true, 'working');
    expect(selectAreaByType(useAppStore.getState())).toBe(before);

    useAppStore.getState().setPerimeterTraceType('a', 'porch');
    const after = selectAreaByType(useAppStore.getState());
    expect(after).not.toBe(before);
    expect(after.byType).toEqual({ porch: 100 });
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

// The calibration write path. `source` was a constant written everywhere and
// read nowhere; these pin it as real provenance, and pin the guard that keeps
// unrelated setters out of the scale.
describe('applyRoomCalibration provenance', () => {
  beforeEach(() => {
    useAppStore.getState().restart();
    undoManager.clear();
  });

  it('accepts both calibrating gestures and writes source from the argument', () => {
    useAppStore.getState().applyRoomCalibration({ x: 0.1, y: 0.1 }, null, 'room-calibration');
    expect(useAppStore.getState().calibration.source).toBe('room-calibration');

    useAppStore.getState().applyRoomCalibration({ x: 0.2, y: 0.2 }, null, 'line-calibration');
    expect(useAppStore.getState().calibration.source).toBe('line-calibration');
    expect(useAppStore.getState().calibration.feetPerPixel).toEqual({ x: 0.2, y: 0.2 });
  });

  it('still refuses anything outside the allowlist', () => {
    expect(CALIBRATION_SOURCES.has('room-calibration')).toBe(true);
    expect(CALIBRATION_SOURCES.has('line-calibration')).toBe(true);
    expect(() =>
      useAppStore.getState().applyRoomCalibration({ x: 0.1, y: 0.1 }, null, 'somewhere-else')
    ).toThrow();
    expect(useAppStore.getState().calibration.calibrated).toBe(false);
  });
});

// The lines a hand-set scale rests on are document content: undoable, exported,
// and — unlike `rooms` — untouched by a crop or an erase, because neither
// resamples and both keep image-pixel coordinates.
describe('scaleLines', () => {
  const LINE = { id: 'scale-1', start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, feet: 10 };

  beforeEach(() => {
    useAppStore.getState().restart();
    undoManager.clear();
  });

  it('is snapshotted, autosaved and exported; the tool flags are not', () => {
    expect(AUTOSAVE_FIELDS).toContain('scaleLines');
    expect(PERSISTENT_FLOOR_FIELDS).toContain('scaleLines');
    expect(PERSISTENT_FLOOR_FIELDS).not.toContain('scaleToolActive');
    expect(PERSISTENT_FLOOR_FIELDS).not.toContain('currentScaleLine');
  });

  it('survives a snapshot and undo round-trip with the calibration it set', () => {
    const s = useAppStore.getState();
    s.setImage('data:image/png;base64,AAAA'); // undoManager.save() no-ops without one
    s.addScaleLine(LINE);
    s.applyRoomCalibration({ x: 0.1, y: 0.1 }, null, 'line-calibration');

    undoManager.save();
    useAppStore.getState().setScaleLines([]);
    useAppStore.getState().applyRoomCalibration({ x: 0.5, y: 0.5 }, null, 'room-calibration');

    undoManager.undo();
    expect(useAppStore.getState().scaleLines).toEqual([LINE]);
    expect(useAppStore.getState().calibration.feetPerPixel).toEqual({ x: 0.1, y: 0.1 });
    expect(useAppStore.getState().calibration.source).toBe('line-calibration');
  });

  it('retires the scale it set when cleared, and leaves a room scale alone', () => {
    const s = useAppStore.getState();
    s.addScaleLine(LINE);
    s.applyRoomCalibration({ x: 0.1, y: 0.1 }, null, 'line-calibration');
    useAppStore.getState().clearLineCalibration();
    expect(useAppStore.getState().scaleLines).toEqual([]);
    expect(useAppStore.getState().calibration.calibrated).toBe(false);

    useAppStore.getState().applyRoomCalibration({ x: 0.3, y: 0.3 }, null, 'room-calibration');
    useAppStore.getState().clearLineCalibration();
    expect(useAppStore.getState().calibration.calibrated).toBe(true);
    expect(useAppStore.getState().calibration.feetPerPixel).toEqual({ x: 0.3, y: 0.3 });
  });
});

// nonGla.js normally carves the garage out of the footprint. When that fails,
// the garage is still inside the GLA outline, and tracing it by hand adds the
// same floor to both subtotals.
describe('double-count detection', () => {
  const box = (x1, y1, x2, y2) => [
    { x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 },
  ];
  const trace = (id, type, vertices, visible = true) => ({
    id, name: id, vertices, holes: [], closed: true, visible, locked: false,
    type, colorSource: 'type', nameSource: 'auto', color: '#BD93F9',
  });
  const seed = (list) => useAppStore.setState({
    perimeterTraces: list,
    activeTraceId: list[0]?.id ?? null,
    calibration: {
      calibrated: true, feetPerPixel: SCALE, source: 'room-calibration',
      calibratedRoomId: null, createdAt: 1, quality: null,
    },
  });

  beforeEach(() => {
    useAppStore.getState().restart();
  });

  it('flags a garage drawn inside the GLA outline', () => {
    seed([
      trace('house', 'gla', box(0, 0, 100, 100)),
      trace('garage', 'garage', box(10, 10, 40, 40)),
    ]);

    const { doubleCounted } = selectAreaByType(useAppStore.getState());
    expect(doubleCounted).toHaveLength(1);
    expect(doubleCounted[0]).toMatchObject({ innerId: 'garage', outerName: 'house' });
  });

  it('says nothing about a garage drawn beside the house', () => {
    seed([
      trace('house', 'gla', box(0, 0, 100, 100)),
      trace('garage', 'garage', box(200, 0, 260, 60)),
    ]);

    expect(selectAreaByType(useAppStore.getState()).doubleCounted).toEqual([]);
  });

  // Two storeys of a house are nested by construction and are not double counted.
  it('does not flag one GLA floor sitting inside another', () => {
    seed([
      trace('first', 'gla', box(0, 0, 100, 100)),
      trace('second', 'gla', box(10, 10, 90, 90)),
    ]);

    expect(selectAreaByType(useAppStore.getState()).doubleCounted).toEqual([]);
  });

  it('ignores a hidden trace, which is already out of both totals', () => {
    seed([
      trace('house', 'gla', box(0, 0, 100, 100)),
      trace('garage', 'garage', box(10, 10, 40, 40), false),
    ]);

    expect(selectAreaByType(useAppStore.getState()).doubleCounted).toEqual([]);
  });
});
