// Second-chance tracing (remediate.js).
//
// The failure these cover is the one the app was shipping: a footprint that
// excluded rooms the OCR pass had already located, reported at high confidence
// because the excluded rooms belonged to a wall network the winning outline was
// never scored against. Every case is ground truth by construction, and the
// two halves are equally load-bearing — that a provably wrong outline gets
// replaced, and that a right one never does.

import { describe, expect, it } from 'vitest';
import { traceFloorplanBoundaryCore } from '../pipeline.js';
import { measureHold, implicatedNets, REMEDIATION_CONFIDENCE } from '../remediate.js';
import { analyzeFloorplan } from '../analyze.js';
import { traceBoundary } from '../boundary.js';
import { polygonArea, pointInPolygon } from '../polygon.js';
import {
  windowedHouse, twoPlansSheet, sliderHouse, courtyardHouse, garageHouse,
  dimensionStringHouse, strokeAround, polygonIou,
} from './synthetic.js';

const constraintsOf = (labels) => ({
  rooms: [],
  interiorPoints: labels.map((l) => ({ x: l.x, y: l.y, name: l.name })),
});

const outsideLabels = (traced, labels) => labels.filter((label) => !(traced?.floors ?? []).some(
  (floor) => floor.outer?.polygon
    && pointInPolygon(label, floor.outer.polygon, floor.holes ?? []),
));

const codes = (traced) => (traced?.quality?.warnings ?? []).map((w) => w.code);

describe('a trace that excludes a known room is retried', () => {
  // 70px openings dismember the outline into one sealed half plus two corner
  // fragments; 100px and 140px leave nothing usable at all — at 140 the tracer
  // returns no boundary whatsoever. All three are one rectangular building.
  for (const gap of [70, 100, 140]) {
    it(`recovers a plan fragmented by ${gap}px openings`, () => {
      const { img, truth, labels } = windowedHouse(gap);
      const plain = traceFloorplanBoundaryCore(img);
      const traced = traceFloorplanBoundaryCore(img, { constraints: constraintsOf(labels) });

      expect(traced.outer).toBeTruthy();
      expect(polygonIou(traced.outer.polygon, truth)).toBeGreaterThan(0.95);
      expect(outsideLabels(traced, labels)).toHaveLength(0);
      expect(codes(traced)).toContain('remediated');
      expect(traced.quality.remediation.accepted).toBe('join');
      expect(traced.quality.remediation.after.held).toBe(2);

      // The point of the exercise: without the constraints the same image
      // produces an answer that is missing the building, and says nothing.
      const before = plain.outer ? polygonIou(plain.outer.polygon, truth) : 0;
      expect(before).toBeLessThan(0.6);
    });
  }

  it('reports the retry at info severity, anchored on what it recovered', () => {
    const { img, labels } = windowedHouse(70);
    const traced = traceFloorplanBoundaryCore(img, { constraints: constraintsOf(labels) });
    const note = traced.quality.warnings.find((w) => w.code === 'remediated');
    expect(note.severity).toBe('info');
    // Original image px, so it can be pointed at on the canvas.
    expect(note.anchor.kind).toBe('point');
    expect(note.anchor.points.length).toBeGreaterThan(0);
    for (const p of note.anchor.points) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(img.width);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(img.height);
    }
  });

  it('records what each attempt was worth', () => {
    const { img, labels } = windowedHouse(70);
    const { remediation } = traceFloorplanBoundaryCore(
      img, { constraints: constraintsOf(labels) },
    ).quality;
    expect(remediation.ran).toBe(true);
    expect(remediation.before.held).toBeLessThan(remediation.after.held);
    expect(remediation.after.effective).toBeGreaterThan(remediation.before.effective);
    expect(remediation.passes.some((p) => p.accepted)).toBe(true);
  });
});

