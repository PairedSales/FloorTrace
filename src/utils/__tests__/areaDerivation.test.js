import { describe, expect, it } from 'vitest';
import { buildAreaDerivation } from '../areaDerivation';
import { scaleProvenance } from '../scaleProvenance';
import { calculateArea } from '../areaCalculator';
import { areaDisplayValue } from '../unitConverter';
import { computeAreaByType } from '../../store/appStore';
import { resolveScaleUpdate } from '../detection/validate.js';

const rect = (w, h, ox = 0, oy = 0) => ([
  { x: ox, y: oy }, { x: ox + w, y: oy }, { x: ox + w, y: oy + h }, { x: ox, y: oy + h },
]);

const trace = (over = {}) => ({
  id: 'trace-1',
  name: '1st Floor',
  color: '#BD93F9',
  type: 'gla',
  visible: true,
  vertices: rect(100, 50),
  holes: [],
  ...over,
});

// 1 ft = 10 px, so a 100 x 50 px rectangle is 10 ft x 5 ft = 50 sq ft.
const calibrated = {
  calibrated: true,
  feetPerPixel: { x: 0.1, y: 0.1 },
  source: 'room-calibration',
  quality: { source: 'auto', level: 'ok', roomCount: 4 },
};

const state = (over = {}) => ({
  unit: 'decimal',
  calibration: calibrated,
  perimeterTraces: [trace()],
  rooms: [],
  ...over,
});

