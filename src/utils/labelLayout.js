// Where the labels on the plan go, decided once for all of them.
//
// The wall lengths used to be placed one wall at a time: each label went to the
// middle of its own wall, outside it, and was then nudged along the wall if a
// corner of its *own* wall was in the way. Nothing else was looked at, so a label
// could sit on another outline's wall, on the corner of a jog two walls away, or
// on the label of the wall next to it — and every one of those was fixed by
// another special case. This replaces the approach rather than the case.
//
// The rule is a constraint, not a nudge. Space is where the user sees it: the
// screen, turned the way the plan is turned, at the current zoom. In it a label
// is an exact upright rectangle of a known size in pixels, and everything it must
// keep off is a shape in that same space: walls (segments), corners (discs) and
// labels already placed (rectangles). A label offers a list of places it could
// go, best first — outside its wall at its own middle, then a little further out,
// then slid along, then smaller, and only then inside — and takes the first that
// touches nothing. Labels are placed most-constrained first, so a short jog that
// has one clear spot is not robbed of it by a long wall that has twenty.
//
// A label with no clear place still gets drawn, at the place that touches least,
// and says so (`clear: false`): a wall length that is missing is a worse answer
// than one that overlaps something. When the plan is zoomed far out the labels
// are bigger than the plan's detail and crowding is expected, so labels stop
// keeping off *each other* (`crowdsOk`) — they still keep off the walls.
//
// Pure: no DOM, no Konva, no text measuring. The caller supplies sizes.

/** Pixels between a label and anything it must keep off. */
export const LABEL_GAP = 3;

/* ── geometry ─────────────────────────────────────────────────────────────── */

/**
 * The gap between an upright rectangle and a segment. Zero when they touch.
 * @param {{x0:number,y0:number,x1:number,y1:number}} r
 */
export const rectSegmentGap = (r, ax, ay, bx, by) => {
  // Clip the segment to the rectangle (Liang–Barsky): if any of it is inside,
  // they touch.
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;
  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  if (clip(-dx, ax - r.x0) && clip(dx, r.x1 - ax) && clip(-dy, ay - r.y0) && clip(dy, r.y1 - ay)) return 0;

  // Otherwise the nearest approach is an end of the segment to the rectangle, or
  // a corner of the rectangle to the segment.
  const toRect = (px, py) => Math.hypot(
    Math.max(r.x0 - px, 0, px - r.x1),
    Math.max(r.y0 - py, 0, py - r.y1),
  );
  const len2 = dx * dx + dy * dy;
  const toSegment = (px, py) => {
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };
  return Math.min(
    toRect(ax, ay), toRect(bx, by),
    toSegment(r.x0, r.y0), toSegment(r.x1, r.y0), toSegment(r.x0, r.y1), toSegment(r.x1, r.y1),
  );
};

/** The gap between an upright rectangle and a disc's edge. Zero when they touch. */
export const rectDiscGap = (r, cx, cy, radius) => Math.max(0, Math.hypot(
  Math.max(r.x0 - cx, 0, cx - r.x1),
  Math.max(r.y0 - cy, 0, cy - r.y1),
) - radius);

/** The gap between two upright rectangles. Zero when they overlap. */
export const rectGap = (a, b) => Math.hypot(
  Math.max(a.x0 - b.x1, 0, b.x0 - a.x1),
  Math.max(a.y0 - b.y1, 0, b.y0 - a.y1),
);

/** Whether a ring runs clockwise as the user sees it (the frame is y-down). */
const isClockwise = (ring) => {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += (b.x - a.x) * (b.y + a.y);
  }
  return sum < 0;
};

/** Image space → the space labels are placed in: turned as the plan is turned, at the plan's zoom. */
export const toLayoutSpace = (rotationDeg, scale) => {
  const rad = ((rotationDeg || 0) * Math.PI) / 180;
  const c = Math.cos(rad) * scale;
  const s = Math.sin(rad) * scale;
  return {
    forward: (p) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c }),
    back: (p) => ({
      x: (p.x * c + p.y * s) / (scale * scale),
      y: (-p.x * s + p.y * c) / (scale * scale),
    }),
  };
};

/* ── the obstacles ────────────────────────────────────────────────────────── */

/**
 * What labels keep off, all in layout space.
 * @typedef {object} Obstacles
 * @property {{ax:number,ay:number,bx:number,by:number,reach:number}[]} segments walls; `reach` is the
 *   clearance wanted on top of the gap (half the stroke)
 * @property {{x:number,y:number,radius:number}[]} discs corners
 * @property {{x0:number,y0:number,x1:number,y1:number}[]} rects labels that are already fixed
 */

