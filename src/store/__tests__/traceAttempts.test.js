import { beforeEach, describe, expect, it } from 'vitest';
import useAppStore from '../appStore';
import * as undoManager from '../undoManager';
import { MAX_TRACE_ATTEMPTS } from '../traceManager';
import { serializeSketch, importProject } from '../../utils/projectSerializer';

const square = (n) => [
  { x: 0, y: 0 }, { x: n, y: 0 }, { x: n, y: n }, { x: 0, y: n },
];

// A detection result landing: it carries its own `quality`, which is what tells
// `setPerimeterOverlay` this is a replacement rather than a hand edit.
const result = (vertices, confidence, warnings = []) => ({
  vertices,
  holes: [],
  quality: { source: 'auto', confidence, warnings },
});

const store = () => useAppStore.getState();
const traces = () => store().perimeterTraces;
const active = () => traces().find((t) => t.id === store().activeTraceId);

const TWO_WARNINGS = [
  { code: 'bridged-opening', severity: 'warn', message: 'a gap was closed' },
  { code: 'annexation', severity: 'warn', message: 'reaches past its walls' },
];

beforeEach(() => {
  store().resetPerimeterTraces();
  store().setImage(null);
  undoManager.clear();
});

describe('attempt history', () => {
  it('records the outline a re-trace replaces, and not the first one', () => {
    store().setPerimeterOverlay(result(square(10), 0.9));
    // Nothing was superseded: the trace was empty.
    expect(active().attempts).toHaveLength(0);

    store().setPerimeterOverlay(result(square(20), 0.6));

    expect(active().vertices).toEqual(square(20));
    expect(active().attempts).toHaveLength(1);
    expect(active().attempts[0].vertices).toEqual(square(10));
    expect(active().attempts[0].confidence).toBe(0.9);
    expect(active().attempts[0].source).toBe('auto');
    // px², scale-free.
    expect(active().attempts[0].area).toBe(100);
  });

  it('records through applyDetectedTraces when a re-trace lands on the same building', () => {
    store().applyDetectedTraces([square(10), square(20)]);
    expect(traces().every((t) => t.attempts.length === 0)).toBe(true);

    store().applyDetectedTraces([square(11), square(21)]);

    expect(traces()[0].attempts).toHaveLength(1);
    expect(traces()[0].attempts[0].vertices).toEqual(square(10));
    expect(traces()[1].attempts[0].vertices).toEqual(square(20));
  });

  it('records the first hand edit and nothing after it', () => {
    store().setPerimeterOverlay(result(square(10), 0.9));
    store().setPerimeterOverlay(result(square(20), 0.9));
    expect(active().attempts).toHaveLength(1);

    const nudged = [{ x: 0, y: 0 }, { x: 22, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }];
    store().setPerimeterOverlay({ vertices: nudged });
    expect(active().attempts).toHaveLength(2);
    expect(active().attempts[1].vertices).toEqual(square(20));

    const nudgedAgain = [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }];
    store().setPerimeterOverlay({ vertices: nudgedAgain });

    expect(active().vertices).toEqual(nudgedAgain);
    expect(active().attempts).toHaveLength(2);
  });

  it('keeps the newest attempts under the cap', () => {
    for (let i = 1; i <= MAX_TRACE_ATTEMPTS + 2; i += 1) {
      store().setPerimeterOverlay(result(square(i * 10), 0.9));
    }
    const kept = active().attempts;
    expect(kept).toHaveLength(MAX_TRACE_ATTEMPTS);
    // The empty trace recorded nothing, so six were pushed and the oldest
    // fell off; the newest is the outline the last result just replaced.
    expect(kept[0].vertices).toEqual(square(20));
    expect(kept[kept.length - 1].vertices).toEqual(square((MAX_TRACE_ATTEMPTS + 1) * 10));
  });

  it('reverts geometry, quality and holes, and records what it left', () => {
    store().setPerimeterOverlay({
      vertices: square(10),
      holes: [{ id: 'hole-auto-0', ring: square(4), source: 'auto' }],
      quality: { source: 'auto', confidence: 0.9, warnings: [] },
      wallFaces: { outer: { vertices: square(10), holes: [] }, inner: null },
    });
    store().setPerimeterOverlay(result(square(20), 0.3));
    expect(active().quality.confidence).toBe(0.3);

    expect(store().revertTraceToAttempt(active().id, 0)).toBe(true);

    expect(active().vertices).toEqual(square(10));
    expect(active().quality.confidence).toBe(0.9);
    expect(active().holes[0].ring).toEqual(square(4));
    // The pair belonged to the result that has just been reverted away from.
    expect(active().wallFaces).toBe(null);
    // Reverting is itself recoverable.
    expect(active().attempts).toHaveLength(2);
    expect(active().attempts[1].vertices).toEqual(square(20));
  });

  it('refuses an index that names no attempt', () => {
    store().setPerimeterOverlay(result(square(10), 0.9));
    expect(store().revertTraceToAttempt(active().id, 0)).toBe(false);
    expect(store().revertTraceToAttempt('no-such-trace', 0)).toBe(false);
  });

  // Reverting records what it leaves, so a second click on the row you are
  // already standing on would bank a duplicate and, five clicks in, push the
  // detector's own result off the end of the cap.
  it('refuses a revert to the geometry it is already showing', () => {
    store().setPerimeterOverlay(result(square(10), 0.9));
    store().setPerimeterOverlay(result(square(20), 0.3));

    const id = active().id;
    expect(store().revertTraceToAttempt(id, 0)).toBe(true);
    expect(store().revertTraceToAttempt(id, 0)).toBe(false);
    expect(active().attempts).toHaveLength(2);
  });
});

