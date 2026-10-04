import { useMemo } from 'react';
import useAppStore, { selectActiveAreaByType } from '../store/appStore';
import { scaleQualitySummary } from '../utils/boundaryQuality';
import { summariseIssues } from '../utils/traceIssues';

/**
 * What a person cannot see by looking at the outline on the plan in front of
 * them: a doubtful scale, an area counted twice, a cut-out no longer taken off.
 *
 * `summariseIssues` is the only *producer* of that list, but it takes four
 * arguments and more than one surface reads it — the panel's Scale and Outline
 * sections and the phone's action bar — each of which used to gather them by
 * hand. One had already fallen a parameter behind (a scale held back while the
 * plan was parked), so the phone called a plan clean that the panel was
 * counting against. This is the one place the arguments are gathered.
 *
 * @returns {{count: number, issues: Array}}
 */
export function usePlanIssues() {
  const perimeterTraces = useAppStore((s) => s.perimeterTraces);
  const scaleQuality = useAppStore((s) => s.calibration?.quality);
  const areas = useAppStore(selectActiveAreaByType);
  // A scale this plan measured while parked was held back — a reason to doubt
  // the area like any other, so it counts with the rest.
  const needsRescale = useAppStore((s) => Boolean(s.documents?.[s.activeDocumentId]?.needsRescale));

  return useMemo(() => summariseIssues(
    perimeterTraces ?? [], scaleQualitySummary(scaleQuality), areas.doubleCounted, needsRescale,
  ), [perimeterTraces, scaleQuality, areas, needsRescale]);
}
