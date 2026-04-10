import Tesseract from 'tesseract.js';
import { dataUrlToImage } from './imageLoader';
import {
  toGrayscale,
  otsuThreshold,
  contrastStretch,
  grayToThresholdedCanvas
} from './imagePreprocessor';

const MIN_DIMENSION_FEET = 1;
const MAX_DIMENSION_FEET = 250;
const MIN_WORD_CONFIDENCE = 25;

// ---------------------------------------------------------------------------
// Image scaling – only downscale images that are very large; never upscale
// ---------------------------------------------------------------------------

const estimateScaleFactor = (img) => {
  const maxDim = Math.max(img.width, img.height);
  if (maxDim <= 3000) return 1.0;
  return 3000 / maxDim;
};

const scaleCanvas = (img, factor) => {
  const w = Math.round(img.width * factor);
  const h = Math.round(img.height * factor);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
};

// ---------------------------------------------------------------------------
// Preprocessing: build multiple image variants for multi-pass OCR
// ---------------------------------------------------------------------------

/**
 * Apply an inverted threshold: black text on white → white text on black.
 * Tesseract can sometimes read inverted text better in noisy environments.
 */
const grayToInvertedThresholdedCanvas = (gray, width, height, threshold) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(width, height);
  const d = out.data;

  for (let i = 0; i < gray.length; i++) {
    const v = gray[i] < threshold ? 255 : 0;
    const j = i * 4;
    d[j] = v;
    d[j + 1] = v;
    d[j + 2] = v;
    d[j + 3] = 255;
  }

  ctx.putImageData(out, 0, 0);
  return canvas;
};

/**
 * Apply a high-contrast sharpening pass via unsharp-mask style approach.
 * Boost local contrast around edges (text boundaries) to make faint
 * apostrophes / quote marks more visible to OCR.
 */
const sharpenGray = (gray, width, height) => {
  const result = new Uint8Array(gray.length);
  const strength = 0.5;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      // Simple 3x3 Laplacian for edge detection
      const lap =
        -gray[(y - 1) * width + x] -
        gray[y * width + (x - 1)] +
        4 * gray[idx] -
        gray[y * width + (x + 1)] -
        gray[(y + 1) * width + x];
      const sharpened = gray[idx] + strength * lap;
      result[idx] = Math.max(0, Math.min(255, Math.round(sharpened)));
    }
  }

  // Copy borders
  for (let x = 0; x < width; x++) {
    result[x] = gray[x];
    result[(height - 1) * width + x] = gray[(height - 1) * width + x];
  }
  for (let y = 0; y < height; y++) {
    result[y * width] = gray[y * width];
    result[y * width + width - 1] = gray[y * width + width - 1];
  }

  return result;
};

const buildVariants = (img) => {
  const factor = estimateScaleFactor(img);
  const scaled = scaleCanvas(img, factor);
  const ctx = scaled.getContext('2d');
  const imageData = ctx.getImageData(0, 0, scaled.width, scaled.height);
  const gray = toGrayscale(imageData);
  const stretched = contrastStretch(gray);
  const otsu = otsuThreshold(stretched);
  const sharpened = sharpenGray(stretched, scaled.width, scaled.height);
  const sharpOtsu = otsuThreshold(sharpened);

  const variants = [];

  // V1 – original (scaled or unmodified)
  variants.push({ name: 'original', canvas: scaled });

  // V2 – Otsu thresholded (handles varying contrast / lower-resolution scans)
  variants.push({
    name: 'otsu',
    canvas: grayToThresholdedCanvas(stretched, scaled.width, scaled.height, otsu)
  });

  // V3 – Sharpened + threshold: helps recover faint apostrophes / inch marks
  variants.push({
    name: 'sharp-otsu',
    canvas: grayToThresholdedCanvas(sharpened, scaled.width, scaled.height, sharpOtsu)
  });

  // V4 – Inverted: white-on-black can help Tesseract with low-contrast labels
  variants.push({
    name: 'inverted',
    canvas: grayToInvertedThresholdedCanvas(stretched, scaled.width, scaled.height, otsu)
  });

  return { variants, scaleFactor: factor, width: scaled.width, height: scaled.height, gray: stretched };
};

