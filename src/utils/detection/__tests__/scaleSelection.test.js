// The room the project scale is taken from, chosen without the user. Every
// fixture case below is the real per-room output of detectRoomFromClickCore on
// that plan (see `npm run bench:scale`), hard-coded so the selector's
// arithmetic is pinned without decoding a PNG.
import { describe, expect, it } from 'vitest';
import { selectProjectScale, MIN_CONSENSUS_ROOMS } from '../scale.js';

let nextRect = 0;
// Rooms only need a rect here so the non-GLA test has somewhere to put them;
// the scale itself comes from pixelsPerFoot, which the detector has already
// oriented to the rectangle.
const room = (name, x, y, confidence, labelDims = null, rect = null) => {
  nextRect += 1;
  return {
    labelId: name,
    rect: rect ?? {
      left: nextRect * 10, right: nextRect * 10 + 5,
      top: nextRect * 10, bottom: nextRect * 10 + 5,
    },
    confidence,
    pixelsPerFoot: { x, y },
    labelDims,
  };
};

// ExampleFloorplan6: LIVING ROOM is 12.9% high on both axes, agrees with
// itself to 0.3% and is rated 0.84, so nothing inside that room can see the
// error. Four bedrooms show it up.
const PLAN_6 = () => [
  room('BEDROOM 1 (left)', 14.44, 14.25, 0.95),
  room('BEDROOM 2 (left)', 14.16, 14.40, 0.98),
  room('BEDROOM 1 (right)', 13.97, 14.50, 0.98),
  room('BEDROOM 2 (right)', 14.72, 12.60, 0.73),
  room('LIVING ROOM (left)', 16.36, 16.32, 0.84),
];

describe('selectProjectScale: the scale is one room’s, and no other number', () => {
  // The rule the rest of this file follows from. The rooms' middle is 14.44
  // here — one axis of one room — and it used to be the scale in force, so the
  // box sat on BEDROOM 1 while the areas were worked out from a figure that
  // room does not state.
  it('applies the chosen room’s own two axes, not the middle of the rooms', () => {
    const decision = selectProjectScale(PLAN_6());
    expect(decision.room.name).toBe('BEDROOM 1 (left)');
    expect(decision.feetPerPixel.x).toBeCloseTo(1 / 14.44, 12);
    expect(decision.feetPerPixel.y).toBeCloseTo(1 / 14.25, 12);
    expect(decision.pixelsPerFoot).toBeCloseTo(Math.sqrt(14.44 * 14.25), 9);
  });

  it('settles a chosen room whose sides disagree on one scalar: its own', () => {
    // 15.0 across and 16.2 down are 8% apart — more than one room's two sides
    // may differ by and still be read as two scales.
    const decision = selectProjectScale([room('ONLY', 15.0, 16.2, 0.95)]);
    const own = 1 / Math.sqrt(15.0 * 16.2);
    expect(decision.feetPerPixel.x).toBeCloseTo(own, 12);
    expect(decision.feetPerPixel.y).toBeCloseTo(own, 12);
  });

});

