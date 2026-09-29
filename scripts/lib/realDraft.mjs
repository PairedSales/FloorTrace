// A page image in, the plan the app would save after scanning it out
// (scripts/realDrafts.mjs). Each step is the app's own code, in the order the
// app runs it after a scan: read the labels, measure every labelled room,
// take the scale the rooms agree on, trace the exterior with those rooms as
// evidence, then judge the scale against the building it produced. The
// tracer's inputs come from `utils/traceInputs.js`, as in the app and in
// bench:real, so a draft replays there as it was made.
//
// Only the scan differs from the browser's: it is the Tesseract path, with no
// PaddleOCR rescue (browser-only), and given the time to finish. The app's
// budget is wall clock, and a harness that shares a machine with other work
// would lose labels to it without saying so.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { detectDimensionsCore } from '../../src/utils/dimensions/pipeline.js';
import { configureTesseract, terminateOcrWorker } from '../../src/utils/dimensions/ocrTesseract.js';
import { detectRoomFromClickCore, traceFloorplanBoundaryCore } from '../../src/utils/detection/pipeline.js';
import { ringSetArea } from '../../src/utils/detection/polygon.js';
import { selectProjectScale } from '../../src/utils/detection/scale.js';
import { boundaryConstraints, nonGlaExcludeRegions } from '../../src/utils/traceInputs.js';
import { classifyTraces } from '../../src/utils/traceClassification.js';
import { qualitySummary } from '../../src/utils/boundaryQuality.js';
import { assignTypeColors, autoTraceName, makeTrace, normalizeTraceType } from '../../src/utils/traceTypes.js';
import { MAX_IMAGE_DIMENSION } from '../../src/utils/imageLoader.js';
import { decodeImage, toOcrInput } from './benchUtils.mjs';
import { fetchSourceBytes } from './sourceNet.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// The language model the app serves itself, so a scan needs no download and
// reads with the same model as the browser.
configureTesseract({ langPath: path.join(ROOT, 'public', 'tesseract') });

const SCAN_BUDGET_MS = 60000;

export { terminateOcrWorker };

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

// What the app's crop tool writes (hooks/useCropTool.js): the image's own type,
// at the browser's default quality; PNG for anything else.
const ENCODINGS = { 'image/jpeg': ['jpeg', 92], 'image/webp': ['webp', 92] };

const cropImage = async (bytes, mime, [x, y, width, height]) => {
  const canvas = await import('@napi-rs/canvas');
  const image = await canvas.loadImage(bytes);
  const surface = canvas.createCanvas(width, height);
  surface.getContext('2d').drawImage(image, x, y, width, height, 0, 0, width, height);
  const [format, quality] = ENCODINGS[mime] ?? ['png'];
  return { bytes: await surface.encode(format, quality), mime: ENCODINGS[mime] ? mime : 'image/png' };
};

// What the app's loader holds (utils/imageLoader.js): a side over the cap is
// scaled to fit, and the result is PNG.
const fitImage = async (bytes, { width, height }) => {
  const canvas = await import('@napi-rs/canvas');
  const scale = Math.min(MAX_IMAGE_DIMENSION / width, MAX_IMAGE_DIMENSION / height);
  const surface = canvas.createCanvas(Math.round(width * scale), Math.round(height * scale));
  surface.getContext('2d').drawImage(await canvas.loadImage(bytes), 0, 0, surface.width, surface.height);
  return { bytes: await surface.encode('png'), mime: 'image/png' };
};

/**
 * A plan's image from its source, as the app would hold it: `{url}` or
 * `{file}` (relative to `baseDir`), cut to `crop: [x, y, width, height]` (in
 * the source's pixels) when the page holds more than the plan, then fitted to
 * the app's size cap. An answer key is coordinates on this image, so a source
 * that names a `size` must produce exactly that size, or no plan is made from
 * it; `source` is the record to keep, with the size it produced.
 */
