// Draw mode: a rough brush stroke should produce the same answer the tracer
// would have produced if it had been right. These are the cases auto-detection
// gets wrong — a legend inside the notch, a second plan on the sheet, an
// opening no closing radius spans — traced again with a stroke around the
// intended building, and scored on polygon IoU against the same truth.
//
// The stroke is deliberately sloppy (offset outward, wobbled) because the whole
// premise of the feature is that the user does not have to be accurate.

import { describe, expect, it } from 'vitest';
import { traceFloorplanBoundaryCore } from '../pipeline.js';
import { polygonArea } from '../polygon.js';
import { regionFit } from '../brush.js';
import {
  createImage, sliderHouse, uPlanHouse, legendPlan, nestedFloorsPlan,
  outerFaceRect, polygonIou, strokeAround,
} from './synthetic.js';

const draw = (img, strokes, radius = 22, options = {}) =>
  traceFloorplanBoundaryCore(img, {
    ...options,
    brush: { strokes: Array.isArray(strokes) ? strokes : [strokes], radius },
  });

const areaError = (polygon, truth) =>
  (polygonArea(polygon) - polygonArea(truth)) / polygonArea(truth);

const warningCodes = (traced) => (traced?.quality?.warnings ?? []).map((w) => w.code);

describe('the stroke scopes the search', () => {
  it('excludes a legend the auto tracer has to reason its way past', () => {
    const { img, truth } = legendPlan();
    const traced = draw(img, strokeAround(truth, { offset: 10, jitter: 6 }));
    expect(traced.outer).toBeTruthy();
    expect(polygonIou(traced.outer.polygon, truth)).toBeGreaterThan(0.95);
    expect(Math.abs(areaError(traced.outer.polygon, truth))).toBeLessThan(0.05);
  });

  it('traces one plan of a two-plan sheet without seeing the other', () => {
    const { img, floors } = nestedFloorsPlan();
    const traced = draw(img, strokeAround(floors[0], { offset: 10, jitter: 5 }));
    expect(traced.outer).toBeTruthy();
    expect(traced.floors.length).toBe(1);
    expect(polygonIou(traced.outer.polygon, floors[0])).toBeGreaterThan(0.95);
  });
});

describe('walls under the stroke win over the stroke', () => {
  // The corridor is 22px wide and the stroke sits 10px off the true wall — if
  // the result followed the stroke rather than the ink it would be visibly
  // oversized. IoU this tight only passes if it snapped.
  it('snaps to the drawn wall rather than to where the user painted', () => {
    const { img, truth } = sliderHouse(0);
    const traced = draw(img, strokeAround(truth, { offset: 12, jitter: 5 }));
    expect(polygonIou(traced.outer.polygon, truth)).toBeGreaterThan(0.96);
  });

  it('closes an opening no closing radius spans', () => {
    const { img, truth } = sliderHouse(300);
    const traced = draw(img, strokeAround(truth, { offset: 10, jitter: 4 }));
    expect(traced.outer).toBeTruthy();
    expect(polygonIou(traced.outer.polygon, truth)).toBeGreaterThan(0.94);
  });

  it('keeps a notch the user painted into', () => {
    const { img, truth } = uPlanHouse();
    const traced = draw(img, strokeAround(truth, { offset: 8, jitter: 4, step: 8 }));
    expect(traced.outer.polygon.length).toBeGreaterThanOrEqual(8);
    expect(polygonIou(traced.outer.polygon, truth)).toBeGreaterThan(0.93);
  });
});

describe('tolerance to a sloppy hand', () => {
  for (const jitter of [0, 6, 12]) {
    it(`survives ${jitter}px of wobble`, () => {
      const { img, truth } = sliderHouse(0);
      const traced = draw(img, strokeAround(truth, { offset: 10, jitter }), 26);
      expect(traced.outer).toBeTruthy();
      expect(polygonIou(traced.outer.polygon, truth)).toBeGreaterThan(0.93);
    });
  }

  it('accepts a loop left open where the user lifted the mouse', () => {
    const { img, truth } = sliderHouse(0);
    const full = strokeAround(truth, { offset: 10, jitter: 4 });
    const gapped = { points: full.points.slice(0, Math.round(full.points.length * 0.88)) };
    const traced = draw(img, gapped);
    expect(traced.outer).toBeTruthy();
    expect(polygonIou(traced.outer.polygon, truth)).toBeGreaterThan(0.9);
  });
});

