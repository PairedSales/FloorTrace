import { useMemo } from 'react';
import useAppStore, { selectActiveAreaByType } from '../store/appStore';
import { scaleQualitySummary } from '../utils/boundaryQuality';
import { summariseIssues } from '../utils/traceIssues';

/**
 * How much there is to check on the plan in front of the user, and the list.
 *
 * `summariseIssues` is the only *producer* of that answer, but it takes five
 * arguments and three surfaces were calling it — the panel's figure, its
 * checks and the phone's action bar — each gathering the five by hand. One of
 * them had already fallen a parameter behind (a scale held back while the plan
 * was parked), so the phone called a plan clean that the panel was counting
 * against. This is the one place the arguments are gathered.
 *
 * Anything that is handed a state rather than subscribing to the live store —
 * the exhibit — still calls `summariseIssues` itself, on that state.
 *
 * @returns {{count: number, level: 'ok'|'warn'|'error', issues: Array, scaleNote: object|null}}
 */
export function usePlanIssues() {
  const perimeterTraces = useAppStore((s) => s.perimeterTraces);
  const scaleQuality = useAppStore((s) => s.calibration?.quality);
  const areas = useAppStore(selectActiveAreaByType);
  const lastTraceOutcome = useAppStore((s) => s.lastTraceOutcome);
  // A scale this plan measured while parked was held back — a reason to doubt
  // the area like any other, so it counts with the rest.
  const needsRescale = useAppStore((s) => Boolean(s.documents?.[s.activeDocumentId]?.needsRescale));

  return useMemo(() => {
    const scaleNote = scaleQualitySummary(scaleQuality);
    return {
      ...summariseIssues(perimeterTraces ?? [], scaleNote, areas.doubleCounted, lastTraceOutcome, needsRescale),
      scaleNote,
    };
  }, [perimeterTraces, scaleQuality, areas, lastTraceOutcome, needsRescale]);
}
