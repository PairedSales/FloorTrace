// The exterior tracer's known failure modes, as tests with ground truth by
// construction. Each case is a shape the old mask-and-seal tracer got wrong
// while every bounding-box check it was measured by stayed green — which is
// why these are scored on polygon IoU and area, and why several also assert
// that the result says how much to trust it.

import { describe, expect, it } from 'vitest';
import { traceFloorplanBoundaryCore } from '../pipeline.js';
import { polygonArea } from '../polygon.js';
import {
  sliderHouse, uPlanHouse, dimensionStringHouse, courtyardHouse, legendPlan,
  garageHouse, nestedFloorsPlan, mixedThicknessHouse,
  polygonIou, bboxIou, bboxOf,
} from './synthetic.js';

const truthBbox = (truth) => [
  Math.min(...truth.map((p) => p.x)), Math.min(...truth.map((p) => p.y)),
  Math.max(...truth.map((p) => p.x)), Math.max(...truth.map((p) => p.y)),
];

const areaError = (polygon, truth) =>
  (polygonArea(polygon) - polygonArea(truth)) / polygonArea(truth);

const warningCodes = (traced) => (traced?.quality?.warnings ?? []).map((w) => w.code);

describe('openings wider than any closing radius', () => {
  // A slider cut into the bottom wall. The building is unchanged, so the truth
  // is the same rectangle at every span; the old tracer fell off a cliff
  // between 180px and 185px and returned a wall sliver with -92% area, at a
  // bounding-box IoU of 99.2% against the same truth.
  for (const span of [150, 185, 240, 300]) {
    it(`closes a ${span}px opening and reports the bridge`, () => {
      const { img, truth } = sliderHouse(span);
      const traced = traceFloorplanBoundaryCore(img);
      expect(traced.outer).toBeTruthy();
      expect(polygonIou(traced.outer.polygon, truth)).toBeGreaterThan(0.95);
      expect(Math.abs(areaError(traced.outer.polygon, truth))).toBeLessThan(0.05);
      if (span >= 185) {
        expect(warningCodes(traced)).toContain('bridged-opening');
        expect(traced.quality.confidence).toBeLessThan(0.9);
      }
    });
  }
});

describe('genuine notches are not welded shut', () => {
  it('keeps a U-plan notch whose mouth is flanked by colinear wall runs', () => {
    const { img, truth } = uPlanHouse();
    const traced = traceFloorplanBoundaryCore(img);
    expect(traced.outer).toBeTruthy();
    // The old colinear welding filled the mouth and reported a rectangle:
    // 4 vertices and +23.9% area at a bounding-box IoU of 99.6%.
    expect(traced.outer.polygon.length).toBeGreaterThanOrEqual(8);
    expect(polygonIou(traced.outer.polygon, truth)).toBeGreaterThan(0.95);
    expect(areaError(traced.outer.polygon, truth)).toBeLessThan(0.05);
  });
});

describe('annotation is not building', () => {
  // Extension lines run from the wall out to a dimension line, so the strip
  // between them is a closed rectangle the flood fill cannot enter. The old
  // tracer annexed it, growing with the annotation's offset.
  for (const offset of [40, 60, 90]) {
    it(`ignores a dimension string drawn ${offset}px off the wall`, () => {
      const { img, truth } = dimensionStringHouse(offset);
      const traced = traceFloorplanBoundaryCore(img);
      expect(traced.outer).toBeTruthy();
      expect(polygonIou(traced.outer.polygon, truth)).toBeGreaterThan(0.97);
      expect(Math.abs(areaError(traced.outer.polygon, truth))).toBeLessThan(0.03);
    });
  }
});

describe('enclosed voids', () => {
  it('subtracts a labelled courtyard instead of counting it as floor area', () => {
    const { img, truth, hole, label } = courtyardHouse();
    const traced = traceFloorplanBoundaryCore(img, { excludeRegions: [label] });
    const floor = traced.floors[0];
    expect(floor.holes.length).toBe(1);
    const holeArea = polygonArea(floor.holes[0]);
    expect(Math.abs(holeArea - polygonArea(hole)) / polygonArea(hole)).toBeLessThan(0.05);
    const net = polygonArea(floor.outer.polygon) - holeArea;
    const truthNet = polygonArea(truth) - polygonArea(hole);
    expect(Math.abs(net - truthNet) / truthNet).toBeLessThan(0.03);
  });

  it('reports one floor, not two, for the courtyard ring', () => {
    const { img, label } = courtyardHouse();
    expect(traceFloorplanBoundaryCore(img, { excludeRegions: [label] }).floors.length).toBe(1);
  });
});

