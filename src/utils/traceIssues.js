// How much there is to check, derived once — and the list under it, derived
// from the same pass. Four surfaces used to answer this question separately and
// disagree in both directions: the dock's chip, the Area card's line, the
// exhibit's flag list and the mobile bar's warning triangle. `summariseIssues`
// is now the only producer; everything else renders `issues`.

import { holeRings, isSubtracted } from './areaCalculator';
import { rankedWarnings, qualitySummary, RESULT_SCOPED_CODES } from './boundaryQuality';

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

// A hidden outline's area has left every total, so its warnings must leave the
// count with it — they were reasons to doubt a number nobody is being shown.
const isVisible = (trace) => trace?.visible !== false;

/**
 * `info` warnings describe how an outline was *reached* rather than a reason
 * to doubt what it enclosed, and are deliberately not counted — a clean plan
 * that also says "only one hypothesis" has to keep reading as clean.
 *
 * An `acknowledged` warning is one a person has checked against the plan and
 * accepted. It keeps its row and its anchor and prints on the exhibit as
 * reviewed; it stops counting, because a count that can only ever go up is a
 * count people stop reading — and the only other way down is destroying the
 * evidence.
 *
 * @returns {{count:number, level:'ok'|'warn'|'error', issues:Array}}
 */
export const summariseIssues = (traces, scaleNote, doubleCounted, lastTraceOutcome) => {
  const issues = [];
  let level = 'ok';
  const bump = (issue) => {
    issues.push(issue);
    if (issue.severity === 'error') level = 'error';
    else if (level === 'ok') level = 'warn';
  };

  if (scaleNote?.level === 'check') {
    bump({ kind: 'scale', severity: 'warn', label: scaleNote.short, detail: scaleNote.detail });
  }

  for (const pair of doubleCounted ?? []) {
    bump({ kind: 'double-counted', severity: 'warn', label: 'Counted twice', detail: pair?.detail ?? null, pair });
  }

  // A trace that ran and produced nothing writes no trace object, so without
  // this the panel says "every outline came back clean" about zero outlines.
  if (lastTraceOutcome && (lastTraceOutcome.level === 'failed' || lastTraceOutcome.level === 'poor')) {
    bump({
      kind: 'trace-outcome',
      severity: 'error',
      label: lastTraceOutcome.level === 'failed' ? 'The last trace found no outline' : 'The last trace was rejected',
      detail: lastTraceOutcome.reason ?? null,
    });
  }

  // Whole-drawing findings are fanned onto every floor, so counting them per
  // trace reported one problem N times on an N-outline plan. Collected by code
  // and detail, and bumped once at the end.
  const resultScoped = new Map();

  for (const trace of (traces ?? []).filter(isVisible)) {
    // Once per outline however many voids drifted, because one outline is what
    // has to be retraced to settle all of them.
    const stale = staleVoidCount(trace);
    if (stale > 0) {
      bump({
        kind: 'stale-void',
        severity: 'error',
        traceId: trace.id,
        count: stale,
        label: stale === 1
          ? 'A void is no longer inside this outline'
          : `${stale} voids are no longer inside this outline`,
      });
    }

    let counted = 0;
    let accepted = 0;
    for (const w of rankedWarnings(trace?.quality?.warnings)) {
      if (w.severity === 'info') continue;
      // Scope decides *before* acknowledgement, and that order is load-bearing
      // twice. A whole-drawing finding is one finding wearing N copies, so it
      // is accepted when any copy is — the panel prints one row, and the row a
      // person cleared must not come back because a sibling outline still
      // carries an untouched copy of it. And it is not this outline's warning,
      // so it must not feed `accepted` below: clearing a note about the *sheet*
      // would otherwise delete a doubt about *this polygon*, which is the
      // count-goes-down-by-destroying-evidence failure in miniature.
      if (RESULT_SCOPED_CODES.has(w.code)) {
        const key = `${w.code}|${w.detail ?? ''}`;
        const seen = resultScoped.get(key);
        // `index` only means anything paired with the trace it indexes into,
        // so the two travel together — a caller holding the index alone would
        // acknowledge whatever sits at that position on the active outline.
        if (!seen) resultScoped.set(key, { w, traceId: trace.id, acknowledged: !!w.acknowledged });
        else if (w.acknowledged && !seen.acknowledged) {
          resultScoped.set(key, { w, traceId: trace.id, acknowledged: true });
        }
        continue;
      }
      if (w.acknowledged) { accepted += 1; continue; }
      counted += 1;
      bump({ kind: 'warning', severity: w.severity, traceId: trace.id, code: w.code, label: w.label, detail: w.detail, remedy: w.remedy, index: w.index });
    }

    // A doubtful outline always contributes at least one thing to check, even
    // when it carries no warning to say why. That band is not hypothetical: it
    // exists by construction between QUALITY_GOOD and the weak-wall-support
    // trigger, and 2 of the 9 real fixtures land in it — reported "check it"
    // by the toast while this panel said "All clear".
    // Gated on a quality record existing at all: an outline the user placed by
    // hand was never assessed, which is not the same as one assessed and found
    // wanting. `qualitySummary(undefined)` reports 'failed', so without this
    // every hand-drawn outline would count as a thing to check.
    // Gated on `accepted` too: this fires for an outline carrying no warning to
    // say why it is doubtful, and one whose warnings a person has checked
    // against the plan is not that. Without it, acknowledging the last warning
    // on a fair outline swapped one row for another and the count never moved,
    // which is the monotonic count this whole mechanism exists to break.
    const q = trace?.quality ? qualitySummary(trace.quality) : null;
    if (counted === 0 && accepted === 0 && q && (q.level === 'fair' || q.level === 'poor' || q.level === 'failed')) {
      bump({
        kind: 'low-confidence',
        severity: q.level === 'fair' ? 'warn' : 'error',
        traceId: trace.id,
        label: 'Little of this outline sits on a drawn wall',
        detail: q.percent === null
          ? 'The detector could not say how much of this outline follows wall that is actually drawn.'
          : `Only ${q.percent}% of this outline sits on wall the plan actually draws. Compare it to the plan before you use the area.`,
      });
    }
  }

  for (const { w, traceId, acknowledged } of resultScoped.values()) {
    if (acknowledged) continue;
    bump({ kind: 'warning', severity: w.severity, scope: 'result', traceId, code: w.code, label: w.label, detail: w.detail, remedy: w.remedy, index: w.index });
  }

  return { count: issues.length, level, issues };
};
