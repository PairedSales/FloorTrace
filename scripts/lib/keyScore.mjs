// The verdict of a set of outlines against a plan's answer key
// (scripts/realKeyTool.mjs `score`), by the code `bench:real` judges by: the
// truth masks are `answerKeyFromOutlines`, the traced mask is `tracedMask`
// (through `scoreTrace`) and the verdict is `scoreMask` (lib/realScore.mjs,
// lib/verdict.mjs). Nothing of them is copied here; this file only reads what
// an app checker hands over and words what comes back. The app checker uses it
// to score the outlines it read from the running app's state.
//
// FILE, in one of these shapes (JSON):
//   (a) the app's outlines: {"outlines": [{"type", "vertices": [{x, y}, ...] |
//       "points": [[x, y], ...], "holes"?, "closed"?}, ...], "confidence"?: 0.93,
//       "warnings"?: ["code", ...]}, or a bare array of such outlines;
//   (b) rings only: {"rings": [[[x, y], ...], ...], "confidence"?, "warnings"?},
//       each ring a traced floor's outer polygon, as `bench:real` records in a
//       run file's `app.rings` (holes absent).
// The traced mask is the union of the building-type outlines (gla, below-grade;
// an outline with no type is gla) less their holes, on the truth grid, filled
// as `bench:real` fills `result.floors`: a ring list gives exactly the mask
// `bench:real` builds from the floors it traced. Garage, porch and unfinished
// outlines are not the trace and are left out, and said so.
import { QUALITY_GOOD, qualityLevel } from '../../src/utils/boundaryQuality.js';
import {
  BUILDING, answerKeyFromOutlines, holeRing, scoreTrace,
} from './realScore.mjs';

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const pointOf = (p) => {
  if (Array.isArray(p) && p.length >= 2 && isNum(p[0]) && isNum(p[1])) return { x: p[0], y: p[1] };
  if (isNum(p?.x) && isNum(p?.y)) return { x: p.x, y: p.y };
  return null;
};

// A ring as `{x, y}` points; null when it is not a list of points at all. The
// points must be `{x, y}` because `scoreTrace` reads them so.
const ringOf = (ring) => {
  if (!Array.isArray(ring)) return null;
  const points = ring.map(pointOf);
  return points.every(Boolean) ? points : null;
};

// Warning codes as `scoreTrace` reads them: `{code, severity}`, where `info`
// is not one. A bare string is a code with the severity the app would show.
const warningsOf = (list, what) => {
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new Error(`${what}: "warnings" must be an array of codes`);
  return list.map((w, i) => {
    if (typeof w === 'string' && w) return { code: w, severity: 'warn' };
    if (typeof w?.code === 'string' && w.code) return { code: w.code, severity: w.severity ?? 'warn' };
    throw new Error(`${what}: warnings[${i}] is neither a code nor {"code", "severity"}`);
  });
};

/**
 * What an app checker's FILE holds, as the `result` `scoreTrace` reads:
 * `{result: {floors: [{outer: {polygon}, holes}]}, counted, left, confidence,
 * warnings}`. `counted` and `left` list the outlines that are, and are not,
 * the trace (`{index, type}`, `left` with the `why`). Throws on a file that
 * holds no outlines or rings or one that is not a ring of points, naming it.
 */
