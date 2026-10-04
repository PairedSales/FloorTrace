import { describe, it, expect } from 'vitest';
import {
  LABEL_GAP, LABEL_SHRINKS, isFarOut, movedLabelsAt, outwardNormals, placeLabels, rectDiscGap, rectGap,
  rectSegmentGap, ringObstacles, toLayoutSpace, wallLabelCandidates,
} from '../labelLayout';

const box = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });

describe('geometry', () => {
  it('measures a rectangle against a segment, touching or not', () => {
    const r = box(0, 0, 10, 10);
    expect(rectSegmentGap(r, -5, 5, 15, 5)).toBe(0); // straight through
    expect(rectSegmentGap(r, 5, 5, 6, 6)).toBe(0); // wholly inside
    expect(rectSegmentGap(r, 14, 0, 14, 10)).toBeCloseTo(4);
    expect(rectSegmentGap(r, 13, 14, 20, 14)).toBeCloseTo(Math.hypot(3, 4));
    // A diagonal that heads away from the corner: the nearest thing is its end.
    expect(rectSegmentGap(r, 12, 0, 20, -8)).toBeCloseTo(2, 6);
    // And one that passes the corner at an angle.
    expect(rectSegmentGap(r, 8, 14, 16, 6)).toBeCloseTo(Math.abs(10 + 10 - 22) / Math.SQRT2, 6);
  });

  it('measures a rectangle against a disc and another rectangle', () => {
    expect(rectDiscGap(box(0, 0, 10, 10), 15, 5, 3)).toBeCloseTo(2);
    expect(rectDiscGap(box(0, 0, 10, 10), 12, 5, 3)).toBe(0);
    expect(rectGap(box(0, 0, 10, 10), box(13, 14, 20, 20))).toBeCloseTo(5);
    expect(rectGap(box(0, 0, 10, 10), box(5, 5, 20, 20))).toBe(0);
  });

  it('turns image points into layout space and back', () => {
    const { forward, back } = toLayoutSpace(37, 2.5);
    const p = { x: 120, y: -45 };
    const q = back(forward(p));
    expect(q.x).toBeCloseTo(p.x, 6);
    expect(q.y).toBeCloseTo(p.y, 6);
    expect(Math.hypot(forward(p).x, forward(p).y)).toBeCloseTo(Math.hypot(p.x, p.y) * 2.5, 6);
  });

  it('points the normals away from the ring whichever way it winds', () => {
    const cw = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const ccw = [...cw].reverse();
    // Top wall of the clockwise ring is its first edge; outside is up (-y).
    expect(outwardNormals(cw)[0]).toEqual({ x: 0, y: -1 });
    // The reversed ring's first edge is the left wall (0,10)→(10,10)... the bottom one: outside is down.
    expect(outwardNormals(ccw)[0].y).toBe(1);
  });
});

describe('movedLabelsAt', () => {
  const placements = { scale: 0.5, rotation: 0, moved: { a: { x: 1, y: 2 } } };
  it('keeps what was placed at this zoom and turn', () => {
    expect(movedLabelsAt(placements, { scale: 0.5, rotation: 0 })).toEqual({ a: { x: 1, y: 2 } });
  });
  it('drops everything when the zoom or the turn changes', () => {
    expect(movedLabelsAt(placements, { scale: 0.51, rotation: 0 })).toEqual({});
    expect(movedLabelsAt(placements, { scale: 0.5, rotation: 90 })).toEqual({});
    expect(movedLabelsAt(null, { scale: 0.5, rotation: 0 })).toEqual({});
  });
  it('hands back one object when there is nothing, so memos on it hold', () => {
    expect(movedLabelsAt(null, { scale: 1 })).toBe(movedLabelsAt(undefined, { scale: 2 }));
  });
});

