import { beforeEach, describe, expect, it } from 'vitest';
import useAppStore from '../appStore';
import * as undoManager from '../undoManager';
import { DEFAULT_TRACE_TYPE, traceTypeColor } from '../../utils/traceTypes';

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

describe('trace types', () => {
  beforeEach(() => {
    useAppStore.getState().resetPerimeterTraces();
    undoManager.clear();
  });

  it('defaults a new trace to GLA and takes its colour from the type table', () => {
    useAppStore.getState().addPerimeterTrace();

    const added = traces()[1];
    expect(added.type).toBe(DEFAULT_TRACE_TYPE);
    expect(added.colorSource).toBe('type');
    // Second GLA trace, so the base colour belongs to the first one.
    expect(traces()[0].color).toBe(traceTypeColor(DEFAULT_TRACE_TYPE));
    expect(added.color).not.toBe(traces()[0].color);
  });

  it('gives two GLA traces distinguishable colours and re-shades on delete', () => {
    // Via the detector rather than addPerimeterTrace: `trace-${Date.now()}`
    // mints the same id twice inside one millisecond.
    useAppStore.getState().applyDetectedTraces([square(10), square(20)]);
    const [first, second] = traces();
    expect(first.color).not.toBe(second.color);

    useAppStore.getState().deletePerimeterTrace(first.id);

    // The survivor is now the first of its type, so it takes the base colour.
    expect(traces()).toHaveLength(1);
    expect(traces()[0].id).toBe(second.id);
    expect(traces()[0].color).toBe(traceTypeColor(DEFAULT_TRACE_TYPE));
  });

  it('setPerimeterTraceType pushes an undo snapshot and marks the project dirty', () => {
    useAppStore.getState().setImage('data:image/png;base64,AAAA');
    useAppStore.getState().setIsDirty(false);
    const id = traces()[0].id;

    useAppStore.getState().setPerimeterTraceType(id, 'garage');

    expect(traces()[0].type).toBe('garage');
    expect(traces()[0].color).toBe(traceTypeColor('garage'));
    expect(useAppStore.getState().isDirty).toBe(true);

    expect(undoManager.undo()).toBe(true);
    expect(traces()[0].type).toBe(DEFAULT_TRACE_TYPE);
  });

  it('falls back to GLA for an unknown type id', () => {
    useAppStore.getState().setImage('data:image/png;base64,AAAA');
    useAppStore.getState().setPerimeterTraceType(traces()[0].id, 'attic');
    expect(traces()[0].type).toBe(DEFAULT_TRACE_TYPE);
  });

  // The re-trace guarantee: flipping the interior/exterior wall toggle
  // re-applies the detector result, and must not reset a garage back to GLA.
  it('keeps a hand-assigned type when re-tracing the same floor count', () => {
    useAppStore.getState().setImage('data:image/png;base64,AAAA');
    useAppStore.getState().applyDetectedTraces([square(10), square(20)]);
    const garageId = traces()[1].id;
    useAppStore.getState().setPerimeterTraceType(garageId, 'garage');

    useAppStore.getState().applyDetectedTraces([square(30), square(40)]);

    const after = traces();
    expect(after[1].id).toBe(garageId);
    expect(after[1].type).toBe('garage');
    expect(after[0].type).toBe(DEFAULT_TRACE_TYPE);
    expect(after[1].vertices).toEqual(square(40));
  });

  it('leaves a colour alone when it was not derived from the type', () => {
    useAppStore.setState({
      perimeterTraces: [{
        id: 'hand-picked',
        name: 'Basement',
        vertices: square(10),
        closed: true,
        visible: true,
        locked: false,
        color: '#FF5555',
        type: DEFAULT_TRACE_TYPE,
        colorSource: 'user',
      }],
      activeTraceId: 'hand-picked',
      image: 'data:image/png;base64,AAAA',
    });

    useAppStore.getState().setPerimeterTraceType('hand-picked', 'below-grade');

    expect(traces()[0].type).toBe('below-grade');
    expect(traces()[0].color).toBe('#FF5555');
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