describe('the result still says how much to trust it', () => {
  it('falls back to the stroke on blank paper and says so', () => {
    const blank = createImage(800, 600);
    const truth = outerFaceRect(150, 120, 650, 480, 8);
    const traced = draw(blank, strokeAround(truth, { offset: 0, jitter: 3 }));
    expect(traced.outer).toBeTruthy();
    expect(warningCodes(traced)).toContain('drawn-freehand');
    expect(traced.quality.confidence).toBeLessThan(0.5);
    expect(traced.quality.source).toBe('drawn');
  });

  // Painting around the garage is how a user says "not this". Treating the
  // labels left outside as errors — as the auto path must — would condemn
  // every deliberate exclusion and score up the candidate that annexed it.
  it('reports a label outside a drawn outline without condemning the trace', () => {
    const { img, truth } = sliderHouse(0);
    const constraints = { rooms: [], interiorPoints: [{ x: 60, y: 60, name: 'OUTSIDE' }] };
    const stroke = strokeAround(truth, { offset: 10, jitter: 4 });

    const auto = traceFloorplanBoundaryCore(img, { constraints });
    const drawn = draw(img, stroke, 22, { constraints });

    const severityOf = (t) => (t.quality.warnings ?? [])
      .filter((w) => w.code === 'label-outside').map((w) => w.severity);

    expect(severityOf(auto)).toContain('error');
    expect(severityOf(drawn).length).toBeGreaterThan(0);
    expect(severityOf(drawn)).not.toContain('error');
    expect(drawn.quality.confidence).toBeGreaterThan(auto.quality.confidence * 2);
  });

  it('marks a confident brush trace as drawn, not auto', () => {
    const { img, truth } = sliderHouse(0);
    const traced = draw(img, strokeAround(truth, { offset: 10, jitter: 4 }));
    expect(traced.quality.source).toBe('drawn');
    expect(traced.quality.confidence).toBeGreaterThan(0.6);
  });

  // A generous stroke must not read as a mismatch: the painted band is thick,
  // so the brush-fit measure has to treat the band as neutral ground rather
  // than score plain overlap. Scored directly, because the corridor rescue
  // exists to make an unmatched result rare in the pipeline.
  it('does not penalise a generously wide stroke', () => {
    const { img, truth } = sliderHouse(0);
    for (const [offset, radius] of [[20, 24], [50, 55], [70, 75]]) {
      const traced = draw(img, strokeAround(truth, { offset, jitter: 3, step: 8 }), radius);
      expect(polygonIou(traced.outer.polygon, truth)).toBeGreaterThan(0.95);
      expect(warningCodes(traced)).not.toContain('brush-mismatch');
      expect(traced.quality.confidence).toBeGreaterThan(0.7);
    }
  });

  it('scores a footprint that covers half of what was outlined as half a fit', () => {
    const w = 200;
    const h = 100;
    const region = new Uint8Array(w * h).fill(1);
    const band = new Uint8Array(w * h);       // no neutral ground
    const half = new Uint8Array(w * h);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w / 2; x += 1) half[y * w + x] = 1;
    }
    const bbox = { minX: 0, minY: 0, maxX: w - 1, maxY: h - 1 };
    expect(regionFit(half, region, band, w, h, bbox)).toBeCloseTo(0.5, 1);
    expect(regionFit(region, region, band, w, h, bbox)).toBeCloseTo(1, 2);
  });
});

describe('two loops are two floors', () => {
  it('produces one floor per painted loop', () => {
    const { img, floors } = nestedFloorsPlan();
    const traced = draw(img, [
      strokeAround(floors[0], { offset: 6, jitter: 3 }),
      strokeAround(floors[1], { offset: 6, jitter: 3, seed: 9 }),
    ], 12);
    expect(traced.floors.length).toBe(2);
    expect(polygonIou(traced.floors[0].outer.polygon, floors[0])).toBeGreaterThan(0.9);
    expect(polygonIou(traced.floors[1].outer.polygon, floors[1])).toBeGreaterThan(0.9);
  });
});
