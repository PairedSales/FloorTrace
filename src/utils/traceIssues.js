// What a person cannot see by looking at the outline on the plan — derived
// once, and the list under it derived from the same pass.
//
// FloorTrace used to list everything the detector doubted about an outline: a
// gap it had bridged, a stretch that followed no drawn wall, a room left
// outside. All of it described the picture the user was already looking at.
// The outline is drawn over the plan, and it is checked by eye — it is right
// or it is not, however the detector came by it. A list of "things to check"
// beside it said the same thing in words, counted against a figure the user had
// already verified, and trained people to skim past the one line that mattered.
//
// What is left is the short list a picture cannot show: the *number* is
// doubtful while the outline looks right. A scale the rooms disagree about, a
// scale that was held back, an area counted twice, a cut-out that is no longer
// taken off. `summariseIssues` is the only producer; the panel renders each
// entry inside the section it is about (Scale, Outline), and the phone's
// action bar counts the same list. The live surfaces reach it through
// `usePlanIssues`, which gathers its arguments in one place.
//
// The detector's own findings are still on every trace (`quality.warnings`),
// still saved with the plan and still scored by the benchmarks. Only what the
// user is told changed.

import { holeRings, isSubtracted } from './areaCalculator';

// A void the outline has moved out from under is no longer subtracted, so the
// area quietly gained it back. Counted per outline, because one outline is
// what has to be redrawn to settle it.
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

// A hidden outline's area has left every total, so its notes leave with it —
// they were reasons to doubt a number nobody is being shown.
const isVisible = (trace) => trace?.visible !== false;

/**
 * `kind` says which section an entry belongs to: `scale` and `rescale` are the
 * scale step's, `double-counted` and `stale-void` are the outline step's.
 *
 * `needsRescale` is a scale this plan measured while it was parked and that
 * was held back rather than applied late. It is a reason to doubt the area
 * like any other, so it counts.
 *
 * @returns {{count:number, issues:Array}}
 */
export const summariseIssues = (traces, scaleNote, doubleCounted, needsRescale = false) => {
  const issues = [];

  if (scaleNote?.level === 'check') {
    issues.push({
      kind: 'scale',
      label: scaleNote.short,
      detail: scaleNote.detail,
      remedy: scaleNote.remedy ?? null,
    });
  }

  if (needsRescale) {
    issues.push({
      kind: 'rescale',
      label: 'This plan’s scale was not applied',
      detail: 'Room sizes were read while you were on another plan, so the scale they give was held back rather than applied late.',
      remedy: 'Choose “Read the room sizes again” to measure this plan now.',
    });
  }

  // A garage or porch outlined inside the living-area outline: its floor is in
  // the living area and again in its own subtotal. Which of the two is wrong is
  // the user's call, so it is reported and never corrected.
  for (const pair of doubleCounted ?? []) {
    const named = pair?.innerName && pair?.outerName;
    issues.push({
      kind: 'double-counted',
      label: named ? `${pair.innerName} sits inside ${pair.outerName}` : 'One outline sits inside another',
      detail: 'Its area is counted twice — once as living area and once on its own.',
      remedy: named
        ? `Redraw ${pair.outerName} so that it leaves ${pair.innerName} out, or cut that area out of it with Outline ▸ Cut out an open area.`
        : 'Redraw the outer outline so that it leaves the inner one out, or cut that area out of it with Outline ▸ Cut out an open area.',
    });
  }

  for (const trace of (traces ?? []).filter(isVisible)) {
    // Once per outline however many cut-outs drifted, because one outline is
    // what has to be redrawn to settle all of them.
    const stale = staleVoidCount(trace);
    if (stale > 0) {
      issues.push({
        kind: 'stale-void',
        traceId: trace.id,
        count: stale,
        label: stale === 1
          ? 'A cut-out is no longer inside this outline'
          : `${stale} cut-outs are no longer inside this outline`,
        detail: 'It is no longer taken off the area. Redraw the outline, or delete the cut-out.',
      });
    }
  }

  return { count: issues.length, issues };
};
