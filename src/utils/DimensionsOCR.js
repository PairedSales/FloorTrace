import Tesseract from 'tesseract.js';
import { dataUrlToImage } from './imageLoader';
import {
  toGrayscale,
  otsuThreshold,
  contrastStretch,
  sharpen,
  grayToThresholdedCanvas
} from './imagePreprocessor';

const MIN_DIMENSION_FEET = 1;
const MAX_DIMENSION_FEET = 250;
const MAX_PLAIN_FEET = 40; // 2-digit numbers above this are treated as feet+inches (tick dropped by OCR)
const MIN_WORD_CONFIDENCE = 20;
const SHARPEN_AMOUNT = 2.0; // Stronger than default 1.5 to recover blurred tick marks

// Tesseract character whitelist – includes × (U+00D7) because Matterport
// (and many other) floor plans use the multiplication sign as the separator.
const OCR_CHAR_WHITELIST = "0123456789'\"ftxXby .,-\u00D7";

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
// Preprocessing variants
// ---------------------------------------------------------------------------

const buildVariants = (img) => {
  const factor = estimateScaleFactor(img);
  const scaled = scaleCanvas(img, factor);
  const ctx = scaled.getContext('2d');
  const imageData = ctx.getImageData(0, 0, scaled.width, scaled.height);
  const gray = toGrayscale(imageData);
  const stretched = contrastStretch(gray);
  const otsu = otsuThreshold(stretched);

  const variants = [];

  // V1 – original (scaled or unmodified)
  variants.push({ name: 'original', canvas: scaled });

  // V2 – Otsu thresholded (handles varying contrast / lower-resolution scans)
  variants.push({
    name: 'otsu',
    canvas: grayToThresholdedCanvas(stretched, scaled.width, scaled.height, otsu)
  });

  // V3 – Sharpened + Otsu: enhances thin features like ' and " before binarising.
  // This helps Tesseract resolve tick/quote marks that blur into noise.
  const sharpened = sharpen(stretched, scaled.width, scaled.height, SHARPEN_AMOUNT);
  const sharpOtsu = otsuThreshold(sharpened);
  variants.push({
    name: 'sharp-otsu',
    canvas: grayToThresholdedCanvas(sharpened, scaled.width, scaled.height, sharpOtsu)
  });

  return { variants, scaleFactor: factor, width: scaled.width, height: scaled.height };
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

  // Common OCR misreadings of the foot mark (') – commas, backticks, and
  // middle dots near digits that should be tick marks.
  // Only convert when adjacent to a digit to avoid false positives.
  s = s.replace(/(\d)\s*[,`\u00B7]\s*(?=\d)/g, "$1' ");
  s = s.replace(/(\d)\s*[,`\u00B7]\s*$/g, "$1'");

  // Lowercase everything: normalises X→x, Ft→ft, IN→in, etc.
  s = s.toLowerCase();

  // Common OCR char swaps near digits (applied after lowercase).
  // Negative lookahead (?![a-z]) prevents swapping the 'i' in unit
  // keywords like "in", "inch", "inches" or the 'l' in "left", etc.
  s = s.replace(/([0-9])[li|](?![a-z])/g, '$11');
  s = s.replace(/[li|](?![a-z])([0-9])/g, '1$1');
  s = s.replace(/([0-9])o(?=\s|'|"|$)/g, '$10');
  s = s.replace(/(?:^|\s)o([0-9])/g, ' 0$1');
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
  // D3: 2-digit bare integer where the value is implausibly large as
  //     plain feet.  Try interpreting as feet + inches with a dropped
  //     tick mark: "92" → 9' 2" = 9.17 ft, "85" → 8' 5" = 8.42 ft.
  //     A single room dimension > 40 ft is extremely unlikely on
  //     residential floor plans, so prefer the feet+inches reading.
  // ------------------------------------------------------------------
  const twoDigitFtIn = t.match(/^(\d)(\d)$/);
  if (twoDigitFtIn) {
    const combined = parseInt(t, 10);
    if (combined > MAX_PLAIN_FEET) {
      const feet = parseInt(twoDigitFtIn[1], 10);
      const inches = parseInt(twoDigitFtIn[2], 10);
      const val = feet + inches / 12;
      if (isReasonable(val)) return { value: val, format: 'inches' };
    }
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
  const raw = line;
  const norm = normalizeOcrText(line);
  console.log('[OCR] raw:', raw);
  console.log('[OCR] normalized:', norm);

  // --- Strategy 1: split on x separator --------------------------------
  // Try every x position (not just the first). Room labels like "KITCHEN"
  // get garbled through the restricted OCR whitelist and may introduce
  // spurious x characters before the actual dimension separator.
  for (const sepMatch of norm.matchAll(/\s*x\s*/g)) {
    const left = norm.slice(0, sepMatch.index).trim();
    const right = norm.slice(sepMatch.index + sepMatch[0].length).trim();
    console.log('[OCR] split → left:', left, '| right:', right);
    if (!left || !right) continue;

    let lp = parseSingleToken(left);
    let rp = parseSingleToken(right);

    // If the left half didn't parse, try stripping a garbled room-label
    // prefix.  Room labels mangled by the whitelist produce non-digit
    // garbage before the actual dimension value (e.g. "x1t,.. 10' 9").
    // Walk forward to each digit start and attempt a parse.
    if (!lp) {
      for (let charIdx = 1; charIdx < left.length; charIdx++) {
        if (!/[0-9]/.test(left[charIdx])) continue;
        const sub = left.slice(charIdx).trim();
        if (sub) {
          const parsed = parseSingleToken(sub);
          if (parsed) { lp = parsed; break; }
        }
      }
    }

    console.log('[OCR] left format:', lp?.format, 'value:', lp?.value);
    console.log('[OCR] right format:', rp?.format, 'value:', rp?.value);
    if (lp && rp) {
      const result = {
        width: lp.value,
        height: rp.value,
        text: norm,
        format: lp.format === 'inches' || rp.format === 'inches' ? 'inches' : 'decimal'
      };
      console.log('[OCR] parsed → width:', result.width, 'height:', result.height, 'format:', result.format);
      return result;
    }
  }

  // --- Strategy 2: two feet-inches groups without explicit x separator ----
  // e.g. "12'5\"  10'3\""  — normalised quotes are straight ' and "
  const twoFi = norm.match(
    /(\d{1,3})\s*'\s*-?\s*(\d{1,2})\s*"?\s{1,}(\d{1,3})\s*'\s*-?\s*(\d{1,2})\s*"?/
  );
  if (twoFi) {
    const w = parseInt(twoFi[1], 10) + parseInt(twoFi[2], 10) / 12;
    const h = parseInt(twoFi[3], 10) + parseInt(twoFi[4], 10) / 12;
    if (isReasonable(w) && isReasonable(h)) {
      console.log('[OCR] strategy 2 (two ft+in groups) → width:', w, 'height:', h);
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
      console.log('[OCR] strategy 3 (decimal ft pairs) → width:', w, 'height:', h);
      return { width: w, height: h, text: decFt[0], format: 'decimal' };
    }
  }

  console.log('[OCR] no parse for:', norm);
  return null;
};

// ---------------------------------------------------------------------------
// Digit-first spatial detection
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

const buildDigitGroups = (words) => {
  const groups = [];
  for (const word of words) {
    if (!word.text || !word.bbox) continue;
    if (word.confidence < MIN_WORD_CONFIDENCE) continue;
    // Skip words from vertical / rotated text (bbox much taller than wide)
    const wW = word.bbox.x1 - word.bbox.x0;
    const wH = word.bbox.y1 - word.bbox.y0;
    if (wH > wW * 2) continue;
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
    // Skip vertical / rotated text – dimension text always reads left to right,
    // so valid dimension lines are always wider than they are tall.
    if (line.bbox) {
      const bw = line.bbox.x1 - line.bbox.x0;
      const bh = line.bbox.y1 - line.bbox.y0;
      if (bh > bw) continue;
    }

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

const valuesClose = (a, b, tolerance = 0.05) => {
  const wDiff = Math.abs(a.width - b.width) / Math.max(a.width, 1);
  const hDiff = Math.abs(a.height - b.height) / Math.max(a.height, 1);
  return wDiff < tolerance && hDiff < tolerance;
};

const deduplicateResults = (results) => {
  const sorted = [...results].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  const kept = [];

  for (const r of sorted) {
    const isDup = kept.some(k =>
      valuesClose(k, r) && bboxOverlap(k.bbox, r.bbox)
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

const recognizeVariants = async (worker, canvases) => {
  const allLines = [];
  const allWords = [];

  // Text is always left-to-right; SPARSE_TEXT finds scattered dimension labels
  // across the floor plan without imposing a block/column structure.
  await worker.setParameters({
    tessedit_char_whitelist: OCR_CHAR_WHITELIST,
    tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
    preserve_interword_spaces: '1'
  });

  // Prefer Otsu variant first for consistency, then run ALL remaining
  // variants.  The previous short-circuit (stop after 2 confident words)
  // caused rooms whose text was only readable in other preprocessing
  // variants to be missed entirely.
  const orderedCanvases = [...canvases];
  const otsuIdx = orderedCanvases.findIndex(v => v.name === 'otsu');
  if (otsuIdx > 0) {
    const [otsu] = orderedCanvases.splice(otsuIdx, 1);
    orderedCanvases.unshift(otsu);
  }

  for (const variant of orderedCanvases) {
    const result = await worker.recognize(variant.canvas, {}, { blocks: true });
    const { lines, words } = collectLinesAndWords(result);
    allLines.push(...lines);
    allWords.push(...words);
  }

  return { lines: allLines, words: allWords };
};

// ---------------------------------------------------------------------------
// ROI extraction – crop regions where dimension-like text was found and
// re-OCR them with SINGLE_LINE mode for higher accuracy on ' and ".
// ---------------------------------------------------------------------------

const extractROIs = (results, imgWidth, imgHeight) => {
  const rois = [];
  const PAD_X_FRAC = 0.15; // horizontal padding as fraction of roi width
  const PAD_Y_FRAC = 0.5;  // vertical padding as fraction of roi height
  for (const r of results) {
    if (!r.bbox) continue;
    const padX = Math.max(10, Math.round(r.bbox.width * PAD_X_FRAC));
    const padY = Math.max(6, Math.round(r.bbox.height * PAD_Y_FRAC));
    const x = Math.max(0, r.bbox.x - padX);
    const y = Math.max(0, r.bbox.y - padY);
    const x2 = Math.min(imgWidth, r.bbox.x + r.bbox.width + padX);
    const y2 = Math.min(imgHeight, r.bbox.y + r.bbox.height + padY);
    if (x2 - x > 10 && y2 - y > 5) {
      rois.push({ x, y, w: x2 - x, h: y2 - y });
    }
  }
  return rois;
};

const cropCanvas = (sourceCanvas, roi) => {
  const canvas = document.createElement('canvas');
  canvas.width = roi.w;
  canvas.height = roi.h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(sourceCanvas, roi.x, roi.y, roi.w, roi.h, 0, 0, roi.w, roi.h);
  return canvas;
};

const runROIOcr = async (worker, baseCanvas, rois) => {
  if (rois.length === 0) return { lines: [], words: [] };

  const allLines = [];
  const allWords = [];

  // SINGLE_LINE mode is optimal for cropped dimension labels
  await worker.setParameters({
    tessedit_char_whitelist: OCR_CHAR_WHITELIST,
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
        line.bbox = {
          x0: line.bbox.x0 + roi.x,
          y0: line.bbox.y0 + roi.y,
          x1: line.bbox.x1 + roi.x,
          y1: line.bbox.y1 + roi.y
        };
      }
      if (line.words) {
        for (const w of line.words) {
          if (w.bbox) {
            w.bbox = {
              x0: w.bbox.x0 + roi.x,
              y0: w.bbox.y0 + roi.y,
              x1: w.bbox.x1 + roi.x,
              y1: w.bbox.y1 + roi.y
            };
          }
        }
      }
    }
    for (const w of words) {
      if (w.bbox) {
        w.bbox = {
          x0: w.bbox.x0 + roi.x,
          y0: w.bbox.y0 + roi.y,
          x1: w.bbox.x1 + roi.x,
          y1: w.bbox.y1 + roi.y
        };
      }
    }
    allLines.push(...lines);
    allWords.push(...words);
  }

  return { lines: allLines, words: allWords };
};

// ---------------------------------------------------------------------------
// Format inference – pick the dominant format across all detected dimensions
// ---------------------------------------------------------------------------

/**
 * Infer the dominant dimension format ('inches' or 'decimal') from an array
 * of detected dimension objects by majority vote.
 *
 * - 'inches' covers feet-inches notation  (5'10", 6ft 5in, 10' 5", …)
 * - 'decimal' covers decimal-feet notation (12.5ft, 10.6 ft, 50.0 feet, …)
 *
 * Ties are resolved in favour of 'inches' because feet-inches floor plans are
 * more common and a false-positive switch to inches is easier to correct than
 * silently losing the fractional part.
 *
 * @param {Array<{format: string}>} dimensions
 * @returns {'inches'|'decimal'|null}
 */
export const inferDominantFormat = (dimensions) => {
  if (!dimensions || dimensions.length === 0) return null;
  let inches = 0;
  let decimal = 0;
  for (const d of dimensions) {
    if (d.format === 'inches') inches++;
    else if (d.format === 'decimal') decimal++;
  }
  if (inches === 0 && decimal === 0) return null;
  return inches >= decimal ? 'inches' : 'decimal';
};

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export const detectAllDimensions = async (imageDataUrl) => {
  try {
    const img = await dataUrlToImage(imageDataUrl);
    const { variants, scaleFactor, width: scaledW, height: scaledH } = buildVariants(img);

    const worker = await createConfiguredWorker();

    // Pass 1: broad SPARSE_TEXT scan across all preprocessing variants
    const { lines: allLines, words: allWords } = await recognizeVariants(worker, variants);

    // Pass 1b: supplementary AUTO page-segmentation scan on the Otsu
    // variant.  SPARSE_TEXT excels at scattered labels but can miss text
    // that Tesseract's layout analysis would group into blocks (e.g.
    // room-name + dimension pairs stacked vertically).  A single AUTO
    // pass adds little overhead and significantly improves recall.
    const autoCanvas = variants.find(v => v.name === 'otsu')?.canvas ?? variants[0].canvas;
    await worker.setParameters({
      tessedit_char_whitelist: OCR_CHAR_WHITELIST,
      tessedit_pageseg_mode: Tesseract.PSM.AUTO,
      preserve_interword_spaces: '1'
    });
    const autoResult = await worker.recognize(autoCanvas, {}, { blocks: true });
    const { lines: autoLines, words: autoWords } = collectLinesAndWords(autoResult);
    allLines.push(...autoLines);
    allWords.push(...autoWords);

    // Initial detection from broad scan
    const lineResults = detectFromLines(allLines);
    const spatialResults = detectFromSpatialWords(allWords);
    const pass1 = [...lineResults, ...spatialResults];

    // Pass 2: targeted SINGLE_LINE OCR on cropped ROIs from the best variant.
    // This gives Tesseract a much better chance at reading ' and " accurately
    // because it can focus on a single line of text with less noise.
    const rois = extractROIs(deduplicateResults(pass1), scaledW, scaledH);
    // Use the Otsu-thresholded variant (index 1) for ROI crops – clean binary
    // image gives SINGLE_LINE mode the best input.
    const roiCanvas = variants.length > 1 ? variants[1].canvas : variants[0].canvas;
    const { lines: roiLines, words: roiWords } = await runROIOcr(worker, roiCanvas, rois);

    await worker.terminate();

    // Merge all detection results
    const roiLineResults = detectFromLines(roiLines);
    const roiSpatialResults = detectFromSpatialWords(roiWords);
    const merged = [...pass1, ...roiLineResults, ...roiSpatialResults];
    const deduped = deduplicateResults(merged);

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

    const detectedFormat = inferDominantFormat(dimensions);

    return { dimensions, detectedFormat };
  } catch (error) {
    console.error('DimensionsOCR error:', error);
    return { dimensions: [], detectedFormat: null };
  }
};

// Exported for unit-testing the parsing layer without a live OCR engine.
export { normalizeOcrText, parseSingleToken, parseDimensionLine };
