// Wall-clock spans for the automatic pipeline (image dropped -> area on screen).
//
// The app shipped no browser timing at all, so every performance figure about
// this path came from the Node harnesses — which pass no `cacheKey` and so
// measure a configuration the browser never runs (a room click costs a full
// cold trace there, 1-5 ms here). DEV-only, and a no-op everywhere else: the
// marks exist to make a change provable, not to ship a profiler.

const ENABLED = Boolean(import.meta.env?.DEV)
  && typeof performance !== 'undefined'
  && typeof performance.mark === 'function';

export const MARKS = {
  imageSet: 'ft:image-set',
  scanStart: 'ft:scan-start',
  scanEnd: 'ft:scan-end',
  measureEnd: 'ft:measure-end',
  traceEnd: 'ft:trace-end',
  areaReady: 'ft:area-ready',
};

// Worker-side costs can't be marked from here; the worker reports them on the
// message envelope and they are accumulated per run instead.
let workerMs = { decode: 0, decodes: 0 };

// Latest-wins: a re-trace re-marks, and `getEntriesByName(...)[0]` would
// otherwise read the first run's timestamp and report a span minutes long.
export const perfMark = (name) => {
  if (!ENABLED) return;
  performance.clearMarks(name);
  performance.mark(name);
};

export const perfResetRun = () => {
  if (!ENABLED) return;
  workerMs = { decode: 0, decodes: 0 };
  for (const name of Object.values(MARKS)) performance.clearMarks(name);
};

export const perfRecordWorker = (envelope) => {
  if (!ENABLED || !envelope) return;
  if (envelope.decodeMs > 0) {
    workerMs.decode += envelope.decodeMs;
    workerMs.decodes += 1;
  }
};

const spanOf = (from, to) => {
  const a = performance.getEntriesByName(from)[0];
  const b = performance.getEntriesByName(to)[0];
  return a && b ? b.startTime - a.startTime : null;
};

/**
 * Emit the run's breakdown. Called once the area is on screen, so a span that
 * reads null is a stage that did not run (an OCR failure, a trace that bailed)
 * rather than a missing mark.
 */
export const perfReportRun = () => {
  if (!ENABLED) return;
  const rows = [
    ['ingest  (drop -> scan start)', spanOf(MARKS.imageSet, MARKS.scanStart)],
    ['step 2  OCR scan', spanOf(MARKS.scanStart, MARKS.scanEnd)],
    ['step 4  measure rooms', spanOf(MARKS.scanEnd, MARKS.measureEnd)],
    ['step 5  trace exterior', spanOf(MARKS.measureEnd, MARKS.traceEnd)],
    ['step 6  apply + area', spanOf(MARKS.traceEnd, MARKS.areaReady)],
    ['TOTAL   drop -> area', spanOf(MARKS.imageSet, MARKS.areaReady)],
  ].filter(([, ms]) => ms !== null);
  if (!rows.length) return;

  for (const [label, ms] of rows) {
    performance.measure(`ft: ${label.trim()}`, { start: 0, duration: ms });
  }
  console.debug(
    '[perf] image-load-to-area\n'
    + rows.map(([label, ms]) => `  ${label.padEnd(30)} ${ms.toFixed(0).padStart(6)} ms`).join('\n')
    + (workerMs.decodes
      ? `\n  (worker image decode ${workerMs.decode.toFixed(0)} ms over ${workerMs.decodes} request${workerMs.decodes === 1 ? '' : 's'})`
      : ''),
  );
  // Consume the run. A later manual re-trace then reports only the spans it
  // actually re-ran, instead of pairing a fresh traceEnd with this run's drop.
  perfResetRun();
};
