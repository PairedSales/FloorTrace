// The project scale chosen without the user. Every fixture case below is the
// real per-room output of detectRoomFromClickCore on that plan (see
// `npm run bench:scale`), hard-coded so the selector's arithmetic is pinned
// without decoding a PNG.
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

describe('selectProjectScale on real fixture rooms', () => {
  // ExampleFloorplan: six well-drawn rooms at ~15.5-16.5 px/ft plus an
  // open-plan KITCHEN that ran into the dining area and reads +107%.
  //
  // GARAGE is dropped on its own label text, so five rooms vote and the answer
  // is 16.05 rather than the 15.97 the garage used to pull it to. That is 0.5pp
  // further from this fixture's 15.5 truth, and it is not the garage having
  // been a good ruler: every rect on this plan reads ~3% high together, and the
  // garage's happened to be one of the lower reads. The truth's own provenance
  // median is 15.492 with the garage and 15.492 without it.
  it('settles on the scale the well-drawn rooms agree about', () => {
    const result = selectProjectScale([
      room('BEDROOM (top-left)', 16.13, 15.97, 0.98),
      room('PRIMARY BEDROOM', 15.82, 15.62, 0.95),
      room('BEDROOM (bottom-right)', 15.82, 16.34, 0.98),
      room('UTILITY', 16.10, 15.78, 0.98),
      room('GARAGE', 15.84, 15.58, 0.93),
      room('FAMILY ROOM', 16.52, 16.05, 0.98),
      room('KITCHEN (open-plan)', 32.04, 35.62, 0.70),
    ]);
    expect(result.pixelsPerFoot).toBeCloseTo(16.05, 2);
    expect(result.level).toBe('ok');
    expect(result.reason).toBe('auto-consensus');
    expect(result.roomCount).toBe(5);
    // No exterior label boxes were supplied: the room's own text is enough.
    expect(result.rejected).toContainEqual(
      expect.objectContaining({ name: 'GARAGE', reason: 'non-gla' }),
    );
  });

  // The same KITCHEN clears the confidence gate at 0.70, so the gate alone is
  // not what saves this plan — the median is. It must still be reported as an
  // outlier rather than as one of the rooms that set the scale, or the spread
  // the user is shown reads 129% instead of 6%.
  it('does not count a room the median threw away as one that set the scale', () => {
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
  // rooms the detector rated 0.17-0.30. Without the gate the answer is 19.01
  // px/ft against a drawing at 17.86; with it, 17.97.
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
    expect(result.pixelsPerFoot).toBeCloseTo(17.97, 2);
    expect(result.rejected.filter((r) => r.reason === 'low-confidence')).toHaveLength(4);
  });

  // ExampleFloorplan6's LIVING ROOM is the case the whole design exists for:
  // 12.9% high on both axes, agreeing with itself to 0.3% and rated 0.84, so
  // nothing inside that room can see the error. Four bedrooms outvote it.
  it('outvotes a room that is wrong but agrees with itself perfectly', () => {
    const rooms = [
      room('BEDROOM 1 (left)', 14.44, 14.25, 0.95),
      room('BEDROOM 2 (left)', 14.16, 14.40, 0.98),
      room('BEDROOM 1 (right)', 13.97, 14.50, 0.98),
      room('BEDROOM 2 (right)', 14.72, 12.60, 0.73),
      room('LIVING ROOM (left)', 16.36, 16.32, 0.84),
    ];
    const result = selectProjectScale(rooms);
    expect(result.pixelsPerFoot).toBeCloseTo(14.44, 2);
    expect(result.level).toBe('ok');
    // Calibrating from that one room instead, which is what a click on its
    // dimension pill used to do, is 13% out — 27% on the area.
    expect(Math.abs(Math.log(16.36 / 14.5))).toBeGreaterThan(0.12);
  });
});

describe('selectProjectScale when it cannot be sure', () => {
  it('still answers from two rooms, and says two is not a majority', () => {
    // ExampleFloorplan7 as the truth sidecar lists it.
    const result = selectProjectScale([
      room("OWNER'S SUITE", 18.16, 18.41, 0.89),
      room('BEDROOM 2', 18.42, 19.61, 0.98),
    ]);
    expect(result.pixelsPerFoot).toBeCloseTo(18.42, 2);
    expect(result.level).toBe('check');
    expect(result.reason).toBe('too-few-rooms');
    expect(result.roomCount).toBeLessThan(MIN_CONSENSUS_ROOMS);
  });

  // The case no confidence gate survives: most of the rooms are wrong, so the
  // median is wrong too. ExampleFloorplan's open-plan KITCHEN reads 32 px/ft
  // against a drawing at 15.5 and still scores 0.70, so a page where OCR found
  // three labels and two of them read like that is a 2x error with a majority
  // behind it. The footprint is 235437 px^2 and the three labels state 370
  // sq ft between them; at 32 px/ft the building comes out at 230 sq ft, which
  // is smaller than the rooms it is supposed to contain.
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

  // A garage is inside the drawing but is not the building the area serves,
  // and it is the rectangle most likely to be carved out from under the
  // footprint the scale is applied to.
  it('leaves garages and porches out of the vote', () => {
    const result = selectProjectScale([
      room('BEDROOM', 15.5, 15.5, 0.95, null, { left: 10, right: 20, top: 10, bottom: 20 }),
      room('GARAGE', 15.8, 15.6, 0.93, null, { left: 100, right: 140, top: 100, bottom: 140 }),
    ], { nonGlaRegions: [{ x: 90, y: 90, width: 80, height: 80 }] });
    expect(result.rejected).toContainEqual(
      expect.objectContaining({ name: 'GARAGE', reason: 'non-gla' }),
    );
    expect(result.roomCount).toBe(1);
  });

  it('sets no scale at all when nothing measurable came back', () => {
    const result = selectProjectScale([
      { labelId: 'A', rect: { left: 0, right: 5, top: 0, bottom: 5 }, confidence: 0.9, pixelsPerFoot: null },
    ]);
    expect(result.pixelsPerFoot).toBeNull();
    expect(result.reason).toBe('no-rooms');
  });

  it('has nothing to say about an empty page', () => {
    const result = selectProjectScale([]);
    expect(result.pixelsPerFoot).toBeNull();
    expect(result.roomCount).toBe(0);
  });
});
