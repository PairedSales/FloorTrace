import { describe, expect, it } from 'vitest';
import { decomposeArea, apportionPieces } from '../areaDecomposition';
import { calculateArea } from '../areaCalculator';

/**
 * The pieces are what a reviewer checks the sketch against, so two properties
 * carry the module: they add up to the area the Area card prints, and there
 * are few enough of them, and they are chunky enough, to be read.
 *
 * The named fixtures are levels lifted from a real a la mode TOTAL "Calculation
 * Details" page, with their published lines — the form this feature exists to
 * produce. Coordinates are reconstructed from the side labels printed on that
 * sketch, so the areas land within the labels' own tenth-of-a-foot rounding.
 */
const P = (pairs) => pairs.map(([x, y]) => ({ x, y }));
const ONE = { x: 1, y: 1 };

// The published "Second Floor — 732.31 Sq ft": a pinwheel with four reflex
// corners, whose minimum rectangle partition is four pieces.
const CROSS = P([
  [12.8, 0], [26.5, 0], [26.5, 11.8], [31.7, 11.8], [31.7, 26.7], [26.3, 26.7],
  [26.3, 33.1], [12.5, 33.1], [12.5, 27.5], [0, 27.5], [0, 11.8], [12.8, 11.8],
]);

// The published "Basement — 1114.9 Sq ft": a body with one slanted wall and a
// bay hanging off the bottom. TOTAL prints 39.9x22, 0.5x2.2x22, 26.4x2.8 and
// 14.9x9.4.
const BASEMENT = P([
  [2.2, 0], [42.1, 0], [42.1, 24.8], [30.6, 24.8],
  [30.6, 34.2], [15.7, 34.2], [15.7, 22], [0, 22],
]);

// The chamfered bay at the foot of the published First Floor, which that page
// prints as `6 x 2.9`, `0.5 x 2.9 x 2.9` and `0.5 x 2.9 x 2.9`.
const BAY = P([
  [0, 0], [20, 0], [20, 10], [14.1, 10], [11.2, 12.9], [8.8, 12.9], [5.9, 10], [0, 10],
]);

const rect = (w, h) => P([[0, 0], [w, 0], [w, h], [0, h]]);

const rotated = (w, h, deg) => {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return rect(w, h).map((p) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c }));
};

const summed = (result) => result.pieces
  .reduce((sum, p) => sum + (p.deducted ? -p.area : p.area), 0);

const thinnest = (result) => Math.min(...result.pieces.map((p) => Math.min(p.width, p.height)));

describe('decomposeArea — it adds up to the area the Area card prints', () => {
  it('matches calculateArea on the published levels', () => {
    for (const poly of [CROSS, BASEMENT, BAY]) {
      const got = decomposeArea(poly, ONE);
      expect(got.exact).toBe(true);
      expect(got.squareFeet).toBeCloseTo(calculateArea(poly, ONE), 9);
      expect(summed(got)).toBeCloseTo(got.squareFeet, 6);
    }
  });

  it('reaches the square footage that page published for each level', () => {
    // Within the tenth of a foot the side labels themselves were rounded to.
    expect(decomposeArea(CROSS, ONE).squareFeet).toBeCloseTo(732.3, 0);
    expect(decomposeArea(BASEMENT, ONE).squareFeet).toBeCloseTo(1114.9, -1);
  });

  // The property the whole card rests on. A breakdown that does not add up to
  // the figure beneath it reads, on a workfile a reviewer adds by hand, as an
  // error in the measurement rather than in the printing.
  it('holds for a thousand random outlines, rectilinear and not', () => {
    let seed = 20260824;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    let checked = 0;
    for (let trial = 0; trial < 1000; trial += 1) {
      // A staircase walk: rectilinear for half the trials, free-angle for the
      // rest, which is the difference between the grid cut and the sweep.
      const rectilinear = trial % 2 === 0;
      const n = 4 + Math.floor(rnd() * 8);
      const pts = [];
      let x = 0;
      let y = 0;
      for (let i = 0; i < n; i += 1) {
        x += (rnd() - 0.5) * 40;
        y += (rnd() - 0.5) * 40;
        pts.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
      }
      // Turn it into a simple shape by taking the convex hull, then, when a
      // rectilinear trial, replacing every edge with a two-step staircase.
      const hull = convexHull(pts);
      if (hull.length < 3) continue;
      const poly = rectilinear ? staircase(hull) : hull;
      const got = decomposeArea(poly, { x: 1.3, y: 0.7 });
      if (!got) continue;
      checked += 1;
      expect(got.squareFeet).toBeCloseTo(calculateArea(poly, { x: 1.3, y: 0.7 }), 6);
      if (got.exact) {
        expect(Math.abs(summed(got) - got.squareFeet))
          .toBeLessThanOrEqual(Math.max(0.5, got.squareFeet * 0.005) + 1e-6);
      }
    }
    expect(checked).toBeGreaterThan(700);
  });
});