/** The obstacle a closed ring of points makes: every wall, and a disc on every corner. */
export function ringObstacles(ring, { reach = 1, corner = 5 } = {}) {
  const segments = [];
  const discs = [];
  if (!ring || ring.length < 2) return { segments, discs };
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    segments.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, reach });
    if (corner > 0) discs.push({ x: a.x, y: a.y, radius: corner });
  }
  return { segments, discs };
}

/* ── the search ───────────────────────────────────────────────────────────── */

/**
 * @typedef {object} Candidate
 * @property {number} x the label's middle
 * @property {number} y
 * @property {number} w the label's size at this candidate (a smaller one is a smaller label)
 * @property {number} h
 * @property {number} cost lower is better; candidates are tried in cost order
 */

const boxOf = (c) => ({ x0: c.x - c.w / 2, y0: c.y - c.h / 2, x1: c.x + c.w / 2, y1: c.y + c.h / 2 });

/**
 * How badly a candidate rectangle overlaps the walls and corners: 0 when it
 * touches none of them, otherwise how far into the margin it reaches, summed.
 */
const fixedTrouble = (box, { segments, discs, rects }, margin) => {
  let trouble = 0;
  for (const s of segments) {
    // Cheap reject: the segment's box, widened, misses the label's.
    const want = margin + s.reach;
    if (Math.min(s.ax, s.bx) > box.x1 + want || Math.max(s.ax, s.bx) < box.x0 - want
      || Math.min(s.ay, s.by) > box.y1 + want || Math.max(s.ay, s.by) < box.y0 - want) continue;
    const gap = rectSegmentGap(box, s.ax, s.ay, s.bx, s.by);
    if (gap < want) trouble += want - gap;
  }
  for (const d of discs) {
    const gap = rectDiscGap(box, d.x, d.y, d.radius);
    if (gap < margin) trouble += margin - gap;
  }
  for (const r of rects) {
    const gap = rectGap(box, r);
    if (gap < margin) trouble += margin - gap + 1;
  }
  return trouble;
};

const crowdTrouble = (box, placed, margin) => {
  let trouble = 0;
  for (const r of placed) {
    const gap = rectGap(box, r);
    if (gap < margin) trouble += margin - gap + 1;
  }
  return trouble;
};

/**
 * Choose a place for every label.
 *
 * @param {{id:string|number, candidates:Candidate[]}[]} labels each with its
 *   candidates, best first (the order is the search order; `cost` breaks ties
 *   only through that order, so sort before passing)
 * @param {Obstacles} obstacles
 * @param {object} [options]
 * @param {number} [options.margin] the gap to keep (default `LABEL_GAP`)
 * @param {boolean} [options.crowdsOk] labels may overlap each other
 * @returns {Map<string|number, Candidate & {clear:boolean,rank:number}>} the candidate taken, with
 *   `rank` its index in the label's list: 0 is the label's first choice.
 */
export function placeLabels(labels, obstacles, { margin = LABEL_GAP, crowdsOk = false } = {}) {
  const fixed = { segments: obstacles.segments ?? [], discs: obstacles.discs ?? [], rects: obstacles.rects ?? [] };

  // The places each label can go as far as the walls and corners are concerned.
  // That does not depend on the other labels, so it is worked out once and is
  // also how the order is chosen: the label with the fewest is placed first.
  const entries = labels.map((label) => {
    const boxes = label.candidates.map(boxOf);
    const trouble = boxes.map((box) => fixedTrouble(box, fixed, margin));
    let free = 0;
    for (const t of trouble) if (t === 0) free += 1;
    return { label, boxes, trouble, free };
  });
  entries.sort((a, b) => a.free - b.free);

  const placed = [];
  const out = new Map();
  for (const { label, boxes, trouble } of entries) {
    const n = label.candidates.length;
    if (!n) continue;

    // First place, in the label's own order, that touches nothing at all.
    let pick = -1;
    for (let i = 0; i < n; i += 1) {
      if (trouble[i] > 0) continue;
      if (!crowdsOk && crowdTrouble(boxes[i], placed, margin) > 0) continue;
      pick = i;
      break;
    }

    let clear = pick >= 0;
    if (!clear) {
      // Nowhere is clean: the place that touches least, the label's order
      // deciding between equals.
      let least = Infinity;
      for (let i = 0; i < n; i += 1) {
        const t = trouble[i] + (crowdsOk ? 0 : crowdTrouble(boxes[i], placed, margin));
        if (t < least - 1e-9) {
          least = t;
          pick = i;
        }
      }
      // With crowding allowed, a label that touches only other labels is clear
      // as far as anything the user would call a mistake.
      clear = crowdsOk && trouble[pick] === 0;
    }

    const c = label.candidates[pick];
    placed.push(boxes[pick]);
    out.set(label.id, { ...c, clear, rank: pick });
  }
  return out;
}

