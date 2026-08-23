import { describe, expect, it } from 'vitest';
import {
  resolveAnchor, anchorBounds, UNANCHORED, DETECTOR_ANCHORED,
} from '../warningAnchors.js';
import { WARNING_CODES } from '../boundaryQuality.js';

const ring = (x0, y0, x1, y1) => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];

const traceA = { id: 'a', vertices: ring(0, 0, 100, 80) };
const traceB = { id: 'b', vertices: ring(200, 0, 320, 90) };

const ctx = () => ({
  trace: traceA,
  traces: [traceA, traceB],
  rooms: [
    { name: 'BEDROOM', rect: { left: 10, top: 10, right: 50, bottom: 40 } },
    { name: null, rect: { left: 60, top: 10, right: 90, bottom: 40 } },
  ],
  detectedDimensions: [
    { text: '12 x 14', bbox: { x: 200, y: 200, width: 40, height: 12 } },
  ],
});

// A plausible detail for each code, so the guard below exercises the resolver
// rather than a missing field.
const detailFor = (code) => {
  if (code === 'room-outside') return { name: 'BEDROOM', cover: 0.2 };
  if (code === 'label-outside') {
    return { count: 1, of: 3, names: ['12 x 14'], points: [{ x: 210, y: 206 }] };
  }
  if (code === 'floors-overlap') return { floors: [0, 1] };
  return { floor: 0 };
};

describe('resolveAnchor', () => {
  // The guard that keeps the panel honest: a warning added later cannot become
  // silently unclickable without someone saying so out loud.
  it('resolves every ranked code or declares it unanchorable', () => {
    for (const code of WARNING_CODES) {
      const anchor = resolveAnchor({ code, detail: detailFor(code) }, ctx());
      if (UNANCHORED.has(code) || DETECTOR_ANCHORED.has(code)) {
        expect(anchor, `${code} is declared unanchorable`).toBeNull();
      } else {
        expect(anchor, `${code} resolves an anchor`).not.toBeNull();
      }
    }
  });

  // The other half of the three-way split: a detector-anchored code must
  // actually use the anchor it is shipped. Declaring one and then dropping it
  // is the same silent unclickability the guard above exists to prevent.
  it('uses the anchor a detector-anchored warning arrives with', () => {
    const supplied = { kind: 'ring', rings: [ring(300, 300, 360, 340)] };
    for (const code of DETECTOR_ANCHORED) {
      const anchor = resolveAnchor({ code, detail: detailFor(code), anchor: supplied }, ctx());
      expect(anchor, `${code} keeps its detector anchor`).toEqual(supplied);
    }
  });

  it('declares nothing unanchorable that the detector never emits', () => {
    for (const code of [...UNANCHORED, ...DETECTOR_ANCHORED]) {
      expect(WARNING_CODES, code).toContain(code);
    }
  });

  it('points a whole-outline warning at the trace it belongs to', () => {
    const anchor = resolveAnchor({ code: 'self-intersecting', detail: { floor: 0 } }, ctx());
    expect(anchor.kind).toBe('ring');
    expect(anchor.rings).toEqual([traceA.vertices]);
  });

  it('returns nothing for a trace with no usable outline', () => {
    expect(resolveAnchor({ code: 'unsealed' }, { trace: { vertices: [] } })).toBeNull();
    expect(resolveAnchor({ code: 'unsealed' }, {})).toBeNull();
  });

  it('shows both floors of an overlap, and only its own when they are gone', () => {
    const both = resolveAnchor({ code: 'floors-overlap', detail: { floors: [0, 1] } }, ctx());
    expect(both.rings).toEqual([traceA.vertices, traceB.vertices]);

    const dropped = resolveAnchor(
      { code: 'floors-overlap', detail: { floors: [3, 4] } }, ctx(),
    );
    expect(dropped.rings).toEqual([traceA.vertices]);
  });

  it('prefers the recorded label points over matching by name', () => {
    const anchor = resolveAnchor({
      code: 'label-outside',
      detail: { names: ['12 x 14'], points: [{ x: 5, y: 6 }, { x: 7, y: 8 }] },
    }, ctx());
    expect(anchor).toEqual({ kind: 'point', points: [{ x: 5, y: 6 }, { x: 7, y: 8 }] });
  });

  it('falls back to the label text for traces made before points were recorded', () => {
    const anchor = resolveAnchor({
      code: 'label-outside', detail: { count: 1, names: ['12 x 14'] },
    }, ctx());
    expect(anchor).toEqual({ kind: 'point', points: [{ x: 220, y: 206 }] });
  });

  it('reports nothing rather than guessing when a label cannot be located', () => {
    expect(resolveAnchor({ code: 'label-outside', detail: { count: 2, names: [] } }, ctx()))
      .toBeNull();
  });

  it('finds the named room a room-outside warning describes', () => {
    const anchor = resolveAnchor({ code: 'room-outside', detail: { name: 'BEDROOM' } }, ctx());
    expect(anchor).toEqual({ kind: 'rect', x: 10, y: 10, width: 40, height: 30 });
  });

  // The real-app case: addRoom and useAutoScale both write `name: null`, so
  // name matching never resolves and the rect the detector was handed is the
  // only thing that identifies the room.
  it('resolves from the rect in the detail when the room has no name', () => {
    const warning = {
      code: 'room-outside',
      detail: { name: null, cover: 0.2, rect: { left: 70, top: 80, right: 120, bottom: 130 } },
    };
    expect(resolveAnchor(warning, ctx()))
      .toEqual({ kind: 'rect', x: 70, y: 80, width: 50, height: 50 });
  });

  it('prefers the detail rect over a same-named room', () => {
    const warning = {
      code: 'room-outside',
      detail: { name: 'BEDROOM', rect: { left: 0, top: 0, right: 5, bottom: 5 } },
    };
    expect(resolveAnchor(warning, ctx()))
      .toEqual({ kind: 'rect', x: 0, y: 0, width: 5, height: 5 });
  });

  it('does not fall back to the outline when the room cannot be identified', () => {
    expect(resolveAnchor({ code: 'room-outside', detail: { name: null } }, ctx())).toBeNull();
    expect(resolveAnchor({ code: 'room-outside', detail: { name: 'DEN' } }, ctx())).toBeNull();
  });
});