describe('decomposeArea — the pieces are few and chunky', () => {
  it('reads a plain rectangle as one multiply', () => {
    const got = decomposeArea(rect(30, 20), ONE);
    expect(got.pieces).toHaveLength(1);
    expect(got.pieces[0]).toMatchObject({ kind: 'rect', width: 30, height: 20, area: 600 });
  });

  it('reads an L as two', () => {
    const L = P([[0, 0], [100, 0], [100, 40], [40, 40], [40, 80], [0, 80]]);
    expect(decomposeArea(L, ONE).pieces).toHaveLength(2);
  });

  // The reason the greedy maximises the short side rather than the area. Taking
  // the largest rectangle first here grabs the band across both wings and
  // leaves a 0.8 ft ribbon behind — four pieces either way, but one of them
  // meaningless.
  it('leaves no ribbon behind on the pinwheel that produces one', () => {
    const got = decomposeArea(CROSS, ONE);
    expect(got.pieces).toHaveLength(4);
    expect(thinnest(got)).toBeGreaterThan(5);
  });

  it('cuts a chamfered bay into the rectangle and the two wedges that page printed', () => {
    const got = decomposeArea(BAY, ONE);
    const tris = got.pieces.filter((p) => p.kind === 'tri');
    expect(tris).toHaveLength(2);
    for (const t of tris) {
      expect(t.width).toBeCloseTo(2.9, 6);
      expect(t.height).toBeCloseTo(2.9, 6);
      expect(t.area).toBeCloseTo(4.2, 1);
    }
    expect(got.pieces[0]).toMatchObject({ kind: 'rect' });
    expect(got.pieces[0].area).toBeCloseTo(200, 6);
  });

  it('states the slanted wall of the published basement as one wedge', () => {
    const got = decomposeArea(BASEMENT, ONE);
    const tris = got.pieces.filter((p) => p.kind === 'tri');
    expect(tris).toHaveLength(1);
    expect(tris[0].area).toBeCloseTo(24.2, 1);
    const body = got.pieces.find((p) => p.kind === 'rect');
    expect(body.width).toBeCloseTo(39.9, 6);
    expect(body.height).toBeCloseTo(22, 6);
  });
});

/* Cases built to break a decomposer rather than to exercise one. Each is a
   shape a real plan produces and a plausible implementation gets wrong in a way
   that still adds up — which is the dangerous kind, because the total is the
   only thing anyone re-checks. */