// ---------------------------------------------------------------------------
// OCR text normalisation
// ---------------------------------------------------------------------------

const normalizeOcrText = (text) => {
  if (!text) return '';

  let s = text;

  // Unicode multiplications / separators → lowercase x
  s = s.replace(/[\u00D7\u2715\u2716\u00D8]/g, 'x');
  s = s.replace(/\b(?:by|BY|By)\b/g, 'x');

  // Smart / curly quotes → straight
  s = s.replace(/[\u2018\u2019\u02BC\u0060\u00B4]/g, "'");
  s = s.replace(/[\u201C\u201D\u02DD]/g, '"');
  s = s.replace(/''/g, '"');

  // Lowercase everything: normalises X→x, Ft→ft, IN→in, etc.
  s = s.toLowerCase();

  // Common OCR char swaps near digits (applied after lowercase).
  // Negative lookahead (?![a-z]) prevents swapping the 'i' in unit
  // keywords like "in", "inch", "inches" or the 'l' in "left", etc.
  s = s.replace(/([0-9])[li|](?![a-z])/g, '$11');
  s = s.replace(/[li|](?![a-z])([0-9])/g, '1$1');
  s = s.replace(/([0-9])o(?=\s|'|"|$)/g, '$10');
  s = s.replace(/(?:^|\s)o([0-9])/g, ' 0$1');
  // Handle o→0 after quote marks in dimension context: 12'o" → 12'0"
  s = s.replace(/(['"])o(?=\s|'|"|$)/g, '$10');
  s = s.replace(/([0-9])s([0-9])/g, '$15$2');
  s = s.replace(/([0-9])b([0-9])/g, '$18$2');
  s = s.replace(/([0-9])z([0-9])/g, '$12$2');

  // Pipes that look like 1
  s = s.replace(/\|/g, '1');

  // Dashes
  s = s.replace(/[\u2013\u2014\u2212]/g, '-');

  // Ensure a space between a digit and a unit keyword so downstream
  // regexes don't need to handle both "1.2ft" and "1.2 ft".
  s = s.replace(/(\d)(ft|feet|in)\b/g, '$1 $2');
  s = s.replace(/\b(ft|feet|in)(\d)/g, '$1 $2');

  // Collapse whitespace
  s = s.replace(/\s+/g, ' ');

  return s.trim();
};

// ---------------------------------------------------------------------------
// Dimension parsing – flexible, handles mangled symbols
// ---------------------------------------------------------------------------

const isReasonable = (v) => Number.isFinite(v) && v >= MIN_DIMENSION_FEET && v <= MAX_DIMENSION_FEET;

// After normalizeOcrText the separator is always lowercase 'x'; keep [xX] as
// a safety net in case parseSingleToken is called with un-normalised input.
const SEPARATOR = /\s*[xX]\s*/;

const parseSingleToken = (token) => {
  // Light normalisation so callers don't have to pre-normalise.
  const t = normalizeOcrText(token);

  // ------------------------------------------------------------------
  // Case A: feet + inches with apostrophe/tick  →  4'5"  10' 2"  12'5
  // ------------------------------------------------------------------
  const feetInches = t.match(/^(\d{1,3})\s*'\s*-?\s*(\d{1,2})\s*"?\s*$/);
  if (feetInches) {
    const feet = parseInt(feetInches[1], 10);
    const inches = parseInt(feetInches[2], 10);
    if (inches < 12) {
      const val = feet + inches / 12;
      if (isReasonable(val)) return { value: val, format: 'inches' };
    }
  }

  // Case A: feet-only with tick  →  12'
  const feetOnly = t.match(/^(\d{1,3})\s*'\s*$/);
  if (feetOnly) {
    const val = parseInt(feetOnly[1], 10);
    if (isReasonable(val)) return { value: val, format: 'inches' };
  }

  // ------------------------------------------------------------------
  // Case B: decimal feet  →  1.2  1.2ft  12.75 ft  1.2'
  // Requires a decimal point so it is unambiguous from bare integers.
  // ------------------------------------------------------------------
  const decimalFt = t.match(/^(\d{1,3}\.\d+)\s*(?:ft|feet|')?\s*$/);
  if (decimalFt) {
    const val = parseFloat(decimalFt[1]);
    if (isReasonable(val)) return { value: val, format: 'decimal' };
  }

  // Case B: integer + explicit "ft" / "feet" keyword  →  12 ft  12ft
  const intFt = t.match(/^(\d{1,3})\s*(?:ft|feet)\s*$/);
  if (intFt) {
    const val = parseInt(intFt[1], 10);
    if (isReasonable(val)) return { value: val, format: 'decimal' };
  }

  // ------------------------------------------------------------------
  // Case C: explicit ft/in keywords  →  1 ft 3 in  2 feet 6 in
  // ------------------------------------------------------------------
  const explicitFtIn = t.match(/^(\d{1,3})\s*(?:ft|feet)\s+(\d{1,2})\s*(?:in|inch|inches)?\s*$/);
  if (explicitFtIn) {
    const feet = parseInt(explicitFtIn[1], 10);
    const inches = parseInt(explicitFtIn[2], 10);
    if (inches < 12) {
      const val = feet + inches / 12;
      if (isReasonable(val)) return { value: val, format: 'inches' };
    }
  }

  // ------------------------------------------------------------------
  // Case D: blurry / missing symbols – OCR could not read ' or "
  //
  // D1: space-separated pair  →  "10 2"  (was 10' 2")
  //     Accept only when the second number is plausibly inches (< 12).
  // ------------------------------------------------------------------
  const spacedPair = t.match(/^(\d{1,3})\s+(\d{1,2})$/);
  if (spacedPair) {
    const a = parseInt(spacedPair[1], 10);
    const b = parseInt(spacedPair[2], 10);
    if (b < 12 && isReasonable(a + b / 12)) {
      return { value: a + b / 12, format: 'inches' };
    }
  }

  // D2: 3-4 digit bare integer  →  "102" (was 10'2"),  "134" (was 13'4")
  //     Interpretation: leading digits = feet, trailing digit(s) = inches.
  //     Try last-2 digits for 4-digit numbers first (e.g. 1210 → 12ft 10in).
  const noisyOcr = t.match(/^(\d{3,4})$/);
  if (noisyOcr) {
    const num = noisyOcr[1];
    if (num.length === 4) {
      const lastTwo = parseInt(num.slice(-2), 10);
      const ftPart = parseInt(num.slice(0, -2), 10);
      if (lastTwo < 12 && isReasonable(ftPart + lastTwo / 12)) {
        return { value: ftPart + lastTwo / 12, format: 'inches' };
      }
    }
    const lastOne = parseInt(num.slice(-1), 10);
    const ftPart = parseInt(num.slice(0, -1), 10);
    if (lastOne < 12 && isReasonable(ftPart + lastOne / 12)) {
      return { value: ftPart + lastOne / 12, format: 'inches' };
    }
    // Inches digit was ≥ 12 (e.g. "139") – fall back to plain feet.
    const plain = parseInt(num, 10);
    if (isReasonable(plain)) return { value: plain, format: 'decimal' };
  }

  // ------------------------------------------------------------------
  // Plain 1-2 digit integer  →  12  10  (treat as whole feet)
  // ------------------------------------------------------------------
  const plainFt = t.match(/^(\d{1,2})$/);
  if (plainFt) {
    const val = parseInt(plainFt[1], 10);
    if (isReasonable(val)) return { value: val, format: 'decimal' };
  }

  return null;
};

const parseDimensionLine = (line) => {
  const norm = normalizeOcrText(line);

  // --- Strategy 1: split on x separator (handles both 'x' and 'X') -------
  const sepMatch = norm.match(SEPARATOR);
  if (sepMatch) {
    const left = norm.slice(0, sepMatch.index).trim();
    const right = norm.slice(sepMatch.index + sepMatch[0].length).trim();
    if (left && right) {
      const lp = parseSingleToken(left);
      const rp = parseSingleToken(right);
      if (lp && rp) {
        return {
          width: lp.value,
          height: rp.value,
          text: norm,
          format: lp.format === 'inches' || rp.format === 'inches' ? 'inches' : 'decimal'
        };
      }
    }
  }

  // --- Strategy 2: two feet-inches groups without explicit x separator ----
  const twoFi = norm.match(
    /(\d{1,3})\s*'\s*-?\s*(\d{1,2})\s*"?\s{1,}(\d{1,3})\s*'\s*-?\s*(\d{1,2})\s*"?/
  );
  if (twoFi) {
    const w = parseInt(twoFi[1], 10) + parseInt(twoFi[2], 10) / 12;
    const h = parseInt(twoFi[3], 10) + parseInt(twoFi[4], 10) / 12;
    if (isReasonable(w) && isReasonable(h)) {
      return { width: w, height: h, text: twoFi[0], format: 'inches' };
    }
  }

  // --- Strategy 3: decimal ft … decimal ft (no x, both sides have "ft") --
  const decFt = norm.match(
    /(\d{1,3}(?:\.\d+)?)\s*(?:ft|feet)\s+(\d{1,3}(?:\.\d+)?)\s*(?:ft|feet)/
  );
  if (decFt) {
    const w = parseFloat(decFt[1]);
    const h = parseFloat(decFt[2]);
    if (isReasonable(w) && isReasonable(h)) {
      return { width: w, height: h, text: decFt[0], format: 'decimal' };
    }
  }

  return null;
};

// ---------------------------------------------------------------------------
// Collect OCR structural data
// ---------------------------------------------------------------------------

const collectLinesAndWords = (result) => {
  const lines = [];
  const words = [];
  if (!result?.data?.blocks) return { lines, words };

  for (const block of result.data.blocks) {
    if (!block.paragraphs) continue;
    for (const para of block.paragraphs) {
      if (!para.lines) continue;
      for (const line of para.lines) {
        lines.push(line);
        if (line.words) words.push(...line.words);
      }
    }
  }
  return { lines, words };
};

// ---------------------------------------------------------------------------
// Region-of-interest (ROI) detection
//
// Instead of only scanning the full image, we identify likely dimension
// regions by looking at where Tesseract found digit-containing words in
// the first pass.  We then crop generous sub-images around those clusters
// and run a second targeted OCR pass on each ROI with different
// preprocessing / PSM settings.
// ---------------------------------------------------------------------------

/**
 * Cluster digit-containing bounding boxes into ROI rectangles.
 * Words on the same horizontal band and within a reasonable gap are
 * merged into a single ROI.
 */
const clusterDigitRegions = (words, imgWidth, imgHeight) => {
  const digitWords = [];
  for (const word of words) {
    if (!word.text || !word.bbox) continue;
    if (word.confidence < MIN_WORD_CONFIDENCE) continue;
    const t = normalizeOcrText(word.text);
    if (/\d/.test(t)) {
      digitWords.push({
        text: t,
        bbox: word.bbox,
        confidence: word.confidence
      });
    }
  }

  if (digitWords.length === 0) return [];

  // Sort by vertical center, then horizontal position
  digitWords.sort((a, b) => {
    const aCy = (a.bbox.y0 + a.bbox.y1) / 2;
    const bCy = (b.bbox.y0 + b.bbox.y1) / 2;
    if (Math.abs(aCy - bCy) > 20) return aCy - bCy;
    return a.bbox.x0 - b.bbox.x0;
  });

  const clusters = [];
  const used = new Set();

  for (let i = 0; i < digitWords.length; i++) {
    if (used.has(i)) continue;
    const cluster = [digitWords[i]];
    used.add(i);

    for (let j = i + 1; j < digitWords.length; j++) {
      if (used.has(j)) continue;

      // Check if j is on the same horizontal band as the cluster
      const clusterMinY = Math.min(...cluster.map(w => w.bbox.y0));
      const clusterMaxY = Math.max(...cluster.map(w => w.bbox.y1));
      const jCy = (digitWords[j].bbox.y0 + digitWords[j].bbox.y1) / 2;
      const bandH = clusterMaxY - clusterMinY;
      const tolerance = Math.max(bandH * 1.5, 30);

      if (jCy < clusterMinY - tolerance || jCy > clusterMaxY + tolerance) continue;

      // Check horizontal proximity
      const clusterMaxX = Math.max(...cluster.map(w => w.bbox.x1));
      const gap = digitWords[j].bbox.x0 - clusterMaxX;
      const avgCharW = cluster.reduce((s, w) => {
        return s + (w.bbox.x1 - w.bbox.x0) / Math.max(w.text.length, 1);
      }, 0) / cluster.length;

      if (gap < avgCharW * 25) {
        cluster.push(digitWords[j]);
        used.add(j);
      }
    }

    clusters.push(cluster);
  }

  // Convert clusters to padded ROI rectangles
  const padding = Math.max(imgWidth, imgHeight) * 0.02;
  const rois = clusters.map(cl => {
    const x0 = Math.max(0, Math.min(...cl.map(w => w.bbox.x0)) - padding);
    const y0 = Math.max(0, Math.min(...cl.map(w => w.bbox.y0)) - padding);
    const x1 = Math.min(imgWidth, Math.max(...cl.map(w => w.bbox.x1)) + padding);
    const y1 = Math.min(imgHeight, Math.max(...cl.map(w => w.bbox.y1)) + padding);
    return {
      x: Math.round(x0),
      y: Math.round(y0),
      width: Math.round(x1 - x0),
      height: Math.round(y1 - y0),
      words: cl
    };
  });

  // Filter out tiny ROIs that are likely noise
  return rois.filter(r => r.width > 20 && r.height > 10);
};

/**
 * Crop a region from a canvas, returning a new canvas.
 */
const cropCanvas = (sourceCanvas, roi) => {
  const canvas = document.createElement('canvas');
  canvas.width = roi.width;
  canvas.height = roi.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(
    sourceCanvas,
    roi.x, roi.y, roi.width, roi.height,
    0, 0, roi.width, roi.height
  );
  return canvas;
};

// ---------------------------------------------------------------------------
// Digit-first spatial detection
// ---------------------------------------------------------------------------

const buildDigitGroups = (words) => {
  const groups = [];
  for (const word of words) {
    if (!word.text || !word.bbox) continue;
    if (word.confidence < MIN_WORD_CONFIDENCE) continue;
    const t = normalizeOcrText(word.text);
    if (/\d/.test(t)) {
      groups.push({
        text: t,
        bbox: word.bbox,
        confidence: word.confidence
      });
    }
  }
  return groups;
};

const horizontalBand = (a, b) => {
  const aCy = (a.bbox.y0 + a.bbox.y1) / 2;
  const bCy = (b.bbox.y0 + b.bbox.y1) / 2;
  const aH = a.bbox.y1 - a.bbox.y0;
  const bH = b.bbox.y1 - b.bbox.y0;
  const tolerance = Math.max(aH, bH) * 1.2;
  return Math.abs(aCy - bCy) < tolerance;
};

const tryParsePairFromWords = (wordGroup) => {
  const combined = wordGroup.map(w => w.text).join(' ');
  return parseDimensionLine(combined);
};

const detectFromSpatialWords = (words) => {
  const digits = buildDigitGroups(words);
  if (digits.length < 2) return [];

  const results = [];
  const used = new Set();

  for (let i = 0; i < digits.length; i++) {
    if (used.has(i)) continue;

    const band = [digits[i]];
    const bandIndices = [i];

    for (let j = i + 1; j < digits.length; j++) {
      if (used.has(j)) continue;
      if (!horizontalBand(digits[i], digits[j])) continue;

      const gap = digits[j].bbox.x0 - digits[band.length - 1].bbox.x1;
      const charW = (digits[i].bbox.x1 - digits[i].bbox.x0) / Math.max(digits[i].text.length, 1);
      if (gap > charW * 30) continue;

      band.push(digits[j]);
      bandIndices.push(j);
    }

    if (band.length >= 2) {
      const parsed = tryParsePairFromWords(band);
      if (parsed) {
        const minX = Math.min(...band.map(w => w.bbox.x0));
        const minY = Math.min(...band.map(w => w.bbox.y0));
        const maxX = Math.max(...band.map(w => w.bbox.x1));
        const maxY = Math.max(...band.map(w => w.bbox.y1));
        results.push({
          ...parsed,
          bbox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
          confidence: band.reduce((s, w) => s + w.confidence, 0) / band.length
        });
        bandIndices.forEach(idx => used.add(idx));
      }
    }
  }

  return results;
};

// ---------------------------------------------------------------------------
// Line-level detection (traditional: parse each OCR line)
// ---------------------------------------------------------------------------

const detectFromLines = (lines) => {
  const results = [];
  const seen = new Set();

  for (const line of lines) {
    const rawText = line.words ? line.words.map(w => w.text).join(' ') : (line.text || '');
    const norm = normalizeOcrText(rawText);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);

    const parsed = parseDimensionLine(norm);
    if (!parsed) continue;

    const bbox = line.bbox
      ? { x: line.bbox.x0, y: line.bbox.y0, width: line.bbox.x1 - line.bbox.x0, height: line.bbox.y1 - line.bbox.y0 }
      : null;

    const avgConf = line.words
      ? line.words.reduce((s, w) => s + (w.confidence || 0), 0) / line.words.length
      : 50;

    results.push({ ...parsed, bbox, confidence: avgConf });
  }

  return results;
};

// ---------------------------------------------------------------------------
// Deduplication: merge results with similar values and overlapping bboxes
// ---------------------------------------------------------------------------

const bboxOverlap = (a, b) => {
  if (!a || !b) return false;
  const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const overlapArea = overlapX * overlapY;
  const aArea = a.width * a.height;
  const bArea = b.width * b.height;
  const minArea = Math.min(aArea, bArea);
  return minArea > 0 && overlapArea / minArea > 0.3;
};

/**
 * Check if two bboxes are close (within a tolerance) even if they don't
 * literally overlap.  This catches near-duplicate reads from different
 * preprocessing variants whose bboxes are slightly offset.
 */
const bboxNearby = (a, b) => {
  if (!a || !b) return false;
  // Check if centers are close relative to their sizes
  const aCx = a.x + a.width / 2;
  const aCy = a.y + a.height / 2;
  const bCx = b.x + b.width / 2;
  const bCy = b.y + b.height / 2;
  const maxW = Math.max(a.width, b.width);
  const maxH = Math.max(a.height, b.height);
  return Math.abs(aCx - bCx) < maxW * 0.8 && Math.abs(aCy - bCy) < maxH * 1.2;
};

const valuesClose = (a, b, tolerance = 0.08) => {
  const wDiff = Math.abs(a.width - b.width) / Math.max(a.width, 1);
  const hDiff = Math.abs(a.height - b.height) / Math.max(a.height, 1);
  return wDiff < tolerance && hDiff < tolerance;
};

/**
 * Enhanced deduplication that considers spatial proximity AND value similarity.
 * Keeps the highest-confidence read for each spatial cluster.
 */
const deduplicateResults = (results) => {
  const sorted = [...results].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  const kept = [];

  for (const r of sorted) {
    const isDup = kept.some(k =>
      (valuesClose(k, r) && (bboxOverlap(k.bbox, r.bbox) || bboxNearby(k.bbox, r.bbox)))
    );
    if (!isDup) kept.push(r);
  }

  return kept;
};

// ---------------------------------------------------------------------------
// Worker helpers
// ---------------------------------------------------------------------------

const createConfiguredWorker = async () => {
  const worker = await Tesseract.createWorker('eng', 1);
  return worker;
};

/**
 * Run OCR on a set of canvas variants using SPARSE_TEXT mode.
 * Returns all collected lines and words across all variants.
 */
const recognizeVariants = async (worker, canvases) => {
  const allLines = [];
  const allWords = [];

  await worker.setParameters({
    tessedit_char_whitelist: "0123456789'\"ftxXby .,-",
    tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
    preserve_interword_spaces: '1'
  });

  for (const { canvas } of canvases) {
    const result = await worker.recognize(canvas, {}, { blocks: true });
    const { lines, words } = collectLinesAndWords(result);
    allLines.push(...lines);
    allWords.push(...words);
  }

  return { lines: allLines, words: allWords };
};

/**
 * Run a focused second pass on specific ROI crops using SINGLE_LINE mode
 * for better accuracy on isolated dimension labels.
 */
const recognizeROIs = async (worker, baseCanvas, rois) => {
  const allLines = [];
  const allWords = [];

  if (rois.length === 0) return { lines: allLines, words: allWords };

  // Use SINGLE_LINE mode for tightly cropped dimension regions
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789'\"ftxXby .,-",
    tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
    preserve_interword_spaces: '1'
  });

  for (const roi of rois) {
    const cropped = cropCanvas(baseCanvas, roi);
    const result = await worker.recognize(cropped, {}, { blocks: true });
    const { lines, words } = collectLinesAndWords(result);

    // Offset bboxes back to full-image coordinates
    for (const line of lines) {
      if (line.bbox) {
        line.bbox.x0 += roi.x;
        line.bbox.y0 += roi.y;
        line.bbox.x1 += roi.x;
        line.bbox.y1 += roi.y;
      }
      if (line.words) {
        for (const word of line.words) {
          if (word.bbox) {
            word.bbox.x0 += roi.x;
            word.bbox.y0 += roi.y;
            word.bbox.x1 += roi.x;
            word.bbox.y1 += roi.y;
          }
        }
      }
    }

    for (const word of words) {
      if (word.bbox) {
        word.bbox.x0 += roi.x;
        word.bbox.y0 += roi.y;
        word.bbox.x1 += roi.x;
        word.bbox.y1 += roi.y;
      }
    }

    allLines.push(...lines);
    allWords.push(...words);
  }

  // Also try SPARSE_TEXT on ROIs for labels that span multiple words
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789'\"ftxXby .,-",
    tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
    preserve_interword_spaces: '1'
  });

  for (const roi of rois) {
    const cropped = cropCanvas(baseCanvas, roi);
    const result = await worker.recognize(cropped, {}, { blocks: true });
    const { lines, words } = collectLinesAndWords(result);

    for (const line of lines) {
      if (line.bbox) {
        line.bbox.x0 += roi.x;
        line.bbox.y0 += roi.y;
        line.bbox.x1 += roi.x;
        line.bbox.y1 += roi.y;
      }
      if (line.words) {
        for (const word of line.words) {
          if (word.bbox) {
            word.bbox.x0 += roi.x;
            word.bbox.y0 += roi.y;
            word.bbox.x1 += roi.x;
            word.bbox.y1 += roi.y;
          }
        }
      }
    }

    for (const word of words) {
      if (word.bbox) {
        word.bbox.x0 += roi.x;
        word.bbox.y0 += roi.y;
        word.bbox.x1 += roi.x;
        word.bbox.y1 += roi.y;
      }
    }

    allLines.push(...lines);
    allWords.push(...words);
  }

  return { lines: allLines, words: allWords };
};

// ---------------------------------------------------------------------------
// Confidence scoring – rank candidates by plausibility
// ---------------------------------------------------------------------------

/**
 * Score a parsed dimension result higher if it looks like a "real" room
 * dimension (both sides in typical residential range, integer inches, etc.)
 */
const scoreDimension = (d) => {
  let score = d.confidence || 50;

  // Prefer reads where both dimensions are in a typical residential range
  if (d.width >= 3 && d.width <= 50 && d.height >= 3 && d.height <= 50) {
    score += 10;
  }

  // Prefer ft+in format (more specific = more likely correct)
  if (d.format === 'inches') {
    score += 5;
  }

  // Penalize unreasonably large or tiny rooms
  if (d.width < 2 || d.height < 2 || d.width > 100 || d.height > 100) {
    score -= 15;
  }

  return score;
};

// ---------------------------------------------------------------------------
// Main entry point – multi-stage OCR pipeline
// ---------------------------------------------------------------------------

export const detectAllDimensions = async (imageDataUrl) => {
  try {
    const img = await dataUrlToImage(imageDataUrl);
    const { variants, scaleFactor } = buildVariants(img);

    const worker = await createConfiguredWorker();

    // ===== Stage 1: Full-image multi-variant OCR =====
    const { lines: allLines, words: allWords } = await recognizeVariants(worker, variants);

    // ===== Stage 2: Region-of-interest detection =====
    // Cluster digit-containing words from Stage 1 to identify likely
    // dimension regions, then run targeted second-pass OCR on each ROI.
    const rois = clusterDigitRegions(allWords, variants[0].canvas.width, variants[0].canvas.height);

    // ===== Stage 3: ROI-targeted multi-pass OCR =====
    // Run on the original canvas and the Otsu variant for diversity.
    const roiResults = { lines: [], words: [] };
    for (const variant of variants.slice(0, 2)) {
      const r = await recognizeROIs(worker, variant.canvas, rois);
      roiResults.lines.push(...r.lines);
      roiResults.words.push(...r.words);
    }

    await worker.terminate();

    // ===== Stage 4: Multi-strategy detection =====
    // Run both line-level and spatial-word detection on ALL collected data
    // (full-image + ROI passes).
    const combinedLines = [...allLines, ...roiResults.lines];
    const combinedWords = [...allWords, ...roiResults.words];

    const lineResults = detectFromLines(combinedLines);
    const spatialResults = detectFromSpatialWords(combinedWords);

    // ===== Stage 5: Score, merge, and deduplicate =====
    const allResults = [...lineResults, ...spatialResults];

    // Apply confidence scoring
    for (const r of allResults) {
      r.confidence = scoreDimension(r);
    }

    const deduped = deduplicateResults(allResults);

    // ===== Stage 6: Output formatting =====
    // Scale bboxes back to original image coordinates
    const dimensions = deduped.map(d => {
      let bbox = d.bbox;
      if (bbox && scaleFactor !== 1) {
        bbox = {
          x: bbox.x / scaleFactor,
          y: bbox.y / scaleFactor,
          width: bbox.width / scaleFactor,
          height: bbox.height / scaleFactor
        };
      }

      if (!bbox) {
        const idx = deduped.indexOf(d);
        bbox = {
          x: img.width / 2 - 100,
          y: img.height * 0.3 + idx * 80,
          width: 200,
          height: 50
        };
      }

      return {
        width: d.width,
        height: d.height,
        text: d.text,
        bbox,
        format: d.format
      };
    });

    const detectedFormat = dimensions.length > 0 ? dimensions[0].format : null;

    return { dimensions, detectedFormat };
  } catch (error) {
    console.error('DimensionsOCR error:', error);
    return { dimensions: [], detectedFormat: null };
  }
};

// Exported for unit-testing the parsing layer without a live OCR engine.
export { normalizeOcrText, parseSingleToken, parseDimensionLine };
