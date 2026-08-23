import { beforeEach, describe, expect, it } from 'vitest';
import useAppStore from '../appStore';
import * as undoManager from '../undoManager';
import { MAX_TRACE_ATTEMPTS } from '../traceManager';
import { summariseIssues } from '../../utils/traceIssues';
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

// Ranked below `annexation`, so the two are deliberately stored in the reverse
// of the order the panel prints them — an index into the ranking would
// acknowledge the wrong one.
const TWO_WARNINGS = [
  { code: 'bridged-opening', severity: 'warn', message: 'a gap was closed' },
  { code: 'annexation', severity: 'warn', message: 'reaches past its walls' },
];

const issueCount = () => summariseIssues(traces(), null, [], null).count;

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

describe('acknowledged warnings', () => {
  const seed = () => {
    store().setPerimeterOverlay(result(square(10), 0.9, TWO_WARNINGS));
    return active().id;
  };

  it('takes one off the issue count and puts it back', () => {
    const id = seed();
    expect(issueCount()).toBe(2);

    expect(store().acknowledgeWarning(id, 1, 'checked against the plan')).toBe(true);
    expect(issueCount()).toBe(1);

    expect(store().unacknowledgeWarning(id, 1)).toBe(true);
    expect(issueCount()).toBe(2);
  });

  it('indexes the trace\'s own warnings, not the ranked order', () => {
    const id = seed();
    store().acknowledgeWarning(id, 1);

    const warnings = active().quality.warnings;
    expect(warnings[1].code).toBe('annexation');
    expect(warnings[1].acknowledged.at).toBeTypeOf('number');
    expect(warnings[0].acknowledged ?? null).toBe(null);
    // `annexation` outranks `bridged-opening`, so acknowledging the ranked
    // first row by its ranked position would have cleared the wrong one.
    expect(summariseIssues(traces(), null, [], null).issues[0].code).toBe('bridged-opening');
  });

  it('keeps the note and no-ops on a warning that was never acknowledged', () => {
    const id = seed();
    store().acknowledgeWarning(id, 0, 'the garage door is drawn open');
    expect(active().quality.warnings[0].acknowledged.note).toBe('the garage door is drawn open');
    expect(store().unacknowledgeWarning(id, 1)).toBe(false);
  });

  // `pipeline.js` fans a whole-drawing finding onto every floor and the panel
  // prints it once, so the row has to name the outline its index belongs to and
  // one click has to settle every copy.
  const SHEET_WARNING = { code: 'low-resolution', severity: 'warn', detail: { px: 2 } };
  const floor = (vertices) => ({
    vertices, holes: [], quality: { source: 'auto', confidence: 0.9, warnings: [SHEET_WARNING] },
  });

  it('settles a whole-drawing warning on every outline it was fanned onto', () => {
    store().applyDetectedTraces([floor(square(10)), floor(square(100))]);
    const [issue] = summariseIssues(traces(), null, [], null).issues;
    expect(issueCount()).toBe(1);
    // Without this the UI has an index and nothing to apply it to.
    expect(issue.traceId).toBe(traces()[0].id);

    expect(store().acknowledgeWarning(issue.traceId, issue.index)).toBe(true);

    expect(issueCount()).toBe(0);
    expect(traces()[1].quality.warnings[0].acknowledged).toBeTruthy();

    store().unacknowledgeWarning(issue.traceId, issue.index);
    expect(issueCount()).toBe(1);
    expect(traces()[1].quality.warnings[0].acknowledged ?? null).toBe(null);
  });

  // Accepting a fact about the *sheet* must not delete a doubt about *this
  // polygon* — that is the count going down by destroying the evidence.
  it('does not let a whole-drawing warning vouch for one outline', () => {
    store().setPerimeterOverlay(result(square(10), 0.6, [SHEET_WARNING]));
    const id = active().id;
    expect(issueCount()).toBe(2);

    store().acknowledgeWarning(id, 0);

    const { count, issues } = summariseIssues(traces(), null, [], null);
    expect(count).toBe(1);
    expect(issues[0].kind).toBe('low-confidence');
  });

  it('stops a fair outline claiming a reason to doubt it once its warnings are accepted', () => {
    // Below QUALITY_GOOD, so the low-confidence fallback is live.
    store().setPerimeterOverlay(result(square(10), 0.6, [TWO_WARNINGS[1]]));
    const id = active().id;
    expect(issueCount()).toBe(1);

    store().acknowledgeWarning(id, 0);

    expect(issueCount()).toBe(0);
  });
});

describe('the projections carry both', () => {
  // Neither is a field of its own: both ride inside `perimeterTraces`, which is
  // in all three projections by not being excluded from any of them. Asserted
  // rather than reasoned about, because that is exactly how `exteriorLabels`
  // came to be autosaved and not exported.
  it('reaches the autosaved draft and the undo snapshot', () => {
    // `undoManager.save()` no-ops without one.
    store().setImage('data:image/png;base64,AA');
    store().setPerimeterOverlay(result(square(10), 0.9));
    store().setPerimeterOverlay(result(square(20), 0.4, TWO_WARNINGS));
    store().acknowledgeWarning(active().id, 0, 'checked');

    const draft = store().getAutosaveState();
    expect(draft.perimeterTraces[0].attempts).toHaveLength(1);
    expect(draft.perimeterTraces[0].quality.warnings[0].acknowledged.note).toBe('checked');

    undoManager.undo();

    expect(active().quality.warnings[0].acknowledged ?? null).toBe(null);
    expect(active().attempts).toHaveLength(1);
    expect(active().attempts[0].vertices).toEqual(square(10));
  });
});

describe('.floorplan round trip', () => {
  it('carries attempt history and acknowledgements', () => {
    store().setPerimeterOverlay(result(square(10), 0.9, TWO_WARNINGS));
    store().setPerimeterOverlay(result(square(20), 0.4));
    store().acknowledgeWarning(active().id, 0, 'checked');

    const project = serializeSketch(useAppStore.getState());
    const { statePatch } = importProject(JSON.stringify(project));

    const trace = statePatch.perimeterTraces[0];
    expect(trace.attempts).toHaveLength(1);
    expect(trace.attempts[0].vertices).toEqual(square(10));
    expect(trace.attempts[0].confidence).toBe(0.9);
    expect(trace.attempts[0].quality.warnings).toHaveLength(2);
    expect(trace.vertices).toEqual(square(20));
  });

  it('carries an acknowledgement that survives a reopen', () => {
    store().setPerimeterOverlay(result(square(10), 0.9, TWO_WARNINGS));
    store().acknowledgeWarning(active().id, 1, 'checked');

    const project = serializeSketch(useAppStore.getState());
    const { statePatch } = importProject(JSON.stringify(project));

    const warnings = statePatch.perimeterTraces[0].quality.warnings;
    expect(warnings[1].acknowledged.note).toBe('checked');
    expect(summariseIssues(statePatch.perimeterTraces, null, [], null).count).toBe(1);
  });

  it('gives a file written before attempts existed an empty list', () => {
    store().setPerimeterOverlay(result(square(10), 0.9));
    const project = serializeSketch(useAppStore.getState());
    delete project.floors[0].state.perimeterTraces[0].attempts;

    const { statePatch } = importProject(JSON.stringify(project));

    expect(statePatch.perimeterTraces[0].attempts).toEqual([]);
  });
});
