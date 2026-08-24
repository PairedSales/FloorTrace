// The outline, cut into rectangles and right triangles that add up to it.
//
// An appraisal workfile shows its working for the area sketch as a column of
// arithmetic — `13.7 × 11.8 = 161.7`, `0.5 × 2.9 × 2.9 = 4.2` — one line per
// piece, adding to the level. That is the form a reviewer checks: a piece's two
// lengths can be read off against the dimensions printed on the plan, which a
// pixel count never could.
//
// Everything here is in feet, converted on the way in, because a piece is a
// claim about the building. The scale may be anisotropic, so the conversion
// happens before any geometry: a 45° edge in pixels is not a 45° edge in feet.
//
// Pure and node-testable. The area it produces is checked against the shoelace
// the Area card uses rather than trusted — see `exact`.

import { signedArea, holeRings, isSubtracted } from './areaCalculator';

// Float noise only. Two coordinates this close came from one number that went
// through a rotation; a real drawing's smallest step is thousands of times
// larger. Deliberately not a physical tolerance — snapping away a genuine
// one-pixel jog would move the area quietly, and the area is what is being
// explained.
const SNAP_REL = 1e-9;

// Below this the outline is treated as square to the page. Above it the whole
// ring is turned onto its own dominant direction before being cut up: a garage
// drawn at 20° becomes one rectangle that way and seven meaningless slivers
// otherwise. Area is rotation-invariant, so this costs nothing and gains every
// piece a length that matches a wall.
const ROTATE_MIN_DEG = 2;
// How close two edges must run to count as parallel when looking for that
// dominant direction.
const PARALLEL_DEG = 0.75;
// …and how much of the outline has to agree before that direction is treated
// as the building's. A hand-drawn ring has a winning angle like anything else,
// and turning onto it cuts the shape in a frame that corresponds to nothing —
// then captions the result "measured along the walls, which run 86° off the
// page", about an outline with no walls. Below this the ring is cut against
// the page and `rotation` stays 0, so that sentence never appears.
const ROTATE_MIN_SUPPORT = 0.55;

// A piece too small to print. Dropped rather than shown as `0.0`; what it
// carried is redistributed by `apportionPieces`, so the column still adds up.
// Half a square foot is below the accuracy of any traced outline, and
// `residual` reports the total dropped so a caller can refuse the whole
// breakdown if it ever adds up to something.
const MIN_PIECE_SQFT = 0.5;

// A grid past this size means a trace with a pathological vertex count. The
// sweep is linear in it; the greedy search is not.
const MAX_CELLS = 6000;
const MAX_PIECES = 400;

const feetPolygon = (vertices, fpp) => vertices.map((v) => ({
  x: v.x * fpp.x,
  y: v.y * fpp.y,
}));

// Collapse coordinates differing only in the last bits, so a rotated
// rectangle's four corners share two x values exactly rather than nearly.
const snapPolygon = (poly) => {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const extent = Math.max(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
    1,
  );
  const eps = extent * SNAP_REL;
  const canonical = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const keys = [];
    for (const v of sorted) {
      if (!keys.length || v - keys[keys.length - 1] > eps) keys.push(v);
    }
    return (v) => {
      for (const k of keys) if (Math.abs(v - k) <= eps) return k;
      return v;
    };
  };
  const sx = canonical(xs);
  const sy = canonical(ys);
  return { poly: poly.map((p) => ({ x: sx(p.x), y: sy(p.y) })), eps };
};

// The direction the most edge length runs in, folded into [0°, 90°), with the
// share of the perimeter that agrees with it.
const dominantAngle = (poly) => {
  const edges = [];
  let perimeter = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) continue;
    let deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    deg = ((deg % 90) + 90) % 90;
    edges.push({ deg, len });
    perimeter += len;
  }
  let best = 0;
  let bestLen = -1;
  for (const edge of edges) {
    let total = 0;
    for (const other of edges) {
      let diff = Math.abs(other.deg - edge.deg);
      if (diff > 45) diff = 90 - diff;
      if (diff <= PARALLEL_DEG) total += other.len;
    }
    // Ties go to the shallower angle, so a plan with equal runs both ways
    // cannot flip between two directions as one vertex moves by a pixel.
    if (total > bestLen + 1e-9
        || (Math.abs(total - bestLen) <= 1e-9 && edge.deg < best)) {
      bestLen = total;
      best = edge.deg;
    }
  }
  return { angle: best, support: perimeter > 0 ? bestLen / perimeter : 0 };
};

