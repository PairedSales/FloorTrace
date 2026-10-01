/**
 * How many runner-up outlines the search left for the active outline.
 *
 * Not offered on an outline a saved plan carries as edited by hand: once the
 * geometry is the user's, a runner-up scored against the detector's own is no
 * longer an alternative to it.
 */
export const alternativeCount = (traces, activeTraceId) => {
  const active = (traces ?? []).find((t) => t.id === activeTraceId);
  return active?.quality?.edited ? 0 : (active?.quality?.alternatives?.length ?? 0);
};

/**
 * "Where is this plan in the pipeline", read by the mobile shell's action bar
 * to decide which single verb to offer. (The desktop shell does not name
 * pipeline stages at all: the pipeline runs by itself when a plan opens, and
 * its corrections live beside the result each one corrects.)
 *
 * The outline stage counts `perimeterTraces`, which is what the area is
 * computed from, rather than the detector's most recent overlay.
 *
 * **The verb never repeats the action that just failed.** A scan that came back
 * empty is memoised, so pressing "Read the room sizes" again is a guaranteed
 * no-op; a trace the detector could not read will not read it on a second
 * identical pass either. `ocrFailed` and `lastTraceOutcome` are what tell "it
 * ran and produced nothing" from "nobody has tried": a failed scan sends the
 * user to the known length, and a failed trace offers nothing here — the panel
 * says why and keeps the retry.
 *
 * @returns {{tracedCount: number,
 *   primary: null|'scale'|'scale-manual'|'outline'}}
 */
export function planStage({
  image,
  calibrated,
  perimeterTraces = [],
  lastTraceOutcome = null,
  ocrFailed = false,
}) {
  const tracedCount = perimeterTraces
    .filter((t) => t.visible !== false && t.vertices?.length >= 3).length;
  const traceFailed = lastTraceOutcome?.level === 'failed' || lastTraceOutcome?.level === 'poor';

  const primary = !image ? null
    : !calibrated ? (ocrFailed ? 'scale-manual' : 'scale')
      : tracedCount === 0 ? (traceFailed ? null : 'outline')
        : null;

  return { tracedCount, primary };
}
