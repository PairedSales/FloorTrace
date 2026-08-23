// Draw mode: a rough brush stroke as a constraint on the boundary search.
//
// The stroke is not the answer. It is a corridor: the tracer keeps only the
// wall ink the user painted over, which is what makes every page-scope failure
// (legends, dimension strings, a second plan on the same sheet) impossible by
// construction rather than by heuristic. Where the corridor covers blank paper
// the stroke itself stands in for the wall that was never drawn.
//
// Two masks come out of one stroke set:
//   corridor  the full painted band — scope of the search
//   ribbon    the stroke centreline at wall width — asserted wall evidence

import { closeRect, dilateRect, floodOutside, labelComponents } from './raster.js';

// Bresenham-free line rasterisation: step along the segment at sub-pixel
// resolution. Strokes arrive as mouse samples, so segments are short and the
// cost is negligible next to the dilation that follows.
const paintSegment = (mask, width, height, a, b) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps;
    const x = Math.round(a.x + dx * t);
    const y = Math.round(a.y + dy * t);
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    mask[y * width + x] = 1;
  }
};

/**
 * @param {Array<{points: Array<{x,y}>}>} strokes in original image px
 * @param {number} radius brush radius in original image px
 * @param {object} analysis the shared analysis (supplies working size + scale)
 * @returns {{corridor: Uint8Array, ribbon: Uint8Array, radius: number} | null}
 */
export const rasterizeBrush = (strokes, radius, analysis) => {
  const { width, height, scaleX, scaleY, wallThickness } = analysis;
  const usable = (strokes ?? []).filter((s) => s?.points?.length);
  if (!usable.length) return null;

  const painted = new Uint8Array(width * height);
  for (const stroke of usable) {
    const pts = stroke.points.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY }));
    if (pts.length === 1) {
      paintSegment(painted, width, height, pts[0], pts[0]);
      continue;
    }
    for (let i = 0; i < pts.length - 1; i += 1) {
      paintSegment(painted, width, height, pts[i], pts[i + 1]);
    }
  }

  // Anisotropic scale is possible but tiny (the working raster preserves aspect
  // to within a pixel), so one radius keeps the brush round.
  const workRadius = Math.max(2, Math.round(radius * (scaleX + scaleY) / 2));
  return {
    corridor: dilateRect(painted, width, height, workRadius),
    ribbon: dilateRect(painted, width, height, Math.max(2, Math.round(wallThickness))),
    radius: workRadius,
  };
};

/**
 * One connected painted region = one wall network. The brush declares the
 * partition, so `partitionWallNetworks` and its merge rules are bypassed
 * entirely: two separate loops on a multi-floor sheet are two floors because
 * the user drew them as two loops, not because a bbox rule agreed.
 */
export const brushNetworks = (brush, boundaryMask, width, height) => {
  const { labels, components } = labelComponents(brush.corridor, width, height);
  const nets = [];
  for (const comp of components) {
    // A stray dab carries no loop; ignore it rather than trace it.
    if (comp.size < 16 * brush.radius) continue;
    const mask = new Uint8Array(boundaryMask.length);
    const ribbon = new Uint8Array(boundaryMask.length);
    let wallSize = 0;
    const ink = { minX: width, minY: height, maxX: -1, maxY: -1 };
    for (let y = comp.bbox.minY; y <= comp.bbox.maxY; y += 1) {
      const row = y * width;
      for (let x = comp.bbox.minX; x <= comp.bbox.maxX; x += 1) {
        const i = row + x;
        if (labels[i] !== comp.id) continue;
        if (brush.ribbon[i]) ribbon[i] = 1;
        if (boundaryMask[i]) {
          mask[i] = 1;
          wallSize += 1;
          if (x < ink.minX) ink.minX = x;
          if (x > ink.maxX) ink.maxX = x;
          if (y < ink.minY) ink.minY = y;
          if (y > ink.maxY) ink.maxY = y;
        }
      }
    }
    const corridor = new Uint8Array(boundaryMask.length);
    for (let y = comp.bbox.minY; y <= comp.bbox.maxY; y += 1) {
      const row = y * width;
      for (let x = comp.bbox.minX; x <= comp.bbox.maxX; x += 1) {
        if (labels[row + x] === comp.id) corridor[row + x] = 1;
      }
    }
    // The network's extent is the *ink* the brush selected, not the band the
    // user painted. Measured against the band, a correct footprint drawn well
    // inside a generous stroke reads as barely sealed and loses to the stroke
    // that produced it — which is exactly backwards.
    const hasInk = ink.maxX >= ink.minX && wallSize >= 8 * brush.radius;
    nets.push({
      mask,
      ribbon,
      corridor,
      bbox: hasInk ? ink : comp.bbox,
      corridorBbox: comp.bbox,
      wallSize,
      corridorSize: comp.size,
      radius: brush.radius,
    });
  }
  return nets.sort((a, b) => b.corridorSize - a.corridorSize);
};