describe('decomposeArea — the ways this goes quietly wrong', () => {
  // Two 2 ft chamfers, one at each end of the same wall. Splitting the slab on
  // the *difference* of its two widths fuses them into a single 4 ft triangle:
  // the area is right and the dimension is nowhere on the drawing. They have to
  // come out as two wedges of 2 ft.
  it('keeps two chamfers on one wall apart', () => {
    const twice = P([[0, 0], [30, 0], [30, 18], [28, 20], [2, 20], [0, 18]]);
    const got = decomposeArea(twice, ONE);
    expect(got.exact).toBe(true);
    expect(summed(got)).toBeCloseTo(calculateArea(twice, ONE), 6);
    const tris = got.pieces.filter((p) => p.kind === 'tri');
    expect(tris).toHaveLength(2);
    for (const t of tris) {
      expect(t.width).toBeCloseTo(2, 6);
      expect(t.height).toBeCloseTo(2, 6);
    }
  });

  // A right triangle is what the grammar promises, so both legs have to be
  // real: the run of the slanted edge across the slab, and the slab's own
  // height. A triangle stated as base-times-altitude of its longest side names
  // two lengths that are on no wall.
  it('states every triangle on its own two legs', () => {
    const wedge = P([[0, 0], [40, 0], [40, 30], [10, 12]]);
    const got = decomposeArea(wedge, ONE);
    for (const piece of got.pieces.filter((p) => p.kind === 'tri')) {
      expect(piece.area).toBeCloseTo(0.5 * piece.width * piece.height, 9);
    }
    expect(summed(got)).toBeCloseTo(calculateArea(wedge, ONE), 6);
  });

  // The same pinwheel with the step deepened from 0.8 ft to 2.0 ft. A design
  // that reaches the good answer by absorbing anything under a threshold gets
  // this one wrong, because 2 ft is a real part of the building.
  it('handles a step too big to absorb the way a sliver would be', () => {
    const deeper = P([
      [12.8, 0], [26.5, 0], [26.5, 11.8], [31.7, 11.8], [31.7, 26.7], [26.3, 26.7],
      [26.3, 33.1], [12.5, 33.1], [12.5, 28.7], [0, 28.7], [0, 11.8], [12.8, 11.8],
    ]);
    const got = decomposeArea(deeper, ONE);
    expect(got.exact).toBe(true);
    expect(summed(got)).toBeCloseTo(calculateArea(deeper, ONE), 6);
    expect(got.pieces).toHaveLength(4);
    expect(thinnest(got)).toBeGreaterThan(4);
  });

  // A diamond is every edge at 45°, so there is no axis to cut against. Turned
  // onto its own edges it is a square.
  it('reads a diamond as the square it is', () => {
    const diamond = P([[0, 10], [10, 0], [20, 10], [10, 20]]);
    const got = decomposeArea(diamond, ONE);
    expect(got.squareFeet).toBeCloseTo(200, 6);
    expect(summed(got)).toBeCloseTo(200, 6);
    expect(got.pieces).toHaveLength(1);
  });

  // A tracer's staircase across a chamfer: a hundred half-inch treads. Nothing
  // may quietly weld them together, and the column still has to add up.
  it('does not weld a traced staircase into one wall', () => {
    const steps = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 22 }];
    let x = 40;
    let y = 22;
    for (let i = 0; i < 100; i += 1) {
      x -= 0.08;
      steps.push({ x, y });
      y += 0.08;
      steps.push({ x, y });
    }
    steps.push({ x: 0, y: 30 });
    const got = decomposeArea(steps, ONE);
    expect(got.squareFeet).toBeCloseTo(calculateArea(steps, ONE), 6);
    // Either it is described honestly, or it is refused — never described
    // wrongly.
    if (got.exact) expect(Math.abs(summed(got) - got.squareFeet)).toBeLessThan(1);
  });

  /* An oblique arm on an otherwise square plan: within the arm's slab the top
     and bottom cross-sections do not overlap, so no rectangle reaches both
     ends. Seating one on the inner faces anyway gives a negative rectangle,
     and dropping it while keeping both wedges over-reports — this shape came
     out at 2,300 against a true 2,200, which `exact` caught and which then
     blanked the card on a shape that has a two-piece answer. */
  it('measures a slab whose two ends do not overlap', () => {
    const arm = P([
      [0, 0], [100, 0], [100, 20], [60, 20], [75, 40], [65, 40], [50, 20], [0, 20],
    ]);
    const got = decomposeArea(arm, ONE);
    expect(got.exact).toBe(true);
    expect(got.squareFeet).toBeCloseTo(2200, 6);
    expect(summed(got)).toBeCloseTo(2200, 6);
  });

  // The same shape leaning unevenly, so the split has a wedge to state as well.
  it('keeps a sheared slab exact when its two ends differ in width', () => {
    const arm = P([
      [0, 0], [100, 0], [100, 20], [60, 20], [90, 40], [70, 40], [50, 20], [0, 20],
    ]);
    const got = decomposeArea(arm, ONE);
    expect(got.exact).toBe(true);
    expect(summed(got)).toBeCloseTo(calculateArea(arm, ONE), 6);
  });

  /* One slanted wall, crossed by slab boundaries that belong to steps on the
     far side of the building. Cut slab by slab it arrives as one small triangle
     per crossing — 0.6, 0.6, 0.6, 0.4 — four numbers that are on no wall. The
     wall leans 2.2 ft and that is the number that has to be printed. */
  it('states a slanted wall once, at the width it actually leans', () => {
    const stepped = P([
      [2.2, 0], [42.1, 0], [42.1, 6], [46, 6], [46, 12], [42.1, 12],
      [42.1, 18], [46, 18], [46, 24.8], [30.6, 24.8],
      [30.6, 34.2], [15.7, 34.2], [15.7, 22], [0, 22],
    ]);
    const got = decomposeArea(stepped, ONE);
    expect(got.exact).toBe(true);
    expect(summed(got)).toBeCloseTo(calculateArea(stepped, ONE), 6);
    const tris = got.pieces.filter((p) => p.kind === 'tri');
    expect(tris).toHaveLength(1);
    expect(tris[0].width).toBeCloseTo(2.2, 6);
    expect(tris[0].height).toBeCloseTo(22, 6);
  });

  /* A hand-drawn ring has a winning angle like any other shape. Turning onto it
     cuts the outline in a frame that corresponds to nothing, and the card then
     captions the result "measured along the walls, which run 86° off the page"
     — about an outline with no walls. */
  it('does not turn an outline that has no dominant direction', () => {
    const blob = P([[0, 0], [37, 4], [61, 27], [55, 58], [22, 66], [3, 41]]);
    const got = decomposeArea(blob, ONE);
    expect(got.rotation).toBe(0);
    expect(got.exact).toBe(true);
    expect(summed(got)).toBeCloseTo(calculateArea(blob, ONE), 6);
  });

  /* With no scale the app measures in pixels, so a 3,000 px drawing has pieces
     of millions of "square feet". A greedy that packs its two keys into
     `min(w, h) * 1e6 + w * h` starts ranking by area once it gets there, which
     is the opposite of what the objective says. */
  it('ranks by the short side however large the numbers get', () => {
    const uncalibrated = P([
      [0, 0], [3000, 0], [3000, 2000], [1200, 2000], [1200, 900], [0, 900],
    ]);
    const got = decomposeArea(uncalibrated, ONE);
    expect(got.exact).toBe(true);
    expect(got.pieces).toHaveLength(2);
    expect(thinnest(got)).toBe(900);
  });

  // A courtyard leaves a small net area wrapped in large pieces, which is where
  // a residual bound stated as a fraction of the net can refuse a perfectly
  // ordinary plan.
  it('still works an atrium whose net area is a sliver of its pieces', () => {
    const outerRing = rect(100, 100);
    const got = decomposeArea(outerRing, ONE, [{ id: 'h', ring: P([[1, 1], [99, 1], [99, 99], [1, 99]]) }]);
    expect(got.squareFeet).toBeCloseTo(10000 - 98 * 98, 6);
    expect(got.exact).toBe(true);
    expect(summed(got)).toBeCloseTo(got.squareFeet, 6);
  });
});

