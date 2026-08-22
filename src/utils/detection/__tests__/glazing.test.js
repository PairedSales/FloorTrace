// A window drawn as a screened band instead of two black rails.
//
// Above the ink threshold the band is not there, so the wall it fills has a
// hole in it the width of the window. On an exterior wall that hole lets the
// flood into the building, and what comes back is an outline that follows real
// wall the whole way round, reports a high confidence and no warnings, and is
// missing the rooms behind the window — which is the shape of wrong answer this
// pipeline is least able to notice.
import fs from 'fs';
import path from 'path';
import { describe, expect, it, beforeAll } from 'vitest';
import { PNG } from 'pngjs';
import { detectRoomFromClickCore, traceFloorplanBoundaryCore } from '../pipeline.js';
import { selectProjectScale } from '../scale.js';
import { polygonArea, pointInPolygon } from '../polygon.js';
import { glazedHouse, polygonIou } from './synthetic.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');

const loadPng = (filePath) => {
  const png = PNG.sync.read(fs.readFileSync(filePath));
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
};

describe('screened glazing is still the wall', () => {
  // Only the widest of these is beyond the closing ladder's reach and so needs
  // the band rescued; the two narrower ones close either way and are here to
  // hold that the rescue does not move an answer that was already right.
  for (const span of [80, 120, 180]) {
    it(`closes a ${span}px window band that ends short of the corner`, () => {
      const { img, truth } = glazedHouse(span);
      const traced = traceFloorplanBoundaryCore(img, {});
      expect(traced.outer).toBeTruthy();
      expect(polygonIou(traced.outer.polygon, truth)).toBeGreaterThan(0.95);
      const err = Math.abs(polygonArea(traced.outer.polygon) - polygonArea(truth))
        / polygonArea(truth);
      expect(err).toBeLessThan(0.05);
    });
  }

  it('leaves screening that is in line with no wall exactly where it is', () => {
    // The same tone and the same thickness, drawn as three stair treads in the
    // middle of the room. Nothing is missing there, so nothing may be rescued:
    // the answer has to be the outline of the house with no band at all.
    const plain = traceFloorplanBoundaryCore(glazedHouse(0).img, {});
    const stray = traceFloorplanBoundaryCore(
      glazedHouse(0, { strayBand: true }).img, {},
    );
    expect(polygonIou(stray.outer.polygon, plain.outer.polygon)).toBeGreaterThan(0.99);
    expect(polygonIou(stray.outer.polygon, glazedHouse(0).truth)).toBeGreaterThan(0.95);
  });
});

// ExampleFloorplan8.png: a 600x370 second floor at ~17 px/ft with two bedrooms
// and a laundry closet. Its windows are drawn as screened bands, and the one in
// the bottom wall of the right-hand bedroom is 83px wide and stops 8px before
// the corner — so before this was rescued the trace came back at 96%
// confidence with no warnings, 25% short, and the right-hand bedroom outside it.
describe('ExampleFloorplan8.png', () => {
  let image;
  let traced;

  const LABELS = [
    { id: 'BEDROOM-right', point: { x: 452, y: 133 }, labelBbox: { x: 415, y: 128, width: 75, height: 11 }, labelDims: { width: 12.1667, height: 12.4167 } },
    { id: 'BEDROOM-left', point: { x: 131, y: 192 }, labelBbox: { x: 93, y: 187, width: 76, height: 10 }, labelDims: { width: 12.0833, height: 12.3333 } },
    { id: 'LAUNDRY', point: { x: 299, y: 114 }, labelBbox: { x: 269, y: 109, width: 61, height: 10 }, labelDims: { width: 6.4167, height: 5.3333 } },
  ];

  const measure = (index, withForeign) => detectRoomFromClickCore(image, LABELS[index].point, {
    cacheKey: withForeign ? 'ef8-foreign' : 'ef8',
    labelBbox: LABELS[index].labelBbox,
    labelDims: LABELS[index].labelDims,
    pixelsPerFoot: null,
    foreignPoints: withForeign
      ? LABELS.filter((_, i) => i !== index).map((l) => l.point)
      : [],
  });

  beforeAll(() => {
    image = loadPng(path.join(ROOT, 'fixtures', 'ExampleFloorplan8.png'));
    traced = traceFloorplanBoundaryCore(image, {});
  });

  it('encloses the bedroom behind the window', () => {
    expect(traced.floors.length).toBe(1);
    const outline = traced.floors[0].outer.polygon;
    for (const label of LABELS) {
      expect(pointInPolygon(label.point, outline)).toBe(true);
    }
    // 508 sq ft at the plan's own 17 px/ft; the breached trace read 383.
    expect(polygonArea(outline) / (17 * 17)).toBeGreaterThan(495);
    expect(polygonArea(outline) / (17 * 17)).toBeLessThan(520);
  });

  it('measures every labelled room, and agrees with all three', () => {
    const rooms = LABELS.map((label, i) => {
      const room = measure(i, true);
      expect(room, label.id).toBeTruthy();
      return { ...room, labelId: label.id, labelDims: label.labelDims };
    });
    const decision = selectProjectScale(rooms, {});
    expect(decision.roomCount).toBe(3);
    expect(decision.level).toBe('ok');
    expect(Math.abs(decision.pixelsPerFoot - 17)).toBeLessThan(0.7);
  });

  it('will not let one room hold another room’s label', () => {
    // The laundry's south side is a pair of bi-fold doors, so no ink states
    // where it ends and the aspect search is free to buy the shape the label
    // wants by running east through a wall — which lands the right-hand
    // bedroom's dimensions inside the laundry. Knowing the other labels is
    // what refuses that, so the flow that measures them together is the one
    // that gets it right.
    const loose = measure(2, false);
    const held = measure(2, true);
    expect(loose.rect.right).toBeGreaterThan(500);
    expect(held.rect.right).toBeLessThan(360);
    expect(held.pixelsPerFoot.x).toBeGreaterThan(16.5);
    expect(held.pixelsPerFoot.x).toBeLessThan(17.5);
  });
});