const rotatePolygon = (poly, deg) => {
  const r = (-deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return poly.map((p) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c }));
};

const isRectilinear = (poly, eps) => poly.every((p, i) => {
  const q = poly[(i + 1) % poly.length];
  return Math.abs(p.x - q.x) <= eps || Math.abs(p.y - q.y) <= eps;
});

// Winding rule, matching `signedArea`, so a self-touching outline is described
// the same way it is measured.
const containsPoint = (poly, px, py) => {
  let winding = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const side = (b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y);
    if (a.y <= py) {
      if (b.y > py && side > 0) winding += 1;
    } else if (b.y <= py && side < 0) winding -= 1;
  }
  return winding !== 0;
};

/* ── the rectilinear cut ───────────────────────────────────────────────────
   Compress the distinct x and y coordinates into a grid of cells — exact when
   every edge is axis-aligned, because then no edge crosses a cell — and take
   maximal rectangles off it one at a time.

   The objective is `min(width, height)` first and area second, *not* area
   first. Area-first is the obvious greedy and it is wrong here: on a plan with
   two wings it takes the full-width band across both and strands the taller
   wing's remainder as a 0.8 ft ribbon. Fattest-first reaches the same piece
   count with nothing thinner than a real step in the building, and matched an
   exhaustive minimum-piece search on every fixture tried. */
