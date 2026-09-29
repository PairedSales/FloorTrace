// How a real plan's answer key is turned into truth masks, and how a trace is
// scored against them: one definition for `bench:real` (scripts/realBenchmark.mjs)
// and for anything that must reach the same verdict from the same outlines,
// such as a key tool scoring the app's outlines (docs: datasets/README.md).
//
// Moved out of realBenchmark.mjs unchanged. The verdict itself is
// `lib/verdict.mjs`; this file is only how truth masks are built from outlines
// (integrity rule 1: neither changes without a new scoreboard).
import { decodeImage } from './benchUtils.mjs';
import { fillPolygon } from './cubicasa.mjs';
import { scoreMask } from './verdict.mjs';

// Truth-mask resolution, in image px per cell.
export const CELL = 2;
// GLA and below-grade outlines are the building (a basement is still traced;
// its type decides the total, not the tracer); garage and porch/patio are
// non-GLA; unfinished is space the drawing does not decide, so it is not scored.
export const BUILDING = new Set(['gla', 'below-grade']);
export const NON_GLA = new Set(['garage', 'porch']);
export const UNSCORED = new Set(['unfinished']);

// The saved image as `{width, height, data}`.
export const decodeDataUrl = (dataUrl) => {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl ?? '');
  if (!match) throw new Error('the project holds no image');
  return decodeImage(Buffer.from(match[3], match[2] ? 'base64' : 'utf8'), match[1]);
};

export const holeRing = (hole) => (Array.isArray(hole) ? hole : hole?.ring);

/**
 * The truth masks of a plan's outlines on a grid of `image.width` x
 * `image.height` px (only the size is read). `traces` are `{type, vertices,
 * holes?}`, a vertex `{x, y}` or `[x, y]`; a hole is subtracted unless stale.
 */
export const answerKey = (traces, image) => {
  const width = Math.ceil(image.width / CELL);
  const height = Math.ceil(image.height / CELL);
  const footprint = new Uint8Array(width * height);
  const nonGla = new Uint8Array(width * height);
  const ignore = new Uint8Array(width * height);
  const paint = (mask, trace) => {
    fillPolygon(mask, width, height, trace.vertices, { cell: CELL });
    for (const hole of trace.holes ?? []) {
      if (hole?.stale || !(holeRing(hole)?.length >= 3)) continue;
      fillPolygon(mask, width, height, holeRing(hole), { cell: CELL, value: 0 });
    }
  };
  for (const trace of traces) {
    const type = trace.type ?? 'gla';
    if (BUILDING.has(type)) paint(footprint, trace);
    else if (NON_GLA.has(type)) paint(nonGla, trace);
    else if (UNSCORED.has(type)) paint(ignore, trace);
  }
  let cells = 0;
  for (let i = 0; i < footprint.length; i += 1) cells += footprint[i];
  return {
    grid: { width, height, cell: CELL },
    footprint,
    nonGla,
    ignore,
    cells,
    outlines: traces.map((t) => ({ type: t.type ?? 'gla', vertices: t.vertices })),
  };
};

// An outline as `answerKey` reads it, from either shape an outline is kept in:
// the app's trace `{type, vertices: [{x, y}], holes?}` or an exported key
// `{type, points: [[x, y]], holes?: [[[x, y]]]}` (`realKeys.keyOf`).
const traceOf = (outline) => ({
  type: outline.type,
  vertices: outline.vertices ?? outline.points.map(([x, y]) => ({ x, y })),
  holes: outline.holes ?? [],
});

/**
 * `answerKey` from outlines in either shape, for a caller that holds a key or
 * the app's outlines and the image's size, not the image. An outline of fewer
 * than three points, or one the app marks not closed, is no outline, as
 * `bench:real` reads them from a project.
 */
export const answerKeyFromOutlines = (outlines, imageSize) => answerKey(
  outlines.filter((o) => o.closed !== false).map(traceOf).filter((t) => t.vertices?.length >= 3),
  imageSize,
);

// The cells an app trace covers: each floor's outer polygon less its holes.
export const tracedMask = (result, truth) => {
  const { width, height, cell } = truth.grid;
  const mask = new Uint8Array(width * height);
  const floors = result?.floors?.length
    ? result.floors.filter((f) => f.outer).map((f) => ({ outer: f.outer.polygon, holes: f.holes ?? [] }))
    : (result?.outer ? [{ outer: result.outer.polygon, holes: result.holes ?? [] }] : []);
  for (const floor of floors) {
    fillPolygon(mask, width, height, floor.outer, { cell });
    for (const hole of floor.holes) fillPolygon(mask, width, height, hole, { cell, value: 0 });
  }
  return { mask, floors };
};

// The verdict on a trace result, with the detector's confidence and warnings
// and the rings it drew (a warning of severity `info` is not one).
export const scoreTrace = (result, truth, ms) => {
  const { mask, floors } = tracedMask(result, truth);
  return {
    ...scoreMask(mask, truth),
    floors: floors.length,
    confidence: Number((result?.quality?.confidence ?? 0).toFixed(3)),
    warnings: [...new Set((result?.quality?.warnings ?? [])
      .filter((w) => w.severity !== 'info')
      .map((w) => w.code))],
    ms,
    rings: floors.map((f) => f.outer.map((p) => [Math.round(p.x), Math.round(p.y)])),
  };
};
