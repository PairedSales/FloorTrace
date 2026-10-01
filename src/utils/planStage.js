import { qualitySummary } from './boundaryQuality';

// traceManager hands out seven trace colours, so seven is the ceiling. Written
// here because every surface that offers "add an outline" gates on it, and they
// used to disagree: one refused an eighth outline while another offered it.
export const MAX_TRACES = 7;

/**
 * How many runner-up outlines the search left for the active outline.
 *
 * Offered only on an outline the detector produced and the user has not since
 * edited: once the geometry is theirs, a runner-up scored against the
 * detector's own is no longer an alternative to it.
 */
export const alternativeCount = (traces, activeTraceId) => {
  const active = (traces ?? []).find((t) => t.id === activeTraceId);
  return active?.quality?.edited ? 0 : (active?.quality?.alternatives?.length ?? 0);
};

/**
 * One derivation of "where is this plan in the pipeline", read by the mobile
 * shell's action bar to decide which single verb to offer. (The desktop shell
 * no longer names pipeline stages at all: the pipeline runs by itself when a
 * plan opens, and its corrections live beside the result each one corrects.)
 *
 * The outline stage counts `perimeterTraces`, which is what the area is
 * computed from, rather than the detector's most recent overlay. The area is
 * the number on the report, so it is the one that decides.
 *
 * **A stage has four outcomes, not three.** `todo`/`done`/`warn` could not tell
 * "nobody has tried" from "it ran and produced nothing", so after a failed
 * trace the spine read exactly as it does on a fresh plan and the primary verb
 * still pointed at the action that had just failed — which, for a scan, hits a
 * memoised empty result and fails identically. `failed` is that fifth state,
 * and it is what makes `primary` offer a *different* route rather than the one
 * that did not work.
 *
 * `issues` is the summary from `summariseIssues`, passed in rather than
 * re-derived: this used to band on confidence alone, so a stale void made the
 * area too large while Outline and Report both stayed green.
 */
export function planStage({
  image,
  calibrated,
  scaleNeedsCheck = false,
  perimeterTraces = [],
  area = 0,
  doubleCounted = 0,
  issues = null,
  lastTraceOutcome = null,
  ocrFailed = false,
}) {
  const visible = perimeterTraces.filter((t) => t.visible !== false);
  const tracedCount = visible.filter((t) => t.vertices?.length >= 3).length;
  const levels = visible
    .filter((t) => t.quality)
    .map((t) => qualitySummary(t.quality).level);

  const traceFailed = lastTraceOutcome?.level === 'failed' || lastTraceOutcome?.level === 'poor';
  // Anything the panel is counting is a reason this plan is not finished, and
  // the spine must not read green above it.
  const flagged = (issues?.count ?? 0) > 0 || doubleCounted > 0;

  const outline = tracedCount === 0
    ? (traceFailed ? 'failed' : 'todo')
    : (levels.some((l) => l === 'poor' || l === 'failed' || l === 'fair') || flagged) ? 'warn' : 'done';
  const report = area > 0
    ? ((doubleCounted > 0 || outline === 'warn' || flagged) ? 'warn' : 'done')
    : 'todo';
  const scale = calibrated
    ? (scaleNeedsCheck ? 'warn' : 'done')
    : (ocrFailed ? 'failed' : 'todo');

  // The instruction never repeats the action that just failed. A scan that
  // came back empty is memoised, so pressing "Read dimensions" again is a
  // guaranteed no-op; a trace the detector could not read will not read it on
  // a second identical pass either.
  const primary = !image ? null
    : !calibrated ? (ocrFailed ? 'scale-manual' : 'scale')
      : tracedCount === 0 ? (traceFailed ? 'outline-paint' : 'outline')
        : null;

  return {
    tracedCount,
    primary,
    canAddOutline: tracedCount > 0 && perimeterTraces.length < MAX_TRACES,
    stages: [
      { id: 'plan', label: 'Plan', state: image ? 'done' : 'todo',
        title: image ? 'A plan is loaded' : 'Open or paste a floorplan' },
      { id: 'scale', label: 'Scale', state: scale,
        title: calibrated
          ? (scaleNeedsCheck ? 'The scale needs checking' : 'The scale is set')
          : (ocrFailed
            ? 'No dimensions could be read — set the scale by hand'
            : 'Read dimensions, or set the scale by hand') },
      { id: 'outline', label: 'Outline', state: outline,
        title: tracedCount === 0
          ? (traceFailed ? 'The last trace produced no usable outline' : 'No outline traced yet')
          : `${tracedCount} outline(s) traced` },
      { id: 'report', label: 'Report', state: report,
        title: area > 0 ? 'An area is available' : 'No area yet' },
    ],
  };
}
