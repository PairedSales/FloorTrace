import { beforeEach, describe, expect, it } from 'vitest';
import useAppStore, { selectPerimeterOverlay } from '../appStore';
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
