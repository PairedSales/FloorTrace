// How much there is to check, counted once. The Stats & warnings card's chip
// and the line the Area card points at it with are both this number, so the
// panel cannot say "2 things to check" beside the area and list three.

import { holeRings, isSubtracted } from './areaCalculator';
import { rankedWarnings } from './boundaryQuality';

// A void the outline has moved out from under is no longer subtracted, so the
// area quietly gained it back. Counted per outline, because one outline is
// what has to be retraced to settle it.
export const staleVoidCount = (trace) => {
  const list = trace?.holes ?? [];
  const rings = holeRings(list);
  return list.filter((h, i) => rings[i]?.length >= 3 && !isSubtracted(h)).length;
};

export const liveVoids = (trace) => {
  const list = trace?.holes ?? [];
  const rings = holeRings(list);
  return list.filter((h, i) => rings[i]?.length >= 3 && isSubtracted(h));
};

/**
 * `info` warnings describe how an outline was *reached* rather than a reason
 * to doubt what it enclosed, and are deliberately not counted — a clean plan
 * that also says "only one hypothesis" has to keep reading as clean.
 */
export const summariseIssues = (traces, scaleNote, doubleCounted) => {
  let count = 0;
  let level = 'ok';
  const bump = (severity) => {
    count += 1;
    if (severity === 'error') level = 'error';
    else if (level === 'ok') level = 'warn';
  };

  if (scaleNote?.level === 'check') bump('warn');
  for (let i = 0; i < (doubleCounted?.length ?? 0); i += 1) bump('warn');
  for (const trace of traces ?? []) {
    if (staleVoidCount(trace) > 0) bump('error');
    for (const w of rankedWarnings(trace?.quality?.warnings)) {
      if (w.severity !== 'info') bump(w.severity);
    }
  }
  return { count, level };
};
