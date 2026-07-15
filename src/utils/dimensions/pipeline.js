/**
 * Dimension-detection pipeline (environment-agnostic core).
 *
 * Phases:
 *   1. Preprocess      — grayscale, CLAHE (OpenCV when loaded, JS fallback),
 *                        selective denoise, unsharp mask.
 *   2. Pass 1 OCR      — Tesseract sparse-text on the full preprocessed page
 *                        (runs in its worker while spatial analysis runs here).
 *   3. Spatial analysis— glyph clustering finds horizontal AND vertical text
 *                        line candidates the full-page pass misses.
 *   4. ROI refinement  — targeted single-line Tesseract on zoomed crops,
 *                        rotating vertical candidates 90° both ways.
 *   5. Neural rescue   — optional PaddleOCR collage pass over ROIs Tesseract
 *                        could not parse (browser only, skipped when the
 *                        model is not warmed up or the time budget is spent).
 *   6. Merge           — dedupe, confidence scoring, dominant format.
 *
 * The `env` adapter supplies platform specifics so the same pipeline runs in
 * the browser and in Node benchmarks:
 *   env.toOcrInput(imageDataLike) -> value accepted by tesseract.js
 *   env.refineRois(tiles)         -> optional PaddleOCR hook
 *   env.budgetMs                  -> wall-clock budget (default 2600)
 */

import { parseDimensionLine, inferDominantFormat, formatDimensionText } from './parse.js';
import { matchExteriorFeature } from './exteriorLabels.js';
import {
  toGray, grayToImageDataLike, clahe, unsharp, binarizeInk,
  scaleGray, cropGray, rotateGray90, stretchGray, addBorder, binarizeGray,
  isolateCenterBand, trimFlankRails
} from './raster.js';
import { findTextRegions } from './regions.js';
import { recognizeSparse, recognizeLine, lineText } from './ocrTesseract.js';
import { loadOpenCv, openCvIfReady, enhanceGrayWithCv, estimateSpeckle } from './opencvBridge.js';

const DEFAULT_BUDGET_MS = 2600;
const MAX_OCR_DIM = 2600;      // full-page OCR working size cap
const UPSCALE_BELOW = 1800;    // upscale small scans: tiny glyphs kill OCR
const ANALYSIS_DIM = 1400;     // spatial-analysis working size cap
const TARGET_GLYPH_PX = 36;    // ROI zoom target text height for Tesseract
const MAX_ROIS = 40;
const MIN_CONFIDENCE = 40;
const PADDLE_RESERVE_MS = 1100; // time to leave for the neural rescue pass

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const overlapRatio = (a, b) => {
  if (!a || !b) return 0;
  const ox = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const oy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const minArea = Math.min(a.width * a.height, b.width * b.height);
  return minArea > 0 ? (ox * oy) / minArea : 0;
};

/** Intersection area as a fraction of b's area (how much of b is covered by a). */
const coverRatio = (a, b) => {
  if (!a || !b) return 0;
  const ox = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const oy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const area = b.width * b.height;
  return area > 0 ? (ox * oy) / area : 0;
};

const tessBboxToFull = (bbox, scale) => bbox && {
  x: bbox.x0 / scale,
  y: bbox.y0 / scale,
  width: (bbox.x1 - bbox.x0) / scale,
  height: (bbox.y1 - bbox.y0) / scale
};

const valuesMatch = (a, b) =>
  Math.abs(a.width - b.width) / Math.max(a.width, b.width, 1) <= 0.06 &&
  Math.abs(a.height - b.height) / Math.max(a.height, b.height, 1) <= 0.06;

// ---------------------------------------------------------------------------
// Candidate construction / merging
// ---------------------------------------------------------------------------

const makeCandidate = (parsed, bbox, ocrConfidence, source) => {
  let base = source === 'paddle' ? 76 : Math.min(97, ocrConfidence);
  // A clean explicit-format parse from a zoomed targeted read is strong
  // evidence even when the engine reports middling confidence (common on
  // binarized tiles). Sparse full-page reads don't get the bonus — they are
  // exactly what the verification pass exists to double-check.
  if (source !== 'tess-full' && source !== 'tess-band' &&
      parsed.quality === 3 && (parsed.penalty || 0) === 0) {
    base += 6;
  }
  const confidence = Math.round(Math.max(0, Math.min(100, base - (parsed.penalty || 0))));
  return {
    width: parsed.width,
    height: parsed.height,
    text: parsed.text,
    bbox,
    confidence,
    format: parsed.format,
    quality: parsed.quality,
    mixedPair: Boolean(parsed.mixedPair),
    source
  };
};

const digitsOf = (s) => ((s || '').match(/\d/g) || []).join('');

const dedupeCandidates = (candidates) => {
  const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
  // Same values from two bboxes that touch or nearly touch are one label
  // read twice with different framing (a row box vs a name+row blob), not
  // two identical rooms — real twins sit rooms apart.
  const near = (a, b) =>
    Math.abs(a.x + a.width / 2 - (b.x + b.width / 2)) < 0.6 * Math.max(a.width, b.width) &&
    Math.abs(a.y + a.height / 2 - (b.y + b.height / 2)) < 1.2 * Math.max(a.height, b.height);
  const kept = [];
  for (const c of sorted) {
    const dup = kept.some((k) => {
      const ov = overlapRatio(k.bbox, c.bbox);
      if (ov > 0.6) return true;               // same text region, keep best read
      return (ov > 0.1 || near(k.bbox, c.bbox)) && valuesMatch(k, c);
    });
    if (!dup) kept.push(c);
  }
  return kept;
};

