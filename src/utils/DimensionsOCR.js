import Tesseract from 'tesseract.js';
import { dataUrlToImage } from './imageLoader';
import {
  toGrayscale,
  otsuThreshold,
  contrastStretch,
  sharpen,
  grayToThresholdedCanvas
} from './imagePreprocessor';

const OCR_CHAR_WHITELIST = `0123456789.xXmMftFT'"`;
const MIN_WORD_CONFIDENCE = 20;
const VALID_MIN_DIMENSION = 2;
const VALID_MAX_DIMENSION = 100;
const SHARPEN_AMOUNT = 2.0;
let cachedWorker = null;

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

// A. preprocessing enhancement
export const preprocess = (imageData, width, height, { morphCleanup = true } = {}) => {
  const gray = toGrayscale(imageData);
  const stretched = contrastStretch(gray);
  const sharpened = sharpen(stretched, width, height, SHARPEN_AMOUNT);
  const threshold = otsuThreshold(sharpened);
  const binary = new Uint8ClampedArray(sharpened.length);

  for (let i = 0; i < sharpened.length; i++) {
    // invert so text pixels are 255, background is 0
    binary[i] = sharpened[i] < threshold ? 255 : 0;
  }

  if (morphCleanup) {
    // light horizontal closing to reconnect broken characters
    const closed = new Uint8ClampedArray(binary.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let maxVal = 0;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          maxVal = Math.max(maxVal, binary[y * width + xx]);
        }
        closed[y * width + x] = maxVal;
      }
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let minVal = 255;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          minVal = Math.min(minVal, closed[y * width + xx]);
        }
        binary[y * width + x] = minVal;
      }
    }
  }

  const vis = new Uint8ClampedArray(binary.length);
  for (let i = 0; i < binary.length; i++) vis[i] = binary[i] ? 0 : 255;
  const canvas = grayToThresholdedCanvas(vis, width, height, 128);
  return { binary, canvas };
};

// D. strong normalization layer
export const normalize_text = (text) => {
  if (!text) return '';
  return String(text)
    .replace(/[\u2018\u2019\u02BC\u0060\u00B4]/g, "'")
    .replace(/[\u201C\u201D\u02DD]/g, '"')
    .replace(/''/g, '"')
    .replace(/[\u00D7\u2715\u2716]/g, 'x')
    .replace(/\bby\b/gi, 'x')
    .replace(/(\d)\s*,\s*(?=\d)/g, `$1' `)
    .toLowerCase()
    .replace(/(\d)(ft|feet|in|m)\b/g, '$1 $2')
    .replace(/\b(ft|feet|in|m)(\d)/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
};

export const normalizeOcrText = normalize_text;

// B. detect text regions first (horizontal + min size)
export const detect_text_regions = (binary, width, height) => {
  const visited = new Uint8Array(width * height);
  const boxes = [];
  const minArea = Math.max(60, Math.floor((width * height) / 20000));

  const queue = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (visited[idx] || binary[idx] === 0) continue;

      let minX = x, minY = y, maxX = x, maxY = y, area = 0;
      visited[idx] = 1;
      queue.push(idx);

      while (queue.length) {
        const q = queue.pop();
        const qx = q % width;
        const qy = (q - qx) / width;
        area++;
        if (qx < minX) minX = qx;
        if (qy < minY) minY = qy;
        if (qx > maxX) maxX = qx;
        if (qy > maxY) maxY = qy;

        for (let ny = qy - 1; ny <= qy + 1; ny++) {
          for (let nx = qx - 1; nx <= qx + 1; nx++) {
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const nidx = ny * width + nx;
            if (visited[nidx] || binary[nidx] === 0) continue;
            visited[nidx] = 1;
            queue.push(nidx);
          }
        }
      }

      if (area < minArea) continue;
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      if (bw <= bh || bw < 18 || bh < 8) continue;
      boxes.push({ x: minX, y: minY, width: bw, height: bh });
    }
  }

  boxes.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  return boxes;
};

