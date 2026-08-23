// The trace taxonomy, owned by one module because four consumers read it:
// floorManager, the area selector, LeftPanel and the serializer's normalizer.
// Array order is load-bearing twice — it is the order breakdown rows appear in,
// and the reading order a report expects (GLA first, non-living last).
export const TRACE_TYPES = [
  { id: 'gla', label: 'GLA', color: '#BD93F9' },
  { id: 'below-grade', label: 'Below grade', color: '#8BE9FD' },
  { id: 'garage', label: 'Garage', color: '#FFB86C' },
  { id: 'porch', label: 'Porch/patio', color: '#50FA7B' },
  { id: 'unfinished', label: 'Unfinished', color: '#F1FA8C' },
];

export const DEFAULT_TRACE_TYPE = 'gla';

const BY_ID = new Map(TRACE_TYPES.map((t) => [t.id, t]));

export const normalizeTraceType = (type) => (BY_ID.has(type) ? type : DEFAULT_TRACE_TYPE);

export const traceTypeLabel = (type) => BY_ID.get(normalizeTraceType(type)).label;

export const traceTypeColor = (type) => BY_ID.get(normalizeTraceType(type)).color;

// GLA keeps the storey numbering; everything else is named for what it is, so a
// garage stops arriving called "3rd Floor".
const TYPE_NOUN = {
  'below-grade': 'Basement',
  garage: 'Garage',
  porch: 'Porch',
  unfinished: 'Unfinished',
};

const FLOOR_NAME = /^(\d+)(?:st|nd|rd|th) Floor$/;
export const ordinalSuffix = (n) => (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');

const NOUNS = Object.values(TYPE_NOUN).join('|');
const AUTO_NAME = new RegExp(`^(?:\\d+(?:st|nd|rd|th) Floor|(?:${NOUNS})(?: \\d+)?)$`);

// Whether a name is one this module would have produced. Used to infer
// `nameSource` for traces saved before it existed — a name the user typed must
// never be overwritten by a type change.
export const isAutoTraceName = (name) => AUTO_NAME.test((name ?? '').trim());

// A name for `type` that does not collide with `others`. Storey numbering
// counts from the highest "Nth Floor" on hand rather than a module counter:
// a counter survives loadProject, so reopening a two-floor project used to
// start naming at "7th Floor".
export function autoTraceName(type, others = []) {
  const resolved = normalizeTraceType(type);
  const list = others || [];
  if (resolved === 'gla') {
    const highest = list.reduce((max, t) => {
      const match = FLOOR_NAME.exec(t?.name || '');
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    const num = Math.max(highest, list.length) + 1;
    return `${num}${ordinalSuffix(num)} Floor`;
  }
  const noun = TYPE_NOUN[resolved];
  const taken = new Set(list.map((t) => t?.name));
  if (!taken.has(noun)) return noun;
  for (let i = 2; i <= list.length + 2; i += 1) {
    if (!taken.has(`${noun} ${i}`)) return `${noun} ${i}`;
  }
  return noun;
}

// A two-storey house is two GLA traces, so type alone cannot drive colour: the
// hue says what kind of area it is and this lightness step separates floors
// within that kind. Negative mixes toward black, positive toward white; index 0
// is the table colour untouched, so a single-floor plan looks as it always did.
const SHADE_MIX = [0, -0.22, 0.30, -0.44, 0.55];

const clamp255 = (n) => Math.max(0, Math.min(255, Math.round(n)));

function shade(hex, nth) {
  const mix = SHADE_MIX[nth % SHADE_MIX.length];
  if (!mix) return hex;
  const num = parseInt(hex.slice(1), 16);
  const channels = [(num >> 16) & 255, (num >> 8) & 255, num & 255].map((c) => (
    mix < 0 ? c * (1 + mix) : c + (255 - c) * mix
  ));
  return `#${channels.map((c) => clamp255(c).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

// Pure and dependent only on list order. Rewrites `color` only where
// `colorSource === 'type'` — a hand-picked colour, and a colour inherited from
// before types existed, both survive.
export function assignTypeColors(traces) {
  if (!Array.isArray(traces)) return traces;
  const counts = new Map();
  return traces.map((t) => {
    const type = normalizeTraceType(t?.type);
    const nth = counts.get(type) ?? 0;
    counts.set(type, nth + 1);
    if (t?.colorSource !== 'type') return t;
    const color = shade(traceTypeColor(type), nth);
    return color === t.color ? t : { ...t, color };
  });
}

// Migration. `colorSource` defaults to 'user' exactly when there is no `type`
// to have derived a colour from, so a project saved before types keeps the
// colours the user last saw instead of collapsing every floor into one hue.
// `nameSource` is inferred from the name itself rather than defaulting: a trace
// still called "2nd Floor" was never renamed, and one called "Guest Wing" was.
// `typeSource` is inferred the same way: before automatic classification the
// only way a trace could hold a non-default type was the user picking it, and
// re-reading the plan must never take that back.
export function normalizeTraces(traces) {
  if (!Array.isArray(traces)) return traces;
  return assignTypeColors(traces.map((t) => (t && typeof t === 'object' ? {
    ...t,
    type: normalizeTraceType(t.type),
    typeSource: t.typeSource
      ?? (normalizeTraceType(t.type) === DEFAULT_TRACE_TYPE ? 'auto' : 'user'),
    colorSource: t.colorSource ?? (t.type ? 'type' : 'user'),
    nameSource: t.nameSource ?? (isAutoTraceName(t.name) ? 'auto' : 'user'),
  } : t)));
}

/**
 * One perimeter trace, with every field a new trace is born with.
 *
 * Written six times before this existed — twice in `appStore`, three times in
 * `floorManager`, once in `projectSerializer` — and the copies had already
 * begun to drift: the serializer's omitted `typeSource: 'auto'`, which is the
 * provenance flag that decides whether re-reading a plan may overwrite the
 * user's own classification. That is the field least able to afford a sixth
 * hand-maintained copy.
 *
 * `type` and `color` are resolved together on purpose: a caller that overrides
 * one and forgets the other is the next drift, so the colour is derived from
 * whatever type ends up applying rather than passed alongside it. Anything else
 * — `id`, `name`, `vertices`, `closed`, `quality`, `wallFaces`, `holes` — is a
 * plain override.
 */
export const makeTrace = ({ type = DEFAULT_TRACE_TYPE, ...rest } = {}) => ({
  name: '1st Floor',
  vertices: [],
  closed: false,
  visible: true,
  locked: false,
  type: normalizeTraceType(type),
  typeSource: 'auto',
  colorSource: 'type',
  nameSource: 'auto',
  color: traceTypeColor(type),
  ...rest,
});