describe('selectProjectScale on real fixture rooms', () => {
  // ExampleFloorplan: six well-drawn rooms at ~15.5-16.5 px/ft plus an
  // open-plan KITCHEN that ran into the dining area and reads +107%.
  //
  // GARAGE is dropped on its own label text, so five rooms are compared and
  // the one nearest the middle of them is BEDROOM (top-left), at 16.05.
  it('chooses a room the well-drawn rooms agree with', () => {
    const result = selectProjectScale([
      room('BEDROOM (top-left)', 16.13, 15.97, 0.98),
      room('PRIMARY BEDROOM', 15.82, 15.62, 0.95),
      room('BEDROOM (bottom-right)', 15.82, 16.34, 0.98),
      room('UTILITY', 16.10, 15.78, 0.98),
      room('GARAGE', 15.84, 15.58, 0.93),
      room('FAMILY ROOM', 16.52, 16.05, 0.98),
      room('KITCHEN (open-plan)', 32.04, 35.62, 0.70),
    ]);
    expect(result.room.name).toBe('BEDROOM (top-left)');
    expect(result.pixelsPerFoot).toBeCloseTo(16.05, 2);
    expect(result.level).toBe('ok');
    expect(result.reason).toBe('auto-room');
    expect(result.roomCount).toBe(5);
    // No exterior label boxes were supplied: the room's own text is enough.
    expect(result.rejected).toContainEqual(
      expect.objectContaining({ name: 'GARAGE', reason: 'non-gla' }),
    );
  });

  // The same KITCHEN clears the confidence gate at 0.70, so the gate alone is
  // not what saves this plan — being ranked against the middle is. It must be
  // reported as an outlier rather than as one of the rooms that agree, or the
  // spread reads 129% instead of 6%.
  it('does not count a room far from the others as one that agrees', () => {
    const result = selectProjectScale([
      room('BEDROOM (top-left)', 16.13, 15.97, 0.98),
      room('PRIMARY BEDROOM', 15.82, 15.62, 0.95),
      room('BEDROOM (bottom-right)', 15.82, 16.34, 0.98),
      room('UTILITY', 16.10, 15.78, 0.98),
      room('GARAGE', 15.84, 15.58, 0.93),
      room('FAMILY ROOM', 16.52, 16.05, 0.98),
      room('KITCHEN (open-plan)', 32.04, 35.62, 0.70),
    ]);
    expect(result.contributors.map((c) => c.name)).not.toContain('KITCHEN (open-plan)');
    expect(result.rejected).toContainEqual(
      expect.objectContaining({ name: 'KITCHEN (open-plan)', reason: 'outlier' }),
    );
    expect(Math.exp(result.spread) - 1).toBeLessThan(0.1);
  });

  // ExampleFloorplan2: four of its seven labels are open-plan or thin-divider
  // rooms the detector rated 0.17-0.30. Without the gate the middle is 19.01
  // px/ft against a drawing at 17.86; with it, the room chosen is BASEMENT-L.
  it('drops the rooms the detector could not confirm', () => {
    const result = selectProjectScale([
      room('FAMILY ROOM (L-shaped)', 14.98, 17.96, 0.67),
      room('LIVING ROOM', 19.01, 17.97, 0.29),
      room('BASEMENT-L', 18.01, 17.97, 0.85),
      room('BEDROOM (floor 3)', 23.92, 20.47, 0.67),
      room('BASEMENT-R (thin divider)', 19.15, 36.67, 0.17),
      room('KITCHEN (open-plan)', 44.66, 20.57, 0.29),
      room('FOYER (open-plan)', 36.54, 53.16, 0.30),
    ]);
    expect(result.room.name).toBe('BASEMENT-L');
    expect(result.pixelsPerFoot).toBeCloseTo(17.99, 2);
    expect(result.rejected.filter((r) => r.reason === 'low-confidence')).toHaveLength(4);
  });

  // The case measuring every room exists for. Choosing LIVING ROOM — the
  // largest and most confident-looking read on the page, and the one a user
  // would click — is 13% out, 27% on the area.
  it('does not choose a room that is wrong but agrees with itself perfectly', () => {
    const result = selectProjectScale(PLAN_6());
    expect(result.room.name).toBe('BEDROOM 1 (left)');
    expect(result.level).toBe('ok');
    expect(Math.abs(Math.log(16.36 / 14.5))).toBeGreaterThan(0.12);
  });

  it('prefers a room that agrees on both sides over a nearer one that agrees on one', () => {
    // A's x sits exactly on the middle and its y is 67% out — a rectangle that
    // leaked on one axis. Ranking by distance alone would hand it the scale.
    const decision = selectProjectScale([
      room('A (one axis leaked)', 15.0, 25.0, 0.9),
      room('B', 15.2, 15.1, 0.9),
      room('C', 14.9, 15.05, 0.9),
    ]);
    expect(decision.contributors.find((c) => c.name.startsWith('A')).axes).toEqual(['x']);
    expect(decision.room.name).toBe('C');
  });

  // The overlay is built from these two fields alone, so the projection
  // dropping either would silently stop placing it.
  it('hands back the rectangle and the label the overlay is drawn from', () => {
    const decision = selectProjectScale([
      room('BEDROOM', 15.5, 15.4, 0.95, { width: 12, height: 11 },
        { left: 10, right: 196, top: 20, bottom: 189 }),
      room('KITCHEN', 15.6, 15.45, 0.95, { width: 10, height: 9 }),
      room('DEN', 15.45, 15.5, 0.95, { width: 9, height: 9 }),
    ]);
    const chosen = decision.room;
    expect(chosen.rect).toEqual({ left: expect.any(Number), right: expect.any(Number),
      top: expect.any(Number), bottom: expect.any(Number) });
    expect(chosen.labelDims.width).toBeGreaterThan(0);
    expect(chosen.labelDims.height).toBeGreaterThan(0);
    // And it is one of the rooms recorded as agreeing, not a copy apart.
    expect(decision.contributors.map((c) => c.name)).toContain(chosen.name);
  });
});

