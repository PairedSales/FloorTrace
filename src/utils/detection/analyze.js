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

// The page's own tone: the modal grey of everything that is not ink. Anything
// meaningfully below it is screened — drawn, but lighter than the ink
// threshold. Same reading of a grey fill `nonGla.js` takes for shaded pockets.
const SCREEN_MARGIN = 12;

// Window glazing drawn as a screened band across the full thickness of a wall.
// Returns a mask of the bands, or null when there are none.
const findGlazing = (gray, ink, wallMask, width, height, wallThickness) => {
  if (!gray) return null;
  const hist = new Uint32Array(256);
  for (let i = 0; i < ink.length; i += 1) if (!ink[i]) hist[gray[i]] += 1;
  let pageMode = 255;
  let bestMass = -1;
  for (let v = 1; v < 255; v += 1) {
    const mass = hist[v - 1] + hist[v] * 2 + hist[v + 1];
    if (mass > bestMass) {
      bestMass = mass;
      pageMode = v;
    }
  }
  const threshold = pageMode - SCREEN_MARGIN;
  const screened = new Uint8Array(ink.length);
  let count = 0;
  for (let i = 0; i < ink.length; i += 1) {
    if (!ink[i] && gray[i] < threshold) {
      screened[i] = 1;
      count += 1;
    }
  }
  // A band is at least half a wall thick and three walls long, so nothing
  // smaller than that can qualify and the labelling is not worth running.
  const minMinor = Math.max(2, Math.round(wallThickness * 0.5));
  const minMajor = Math.max(3 * wallThickness, 12);
  if (count < minMinor * minMajor) return null;

  const { labels, components } = labelComponents(screened, width, height);
  const tol = Math.max(2, Math.round(wallThickness * 0.34));
  let found = null;

  for (const comp of components) {
    const w = comp.bbox.maxX - comp.bbox.minX + 1;
    const h = comp.bbox.maxY - comp.bbox.minY + 1;
    const minor = Math.min(w, h);
    if (minor < minMinor || minor > Math.round(wallThickness * 1.8)) continue;
    if (Math.max(w, h) < minMajor) continue;
    // Glazing fills its box; a halo along a stroke or a gradient tail does not.
    if (comp.size < 0.55 * w * h) continue;

    const horizontal = w >= h;
    const lo = horizontal ? comp.bbox.minY : comp.bbox.minX;
    const hi = horizontal ? comp.bbox.maxY : comp.bbox.maxX;
    const mid = (lo + hi) >> 1;
    const minorLimit = (horizontal ? height : width) - 1;
    const majorLimit = (horizontal ? width : height) - 1;
    // The wall's cross-section just past one end of the band, measured on the
    // band's own minor axis: the same faces mean the same wall.
    const alignedAt = (pos) => {
      const at = (m) => (horizontal ? m * width + pos : pos * width + m);
      if (!wallMask[at(mid)]) return false;
      let faceLo = mid;
      let faceHi = mid;
      while (faceLo > 0 && wallMask[at(faceLo - 1)]) faceLo -= 1;
      while (faceHi < minorLimit && wallMask[at(faceHi + 1)]) faceHi += 1;
      return Math.abs(faceLo - lo) <= tol && Math.abs(faceHi - hi) <= tol;
    };
    // Every position within a wall's reach of the end, not the first one that
    // is wall: the first is usually the window's own rail, a line running the
    // length of the opening whose "cross-section" is the window, not the wall.
    const reach = Math.max(3, Math.round(wallThickness * 0.6));
    const aligned = (start, step) => {
      for (let d = 1; d <= reach; d += 1) {
        const pos = start + step * d;
        if (pos < 0 || pos > majorLimit) return false;
        if (alignedAt(pos)) return true;
      }
      return false;
    };
    if (!aligned(horizontal ? comp.bbox.minX : comp.bbox.minY, -1)) continue;
    if (!aligned(horizontal ? comp.bbox.maxX : comp.bbox.maxY, 1)) continue;

    if (!found) found = new Uint8Array(ink.length);
    for (let y = comp.bbox.minY; y <= comp.bbox.maxY; y += 1) {
      const row = y * width;
      for (let x = comp.bbox.minX; x <= comp.bbox.maxX; x += 1) {
        if (labels[row + x] === comp.id) found[row + x] = 1;
      }
    }
  }
  return found;
};