describe('remediation cannot make an answer worse', () => {
  it('leaves a plan the tracer already got right alone', () => {
    const { img, truth } = sliderHouse(150);
    const labels = [{ x: 400, y: 280, name: 'ROOM' }];
    const plain = traceFloorplanBoundaryCore(img);
    const traced = traceFloorplanBoundaryCore(img, { constraints: constraintsOf(labels) });
    expect(traced.quality.remediation).toBeUndefined();
    expect(polygonIou(traced.outer.polygon, plain.outer.polygon)).toBeGreaterThan(0.999);
    expect(polygonIou(traced.outer.polygon, truth)).toBeGreaterThan(0.95);
  });

  it('does not weld two sealed plans together to satisfy a label between them', () => {
    const { img, floors, labels } = twoPlansSheet();
    const traced = traceFloorplanBoundaryCore(img, { constraints: constraintsOf(labels) });
    expect(traced.floors).toHaveLength(2);
    for (let i = 0; i < 2; i += 1) {
      expect(polygonIou(traced.floors[i].outer.polygon, floors[i])).toBeGreaterThan(0.93);
    }
    // The stray is still outside, and still said to be — the honest answer.
    expect(outsideLabels(traced, labels).map((l) => l.name)).toEqual(['STRAY']);
    expect(codes(traced)).toContain('label-outside');
    expect(traced.quality.remediation.accepted).toBeNull();
  });

  it('keeps a hypothesis only when it holds no fewer constraints', () => {
    const { img, labels } = windowedHouse(70);
    const traced = traceFloorplanBoundaryCore(img, { constraints: constraintsOf(labels) });
    for (const pass of traced.quality.remediation.passes) {
      if (pass.accepted) expect(pass.held).toBeGreaterThanOrEqual(traced.quality.remediation.before.held);
    }
  });

  it('can be switched off', () => {
    const { img, labels } = windowedHouse(70);
    const off = traceFloorplanBoundaryCore(img, {
      constraints: constraintsOf(labels),
      boundary: { remediate: false },
    });
    expect(off.quality.remediation).toBeUndefined();
    expect(codes(off)).not.toContain('remediated');
  });
});

describe('draw mode is exempt', () => {
  it('does not re-search an outline the user painted', () => {
    const { img, truth } = sliderHouse(300);
    // A label outside a painted outline is usually a deliberate exclusion, so
    // it must not talk the tracer out of the shape it was given.
    const labels = [{ x: 400, y: 280, name: 'INSIDE' }, { x: 60, y: 40, name: 'OUTSIDE' }];
    const traced = traceFloorplanBoundaryCore(img, {
      constraints: constraintsOf(labels),
      brush: { strokes: [strokeAround(truth, { offset: 10, jitter: 4, step: 8 })], radius: 22 },
    });
    expect(traced.quality.source).toBe('drawn');
    expect(traced.quality.remediation).toBeUndefined();
    expect(polygonIou(traced.outer.polygon, truth)).toBeGreaterThan(0.95);
  });
});

describe('measureHold', () => {
  const analysisOf = (img) => analyzeFloorplan(img, { maxDimension: 1400 });
  // The constraints the detector works in are working-raster px; the labels the
  // scenarios carry are original px, the same conversion pipeline.js does.
  const scaledPoints = (labels, analysis) => ({
    rooms: [],
    interiorPoints: labels.map((l) => ({
      x: l.x * analysis.scaleX, y: l.y * analysis.scaleY, name: l.name,
    })),
  });

  it('counts a constraint held by any floor of a sheet, not by one', () => {
    const { img, labels } = twoPlansSheet();
    const analysis = analysisOf(img);
    const constraints = scaledPoints(labels, analysis);
    const boundary = traceBoundary(analysis, { constraints, remediate: false });
    expect(boundary.floors).toHaveLength(2);

    const hold = measureHold(boundary.floors, constraints, analysis);
    // One label on each plan is held, and neither floor holds both — the page
    // answer is the union. The stray in the gutter is held by neither.
    expect(hold.total).toBe(3);
    expect(hold.held).toBe(2);
    expect(hold.missed.map((m) => m.name)).toEqual(['STRAY']);
    for (const floor of boundary.floors) {
      expect(measureHold([floor], constraints, analysis).held).toBe(1);
    }
  });

  it('exempts a constraint inside a region the tracer carved out', () => {
    // The garage label is the reason the garage is carved out; counting it as a
    // miss would send remediation hunting for a footprint that annexes exactly
    // what the carve removed.
    const { img } = garageHouse(2);
    const analysis = analysisOf(img);
    const inGarage = [{ x: 630, y: 300, name: 'GARAGE' }];
    const constraints = scaledPoints(inGarage, analysis);
    const boundary = traceBoundary(analysis, { constraints, remediate: false });
    expect(boundary.excludedGarages).toBe(1);

    // Outside the footprint by construction, and still counted as held.
    const point = constraints.interiorPoints[0];
    const inside = boundary.floors.some(
      (f) => f.footprintMask[Math.round(point.y) * analysis.width + Math.round(point.x)],
    );
    expect(inside).toBe(false);
    expect(measureHold(boundary.floors, constraints, analysis)).toMatchObject({
      held: 1, total: 1, missed: [],
    });
  });

  it('reports nothing to hold when there are no constraints', () => {
    const { img } = courtyardHouse();
    expect(measureHold([], null, analysisOf(img))).toEqual({ held: 0, total: 0, missed: [] });
  });
});