describe('buildAreaDerivation — the chain to GLA', () => {
  it('reports the pixels enclosed, the one conversion factor and the square feet', () => {
    const d = buildAreaDerivation(state());
    const [level] = d.gla.levels;
    expect(level.ringPixels).toBe(5000);
    expect(level.netPixels).toBe(5000);
    expect(level.squareFeet).toBeCloseTo(50, 9);
    expect(d.scale.pxPerFoot).toEqual({ x: 10, y: 10 });
    // One multiply, not two: 5,000 px² x 0.01 ft²/px² = 50 ft².
    expect(d.scale.sqFtPerSqPx).toBeCloseTo(0.01, 12);
    expect(level.ringPixels * d.scale.sqFtPerSqPx).toBeCloseTo(level.squareFeet, 9);
  });

  it('reads a square footprint as two lengths a reviewer can check', () => {
    const d = buildAreaDerivation(state());
    expect(d.gla.levels[0].dimensions.width).toBeCloseTo(10, 9);
    expect(d.gla.levels[0].dimensions.height).toBeCloseTo(5, 9);
  });

  it('offers no dimensions for a footprint that is not a plain rectangle', () => {
    // An L, which has no single width and height to state.
    const d = buildAreaDerivation(state({
      perimeterTraces: [trace({
        vertices: [
          { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 },
          { x: 40, y: 40 }, { x: 40, y: 80 }, { x: 0, y: 80 },
        ],
      })],
    }));
    expect(d.gla.levels[0].dimensions).toBeNull();
  });

  it('deducts a live void and states a stale one without deducting it', () => {
    const d = buildAreaDerivation(state({
      perimeterTraces: [trace({
        holes: [
          { id: 'h1', ring: rect(10, 10), source: 'user' },
          { id: 'h2', ring: rect(20, 10), source: 'user', stale: true },
        ],
      })],
    }));
    const [level] = d.gla.levels;
    expect(level.holes.map((h) => h.pixels)).toEqual([100, 200]);
    expect(level.holes.map((h) => h.subtracted)).toEqual([true, false]);
    expect(level.deductedPixels).toBe(100);
    expect(level.netPixels).toBe(4900);
    expect(level.squareFeet).toBeCloseTo(49, 9);
  });

  it('carries a bare ring hole from an old project file', () => {
    const d = buildAreaDerivation(state({
      perimeterTraces: [trace({ holes: [rect(10, 10)] })],
    }));
    expect(d.gla.levels[0].holes[0].subtracted).toBe(true);
    expect(d.gla.levels[0].holes[0].key).toBe('ring-0');
  });

  it('adds the levels of a two-storey plan', () => {
    const d = buildAreaDerivation(state({
      perimeterTraces: [
        trace({ id: 'a', name: '1st Floor' }),
        trace({ id: 'b', name: '2nd Floor', vertices: rect(80, 50) }),
      ],
    }));
    expect(d.gla.levels).toHaveLength(2);
    expect(d.gla.squareFeet).toBeCloseTo(90, 9);
    expect(d.gla.reported).toBe(90);
    expect(d.gla.sumOfLevels).toBe(90);
  });

  it('keeps a non-living outline out of GLA but names it and its area', () => {
    const d = buildAreaDerivation(state({
      perimeterTraces: [
        trace({ id: 'a' }),
        trace({ id: 'b', name: 'Garage', type: 'garage', vertices: rect(60, 40) }),
      ],
    }));
    expect(d.gla.levels.map((l) => l.id)).toEqual(['a']);
    expect(d.gla.reported).toBe(50);
    expect(d.excluded).toHaveLength(1);
    expect(d.excluded[0].typeLabel).toBe('Garage');
    expect(d.excluded[0].displayed).toBe(24);
    // The grand total still holds both, so the working cannot contradict the
    // Area card's breakdown while sitting under it.
    expect(d.grand.printed).toBe(74);
  });

  it('names why an outline contributes nothing rather than omitting it', () => {
    const d = buildAreaDerivation(state({
      perimeterTraces: [
        trace(),
        trace({ id: 'x', name: 'Shed', visible: false }),
        trace({ id: 'y', name: 'Half-drawn', vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }),
      ],
    }));
    expect(d.skipped.map((o) => o.skipped)).toEqual(['hidden', 'open']);
    expect(d.gla.levels).toHaveLength(1);
  });

  it('does not report a GLA of zero when no outline is living area', () => {
    const d = buildAreaDerivation(state({
      perimeterTraces: [trace({ name: 'Garage', type: 'garage' })],
    }));
    expect(d.gla.measured).toBe(false);
    expect(d.grand.printed).toBe(50);
  });

  // `measured` is the Area card's own `noGla` test, not a count of living
  // outlines: a GLA outline that encloses nothing leaves gla at 0 while the
  // total stands, and the two cards have to step past it together.
  it('follows the Area card past a living outline that encloses nothing', () => {
    const flat = state({
      perimeterTraces: [
        // Three collinear points: three corners, zero area.
        trace({ id: 'a', vertices: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }] }),
        trace({ id: 'b', name: 'Garage', type: 'garage', vertices: rect(60, 40) }),
      ],
    });
    const store = computeAreaByType(flat);
    const d = buildAreaDerivation(flat);
    expect(store.gla).toBe(0);
    expect(store.total).toBeGreaterThan(0);
    expect(d.gla.measured).toBe(false);
    expect(d.grand.printed).toBe(areaDisplayValue(store.total, 'decimal'));
  });

  it('keeps the detector quality on the level it belongs to', () => {
    const quality = { confidence: 0.42, warnings: [{ code: 'unsealed' }] };
    const d = buildAreaDerivation(state({ perimeterTraces: [trace({ quality })] }));
    expect(d.gla.levels[0].quality).toBe(quality);
  });
});