// ---------------------------------------------------------------------------
// Pass-1 result mining
// ---------------------------------------------------------------------------

const meanWordConfidence = (line) => {
  if (!line.words || line.words.length === 0) return 50;
  return line.words.reduce((s, w) => s + (w.confidence || 0), 0) / line.words.length;
};

const digitCountOf = (text) => (text.match(/\d/g) || []).length;

/**
 * Group digit-bearing words into horizontal bands and re-parse the joined
 * text. Catches labels Tesseract fragments across several "lines".
 */
const bandWords = (words, scale, parseOpts) => {
  const digitWords = words.filter((w) =>
    w.bbox && /\d/.test(w.text || '') && (w.confidence || 0) >= 15
  );
  if (digitWords.length < 2) return [];

  const sorted = [...digitWords].sort((a, b) => a.bbox.x0 - b.bbox.x0);
  const bands = [];

  for (const w of sorted) {
    const h = w.bbox.y1 - w.bbox.y0;
    const cy = (w.bbox.y0 + w.bbox.y1) / 2;
    let target = null;
    for (const band of bands) {
      const tol = 1.2 * Math.max(h, band.h);
      const gap = w.bbox.x0 - band.maxX;
      if (Math.abs(cy - band.cy) <= tol && gap <= 3.5 * Math.max(h, band.h) && gap > -band.w) {
        target = band;
        break;
      }
    }
    if (target) {
      target.words.push(w);
      target.maxX = Math.max(target.maxX, w.bbox.x1);
      target.h = Math.max(target.h, h);
    } else {
      bands.push({ words: [w], maxX: w.bbox.x1, cy, h, w: w.bbox.x1 - w.bbox.x0 });
    }
  }

  const results = [];
  for (const band of bands) {
    if (band.words.length < 2) continue;

    // Pull in connective words ("x") that sit inside the band's span
    const minX = Math.min(...band.words.map((w) => w.bbox.x0));
    const maxX = band.maxX;
    const minY = Math.min(...band.words.map((w) => w.bbox.y0));
    const maxY = Math.max(...band.words.map((w) => w.bbox.y1));
    const inBand = words
      .filter((w) =>
        w.bbox && w.bbox.x0 >= minX - 4 && w.bbox.x1 <= maxX + 4 &&
        (w.bbox.y0 + w.bbox.y1) / 2 >= minY && (w.bbox.y0 + w.bbox.y1) / 2 <= maxY
      )
      .sort((a, b) => a.bbox.x0 - b.bbox.x0);

    const text = inBand.map((w) => w.text).join(' ');
    const parsed = parseDimensionLine(text, parseOpts);
    if (!parsed) continue;

    const conf = inBand.reduce((s, w) => s + (w.confidence || 0), 0) / inBand.length;
    results.push(makeCandidate(
      parsed,
      { x: minX / scale, y: minY / scale, width: (maxX - minX) / scale, height: (maxY - minY) / scale },
      conf,
      'tess-band'
    ));
  }
  return results;
};

// ---------------------------------------------------------------------------
// ROI preparation
// ---------------------------------------------------------------------------

/**
 * Build the OCR tile variants for one ROI. Binarized tiles kill the
 * anti-aliasing halos that bilinear zoom introduces (which reliably derail
 * the LSTM); grayscale tiles survive thin strokes binarization can eat.
 * Vertical ROIs get both 90° rotations of each. All tiles get a white
 * border — Tesseract misreads text that touches the image edge.
 */