const gridCut = (poly) => {
  const xs = [...new Set(poly.map((p) => p.x))].sort((a, b) => a - b);
  const ys = [...new Set(poly.map((p) => p.y))].sort((a, b) => a - b);
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  if (nx < 1 || ny < 1 || nx * ny > MAX_CELLS) return null;

  const cells = [];
  for (let i = 0; i < nx; i += 1) {
    const column = [];
    for (let j = 0; j < ny; j += 1) {
      column.push(containsPoint(poly, (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2));
    }
    cells.push(column);
  }

  const pieces = [];
  for (;;) {
    let best = null;
    for (let i0 = 0; i0 < nx; i0 += 1) {
      for (let j0 = 0; j0 < ny; j0 += 1) {
        if (!cells[i0][j0]) continue;
        let ceiling = ny;
        for (let i1 = i0; i1 < nx; i1 += 1) {
          let j = j0;
          while (j < ceiling && cells[i1][j]) j += 1;
          ceiling = j;
          if (ceiling === j0) break;
          for (let j1 = j0 + 1; j1 <= ceiling; j1 += 1) {
            const w = xs[i1 + 1] - xs[i0];
            const h = ys[j1] - ys[j0];
            // Fattest first, area second — compared as two keys rather than
            // packed into one. `min(w, h) * 1e6 + w * h` reads the same until
            // an area passes 1e6, at which point it silently starts ranking
            // by area; an uncalibrated plan measures in pixels, so a 3,000 px
            // drawing gets there.
            const thin = Math.min(w, h);
            if (best === null || thin > best.thin + 1e-9
                || (thin > best.thin - 1e-9 && w * h > best.w * best.h + 1e-9)) {
              best = {
                i0, j0, i1, j1, w, h, thin,
              };
            }
          }
        }
      }
    }
    if (!best) break;
    for (let i = best.i0; i <= best.i1; i += 1) {
      for (let j = best.j0; j < best.j1; j += 1) cells[i][j] = false;
    }
    pieces.push({
      kind: 'rect', width: best.w, height: best.h, area: best.w * best.h,
    });
    if (pieces.length > MAX_PIECES) return null;
  }
  return pieces;
};

/* ── the general cut ───────────────────────────────────────────────────────
   Sweep the distinct y coordinates. Between two of them the cross-section is a
   fixed set of trapezoids, and each trapezoid is the largest rectangle that
   fits inside it plus one right triangle per slanted side. That split is exact
   rather than an approximation:

     minWidth + ½|Δleft| + ½|Δright|  =  mean width

   Vertically adjacent rectangles spanning the same x are then merged, which is
   what stops a plain wall arriving as one piece per vertex on the far side of
   the building. */
const sweepCut = (poly, eps) => {
  const ys = [...new Set(poly.map((p) => p.y))].sort((a, b) => a - b);

  /* Both ends of the slab off the same edges, evaluated *at* the slab
     boundaries rather than a hair inside them. Sampling at y0 + εh instead
     costs the interpolated x a relative ε, which on a slanted wall is a piece
     width wrong in the sixth figure — small, but it is a wall length a reviewer
     reads against the plan, and there is no reason to approximate a number that
     has a closed form.

     Each crossing carries the edge it came off, which is what lets one wall be
     stated once instead of once per slab. */
  const slabSpans = (y0, y1) => {
    const mid = (y0 + y1) / 2;
    const crossings = [];
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (a.y === b.y) continue;
      const lo = Math.min(a.y, b.y);
      const hi = Math.max(a.y, b.y);
      // Consecutive distinct vertex heights, so an edge reaching into this slab
      // necessarily crosses all of it.
      if (lo > y0 + eps || hi < y1 - eps) continue;
      const at = (y) => a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
      crossings.push({
        edge: i, top: at(y0), bottom: at(y1), mid: at(mid), dir: b.y > a.y ? 1 : -1,
      });
    }
    crossings.sort((p, q) => p.mid - q.mid);
    const spans = [];
    let winding = 0;
    let open = null;
    for (const c of crossings) {
      if (winding === 0) open = c;
      winding += c.dir;
      if (winding === 0) {
        spans.push({
          lt: open.top,
          lb: open.bottom,
          leftEdge: open.edge,
          rt: c.top,
          rb: c.bottom,
          rightEdge: c.edge,
        });
      }
    }
    // Winding that does not come back to zero across a slab means the outline
    // crosses itself. Refuse rather than describe it wrongly.
    return winding === 0 ? spans : null;
  };

  const slabs = [];
  for (let i = 0; i < ys.length - 1; i += 1) {
    const y0 = ys[i];
    const y1 = ys[i + 1];
    if (y1 - y0 <= eps) continue;
    const spans = slabSpans(y0, y1);
    if (!spans) return null;
    slabs.push({
      y0, y1, h: y1 - y0, spans,
    });
    if (slabs.length > MAX_PIECES) return null;
  }
  if (!slabs.length) return null;

  const xAt = (edge, y) => {
    const a = poly[edge];
    const b = poly[(edge + 1) % poly.length];
    return a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
  };

  /* One wall, one wedge.

     A slanted wall crossed by slab boundaries belonging to features on the
     *other* side of the building otherwise arrives as one small triangle per
     slab: the published basement's 2.2 ft lean came out as 0.6, 0.6, 0.6 and
     0.4 — four numbers a reviewer cannot find anywhere on the drawing. So each
     edge takes the whole run over which it bounds the outline, its rectangles
     all seat on the innermost face it reaches, and its wedge is stated once, at
     the width the wall actually leans.

     Exact for the same reason the per-slab split is: over the run the mean face
     is the seat plus half the lean, so seat·H + ½|lean|·H is the integral. */
  const extend = (runs, edge, y0, y1) => {
    const at = runs.get(edge);
    if (!at) runs.set(edge, { y0, y1 });
    else {
      at.y0 = Math.min(at.y0, y0);
      at.y1 = Math.max(at.y1, y1);
    }
  };
  const leftRuns = new Map();
  const rightRuns = new Map();
  for (const slab of slabs) {
    for (const span of slab.spans) {
      extend(leftRuns, span.leftEdge, slab.y0, slab.y1);
      extend(rightRuns, span.rightEdge, slab.y0, slab.y1);
    }
  }
  // The interior lies to the right of a left wall and to the left of a right
  // one, so the seat is the innermost face that wall reaches over its run.
  const seatsFor = (runs, innermost) => {
    const seats = new Map();
    for (const [edge, at] of runs) {
      seats.set(edge, innermost(xAt(edge, at.y0), xAt(edge, at.y1)));
    }
    return seats;
  };
  const seatLeft = seatsFor(leftRuns, Math.max);
  const seatRight = seatsFor(rightRuns, Math.min);

  /* Seating on the run rather than on the slab can push a rectangle negative
     where the slab's own faces would not have: two walls leaning the same way
     over a long run outrun the width between them. Stating one wall once is a
     legibility move and nothing else, so it is given up for the whole ring when
     that happens and every slab falls back to its own faces. */
  const runsFit = slabs.every((slab) => slab.spans.every((span) => (
    seatRight.get(span.rightEdge) - seatLeft.get(span.leftEdge) >= -eps
  )));

  const columns = [];
  const triangles = [];
  // Rectangles off a sheared slab. Kept apart from `columns` because they are a
  // cross-section rather than a span between two faces, so nothing may merge
  // them with the slab above.
  const skewed = [];

  const wedge = (runs) => {
    for (const [edge, at] of runs) {
      const lean = Math.abs(xAt(edge, at.y0) - xAt(edge, at.y1));
      const h = at.y1 - at.y0;
      if (lean > eps) {
        triangles.push({
          kind: 'tri', width: lean, height: h, area: 0.5 * lean * h,
        });
      }
    }
  };

  if (runsFit) {
    wedge(leftRuns);
    wedge(rightRuns);
    for (const slab of slabs) {
      for (const span of slab.spans) {
        const left = seatLeft.get(span.leftEdge);
        const right = seatRight.get(span.rightEdge);
        if (right - left > eps) {
          columns.push({
            x0: left, x1: right, y0: slab.y0, y1: slab.y1,
          });
        }
      }
    }
  } else {
    for (const slab of slabs) {
      const { h } = slab;
      for (const {
        lt, rt, lb, rb,
      } of slab.spans) {
        const left = Math.max(lt, lb);
        const right = Math.min(rt, rb);
        if (right - left >= -eps) {
          // Seat the rectangle on the inner face of each side and give each
          // side its own wedge — separately, because one triangle of width
          // |wTop − wBot| sums to the same area while fusing two 2 ft chamfers
          // at opposite ends of a wall into a 4 ft dimension that is nowhere on
          // the plan.
          if (right - left > eps) {
            columns.push({
              x0: left, x1: right, y0: slab.y0, y1: slab.y1,
            });
          }
          const dl = Math.abs(lt - lb);
          const dr = Math.abs(rt - rb);
          if (dl > eps) {
            triangles.push({
              kind: 'tri', width: dl, height: h, area: 0.5 * dl * h,
            });
          }
          if (dr > eps) {
            triangles.push({
              kind: 'tri', width: dr, height: h, area: 0.5 * dr * h,
            });
          }
        } else {
          /* Sheared: both sides lean the same way by more than the slab is
             wide, so its top and bottom cross-sections do not overlap and no
             rectangle reaches both. Taking the inner faces anyway gives a
             negative rectangle, and dropping it while keeping both wedges
             over-reports — an oblique arm on an otherwise square plan came out
             2,300 against a true 2,200, which `exact` caught and which then
             blanked the card on a shape that has a two-piece answer.

             Split on the widths instead: the narrower cross-section as the
             rectangle, one wedge for the difference. Exact for any trapezoid,
             since min(w)·h + ½|Δw|·h ≡ h·(wTop + wBot)/2. There is no pair of
             chamfers to confuse here — this branch is reached only when both
             sides lean the same way. */
          const wTop = rt - lt;
          const wBot = rb - lb;
          const narrow = Math.min(wTop, wBot);
          const wide = Math.max(wTop, wBot);
          if (narrow > eps) {
            skewed.push({
              kind: 'rect', width: narrow, height: h, area: narrow * h, skew: true,
            });
          }
          if (wide - narrow > eps) {
            triangles.push({
              kind: 'tri', width: wide - narrow, height: h, area: 0.5 * (wide - narrow) * h,
            });
          }
        }
      }
    }
  }
  if (columns.length + triangles.length + skewed.length > MAX_PIECES) return null;

  columns.sort((a, b) => a.x0 - b.x0 || a.x1 - b.x1 || a.y0 - b.y0);
  const merged = [];
  for (const col of columns) {
    const prev = merged[merged.length - 1];
    if (prev && Math.abs(prev.x0 - col.x0) <= eps && Math.abs(prev.x1 - col.x1) <= eps
        && Math.abs(prev.y1 - col.y0) <= eps) {
      prev.y1 = col.y1;
    } else merged.push({ ...col });
  }

  return [
    ...merged.map((m) => ({
      kind: 'rect',
      width: m.x1 - m.x0,
      height: m.y1 - m.y0,
      area: (m.x1 - m.x0) * (m.y1 - m.y0),
    })),
    ...skewed,
    ...triangles,
  ];
};