/**
 * The region the painted loop encloses (the band itself included, so an outline
 * running down the middle of the brush scores as a fit). This is what the
 * candidate is measured against, and the footprint of last resort when no
 * hypothesis built from ink manages to close.
 *
 * A loop the user left slightly open would otherwise leak to the border and
 * enclose nothing, so the band is closed first — generously, since the brush
 * band is already coarse and rounding its corners costs nothing here.
 */
export const strokeRegion = (band, width, height, closeRadius = 0) => {
  const sealed = closeRadius > 0 ? closeRect(band, width, height, closeRadius) : band;
  const outside = floodOutside(sealed, width, height);
  const region = new Uint8Array(outside.length);
  let size = 0;
  for (let i = 0; i < outside.length; i += 1) {
    if (!outside[i]) {
      region[i] = 1;
      size += 1;
    }
  }
  return { mask: region, size };
};

/**
 * How well a footprint answers what the user circled. Deliberately *not* IoU
 * against the stroke region: the painted band is thick, so plain IoU punishes a
 * perfectly correct footprint for the width of the brush and would flag every
 * generous stroke as a mismatch.
 *
 * The band is neutral ground. What is measured is the region strictly inside it
 * (the user definitely wanted this) and the area outside it (the user
 * definitely did not):
 *
 *   miss   how much of the strictly-enclosed region the footprint left out
 *   spill  how much of the footprint sits beyond the band entirely
 *
 * Sampled on a coarse grid for the same reason `rectCoverage` is — this runs
 * once per candidate and exactness buys nothing.
 */
export const regionFit = (mask, region, band, width, height, bbox) => {
  const x0 = Math.max(0, bbox ? bbox.minX : 0);
  const y0 = Math.max(0, bbox ? bbox.minY : 0);
  const x1 = Math.min(width - 1, bbox ? bbox.maxX : width - 1);
  const y1 = Math.min(height - 1, bbox ? bbox.maxY : height - 1);
  const stepX = Math.max(1, Math.round((x1 - x0) / 128));
  const stepY = Math.max(1, Math.round((y1 - y0) / 128));
  let innerTotal = 0;
  let innerHit = 0;
  let maskTotal = 0;
  let maskOut = 0;
  for (let y = y0; y <= y1; y += stepY) {
    const row = y * width;
    for (let x = x0; x <= x1; x += stepX) {
      const i = row + x;
      const inRegion = region[i];
      if (inRegion && !band[i]) {
        innerTotal += 1;
        if (mask[i]) innerHit += 1;
      }
      if (mask[i]) {
        maskTotal += 1;
        if (!inRegion) maskOut += 1;
      }
    }
  }
  const miss = innerTotal ? 1 - innerHit / innerTotal : 0;
  const spill = maskTotal ? maskOut / maskTotal : 0;
  return Math.max(0, (1 - miss) * (1 - spill));
};
