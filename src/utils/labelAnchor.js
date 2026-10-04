// Where an outline's name and area can sit without covering what the plan says.
//
// The centroid is the wrong answer twice over: in an L-shaped outline it can
// fall outside the shape, and in a plain rectangle it is the middle of the
// biggest room — exactly where the plan prints that room's name and size. This
// finds the point inside the outline that is farthest from its walls, from its
// cut-outs and from the room sizes read off the plan.
//
// Given the label's own size it measures from the label's edges rather than
// its middle. That matters on an ordinary plan, where every room is labelled
// and no point is far from print: the middle of a label can be well clear of a
// room size that its corner still covers.
//
// Given the plan's ink as well (`inkMap.js`), it stops reasoning about what was
// read and looks at the drawing: of the places the label fits, it takes the one
// with the least print under it. The read sizes are never all the print there
// is — the sample plan prints a kitchen size the reader does not return, and
// the label sat on it.

const distToSegment = (px, py, a, b) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2)) : 0;
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
};

const inside = (px, py, ring) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if ((a.y > py) !== (b.y > py) && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
};

// How far a label `halfW` × `halfH` centred on the point is from the ring. Each
// wall is charged the label's reach toward it — exact for a wall that runs the
// label's whole length, and on the safe side at a wall's end.
const gapToRing = (px, py, ring, halfW, halfH) => {
  let best = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const reach = len > 0
      ? (Math.abs(b.y - a.y) * halfW + Math.abs(b.x - a.x) * halfH) / len
      : 0;
    best = Math.min(best, distToSegment(px, py, a, b) - reach);
  }
  return best;
};

// The gap between the label and a box of print. Negative when they overlap, by
// how deep, so that of two bad places the less bad one still wins.
const gapToBox = (px, py, box, halfW, halfH) => {
  const dx = Math.max(box.x - halfW - px, px - (box.x + box.width + halfW));
  const dy = Math.max(box.y - halfH - py, py - (box.y + box.height + halfH));
  if (dx < 0 && dy < 0) return Math.max(dx, dy);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
};

/**
 * @param {{x:number,y:number}[]} vertices the outline
 * @param {object} [options]
 * @param {{x:number,y:number}[][]} [options.holes] rings the label must stay out of
 * @param {{x:number,y:number,width:number,height:number}[]} [options.avoid] printed text to keep clear of
 * @param {{width:number,height:number}} [options.size] the label, in the outline's units
 * @param {(x0:number,y0:number,x1:number,y1:number)=>number} [options.ink] mean darkness of a box of the plan
 * @returns {{x:number,y:number,clearance:number,ink?:number}|null} null for a degenerate outline.
 *   `clearance` is the gap left round the label: below zero, it does not fit.
 *   `ink` is how dark the plan is under it, when that was asked.
 */
export function labelAnchor(vertices, { holes = [], avoid = [], size = null, ink = null } = {}) {
  if (!vertices || vertices.length < 3) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const v of vertices) {
    minX = Math.min(minX, v.x);
    minY = Math.min(minY, v.y);
    maxX = Math.max(maxX, v.x);
    maxY = Math.max(maxY, v.y);
  }
  const span = Math.max(maxX - minX, maxY - minY);
  if (!(span > 0)) return null;

  const halfW = (size?.width ?? 0) / 2;
  const halfH = (size?.height ?? 0) / 2;
  const rings = holes.filter((ring) => ring?.length >= 3);
  // null where the label's middle would be outside the outline or in a cut-out.
  const clearanceAt = (px, py) => {
    if (!inside(px, py, vertices)) return null;
    let best = gapToRing(px, py, vertices, halfW, halfH);
    for (const ring of rings) {
      if (inside(px, py, ring)) return null;
      best = Math.min(best, gapToRing(px, py, ring, halfW, halfH));
    }
    for (const box of avoid) best = Math.min(best, gapToBox(px, py, box, halfW, halfH));
    return best;
  };

  // A coarse grid finds the right pocket; a fine one around the winner finds
  // its middle. Two passes rather than one dense one: the answer is recomputed
  // whenever the outline changes, and 28² + 9² points is ~900, not ~12,000.
  // Finer when the ink decides: a blank pocket between two rooms' labels can
  // be narrower than a coarse step.
  const GRID = ink ? 40 : 28;
  const candidates = [];
  let most = -Infinity;
  for (let iy = 0; iy <= GRID; iy += 1) {
    for (let ix = 0; ix <= GRID; ix += 1) {
      const px = minX + ((maxX - minX) * ix) / GRID;
      const py = minY + ((maxY - minY) * iy) / GRID;
      const clearance = clearanceAt(px, py);
      if (clearance === null) continue;
      candidates.push({ x: px, y: py, clearance });
      most = Math.max(most, clearance);
    }
  }
  if (!candidates.length) return null;

  // A long room is as clear all the way down its middle as it is at any one
  // point of it, and the first such point is at one end. Among the points that
  // are nearly as clear as the clearest, take the one nearest the middle of the
  // outline, so the label sits where the eye looks for it.
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  if (ink) {
    const fitting = candidates.filter((c) => c.clearance >= 0);
    let least = Infinity;
    for (const c of fitting) {
      c.ink = ink(c.x - halfW, c.y - halfH, c.x + halfW, c.y + halfH);
      least = Math.min(least, c.ink);
    }
    // As good as blank is blank: among those, the one nearest the middle.
    let pick = null;
    let near = Infinity;
    for (const c of fitting) {
      if (c.ink > least + 0.004) continue;
      const d = Math.hypot(c.x - midX, c.y - midY);
      if (d < near) {
        near = d;
        pick = c;
      }
    }
    if (pick) return pick;
    // Nowhere it fits: fall through, and say so with a clearance below zero.
  }

  let coarse = null;
  let nearest = Infinity;
  for (const c of candidates) {
    // Only among places it fits: where it does not, nearer the middle is no
    // reason to cover more print.
    if (c.clearance < (most > 0 ? most * 0.9 : most)) continue;
    const d = Math.hypot(c.x - midX, c.y - midY);
    if (d < nearest) {
      nearest = d;
      coarse = c;
    }
  }

  const step = span / GRID;
  let best = coarse;
  for (let iy = 0; iy <= 8; iy += 1) {
    for (let ix = 0; ix <= 8; ix += 1) {
      const px = coarse.x - step + (2 * step * ix) / 8;
      const py = coarse.y - step + (2 * step * iy) / 8;
      const clearance = clearanceAt(px, py);
      if (clearance !== null && clearance > best.clearance) best = { x: px, y: py, clearance };
    }
  }
  return best;
}
