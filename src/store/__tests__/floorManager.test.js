import { beforeEach, describe, expect, it } from 'vitest';
import useAppStore from '../appStore';

const square = (n) => [
  { x: 0, y: 0 }, { x: n, y: 0 }, { x: n, y: n }, { x: 0, y: n },
];

const traces = () => useAppStore.getState().perimeterTraces;

const openProjectWith = (names) => useAppStore.setState({
  perimeterTraces: names.map((name, i) => ({
    id: `saved-${i}`,
    name,
    vertices: square(10),
    holes: [],
    closed: true,
    visible: true,
    locked: false,
    color: '#BD93F9',
  })),
  activeTraceId: 'saved-0',
});

describe('applyDetectedTraces', () => {
  beforeEach(() => {
    useAppStore.getState().resetPerimeterTraces();
  });

  it('keeps a trace the user hid when re-tracing the same floor count', () => {
    useAppStore.getState().applyDetectedTraces([square(10), square(20)]);
    const hiddenId = traces()[1].id;
    useAppStore.getState().togglePerimeterTraceVisibility(hiddenId);
    expect(traces()[1].visible).toBe(false);

    useAppStore.getState().applyDetectedTraces([square(30), square(40)]);

    const after = traces();
    expect(after[1].id).toBe(hiddenId);
    expect(after[1].visible).toBe(false);
    expect(after[0].visible).toBe(true);
    expect(after[1].vertices).toEqual(square(40));
  });

  it('makes freshly created traces visible when the floor count changes', () => {
    useAppStore.getState().applyDetectedTraces([square(10), square(20)]);
    useAppStore.getState().togglePerimeterTraceVisibility(traces()[1].id);

    useAppStore.getState().applyDetectedTraces([square(10), square(20), square(30)]);

    expect(traces()).toHaveLength(3);
    expect(traces().every((t) => t.visible)).toBe(true);
  });
});

// The interior/exterior wall toggle lands here as well as in
// setPerimeterOverlay, and it is one click that does not look destructive.
describe('applyDetectedTraces and hand-punched voids', () => {
  const lightWell = [
    { x: 2, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 4 }, { x: 2, y: 4 },
  ];
  const courtyard = [
    { x: 6, y: 6 }, { x: 8, y: 6 }, { x: 8, y: 8 }, { x: 6, y: 8 },
  ];
  const autoFloor = (n) => ({
    vertices: square(n),
    holes: [{ id: 'hole-auto-0', ring: courtyard, source: 'auto' }],
    quality: null,
  });

  beforeEach(() => {
    useAppStore.getState().resetPerimeterTraces();
  });

  it('keeps a user void when the floor count is unchanged', () => {
    useAppStore.getState().applyDetectedTraces([square(10), square(20)]);
    const targetId = traces()[0].id;
    useAppStore.getState().addHole(targetId, lightWell);

    useAppStore.getState().applyDetectedTraces([autoFloor(30), autoFloor(40)]);

    const after = traces()[0];
    expect(after.id).toBe(targetId);
    expect(after.holes.filter((h) => h.source === 'user')).toHaveLength(1);
    expect(after.holes.filter((h) => h.source === 'user')[0].ring).toEqual(lightWell);
    expect(after.holes.filter((h) => h.source === 'auto')).toHaveLength(1);
  });

  it('replaces a detector void rather than accumulating one per re-trace', () => {
    useAppStore.getState().applyDetectedTraces([autoFloor(10)]);
    useAppStore.getState().applyDetectedTraces([autoFloor(20)]);
    useAppStore.getState().applyDetectedTraces([autoFloor(30)]);

    expect(traces()[0].holes).toHaveLength(1);
  });

  it('carries a user void across a floor-count change', () => {
    useAppStore.getState().applyDetectedTraces([square(10)]);
    useAppStore.getState().addHole(traces()[0].id, lightWell);

    useAppStore.getState().applyDetectedTraces([autoFloor(30), autoFloor(40)]);

    expect(traces()).toHaveLength(2);
    expect(traces()[0].holes.filter((h) => h.source === 'user')).toHaveLength(1);
    // The floor that did not exist before has only what the detector found.
    expect(traces()[1].holes.every((h) => h.source === 'auto')).toBe(true);
  });
});

describe('trace naming', () => {
  beforeEach(() => {
    useAppStore.getState().resetPerimeterTraces();
  });

  it('numbers from the traces on hand, not a session counter', () => {
    for (let i = 0; i < 5; i += 1) useAppStore.getState().addPerimeterTrace();
    expect(traces().map((t) => t.name)).toEqual([
      '1st Floor', '2nd Floor', '3rd Floor', '4th Floor', '5th Floor', '6th Floor',
    ]);

    // Reopening a two-floor project used to keep counting from 7.
    openProjectWith(['1st Floor', '2nd Floor']);
    useAppStore.getState().addPerimeterTrace();

    expect(traces()[2].name).toBe('3rd Floor');
  });

  it('does not reuse a number a renamed trace already holds', () => {
    openProjectWith(['Basement', '4th Floor']);
    useAppStore.getState().addPerimeterTrace();
    expect(traces()[2].name).toBe('5th Floor');
  });
});