const cropCanvas = (srcCanvas, box) => {
  const canvas = document.createElement('canvas');
  canvas.width = box.width;
  canvas.height = box.height;
  canvas.getContext('2d').drawImage(srcCanvas, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
  return canvas;
};

export const ocr_region = async (worker, imageCrop) => {
  await worker.setParameters({
    tessedit_char_whitelist: OCR_CHAR_WHITELIST,
    tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
    preserve_interword_spaces: '1'
  });
  const result = await worker.recognize(imageCrop, {}, { blocks: false });
  return result?.data?.text || '';
};

export const parse_dimension = (match) => {
  const { kind } = match;
  if (kind === 'feet_inches') {
    const wFeet = parseFloat(match.groups[1]);
    const wInches = parseFloat(match.groups[2] || '0');
    const hFeet = parseFloat(match.groups[3]);
    const hInches = parseFloat(match.groups[4] || '0');
    return {
      width: wFeet + (wInches / 12),
      height: hFeet + (hInches / 12),
      unit: 'ft'
    };
  }

  if (kind === 'decimal_ft') {
    return {
      width: parseFloat(match.groups[1]),
      height: parseFloat(match.groups[3]),
      unit: 'ft'
    };
  }

  if (kind === 'meters') {
    return {
      width: parseFloat(match.groups[1]),
      height: parseFloat(match.groups[3]),
      unit: 'm'
    };
  }

  return null;
};

// E. multi-pattern regex extraction
export const extract_dimensions = (text) => {
  const normalized = normalize_text(text);
  if (!normalized.includes('x')) return [];

  const patterns = [
    {
      kind: 'feet_inches',
      regex: /(\d+)\s*'\s*(\d+)\s*"\s*x\s*(\d+)\s*'\s*(\d+)\s*"/g
    },
    {
      kind: 'feet_inches',
      regex: /(\d+)\s*'\s*(\d+)?\s*"?\s*x\s*(\d+)\s*'\s*(\d+)?\s*"?/g
    },
    {
      kind: 'decimal_ft',
      regex: /(\d+(\.\d+)?)\s*ft\s*x\s*(\d+(\.\d+)?)\s*ft/g
    },
    {
      kind: 'decimal_ft',
      regex: /(\d+(\.\d+)?)\s*ft?\s*x\s*(\d+(\.\d+)?)\s*ft?/g
    },
    {
      kind: 'feet_inches',
      regex: /(\d+)\s*(?:ft|feet)\s*(\d+)\s*(?:in|inch|inches)\s*x\s*(\d+)\s*(?:ft|feet)\s*(\d+)\s*(?:in|inch|inches)/g
    },
    {
      kind: 'meters',
      regex: /(\d+(\.\d+)?)\s*m\s*x\s*(\d+(\.\d+)?)\s*m/g
    }
  ];

  const out = [];
  for (const p of patterns) {
    for (const m of normalized.matchAll(p.regex)) {
      const parsed = parse_dimension({ kind: p.kind, groups: m });
      if (!parsed) continue;
      out.push({ ...parsed, raw: m[0] });
    }
  }

  if (out.length > 0) return out;

  // structure-aware fallback for cases like 149 x 112 => 14'9" x 11'2"
  const pairFallback = normalized.match(/\b(\d{3,4})\s*x\s*(\d{3,4})\b/);
  if (pairFallback) {
    const parsePacked = (v) => {
      if (v.length === 3) return { ft: parseInt(v.slice(0, 2), 10), inch: parseInt(v.slice(2), 10) };
      return { ft: parseInt(v.slice(0, 2), 10), inch: parseInt(v.slice(2), 10) };
    };
    const a = parsePacked(pairFallback[1]);
    const b = parsePacked(pairFallback[2]);
    if (a.inch < 12 && b.inch < 12) {
      out.push({
        width: a.ft + (a.inch / 12),
        height: b.ft + (b.inch / 12),
        unit: 'ft',
        raw: pairFallback[0]
      });
    }
  }

  return out;
};

const isValidDetection = (item) => (
  Number.isFinite(item.width) && Number.isFinite(item.height) &&
  item.width >= VALID_MIN_DIMENSION && item.height >= VALID_MIN_DIMENSION &&
  item.width <= VALID_MAX_DIMENSION && item.height <= VALID_MAX_DIMENSION
);

// H. dedup
export const deduplicate = (results) => {
  const seen = new Set();
  const deduped = [];
  for (const r of results) {
    const key = `${Math.round(r.width * 10) / 10}:${Math.round(r.height * 10) / 10}:${r.unit}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      ...r,
      width: Math.round(r.width * 10) / 10,
      height: Math.round(r.height * 10) / 10
    });
  }
  return deduped;
};

const makeSlidingWindows = (width, height) => {
  const windows = [];
  const w = Math.max(260, Math.floor(width * 0.35));
  const h = Math.max(40, Math.floor(height * 0.08));
  const stepX = Math.max(90, Math.floor(w * 0.45));
  const stepY = Math.max(24, Math.floor(h * 0.5));

  for (let y = 0; y < height - h; y += stepY) {
    for (let x = 0; x < width - w; x += stepX) {
      windows.push({ x, y, width: w, height: h });
    }
  }
  return windows;
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

export const parseSingleToken = (token) => {
  const normalized = normalize_text(token);

  const fi = normalized.match(/^\s*(\d+)\s*'\s*(\d+)?\s*"?\s*$/);
  if (fi) {
    const feet = parseInt(fi[1], 10);
    const inches = parseInt(fi[2] || '0', 10);
    if (inches < 12) return { value: feet + inches / 12, format: 'inches' };
  }

  const decFt = normalized.match(/^(\d+(?:\.\d+)?)\s*ft?$/);
  if (decFt) return { value: parseFloat(decFt[1]), format: 'decimal' };

  const decimalTick = normalized.match(/^(\d+(?:\.\d+)?)\s*'\s*$/);
  if (decimalTick) return { value: parseFloat(decimalTick[1]), format: 'decimal' };

  const explicitFtIn = normalized.match(/^(\d+)\s*(?:ft|feet)\s+(\d+)\s*(?:in|inch|inches)$/);
  if (explicitFtIn) {
    const feet = parseInt(explicitFtIn[1], 10);
    const inches = parseInt(explicitFtIn[2], 10);
    if (inches < 12) return { value: feet + inches / 12, format: 'inches' };
  }

  const spacedPair = normalized.match(/^(\d{1,3})\s+(\d{1,2})$/);
  if (spacedPair) {
    const feet = parseInt(spacedPair[1], 10);
    const inches = parseInt(spacedPair[2], 10);
    if (inches < 12) return { value: feet + inches / 12, format: 'inches' };
  }

  const meters = normalized.match(/^(\d+(?:\.\d+)?)\s*m$/);
  if (meters) return { value: parseFloat(meters[1]) * 3.28084, format: 'meters' };

  const packed = normalized.match(/^(\d{3,4})$/);
  if (packed) {
    const v = packed[1];
    const feet = parseInt(v.slice(0, v.length === 4 ? 2 : v.length - 1), 10);
    const inches = parseInt(v.slice(v.length === 4 ? 2 : v.length - 1), 10);
    if (inches < 12) return { value: feet + inches / 12, format: 'inches' };
  }

  const plain = normalized.match(/^(\d{1,2})$/);
  if (plain) return { value: parseInt(plain[1], 10), format: 'decimal' };

  return null;
};

export const parseDimensionLine = (line) => {
  const normalized = normalize_text(line);
  const parsed = extract_dimensions(line)[0];
  if (!parsed) {
    const parts = normalized.split(/\s*x\s/);
    if (parts.length === 2) {
      const l = parseSingleToken(parts[0].trim());
      const r = parseSingleToken(parts[1].trim());
      if (l && r) {
        return {
          width: l.value,
          height: r.value,
          text: normalized,
          format: l.format === 'inches' || r.format === 'inches' ? 'inches' : 'decimal'
        };
      }
    }

    const twoFi = normalized.match(/(\d+)\s*'\s*(\d+)\s*"?\s+(\d+)\s*'\s*(\d+)\s*"?/);
    if (twoFi) {
      return {
        width: parseInt(twoFi[1], 10) + parseInt(twoFi[2], 10) / 12,
        height: parseInt(twoFi[3], 10) + parseInt(twoFi[4], 10) / 12,
        text: normalized,
        format: 'inches'
      };
    }
    return null;
  }

  return {
    width: parsed.unit === 'm' ? parsed.width * 3.28084 : parsed.width,
    height: parsed.unit === 'm' ? parsed.height * 3.28084 : parsed.height,
    text: normalized,
    format: parsed.unit === 'm' ? 'meters' : (line.includes("'") ? 'inches' : 'decimal')
  };
};

export const inferDominantFormat = (dimensions) => {
  if (!dimensions?.length) return null;
  const counts = { inches: 0, decimal: 0, meters: 0 };
  for (const d of dimensions) {
    if (counts[d.format] !== undefined) counts[d.format] += 1;
  }
  if (counts.inches === 0 && counts.decimal === 0 && counts.meters === 0) return null;
  const max = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  return max || null;
};

const processRegionText = (text, bbox) => {
  const candidates = extract_dimensions(text)
    .filter(isValidDetection)
    .map((d) => ({
      width: d.unit === 'm' ? d.width * 3.28084 : d.width,
      height: d.unit === 'm' ? d.height * 3.28084 : d.height,
      unit: d.unit,
      raw: text,
      bbox,
      format: d.unit === 'm' ? 'meters' : (d.raw.includes("'") ? 'inches' : 'decimal')
    }));

  return candidates;
};

// main entry point
export const extract_floorplan_dimensions = async (imagePathOrDataUrl) => {
  const img = await dataUrlToImage(imagePathOrDataUrl);
  const scaleFactor = estimateScaleFactor(img);
  const scaled = scaleCanvas(img, scaleFactor);
  const ctx = scaled.getContext('2d');
  const imageData = ctx.getImageData(0, 0, scaled.width, scaled.height);

  const { binary, canvas: processedCanvas } = preprocess(imageData, scaled.width, scaled.height);
  const boxes = detect_text_regions(binary, scaled.width, scaled.height);

  const worker = await getWorker();
  const results = [];

  // C. OCR per region (not full image)
  for (const box of boxes) {
    const crop = cropCanvas(processedCanvas, box);
    const text = await ocr_region(worker, crop);
    const parsed = processRegionText(text, box);
    if (parsed.length > 0) results.push(...parsed);
  }

  // I. fallback sliding-window OCR pass for recall
  const windows = makeSlidingWindows(scaled.width, scaled.height);
  for (const box of windows) {
    const crop = cropCanvas(processedCanvas, box);
    const text = await ocr_region(worker, crop);
    if (!text || text.length < 5) continue;
    const parsed = processRegionText(text, box);
    if (parsed.length > 0) results.push(...parsed);
  }

  const cleaned = deduplicate(results).map((r, idx) => {
    const bbox = r.bbox ? {
      x: r.bbox.x / scaleFactor,
      y: r.bbox.y / scaleFactor,
      width: r.bbox.width / scaleFactor,
      height: r.bbox.height / scaleFactor
    } : { x: img.width / 2 - 100, y: img.height * 0.25 + idx * 70, width: 200, height: 40 };

    return {
      width: r.width,
      height: r.height,
      unit: r.unit,
      raw: r.raw,
      text: r.raw,
      bbox,
      format: r.format
    };
  });

  return cleaned;
};

export const detectAllDimensions = async (imageDataUrl) => {
  try {
    const dimensions = await extract_floorplan_dimensions(imageDataUrl);
    return { dimensions, detectedFormat: inferDominantFormat(dimensions) };
  } catch (error) {
    console.error('DimensionsOCR error:', error);
    return { dimensions: [], detectedFormat: null };
  }
};