export const loadSource = async (source, baseDir) => {
  let bytes;
  let mime;
  if (source.url) {
    // A page on archive.org comes through the sourcing tool's client: one
    // request at a time across the machine, spaced, and cached, so a draft
    // neither refetches what `realSource leaf` holds nor fires beside another
    // agent's request.
    ({ bytes, mime } = await fetchSourceBytes(source.url));
    mime ||= MIME[path.extname(new URL(source.url).pathname).toLowerCase()];
  } else if (source.file) {
    const file = path.resolve(baseDir, source.file);
    bytes = fs.readFileSync(file);
    mime = MIME[path.extname(file).toLowerCase()];
  } else {
    throw new Error('a source names a url or a file');
  }
  if (!mime?.startsWith('image/')) throw new Error(`not an image: ${source.url ?? source.file}`);
  if (source.crop) ({ bytes, mime } = await cropImage(bytes, mime, source.crop));
  let image = await decodeImage(bytes, mime);
  if (image.width > MAX_IMAGE_DIMENSION || image.height > MAX_IMAGE_DIMENSION) {
    ({ bytes, mime } = await fitImage(bytes, image));
    image = await decodeImage(bytes, mime);
  }
  if (source.size && (image.width !== source.size[0] || image.height !== source.size[1])) {
    throw new Error(`${source.url ?? source.file} is ${image.width}x${image.height}, `
      + `not the ${source.size[0]}x${source.size[1]} its key was drawn on`);
  }
  return { bytes, mime, image, source: { ...source, size: [image.width, image.height] } };
};

// The app's scan (DimensionsOCR.scanImage), Tesseract path.
export const scanImage = async (image) => {
  const result = await detectDimensionsCore(image, { toOcrInput, budgetMs: SCAN_BUDGET_MS });
  return {
    dimensions: result.dimensions,
    exteriorLabels: result.exteriorLabels,
    areaLabels: result.areaLabels,
    detectedFormat: result.detectedFormat ?? null,
    truncated: result.truncated ?? 0,
  };
};

// A parsed label's identity, as App.jsx keys it.
const labelKeyOf = (d) => `${d.text ?? ''}@${Math.round(d.bbox.x)},${Math.round(d.bbox.y)}`;

// App.runAutoScale's labels, measured as the detection worker's batch measures
// them: no scale prior, and every other label passed as a place this room is not.
const measureRooms = (image, dimensions) => {
  const labels = dimensions
    .filter((d) => d.bbox && d.width > 0 && d.height > 0)
    .map((d) => ({
      id: labelKeyOf(d),
      point: { x: d.bbox.x + d.bbox.width / 2, y: d.bbox.y + d.bbox.height / 2 },
      labelBbox: d.bbox,
      labelDims: { width: d.width, height: d.height },
    }));
  return labels.map((label, index) => {
    const room = detectRoomFromClickCore(image, label.point, {
      labelBbox: label.labelBbox,
      labelDims: label.labelDims,
      pixelsPerFoot: null,
      foreignPoints: labels.filter((_, i) => i !== index).map((l) => l.point),
    });
    return room ? { ...room, labelId: label.id, labelDims: label.labelDims } : null;
  }).filter(Boolean);
};

// useAutoScale.applyDecision, as the store records it.
const calibrationOf = (decision, at) => ({
  calibrated: true,
  feetPerPixel: { x: decision.feetPerPixel, y: decision.feetPerPixel },
  source: 'room-calibration',
  calibratedRoomId: null,
  createdAt: at,
  quality: {
    level: decision.level,
    reason: decision.reason,
    disagreement: decision.spread,
    adopted: true,
    roomCount: decision.roomCount,
    source: 'auto',
    areaRatio: decision.areaRatio ?? null,
    rejected: decision.rejected.map((r) => ({
      name: r.name, reason: r.reason, pixelsPerFoot: r.pixelsPerFoot ?? null,
    })),
  },
});

// App.applyTracedBoundary (outer faces), then traceManager.classifyTraceTypes.
const tracesOf = (traced, areaLabels) => {
  const floors = (traced?.floors?.length ? traced.floors : (traced ? [traced] : []))
    .filter((floor) => floor?.outer?.polygon?.length);
  const traces = [];
  floors.forEach((floor, i) => {
    traces.push(makeTrace({
      id: `trace-draft-${i + 1}`,
      name: autoTraceName('gla', traces),
      vertices: floor.outer.polygon.map((p) => ({ x: p.x, y: p.y })),
      holes: (floor.holes ?? []).map((hole, h) => ({
        id: `hole-auto-${h}`,
        ring: hole.map((p) => ({ x: p.x, y: p.y })),
        source: 'auto',
      })),
      closed: true,
      quality: {
        source: traced.quality?.source ?? 'auto',
        confidence: floor.confidence ?? traced.quality?.confidence ?? null,
        warnings: floor.warnings ?? [],
        alternatives: floor.alternatives ?? [],
      },
    }));
  });
  if (!areaLabels.length || !traces.length) return traces;
  const verdicts = new Map(classifyTraces(traces, areaLabels).map((v) => [v.id, v]));
  const typed = traces.map((trace, i) => {
    const verdict = verdicts.get(trace.id);
    if (!verdict) return trace;
    const type = normalizeTraceType(verdict.type);
    return {
      ...trace,
      type,
      typeSource: 'detected',
      typeEvidence: { keyword: verdict.keyword, text: verdict.text, from: verdict.from },
      name: autoTraceName(type, traces.filter((_, j) => j !== i)),
    };
  });
  return assignTypeColors(typed);
};