describe('buildAreaDerivation — the working itself', () => {
  it('cuts a plain outline into the one multiply it is', () => {
    const [level] = buildAreaDerivation(state()).gla.levels;
    expect(level.working.pieces).toHaveLength(1);
    expect(level.working.pieces[0]).toMatchObject({
      kind: 'rect', half: false, deducted: false, lengths: ['10.0', '5.0'], displayed: 50,
    });
  });

  // The property that makes the column worth printing: what the rows say adds
  // up to what the row above them says. The same rule `displayedBreakdownTotal`
  // enforces between outlines, applied inside one.
  it('adds the pieces to the figure printed over them, in every unit', () => {
    const plan = state({
      perimeterTraces: [trace({
        vertices: [
          { x: 0, y: 0 }, { x: 313, y: 0 }, { x: 313, y: 187 },
          { x: 140, y: 187 }, { x: 140, y: 264 }, { x: 0, y: 264 },
        ],
        holes: [{ id: 'h', ring: rect(41, 29, 20, 20) }],
      })],
    });
    for (const unit of ['decimal', 'inches', 'metric']) {
      const [level] = buildAreaDerivation(plan, unit).gla.levels;
      const column = level.working.pieces
        .reduce((sum, p) => sum + (p.deducted ? -p.displayed : p.displayed), 0);
      expect(Number(column.toFixed(2))).toBeCloseTo(level.subtotal, 6);
      expect(level.subtotal).toBeCloseTo(level.working.total, 9);
    }
  });

  it('states a right triangle the way the trade writes one', () => {
    // A chamfered corner: one 45° cut across a rectangle.
    const d = buildAreaDerivation(state({
      perimeterTraces: [trace({
        vertices: [
          { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 },
          { x: 100, y: 100 }, { x: 0, y: 0 },
        ],
      })],
    }));
    const [level] = d.gla.levels;
    const tri = level.working.pieces.find((p) => p.half);
    expect(tri).toBeTruthy();
    expect(tri.lengths).toHaveLength(2);
  });

  it('shows a deducted void as a deduction, not as one more room', () => {
    const d = buildAreaDerivation(state({
      perimeterTraces: [trace({ holes: [{ id: 'h', ring: rect(20, 10) }] })],
    }));
    const [level] = d.gla.levels;
    const cut = level.working.pieces.filter((p) => p.deducted);
    expect(cut).toHaveLength(1);
    expect(cut[0].displayed).toBeCloseTo(2, 6);
    expect(level.working.pieces[level.working.pieces.length - 1].deducted).toBe(true);
  });

  it('measures a plan drawn off the square along its own walls', () => {
    const angle = (20 * Math.PI) / 180;
    const turn = (p) => ({
      x: p.x * Math.cos(angle) - p.y * Math.sin(angle),
      y: p.x * Math.sin(angle) + p.y * Math.cos(angle),
    });
    const d = buildAreaDerivation(state({
      perimeterTraces: [trace({ vertices: rect(240, 200).map(turn) })],
    }));
    const [level] = d.gla.levels;
    expect(level.working.rotation).toBeCloseTo(20, 4);
    expect(level.working.pieces).toHaveLength(1);
    expect(level.working.pieces[0].lengths).toEqual(['24.0', '20.0']);
  });

  // A bow-tie's lobes cancel in the shoelace, so no partition of it can reach
  // the figure the Area card prints. The working is withheld and the area is
  // not: what is missing is the breakdown, not the measurement.
  it('offers no working for an outline it cannot cut up honestly', () => {
    const bowtie = [
      { x: 0, y: 0 }, { x: 100, y: 120 }, { x: 100, y: 0 }, { x: 0, y: 60 },
    ];
    const plan = state({ perimeterTraces: [trace({ vertices: bowtie })] });
    const [level] = buildAreaDerivation(plan).gla.levels;
    expect(level.working).toBeNull();
    expect(level.squareFeet).toBe(calculateArea(bowtie, calibrated.feetPerPixel, []));
  });

  it('adds the levels in the precision the pieces were printed to', () => {
    const d = buildAreaDerivation(state({
      perimeterTraces: [
        trace({ id: 'a', vertices: rect(313, 187) }),
        trace({ id: 'b', name: '2nd Floor', vertices: rect(241, 173) }),
      ],
    }));
    const summed = d.gla.levels.reduce((s, l) => s + l.subtotal, 0);
    expect(d.gla.sumOfSubtotals).toBeCloseTo(summed, 6);
    expect(Math.round(d.gla.sumOfSubtotals)).toBe(d.gla.reported);
  });
});

