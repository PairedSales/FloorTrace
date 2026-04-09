import { pointInPolygon, pointInBbox } from './roomSegmentation';

/* ------------------------------------------------------------------ */
/*  OCR text → room assignment                                         */
/* ------------------------------------------------------------------ */

/**
 * Assign OCR result items to rooms.
 *
 * Each OCR result has `{ text, bbox: { x, y, w, h } }`.
 * For each item the centre point is computed and tested against
 * every room contour (point-in-polygon).  Falls back to bounding-box
 * containment if the contour test fails.
 *
 * Mutates room.assignedTexts in-place (appends matching OCR items).
 *
 * @param {Array<Room>}       rooms
 * @param {Array<OcrResult>}  ocrResults
 * @returns {{ assigned: number, unassigned: Array<OcrResult> }}
 */
export const assignTextToRooms = (rooms, ocrResults) => {
  if (!rooms?.length || !ocrResults?.length) {
    return { assigned: 0, unassigned: ocrResults ?? [] };
  }

  let assigned = 0;
  const unassigned = [];

  for (const ocr of ocrResults) {
    const center = {
      x: ocr.bbox.x + ocr.bbox.w / 2,
      y: ocr.bbox.y + ocr.bbox.h / 2,
    };

    let matched = false;

    // Try point-in-polygon first
    for (const room of rooms) {
      if (pointInPolygon(room.contour, center)) {
        room.assignedTexts.push(ocr);
        assigned += 1;
        matched = true;
        break;
      }
    }

    // Fallback: bounding-box containment
    if (!matched) {
      for (const room of rooms) {
        if (pointInBbox(room.bbox, center)) {
          room.assignedTexts.push(ocr);
          assigned += 1;
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      unassigned.push(ocr);
    }
  }

  return { assigned, unassigned };
};

/* ------------------------------------------------------------------ */
/*  Dimension parsing                                                  */
/* ------------------------------------------------------------------ */

/**
 * Parse a dimension string like `13' 5" x 12' 11"` or `13'5" x 12'11"`.
 *
 * Returns `{ widthInches, heightInches }` or `null` if parsing fails.
 *
 * Supported formats:
 *   - `13' 5" x 12' 11"`      (feet + inches with spaces)
 *   - `13'5" x 12'11"`         (feet + inches without spaces)
 *   - `13' x 12'`              (feet only)
 *   - `13.5' x 12.25'`         (decimal feet)
 *   - `165" x 155"`            (inches only)
 *
 * @param {string} text
 * @returns {{ widthInches: number, heightInches: number } | null}
 */
export const parseDimensions = (text) => {
  if (!text || typeof text !== 'string') return null;

  // Normalise unicode quotes and clean up
  const cleaned = text
    .replace(/[\u2018\u2019\u2032]/g, "'")   // smart quotes / prime → '
    .replace(/[\u201C\u201D\u2033]/g, '"')   // smart quotes / double-prime → "
    .replace(/\u00D7/g, 'x')                 // × → x
    .trim();

  // Split on 'x' or 'X' separator (with optional whitespace)
  const parts = cleaned.split(/\s*[xX]\s*/);
  if (parts.length !== 2) return null;

  const parseSingleDimension = (raw) => {
    const s = raw.trim();

    // Pattern: feet ' [inches "]
    const feetInchesMatch = s.match(/^(\d+(?:\.\d+)?)\s*'\s*(\d+(?:\.\d+)?)?\s*"?$/);
    if (feetInchesMatch) {
      const feet = parseFloat(feetInchesMatch[1]);
      const inches = feetInchesMatch[2] ? parseFloat(feetInchesMatch[2]) : 0;
      return feet * 12 + inches;
    }

    // Pattern: feet only
    const feetOnlyMatch = s.match(/^(\d+(?:\.\d+)?)\s*'$/);
    if (feetOnlyMatch) {
      return parseFloat(feetOnlyMatch[1]) * 12;
    }

    // Pattern: inches only
    const inchesOnlyMatch = s.match(/^(\d+(?:\.\d+)?)\s*"$/);
    if (inchesOnlyMatch) {
      return parseFloat(inchesOnlyMatch[1]);
    }

    return null;
  };

  const widthInches = parseSingleDimension(parts[0]);
  const heightInches = parseSingleDimension(parts[1]);

  if (widthInches === null || heightInches === null) return null;
  if (widthInches <= 0 || heightInches <= 0) return null;

  return { widthInches, heightInches };
};

/* ------------------------------------------------------------------ */
/*  Scale computation                                                  */
/* ------------------------------------------------------------------ */

/**
 * Try to parse dimension text from assigned OCR items for a room.
 * Looks for dimension-like strings and attaches the first valid
 * parse to `room.parsedDimensions`.
 *
 * @param {Room} room
 */
export const parseDimensionsForRoom = (room) => {
  if (!room.assignedTexts?.length) return;

  for (const ocr of room.assignedTexts) {
    const parsed = parseDimensions(ocr.text);
    if (parsed) {
      room.parsedDimensions = parsed;
      return;
    }
  }
};

/**
 * Compute the image scale (inches per pixel) by comparing OCR-derived
 * real-world dimensions with pixel bounding-box sizes.
 *
 * Averages across all rooms that have valid dimension data.
 *
 * @param {Array<Room>} rooms
 * @returns {{ scaleX: number, scaleY: number, meanScale: number, stdScale: number, samples: number } | null}
 */
export const computeScale = (rooms) => {
  const samples = [];

  for (const room of rooms) {
    parseDimensionsForRoom(room);
    if (!room.parsedDimensions) continue;

    const { widthInches, heightInches } = room.parsedDimensions;
    const bboxW = room.bbox.maxX - room.bbox.minX;
    const bboxH = room.bbox.maxY - room.bbox.minY;

    if (bboxW <= 0 || bboxH <= 0) continue;

    // The OCR dimension might not align with bbox orientation,
    // so try both assignments and pick the one closer to square ratio
    const sx1 = widthInches / bboxW;
    const sy1 = heightInches / bboxH;
    const sx2 = heightInches / bboxW;
    const sy2 = widthInches / bboxH;

    const ratio1 = Math.max(sx1 / sy1, sy1 / sx1);
    const ratio2 = Math.max(sx2 / sy2, sy2 / sx2);

    if (ratio1 <= ratio2) {
      samples.push({ scaleX: sx1, scaleY: sy1 });
    } else {
      samples.push({ scaleX: sx2, scaleY: sy2 });
    }
  }

  if (samples.length === 0) return null;

  const avgX = samples.reduce((s, v) => s + v.scaleX, 0) / samples.length;
  const avgY = samples.reduce((s, v) => s + v.scaleY, 0) / samples.length;
  const meanScale = (avgX + avgY) / 2;

  // Standard deviation of all scale values
  const allScales = samples.flatMap((s) => [s.scaleX, s.scaleY]);
  const variance = allScales.reduce((s, v) => s + (v - meanScale) ** 2, 0) / allScales.length;
  const stdScale = Math.sqrt(variance);

  return {
    scaleX: avgX,
    scaleY: avgY,
    meanScale,
    stdScale,
    samples: samples.length,
  };
};
