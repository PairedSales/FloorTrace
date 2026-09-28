// The real set's answer keys as data apart from their plans
// (scripts/realKeys.mjs). Pure, so the rule that matters — an outline someone
// corrected is never replaced without `force` — is tested without the set.
import { assignTypeColors, autoTraceName, makeTrace } from '../../src/utils/traceTypes.js';
import { newTraceId } from '../../src/store/ids.js';

export const KEYS_VERSION = 1;

// The outlines an answer key is read from: the filter bench:real applies.
const keyed = (traces) => (traces ?? []).filter((t) => t?.closed && t.vertices?.length >= 3);

// The app's own trace, untouched: detector output nobody edited, retyped or
// renamed. A hand-drawn outline carries no detector quality at all.
export const untouched = (trace) => Boolean(trace?.quality)
  && trace.quality.source !== 'manual'
  && !trace.quality.edited
  && trace.typeSource !== 'user'
  && trace.nameSource !== 'user';

const round = (v) => Math.round(v * 10) / 10;
const toRing = (points) => points.map((p) => [round(p.x), round(p.y)]);
const holeRing = (hole) => (Array.isArray(hole) ? hole : hole?.ring);

// A plan's answer key as data, or null while its outlines are still the app's
// untouched trace: a draft is not an answer.
export const keyOf = (state) => {
  const traces = keyed(state?.perimeterTraces);
  if (!traces.length || traces.every(untouched)) return null;
  return traces.map((t) => {
    const outline = { type: t.type ?? 'gla', points: toRing(t.vertices) };
    const holes = (t.holes ?? []).filter((h) => !h?.stale && holeRing(h)?.length >= 3);
    if (holes.length) outline.holes = holes.map((h) => toRing(holeRing(h)));
    if (t.nameSource === 'user') outline.name = t.name;
    return outline;
  });
};

// The app records a trace's level as a string, and its importer refuses a plan
// holding anything else. The real set's drafts were written outside the app
// with `level: null`, so none of them opened. What the level was is unknown, so
// it is dropped, not guessed; true when there was one to drop.
export const repairOutcome = (state) => {
  const outcome = state?.lastTraceOutcome;
  if (!outcome || !('level' in outcome) || typeof outcome.level === 'string') return false;
  delete outcome.level;
  return true;
};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Writes `outlines` into a plan's state as the app holds outlines a person drew
// and typed. 'kept' when the plan already holds a different answer, which only
// `force` replaces.
export const applyKey = (state, outlines, { force = false } = {}) => {
  const current = keyOf(state);
  if (current && same(current, outlines)) return 'unchanged';
  if (current && !force) return 'kept';
  const traces = [];
  for (const o of outlines) {
    traces.push(makeTrace({
      id: newTraceId(),
      type: o.type,
      name: o.name ?? autoTraceName(o.type, traces),
      nameSource: o.name ? 'user' : 'auto',
      typeSource: 'user',
      vertices: o.points.map(([x, y]) => ({ x, y })),
      holes: (o.holes ?? []).map((h) => h.map(([x, y]) => ({ x, y }))),
      closed: true,
      quality: { source: 'manual', confidence: null, warnings: [], edited: true },
    }));
  }
  state.perimeterTraces = assignTypeColors(traces);
  state.activeTraceId = traces[0]?.id ?? null;
  return 'applied';
};

// Everything `apply` does to one saved plan. `about` is the key's record of who
// drew it (the plan's `answerKey`), and it goes wherever the key goes: a plan
// that keeps its own outlines keeps its own record, so a key drawn for review
// never arrives looking like one a person checked. `write` is whether the plan
// changed.
export const applyPlan = (project, outlines, about, { force = false } = {}) => {
  const state = project?.floors?.[0]?.state;
  if (!state) return { outcome: 'missing', repaired: false, write: false };
  const outcome = applyKey(state, outlines, { force });
  if (outcome === 'applied') {
    if (about) project.answerKey = about;
    else delete project.answerKey;
  }
  const repaired = repairOutcome(state);
  return { outcome, repaired, write: outcome === 'applied' || repaired };
};