describe('buildAreaDerivation — it cannot disagree with the Area card', () => {
  const twoLevels = state({
    perimeterTraces: [
      trace({ id: 'a', vertices: rect(313, 187) }),
      trace({ id: 'b', name: '2nd Floor', vertices: rect(241, 173) }),
      trace({ id: 'c', name: 'Garage', type: 'garage', vertices: rect(97, 83) }),
    ],
  });

  // The property the whole module rests on: the Area card headlines GLA, this
  // card restates it, and the two are on screen together.
  it('reports the GLA the Area card headlines, per unit', () => {
    for (const unit of ['decimal', 'inches', 'metric']) {
      const store = computeAreaByType(twoLevels);
      const d = buildAreaDerivation(twoLevels, unit);
      expect(d.gla.reported).toBe(areaDisplayValue(store.gla, unit));
      expect(d.gla.squareFeet).toBeCloseTo(store.gla, 9);
      expect(d.grand.squareFeet).toBeCloseTo(store.total, 9);
    }
  });

  it('adds up: each level times the factor equals its own square feet', () => {
    const d = buildAreaDerivation(twoLevels);
    for (const level of d.gla.levels) {
      expect(level.netPixels * d.scale.sqFtPerSqPx).toBeCloseTo(level.squareFeet, 9);
    }
    const summed = d.gla.levels.reduce((s, l) => s + l.squareFeet, 0);
    expect(summed).toBeCloseTo(d.gla.squareFeet, 9);
  });

  it('matches calculateArea outline for outline, holes and all', () => {
    const withVoid = state({
      perimeterTraces: [trace({ vertices: rect(313, 187), holes: [{ id: 'h', ring: rect(31, 19) }] })],
    });
    const d = buildAreaDerivation(withVoid);
    const direct = calculateArea(
      withVoid.perimeterTraces[0].vertices, calibrated.feetPerPixel,
      withVoid.perimeterTraces[0].holes,
    );
    expect(d.gla.levels[0].squareFeet).toBe(direct);
  });

  it('says so when the rounded levels do not add to the reported figure', () => {
    // Two levels each landing just under a half foot: 50.4 + 50.4 = 100.8,
    // which reports as 101 while the rounded levels add to 100.
    const near = state({
      perimeterTraces: [
        trace({ id: 'a', vertices: rect(100, 50.4) }),
        trace({ id: 'b', name: '2nd Floor', vertices: rect(100, 50.4) }),
      ],
    });
    const d = buildAreaDerivation(near);
    expect(d.gla.sumOfLevels).toBe(100);
    expect(d.gla.reported).toBe(101);
    expect(d.gla.unrounded).toBeCloseTo(100.8, 6);
  });

  // The reconciling sentence quotes the unrounded sum. In square feet under a
  // column of square metres it read "reaches 10 … the unrounded sum, 100.8",
  // which is two units in one sentence and neither of them checks out.
  it('quotes the unrounded sum in the unit being printed', () => {
    const near = state({
      perimeterTraces: [
        trace({ id: 'a', vertices: rect(100, 50.4) }),
        trace({ id: 'b', name: '2nd Floor', vertices: rect(100, 50.4) }),
      ],
    });
    const d = buildAreaDerivation(near, 'metric');
    expect(d.gla.squareFeet).toBeCloseTo(100.8, 6);
    expect(d.gla.unrounded).toBeCloseTo(9.365, 3);
    expect(Math.round(d.gla.unrounded)).toBe(d.gla.reported);
  });
});