// App.tracedAreaPx: every floor, not the largest.
const tracedAreaPx = (traced) => {
  const floors = traced?.floors?.length ? traced.floors : (traced ? [traced] : []);
  return floors.reduce((sum, floor) => (
    floor?.outer?.polygon ? sum + ringSetArea(floor.outer.polygon, floor.holes ?? []) : sum
  ), 0);
};

/**
 * The saved state the app leaves behind once a scan's automatic pipeline has
 * run on `image`. `scan` is a scanImage result; it is a parameter so a test
 * can hand in labels without OCR.
 */
export const planState = (image, scan, { at = Date.now() } = {}) => {
  const { dimensions, exteriorLabels, areaLabels, detectedFormat } = scan;
  const state = {
    detectedDimensions: dimensions,
    exteriorLabels,
    areaLabels,
    rooms: [],
    calibration: { calibrated: false, feetPerPixel: null },
    ocrFailed: dimensions.length === 0,
    unit: detectedFormat === 'meters' ? 'metric' : (detectedFormat ?? 'decimal'),
  };
  const nonGlaRegions = exteriorLabels.map((l) => l.bbox);
  const measured = measureRooms(image, dimensions);
  const decision = measured.length ? selectProjectScale(measured, { nonGlaRegions }) : null;
  if (decision?.pixelsPerFoot > 0) {
    // Only the rooms that set the scale are recorded, as in useAutoScale.
    state.rooms = decision.contributors.map((c) => ({
      labelId: c.name,
      name: null,
      rect: c.rect,
      confidence: c.confidence,
      sides: c.sides,
      feetPerPixel: { x: 1 / c.pixelsPerFoot.x, y: 1 / c.pixelsPerFoot.y },
    }));
    state.calibration = calibrationOf(decision, at);
  }

  const traced = traceFloorplanBoundaryCore(image, {
    excludeRegions: nonGlaExcludeRegions(state),
    constraints: boundaryConstraints(state),
  });
  state.perimeterTraces = tracesOf(traced, areaLabels);
  state.activeTraceId = state.perimeterTraces[0]?.id ?? null;
  const floors = state.perimeterTraces.length;

  // useAutoScale.reviewAgainstFootprint: every measured room, with the building.
  const footprintAreaPx = tracedAreaPx(traced);
  if (decision?.pixelsPerFoot > 0 && footprintAreaPx > 0) {
    const reviewed = selectProjectScale(measured, { nonGlaRegions, footprintAreaPx });
    if (reviewed?.pixelsPerFoot > 0) state.calibration = calibrationOf(reviewed, at);
  }

  const summary = qualitySummary(traced?.quality);
  state.lastTraceOutcome = {
    at,
    level: floors ? summary.level : 'failed',
    reason: summary.reason ?? null,
    floors,
    source: 'auto',
  };
  return state;
};

/**
 * A `.floorplan` project around a plan's state and its image. `source` is
 * where the image came from, kept so the plan can be made again elsewhere; the
 * app does not write it, like the key's `answerKey` record.
 */
export const draftProject = ({ name, mime, bytes, state, source = null, at = Date.now() }) => {
  const stamp = new Date(at).toISOString();
  return {
    ...(source ? { source } : {}),
    fileType: 'floorplan',
    version: 1,
    metadata: { projectId: `real-${name}`, projectName: name, createdAt: stamp, updatedAt: stamp },
    globalSettings: { canvasRotation: 0 },
    floors: [{
      id: 'floor-1',
      name: '1st Floor',
      state: {
        imageRef: 'img-1',
        imageMimeType: mime,
        projectName: name,
        roomOverlay: null,
        mode: 'normal',
        ...state,
      },
    }],
    activeFloorId: 'floor-1',
    images: { 'img-1': `data:${mime};base64,${bytes.toString('base64')}` },
  };
};

/** A draft plan from a source: loaded, scanned, measured, calibrated, traced. */
export const draftFromSource = async (name, source, baseDir) => {
  const loaded = await loadSource(source, baseDir);
  const scan = await scanImage(loaded.image);
  const project = draftProject({
    name, mime: loaded.mime, bytes: loaded.bytes, source: loaded.source, state: planState(loaded.image, scan),
  });
  return { project, scan };
};