/* ── a wall's label ───────────────────────────────────────────────────────── */

// Pixels the label stands off the wall's line, before its own half height.
const STAND_OFF = 6;
// Further out, when the first row is taken.
const EXTRA_STAND_OFF = [0, 9, 20];
// How far along the wall a label may slide, as a fraction of the wall, each way.
const SLIDES = [0, 0.12, -0.12, 0.25, -0.25, 0.38, -0.38, 0.5, -0.5];
// How much smaller a label may become before it goes inside. The caller turns each
// step into a size, because text does not shrink in proportion to its box.
export const LABEL_SHRINKS = [1, 0.85, 0.72];

/**
 * Every place a wall's length could be written, best first.
 *
 * @param {{x:number,y:number}} a the wall's start, in layout space
 * @param {{x:number,y:number}} b its end
 * @param {{x:number,y:number}} out the way outside is, as a unit vector
 * @param {{w:number,h:number}[]} tiers the label's size at each step of
 *   `LABEL_SHRINKS`, in pixels, largest first
 * @returns {(Candidate & {tier:number, outside:boolean})[]}
 */
export function wallLabelCandidates(a, b, out, tiers) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return [];
  const tx = dx / len;
  const ty = dy / len;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;

  const found = [];
  for (const side of [1, -1]) {
    for (let k = 0; k < tiers.length; k += 1) {
      const { w, h } = tiers[k];
      // How far the label's middle is from the wall's line to clear it, which
      // depends on how the wall runs against the label's upright rectangle:
      // under a slanted wall a label reaches toward it by more than half its height.
      const reach = (Math.abs(out.y) * h + Math.abs(out.x) * w) / 2;
      for (let e = 0; e < EXTRA_STAND_OFF.length; e += 1) {
        const gap = STAND_OFF + EXTRA_STAND_OFF[e];
        for (const slide of SLIDES) {
          const along = slide * len;
          found.push({
            x: mx + tx * along + out.x * side * (reach + gap),
            y: my + ty * along + out.y * side * (reach + gap),
            w,
            h,
            tier: k,
            outside: side > 0,
            // Outside is what a wall length is for; the inside is where the plan
            // prints its rooms. Within a side, what is least different from the
            // plain answer: the full size, then the least slide, then the closest.
            cost: (side > 0 ? 0 : 1000) + k * 40 + e * 12 + Math.abs(along) * 0.35 + Math.abs(slide) * 4,
          });
        }
      }
    }
  }
  return found.sort((p, q) => p.cost - q.cost);
}

/** The unit normal of each wall of a ring that points away from the ring's inside. */
export function outwardNormals(ring) {
  const clockwise = isClockwise(ring);
  return ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (!(len > 0)) return { x: 0, y: 0 };
    // On screen (y down) a clockwise ring's outside is to the left of its direction.
    return clockwise ? { x: dy / len, y: -dx / len } : { x: -dy / len, y: dx / len };
  });
}

// Below this, on screen, the whole outline is a thumbnail: its labels are bigger
// than its detail, crowding is expected, and keeping them apart is work whose
// result nobody can read.
export const FAR_OUT_PX = 200;

/** Whether an outline, in layout space, is too small on screen for labels to be kept apart. */
export function isFarOut(ring) {
  if (!ring?.length) return false;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of ring) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return Math.max(x1 - x0, y1 - y0) < FAR_OUT_PX;
}

// One object, so a caller that memoises on the result sees no change.
const NONE = Object.freeze({});

/**
 * The labels the user has dragged that are still good: those made at this zoom
 * and turn. A label is a fixed size on screen, so where it was put means
 * something else at another zoom, and everything is laid out afresh.
 *
 * @param {{scale:number, rotation?:number, moved:Object}|null|undefined} placements
 * @param {{scale:number, rotation?:number}} view
 */
export const movedLabelsAt = (placements, view) => {
  if (!placements?.moved) return NONE;
  const sameZoom = Math.abs(placements.scale - view.scale) <= 1e-9 * Math.max(1, view.scale);
  return sameZoom && (placements.rotation ?? 0) === (view.rotation ?? 0) ? placements.moved : NONE;
};
