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

// Ids used to be `trace-${Date.now()}`, so anything minted inside one
// millisecond collided — and `deletePerimeterTrace` filters by id, so deleting
// one of the twins deleted both.
describe('trace ids', () => {
  beforeEach(() => {
    useAppStore.getState().resetPerimeterTraces();
  });

  const distinct = () => new Set(traces().map((t) => t.id));

  it('are distinct for traces created in a tight loop', () => {
    for (let i = 0; i < 6; i += 1) useAppStore.getState().addPerimeterTrace();

    expect(traces()).toHaveLength(7); // the reset default + 6
    expect(distinct().size).toBe(7);
  });

  it('deletes exactly one trace when several were created in the same tick', () => {
    for (let i = 0; i < 3; i += 1) useAppStore.getState().addPerimeterTrace();
    const doomed = traces()[1].id;

    useAppStore.getState().deletePerimeterTrace(doomed);

    expect(traces()).toHaveLength(3);
    expect(traces().some((t) => t.id === doomed)).toBe(false);
  });

  it('does not collide across the reset, overlay and detection mints', () => {
    const fromReset = traces()[0].id;

    // setPerimeterOverlay's no-active-trace branch mints its own id.
    useAppStore.setState({ perimeterTraces: [], activeTraceId: null });
    useAppStore.getState().setPerimeterOverlay({ vertices: square(10) });
    const fromOverlay = traces()[0].id;

    useAppStore.getState().addPerimeterTrace();
    const fromAdd = traces()[1].id;

    // Two detection runs in the same tick. Both change the floor count, so both
    // mint fresh ids — the equal-count branch reuses ids on purpose, to keep
    // renames across a re-trace, and is not what this test is about.
    useAppStore.getState().applyDetectedTraces([square(10), square(20), square(30)]);
    const firstRun = traces().map((t) => t.id);
    useAppStore.getState().applyDetectedTraces([square(40), square(50)]);
    const secondRun = traces().map((t) => t.id);

    const all = [fromReset, fromOverlay, fromAdd, ...firstRun, ...secondRun];
    expect(new Set(all).size).toBe(all.length);
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