describe('decomposeArea — an outline drawn off the square', () => {
  // A garage drawn at an angle is one rectangle, and its two lengths are the
  // wall lengths printed on the sketch. Cut against the page instead, the same
  // shape is seven slivers whose lengths match nothing a reviewer can see.
  it('turns onto its own dominant direction first', () => {
    const got = decomposeArea(rotated(25.3, 24, 20), ONE);
    expect(got.rotation).toBeCloseTo(20, 6);
    expect(got.pieces).toHaveLength(1);
    expect(got.pieces[0].width).toBeCloseTo(25.3, 6);
    expect(got.pieces[0].height).toBeCloseTo(24, 6);
    expect(got.squareFeet).toBeCloseTo(25.3 * 24, 6);
  });

  it('leaves a plan that is already square to the page alone', () => {
    expect(decomposeArea(CROSS, ONE).rotation).toBe(0);
    expect(decomposeArea(rotated(25.3, 24, 1), ONE).rotation).toBe(0);
  });

  // The scale can be anisotropic, so the shape has to be converted to feet
  // before any angle is measured: a square in pixels is not a square in feet.
  it('measures the angle in feet, not in pixels', () => {
    const square = rect(100, 100);
    const got = decomposeArea(square, { x: 0.1, y: 0.05 });
    expect(got.squareFeet).toBeCloseTo(10 * 5, 9);
    expect(got.pieces[0].width).toBeCloseTo(10, 9);
    expect(got.pieces[0].height).toBeCloseTo(5, 9);
  });
});