export const tracedOfJson = (json, what = 'the file') => {
  const isList = Array.isArray(json);
  if (!isList && (json === null || typeof json !== 'object')) {
    throw new Error(`${what} must be {"outlines": [...]} or {"rings": [...]}, or a bare array of outlines`);
  }
  const body = isList ? { outlines: json } : json;
  if (body.outlines !== undefined && body.rings !== undefined) throw new Error(`${what}: give "outlines" or "rings", not both`);
  if (!Array.isArray(body.outlines) && !Array.isArray(body.rings)) {
    throw new Error(`${what} holds no "outlines" or "rings" (expected {"outlines": [...]}, {"rings": [[[x, y], ...], ...]} or a bare array of outlines)`);
  }
  let confidence = null;
  if (body.confidence !== undefined && body.confidence !== null) {
    if (!(isNum(body.confidence) && body.confidence >= 0 && body.confidence <= 1)) {
      throw new Error(`${what}: "confidence" must be a number from 0 to 1 (0.93 is 93%), not ${JSON.stringify(body.confidence)}`);
    }
    confidence = body.confidence;
  }
  const warnings = warningsOf(body.warnings, what);
  const floors = [];
  const counted = [];
  const left = [];
  if (Array.isArray(body.rings)) {
    body.rings.forEach((r, k) => {
      const polygon = ringOf(r);
      if (!polygon || polygon.length < 3) throw new Error(`${what}: ring ${k} is not a list of at least 3 [x, y] points`);
      floors.push({ outer: { polygon }, holes: [] });
      counted.push({ index: k, type: 'gla' });
    });
  } else {
    body.outlines.forEach((o, k) => {
      if (o === null || typeof o !== 'object' || Array.isArray(o)) throw new Error(`${what}: outline ${k} is not an object {"type", "vertices"|"points"}`);
      const type = o.type ?? 'gla';
      const ringKey = o.vertices !== undefined ? 'vertices' : 'points';
      const polygon = ringOf(o[ringKey]);
      if (!polygon) throw new Error(`${what}: outline ${k} (${type}) has no "vertices" or "points" that are [x, y] or {x, y}`);
      if (o.closed === false) left.push({ index: k, type, why: 'not closed' });
      else if (polygon.length < 3) left.push({ index: k, type, why: 'fewer than 3 points' });
      else if (!BUILDING.has(type)) left.push({ index: k, type, why: 'not a building type' });
      else {
        // A hole is subtracted unless stale, as `answerKey` reads a plan's own.
        const holes = (o.holes ?? [])
          .filter((h) => !h?.stale && holeRing(h)?.length >= 3)
          .map((h) => ringOf(holeRing(h)))
          .filter(Boolean);
        floors.push({ outer: { polygon }, holes });
        counted.push({ index: k, type });
      }
    });
  }
  const result = { floors, quality: { confidence: confidence ?? 0, warnings } };
  return {
    result, counted, left, confidence, warnings,
  };
};

// Vertices of the counted rings that lie beyond the page (a hair past the
// edge is a plan cut by its crop): a file whose coordinates are on another
// scale than the plan's own image scores as if the trace were wrong.
const OFF_PAGE = 2;
const outsideCount = (floors, image) => {
  let n = 0;
  for (const f of floors) {
    for (const p of f.outer.polygon) {
      if (p.x < -OFF_PAGE || p.y < -OFF_PAGE || p.x > image.width + OFF_PAGE || p.y > image.height + OFF_PAGE) n += 1;
    }
  }
  return n;
};

/**
 * The verdict of `traced` (from `tracedOfJson`) against the key held by
 * `keyOutlines` (a plan's `perimeterTraces`, or an exported key) on an image of
 * `imageSize` px. Returns `scoreMask`'s figures (verdict, iou, areaErr,
 * overNonGla, overOther, missed, regions, scoredAreaPx) and: `floors` (rings
 * counted), `key` (the key's outline types), `counted` and `left`,
 * `confidence` (null when none was given), `level` (the app's word for it),
 * `warnings`, `wrongButShownGood` (`verdict === 'wrong'` and confidence at
 * least `QUALITY_GOOD`; null with no confidence), `outside` and `notes`.
 */