describe('anchorBounds', () => {
  it('bounds every anchor kind, and reports nothing for an empty one', () => {
    expect(anchorBounds({ kind: 'ring', rings: [traceA.vertices, traceB.vertices] }))
      .toEqual({ minX: 0, minY: 0, maxX: 320, maxY: 90 });
    expect(anchorBounds({ kind: 'rect', x: 10, y: 20, width: 5, height: 7 }))
      .toEqual({ minX: 10, minY: 20, maxX: 15, maxY: 27 });
    expect(anchorBounds({ kind: 'point', points: [{ x: 4, y: 9 }] }))
      .toEqual({ minX: 4, minY: 9, maxX: 4, maxY: 9 });
    expect(anchorBounds({ kind: 'point', points: [] })).toBeNull();
    expect(anchorBounds(null)).toBeNull();
  });
});

// Phase 2: the detector fills `anchor` at emission for warnings that have no
// live equivalent to derive one from.
describe('detector-emitted anchors', () => {
  it('prefers the emitted anchor over anything derived', () => {
    const emitted = { kind: 'segment', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] };
    const warning = { code: 'self-intersecting', detail: {}, anchor: emitted };
    // self-intersecting is a WHOLE_OUTLINE code, so Phase 1 would return the
    // trace ring. The detector's own geometry is more specific and must win.
    expect(resolveAnchor(warning, ctx())).toBe(emitted);
  });

  it('resolves a code that the live resolver alone cannot anchor', () => {
    const emitted = { kind: 'segment', runs: [[{ x: 0, y: 0 }, { x: 5, y: 0 }]] };
    expect(resolveAnchor({ code: 'weak-wall-support', detail: {}, anchor: emitted }, ctx()))
      .toBe(emitted);
    // Without one — a draft written before Phase 2 — it still declines rather
    // than inventing a highlight.
    expect(resolveAnchor({ code: 'bridged-opening', detail: {} }, ctx())).toBeNull();
  });

  it('bounds a multi-run segment across every run, so the camera frames them all', () => {
    const bounds = anchorBounds({
      kind: 'segment',
      runs: [[{ x: 0, y: 0 }, { x: 10, y: 0 }], [{ x: 90, y: 40 }, { x: 100, y: 50 }]],
    });
    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 50 });
  });
});
