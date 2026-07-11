// Shared floorplan analysis: binarize at working scale, strip text/decoration
// specks, extract the structural wall mask, and estimate stroke thickness.
// Everything downstream (room + boundary detection) consumes this one result.

import {
  binarizeToWorkingScale,
  keepLongRuns,
  dilateRows,
  dilateCols,
  dilateRect,
  openRect,
  orMasks,
  labelComponents,
  buildSat,
} from './raster.js';

// Typical stroke thickness: histogram of short ink runs (row + column),
// weighted by pixel mass so thick walls dominate thin fixture lines.
const estimateStrokeThickness = (mask, width, height) => {
  const maxRun = Math.max(8, Math.round(Math.max(width, height) * 0.03));
  const hist = new Float64Array(maxRun + 1);

  const scan = (startIdx, stepIdx, count) => {
    let runStart = -1;
    for (let i = 0; i <= count; i += 1) {
      const on = i < count && mask[startIdx + i * stepIdx];
      if (on && runStart < 0) runStart = i;
      if (!on && runStart >= 0) {
        const len = i - runStart;
        if (len <= maxRun) hist[len] += len;
        runStart = -1;
      }
    }
  };

  for (let y = 0; y < height; y += 1) scan(y * width, 1, width);
  for (let x = 0; x < width; x += 1) scan(x, width, height);

  let best = 2;
  let bestMass = 0;
  for (let len = 1; len <= maxRun; len += 1) {
    if (hist[len] > bestMass) {
      bestMass = hist[len];
      best = len;
    }
  }
  return best;
};

export const analyzeFloorplan = (imageData, options = {}) => {
  const maxDimension = options.maxDimension ?? 1400;
  const scaled = binarizeToWorkingScale(imageData, maxDimension);
  const { width, height, ink } = scaled;
  const longest = Math.max(width, height);

  // Drop small components: text glyphs, window tick marks, arrows, dots.
  // Walls (and anything attached to them) form far larger components.
  const speckMax = options.speckMaxDim ?? Math.max(14, Math.round(longest * 0.03));
  const { labels, components } = labelComponents(ink, width, height);
  const cleaned = ink.slice();
  for (const comp of components) {
    const w = comp.bbox.maxX - comp.bbox.minX + 1;
    const h = comp.bbox.maxY - comp.bbox.minY + 1;
    if (Math.max(w, h) >= speckMax) continue;
    for (let y = comp.bbox.minY; y <= comp.bbox.maxY; y += 1) {
      const row = y * width;
      for (let x = comp.bbox.minX; x <= comp.bbox.maxX; x += 1) {
        if (labels[row + x] === comp.id) cleaned[row + x] = 0;
      }
    }
  }

  // Structural strokes: long straight runs in the 4 canonical directions
  // (tolerating 1px scan skew via a 1px pre-dilate), plus anything thick
  // enough to survive a small square opening (thick walls of any shape).
  // This removes door swing arcs and stray curves that survived the speck
  // filter because they touch nothing.
  const minRun = options.minRunLength ?? Math.max(12, Math.round(longest * 0.018));
  const tolerant = dilateRect(cleaned, width, height, 1);
  const strokes = keepLongRuns(tolerant, width, height, minRun, 'h');
  orMasks(strokes, keepLongRuns(tolerant, width, height, minRun, 'v'));
  orMasks(strokes, keepLongRuns(tolerant, width, height, minRun, 'd'));
  orMasks(strokes, keepLongRuns(tolerant, width, height, minRun, 'a'));
  // Restrict run hits back to real ink (+1px halo from the tolerant dilate).
  for (let i = 0; i < strokes.length; i += 1) {
    if (strokes[i] && !tolerant[i]) strokes[i] = 0;
  }
  const wallMask = orMasks(strokes, openRect(cleaned, width, height, 2));

  const wallThickness = estimateStrokeThickness(wallMask, width, height);

  // Boundary-only mask: rescue line-like ink components the two filters above
  // destroy — bay windows and screened-porch rails are thin, often oblique,
  // and drawn as disconnected segments, so the speck filter drops the short
  // ones and the run filter drops every non-canonical angle. Long-but-sparse
  // components (low mass per unit length) are lines, not text or furniture
  // blobs. Room detection keeps the strict mask — door arcs must not read as
  // walls there — but the seal search needs these lines or an exterior bay
  // reads as a mouth the closing ladder can never span.
  const lineMin = Math.max(16, Math.round(minRun * 0.7));
  const boundaryMask = wallMask.slice();
  {
    // Residual ink (ink minus walls) so a window band that touches the wall
    // network is judged on its own shape, not as part of one huge component.
    const residual = new Uint8Array(ink.length);
    for (let i = 0; i < ink.length; i += 1) residual[i] = ink[i] && !wallMask[i] ? 1 : 0;
    const inkLabeled = labelComponents(residual, width, height);
    for (const comp of inkLabeled.components) {
      const w = comp.bbox.maxX - comp.bbox.minX + 1;
      const h = comp.bbox.maxY - comp.bbox.minY + 1;
      const maxDim = Math.max(w, h);
      // Sparse (bare lines) or non-solid bbox (hatched window bands, bay
      // outlines with glazing); solid blocks are already in wallMask.
      const lineLike = comp.size <= Math.max(5 * maxDim, 0.7 * w * h);
      if (maxDim < lineMin || !lineLike) continue;
      for (let y = comp.bbox.minY; y <= comp.bbox.maxY; y += 1) {
        const row = y * width;
        for (let x = comp.bbox.minX; x <= comp.bbox.maxX; x += 1) {
          if (inkLabeled.labels[row + x] === comp.id) boundaryMask[row + x] = 1;
        }
      }
    }
  }

  // Thick-stroke evidence: survives an opening proportional to the dominant
  // wall thickness. Distinguishes walls from fixture/counter lines when the
  // plan uses thick walls; degrades to ~wallMask on thin-wall plans.
  const thickRadius = Math.max(1, Math.round(wallThickness * 0.3));
  const thickMask = openRect(wallMask, width, height, thickRadius);

  // Directional smears + SATs: fast "does this column/row band touch a wall"
  // queries for the room-growing scans.
  const band = Math.max(2, Math.round(wallThickness / 2));
  const smearH = dilateRows(wallMask, width, height, band);
  const smearV = dilateCols(wallMask, width, height, band);
  const thickSmearH = dilateRows(thickMask, width, height, band);
  const thickSmearV = dilateCols(thickMask, width, height, band);

  return {
    width,
    height,
    scaleX: scaled.scaleX,
    scaleY: scaled.scaleY,
    threshold: scaled.threshold,
    ink,
    gray: scaled.gray,
    cleaned,
    wallMask,
    boundaryMask,
    thickMask,
    wallThickness,
    band,
    smearH,
    smearV,
    satSmearH: buildSat(smearH, width, height),
    satSmearV: buildSat(smearV, width, height),
    satThickH: buildSat(thickSmearH, width, height),
    satThickV: buildSat(thickSmearV, width, height),
  };
};
