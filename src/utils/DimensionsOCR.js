import Tesseract from 'tesseract.js';
import { dataUrlToImage } from './imageLoader';
import {
  toGrayscale,
  otsuThreshold,
  contrastStretch,
  sharpen,
  grayToThresholdedCanvas
} from './imagePreprocessor';

const CONFIG = {
  orientationMaxAngleDeg: 12,
  minSideFeetEquivalent: 3,
  maxSideFeetEquivalent: 80,
  maxAspectRatio: 20,
  minWordConfidence: 20,
  lowConfidenceThreshold: 55,
  ocrWhitelist: `0123456789.'"xXfFtTmM ,-|!lI*%`
};

const CONFUSION_MAP = {
  "'": ['i', 'l', '|', '!', '*', '`'],
  '"': ['ii', "''", '”', '*'],
  x: ['x', 'k', '*', '%', '×'],
  0: ['o'],
  5: ['s']
};

const ROOM_WORD_REJECT = new Set([
  'living', 'bedroom', 'kitchen', 'bath', 'bathroom', 'foyer', 'closet', 'hall', 'garage', 'laundry', 'dining'
]);

const isFiniteNumber = (n) => Number.isFinite(n);

const toFeetEquivalent = (value, unit) => {
  if (!isFiniteNumber(value)) return null;
  if (unit === 'm') return value * 3.28084;
  return value;
};

const makeCanvas = (w, h) => {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
};

const scaleImageToCanvas = (img, scale = 1) => {
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
};

const buildPreprocessedScales = (img) => {
  const scales = [1.0, 1.5, 2.0];
  return scales.map((scale) => {
    const base = scaleImageToCanvas(img, scale);
    const ctx = base.getContext('2d');
    const imageData = ctx.getImageData(0, 0, base.width, base.height);
    const gray = toGrayscale(imageData);
    const stretched = contrastStretch(gray);
    const sharpened = sharpen(stretched, base.width, base.height, 1.8);
    const otsu = otsuThreshold(sharpened);
    const binary = grayToThresholdedCanvas(sharpened, base.width, base.height, otsu);
    return { scale, canvas: binary, width: base.width, height: base.height };
  });
};