const prepareRoiVariants = (roiGray, roi) => {
  // Cross-axis padding stays tight so the crop doesn't swallow a
  // neighbouring text row/column; along-axis padding is generous so
  // clipped leading/trailing glyphs are recovered.
  const padX = roi.vertical ? roi.width * 0.08 + 2 : roi.width * 0.12 + 6;
  const padY = roi.vertical ? roi.height * 0.3 + 4 : roi.height * 0.45 + 4;
  // Cleanup happens at native scale, BEFORE zooming: interpolation smears
  // faint ink into the inter-row gaps, which makes the zoomed profile look
  // like one merged band and blinds the row/rail isolation. Rail margins are
  // the crop's REAL padding — edge-clamped crops have less than requested.
  const rawCrop = cropGray(
    roiGray,
    roi.x - padX, roi.y - padY,
    roi.width + padX * 2, roi.height + padY * 2
  );
  const marginLo = (roi.vertical ? roi.y - rawCrop.offsetY : roi.x - rawCrop.offsetX) - 2;
  const marginHi = (roi.vertical
    ? rawCrop.offsetY + rawCrop.height - (roi.y + roi.height)
    : rawCrop.offsetX + rawCrop.width - (roi.x + roi.width)) - 2;
  const crop = trimFlankRails(
    isolateCenterBand(rawCrop, { vertical: roi.vertical }),
    {
      vertical: roi.vertical,
      marginLo: Math.max(0, marginLo),
      marginHi: Math.max(0, marginHi)
    }
  );

  const textHeight = roi.vertical ? roi.width : roi.height;
  const zoom = Math.max(1, Math.min(8, TARGET_GLYPH_PX / Math.max(6, textHeight)));
  const stretched = stretchGray(crop);
  const zoomTo = (z) => (z > 1.05 ? scaleGray(stretched, z) : stretched);

  const MARGIN = 16;
  if (roi.vertical) {
    const zoomed = zoomTo(zoom);
    const binary = binarizeGray(zoomed);
    const sharp = unsharp(zoomed, 1.1);
    const variants = [
      addBorder(rotateGray90(binary, 1), MARGIN),
      addBorder(rotateGray90(binary, -1), MARGIN),
      addBorder(rotateGray90(sharp, 1), MARGIN),
      addBorder(rotateGray90(sharp, -1), MARGIN)
    ];
    // A near-square "vertical" cluster is often two stacked horizontal rows
    // ("wic" over "6x9"), not rotated text — try it unrotated too.
    if (roi.height < roi.width * 2) variants.push(addBorder(binary, MARGIN));
    return variants;
  }
  // Tiny glyphs have no single reliable zoom: each label resolves in a
  // narrow band somewhere between ~4x and ~8x, so failing ROIs walk a
  // ladder. Later rungs only run when the earlier ones failed to parse
  // (the read loop exits early on success). Even sufficiently-zoomed crops
  // get a second rung: rungs past the first pair run in block mode, the only
  // mode that survives a crop whose two text rows fused (wall strokes
  // crossing the gap defeat row isolation).
  const variants = [];
  const seen = new Set();
  for (const z of zoom >= 3 ? [zoom, zoom * 1.45, zoom * 2] : [zoom, zoom * 1.6]) {
    const zc = Math.min(8, z);
    const key = Math.round(zc * 4);
    if (seen.has(key)) continue;
    seen.add(key);
    const zoomed = zoomTo(zc);
    variants.push(
      addBorder(unsharp(zoomed, 1.1), MARGIN),
      addBorder(binarizeGray(zoomed), MARGIN)
    );
  }
  return variants;
};

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export const detectDimensionsCore = async (imageData, env) => {
  const budget = env.budgetMs ?? DEFAULT_BUDGET_MS;
  const t0 = Date.now();
  const elapsed = () => Date.now() - t0;
  const timings = {};

  // ---- Phase 1: preprocess -------------------------------------------------
  loadOpenCv(); // non-blocking warm-up; used this call if already resolved

  const fullGray = toGray(imageData);
  const maxDim = Math.max(fullGray.width, fullGray.height);
  let ocrScale = 1;
  if (maxDim > MAX_OCR_DIM) ocrScale = MAX_OCR_DIM / maxDim;
  else if (maxDim < UPSCALE_BELOW) ocrScale = Math.min(2.2, 2000 / maxDim);
  const baseGray = ocrScale === 1 ? fullGray : scaleGray(fullGray, ocrScale);

  const baseInk = binarizeInk(baseGray);
  const speckle = estimateSpeckle(baseInk);

  const cv = openCvIfReady();
  let enhanced = cv ? enhanceGrayWithCv(cv, baseGray, { denoise: speckle > 0.12 }) : null;
  if (!enhanced) enhanced = clahe(baseGray);
  enhanced = unsharp(enhanced, 1.1);
  // For upscaled or speckled scans, binarize the full-page OCR input: Otsu
  // after CLAHE kills the JPEG smear and interpolation halos that derail the
  // sparse pass. Native-resolution clean images read better in grayscale.
  const pass1Input = ocrScale > 1 || speckle > 0.12
    ? binarizeGray(enhanced)
    : enhanced;
  // ROI crops for upscaled (tiny-glyph) plans come from a CLAHE+unsharp page
  // at NATIVE resolution — contrast-normalize first, then let the per-ROI
  // zoom do the only interpolation. Cropping the upscaled `enhanced` page
  // instead compounds two bilinear passes and fuses the glyphs into blobs.
  const roiGray = ocrScale > 1 ? unsharp(clahe(fullGray), 1.1) : fullGray;
  timings.preprocess = elapsed();

  // ---- Phase 2: full-page OCR (in worker) + Phase 3: spatial analysis ------
  const pass1Promise = recognizeSparse(env.toOcrInput(grayToImageDataLike(pass1Input)));

  const analysisScale = Math.min(1, ANALYSIS_DIM / Math.max(enhanced.width, enhanced.height));
  const analysisInk = analysisScale === 1
    ? binarizeInk(enhanced)
    : binarizeInk(scaleGray(enhanced, analysisScale));
  const regions = findTextRegions(analysisInk);
  // Map analysis boxes back to full-image coordinates
  const toFull = analysisScale * ocrScale;
  const spatialBoxes = [
    ...regions.horizontal.map((b) => ({
      x: b.x / toFull, y: b.y / toFull,
      width: b.width / toFull, height: b.height / toFull,
      glyphCount: b.glyphCount, vertical: false, rescued: b.rescued
    })),
    ...regions.vertical.map((b) => ({
      x: b.x / toFull, y: b.y / toFull,
      width: b.width / toFull, height: b.height / toFull,
      glyphCount: b.glyphCount, vertical: true
    }))
  ];
  let glyphHeightFull = regions.glyphHeight / toFull;
  timings.spatial = elapsed() - timings.preprocess;

  const { lines, words } = await pass1Promise;
  timings.pass1 = elapsed() - timings.preprocess - timings.spatial;

  // The spatial glyph-height estimate is a median over ALL glyph-sized
  // components — on plans dense with dashed walls/hatching the dashes drag it
  // far below the real text height, mis-tuning every threshold derived from
  // it. Confident digit-bearing pass-1 words are known DIMENSION text (room
  // names often use a larger face); prefer their median height.
  const wordHeights = words
    .filter((w) => w.bbox && (w.confidence || 0) >= 55 &&
      /\d/.test(w.text || '') && (w.text || '').trim().length >= 2)
    .map((w) => (w.bbox.y1 - w.bbox.y0) / ocrScale)
    .sort((a, b) => a - b);
  if (wordHeights.length >= 4) {
    glyphHeightFull = wordHeights[wordHeights.length >> 1];
  }

  // Below ~12px a hyphen glyph appears and vanishes freely, so the
  // architectural hyphen form ("13-2x17-2") is only treated as explicit
  // evidence when the dimension text is large enough to render it reliably —
  // or when the page itself proves the convention: several confident
  // full-pair reads can't come from stroke noise, whereas a lone "6-5"
  // misread on a tiny-text plan can.
  const hyphenPairRe = /\d+\s*-\s*\d+\s*[x×]\s*\d+\s*-\s*\d+/i;
  const hyphenEvidence = lines.filter((l) => {
    const t = lineText(l);
    return t && hyphenPairRe.test(t) && meanWordConfidence(l) >= 60;
  }).length;
  const parseOpts = { hyphenExplicit: glyphHeightFull >= 12 || hyphenEvidence >= 2 };

  // ---- Exterior-feature labels ----------------------------------------------
  // Porch/patio/deck/balcony… name lines from the full-page pass. Their bboxes
  // seed the boundary tracer's footprint carve so exterior features never
  // count toward area. Runs over raw lines (before the dedupe below) so two
  // identically-named porches both register.
  const exteriorLabels = [];
  for (const line of lines) {
    const raw = lineText(line);
    const keyword = raw ? matchExteriorFeature(raw) : null;
    if (!keyword) continue;
    const bbox = tessBboxToFull(line.bbox, ocrScale);
    if (!bbox || meanWordConfidence(line) < 35) continue;
    if (exteriorLabels.some((l) => overlapRatio(l.bbox, bbox) > 0.5)) continue;
    exteriorLabels.push({
      keyword,
      text: raw,
      bbox: {
        x: Math.round(bbox.x),
        y: Math.round(bbox.y),
        width: Math.round(bbox.width),
        height: Math.round(bbox.height)
      }
    });
  }

  // ---- Mine pass-1 output ---------------------------------------------------
  const candidates = [];
  const digitLineRois = [];
  const alphaBoxes = [];
  const seenLineTexts = new Set();

  for (const line of lines) {
    const raw = lineText(line);
    if (!raw || seenLineTexts.has(raw)) continue;
    seenLineTexts.add(raw);

    const bbox = tessBboxToFull(line.bbox, ocrScale);
    const conf = meanWordConfidence(line);
    const digits = digitCountOf(raw);

    const parsed = parseDimensionLine(raw, parseOpts);
    if (parsed) {
      candidates.push(makeCandidate(parsed, bbox, conf, 'tess-full'));
    } else if (digits >= 2 && conf > 15 && bbox) {
      // A visible pair separator is near-proof of a dimension row even when
      // the numbers came out garbled; a real word next to the digits usually
      // means a ceiling-height note, worth reading only after the dim rows.
      digitLineRois.push({
        ...bbox,
        hasSep: /\d\s*[x×]|[x×]\s*\d/i.test(raw),
        hasWord: /[a-wyz]{3,}/i.test(raw)
      });
    } else if (digits <= 1 && conf > 40 && /[a-z]{4,}/i.test(raw) && bbox) {
      alphaBoxes.push(bbox); // room names / titles (incl. "BEDROOM 2") — veto spatial ROIs here
    }
  }

  for (const bandCandidate of bandWords(words, ocrScale, parseOpts)) {
    if (!candidates.some((c) => overlapRatio(c.bbox, bandCandidate.bbox) > 0.4)) {
      candidates.push(bandCandidate);
    }
  }

  // ---- Assemble prioritized ROI list ---------------------------------------
  const rois = [];

  // A box twice the page glyph height has swallowed two stacked text rows
  // (dimension line + ceiling line). Queue each half as its own ROI: the
  // double-height crop halves the zoom and defeats row isolation.
  const pushRoi = (box, priority) => {
    const vertical = box.vertical ?? box.height > box.width * 1.6;
    if (!vertical && glyphHeightFull > 0 &&
        box.height > Math.max(12, 1.55 * glyphHeightFull) &&
        box.height <= 3.4 * glyphHeightFull) {
      const half = box.height / 2;
      rois.push({ ...box, vertical, height: half, priority });
      rois.push({ ...box, vertical, y: box.y + half, height: half, priority: priority - 1 });
      return;
    }
    rois.push({ ...box, vertical, priority });
  };

  // A candidate bbox spanning several text rows came from a garbled
  // multi-line pass-1 read; its parse is untrustworthy and it must not
  // suppress the single-row label boxes it happens to cover.
  const rowLike = (b) =>
    glyphHeightFull <= 0 || Math.min(b.width, b.height) <= 3 * glyphHeightFull;

  // Verification re-reads: low-confidence accepted candidates get a zoomed
  // second opinion (their bbox is known-good; the values may not be).
  for (const c of candidates) {
    if (c.confidence >= 90 || !c.bbox) continue;
    rois.push({ ...c.bbox, vertical: c.bbox.height > c.bbox.width * 1.6, priority: 8 });
  }

  for (const bbox of digitLineRois) {
    if (candidates.some((c) => rowLike(c.bbox) && overlapRatio(c.bbox, bbox) > 0.4)) continue;
    pushRoi(bbox, bbox.hasSep ? 7 : bbox.hasWord ? 4 : 6);
  }

  for (const box of spatialBoxes) {
    // Too thin to contain glyphs (for vertical text the box width IS the
    // glyph height), or too short to hold a dimension pair: dashed wall
    // lines, hatching, and fixture marks — not labels.
    if (glyphHeightFull > 0 &&
        Math.min(box.width, box.height) < 0.6 * glyphHeightFull) continue;
    if (!box.vertical && glyphHeightFull > 0 && box.width < 2.1 * glyphHeightFull) continue;
    if (candidates.some((c) => rowLike(c.bbox) && overlapRatio(c.bbox, box) > 0.4)) continue;
    // Cover-based: a single-row name box fully covering this box vetoes it,
    // but a name box that merely sits INSIDE a taller box (room name with the
    // dimension row clustered underneath) must not veto the dimension row.
    // Height guard: an alpha line whose bbox is 2+ text rows tall has likely
    // swallowed the dimension row under a room name — it must not veto it.
    if (alphaBoxes.some((a) => coverRatio(a, box) > 0.6 && a.height < box.height * 1.8)) continue;
    // Cover-based, not min-area: a small fragment ROI (one number of a split
    // dimension line) must not veto the full-line box that contains it.
    if (rois.some((r) => rowLike(r) && coverRatio(r, box) > 0.65)) continue;

    const long = Math.max(box.width, box.height);
    const short = Math.max(1, Math.min(box.width, box.height));
    const aspect = long / short;
    let priority = 0;
    if (box.glyphCount >= 4 && box.glyphCount <= 20) priority += 2;
    if (aspect >= 2 && aspect <= 14) priority += 2;
    if (glyphHeightFull > 0 && short >= glyphHeightFull * 0.5 && short <= glyphHeightFull * 2.2) priority += 1;
    // Glyph-dense vertical candidates are high-value: the full-page pass
    // cannot read them at all, so the ROI pass is their only chance.
    if (box.vertical) priority += box.glyphCount >= 5 ? 1 : -1;
    // Rescue-pass boxes (glyphs recovered from under underlines/wall
    // fusions) are mostly split-stroke junk — they only get leftover budget
    // so they can never starve a primary box of its read. Boxes hugging the
    // page margin keep their score: that's where balcony/porch name labels
    // sit, and reading those is the rescue pass's whole point.
    if (box.rescued) {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const marginX = fullGray.width * 0.14;
      const marginY = fullGray.height * 0.14;
      const inMargin = cx < marginX || cx > fullGray.width - marginX ||
        cy < marginY || cy > fullGray.height - marginY;
      if (!inMargin) priority -= 3;
    }
    // Floorplan labels put the dimension row directly under the room name:
    // a box hanging just below a recognized name line is very likely a
    // dimension line the full-page pass could not read.
    if (!box.vertical) {
      const underName = alphaBoxes.some((a) => {
        const xOverlap = Math.min(a.x + a.width, box.x + box.width) - Math.max(a.x, box.x);
        return a.y + a.height <= box.y + box.height * 0.5 &&
          box.y - (a.y + a.height) <= box.height * 1.8 &&
          xOverlap >= 0.5 * Math.min(a.width, box.width);
      });
      if (underName) priority += 3;
    }
    pushRoi(box, priority);
  }

  // Room names whose underside strip nothing covers: the dimension row is
  // printed right below the name, but text jammed against walls/door arcs
  // can defeat both the sparse pass and glyph clustering — read the strip
  // under the name on the name's authority alone.
  if (glyphHeightFull > 0) {
    for (const a of alphaBoxes) {
      if (a.height > 2.2 * glyphHeightFull) continue; // multi-row box, already handled
      const strip = {
        x: a.x - a.width * 0.15,
        y: a.y + a.height,
        width: a.width * 1.3,
        height: 1.7 * glyphHeightFull
      };
      if (candidates.some((c) => overlapRatio(c.bbox, strip) > 0.3)) continue;
      if (rois.some((r) => overlapRatio(r, strip) > 0.3)) continue;
      pushRoi({ ...strip, underName: true }, 3);
    }
  }

  // Repetition demotion: ≥4 near-identical boxes stacked at the same x (or y)
  // are structural patterns — window hatching, stair treads — not labels.
  // Proximity matters: hatching repeats within a window span, while two
  // rooms' dimension rows can align at the same x from far across the page.
  for (const roi of rois) {
    const twins = rois.filter((o) =>
      o !== roi &&
      Math.abs(o.width - roi.width) < 8 && Math.abs(o.height - roi.height) < 8 &&
      ((Math.abs(o.x - roi.x) < 4 && Math.abs(o.y - roi.y) < 6 * Math.max(8, roi.height)) ||
       (Math.abs(o.y - roi.y) < 4 && Math.abs(o.x - roi.x) < 6 * Math.max(8, roi.width)))
    );
    if (twins.length >= 3) roi.priority -= 3;
  }

  rois.sort((a, b) => b.priority - a.priority);
  const roiQueueDebug = env.debug
    ? rois.map((r) => ({
      x: Math.round(r.x), y: Math.round(r.y),
      width: Math.round(r.width), height: Math.round(r.height),
      priority: r.priority, vertical: !!r.vertical
    }))
    : null;
  rois.length = Math.min(rois.length, MAX_ROIS);

  // Cold starts (engine download/init) can eat the whole budget inside
  // pass 1. Accuracy first: the targeted ROI phase always gets a minimum
  // window sized to the queue, even if that stretches a run past the soft
  // budget — label-dense plans need the reads more than they need speed.
  const effectiveBudget = Math.max(
    budget,
    elapsed() + Math.min(5200, Math.max(900, 300 + 120 * rois.length))
  );

  // ---- Phase 4: targeted ROI OCR --------------------------------------------
  // Only reserve rescue time when the neural engine is actually warm;
  // otherwise spend the whole budget on Tesseract.
  const paddleAvailable = Boolean(env.refineRois) && env.paddleReady?.() !== false;
  const reserve = paddleAvailable ? PADDLE_RESERVE_MS : 120;
  const failedTiles = [];
  const roiDebug = env.debug ? [] : null;

  const paddleWorthyShape = (roi) =>
    roi.priority < 8 &&
    (roi.priority >= 6 || (roi.vertical && (roi.glyphCount || 0) >= 5));

  const parsedBoxes = [];
  const roiExteriorLabels = [];
  for (let roiIndex = 0; roiIndex < rois.length; roiIndex++) {
    const roi = rois[roiIndex];
    // A successful parse covers its whole neighbourhood — split twins and
    // overlapping duplicates of an already-read label are wasted reads.
    // (Widened rescue re-reads deliberately overlap the parse they are
    // double-checking, and a parse pulled out of a multi-row blob must not
    // suppress the single-row boxes it happens to cover.)
    if (!roi.widened &&
        parsedBoxes.some((b) => rowLike(b) && overlapRatio(b, roi) > 0.5)) continue;
    if (elapsed() > effectiveBudget - reserve - 100) {
      // Out of OCR time — dimension-shaped leftovers still go to the
      // rescue collage (tile prep is cheap JS; only OCR is expensive).
      if (paddleAvailable && failedTiles.length < 10 && paddleWorthyShape(roi)) {
        failedTiles.push({ gray: prepareRoiVariants(roiGray, roi)[0], bbox: roi });
      }
      continue;
    }

    const variants = prepareRoiVariants(roiGray, roi);
    if (env.debug && env.dumpTile) env.dumpTile(roi, variants);

    let bestParsed = null;
    let bestConf = 0;
    let bestVariant = variants[0];
    let digitlessReads = 0;
    let maxDigitsSeen = 0;
    let lastReadDigits = null;
    const reads = [];
    const allParses = [];

    for (let vi = 0; vi < variants.length; vi += 1) {
      const variant = variants[vi];
      if (elapsed() > effectiveBudget - reserve) break;
      // Early exits: a solid confident parse already in hand, or the
      // region is clearly not textual (reads with no digits at all — but a
      // long ladder gets one block-mode try first; see below). A quality-3
      // grade earned by the hyphen-pair convention has no explicit symbols
      // backing it — one tiny-text misread ("55-0" as "6-5") produces the
      // same shape, so it must clear a higher bar to stop the ladder.
      if (bestParsed && bestParsed.quality === 3 &&
          bestConf >= (bestParsed.hyphenUpgraded ? 78 : 55)) break;
      if (bestParsed && bestParsed.quality === 2 && bestConf >= 60) break;
      if (digitlessReads >= (variants.length > 2 ? 3 : 2)) break;

      // Line mode chokes when the crop kept two text rows fused (native row
      // gaps of 1px defeat isolation); from the second zoom pair on, retry
      // in block mode, which reads the rows as separate parseable lines.
      const mode = roi.vertical || (variants.length > 2 && vi >= 2)
        ? 'block' : 'line';
      let read = null;
      try {
        read = await recognizeLine(
          env.toOcrInput(grayToImageDataLike(variant)),
          { mode }
        );
      } catch {
        continue;
      }
      if (roiDebug) reads.push({ text: read.text, confidence: read.confidence });
      // Exterior-feature names the sparse pass missed (text jammed against
      // an underline or tinted background) surface here in the zoomed read.
      const roiKeyword = matchExteriorFeature(read.text);
      if (roiKeyword && read.confidence >= 50) {
        roiExteriorLabels.push({
          keyword: roiKeyword,
          text: read.text,
          bbox: {
            x: Math.round(roi.x),
            y: Math.round(roi.y),
            width: Math.round(roi.width),
            height: Math.round(roi.height)
          }
        });
      }
      const digitsInRead = digitCountOf(read.text);
      if (digitsInRead === 0) digitlessReads++;
      maxDigitsSeen = Math.max(maxDigitsSeen, digitsInRead);

      // Parse each OCR line individually, then the joined text
      const attempts = [...read.lines];
      if (read.lines.length > 1 && read.text) {
        attempts.push({ text: read.text, confidence: read.confidence });
      }
      let variantHadParse = false;
      for (const attempt of attempts) {
        const parsed = attempt.text ? parseDimensionLine(attempt.text, parseOpts) : null;
        if (!parsed) continue;
        allParses.push(parsed);
        // Parse quality outranks engine confidence: a clean explicit-symbol
        // parse from a mid-confidence read beats a confident read whose only
        // parse is a corrupted-symbol reconstruction.
        if (!bestParsed || parsed.quality > bestParsed.quality ||
            (parsed.quality === bestParsed.quality && attempt.confidence > bestConf)) {
          bestParsed = parsed;
          bestConf = attempt.confidence;
          bestVariant = variant;
          variantHadParse = true;
        }
      }
      if (!variantHadParse && !bestParsed && read.confidence > bestConf) {
        bestConf = read.confidence;
        bestVariant = variant;
      }
      // Two reads agreeing on the digits with still no parse means the text
      // is stable and genuinely unparseable (an overall-dimension arrow, a
      // ceiling note) — more zoom levels will read the same thing.
      const readDigits = digitsOf(read.text);
      if (!bestParsed && digitsInRead >= 2 && readDigits === lastReadDigits) break;
      lastReadDigits = readDigits;
    }

    // Independent variants agreeing on the same values corroborate the read
    // the same way a verify pass does — enough to lift a clean-but-shy parse
    // over the acceptance floor.
    if (bestParsed) {
      const agreeing = allParses.filter((p) => valuesMatch(p, bestParsed)).length - 1;
      if (agreeing > 0) bestConf = Math.min(90, bestConf + Math.min(12, agreeing * 6));
    }

    // A hyphen-form side paired with a bare integer usually means the crop
    // clipped the label's leading digits ("8-5x6-6" read as "5x6-6") —
    // queue one wider re-read so the lost prefix is back in frame.
    const originalMixed = roi.priority === 8 &&
      candidates.some((c) => c.mixedPair && overlapRatio(c.bbox, roi) > 0.6);
    if (!roi.widened && !roi.vertical && glyphHeightFull > 0 &&
        (bestParsed?.mixedPair || originalMixed)) {
      const pad = 2.2 * glyphHeightFull;
      // Insert right after this ROI: the rescue read must not starve behind
      // low-priority queue leftovers when the time budget runs down.
      rois.splice(roiIndex + 1, 0, {
        ...roi,
        x: Math.max(0, roi.x - pad),
        width: roi.width + 2 * pad,
        priority: roi.priority,
        widened: true
      });
    }

    if (roiDebug) {
      roiDebug.push({
        bbox: { x: Math.round(roi.x), y: Math.round(roi.y), width: Math.round(roi.width), height: Math.round(roi.height) },
        vertical: !!roi.vertical,
        priority: roi.priority,
        reads,
        parsed: bestParsed ? `${bestParsed.width.toFixed(2)}x${bestParsed.height.toFixed(2)}` : null
      });
    }

    if (bestParsed) {
      const roiBbox = { x: roi.x, y: roi.y, width: roi.width, height: roi.height };
      parsedBoxes.push(roiBbox);

      if (roi.priority === 8) {
        // Verification read: the zoomed, whitelisted re-read double-checks
        // the sparse full-page read of the same region.
        let original = null;
        for (let i = candidates.length - 1; i >= 0; i--) {
          if (overlapRatio(candidates[i].bbox, roiBbox) > 0.6) {
            const c = candidates[i];
            if (!original || c.quality > original.quality ||
                (c.quality === original.quality && c.confidence > original.confidence)) {
              original = c;
            }
            candidates.splice(i, 1);
          }
        }
        const maxOriginal = original ? original.confidence : 0;
        const agrees = original && valuesMatch(original, bestParsed);
        if (original && original.quality > bestParsed.quality) {
          // Zoomed re-reads eat thin tick marks, so a corrupted-symbol
          // reconstruction must not supersede an explicit-symbol original
          // parse. Matching values or digits mean the re-read confirmed the
          // content and only lost the symbols — that raises confidence.
          const confirmed = agrees || digitsOf(original.text) === digitsOf(bestParsed.text);
          const conf = confirmed
            ? Math.min(97, Math.max(maxOriginal, bestConf) + 8)
            : maxOriginal;
          candidates.push({ ...original, confidence: Math.round(conf), source: 'tess-verify' });
        } else if (agrees) {
          const conf = Math.min(97, Math.max(bestConf, maxOriginal) + 8);
          const cand = makeCandidate(bestParsed, roiBbox, conf, 'tess-verify');
          // Two independent reads agreeing on the values is the confirmation
          // itself — don't let the corrupted-symbol penalty (triggered by
          // both reads identically) push a confirmed value below the floor.
          cand.confidence = Math.max(cand.confidence, Math.round(Math.min(90, conf)));
          candidates.push(cand);
        } else {
          // Disagreement: keep whichever read scores better once parse
          // penalties are applied — a garbled re-read ("59\" x90") must not
          // displace a plausible original just because the engine was surer.
          // At equal parse quality the read with more digits wins outright:
          // zoom artifacts fuse glyphs ("55-0" re-read as "6-5"), so OCR
          // loses digits far more often than it invents them.
          const reRead = makeCandidate(
            bestParsed, roiBbox, Math.max(bestConf + 4, maxOriginal - 4), 'tess-verify'
          );
          const digitEdge = original
            ? digitsOf(original.text).length - digitsOf(bestParsed.text).length
            : 0;
          let winner = original && (original.quality === bestParsed.quality
            ? digitEdge >= 0
            : original.confidence > reRead.confidence)
            ? { ...original, source: 'tess-verify' }
            : reRead;
          // A suspect clipped read (mixed hyphen/bare pair) that even the
          // widened rescue re-read could not confirm is a wrong value more
          // often than a right one — sink it below the acceptance floor.
          if (roi.widened && winner.mixedPair) {
            winner = { ...winner, confidence: Math.min(winner.confidence, MIN_CONFIDENCE - 5) };
          }
          candidates.push(winner);
          // Neither read is trustworthy: this label is exactly what the
          // neural rescue pass is for.
          if (winner.confidence < MIN_CONFIDENCE && paddleAvailable &&
              failedTiles.length < 10) {
            failedTiles.push({ gray: bestVariant, bbox: roi });
          }
        }
      } else {
        candidates.push(makeCandidate(bestParsed, roiBbox, bestConf, 'tess-roi'));
      }
    } else if (roi.priority === 8) {
      // Verification re-read failed outright; when the original parse is weak
      // enough to be filtered later anyway, give the neural pass a shot.
      const original = candidates.find((c) => overlapRatio(c.bbox, roi) > 0.6);
      // Even the widened rescue re-read saw nothing where a suspect clipped
      // read (mixed hyphen/bare pair) claimed a value — sink the original.
      if (roi.widened && original && original.mixedPair) {
        original.confidence = Math.min(original.confidence, MIN_CONFIDENCE - 5);
      }
      if ((!original || original.confidence < MIN_CONFIDENCE) && paddleAvailable &&
          maxDigitsSeen >= 2 && failedTiles.length < 10) {
        failedTiles.push({ gray: bestVariant, bbox: roi });
      }
    } else if (roi.priority >= 2) {
      // Only regions with number-ish evidence are worth the neural pass:
      // Tesseract saw digits, a strip under a room name (a dimension row
      // lives there even when Tesseract reads none of it), or a glyph-dense
      // vertical label whose rotated reads garbled entirely.
      const paddleWorthy =
        maxDigitsSeen >= 2 || roi.underName ||
        (roi.vertical && (roi.glyphCount || 0) >= 5);
      if (paddleWorthy) failedTiles.push({ gray: bestVariant, bbox: roi });
    }
  }
  for (const label of roiExteriorLabels) {
    if (exteriorLabels.some((l) => overlapRatio(l.bbox, label.bbox) > 0.5)) continue;
    exteriorLabels.push(label);
  }
  timings.roi = elapsed() - timings.preprocess - timings.spatial - timings.pass1;

  // ---- Phase 5: neural rescue (PaddleOCR collage) ---------------------------
  if (env.refineRois && failedTiles.length > 0 &&
      elapsed() < effectiveBudget - PADDLE_RESERVE_MS) {
    try {
      // Hard deadline: if the GPU pass overruns, stop waiting and ship what
      // we have (the stray promise resolves harmlessly in the background).
      const remaining = Math.max(200, effectiveBudget - elapsed() - 80);
      const refined = await Promise.race([
        env.refineRois(failedTiles),
        new Promise((resolve) => setTimeout(() => resolve([]), remaining))
      ]);
      for (const { tileIndex, text } of refined || []) {
        const tile = failedTiles[tileIndex];
        if (!tile || !text) continue;
        const parsed = parseDimensionLine(text, parseOpts);
        if (!parsed) continue;
        const bbox = {
          x: tile.bbox.x, y: tile.bbox.y,
          width: tile.bbox.width, height: tile.bbox.height
        };
        candidates.push(makeCandidate(parsed, bbox, 0, 'paddle'));
      }
    } catch {
      // rescue pass is best-effort
    }
  }
  timings.paddle = elapsed() - timings.preprocess - timings.spatial - timings.pass1 - timings.roi;

  // ---- Phase 6: merge & score -----------------------------------------------
  const deduped = dedupeCandidates(candidates).filter((c) => c.confidence >= MIN_CONFIDENCE);

  const dimensions = deduped.map((c, idx) => ({
    width: c.width,
    height: c.height,
    // Canonical text from the parsed values — raw OCR reads can be garbled
    // ("125x164\"") even when the values parsed correctly. Raw read kept
    // in ocrText for debugging.
    text: formatDimensionText(c.width, c.height, c.format),
    ocrText: c.text,
    bbox: c.bbox
      ? {
          x: Math.round(c.bbox.x),
          y: Math.round(c.bbox.y),
          width: Math.round(c.bbox.width),
          height: Math.round(c.bbox.height)
        }
      : {
          x: Math.round(fullGray.width / 2 - 100),
          y: Math.round(fullGray.height * 0.3 + idx * 80),
          width: 200,
          height: 50
        },
    confidence: c.confidence,
    format: c.format
  }));

  timings.total = elapsed();

  const result = {
    dimensions,
    exteriorLabels,
    detectedFormat: inferDominantFormat(dimensions),
    timings
  };
  if (env.debug) {
    result.debug = {
      rois: roiDebug,
      roiQueue: roiQueueDebug,
      glyphHeightFull,
      spatialGlyphHeight: regions.glyphHeight / toFull,
      alphaBoxes: alphaBoxes.map((b) => ({
        x: Math.round(b.x), y: Math.round(b.y),
        width: Math.round(b.width), height: Math.round(b.height)
      })),
      spatialBoxes: spatialBoxes.map((b) => ({
        x: Math.round(b.x), y: Math.round(b.y),
        width: Math.round(b.width), height: Math.round(b.height),
        glyphCount: b.glyphCount, vertical: b.vertical
      })),
      pass1Lines: lines
        .map((l) => ({ text: lineText(l), conf: Math.round(meanWordConfidence(l)) }))
        .filter((l) => /\d/.test(l.text))
    };
  }
  return result;
};
