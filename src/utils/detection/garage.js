// Geometric garage detection: the OCR-independent fallback for the non-GLA
// exclusion carve. An attached garage reads as a large, near-rectangular
// enclosed cavity with one exterior-facing side drawn almost entirely as a
// thin garage-door stroke (or a sealed gap) while its remaining sides are
// full-thickness walls. Porches fail the "other sides are real walls" guard
// (railings are thin all around); windows fail the door-run guard (they never
// span a whole side).

const SIDES = [
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 },
];

// Walk every position along one bbox side of the cavity: find the cavity's
// edge pixel, then march outward through the wall band classifying it as
// door-like (thin ink and the march exits the footprint) or walled (a real
// wall run, exterior-facing or not).
const analyzeSide = (ctx, side) => {
  const { labels, id, bbox, footprintMask, wallMask, width, height, ext } = ctx;
  const horizontal = side.dx !== 0;
  const from = horizontal ? bbox.minY : bbox.minX;
  const to = horizontal ? bbox.maxY : bbox.maxX;
  const band = ext * 3 + 6;
  const thinMax = Math.max(2, Math.round(ext * 0.4));
  const walledMin = Math.max(thinMax + 1, Math.round(ext * 0.6));

  const len = to - from + 1;
  let doorTotal = 0;
  let doorRun = 0;
  let bestRun = 0;
  let walled = 0;

  for (let pos = from; pos <= to; pos += 1) {
    let edge = -1;
    if (horizontal) {
      const row = pos * width;
      if (side.dx < 0) {
        for (let x = bbox.minX; x <= bbox.maxX; x += 1) if (labels[row + x] === id) { edge = x; break; }
      } else {
        for (let x = bbox.maxX; x >= bbox.minX; x -= 1) if (labels[row + x] === id) { edge = x; break; }
      }
    } else if (side.dy < 0) {
      for (let y = bbox.minY; y <= bbox.maxY; y += 1) if (labels[y * width + pos] === id) { edge = y; break; }
    } else {
      for (let y = bbox.maxY; y >= bbox.minY; y -= 1) if (labels[y * width + pos] === id) { edge = y; break; }
    }
    if (edge < 0) {
      doorRun = 0;
      continue;
    }

    let wallCount = 0;
    let exterior = false;
    let exitStep = band + 1;
    for (let step = 1; step <= band; step += 1) {
      const x = horizontal ? edge + side.dx * step : pos;
      const y = horizontal ? pos : edge + side.dy * step;
      if (x < 0 || y < 0 || x >= width || y >= height || !footprintMask[y * width + x]) {
        exterior = true;
        exitStep = step;
        break;
      }
      if (wallMask[y * width + x]) wallCount += 1;
    }

    // A garage door is a thin barrier the march exits almost immediately; a
    // window is a gap in a full-thickness wall band (bridged by the seal), so
    // the footprint still extends a wall's depth past the cavity there.
    if (exterior && wallCount <= thinMax && exitStep <= thinMax + 4) {
      doorTotal += 1;
      doorRun += 1;
      if (doorRun > bestRun) bestRun = doorRun;
    } else {
      doorRun = 0;
    }
    if (wallCount >= walledMin) walled += 1;
  }

  return { len, doorFrac: doorTotal / len, bestRun, walledFrac: walled / len };
};

export const measureCavitySides = (cavity, ctx) =>
  SIDES.map((side) => analyzeSide({ ...ctx, id: cavity.id, bbox: cavity.bbox }, side));

// Cavity component ids that carry strong geometric garage evidence. Inputs are
// in working-scale px: `labels`/`components` from the open-cavity labelling,
// the floor's footprint entry, and the floor's own wall network mask.
export const findGarageCavities = ({
  labels, components, footprint, wallMask, width, height, exteriorThickness, minCavity,
}) => {
  const ext = exteriorThickness;
  const found = [];
  for (const comp of components) {
    if (comp.size < Math.max(minCavity, 0.05 * footprint.area)) continue;
    if (comp.size > 0.45 * footprint.area) continue;
    const w = comp.bbox.maxX - comp.bbox.minX + 1;
    const h = comp.bbox.maxY - comp.bbox.minY + 1;
    if (comp.size < 0.7 * w * h) continue;
    if (Math.max(w, h) > 4 * Math.min(w, h)) continue;

    const sides = measureCavitySides(comp, {
      labels, footprintMask: footprint.mask, wallMask, width, height, ext,
    });
    const doorIdx = sides.findIndex((s) =>
      s.len >= 3 * ext
      && s.doorFrac >= 0.65
      && s.bestRun >= Math.max(2.5 * ext, 0.3 * s.len));
    if (doorIdx < 0) continue;

    // A garage is walled everywhere except the door; anything ringed by thin
    // strokes (porch, deck) or mostly open is not a garage.
    const others = sides.filter((_, i) => i !== doorIdx);
    const meanWalled = others.reduce((sum, s) => sum + s.walledFrac, 0) / others.length;
    if (meanWalled < 0.55) continue;

    found.push(comp.id);
  }
  return found;
};