// One ring, cut up. Null when the ring cannot be described honestly.
const cutRing = (ring) => {
  if (!(ring?.length >= 3)) return null;
  const { angle, support } = dominantAngle(ring);
  const offAxis = Math.min(angle, 90 - angle);
  const turned = offAxis > ROTATE_MIN_DEG && support >= ROTATE_MIN_SUPPORT;
  const { poly, eps } = snapPolygon(turned ? rotatePolygon(ring, angle) : ring);
  const pieces = (isRectilinear(poly, eps) ? gridCut(poly) : null) ?? sweepCut(poly, eps);
  if (!pieces) return null;
  return { pieces, rotation: turned ? angle : 0 };
};

const ringArea = (ring) => (ring?.length >= 3 ? Math.abs(signedArea(ring)) : 0);

/**
 * Cut an outline and its voids into printable pieces.
 *
 * @param {Array<{x:number,y:number}>} vertices the outline, in image pixels
 * @param {{x:number,y:number}|number} feetPerPixel the scale in force
 * @param {Array} holes enclosed voids; the live ones are cut up too and come
 *   back flagged `deducted`
 * @returns {{pieces:Array, squareFeet:number, rotation:number, exact:boolean,
 *   residual:number}|null} null when no honest decomposition exists — the
 *   caller must then state the area with no breakdown rather than print one
 *   that does not add up.
 */