export const normalizeOcrText = (text) => {
  if (!text) return '';
  return text
    .replace(/[\u2018\u2019\u2032`´]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[×\u00D7]/g, 'x')
    .replace(/\bby\b/gi, 'x')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/\s+/g, ' ')
    .trim();
};

const textLikelyIrrelevant = (text) => {
  const t = text.toLowerCase();
  if (!/[xX]/.test(t)) return true;
  const numericGroups = (t.match(/\d+/g) || []).length;
  if (numericGroups < 2) return true;
  if (t.length > 45) return true;

  const tokens = t.split(/\s+/).filter(Boolean);
  if (tokens.length && tokens.every((tok) => ROOM_WORD_REJECT.has(tok))) return true;

  return false;
};

const orientationDeg = (bbox) => {
  if (!bbox) return 0;
  const w = Math.abs((bbox.x1 ?? 0) - (bbox.x0 ?? 0));
  const h = Math.abs((bbox.y1 ?? 0) - (bbox.y0 ?? 0));
  if (w === 0) return 90;
  return Math.atan2(h, w) * (180 / Math.PI);
};

const sideFeetInchesRegex = /^(\d{1,3})\s*'\s*(\d{1,2})\s*"?$/i;
const sideDecimalFtRegex = /^(\d{1,3}(?:\.\d+)?)\s*(?:ft|feet)$/i;
const sideMeterRegex = /^(\d{1,3}(?:\.\d+)?)\s*m$/i;
const sideBareFeetRegex = /^(\d{1,3})\s*'$/;

const parseSide = (sideText) => {
  const s = normalizeOcrText(sideText).toLowerCase();

  let m = s.match(sideFeetInchesRegex);
  if (m) {
    const feet = parseInt(m[1], 10);
    const inches = parseInt(m[2], 10);
    if (inches < 12) {
      const value = feet + inches / 12;
      return { value, unit: 'ft', rawUnit: 'ft_in', feet, inches };
    }
  }

  m = s.match(sideDecimalFtRegex);
  if (m) return { value: parseFloat(m[1]), unit: 'ft', rawUnit: 'ft' };

  m = s.match(sideMeterRegex);
  if (m) return { value: parseFloat(m[1]), unit: 'm', rawUnit: 'm' };

  m = s.match(sideBareFeetRegex);
  if (m) return { value: parseInt(m[1], 10), unit: 'ft', rawUnit: 'ft_in', feet: parseInt(m[1], 10), inches: 0 };

  return null;
};

const withinValidRange = (side) => {
  const ft = toFeetEquivalent(side.value, side.unit);
  return ft >= CONFIG.minSideFeetEquivalent && ft <= CONFIG.maxSideFeetEquivalent;
};

const separatorRegex = /\s*[xX]\s*/;

const sideLooksLikeDimension = (text) => /\d/.test(text) && /('|"|ft|feet|m|\.)/i.test(text);

const generateConfusionCandidates = (input) => {
  const base = normalizeOcrText(input);
  const candidates = new Set([base]);

  const applyOne = (needle, replacements) => {
    for (const candidate of [...candidates]) {
      for (const repl of replacements) {
        const replaced = candidate.replace(new RegExp(needle, 'gi'), repl);
        candidates.add(replaced);
      }
    }
  };

  applyOne('[|!`lI]', ["'", '1']);
  applyOne('[*%kK×]', ['x']);
  applyOne('o', ['0']);
  applyOne('s', ['5']);

  return [...candidates].slice(0, 40);
};

const parseDimensionCandidate = (text, confidence = 50) => {
  const normalized = normalizeOcrText(text);
  if (textLikelyIrrelevant(normalized)) return null;

  const editCandidates = generateConfusionCandidates(normalized);
  let best = null;

  for (const candidate of editCandidates) {
    if (!separatorRegex.test(candidate)) continue;
    const [left, right] = candidate.split(separatorRegex);
    if (!left || !right) continue;

    if (!sideLooksLikeDimension(left) || !sideLooksLikeDimension(right)) continue;

    const side1 = parseSide(left);
    const side2 = parseSide(right);
    if (!side1 || !side2) continue;
    if (!withinValidRange(side1) || !withinValidRange(side2)) continue;

    const a = toFeetEquivalent(side1.value, side1.unit);
    const b = toFeetEquivalent(side2.value, side2.unit);
    if (!a || !b) continue;

    const ratio = Math.max(a, b) / Math.max(Math.min(a, b), 0.001);
    if (ratio > CONFIG.maxAspectRatio) continue;

    const editsPenalty = Math.max(0, candidate.length - normalized.length);
    const score = confidence - editsPenalty * 2 - Math.abs(ratio - 1) * 0.8;

    const formatType =
      side1.rawUnit === 'ft_in' && side2.rawUnit === 'ft_in'
        ? 'feet_inches'
        : side1.unit === 'm' && side2.unit === 'm'
          ? 'meter'
          : side1.unit === 'ft' && side2.unit === 'ft'
            ? 'decimal_ft'
            : 'mixed';

    const parsed = {
      raw_text: text,
      normalized: `${left.trim()} x ${right.trim()}`,
      side1,
      side2,
      format_type: formatType,
      score
    };

    if (!best || parsed.score > best.score) best = parsed;
  }

  return best;
};

const collectLines = (ocrResult) => {
  const lines = [];
  for (const block of ocrResult?.data?.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        const text = line.words?.map((w) => w.text).join(' ') || line.text || '';
        const avgConfidence = line.words?.length
          ? line.words.reduce((sum, w) => sum + (w.confidence || 0), 0) / line.words.length
          : 50;
        lines.push({ text, confidence: avgConfidence, bbox: line.bbox });
      }
    }
  }
  return lines;
};

const makeWorker = async () => {
  const worker = await Tesseract.createWorker('eng', 1);
  await worker.setParameters({
    tessedit_char_whitelist: CONFIG.ocrWhitelist,
    tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
    preserve_interword_spaces: '1'
  });
  return worker;
};

const runRecognition = async (worker, canvas) => worker.recognize(canvas, {}, { blocks: true });

const scoreDimension = (d) => {
  const confPart = (d.confidence || 50) * 0.6;
  const grammarPart = (d.score || 0) * 0.4;
  return confPart + grammarPart;
};