describe('buildAreaDerivation — the scale', () => {
  it('says plainly that nothing is to scale when it is not', () => {
    const d = buildAreaDerivation(state({ calibration: null }));
    expect(d.scale.calibrated).toBe(false);
    expect(d.scale.pxPerFoot).toBeNull();
    expect(d.scale.provenance).toBe('No scale was set — areas are not to scale.');
  });

  // With no scale the app falls back to a foot per pixel and goes on printing
  // areas, so the working still has to be a working — the pieces are stated in
  // that assumed unit rather than withheld, and the panel names the assumption
  // beside them.
  it('still cuts the outline up when no scale is set', () => {
    const d = buildAreaDerivation(state({ calibration: null }));
    const [level] = d.gla.levels;
    expect(d.scale.display.pxPerUnit.x).toBe(1);
    expect(level.working.pieces).toHaveLength(1);
    expect(level.working.total).toBe(level.subtotal);
    expect(level.subtotal).toBeCloseTo(5000, 1);
  });

  // The factor is the step the reader repeats, so it has to be in the unit the
  // column is printed in. Stating ft²/px² over a column of square metres was a
  // multiply that did not work: 205,962 x 0.004233 is 872, not 81.
  it('states the scale in the unit being printed', () => {
    const d = buildAreaDerivation(state(), 'metric');
    expect(d.scale.display.lengthUnit).toBe('m');
    expect(d.scale.display.areaUnit).toBe('m²');
    // 10 px/ft is 32.81 px/m.
    expect(d.scale.display.pxPerUnit.x).toBeCloseTo(32.8084, 3);
    const [level] = d.gla.levels;
    expect(level.netPixels * d.scale.display.areaPerPx).toBeCloseTo(level.displayed, 0);
  });

  it('leaves the factor in square feet for the feet-and-inches unit', () => {
    const d = buildAreaDerivation(state(), 'inches');
    expect(d.scale.display.lengthUnit).toBe('ft');
    expect(d.scale.display.areaPerPx).toBeCloseTo(d.scale.sqFtPerSqPx, 12);
  });

  it('reports an anisotropic scale as two numbers', () => {
    const d = buildAreaDerivation(state({
      calibration: { ...calibrated, feetPerPixel: { x: 0.1, y: 0.125 } },
    }));
    expect(d.scale.anisotropic).toBe(true);
    expect(d.scale.pxPerFoot.y).toBeCloseTo(8, 9);
    expect(d.scale.sqFtPerSqPx).toBeCloseTo(0.0125, 12);
  });

  it('counts the rooms the calibration claims, not every room in the store', () => {
    // A scale pinned to one hand-picked room, with six rooms still on hand
    // from the scan that preceded it.
    const d = buildAreaDerivation(state({
      rooms: Array.from({ length: 6 }, (_, i) => ({ labelId: `R${i}` })),
      // The pair `resolveScaleUpdate` actually writes: pinning a room sets
      // `adopted`, which makes the source 'manual'. The old fixture used
      // 'auto', a state the app cannot produce, so the test passed over a
      // branch that never ran.
      calibration: {
        ...calibrated,
        quality: { source: 'manual', reason: 'room-vs-auto', level: 'note', roomCount: 6, adopted: true },
      },
    }));
    expect(d.scale.provenance)
      .toBe('Taken from one room chosen by hand, overriding the measured average.');
  });
});

describe('scaleProvenance', () => {
  // Driven through the function that actually writes the quality record, not a
  // hand-built one. The hand-picked-room branch used to require source 'auto'
  // with this reason, a pair `resolveScaleUpdate` cannot produce — so it never
  // ran, and every surface reported the pooled count the user had just
  // overruled. A fixture written by hand passed over that for as long as it
  // existed; this cannot.
  it('names a hand-picked room, through the real calibration path', () => {
    const update = resolveScaleUpdate({
      dimensions: { width: '12', height: '14' },
      overlay: { x1: 0, y1: 0, x2: 240, y2: 280 },
      pinned: true,
      otherSamples: [16, 16.2, 15.8, 16.1, 15.9, 16.05],
      calibration: { calibrated: true, feetPerPixel: { x: 1 / 16, y: 1 / 16 } },
    });
    expect(update.quality).toMatchObject({ reason: 'room-vs-auto', source: 'manual' });
    expect(scaleProvenance({
      calibration: { calibrated: true, source: 'room-calibration', quality: update.quality },
    })).toBe('Taken from one room chosen by hand, overriding the measured average.');
  });

  it('names a two-line calibration as such', () => {
    expect(scaleProvenance({
      calibration: {
        calibrated: true,
        source: 'line-calibration',
        quality: { source: 'line', lineCount: 2 },
      },
    })).toBe('Set by hand from two lines of known length.');
  });

  it('falls back to the typed room size when nothing was measured', () => {
    expect(scaleProvenance({
      calibration: { calibrated: true, source: 'room-calibration', quality: null },
    })).toBe('Measured from the room size entered by hand.');
  });
});
