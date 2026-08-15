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
export function normalizeTraces(traces) {
  if (!Array.isArray(traces)) return traces;
  return assignTypeColors(traces.map((t) => (t && typeof t === 'object' ? {
    ...t,
    type: normalizeTraceType(t.type),
    colorSource: t.colorSource ?? (t.type ? 'type' : 'user'),
  } : t)));
}
