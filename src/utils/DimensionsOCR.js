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
const MIN_WORD_CONFIDENCE = 20;
const SHARPEN_AMOUNT = 2.0;
let cachedWorker = null;

// Highly restricted whitelist to skip logos, long descriptive names, etc.
// Added characters common to blurry digit approximations.
const OCR_CHAR_WHITELIST = "0123456789'\"ftxmX .,-\\`|/I";

// Limit max scale to keep operations fast
const estimateScaleFactor = (img) => {
  const maxDim = Math.max(img.width, img.height);
  if (maxDim <= 2500) return 1.0;
  return 2500 / maxDim;
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
// OCR text normalisation
// ---------------------------------------------------------------------------

const normalizeOcrText = (text) => {
  if (!text) return '';

  let s = text;

  // Smart / curly quotes / backticks -> straight quotes/apostrophes
  s = s.replace(/[\u2018\u2019\u02BC\u0060\u00B4]/g, "'");
  s = s.replace(/[\u201C\u201D\u02DD]/g, '"');
  s = s.replace(/`/g, "'");
  // Consecutive marks to inches
  s = s.replace(/''/g, '"');
  s = s.replace(/,,/g, '"');

  // Convert unicode multiplication signs and 'by' to standard lowercase 'x'
  s = s.replace(/[\u00D7\u2715\u2716\u00D8]/g, 'x');
  s = s.replace(/\b(?:by|BY|By)\b/g, 'x');

  // Common OCR misreadings of the foot mark (')
  s = s.replace(/(\d)\s*[,·]\s*(?=\d)/g, "$1' ");
  s = s.replace(/(\d)\s*[,·]\s*$/g, "$1'");

  // Lowercase everything
  s = s.toLowerCase();

  // Fix blurry artifacts where | / I l are registered inside numbers as '1'
  s = s.replace(/([0-9])[li|I/](?![a-z])/g, '$11');
  s = s.replace(/[li|I/](?![a-z])([0-9])/g, '1$1');
  s = s.replace(/(?:^|\s|\b)[|/]([0-9])/g, '1$1');
  s = s.replace(/([0-9])[|/](?:$|\s|\b)/g, '$11');

  // General number typos
  s = s.replace(/([0-9])o(?=\s|'|"|$)/g, '$10');
  s = s.replace(/(?:^|\s)o([0-9])/g, ' 0$1');
  s = s.replace(/([0-9])s([0-9])/g, '$15$2');
  s = s.replace(/([0-9])b([0-9])/g, '$18$2');
  s = s.replace(/([0-9])z([0-9])/g, '$12$2');

  // Ensure a space between a digit and a unit keyword
  s = s.replace(/(\d)(ft|feet|in|m)\b/g, '$1 $2');
  s = s.replace(/\b(ft|feet|in|m)(\d)/g, '$1 $2');

  // Collapse whitespace
  s = s.replace(/\s+/g, ' ');

  return s.trim();
};

// ---------------------------------------------------------------------------
// Dimension parsing
// ---------------------------------------------------------------------------

const isReasonable = (v) => Number.isFinite(v) && v >= MIN_DIMENSION_FEET && v <= MAX_DIMENSION_FEET;

const parseSingleToken = (token) => {
  const t = normalizeOcrText(token);

  // Feet inches with tick (4'5", 10' 2", 12'5)
  const feetInches = t.match(/^(\d{1,3})\s*'\s*-?\s*(\d{1,2})\s*"?\s*$/);
  if (feetInches) {
    const feet = parseInt(feetInches[1], 10);
    const inches = parseInt(feetInches[2], 10);
    if (inches < 12) {
      const val = feet + inches / 12;
      if (isReasonable(val)) return { value: val, format: 'inches' };
    }
  }

  // Feet only with tick (12')
  const feetOnly = t.match(/^(\d{1,3})\s*'\s*$/);
  if (feetOnly) {
    const val = parseInt(feetOnly[1], 10);
    if (isReasonable(val)) return { value: val, format: 'inches' };
  }

  // Decimal feet (1.2, 12.75 ft)
  const decimalFt = t.match(/^(\d{1,3}\.\d+)\s*(?:ft|feet|')?\s*$/);
  if (decimalFt) {
    const val = parseFloat(decimalFt[1]);
    if (isReasonable(val)) return { value: val, format: 'decimal' };
  }

  // Integer explicit feet (12 ft)
  const intFt = t.match(/^(\d{1,3})\s*(?:ft|feet)\s*$/);
  if (intFt) {
    const val = parseInt(intFt[1], 10);
    if (isReasonable(val)) return { value: val, format: 'decimal' };
  }

  // Explicit ft/in (1 ft 3 in)
  const explicitFtIn = t.match(/^(\d{1,3})\s*(?:ft|feet)\s+(\d{1,2})\s*(?:in|inch|inches)?\s*$/);
  if (explicitFtIn) {
    const feet = parseInt(explicitFtIn[1], 10);
    const inches = parseInt(explicitFtIn[2], 10);
    if (inches < 12) {
      const val = feet + inches / 12;
      if (isReasonable(val)) return { value: val, format: 'inches' };
    }
  }

  // Meters (12.50 m)
  const meters = t.match(/^(\d{1,3}(?:\.\d+)?)\s*(?:m|meter|meters)\s*$/);
  if (meters) {
    const metersVal = parseFloat(meters[1]);
    const val = metersVal * 3.28084; // Convert meters to feet internally for drawing
    if (isReasonable(val)) return { value: val, format: 'meters' };
  }

  // Blurry/Missing symbols
  const spacedPair = t.match(/^(\d{1,3})\s+(\d{1,2})$/);
  if (spacedPair) {
    const a = parseInt(spacedPair[1], 10);
    const b = parseInt(spacedPair[2], 10);
    if (b < 12 && isReasonable(a + b / 12)) return { value: a + b / 12, format: 'inches' };
  }

  const noisyOcr = t.match(/^(\d{3,4})$/);
  if (noisyOcr) {
    const num = noisyOcr[1];
    if (num.length === 4) {
      const lastTwo = parseInt(num.slice(-2), 10);
      const ftPart = parseInt(num.slice(0, -2), 10);
      if (lastTwo < 12 && isReasonable(ftPart + lastTwo / 12)) return { value: ftPart + lastTwo / 12, format: 'inches' };
    }
    const lastOne = parseInt(num.slice(-1), 10);
    const ftPart = parseInt(num.slice(0, -1), 10);
    if (lastOne < 12 && isReasonable(ftPart + lastOne / 12)) return { value: ftPart + lastOne / 12, format: 'inches' };
    
    const plain = parseInt(num, 10);
    if (isReasonable(plain)) return { value: plain, format: 'decimal' };
  }

  const plainFt = t.match(/^(\d{1,2})$/);
  if (plainFt) {
    const val = parseInt(plainFt[1], 10);
    if (isReasonable(val)) return { value: val, format: 'decimal' };
  }

  return null;
};

const parseDimensionLine = (line) => {
  const norm = normalizeOcrText(line);

  // Split on separators: x, hyphen
  for (const match of norm.matchAll(/\s*[xX\-]\s*/g)) {
    const left = norm.slice(0, match.index).trim();
    const right = norm.slice(match.index + match[0].length).trim();
    if (!left || !right) continue;

    let lp = parseSingleToken(left);
    let rp = parseSingleToken(right);

    // Strip garbage room-label prefixes
    if (!lp) {
      for (let i = 1; i < left.length; i++) {
        if (!/[0-9]/.test(left[i])) continue;
        const sub = left.slice(i).trim();
        if (sub) {
          const parsed = parseSingleToken(sub);
          if (parsed) { lp = parsed; break; }
        }
      }
    }

    if (!rp) {
      for (let i = right.length - 2; i >= 0; i--) {
        if (!/[0-9]/.test(right[i])) continue;
        const sub = right.slice(0, i + 1).trim();
        if (sub) {
          const parsed = parseSingleToken(sub);
          if (parsed) { rp = parsed; break; }
        }
      }
    }

    if (lp && rp) {
      const formatGroup = [lp.format, rp.format];
      let resolvedFormat = 'decimal';
      if (formatGroup.includes('inches')) resolvedFormat = 'inches';
      else if (formatGroup.includes('meters')) resolvedFormat = 'meters';

      return {
        width: lp.value,
        height: rp.value,
        text: norm,
        format: resolvedFormat
      };
    }
  }

  // Backup: Space-separated two groups
  const twoFi = norm.match(/(\d{1,3})\s*'\s*-?\s*(\d{1,2})\s*"?\s{1,}(\d{1,3})\s*'\s*-?\s*(\d{1,2})\s*"?/);
  if (twoFi) {
    const w = parseInt(twoFi[1], 10) + parseInt(twoFi[2], 10) / 12;
    const h = parseInt(twoFi[3], 10) + parseInt(twoFi[4], 10) / 12;
    if (isReasonable(w) && isReasonable(h)) {
      return { width: w, height: h, text: twoFi[0], format: 'inches' };
    }
  }

  const decFt = norm.match(/(\d{1,3}(?:\.\d+)?)\s*(?:ft|feet|m)\s+(\d{1,3}(?:\.\d+)?)\s*(?:ft|feet|m)/);
  if (decFt) {
    const isMeters = norm.includes('m');
    let w = parseFloat(decFt[1]);
    let h = parseFloat(decFt[2]);
    if (isMeters) {
        w *= 3.28084;
        h *= 3.28084;
    }
    if (isReasonable(w) && isReasonable(h)) {
      return { width: w, height: h, text: decFt[0], format: isMeters ? 'meters' : 'decimal' };
    }
  }

  return null;
};

// ---------------------------------------------------------------------------
// Detection Engine
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

const detectFromLines = (lines) => {
  const results = [];
  const seen = new Set();

  for (const line of lines) {
    if (line.bbox) {
      const bw = line.bbox.x1 - line.bbox.x0;
      const bh = line.bbox.y1 - line.bbox.y0;
      if (bh > bw) continue; // Ignore vertical text
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

// Fast heuristic to find groups of contiguous words horizontally aligned
const detectFromSpatialWords = (words) => {
  const digits = [];
  for (const word of words) {
    if (!word.text || !word.bbox || word.confidence < MIN_WORD_CONFIDENCE) continue;
    const wW = word.bbox.x1 - word.bbox.x0;
    const wH = word.bbox.y1 - word.bbox.y0;
    if (wH > wW * 2) continue; // Skip strictly vertical
    const t = normalizeOcrText(word.text);
    if (/\d/.test(t)) {
      digits.push({ text: t, bbox: word.bbox, confidence: word.confidence });
    }
  }

  if (digits.length < 2) return [];

  const results = [];
  const used = new Set();
  
  const horizontalBand = (a, b) => {
    const aCy = (a.bbox.y0 + a.bbox.y1) / 2;
    const bCy = (b.bbox.y0 + b.bbox.y1) / 2;
    const tolerance = Math.max(a.bbox.y1 - a.bbox.y0, b.bbox.y1 - b.bbox.y0) * 1.2;
    return Math.abs(aCy - bCy) < tolerance;
  };

  for (let i = 0; i < digits.length; i++) {
    if (used.has(i)) continue;
    const band = [digits[i]];
    const bandIndices = [i];

    for (let j = i + 1; j < digits.length; j++) {
      if (used.has(j) || !horizontalBand(digits[i], digits[j])) continue;
      // Allow fairly wide gaps since some labels have huge spaces between numbers
      band.push(digits[j]);
      bandIndices.push(j);
    }

    if (band.length >= 2) {
      const combined = band.map(w => w.text).join(' ');
      const parsed = parseDimensionLine(combined);
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
// Merge / Dedup / Zoom
// ---------------------------------------------------------------------------

const bboxOverlap = (a, b) => {
  if (!a || !b) return false;
  const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const minArea = Math.min(a.width * a.height, b.width * b.height);
  return minArea > 0 && (overlapX * overlapY) / minArea > 0.3;
};

const deduplicateResults = (results) => {
  const sorted = [...results].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  const kept = [];
  for (const r of sorted) {
    const wDiff = k => Math.abs(k.width - r.width) / Math.max(k.width, 1) < 0.05;
    const hDiff = k => Math.abs(k.height - r.height) / Math.max(k.height, 1) < 0.05;
    if (!kept.some(k => wDiff(k) && hDiff(k) && bboxOverlap(k.bbox, r.bbox))) kept.push(r);
  }
  return kept;
};

const extractROIs = (results, imgWidth, imgHeight) => {
  const rois = [];
  for (const r of results) {
    if (!r.bbox) continue;
    const padX = Math.max(10, Math.round(r.bbox.width * 0.15));
    const padY = Math.max(6, Math.round(r.bbox.height * 0.5));
    const x = Math.max(0, r.bbox.x - padX);
    const y = Math.max(0, r.bbox.y - padY);
    const w = Math.min(imgWidth, r.bbox.x + r.bbox.width + padX) - x;
    const h = Math.min(imgHeight, r.bbox.y + r.bbox.height + padY) - y;
    if (w > 10 && h > 5) rois.push({ x, y, w, h });
  }
  return rois;
};

const runROIOcr = async (worker, baseCanvas, rois) => {
  const allLines = [], allWords = [];
  await worker.setParameters({
    tessedit_char_whitelist: OCR_CHAR_WHITELIST,
    tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
    preserve_interword_spaces: '1'
  });

  for (const roi of rois) {
    const canvas = document.createElement('canvas');
    canvas.width = roi.w;
    canvas.height = roi.h;
    canvas.getContext('2d').drawImage(baseCanvas, roi.x, roi.y, roi.w, roi.h, 0, 0, roi.w, roi.h);
    
    const result = await worker.recognize(canvas, {}, { blocks: true });
    const { lines, words } = collectLinesAndWords(result);
    // Shift coords back
    const shift = (b) => {
        if(b) {
            b.x0 += roi.x; b.x1 += roi.x;
            b.y0 += roi.y; b.y1 += roi.y;
        }
    };
    lines.forEach(l => { shift(l.bbox); if(l.words) l.words.forEach(w => shift(w.bbox)); });
    words.forEach(w => shift(w.bbox));
    allLines.push(...lines);
    allWords.push(...words);
  }
  return { lines: allLines, words: allWords };
};

const getWorker = async () => {
  if (!cachedWorker) {
    cachedWorker = await Tesseract.createWorker('eng', 1);
  }

  return cachedWorker;
};

export const terminateOcrWorker = async () => {
  if (cachedWorker) {
    await cachedWorker.terminate();
    cachedWorker = null;
  }
};

export const inferDominantFormat = (dimensions) => {
  if (!dimensions || dimensions.length === 0) return null;
  let counts = { inches: 0, decimal: 0, meters: 0 };
  for (const d of dimensions) {
    if (d.format in counts) counts[d.format]++;
  }
  const maxFormat = Object.keys(counts).reduce((a, b) => counts[a] >= counts[b] ? a : b);
  return counts[maxFormat] > 0 ? maxFormat : null;
};

export const detectAllDimensions = async (imageDataUrl) => {
  try {
    const img = await dataUrlToImage(imageDataUrl);
    const scaleFactor = estimateScaleFactor(img);
    const scaled = scaleCanvas(img, scaleFactor);
    const ctx = scaled.getContext('2d');
    const imageData = ctx.getImageData(0, 0, scaled.width, scaled.height);
    
    // One rapid optimal pass
    const gray = toGrayscale(imageData);
    const stretched = contrastStretch(gray);
    const sharpened = sharpen(stretched, scaled.width, scaled.height, SHARPEN_AMOUNT);
    const optimizedCanvas = grayToThresholdedCanvas(sharpened, scaled.width, scaled.height, otsuThreshold(sharpened));

    const worker = await getWorker();
    
    await worker.setParameters({
      tessedit_char_whitelist: OCR_CHAR_WHITELIST,
      tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
      preserve_interword_spaces: '1'
    });

    const result = await worker.recognize(optimizedCanvas, {}, { blocks: true });
    const { lines, words } = collectLinesAndWords(result);
    
    const initialResults = deduplicateResults([...detectFromLines(lines), ...detectFromSpatialWords(words)]);
    const rois = extractROIs(initialResults, scaled.width, scaled.height);
    
    let roiLines = [], roiWords = [];
    if (rois.length > 0) {
      const { lines: rl, words: rw } = await runROIOcr(worker, optimizedCanvas, rois);
      roiLines = rl; roiWords = rw;
    }

    const merged = deduplicateResults([...initialResults, ...detectFromLines(roiLines), ...detectFromSpatialWords(roiWords)]);

    // Scale back bboxes
    const dimensions = merged.map((d, idx) => {
      let bbox = d.bbox;
      if (bbox && scaleFactor !== 1) {
        bbox = { x: bbox.x / scaleFactor, y: bbox.y / scaleFactor, width: bbox.width / scaleFactor, height: bbox.height / scaleFactor };
      }
      if (!bbox) bbox = { x: img.width / 2 - 100, y: img.height * 0.3 + idx * 80, width: 200, height: 50 };
      return { width: d.width, height: d.height, text: d.text, bbox, format: d.format };
    });

    return { dimensions, detectedFormat: inferDominantFormat(dimensions) };
  } catch (error) {
    console.error('DimensionsOCR error:', error);
    return { dimensions: [], detectedFormat: null };
  }
};

export { normalizeOcrText, parseSingleToken, parseDimensionLine };
