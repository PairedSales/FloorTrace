import { qualitySummary } from './boundaryQuality';

// floorManager hands out seven trace colours, so seven is the ceiling. Written
// here because three surfaces gate on it and two of them used to disagree: the
// command bar refused an eighth outline, the Trace menu offered it, and the
// dock's `+` hid itself.
export const MAX_TRACES = 7;

/**
 * One derivation of "where is this plan in the pipeline", read by the top bar
 * — which decides which verb carries the primary weight — and by the dock's
 * StageSpine, which prints the same four stages.
 *
 * They used to disagree about the outline stage in a way that mattered. The
 * command bar called a plan outlined when `perimeterOverlay` held vertices,
 * which is the *detector's* most recent overlay; the dock counted
 * `perimeterTraces`, which is what the area is computed from. The area is the
 * number on the report, so it is the one that decides.
 *
 * `primary` is deliberately null once an outline exists, even a good one.
 * Export is the next thing to do at that point, but it is styled `ready` and
 * never filled: a filled accent over a `fair` trace is a wrong answer that
 * looks green, in the one part of the shell a user reads before anything else.
 */
export function planStage({
  image,
  calibrated,
  scaleNeedsCheck = false,
  perimeterTraces = [],
  area = 0,
  doubleCounted = 0,
}) {
  const tracedCount = perimeterTraces.filter((t) => t.vertices?.length >= 3).length;
  const levels = perimeterTraces
    .filter((t) => t.quality)
    .map((t) => qualitySummary(t.quality).level);

  const outline = tracedCount === 0
    ? 'todo'
    : levels.some((l) => l === 'poor' || l === 'failed' || l === 'fair') ? 'warn' : 'done';
  const report = area > 0
    ? ((doubleCounted > 0 || outline === 'warn') ? 'warn' : 'done')
    : 'todo';

  const primary = !image ? null
    : !calibrated ? 'scale'
      : tracedCount === 0 ? 'outline'
        : null;

  return {
    tracedCount,
    primary,
    canAddOutline: tracedCount > 0 && perimeterTraces.length < MAX_TRACES,
    stages: [
      { id: 'plan', label: 'Plan', state: image ? 'done' : 'todo',
        title: image ? 'A plan is loaded' : 'Open or paste a floorplan' },
      { id: 'scale', label: 'Scale',
        state: calibrated ? (scaleNeedsCheck ? 'warn' : 'done') : 'todo',
        title: calibrated ? 'The scale is set' : 'Read dimensions, or set the scale by hand' },
      { id: 'outline', label: 'Outline', state: outline,
        title: tracedCount === 0 ? 'No outline traced yet' : `${tracedCount} outline(s) traced` },
      { id: 'report', label: 'Report', state: report,
        title: area > 0 ? 'An area is available' : 'No area yet' },
    ],
  };
}