export const scoreAgainstKey = (keyOutlines, imageSize, traced) => {
  const truth = answerKeyFromOutlines(keyOutlines, imageSize);
  if (!truth.cells) throw new Error('the key holds no gla or below-grade outline to hold a trace against');
  const scored = scoreTrace(traced.result, truth, 0);
  // `scoreTrace` reports what the app shows, rounded as the run files round it.
  const confidence = traced.confidence === null ? null : scored.confidence;
  const notes = [];
  if (!traced.result.floors.length) notes.push('the file holds no gla or below-grade outline: nothing was traced');
  if (traced.left.length) {
    const byWhy = traced.left.map((l) => `outline ${l.index} ${l.type} (${l.why})`);
    notes.push(`left out of the traced area: ${byWhy.join(', ')}; only gla and below-grade outlines are the trace`);
  }
  const outside = outsideCount(traced.result.floors, imageSize);
  if (outside) notes.push(`${outside} point(s) of the traced outlines lie beyond the plan's ${imageSize.width} x ${imageSize.height} px image: are the outlines on the plan's own image, at its scale?`);
  if (confidence === null) notes.push('no confidence given, so wrong-but-shown-good cannot be said');
  return {
    verdict: scored.verdict,
    iou: scored.iou,
    areaErr: scored.areaErr,
    overNonGla: scored.overNonGla,
    overOther: scored.overOther,
    missed: scored.missed,
    regions: scored.regions,
    scoredAreaPx: scored.scoredAreaPx,
    floors: scored.floors,
    key: truth.outlines.map((o) => o.type),
    counted: traced.counted,
    left: traced.left,
    confidence,
    level: confidence === null ? null : qualityLevel(confidence),
    warnings: scored.warnings,
    wrongButShownGood: confidence === null ? null : scored.verdict === 'wrong' && confidence >= QUALITY_GOOD,
    outside,
    notes,
  };
};

const pct1 = (x) => `${(x * 100).toFixed(1)}%`;
const signed = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const CAUSE = { nonGla: 'non-GLA space kept', other: 'other space taken in', missed: 'living space missed' };
const typeCounts = (types) => {
  const counts = {};
  for (const t of types) counts[t] = (counts[t] ?? 0) + 1;
  return Object.entries(counts).map(([t, n]) => (n > 1 ? `${t} x${n}` : t)).join(', ') || 'none';
};

/** The lines `score` prints for `scoreAgainstKey`'s result. */
export const scoreLines = (name, r, { keyRecord = null } = {}) => {
  const lines = [];
  const size = r.areaErr === null ? '' : `   area error ${signed(r.areaErr)} (${r.areaErr >= 0 ? 'the outlines cover more than' : 'the outlines cover less than'} the key's building)`;
  lines.push(`score ${name}: verdict ${r.verdict.toUpperCase()}   IoU ${r.iou === null ? 'n/a' : `${(r.iou * 100).toFixed(2)}%`}${size}`);
  lines.push(`key: ${typeCounts(r.key)}${keyRecord ? `   (${keyRecord})` : ''}`);
  lines.push(`traced: ${r.floors} floor(s) from ${typeCounts(r.counted.map((c) => c.type))}`);
  lines.push(`error by cause, as a share of the key's building area: non-GLA space kept ${pct1(r.overNonGla)}, other space taken in ${pct1(r.overOther)}, living space missed ${pct1(r.missed)}`);
  if (r.regions.length) {
    lines.push(`error regions, largest first: ${r.regions.map((g) => `${CAUSE[g.cause] ?? g.cause} ${pct1(g.share)}`).join(', ')}`);
  } else lines.push('error regions: none of a size to fix');
  if (r.confidence === null) lines.push('confidence: not given');
  else {
    lines.push(`confidence ${(r.confidence * 100).toFixed(1)}% (${r.level})${r.wrongButShownGood ? `   WRONG BUT SHOWN AS GOOD: the verdict is wrong at a confidence of ${(QUALITY_GOOD * 100).toFixed(0)}% or more` : (r.wrongButShownGood === false && r.verdict === 'wrong' ? '   wrong, and not shown as good' : '')}`);
  }
  if (r.warnings.length) lines.push(`warnings: ${r.warnings.join(', ')}`);
  for (const note of r.notes) lines.push(`note: ${note}`);
  return lines;
};
