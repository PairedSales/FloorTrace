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
const MAX_DIMENSION_FEET = 60;
const MAX_ASPECT_RATIO = 4; // reject pairs where one dim is > 4× the other
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

  // V4 – Fixed high-contrast binary: uses threshold 128 since floorplans are
  // "always black on white".  Recovers text that Otsu misses in low-contrast
  // regions or where Otsu picks a threshold that merges thin strokes with BG.
  variants.push({
    name: 'fixed-binary',
    canvas: grayToThresholdedCanvas(stretched, scaled.width, scaled.height, 128)
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

  // g/q near digits → 9 (common Tesseract confusion).
  // Negative lookahead (?![a-z]) prevents replacing 'g' in words like "kg".
  s = s.replace(/([0-9])[gq](?![a-z])/g, '$19');
  s = s.replace(/[gq](?![a-z])([0-9])/g, '9$1');

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

const isPairReasonable = (w, h) =>
  isReasonable(w) && isReasonable(h) &&
  Math.max(w, h) / Math.max(Math.min(w, h), 0.1) <= MAX_ASPECT_RATIO;

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
      if (!isPairReasonable(lp.value, rp.value)) continue;
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
    if (isReasonable(w) && isReasonable(h) && isPairReasonable(w, h)) {
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
    if (isReasonable(w) && isReasonable(h) && isPairReasonable(w, h)) {
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

const buildDigitGroups = (words, { includeSeparators = false } = {}) => {
  const groups = [];
  for (const word of words) {
    if (!word.text || !word.bbox) continue;
    if (word.confidence < MIN_WORD_CONFIDENCE) continue;
    // Skip words from vertical / rotated text (bbox much taller than wide)
    const wW = word.bbox.x1 - word.bbox.x0;
    const wH = word.bbox.y1 - word.bbox.y0;
    if (wH > wW * 2) continue;
    const t = normalizeOcrText(word.text);
    const hasDigit = /\d/.test(t);
    // Optionally include separator words (x, ×) so spatial grouping can
    // reconstruct "13' 4" x 8' 7"" when "x" is a standalone word.
    const isSep = includeSeparators && /^[xX\u00D7×]$/.test(t.trim());
    if (hasDigit || isSep) {
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

const detectFromSpatialWords = (words, { includeSeparators = false } = {}) => {
  const digits = buildDigitGroups(words, { includeSeparators });
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

  // Always run all variants and deduplicate – the early-exit optimization
  // caused missed rooms when the first variant found *some* confident
  // words but not all dimension labels.
  for (const variant of canvases) {
    const result = await worker.recognize(variant.canvas, {}, { blocks: true });
    const { lines, words } = collectLinesAndWords(result);
    allLines.push(...lines);
    allWords.push(...words);
  }

  return { lines: allLines, words: allWords };
};

// ---------------------------------------------------------------------------
// Unrestricted discovery pass – run Tesseract with NO whitelist so room names
// and dimension text are read cleanly.  Then extract dimension-like lines
// via regex and create ROIs for those regions that the whitelist pass missed.
// ---------------------------------------------------------------------------

// Regex to find dimension-like patterns in unrestricted OCR text.
// Structure: <feet_digits> <opt_foot_mark> <opt_inches> <opt_inch_mark> <separator> <feet_digits> <opt_foot_mark> <opt_inches> <opt_inch_mark>
// Foot marks: ' ' ' ′ `  and smart quotes \u2018 \u2019
// Inch marks: " " " ″  and smart quotes \u201C \u201D
// Separators: x X × \u00D7
// Matches: 13' 4" x 8' 7", 23' 0" × 13' 6", 10'10" x 7'3", smart quotes, etc.
const DIMENSION_PATTERN = /\d{1,3}\s*['''\u2018\u2019\u2032`]?\s*-?\s*\d{0,2}\s*["""\u201C\u201D\u2033]?\s*[xX\u00D7]\s*\d{1,3}\s*['''\u2018\u2019\u2032`]?\s*-?\s*\d{0,2}\s*["""\u201C\u201D\u2033]?/;

const extractDimensionLineFromText = (text) => {
  if (!text) return null;
  const match = text.match(DIMENSION_PATTERN);
  return match ? match[0] : null;
};

const runUnrestrictedDiscovery = async (worker, baseCanvas) => {
  // Run with no whitelist to let Tesseract read all characters naturally
  await worker.setParameters({
    tessedit_char_whitelist: '',
    tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
    preserve_interword_spaces: '1'
  });

  const result = await worker.recognize(baseCanvas, {}, { blocks: true });
  const { lines, words } = collectLinesAndWords(result);

  const discovered = [];
  for (const line of lines) {
    if (!line.bbox) continue;

    // Skip vertical / rotated text
    const bw = line.bbox.x1 - line.bbox.x0;
    const bh = line.bbox.y1 - line.bbox.y0;
    if (bh > bw) continue;

    const rawText = line.words ? line.words.map(w => w.text).join(' ') : (line.text || '');

    // Strategy A: extract dimension-like pattern via regex
    const dimText = extractDimensionLineFromText(rawText);

    // Strategy B: try parseDimensionLine directly on the full line text.
    // parseDimensionLine already handles garbled room-label prefixes by
    // stripping non-dimension text before the actual numbers.
    const candidates = dimText ? [dimText, rawText] : [rawText];

    for (const candidate of candidates) {
      const parsed = parseDimensionLine(candidate);
      if (parsed) {
        const bbox = {
          x: line.bbox.x0,
          y: line.bbox.y0,
          width: bw,
          height: bh
        };
        const avgConf = line.words
          ? line.words.reduce((s, w) => s + (w.confidence || 0), 0) / line.words.length
          : 50;
        discovered.push({ ...parsed, bbox, confidence: avgConf });
        break; // first successful parse wins for this line
      }
    }
  }

  // Also run spatial word detection on unrestricted words – catches
  // dimensions that Tesseract split across multiple lines / blocks.
  const spatialResults = detectFromSpatialWords(words, { includeSeparators: true });
  discovered.push(...spatialResults);

  return discovered;
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
// Grid-based ROI discovery – divide the image into overlapping tiles and OCR
// any tile that doesn't overlap with an already-detected dimension bbox.
// Uses unrestricted text mode to catch rooms missed by the whitelist pass.
// ---------------------------------------------------------------------------

const tileOverlapsDetected = (tile, detected) => {
  for (const d of detected) {
    if (!d.bbox) continue;
    const overlapX = Math.max(0,
      Math.min(tile.x + tile.w, d.bbox.x + d.bbox.width) - Math.max(tile.x, d.bbox.x));
    const overlapY = Math.max(0,
      Math.min(tile.y + tile.h, d.bbox.y + d.bbox.height) - Math.max(tile.y, d.bbox.y));
    const overlapArea = overlapX * overlapY;
    const dArea = d.bbox.width * d.bbox.height;
    // If most of the detection bbox is inside this tile, skip the tile
    if (dArea > 0 && overlapArea / dArea > 0.5) return true;
  }
  return false;
};

const MIN_TILE_SIZE = 20; // Minimum tile dimension in pixels to be worth OCR-ing

const runGridDiscovery = async (worker, baseCanvas, imgW, imgH, alreadyDetected) => {
  const GRID_COLS = 3;
  // Scale rows to maintain roughly square tiles based on image aspect ratio
  const GRID_ROWS = Math.max(3, Math.round((imgH / imgW) * GRID_COLS));
  const OVERLAP_FRAC = 0.15;

  const tileW = Math.round(imgW / GRID_COLS);
  const tileH = Math.round(imgH / GRID_ROWS);
  const overlapX = Math.round(tileW * OVERLAP_FRAC);
  const overlapY = Math.round(tileH * OVERLAP_FRAC);

  const tiles = [];
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const x = Math.max(0, col * tileW - overlapX);
      const y = Math.max(0, row * tileH - overlapY);
      const w = Math.min(imgW - x, tileW + overlapX * 2);
      const h = Math.min(imgH - y, tileH + overlapY * 2);
      if (w > MIN_TILE_SIZE && h > MIN_TILE_SIZE) {
        tiles.push({ x, y, w, h });
      }
    }
  }

  // Filter out tiles that already contain a detected dimension
  const uncoveredTiles = tiles.filter(t => !tileOverlapsDetected(t, alreadyDetected));
  if (uncoveredTiles.length === 0) return [];

  // Use unrestricted text mode for grid scanning
  await worker.setParameters({
    tessedit_char_whitelist: '',
    tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
    preserve_interword_spaces: '1'
  });

  const results = [];
  for (const tile of uncoveredTiles) {
    const cropped = cropCanvas(baseCanvas, tile);
    const result = await worker.recognize(cropped, {}, { blocks: true });
    const { lines, words } = collectLinesAndWords(result);

    for (const line of lines) {
      if (!line.bbox) continue;
      const bw = line.bbox.x1 - line.bbox.x0;
      const bh = line.bbox.y1 - line.bbox.y0;
      if (bh > bw) continue;

      const rawText = line.words ? line.words.map(w => w.text).join(' ') : (line.text || '');
      const dimText = extractDimensionLineFromText(rawText);

      // Try regex-extracted dimension first, then fall back to full line text
      const candidates = dimText ? [dimText, rawText] : [rawText];

      for (const candidate of candidates) {
        const parsed = parseDimensionLine(candidate);
        if (parsed) {
          const bbox = {
            x: line.bbox.x0 + tile.x,
            y: line.bbox.y0 + tile.y,
            width: bw,
            height: bh
          };
          const avgConf = line.words
            ? line.words.reduce((s, w) => s + (w.confidence || 0), 0) / line.words.length
            : 50;
          results.push({ ...parsed, bbox, confidence: avgConf });
          break;
        }
      }
    }

    // Spatial word detection within this tile – catches dimensions split
    // across multiple Tesseract lines / blocks within the tile.
    const tileSpatial = detectFromSpatialWords(words, { includeSeparators: true });
    for (const sp of tileSpatial) {
      if (sp.bbox) {
        sp.bbox = {
          x: sp.bbox.x + tile.x,
          y: sp.bbox.y + tile.y,
          width: sp.bbox.width,
          height: sp.bbox.height
        };
      }
      results.push(sp);
    }
  }

  return results;
};

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

    // Pass 1: broad SPARSE_TEXT scan across all preprocessing variants (with whitelist)
    const { lines: allLines, words: allWords } = await recognizeVariants(worker, variants);

    // Initial detection from broad scan
    const lineResults = detectFromLines(allLines);
    const spatialResults = detectFromSpatialWords(allWords, { includeSeparators: true });
    const pass1 = [...lineResults, ...spatialResults];

    // Pass 2: targeted SINGLE_LINE OCR on cropped ROIs from the best variant.
    // This gives Tesseract a much better chance at reading ' and " accurately
    // because it can focus on a single line of text with less noise.
    const rois = extractROIs(deduplicateResults(pass1), scaledW, scaledH);
    // Use the Otsu-thresholded variant (index 1) for ROI crops – clean binary
    // image gives SINGLE_LINE mode the best input.
    const roiCanvas = variants.length > 1 ? variants[1].canvas : variants[0].canvas;
    const { lines: roiLines, words: roiWords } = await runROIOcr(worker, roiCanvas, rois);

    // Merge whitelist-based results
    const roiLineResults = detectFromLines(roiLines);
    const roiSpatialResults = detectFromSpatialWords(roiWords, { includeSeparators: true });
    const whitelistResults = [...pass1, ...roiLineResults, ...roiSpatialResults];

    // Pass 3: unrestricted discovery – run Tesseract WITHOUT a character
    // whitelist on multiple variants.  This reads room names and dimensions
    // cleanly, avoiding the whitelist-induced hallucination that garbles
    // room labels into false separators and drops digits.
    // Run on Otsu (best for most text) and original (catches text that
    // Otsu's binarisation destroys, e.g. light-coloured labels).
    const discoveryVariantIndices = [1, 0, 2].filter(i => i < variants.length);
    const allDiscoveryResults = [];
    for (const vi of discoveryVariantIndices) {
      const results = await runUnrestrictedDiscovery(worker, variants[vi].canvas);
      allDiscoveryResults.push(...results);
    }
    const discoveryResults = deduplicateResults(allDiscoveryResults);

    // Pass 4: grid-based ROI scanning for missed regions.
    // Divide the image into tiles and OCR any tile that doesn't overlap
    // with an already-detected dimension.  Uses unrestricted text mode
    // to catch rooms that both the whitelist pass and discovery pass missed.
    const allSoFar = deduplicateResults([...whitelistResults, ...discoveryResults]);
    const gridCanvas = variants.length > 1 ? variants[1].canvas : variants[0].canvas;
    const gridResults = await runGridDiscovery(worker, gridCanvas, scaledW, scaledH, allSoFar);

    await worker.terminate();

    // Merge all detection results
    const merged = [...whitelistResults, ...discoveryResults, ...gridResults];
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
export { normalizeOcrText, parseSingleToken, parseDimensionLine, extractDimensionLineFromText };