// A whole plan's worth: labels for every wall of a ring, placed as the canvas does.
const wallLabels = (ring, { w = 58, h = 22, extra = ringObstacles([]), crowdsOk = false } = {}) => {
  const normals = outwardNormals(ring);
  const own = ringObstacles(ring, { reach: 2, corner: 12 });
  const obstacles = {
    segments: [...own.segments, ...extra.segments],
    discs: [...own.discs, ...extra.discs],
    rects: [],
  };
  const tiers = LABEL_SHRINKS.map((k) => ({ w: w * k, h: h * Math.max(k, 0.9) }));
  const requests = ring.map((a, i) => ({
    id: i,
    candidates: wallLabelCandidates(a, ring[(i + 1) % ring.length], normals[i], tiers),
  }));
  return { placed: placeLabels(requests, obstacles, { crowdsOk }), obstacles };
};

const rectOf = (c) => box(c.x - c.w / 2, c.y - c.h / 2, c.x + c.w / 2, c.y + c.h / 2);

// Everything a clear label promises.
const expectClear = (placed, obstacles, { crowds = true } = {}) => {
  const boxes = [...placed.values()].map(rectOf);
  for (const [id, c] of placed) {
    if (!c.clear) continue;
    const r = rectOf(c);
    for (const s of obstacles.segments) {
      expect(rectSegmentGap(r, s.ax, s.ay, s.bx, s.by), `label ${id} on a wall`).toBeGreaterThanOrEqual(LABEL_GAP + s.reach - 1e-6);
    }
    for (const d of obstacles.discs) {
      expect(rectDiscGap(r, d.x, d.y, d.radius), `label ${id} on a corner`).toBeGreaterThanOrEqual(LABEL_GAP - 1e-6);
    }
  }
  if (crowds) {
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        expect(rectGap(boxes[i], boxes[j]), `labels ${i} and ${j} overlap`).toBeGreaterThanOrEqual(LABEL_GAP - 1e-6);
      }
    }
  }
};

const scaled = (ring, k, turn = 0) => {
  const { forward } = toLayoutSpace(turn, k);
  return ring.map(forward);
};

const SHAPES = {
  rectangle: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 25 }, { x: 0, y: 25 }],
  ell: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 12 }, { x: 14, y: 12 }, { x: 14, y: 30 }, { x: 0, y: 30 }],
  // Jogs: a 3-unit step in a long wall, and a 2-unit notch — the short walls that
  // used to get a label sitting on the corner beside them.
  jogged: [
    { x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 3 }, { x: 40, y: 3 }, { x: 40, y: 20 },
    { x: 24, y: 20 }, { x: 24, y: 22 }, { x: 20, y: 22 }, { x: 20, y: 20 }, { x: 0, y: 20 },
  ],
  // A comb: three narrow bays, each a few units wide.
  comb: [
    { x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 14 }, { x: 10, y: 14 }, { x: 10, y: 0 }, { x: 16, y: 0 },
    { x: 16, y: 14 }, { x: 20, y: 14 }, { x: 20, y: 0 }, { x: 26, y: 0 }, { x: 26, y: 20 }, { x: 0, y: 20 },
  ],
};