describe('drawings that are not buildings', () => {
  it('does not annex a legend drawn inside an L-shaped plan’s notch', () => {
    const { img, truth } = legendPlan();
    const traced = traceFloorplanBoundaryCore(img);
    expect(traced.floors.length).toBe(1);
    expect(polygonIou(traced.outer.polygon, truth)).toBeGreaterThan(0.93);
    expect(areaError(traced.outer.polygon, truth)).toBeLessThan(0.06);
  });

  it('keeps two floor plans separate when one is drawn inside the other’s box', () => {
    const { img, floors } = nestedFloorsPlan();
    const traced = traceFloorplanBoundaryCore(img);
    expect(traced.floors.length).toBe(2);
    // Boxes overlap heavily; the polygons must not.
    expect(bboxIou(bboxOf(traced.floors[0].outer.overlay), truthBbox(floors[0]))).toBeGreaterThan(0.9);
    for (let i = 0; i < 2; i += 1) {
      expect(polygonIou(traced.floors[i].outer.polygon, floors[i])).toBeGreaterThan(0.93);
    }
    expect(warningCodes(traced)).not.toContain('floors-overlap');
  });
});

describe('non-GLA classification does not turn on one pixel', () => {
  // The garage-door test used to be measured on a mask carrying a dilation
  // halo, so a 3px stroke counted as 5 and a one-pixel difference in linework
  // decided whether a garage counted as living area.
  for (const thickness of [1, 2, 3, 5]) {
    it(`carves a garage whose door is drawn ${thickness}px thick`, () => {
      const { img, truth } = garageHouse(thickness);
      const traced = traceFloorplanBoundaryCore(img);
      expect(traced.excludedRegions).toBe(1);
      expect(polygonIou(traced.outer.polygon, truth)).toBeGreaterThan(0.95);
    });
  }

  it('keeps a wing whose "door" is as thick as the walls', () => {
    const { img, truth } = garageHouse(10);
    const traced = traceFloorplanBoundaryCore(img);
    expect(traced.excludedRegions).toBe(0);
    expect(polygonArea(traced.outer.polygon)).toBeGreaterThan(1.2 * polygonArea(truth));
  });
});

describe('interior envelope', () => {
  it('insets each edge by its own wall thickness', () => {
    const { img, outerTruth, innerTruth } = mixedThicknessHouse();
    const traced = traceFloorplanBoundaryCore(img);
    expect(polygonIou(traced.outer.polygon, outerTruth)).toBeGreaterThan(0.97);
    // One global scalar inset the 4px side walls by the 16px front wall's
    // measurement and lost 5.5% of the interior.
    expect(polygonIou(traced.inner.polygon, innerTruth)).toBeGreaterThan(0.95);
    expect(Math.abs(areaError(traced.inner.polygon, innerTruth))).toBeLessThan(0.03);
  });
});

describe('failure is visible', () => {
  it('reports a reason when there is no boundary at all', () => {
    const img = sliderHouse(150).img;
    for (let i = 0; i < img.data.length; i += 1) img.data[i] = 255;
    const traced = traceFloorplanBoundaryCore(img);
    expect(traced.quality.confidence).toBe(0);
    expect(warningCodes(traced)).toContain('no-boundary');
  });

  it('attaches a confidence to every floor it does produce', () => {
    const { img } = nestedFloorsPlan();
    const traced = traceFloorplanBoundaryCore(img);
    for (const floor of traced.floors) {
      expect(floor.confidence).toBeGreaterThan(0);
      expect(floor.confidence).toBeLessThanOrEqual(1);
      expect(Array.isArray(floor.warnings)).toBe(true);
    }
  });
});
