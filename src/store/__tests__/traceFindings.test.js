import { beforeEach, describe, expect, it } from 'vitest';
import useAppStore from '../appStore';
import * as undoManager from '../undoManager';
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
const active = () => store().perimeterTraces.find((t) => t.id === store().activeTraceId);

const TWO_WARNINGS = [
  { code: 'bridged-opening', severity: 'warn', message: 'a gap was closed' },
  { code: 'annexation', severity: 'warn', message: 'reaches past its walls' },
];

beforeEach(() => {
  store().restart();
  undoManager.clear();
});

describe('the projections carry the detector’s findings', () => {
  // Not a field of their own: they ride inside `perimeterTraces`, which is in
  // all three projections by not being excluded from any of them. Asserted
  // rather than reasoned about, because that is exactly how `exteriorLabels`
  // came to be autosaved and not exported.
  it('reaches the autosaved draft and the undo snapshot', () => {
    // `undoManager.save()` no-ops without one.
    store().setImage('data:image/png;base64,AA');
    store().setPerimeterOverlay(result(square(10), 0.9));
    undoManager.save();
    store().setPerimeterOverlay(result(square(20), 0.4, TWO_WARNINGS));

    const draft = store().getParkedState();
    // Nothing on screen lists them any more, and they are kept all the same.
    expect(draft.perimeterTraces[0].quality.warnings).toHaveLength(2);

    undoManager.undo();

    expect(active().quality.warnings).toHaveLength(0);
    expect(active().vertices).toEqual(square(10));
  });
});

describe('.floorplan round trip', () => {
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

  // An outline used to keep up to five earlier versions of itself, and a file
  // saved then carries them. Nothing could ever reach them, so they are not
  // brought back in, and so not written back out.
  it('drops the earlier versions an older file carries', () => {
    store().setPerimeterOverlay(result(square(20), 0.9));
    const project = serializeSketch(useAppStore.getState());
    project.floors[0].state.perimeterTraces[0].attempts = [{
      at: 1700000000000,
      source: 'auto',
      confidence: 0.4,
      area: 100,
      vertices: square(10),
      holes: [],
      quality: { source: 'auto', confidence: 0.4, warnings: TWO_WARNINGS },
      remediation: null,
    }];

    const { statePatch } = importProject(JSON.stringify(project));

    expect(statePatch.perimeterTraces[0].vertices).toEqual(square(20));
    expect(Object.hasOwn(statePatch.perimeterTraces[0], 'attempts')).toBe(false);
  });
});