describe('wall labels', () => {
  for (const [name, shape] of Object.entries(SHAPES)) {
    for (const turn of [0, 90, 33, 180, 270]) {
      it(`${name}, turned ${turn}°: every label clear of every wall, corner and other label`, () => {
        // 14 px per unit: the plan fills a good part of a window.
        const ring = scaled(shape, 14, turn);
        const { placed, obstacles } = wallLabels(ring);
        expect(placed.size).toBe(ring.length);
        expectClear(placed, obstacles);
        for (const c of placed.values()) expect(c.clear).toBe(true);
      });
    }
  }

  it('puts a label outside its wall when there is room, in the middle of it', () => {
    const ring = scaled(SHAPES.rectangle, 14);
    const { placed } = wallLabels(ring);
    const top = placed.get(0); // the top wall, from (0,0) to (40,0) × 14
    expect(top.rank).toBe(0);
    expect(top.x).toBeCloseTo(280, 3);
    expect(top.y).toBeLessThan(0);
  });

  it('keeps off another outline that stands next to it', () => {
    const house = scaled(SHAPES.rectangle, 14);
    // A garage shares the house's right-hand wall's neighbourhood, 20 px off it.
    const garage = scaled([{ x: 40, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 25 }, { x: 40, y: 25 }], 14)
      .map((p) => ({ x: p.x + 20, y: p.y }));
    const { placed, obstacles } = wallLabels(house, { extra: ringObstacles(garage, { reach: 2, corner: 4 }) });
    expectClear(placed, obstacles);
    expect(placed.get(1).clear).toBe(true); // the right-hand wall, boxed in
  });

  it('shrinks a label before it gives up its place outside', () => {
    // A wall 30 px long between two corners 30 px apart: the full 58 px label
    // cannot clear the corner handles beside it, a smaller one can sit further out.
    const ring = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 30 }, { x: 170, y: 30 }, { x: 170, y: 120 }, { x: 0, y: 120 }];
    const { placed, obstacles } = wallLabels(ring, { w: 90, h: 24 });
    expectClear(placed, obstacles);
  });

  it('still draws a label that has nowhere clear, and says so', () => {
    // Boxed in on every side by a wall of corners as far as the label can reach.
    const ring = [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 8 }, { x: 0, y: 8 }];
    const around = { segments: [], discs: [{ x: 6, y: 4, radius: 500 }] };
    const { placed } = wallLabels(ring, { w: 70, h: 24, extra: around });
    expect(placed.size).toBe(4);
    for (const c of placed.values()) {
      expect(Number.isFinite(c.x) && Number.isFinite(c.y)).toBe(true);
      expect(c.clear).toBe(false);
    }
  });

  it('lets labels crowd each other far out, and still keeps them off the walls', () => {
    const ring = scaled(SHAPES.comb, 3); // a thumbnail: 78 px across
    expect(isFarOut(ring)).toBe(true);
    const { placed, obstacles } = wallLabels(ring, { crowdsOk: true });
    expect(placed.size).toBe(ring.length);
    expectClear(placed, obstacles, { crowds: false });
  });

  it('is deterministic', () => {
    const ring = scaled(SHAPES.jogged, 11, 33);
    const a = wallLabels(ring).placed;
    const b = wallLabels(ring).placed;
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it('holds across zooms: no clear label touches a wall at any of them', () => {
    for (const k of [6, 8, 10, 14, 20, 30]) {
      for (const [name, shape] of Object.entries(SHAPES)) {
        const ring = scaled(shape, k, 17);
        const { placed, obstacles } = wallLabels(ring);
        expectClear(placed, obstacles);
        // Nothing is dropped, however crowded.
        expect(placed.size, `${name} at ${k}`).toBe(ring.length);
      }
    }
  });
});

describe('placeLabels', () => {
  it('gives the label with the fewest choices the first pick', () => {
    // Two labels want the same open spot; the one with no other goes first.
    const picky = { id: 'picky', candidates: [{ x: 50, y: 50, w: 20, h: 10, cost: 0 }] };
    const easy = {
      id: 'easy',
      candidates: [
        { x: 50, y: 50, w: 20, h: 10, cost: 0 },
        { x: 150, y: 50, w: 20, h: 10, cost: 1 },
      ],
    };
    const out = placeLabels([easy, picky], { segments: [], discs: [], rects: [] });
    expect(out.get('picky').clear).toBe(true);
    expect(out.get('easy')).toMatchObject({ x: 150, clear: true, rank: 1 });
  });

  it('keeps off a label that is already fixed', () => {
    const fixed = { segments: [], discs: [], rects: [box(40, 40, 60, 60)] };
    const out = placeLabels([{ id: 1, candidates: [
      { x: 50, y: 50, w: 20, h: 10, cost: 0 },
      { x: 50, y: 90, w: 20, h: 10, cost: 1 },
    ] }], fixed);
    expect(out.get(1).rank).toBe(1);
  });
});