describe('the projections carry the attempts and the detector’s findings', () => {
  // Neither is a field of its own: both ride inside `perimeterTraces`, which is
  // in all three projections by not being excluded from any of them. Asserted
  // rather than reasoned about, because that is exactly how `exteriorLabels`
  // came to be autosaved and not exported.
  it('reaches the autosaved draft and the undo snapshot', () => {
    // `undoManager.save()` no-ops without one.
    store().setImage('data:image/png;base64,AA');
    store().setPerimeterOverlay(result(square(10), 0.9));
    undoManager.save();
    store().setPerimeterOverlay(result(square(20), 0.4, TWO_WARNINGS));

    const draft = store().getAutosaveState();
    expect(draft.perimeterTraces[0].attempts).toHaveLength(1);
    // Nothing on screen lists them any more, and they are kept all the same.
    expect(draft.perimeterTraces[0].quality.warnings).toHaveLength(2);

    undoManager.undo();

    expect(active().quality.warnings).toHaveLength(0);
    expect(active().vertices).toEqual(square(10));
  });
});

describe('.floorplan round trip', () => {
  it('carries attempt history', () => {
    store().setPerimeterOverlay(result(square(10), 0.9, TWO_WARNINGS));
    store().setPerimeterOverlay(result(square(20), 0.4));

    const project = serializeSketch(useAppStore.getState());
    const { statePatch } = importProject(JSON.stringify(project));

    const trace = statePatch.perimeterTraces[0];
    expect(trace.attempts).toHaveLength(1);
    expect(trace.attempts[0].vertices).toEqual(square(10));
    expect(trace.attempts[0].confidence).toBe(0.9);
    expect(trace.attempts[0].quality.warnings).toHaveLength(2);
    expect(trace.vertices).toEqual(square(20));
  });

  // Nothing writes an acknowledgement any more — the list it took a finding
  // off is gone — but files saved while it existed carry one, and must open.
  it('still opens a file that carries an acknowledged finding', () => {
    const reviewed = { ...TWO_WARNINGS[1], acknowledged: { at: 1, note: 'checked' } };
    store().setPerimeterOverlay(result(square(10), 0.9, [TWO_WARNINGS[0], reviewed]));

    const project = serializeSketch(useAppStore.getState());
    const { statePatch } = importProject(JSON.stringify(project));

    const warnings = statePatch.perimeterTraces[0].quality.warnings;
    expect(warnings).toHaveLength(2);
    expect(warnings[1].acknowledged.note).toBe('checked');
  });

  it('gives a file written before attempts existed an empty list', () => {
    store().setPerimeterOverlay(result(square(10), 0.9));
    const project = serializeSketch(useAppStore.getState());
    delete project.floors[0].state.perimeterTraces[0].attempts;

    const { statePatch } = importProject(JSON.stringify(project));

    expect(statePatch.perimeterTraces[0].attempts).toEqual([]);
  });
});