describe('decomposeArea — voids', () => {
  it('cuts a void up too and marks the pieces as deductions', () => {
    const got = decomposeArea(rect(100, 100), ONE, [{ id: 'h', ring: rect(10, 20) }]);
    const cut = got.pieces.filter((p) => p.deducted);
    expect(cut).toHaveLength(1);
    expect(cut[0].area).toBeCloseTo(200, 9);
    expect(got.squareFeet).toBeCloseTo(9800, 9);
    expect(summed(got)).toBeCloseTo(9800, 6);
  });

  it('leaves a stale void out, exactly as the area does', () => {
    const got = decomposeArea(rect(100, 100), ONE, [{ id: 'h', ring: rect(10, 20), stale: true }]);
    expect(got.pieces.some((p) => p.deducted)).toBe(false);
    expect(got.squareFeet).toBeCloseTo(10000, 9);
  });

  it('sorts every deduction after the pieces it comes off', () => {
    const got = decomposeArea(rect(100, 100), ONE, [{ id: 'h', ring: rect(30, 30) }]);
    const first = got.pieces.findIndex((p) => p.deducted);
    expect(first).toBe(got.pieces.length - 1);
  });
});

describe('decomposeArea — it declines rather than mislead', () => {
  it('offers nothing for an outline with fewer than three corners', () => {
    expect(decomposeArea([{ x: 0, y: 0 }, { x: 1, y: 1 }], ONE)).toBeNull();
    expect(decomposeArea(null, ONE)).toBeNull();
  });

  // A bow-tie's lobes cancel in the shoelace, so no partition of it can add up
  // to the area the app reports. `exact` is how the card knows to print the
  // figure with no working rather than working that does not reach the figure.
  it('marks a self-intersecting outline inexact', () => {
    const bowtie = P([[0, 0], [10, 10], [10, 0], [0, 10]]);
    const got = decomposeArea(bowtie, ONE);
    expect(got === null || got.exact === false).toBe(true);
  });

  it('drops a piece too small to print and says how much it dropped', () => {
    // A 40 ft wall with a 0.01 ft jog in it: real geometry, unprintable piece.
    const jog = P([[0, 0], [40, 0], [40, 20], [20, 20], [20, 19.99], [0, 19.99]]);
    const got = decomposeArea(jog, ONE);
    expect(got.residual).toBeLessThan(0.5);
    expect(got.exact).toBe(true);
    expect(got.pieces.every((p) => p.area >= 0.5)).toBe(true);
  });
});

describe('apportionPieces', () => {
  it('makes the column add up to the total printed under it', () => {
    const values = [100.04, 100.04, 100.04];
    const out = apportionPieces(values, 300.12, 1);
    expect(out.reduce((s, v) => s + v, 0)).toBeCloseTo(300.1, 9);
  });

  it('never moves a piece by more than one printed step', () => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let trial = 0; trial < 500; trial += 1) {
      const n = 1 + Math.floor(rnd() * 30);
      const values = Array.from({ length: n }, () => rnd() * 400);
      const total = Number(values.reduce((s, v) => s + v, 0).toFixed(1));
      const out = apportionPieces(values, total, 1);
      expect(Number(out.reduce((s, v) => s + v, 0).toFixed(1))).toBeCloseTo(total, 9);
      out.forEach((v, i) => expect(Math.abs(v - values[i])).toBeLessThanOrEqual(0.1 + 1e-9));
    }
  });

  it('has nothing to say about no pieces', () => {
    expect(apportionPieces([], 0)).toEqual([]);
  });
});

// ── helpers used only by the property test ────────────────────────────────
function convexHull(points) {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half([...pts].reverse())];
}

// Replace each edge with a right-angled two-step, giving a rectilinear polygon
// that is still simple.
function staircase(poly) {
  const out = [];
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    out.push(a, { x: b.x, y: a.y });
  }
  return out;
}
