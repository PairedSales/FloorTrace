// Boundary candidate generation. The tracer used to produce exactly one
// footprint from one sealing heuristic, so a wrong answer had no second-best
// and no way to be recognised as wrong. Here each *policy* for turning wall
// ink into an enclosed region is a generator, every generator contributes
// footprints, and selection happens later against evidence (see scoring.js).

import {
  closeRect,
  floodOutside,
  labelComponents,
  openRect,
  orMasks,
} from './raster.js';
import { extractWallSegments, segmentSpanMask, bridgedSpan } from './wallEvidence.js';

const bboxAreaOf = (bbox) => (bbox.maxX - bbox.minX + 1) * (bbox.maxY - bbox.minY + 1);

const componentMask = (labels, component, width) => {
  const mask = new Uint8Array(labels.length);
  const { minX, minY, maxX, maxY } = component.bbox;
  for (let y = minY; y <= maxY; y += 1) {
    const row = y * width;
    for (let x = minX; x <= maxX; x += 1) {
      if (labels[row + x] === component.id) mask[row + x] = 1;
    }
  }
  return mask;
};

// Ink extent of a mask, or null when it is empty.
const inkBounds = (mask, width, height) => {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (!mask[row + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      maxY = y;
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
};

// Enclose a mask: everything the border flood cannot reach.
//
// A wall network occupies its own corner of the page, but every rung of the
// closing ladder used to close, flood and label the *whole* raster — on a sheet
// carrying four plans, three quarters of that is morphology on blank paper.
// Working in the mask's own ink box, grown by the closing radius, is exact
// rather than approximate: beyond that margin the closed mask is empty and
// connected to the page border, so those pixels are "outside" either way, and
// the box is measured from the mask itself so no caller can get it wrong.
//
// `knownBounds` is that box passed in by a caller that already has it: one climb
// walks a whole ladder over one unchanged mask, so measuring it per rung is the
// same answer paid for N times.
export const measureFootprint = (wallMask, width, height, radius, knownBounds) => {
  const bounds = knownBounds === undefined ? inkBounds(wallMask, width, height) : knownBounds;
  if (!bounds) return null;
  const pad = radius + 2;
  const cx0 = Math.max(0, bounds.minX - pad);
  const cy0 = Math.max(0, bounds.minY - pad);
  const cw = Math.min(width - 1, bounds.maxX + pad) - cx0 + 1;
  const ch = Math.min(height - 1, bounds.maxY + pad) - cy0 + 1;
  const cropped = cw < width || ch < height;

  let src = wallMask;
  if (cropped) {
    src = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y += 1) {
      const from = (cy0 + y) * width + cx0;
      src.set(wallMask.subarray(from, from + cw), y * cw);
    }
  }

  const closed = radius > 0 ? closeRect(src, cw, ch, radius) : src;
  const outside = floodOutside(closed, cw, ch);
  const footprint = new Uint8Array(closed.length);
  for (let i = 0; i < closed.length; i += 1) footprint[i] = outside[i] ? 0 : 1;
  // Narrow labels: this array is what the search memo holds one of per rung.
  const local = labelComponents(footprint, cw, ch, true);
  if (!local.components.length) return null;

  let labels = local.labels;
  let components = local.components;
  if (cropped) {
    const Labels = local.labels.constructor;
    labels = new Labels(width * height).fill(-1);
    for (let y = 0; y < ch; y += 1) {
      labels.set(local.labels.subarray(y * cw, y * cw + cw), (cy0 + y) * width + cx0);
    }
    components = local.components.map((c) => ({
      id: c.id,
      size: c.size,
      bbox: {
        minX: c.bbox.minX + cx0,
        minY: c.bbox.minY + cy0,
        maxX: c.bbox.maxX + cx0,
        maxY: c.bbox.maxY + cy0,
      },
    }));
  }

  let largest = components[0];
  let totalEnclosed = 0;
  for (const comp of components) {
    totalEnclosed += comp.size;
    if (comp.size > largest.size) largest = comp;
  }
  // The closed mask is deliberately not returned: nothing downstream reads it,
  // and every ladder rung was holding a full-page copy of one alive.
  return { labels, components, largest, totalEnclosed, radius };
};

export const footprintEntry = (measured, component, width) => ({
  mask: componentMask(measured.labels, component, width),
  labels: measured.labels,
  componentId: component.id,
  area: component.size,
  bbox: component.bbox,
  bboxArea: bboxAreaOf(component.bbox),
  radius: measured.radius,
});

// How completely a footprint fills its wall network: the two quantities the
// old boolean `isSealed` combined, kept separate and graded so a partially
// sealed wing reads as "not sealed yet" instead of "close enough".
export const sealMetrics = (entry, wallBboxArea) => {
  if (!entry) return { cover: 0, solidity: 0, seal: 0 };
  const cover = Math.min(1, entry.bboxArea / Math.max(1, wallBboxArea));
  const solidity = entry.area / Math.max(1, entry.bboxArea);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const coverScore = clamp01((cover - 0.4) / 0.35);
  const solidScore = clamp01((solidity - 0.25) / 0.3);
  return { cover, solidity, seal: Math.sqrt(coverScore * solidScore) };
};

// Is this opening a window the wall spans, or the mouth of a genuine notch?
// A window gap has the wall continuing on the same line with open room behind
// it; a courtyard, breezeway or U-plan mouth has a perpendicular wall running
// away from each end of the gap, deep into the plan. `bridgeRuns` assumed the
// latter could not happen and welds such notches shut.
const notchMouth = (mask, width, height, axis, line, from, to, probeDepth) => {
  const depth = Math.max(8, probeDepth);
  const perpRun = (end, sign) => {
    let best = 0;
    for (let off = -3; off <= 3; off += 1) {
      let run = 0;
      for (let d = 1; d <= depth; d += 1) {
        const a = end + off;
        const b = line + sign * d;
        const x = axis === 'h' ? a : b;
        const y = axis === 'h' ? b : a;
        if (x < 0 || y < 0 || x >= width || y >= height) break;
        if (mask[y * width + x]) run += 1;
        else if (run > 0) break;
      }
      if (run > best) best = run;
    }
    return best;
  };
  const need = Math.max(6, Math.round(depth * 0.6));
  for (const sign of [-1, 1]) {
    if (perpRun(from, sign) >= need && perpRun(to, sign) >= need) return true;
  }
  return false;
};

// Colinear gap welding with a legitimacy test. Same primitive as bridgeRuns,
// but a gap whose two ends both sprout a deep perpendicular wall is left open.
export const bridgeRunsGuarded = (mask, width, height, maxGap, minFlank, probeDepth) => {
  const out = mask.slice();
  const scan = (axis) => {
    const outer = axis === 'h' ? height : width;
    const inner = axis === 'h' ? width : height;
    const at = (line, pos) => (axis === 'h' ? line * width + pos : pos * width + line);
    for (let line = 0; line < outer; line += 1) {
      let lastEnd = -1;
      let pos = 0;
      while (pos < inner) {
        if (!mask[at(line, pos)]) {
          pos += 1;
          continue;
        }
        let end = pos;
        while (end < inner && mask[at(line, end)]) end += 1;
        if (end - pos >= minFlank) {
          if (lastEnd >= 0 && pos - lastEnd <= maxGap
            && !notchMouth(mask, width, height, axis, line, lastEnd - 1, pos, probeDepth)) {
            for (let k = lastEnd; k < pos; k += 1) out[at(line, k)] = 1;
          }
          lastEnd = end;
        }
        pos = end;
      }
    }
  };
  scan('h');
  scan('v');
  return out;
};

const inkCount = (mask) => {
  let n = 0;
  for (let i = 0; i < mask.length; i += 1) n += mask[i];
  return n;
};

const SEALED = 0.9;

/**
 * Candidate footprints for one isolated wall network.
 *
 * Two evidence variants — every stroke in the network, and only the strokes
 * thick enough to be structural — crossed with three connectivity policies:
 *
 *  - `weld`      colinear welding that refuses notch mouths, then the ladder
 *  - `raw`       no welding at all, evaluated as a check on the welding
 *  - `span`      wall lines vectorised and painted across their full extent,
 *                which closes an opening of any width along one wall
 *
 * `all`/`weld` and `all`/`raw` are the base hypotheses; the other two are
 * rescues the caller asks for only when the base ones fall short, because both
 * make claims the drawing does not support. `span` infers wall that was never
 * drawn, and `structural` *discards* drawn linework — which is right for a
 * dimension string welded to the wall by its own extension lines, and wrong
 * for a porch whose railings are the only thing holding its outline. Deciding
 * what counts as living area is the non-GLA stage's job, not the geometry
 * stage's, so `structural` stays gated behind "much of this outline is not
 * structural at all".
 *
 * Every ladder rung is a candidate, so selection sees the whole radius/area
 * curve rather than one point on it.
 */
export const generateCandidates = (net, analysis, options = {}) => {
  const { width, height, wallThickness } = analysis;
  const compW = net.bbox.maxX - net.bbox.minX + 1;
  const compH = net.bbox.maxY - net.bbox.minY + 1;
  const wallBboxArea = bboxAreaOf(net.bbox);
  const longest = Math.max(width, height);
  const maxGap = Math.max(24, wallThickness * 12, Math.round(Math.max(compW, compH) * 0.3));
  const minFlank = Math.max(8, wallThickness * 2);
  const probeDepth = Math.max(16, Math.round(Math.min(compW, compH) * 0.12));
  const maxRadius = options.maxCloseRadius ?? Math.max(32, Math.round(longest * 0.045));

  const radii = [];
  for (let r = 2; r < maxRadius; r = Math.round(r * 1.45) + 1) radii.push(r);
  if (radii[radii.length - 1] !== maxRadius) radii.push(maxRadius);

  const netInk = inkCount(net.mask);
  const thickRadius = Math.max(1, Math.round(wallThickness * 0.3));
  let structuralMask = null;
  if (thickRadius >= 2) {
    const structural = openRect(net.mask, width, height, thickRadius);
    const kept = inkCount(structural);
    // Only worth a separate hypothesis when it is neither everything nor
    // almost nothing.
    if (kept >= 0.2 * netInk && kept <= 0.95 * netInk) structuralMask = structural;
  }

  const candidates = [];
  const search = [];
  const evaluated = new Set();
  // What a kept candidate will cost the search memo, charged as it is built so
  // the memo can stop before it holds more than a tab can afford. Only when
  // this search is the one being memoised: a caller-supplied mask and draw mode
  // both opt out of the memo (see traceBoundary), so neither spends its budget.
  const memoBudget = (options.mask || options.brush) ? null : options.searchCache;

  // Reference enclosure for a ladder: the most a rung enclosed before the
  // point where extra radius stopped sealing and started annexing. A sealed
  // footprint gains only rounding slack from more radius, so rungs still
  // growing fast at the top are annexation; and a rung that *fuses* two
  // previously separate enclosures has joined two drawings rather than closed
  // one. Everything below the reference is an incomplete enclosure — which is
  // how a footprint that stopped at an interior wall for five rungs before the
  // real outline closed becomes visible as wrong.
  const ladderReference = (rungs) => {
    let end = rungs.length;
    // Cut at the first rung that fused separate enclosures into one.
    for (let i = 1; i < end; i += 1) {
      if (rungs[i].parts < rungs[i - 1].parts && rungs[i].area > 1.03 * rungs[i - 1].area) {
        end = i;
        break;
      }
    }
    // Then drop a trailing tail that is still growing fast.
    while (end > 1 && rungs[end - 1].area > 1.03 * rungs[end - 2].area) end -= 1;
    let best = 0;
    for (let i = 0; i < end; i += 1) best = Math.max(best, rungs[i].area);
    return best || rungs.reduce((m, r) => Math.max(m, r.area), 1);
  };

  const climb = (variant, policy, mask, bridged, ladder) => {
    const tried = [];
    const group = [];
    const rungs = [];
    let previousArea = null;
    let sealedRadius = null;
    // The mask is fixed for the whole ladder, so its ink box is too.
    const bounds = inkBounds(mask, width, height);
    for (const r of ladder) {
      const token = `${policy}:${variant}:${r}`;
      if (evaluated.has(token)) continue;
      evaluated.add(token);
      const fp = measureFootprint(mask, width, height, r, bounds);
      tried.push({ radius: r, area: fp?.totalEnclosed ?? 0 });
      if (!fp) continue;
      const entry = footprintEntry(fp, fp.largest, width);
      const seal = sealMetrics(entry, wallBboxArea);
      // Enclosure of the whole rung, not just its largest piece: two floor
      // outlines that seal into two components have enclosed both of them.
      const enclosed = fp.components.reduce(
        (sum, c) => sum + (c.size >= 0.02 * fp.largest.size ? c.size : 0), 0,
      );
      const parts = fp.components.filter((c) => c.size >= 0.02 * fp.largest.size).length;
      rungs.push({ area: enclosed, parts });
      const sameAsPrevious = previousArea !== null
        && Math.abs(entry.area - previousArea) <= 0.005 * previousArea;
      previousArea = entry.area;
      if (!sameAsPrevious) {
        const candidate = {
          variant, policy, radius: r, bridgedSpan: bridged, measured: fp, entry, seal,
          enclosed,
        };
        candidates.push(candidate);
        group.push(candidate);
        memoBudget?.retain?.(entry.mask.byteLength + fp.labels.byteLength);
      }
      if (seal.seal >= SEALED && sealedRadius === null) sealedRadius = r;
    }
    if (group.length) {
      const reference = ladderReference(rungs);
      for (const candidate of group) {
        candidate.completeness = Math.min(1, candidate.enclosed / reference);
      }
    }
    search.push({ variant, policy, tried });
    return sealedRadius;
  };

  const segmentsFor = (mask) => extractWallSegments(mask, width, height, {
    minRun: Math.max(12, Math.round(Math.max(compW, compH) * 0.03)),
    maxThickness: Math.max(8, Math.round(Math.max(4, wallThickness) * 3)),
    bridgeGap: Math.round(Math.max(compW, compH) * 0.55),
  });

  const weldedAll = bridgeRunsGuarded(net.mask, width, height, maxGap, minFlank, probeDepth);
  const sealedAll = climb('all', 'weld', weldedAll, 0, radii);

  // The unwelded mask at the same radius: if welding invented the enclosure,
  // the raw footprint is there to be compared against it.
  if (inkCount(weldedAll) !== netInk) {
    climb('all', 'raw', net.mask, 0, [sealedAll ?? radii[0]]);
  }

  // Rescues the caller can request after scoring the base hypotheses. They are
  // idempotent because this whole result is memoised per image and replayed by
  // the next trace of it: a second `structural()` would otherwise append an
  // empty ladder to `search` on every reuse.
  const rescue = {
    hasStructural: Boolean(structuralMask),
    hasCorridor: Boolean(net.ribbon),
    usedStructural: false,
    usedSpan: false,
    usedCorridor: false,
    /**
     * Draw mode only: the user's stroke standing in for wall. This is the one
     * hypothesis that can close a loop the drawing never closed, so it exists
     * to guarantee an answer — but it still has to win on score, and every
     * pixel of it that crosses blank paper costs support.
     */
    corridor: () => {
      if (!net.ribbon || rescue.usedCorridor) return;
      rescue.usedCorridor = true;
      climb('all', 'corridor', orMasks(net.ribbon.slice(), net.mask), 0, radii);
    },
    /** Only the strokes thick enough to be structural. */
    structural: () => {
      if (!structuralMask || rescue.usedStructural) return;
      rescue.usedStructural = true;
      climb('structural', 'weld', bridgeRunsGuarded(
        structuralMask, width, height, maxGap, minFlank, probeDepth,
      ), 0, radii);
    },
    /** Wall lines painted across their full extent. */
    span: () => {
      if (rescue.usedSpan) return;
      rescue.usedSpan = true;
      const segs = segmentsFor(net.mask);
      const spanned = orMasks(segmentSpanMask(segs, width, height), weldedAll.slice());
      climb('all', 'span', spanned, bridgedSpan(segs).longest, radii);
      if (structuralMask) {
        const segsStructural = segmentsFor(structuralMask);
        const spannedStructural = orMasks(
          segmentSpanMask(segsStructural, width, height),
          bridgeRunsGuarded(structuralMask, width, height, maxGap, minFlank, probeDepth),
        );
        climb('structural', 'span', spannedStructural, bridgedSpan(segsStructural).longest, radii);
      }
    },
  };

  // Every wall pixel of the network, weighted by how structural it is. A
  // footprint that leaves real wall outside itself has not solved the outline,
  // it has lost part of the building — this is what stops the "only thick
  // strokes" hypothesis from quietly amputating a whole wing. Thin ink counts
  // for less, so discarding a dimension string welded to the wall by its own
  // extension lines costs almost nothing.
  const coverage = { index: [], weight: [], total: 0 };
  for (let y = net.bbox.minY; y <= net.bbox.maxY; y += 1) {
    const row = y * width;
    for (let x = net.bbox.minX; x <= net.bbox.maxX; x += 1) {
      const i = row + x;
      if (!net.mask[i]) continue;
      const w = !structuralMask || structuralMask[i] ? 1 : 0.25;
      coverage.index.push(i);
      coverage.weight.push(w);
      coverage.total += w;
    }
  }
  // Two plain arrays, one entry per wall pixel of the network.
  memoBudget?.retain?.(coverage.index.length * 16);

  return { candidates, search, wallBboxArea, maxRadius, coverage, rescue, sealedThreshold: SEALED };
};