export function decomposeArea(vertices, feetPerPixel, holes = null) {
  const fpp = typeof feetPerPixel === 'number'
    ? { x: feetPerPixel, y: feetPerPixel }
    : { x: feetPerPixel?.x ?? 1, y: feetPerPixel?.y ?? 1 };
  if (!(vertices?.length >= 3)) return null;

  const outer = cutRing(feetPolygon(vertices, fpp));
  if (!outer) return null;

  const liveRings = holeRings((holes ?? []).filter(isSubtracted))
    .filter((r) => r?.length >= 3);

  const voids = liveRings.map((ring) => {
    const cut = cutRing(feetPolygon(ring, fpp));
    // A void that cannot be cut up is still deducted, as one piece stating the
    // whole void — never dropped, which would silently inflate the area.
    return cut
      ? cut.pieces.map((p) => ({ ...p, deducted: true }))
      : [{
        kind: 'void',
        width: 0,
        height: 0,
        deducted: true,
        area: ringArea(ring) * fpp.x * fpp.y,
      }];
  });

  const all = [
    ...outer.pieces.map((p) => ({ ...p, deducted: false })),
    ...voids.flat(),
  ];

  // The authority is the same arithmetic `calculateArea` does, which is what
  // the Area card prints. This module has to agree with it or say that it
  // cannot.
  const truth = Math.max(0, ringArea(vertices)
    - liveRings.reduce((sum, r) => sum + ringArea(r), 0)) * fpp.x * fpp.y;

  const kept = all.filter((p) => p.area >= MIN_PIECE_SQFT);
  const residual = all.reduce((sum, p) => sum + (p.area < MIN_PIECE_SQFT ? p.area : 0), 0);
  const summed = all.reduce((sum, p) => sum + (p.deducted ? -p.area : p.area), 0);

  return {
    // Biggest first, deductions last: the main body of the building is the
    // figure a reviewer checks against the sketch, and a void reads as
    // something taken off the end rather than as one more room.
    pieces: kept.sort((a, b) => (a.deducted === b.deducted
      ? b.area - a.area
      : (a.deducted ? 1 : -1))),
    squareFeet: truth,
    rotation: outer.rotation,
    residual,
    // Two ways to be inexact: the cut disagrees with the shoelace, or so much
    // was dropped as unprintable that the column would visibly not add up.
    exact: Math.abs(summed - truth) <= Math.max(1e-6, truth * 1e-9)
      && residual <= Math.max(MIN_PIECE_SQFT, truth * 0.005),
  };
}

/**
 * Round each piece so the column adds up to the figure printed under it.
 *
 * Rounding every row on its own and the total separately is how a breakdown
 * comes to print 1,241 + 442 + 89 under a total of 1,772 — the mismatch this
 * codebase already refuses between whole outlines. The same argument applies
 * inside one outline, so the pieces are apportioned by largest remainder
 * against the printed total: every piece lands within one printed step of its
 * own value, and the column is exact by construction rather than by luck.
 */
export function apportionPieces(values, total, decimals = 1) {
  if (!values.length) return [];
  const q = 10 ** decimals;
  const target = Math.round(total * q);
  const floors = values.map((v) => Math.floor(v * q));
  const order = values
    .map((v, i) => ({ i, remainder: v * q - floors[i] }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  const out = floors.slice();
  let used = floors.reduce((sum, f) => sum + f, 0);
  for (let k = 0; used < target; k += 1) {
    out[order[k % order.length].i] += 1;
    used += 1;
  }
  for (let k = 0; used > target; k += 1) {
    out[order[order.length - 1 - (k % order.length)].i] -= 1;
    used -= 1;
  }
  return out.map((n) => n / q);
}