describe('selectProjectScale when it cannot be sure', () => {
  it('still answers from two rooms, and says two is too few to check', () => {
    // ExampleFloorplan7 as the truth sidecar lists it.
    const result = selectProjectScale([
      room("OWNER'S SUITE", 18.16, 18.41, 0.89),
      room('BEDROOM 2', 18.42, 19.61, 0.98),
    ]);
    expect(result.room.name).toBe("OWNER'S SUITE");
    expect(result.pixelsPerFoot).toBeCloseTo(Math.sqrt(18.16 * 18.41), 9);
    expect(result.level).toBe('check');
    expect(result.reason).toBe('too-few-rooms');
    expect(result.roomCount).toBeLessThan(MIN_CONSENSUS_ROOMS);
  });

  // The case no confidence gate survives: most of the rooms are wrong, so the
  // room nearest the middle is wrong too. ExampleFloorplan's open-plan KITCHEN
  // reads 32 px/ft against a drawing at 15.5 and still scores 0.70, so a page
  // where OCR found three labels and two of them read like that is a 2x error
  // with a majority behind it. The footprint is 235437 px^2 and the three
  // labels state 370 sq ft between them; at 32 px/ft the building comes out at
  // 230 sq ft, which is smaller than the rooms it is supposed to contain.
  it('catches a scale that leaves the building too small to hold its rooms', () => {
    const result = selectProjectScale([
      room('KITCHEN', 32.04, 32.0, 0.70, { width: 10.08, height: 10.33 }),
      room('DINING AREA', 31.5, 31.8, 0.70, { width: 11, height: 9 }),
      room('PRIMARY BEDROOM', 15.82, 15.62, 0.95, { width: 12.58, height: 13.25 }),
    ], { footprintAreaPx: 235437 });
    expect(result.level).toBe('check');
    expect(result.reason).toBe('area-implausible');
    expect(result.areaRatio).toBeLessThan(1);
  });

  it('says nothing is wrong when the same rooms are measured at the right scale', () => {
    const result = selectProjectScale([
      room('KITCHEN', 15.4, 15.6, 0.95, { width: 10.08, height: 10.33 }),
      room('DINING AREA', 15.6, 15.5, 0.95, { width: 11, height: 9 }),
      room('PRIMARY BEDROOM', 15.82, 15.62, 0.95, { width: 12.58, height: 13.25 }),
    ], { footprintAreaPx: 235437 });
    expect(result.level).toBe('ok');
    expect(result.areaRatio).toBeGreaterThan(1);
  });

  // A plan dimensioned in meters, read as feet: 50 px to the meter, so 50
  // "px/ft". The rooms agree perfectly and the footprint (10 m x 12 m) against
  // the labels' 44.7 "sq ft" passes both area checks, because a uniform unit
  // error cancels in their ratio. Only the labels' own sizes give it away.
  it('says when the room sizes read too small to be feet', () => {
    const result = selectProjectScale([
      room('LIVING', 50.1, 49.9, 0.95, { width: 3.5, height: 4.2 }),
      room('BEDROOM', 49.8, 50.2, 0.95, { width: 3, height: 3.6 }),
      room('KITCHEN', 50, 50.1, 0.95, { width: 4, height: 4.8 }),
    ], { footprintAreaPx: 500 * 600 });
    expect(result.level).toBe('check');
    expect(result.reason).toBe('labels-look-metric');
    expect(result.areaRatio).toBeGreaterThan(0.7);
    expect(result.areaRatio).toBeLessThan(3.5);
  });

  // The direction nothing else sees: the rooms agree, and only the footprint
  // is too big for them (a garage the carve missed, a flood into the next
  // plan on the sheet). Four labels state 475 sq ft; 600000 px^2 at 15.5 px/ft
  // is about 2500 sq ft.
  it('catches a footprint far larger than its rooms account for', () => {
    const rooms = () => [
      room('KITCHEN', 15.4, 15.6, 0.95, { width: 10, height: 10 }),
      room('DINING', 15.6, 15.5, 0.95, { width: 11, height: 9 }),
      room('PRIMARY BEDROOM', 15.5, 15.5, 0.95, { width: 12, height: 13 }),
      room('BEDROOM', 15.5, 15.4, 0.95, { width: 10, height: 12 }),
    ];
    const result = selectProjectScale(rooms(), { footprintAreaPx: 600000 });
    expect(result.level).toBe('check');
    expect(result.reason).toBe('footprint-implausible');
    expect(result.areaRatio).toBeGreaterThan(3.5);

    expect(selectProjectScale(rooms(), { footprintAreaPx: 200000 }).level).toBe('ok');
  });

  // A garage is inside the drawing but is not the building the area serves,
  // and it is the rectangle most likely to be carved out from under the
  // footprint the scale is applied to.
  it('never chooses a garage or a porch', () => {
    // Named by its size alone, as a garage whose keyword was read as its own
    // label is: only the region can say what it is.
    const result = selectProjectScale([
      room('BEDROOM', 15.5, 15.5, 0.95, null, { left: 10, right: 20, top: 10, bottom: 20 }),
      room('20-7 x 9-6', 15.8, 15.6, 0.93, null, { left: 100, right: 140, top: 100, bottom: 140 }),
    ], { nonGlaRegions: [{ x: 90, y: 90, width: 80, height: 80 }] });
    expect(result.rejected).toContainEqual(
      expect.objectContaining({ name: '20-7 x 9-6', reason: 'non-gla' }),
    );
    expect(result.roomCount).toBe(1);
    expect(result.room.name).toBe('BEDROOM');
  });

  it('sets no scale at all when nothing measurable came back', () => {
    const result = selectProjectScale([
      { labelId: 'A', rect: { left: 0, right: 5, top: 0, bottom: 5 }, confidence: 0.9, pixelsPerFoot: null },
    ]);
    expect(result.pixelsPerFoot).toBeNull();
    expect(result.feetPerPixel).toBeNull();
    expect(result.room).toBeNull();
    expect(result.reason).toBe('no-rooms');
  });
});