export const analyzeFloorplan = (imageData, options = {}) => {
  const maxDimension = options.maxDimension ?? 1400;
  const scaled = binarizeToWorkingScale(imageData, maxDimension);
  const { width, height, ink, gray } = scaled;
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
  // All four directions accumulate into one mask — `keepLongRuns` only sets
  // bits, so this is the same union the three OR passes produced, without the
  // three extra page-sized allocations.
  const strokes = new Uint8Array(tolerant.length);
  for (const direction of ['h', 'v', 'd', 'a']) {
    keepLongRuns(tolerant, width, height, minRun, direction, strokes);
  }
  // Restrict run hits back to real ink (+1px halo from the tolerant dilate).
  for (let i = 0; i < strokes.length; i += 1) {
    if (strokes[i] && !tolerant[i]) strokes[i] = 0;
  }
  const wallMask = orMasks(strokes, openRect(cleaned, width, height, 2));

  const wallThickness = estimateStrokeThickness(wallMask, width, height);

  // Sheet-title underlines ("FIRST FLOOR"): an isolated thin line with a
  // dense row of stripped glyph specks right above it is typography, not a
  // wall. Left in, the bbox-based network merge annexes it and the seal
  // closes the gap, ballooning the footprint over the title block.
  const textLineMask = new Uint8Array(wallMask.length);
  {
    const { labels: wl, components: wcomps } = labelComponents(wallMask, width, height);
    for (const comp of wcomps) {
      const w = comp.bbox.maxX - comp.bbox.minX + 1;
      const h = comp.bbox.maxY - comp.bbox.minY + 1;
      if (h > wallThickness + 2 || w < minRun || w < 3 * h || w > 0.3 * width) continue;

      // Along-axis margin stays out of the isolation scan: a room-name
      // underline often runs nearly wall-to-wall, so the perpendicular walls
      // flanking its ends must not veto removal; a parallel companion line
      // above/below (window glazing band) still does.
      const halo = Math.max(4, wallThickness);
      const y0 = Math.max(0, comp.bbox.minY - halo);
      const y1 = Math.min(height - 1, comp.bbox.maxY + halo);
      const x0 = comp.bbox.minX;
      const x1 = comp.bbox.maxX;
      let isolated = true;
      for (let y = y0; y <= y1 && isolated; y += 1) {
        const row = y * width;
        for (let x = x0; x <= x1; x += 1) {
          if (wallMask[row + x] && wl[row + x] !== comp.id) {
            isolated = false;
            break;
          }
        }
      }
      if (!isolated) continue;

      // Stripped-speck (glyph) columns must cover most of the line's width
      const bandTop = Math.max(0, comp.bbox.minY - Math.round(speckMax * 1.3));
      let covered = 0;
      for (let x = comp.bbox.minX; x <= comp.bbox.maxX; x += 1) {
        for (let y = bandTop; y < comp.bbox.minY; y += 1) {
          if (ink[y * width + x] && !cleaned[y * width + x]) {
            covered += 1;
            break;
          }
        }
      }
      if (covered < 0.5 * w) continue;

      for (let y = comp.bbox.minY; y <= comp.bbox.maxY; y += 1) {
        const row = y * width;
        for (let x = comp.bbox.minX; x <= comp.bbox.maxX; x += 1) {
          if (wl[row + x] === comp.id) {
            wallMask[row + x] = 0;
            textLineMask[row + x] = 1;
          }
        }
      }
    }
  }

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
    // Stripped text lines stay out — the underline would come right back as
    // a perfectly line-like component.
    const residual = new Uint8Array(ink.length);
    for (let i = 0; i < ink.length; i += 1) {
      residual[i] = ink[i] && !wallMask[i] && !textLineMask[i] ? 1 : 0;
    }
    const inkLabeled = labelComponents(residual, width, height);
    for (const comp of inkLabeled.components) {
      const w = comp.bbox.maxX - comp.bbox.minX + 1;
      const h = comp.bbox.maxY - comp.bbox.minY + 1;
      const maxDim = Math.max(w, h);
      // Sparse (bare lines) or long non-solid bands (hatched window bands,
      // bay outlines with glazing); solid blocks are already in wallMask.
      // The band path needs real length — without it, bold title glyphs
      // (small, ~half-filled boxes) sneak back in as "lines".
      const sparse = comp.size <= 5 * maxDim;
      const band = comp.size <= 0.7 * w * h && maxDim >= 3 * lineMin;
      if (maxDim < lineMin || (!sparse && !band)) continue;
      for (let y = comp.bbox.minY; y <= comp.bbox.maxY; y += 1) {
        const row = y * width;
        for (let x = comp.bbox.minX; x <= comp.bbox.maxX; x += 1) {
          if (inkLabeled.labels[row + x] === comp.id) boundaryMask[row + x] = 1;
        }
      }
    }
  }

  // Screened glazing: a window drawn as a grey band filling the wall it sits
  // in, rather than as two black rails with the page showing between them.
  // Above the ink threshold the band is not there at all, so the wall has a
  // hole in it the width of the window — and on an exterior wall the flood
  // comes in through the glazing and takes the rooms behind it with it,
  // leaving an outline that follows real wall the whole way round and is
  // missing a bedroom. `bridgeRunsGuarded` cannot be relied on to weld the
  // hole shut: a window that runs up to within a wall thickness of a corner
  // leaves a stub too short to anchor a weld, and the stub is short for a
  // reason no scan line can see.
  //
  // Rescued only where the band *is* the wall: screened rather than merely
  // tinted, no thicker than the wall, and, at both ends, continuing into a
  // wall whose cross-section is the band's own. That last test is what
  // separates a window from everything else drawn in the same grey — a stair
  // tread runs *between* two walls, so the wall it meets crosses it instead
  // of lining up with it. `nonGla.js` throws these bands away by name ("thin
  // dark strips are window glazing bands, not terraces") and nothing else was
  // looking at them.
  const glazing = findGlazing(gray, ink, wallMask, width, height, wallThickness);
  if (glazing) orMasks(boundaryMask, glazing);

  // Thick-stroke evidence: survives an opening proportional to the dominant
  // wall thickness. Distinguishes walls from fixture/counter lines when the
  // plan uses thick walls; degrades to ~wallMask on thin-wall plans.
  const thickRadius = Math.max(1, Math.round(wallThickness * 0.3));
  const thickMask = openRect(wallMask, width, height, thickRadius);

  const band = Math.max(2, Math.round(wallThickness / 2));

  // `wallThickness` is the answer to "is this image too small to trace": it is
  // the dominant stroke width *at working scale*, and below ~3px the speck
  // filter and the run filter take the walls with the noise. `downscaled` says
  // which remedy applies — a thin stroke on a raster we shrank can be recovered
  // by raising `maxDimension`, one at scale 1:1 cannot be recovered at all.
  return {
    width,
    height,
    scaleX: scaled.scaleX,
    scaleY: scaled.scaleY,
    downscaled: scaled.scaleX < 1 || scaled.scaleY < 1,
    ink,
    gray: scaled.gray,
    cleaned,
    wallMask,
    boundaryMask,
    thickMask,
    wallThickness,
    band,
  };
};

// Directional smears + SATs: fast "does this column/row band touch a wall"
// queries, and the only consumer is growRoomRect's lineCoverage — so a
// perimeter-only trace used to build all four and read none. They are 16 B/px
// of the analysis entry, which the worker holds for as long as the image is
// open, against 6 B/px for everything else in it.
//
// A memoising accessor rather than a getter on the analysis object:
// `boundary.js` builds `{...analysis, wallMask: net.mask}` per floor, and a
// spread would invoke a getter every time. The two undirected smears they are
// built from had no readers at all and are now purely local.
const coverageSatCache = new WeakMap();

export const coverageSats = (analysis) => {
  const cached = coverageSatCache.get(analysis);
  if (cached) return cached;
  const { wallMask, thickMask, width, height, band } = analysis;
  const sats = {
    smearH: buildSat(dilateRows(wallMask, width, height, band), width, height),
    smearV: buildSat(dilateCols(wallMask, width, height, band), width, height),
    thickH: buildSat(dilateRows(thickMask, width, height, band), width, height),
    thickV: buildSat(dilateCols(thickMask, width, height, band), width, height),
  };
  coverageSatCache.set(analysis, sats);
  return sats;
};
