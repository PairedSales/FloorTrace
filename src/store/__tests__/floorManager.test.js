import { beforeEach, describe, expect, it } from 'vitest';
import useAppStore from '../appStore';
import * as undoManager from '../undoManager';
import { DEFAULT_TRACE_TYPE, normalizeTraces, traceTypeColor } from '../../utils/traceTypes';

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

// The exterior/interior switch is one setting for the whole canvas. It used to
// re-apply `tracedBoundaries`, which holds only the most recent detection run —
// so a plan traced in two passes switched the outlines of the second pass and
// left the first pass measured to the other wall face, with nothing on screen
// saying so.
describe('setWallFaceMode', () => {
  const faces = (out, inn) => ({
    outer: { vertices: square(out), holes: [] },
    inner: { vertices: square(inn), holes: [] },
  });
  const detected = (out, inn) => ({ vertices: square(out), holes: [], wallFaces: faces(out, inn) });

  const seedTwoPasses = () => {
    useAppStore.getState().applyDetectedTraces([detected(100, 90)]);
    const first = traces()[0].id;
    // A second pass: a fresh trace, detected on its own, as tracing a garage
    // after the house does.
    useAppStore.setState({
      perimeterTraces: [
        ...traces(),
        {
          id: 'second-pass',
          name: 'Garage',
          ...detected(50, 44),
          closed: true,
          visible: true,
          locked: false,
          type: 'garage',
          colorSource: 'type',
          nameSource: 'auto',
          color: '#FFB86C',
        },
      ],
      activeTraceId: 'second-pass',
    });
    return first;
  };

  beforeEach(() => {
    useAppStore.getState().resetPerimeterTraces();
  });

  it('switches every outline, not just the active one', () => {
    const firstPassId = seedTwoPasses();

    expect(useAppStore.getState().setWallFaceMode(true)).toBe(2);

    const after = traces();
    expect(after.find((t) => t.id === firstPassId).vertices).toEqual(square(90));
    expect(after.find((t) => t.id === 'second-pass').vertices).toEqual(square(44));

    useAppStore.getState().setWallFaceMode(false);
    expect(traces().find((t) => t.id === firstPassId).vertices).toEqual(square(100));
    expect(traces().find((t) => t.id === 'second-pass').vertices).toEqual(square(50));
  });

  it('leaves an outline the user drew by hand alone', () => {
    useAppStore.getState().applyDetectedTraces([detected(100, 90)]);
    useAppStore.getState().addPerimeterTrace();
    const handId = traces()[1].id;
    useAppStore.getState().setPerimeterOverlay({ vertices: square(7) });

    expect(useAppStore.getState().setWallFaceMode(true)).toBe(1);

    expect(traces()[0].vertices).toEqual(square(90));
    expect(traces().find((t) => t.id === handId).vertices).toEqual(square(7));
  });

  // The caller falls back to the legacy re-apply on 0, so "no outline carries a
  // pair" has to be distinguishable from "switched".
  it('reports zero when nothing carries a pair', () => {
    useAppStore.getState().applyDetectedTraces([square(10), square(20)]);

    expect(useAppStore.getState().setWallFaceMode(true)).toBe(0);
    expect(traces()[0].vertices).toEqual(square(10));
  });

  it('keeps a void the user punched and re-checks it against the new outline', () => {
    useAppStore.getState().applyDetectedTraces([detected(100, 90)]);
    const id = traces()[0].id;
    useAppStore.getState().addHole(id, [
      { x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }, { x: 10, y: 20 },
    ]);

    useAppStore.getState().setWallFaceMode(true);

    const userHoles = traces()[0].holes.filter((h) => h.source === 'user');
    expect(userHoles).toHaveLength(1);
    expect(userHoles[0].stale).toBeUndefined();
  });

  // A later vertex drag must not reach back into the stored pair, or switching
  // away and back would return geometry that had quietly moved.
  it('hands out a copy, so editing the applied outline cannot rewrite the pair', () => {
    useAppStore.getState().applyDetectedTraces([detected(100, 90)]);
    useAppStore.getState().setWallFaceMode(true);

    const dragged = traces()[0].vertices.map((v, i) => (i === 0 ? { x: 999, y: 999 } : v));
    useAppStore.getState().setPerimeterOverlay({ vertices: dragged });
    expect(traces()[0].wallFaces.inner.vertices).toEqual(square(90));

    // And the pair survives the edit, so the switch still works on this outline.
    expect(useAppStore.getState().setWallFaceMode(false)).toBe(1);
    expect(traces()[0].vertices).toEqual(square(100));
  });

  // The pair is a cache of ink the crop/erase has changed, exactly like
  // `tracedBoundaries`, and is dropped with it.
  it('clearWallFaces leaves the outlines but forgets the other face', () => {
    useAppStore.getState().applyDetectedTraces([detected(100, 90)]);

    useAppStore.getState().clearWallFaces();

    expect(traces()[0].vertices).toEqual(square(100));
    expect(traces()[0].wallFaces).toBeNull();
    expect(useAppStore.getState().setWallFaceMode(true)).toBe(0);
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

  // A garage used to arrive called "3rd Floor" and stay that way until renamed.
  it('names an auto-named trace for its type when the type changes', () => {
    useAppStore.getState().setImage('data:image/png;base64,AAAA');
    useAppStore.getState().addPerimeterTrace();
    expect(traces()[1].name).toBe('2nd Floor');

    useAppStore.getState().setPerimeterTraceType(traces()[1].id, 'garage');
    expect(traces()[1].name).toBe('Garage');

    useAppStore.getState().setPerimeterTraceType(traces()[1].id, 'below-grade');
    expect(traces()[1].name).toBe('Basement');

    // Back to GLA and it rejoins the storey numbering.
    useAppStore.getState().setPerimeterTraceType(traces()[1].id, 'gla');
    expect(traces()[1].name).toBe('2nd Floor');
  });

  // The guarantee that makes the rename safe to do automatically.
  it('never overwrites a name the user typed', () => {
    useAppStore.getState().setImage('data:image/png;base64,AAAA');
    const id = traces()[0].id;
    useAppStore.getState().renamePerimeterTrace(id, 'Guest Wing');
    expect(traces()[0].nameSource).toBe('user');

    useAppStore.getState().setPerimeterTraceType(id, 'garage');

    expect(traces()[0].name).toBe('Guest Wing');
    expect(traces()[0].type).toBe('garage');
  });

  it('numbers a second trace of the same type rather than colliding', () => {
    useAppStore.getState().setImage('data:image/png;base64,AAAA');
    useAppStore.getState().addPerimeterTrace();
    useAppStore.getState().setPerimeterTraceType(traces()[0].id, 'garage');
    useAppStore.getState().setPerimeterTraceType(traces()[1].id, 'garage');

    expect(traces().map((t) => t.name)).toEqual(['Garage', 'Garage 2']);
  });

  // Inferred from the name, not defaulted: a project saved before nameSource
  // existed must not have its renames treated as auto-generated.
  it('infers nameSource from the name for a project saved before it existed', () => {
    openProjectWith(['2nd Floor', 'Guest Wing']);
    const normalized = normalizeTraces(traces());

    expect(normalized[0].nameSource).toBe('auto');
    expect(normalized[1].nameSource).toBe('user');
  });
});

// A basement reported as living area is the same wrong answer as an outline
// traced in the wrong place, and nothing else on the page corrects it.
describe('classifyTraceTypes', () => {
  const offsetSquare = (x, y, n) => [
    { x, y }, { x: x + n, y }, { x: x + n, y: y + n }, { x, y: y + n },
  ];
  const basementIn = (x, y) => ({
    type: 'below-grade',
    keyword: 'basement',
    text: 'BASEMENT',
    bbox: { x, y, width: 60, height: 12 },
  });

  beforeEach(() => {
    useAppStore.getState().resetPerimeterTraces();
    useAppStore.setState({ areaLabels: [] });
  });

  // The reported case: fixtures/ExampleFloorplan2 traces four plans off one
  // sheet, and the third holds two BASEMENT room labels.
  it('types the outline the basement labels sit in, and renames it', () => {
    useAppStore.getState().applyDetectedTraces([
      offsetSquare(0, 0, 300), offsetSquare(400, 0, 300), offsetSquare(0, 400, 300),
    ]);
    useAppStore.setState({ areaLabels: [basementIn(100, 500), basementIn(100, 600)] });

    const changes = useAppStore.getState().classifyTraceTypes();

    expect(traces().map((t) => t.type)).toEqual(['gla', 'gla', 'below-grade']);
    expect(traces()[2].name).toBe('Basement');
    expect(traces()[2].typeSource).toBe('detected');
    expect(traces()[2].typeEvidence.text).toBe('BASEMENT');
    expect(changes).toEqual([
      { id: traces()[2].id, name: 'Basement', type: 'below-grade', from: 'gla' },
    ]);
  });

  it('reports nothing and touches nothing when the plan has no level names', () => {
    useAppStore.getState().applyDetectedTraces([offsetSquare(0, 0, 300)]);
    const before = traces();

    expect(useAppStore.getState().classifyTraceTypes()).toEqual([]);
    expect(traces()).toBe(before);
  });

  it('never overrules a type the user picked', () => {
    useAppStore.getState().applyDetectedTraces([offsetSquare(0, 0, 300)]);
    useAppStore.getState().setPerimeterTraceType(traces()[0].id, 'garage');
    useAppStore.setState({ areaLabels: [basementIn(100, 100)] });

    expect(useAppStore.getState().classifyTraceTypes()).toEqual([]);
    expect(traces()[0].type).toBe('garage');
  });

  it('keeps a name the user typed while still retyping the outline', () => {
    useAppStore.getState().applyDetectedTraces([offsetSquare(0, 0, 300)]);
    useAppStore.getState().renamePerimeterTrace(traces()[0].id, 'Guest Wing');
    useAppStore.setState({ areaLabels: [basementIn(100, 100)] });

    useAppStore.getState().classifyTraceTypes();

    expect(traces()[0].type).toBe('below-grade');
    expect(traces()[0].name).toBe('Guest Wing');
  });

  it('is idempotent — re-running it changes nothing and reports nothing', () => {
    useAppStore.getState().applyDetectedTraces([offsetSquare(0, 0, 300)]);
    useAppStore.setState({ areaLabels: [basementIn(100, 100)] });
    useAppStore.getState().classifyTraceTypes();
    const after = traces();

    expect(useAppStore.getState().classifyTraceTypes()).toEqual([]);
    expect(traces()).toBe(after);
  });

  // A detected type is the app's claim about the plan, so it must not outlive
  // the words it was read from — a crop or a re-scan can take them away.
  it('puts an outline back to GLA when its label is gone', () => {
    useAppStore.getState().applyDetectedTraces([offsetSquare(0, 0, 300)]);
    useAppStore.setState({ areaLabels: [basementIn(100, 100)] });
    useAppStore.getState().classifyTraceTypes();
    expect(traces()[0].type).toBe('below-grade');

    useAppStore.setState({
      areaLabels: [{
        type: 'gla', keyword: 'floor 1', text: 'FLOOR 1',
        bbox: { x: 900, y: 900, width: 60, height: 12 },
      }],
    });
    const changes = useAppStore.getState().classifyTraceTypes();

    expect(traces()[0].type).toBe(DEFAULT_TRACE_TYPE);
    expect(traces()[0].typeSource).toBe('auto');
    expect(traces()[0].typeEvidence).toBeNull();
    expect(changes).toHaveLength(1);
  });

  // The re-trace guarantee, now that a type can arrive without the user.
  it('survives the interior/exterior re-trace that follows it', () => {
    useAppStore.getState().applyDetectedTraces([offsetSquare(0, 0, 300)]);
    useAppStore.setState({ areaLabels: [basementIn(100, 100)] });
    useAppStore.getState().classifyTraceTypes();

    useAppStore.getState().applyDetectedTraces([offsetSquare(0, 0, 290)]);

    expect(traces()[0].type).toBe('below-grade');
    expect(traces()[0].typeSource).toBe('detected');
  });

  it('numbers a second basement rather than colliding with the first', () => {
    useAppStore.getState().applyDetectedTraces([
      offsetSquare(0, 0, 300), offsetSquare(400, 0, 300),
    ]);
    useAppStore.setState({ areaLabels: [basementIn(100, 100), basementIn(500, 100)] });

    useAppStore.getState().classifyTraceTypes();

    expect(traces().map((t) => t.name)).toEqual(['Basement', 'Basement 2']);
  });

  // A project saved before classification existed holds a type only because
  // the user picked it, so reopening it and re-tracing must not take it back.
  it('treats a type from a project saved before it existed as the user\'s', () => {
    openProjectWith(['Garage']);
    useAppStore.setState({
      perimeterTraces: normalizeTraces(traces().map((t) => ({ ...t, type: 'garage' }))),
    });

    expect(traces()[0].typeSource).toBe('user');
  });
});
