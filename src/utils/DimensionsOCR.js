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
const MIN_WORD_CONFIDENCE = 30;

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

  return { variants, scaleFactor: factor };
};

// ---------------------------------------------------------------------------
// OCR text normalisation
// ---------------------------------------------------------------------------

const normalizeOcrText = (text) => {
  if (!text) return '';

  let s = text;

  // Unicode multiplications / separators
  s = s.replace(/[\u00D7\u2715\u2716\u00D8]/g, 'x');
  s = s.replace(/\b(?:by|BY|By)\b/g, 'x');

  // Smart / curly quotes → straight
  s = s.replace(/[\u2018\u2019\u02BC\u0060\u00B4]/g, "'");
  s = s.replace(/[\u201C\u201D\u02DD]/g, '"');
  s = s.replace(/''/g, '"');

  // Common OCR char swaps near digits
  s = s.replace(/([0-9])[lI|]/g, '$11');
  s = s.replace(/[lI|]([0-9])/g, '1$1');
  s = s.replace(/([0-9])[oO](?=\s|'|"|$)/g, '$10');
  s = s.replace(/(?:^|\s)[oO]([0-9])/g, ' 0$1');
  s = s.replace(/([0-9])[Ss]([0-9])/g, '$15$2');
  s = s.replace(/([0-9])[Bb]([0-9])/g, '$18$2');
  s = s.replace(/([0-9])[Zz]([0-9])/g, '$12$2');

  // Pipes/brackets that look like 1
  s = s.replace(/[|]/g, '1');

  // Dashes
  s = s.replace(/[\u2013\u2014\u2212]/g, '-');

  // Collapse whitespace
  s = s.replace(/\s+/g, ' ');

  return s.trim();
};

// ---------------------------------------------------------------------------
// Dimension parsing – flexible, handles mangled symbols
// ---------------------------------------------------------------------------

const isReasonable = (v) => Number.isFinite(v) && v >= MIN_DIMENSION_FEET && v <= MAX_DIMENSION_FEET;

const SEPARATOR = /\s*[xX\u00D7]\s*/;

const FEET_INCHES_FULL = /(\d{1,3})\s*['']\s*-?\s*(\d{1,2})\s*(?:["""]|'')?/;
const DECIMAL_TOKEN = /(\d{1,3}(?:\.\d+)?)\s*(?:ft|feet|')?/i;

const parseSingleToken = (token) => {
  const t = token.trim();

  // Try feet-inches first: 12'5" , 12' 5" , 12'5 , etc.
  const fi = t.match(/^(\d{1,3})\s*['']\s*-?\s*(\d{1,2})\s*(?:["""]|'')?$/);
  if (fi) {
    const feet = parseInt(fi[1], 10);
    const inches = parseInt(fi[2], 10);
    if (inches < 12) {
      const val = feet + inches / 12;
      if (isReasonable(val)) return { value: val, format: 'inches' };
    }
  }

  // Feet-only with tick mark: 12'
  const feetOnly = t.match(/^(\d{1,3})\s*['']\s*$/);
  if (feetOnly) {
    const val = parseInt(feetOnly[1], 10);
    if (isReasonable(val)) return { value: val, format: 'inches' };
  }

  // Decimal feet: 12.5 ft, 12.5, etc.
  const dec = t.match(/^(\d{1,3}(?:\.\d+)?)\s*(?:ft|feet)?\.?\s*$/i);
  if (dec) {
    const val = parseFloat(dec[1]);
    if (isReasonable(val)) return { value: val, format: 'decimal' };
  }

  return null;
};

const parseDimensionLine = (line) => {
  const norm = normalizeOcrText(line);

  // --- Strategy 1: explicit x/X separator --------------------------------
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

  // --- Strategy 2: full-line regex for feet-inches with x -----------------
  const fiFull = norm.match(
    /(\d{1,3})\s*['']\s*-?\s*(\d{1,2})\s*(?:["""]|'')?\s*[xX]\s*(\d{1,3})\s*['']\s*-?\s*(\d{1,2})\s*(?:["""]|'')?/
  );
  if (fiFull) {
    const w = parseInt(fiFull[1], 10) + parseInt(fiFull[2], 10) / 12;
    const h = parseInt(fiFull[3], 10) + parseInt(fiFull[4], 10) / 12;
    if (isReasonable(w) && isReasonable(h)) {
      return { width: w, height: h, text: fiFull[0], format: 'inches' };
    }
  }

  // --- Strategy 3: two bare numbers separated by x -----------------------
  const bare = norm.match(/(\d{1,3}(?:\.\d+)?)\s*[xX]\s*(\d{1,3}(?:\.\d+)?)/);
  if (bare) {
    const w = parseFloat(bare[1]);
    const h = parseFloat(bare[2]);
    if (isReasonable(w) && isReasonable(h)) {
      const fmt = bare[1].includes('.') || bare[2].includes('.') ? 'decimal' : 'decimal';
      return { width: w, height: h, text: bare[0], format: fmt };
    }
  }

  // --- Strategy 4: two feet-inches groups without explicit x separator ----
  // e.g. "12'5\"  10'3\""
  const twoFi = norm.match(
    /(\d{1,3})\s*['']\s*-?\s*(\d{1,2})\s*(?:["""]|'')?\s{1,}\s*(\d{1,3})\s*['']\s*-?\s*(\d{1,2})\s*(?:["""]|'')?/
  );
  if (twoFi) {
    const w = parseInt(twoFi[1], 10) + parseInt(twoFi[2], 10) / 12;
    const h = parseInt(twoFi[3], 10) + parseInt(twoFi[4], 10) / 12;
    if (isReasonable(w) && isReasonable(h)) {
      return { width: w, height: h, text: twoFi[0], format: 'inches' };
    }
  }

  // --- Strategy 5: decimal ft x decimal ft --------------------------------
  const decFt = norm.match(
    /(\d{1,3}(?:\.\d+)?)\s*(?:ft|feet)\s*[xX]?\s*(\d{1,3}(?:\.\d+)?)\s*(?:ft|feet)/i
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

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export const detectAllDimensions = async (imageDataUrl) => {
  try {
    const img = await dataUrlToImage(imageDataUrl);
    const { variants, scaleFactor } = buildVariants(img);

    const worker = await createConfiguredWorker();
    const { lines: allLines, words: allWords } = await recognizeVariants(worker, variants);
    await worker.terminate();

    // Two detection strategies run in parallel, then merged
    const lineResults = detectFromLines(allLines);
    const spatialResults = detectFromSpatialWords(allWords);

    const merged = [...lineResults, ...spatialResults];
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

    const detectedFormat = dimensions.length > 0 ? dimensions[0].format : null;

    return { dimensions, detectedFormat };
  } catch (error) {
    console.error('DimensionsOCR error:', error);
    return { dimensions: [], detectedFormat: null };
  }
};
