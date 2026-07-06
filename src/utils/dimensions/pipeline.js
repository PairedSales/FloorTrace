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
  scaleGray, cropGray, rotateGray90, stretchGray, addBorder, binarizeGray
} from './raster.js';
import { findTextRegions } from './regions.js';
import { recognizeSparse, recognizeLine, lineText } from './ocrTesseract.js';
import { loadOpenCv, openCvIfReady, enhanceGrayWithCv, estimateSpeckle } from './opencvBridge.js';

const DEFAULT_BUDGET_MS = 2600;
const MAX_OCR_DIM = 2600;      // full-page OCR working size cap
const UPSCALE_BELOW = 1800;    // upscale small scans: tiny glyphs kill OCR
const ANALYSIS_DIM = 1400;     // spatial-analysis working size cap
const TARGET_GLYPH_PX = 36;    // ROI zoom target text height for Tesseract
const MAX_ROIS = 16;
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
    source
  };
};

const dedupeCandidates = (candidates) => {
  const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
  const kept = [];
  for (const c of sorted) {
    const dup = kept.some((k) => {
      const ov = overlapRatio(k.bbox, c.bbox);
      if (ov > 0.6) return true;               // same text region, keep best read
      return ov > 0.25 && valuesMatch(k, c);   // same values in the same spot
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
const bandWords = (words, scale) => {
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
    const parsed = parseDimensionLine(text);
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
const prepareRoiVariants = (fullGray, roi) => {
  // Cross-axis padding stays tight so the crop doesn't swallow a
  // neighbouring text row/column; along-axis padding is generous so
  // clipped leading/trailing glyphs are recovered.
  const padX = roi.vertical ? roi.width * 0.08 + 2 : roi.width * 0.12 + 6;
  const padY = roi.vertical ? roi.height * 0.3 + 4 : roi.height * 0.45 + 4;
  const crop = cropGray(
    fullGray,
    roi.x - padX, roi.y - padY,
    roi.width + padX * 2, roi.height + padY * 2
  );

  const textHeight = roi.vertical ? roi.width : roi.height;
  const zoom = Math.max(1, Math.min(4, TARGET_GLYPH_PX / Math.max(8, textHeight)));

  let zoomed = stretchGray(crop);
  if (zoom > 1.05) zoomed = scaleGray(zoomed, zoom);

  const MARGIN = 16;
  if (roi.vertical) {
    const binary = binarizeGray(zoomed);
    const sharp = unsharp(zoomed, 1.1);
    return [
      addBorder(rotateGray90(binary, 1), MARGIN),
      addBorder(rotateGray90(binary, -1), MARGIN),
      addBorder(rotateGray90(sharp, 1), MARGIN),
      addBorder(rotateGray90(sharp, -1), MARGIN)
    ];
  }
  return [
    addBorder(unsharp(zoomed, 1.1), MARGIN),
    addBorder(binarizeGray(zoomed), MARGIN)
  ];
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
      glyphCount: b.glyphCount, vertical: false
    })),
    ...regions.vertical.map((b) => ({
      x: b.x / toFull, y: b.y / toFull,
      width: b.width / toFull, height: b.height / toFull,
      glyphCount: b.glyphCount, vertical: true
    }))
  ];
  const glyphHeightFull = regions.glyphHeight / toFull;
  timings.spatial = elapsed() - timings.preprocess;

  const { lines, words } = await pass1Promise;
  timings.pass1 = elapsed() - timings.preprocess - timings.spatial;

  // Cold starts (engine download/init) can eat the whole budget inside
  // pass 1. Accuracy first: the targeted ROI phase always gets a minimum
  // window, even if that stretches a first-ever run past the soft budget.
  const effectiveBudget = Math.max(budget, elapsed() + 900);

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

    const parsed = parseDimensionLine(raw);
    if (parsed) {
      candidates.push(makeCandidate(parsed, bbox, conf, 'tess-full'));
    } else if (digits >= 2 && conf > 15 && bbox) {
      digitLineRois.push(bbox);
    } else if (digits === 0 && conf > 40 && /[a-z]{3,}/i.test(raw) && bbox) {
      alphaBoxes.push(bbox); // room names / titles — veto spatial ROIs here
    }
  }

  for (const bandCandidate of bandWords(words, ocrScale)) {
    if (!candidates.some((c) => overlapRatio(c.bbox, bandCandidate.bbox) > 0.4)) {
      candidates.push(bandCandidate);
    }
  }

  // ---- Assemble prioritized ROI list ---------------------------------------
  const rois = [];

  // Verification re-reads: low-confidence accepted candidates get a zoomed
  // second opinion (their bbox is known-good; the values may not be).
  for (const c of candidates) {
    if (c.confidence >= 90 || !c.bbox) continue;
    rois.push({ ...c.bbox, vertical: c.bbox.height > c.bbox.width * 1.6, priority: 8 });
  }

  for (const bbox of digitLineRois) {
    if (candidates.some((c) => overlapRatio(c.bbox, bbox) > 0.4)) continue;
    rois.push({ ...bbox, vertical: bbox.height > bbox.width * 1.6, priority: 6 });
  }

  for (const box of spatialBoxes) {
    if (candidates.some((c) => overlapRatio(c.bbox, box) > 0.4)) continue;
    if (alphaBoxes.some((a) => overlapRatio(a, box) > 0.6)) continue;
    if (rois.some((r) => overlapRatio(r, box) > 0.5)) continue;

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
    rois.push({ ...box, priority });
  }

  // Repetition demotion: ≥3 near-identical boxes stacked at the same x (or y)
  // are structural patterns — window hatching, stair treads — not labels.
  for (const roi of rois) {
    const twins = rois.filter((o) =>
      o !== roi &&
      Math.abs(o.width - roi.width) < 8 && Math.abs(o.height - roi.height) < 8 &&
      (Math.abs(o.x - roi.x) < 4 || Math.abs(o.y - roi.y) < 4)
    );
    if (twins.length >= 2) roi.priority -= 3;
  }

  rois.sort((a, b) => b.priority - a.priority);
  rois.length = Math.min(rois.length, MAX_ROIS);

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

  for (const roi of rois) {
    if (elapsed() > effectiveBudget - reserve - 100) {
      // Out of OCR time — dimension-shaped leftovers still go to the
      // rescue collage (tile prep is cheap JS; only OCR is expensive).
      if (paddleAvailable && failedTiles.length < 10 && paddleWorthyShape(roi)) {
        failedTiles.push({ gray: prepareRoiVariants(fullGray, roi)[0], bbox: roi });
      }
      continue;
    }

    const variants = prepareRoiVariants(fullGray, roi);

    let bestParsed = null;
    let bestConf = 0;
    let bestVariant = variants[0];
    let digitlessReads = 0;
    let maxDigitsSeen = 0;
    const reads = [];

    for (const variant of variants) {
      if (elapsed() > effectiveBudget - reserve) break;
      // Early exits: a solid parse already in hand, or the region is
      // clearly not textual (two reads with no digits at all).
      if (bestParsed && bestConf >= 55) break;
      if (digitlessReads >= 2) break;

      let read = null;
      try {
        read = await recognizeLine(
          env.toOcrInput(grayToImageDataLike(variant)),
          { mode: roi.vertical ? 'block' : 'line' }
        );
      } catch {
        continue;
      }
      if (roiDebug) reads.push({ text: read.text, confidence: read.confidence });
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
        const parsed = attempt.text ? parseDimensionLine(attempt.text) : null;
        if (parsed && (!bestParsed || attempt.confidence > bestConf)) {
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

      if (roi.priority === 8) {
        // Verification read: the zoomed, whitelisted re-read supersedes the
        // sparse full-page read of the same region. Agreement raises
        // confidence; disagreement trusts the re-read but caps it.
        let maxOriginal = 0;
        let agrees = false;
        for (let i = candidates.length - 1; i >= 0; i--) {
          if (overlapRatio(candidates[i].bbox, roiBbox) > 0.6) {
            maxOriginal = Math.max(maxOriginal, candidates[i].confidence);
            if (valuesMatch(candidates[i], bestParsed)) agrees = true;
            candidates.splice(i, 1);
          }
        }
        const conf = agrees
          ? Math.min(97, Math.max(bestConf, maxOriginal) + 8)
          : Math.max(bestConf + 4, maxOriginal - 4);
        candidates.push(makeCandidate(bestParsed, roiBbox, conf, 'tess-verify'));
      } else {
        candidates.push(makeCandidate(bestParsed, roiBbox, bestConf, 'tess-roi'));
      }
    } else if (roi.priority >= 2 && roi.priority < 8) {
      // Only regions with number-ish evidence are worth the neural pass:
      // Tesseract saw digits, or it's a glyph-dense vertical label whose
      // rotated reads garbled entirely (the classic Paddle-rescue case).
      const paddleWorthy =
        maxDigitsSeen >= 2 || (roi.vertical && (roi.glyphCount || 0) >= 5);
      if (paddleWorthy) failedTiles.push({ gray: bestVariant, bbox: roi });
    }
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
        const parsed = parseDimensionLine(text);
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