const deduplicateDimensions = (dimensions) => {
  const sorted = [...dimensions].sort((a, b) => scoreDimension(b) - scoreDimension(a));
  const seen = new Set();
  const out = [];

  for (const d of sorted) {
    const key = `${d.normalized}|${Math.round((d.bbox?.x || 0) / 8)}|${Math.round((d.bbox?.y || 0) / 8)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
};

export const inferDominantFormat = (dimensions) => {
  if (!dimensions?.length) return null;
  const counts = { feet_inches: 0, decimal_ft: 0, meter: 0, mixed: 0 };
  for (const d of dimensions) {
    counts[d.format_type] = (counts[d.format_type] || 0) + 1;
  }
  if (counts.feet_inches >= counts.decimal_ft && counts.feet_inches >= counts.meter) return 'inches';
  if (counts.decimal_ft >= counts.meter) return 'decimal';
  return 'decimal';
};

export const extractDimensionLineFromText = (text) => {
  if (!text) return null;
  const parts = String(text).split(/\r?\n+/).map((p) => normalizeOcrText(p)).filter(Boolean);
  for (const p of parts) {
    if (separatorRegex.test(p) && (p.match(/\d+/g) || []).length >= 2) return p;
  }
  return null;
};

export const parseSingleToken = (token) => parseSide(token);

export const parseDimensionLine = (line) => {
  const parsed = parseDimensionCandidate(line, 80);
  if (!parsed) return null;
  return {
    width: toFeetEquivalent(parsed.side1.value, parsed.side1.unit),
    height: toFeetEquivalent(parsed.side2.value, parsed.side2.unit),
    text: parsed.normalized,
    format: parsed.format_type === 'feet_inches' ? 'inches' : 'decimal',
    format_type: parsed.format_type,
    side1: parsed.side1,
    side2: parsed.side2
  };
};

export const detectAllDimensions = async (imageDataUrl) => {
  let worker;
  try {
    const img = await dataUrlToImage(imageDataUrl);
    const variants = buildPreprocessedScales(img);
    worker = await makeWorker();

    const rawDetections = [];
    for (const variant of variants) {
      const ocr = await runRecognition(worker, variant.canvas);
      const lines = collectLines(ocr);

      for (const line of lines) {
        const angle = orientationDeg(line.bbox);
        if (Math.abs(angle) > CONFIG.orientationMaxAngleDeg) continue;

        const parsed = parseDimensionCandidate(line.text, line.confidence);
        if (!parsed) continue;

        const scaleBack = 1 / variant.scale;
        const bbox = line.bbox
          ? {
              x: (line.bbox.x0 || 0) * scaleBack,
              y: (line.bbox.y0 || 0) * scaleBack,
              width: ((line.bbox.x1 || 0) - (line.bbox.x0 || 0)) * scaleBack,
              height: ((line.bbox.y1 || 0) - (line.bbox.y0 || 0)) * scaleBack
            }
          : null;

        rawDetections.push({
          ...parsed,
          bbox,
          confidence: line.confidence
        });
      }
    }

    const deduped = deduplicateDimensions(rawDetections);
    const dimensions = deduped.map((d) => ({
      text: d.raw_text,
      normalized: d.normalized,
      side1: d.side1,
      side2: d.side2,
      format_type: d.format_type,
      value_1: d.side1.value,
      unit_1: d.side1.unit,
      value_2: d.side2.value,
      unit_2: d.side2.unit,
      width: toFeetEquivalent(d.side1.value, d.side1.unit),
      height: toFeetEquivalent(d.side2.value, d.side2.unit),
      format: d.format_type === 'feet_inches' ? 'inches' : 'decimal',
      bbox: d.bbox,
      confidence: Math.max(0, Math.min(1, (d.confidence || 0) / 100))
    }));

    return {
      image_id: 'input',
      dimensions,
      detectedFormat: inferDominantFormat(dimensions)
    };
  } catch (error) {
    console.error('DimensionsOCR error:', error);
    return {
      image_id: 'input',
      dimensions: [],
      detectedFormat: null,
      rejected_candidates: [{ reason: 'runtime_error', detail: String(error) }]
    };
  } finally {
    if (worker) await worker.terminate();
  }
};