describe('implicatedNets', () => {
  it('steps off the ink the point stands on before looking for wall', () => {
    // A constraint point is a label centre, so it always sits on ink. A ray
    // that does not step off first measures the label instead of the room.
    const { img, labels } = windowedHouse(70);
    const analysis = analyzeFloorplan(img, { maxDimension: 1400 });
    const { width, height, wallThickness } = analysis;
    const nets = [{ bbox: { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 } }];
    const point = { x: labels[0].x * analysis.scaleX, y: labels[0].y * analysis.scaleY };
    const ids = implicatedNets(
      point, nets, analysis.wallMask, width, height, Math.max(8, wallThickness * 2),
    );
    expect(ids).toEqual([0]);
  });

  it('implicates nothing for a point nothing encloses', () => {
    const { img } = windowedHouse(70);
    const analysis = analyzeFloorplan(img, { maxDimension: 1400 });
    const { width, height, wallThickness } = analysis;
    const nets = [{ bbox: { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 } }];
    // Top-left corner of the sheet, outside the building entirely.
    const ids = implicatedNets(
      { x: 8, y: 8 }, nets, analysis.wallMask, width, height, Math.max(8, wallThickness * 2),
    );
    expect(ids).toEqual([]);
  });
});

describe('the confidence threshold', () => {
  it('is the same line the app calls a good trace', () => {
    expect(REMEDIATION_CONFIDENCE).toBe(0.75);
  });

  it('retries a low-confidence trace even with nothing to point at', () => {
    const { img } = windowedHouse(100);
    const traced = traceFloorplanBoundaryCore(img);
    expect(traced.quality.confidence).toBeLessThan(REMEDIATION_CONFIDENCE);
    expect(traced.quality.remediation.ran).toBe(true);
    // Nothing known-inside to steer with, so the escalation is all there is —
    // and it is still adjudicated, so the answer is no worse.
    expect(traced.quality.remediation.passes.map((p) => p.pass)).toContain('escalate');
  });

  it('does not widen a ladder whose ceiling was never reached', () => {
    // The ladder is climbed from r=2 upward and every rung is scored, so a
    // winner that sealed well below the ceiling already beat every wider rung
    // that existed; raising the ceiling only appends rungs that score worse on
    // `economy`. Escalating there is a second full search that cannot win, and
    // ungated it doubled the trace time of every merely-fair plan.
    const { img } = dimensionStringHouse(60);
    const labels = [{ x: 400, y: 360, name: 'ROOM' }];
    const traced = traceFloorplanBoundaryCore(img, { constraints: constraintsOf(labels) });
    expect(outsideLabels(traced, labels)).toHaveLength(0);
    const sealedLow = traced.debug.sealRadius < 0.6 * Math.max(32, Math.round(
      Math.max(traced.debug.workingSize.width, traced.debug.workingSize.height) * 0.045,
    ));
    expect(sealedLow).toBe(true);
    // Nothing to point at and nothing to widen: the first answer stands, and is
    // reported as untouched rather than as a retry that found nothing.
    expect(traced.quality.remediation).toBeUndefined();
  });
});

describe('area is what moves', () => {
  it('the recovered outline is the whole building, not half of it', () => {
    const { img, truth, labels } = windowedHouse(70);
    const plain = traceFloorplanBoundaryCore(img);
    const traced = traceFloorplanBoundaryCore(img, { constraints: constraintsOf(labels) });
    const truthArea = polygonArea(truth);
    expect(polygonArea(plain.outer.polygon) / truthArea).toBeLessThan(0.6);
    expect(Math.abs(polygonArea(traced.outer.polygon) - truthArea) / truthArea).toBeLessThan(0.05);
  });
});
