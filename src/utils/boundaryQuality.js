// How a traced boundary's quality is presented. The detector emits a
// confidence and a list of reasons it might be wrong; this decides what the
// user is told and whether the result is offered as a finished answer or as
// something to check.

export const QUALITY_GOOD = 0.75;
export const QUALITY_POOR = 0.5;

export const qualityLevel = (confidence) => {
  if (!(confidence > 0)) return 'failed';
  if (confidence >= QUALITY_GOOD) return 'good';
  if (confidence >= QUALITY_POOR) return 'fair';
  return 'poor';
};

export const detailText = (warning) => {
  const d = warning.detail;
  if (!d) return warning.message;
  if (warning.code === 'bridged-opening') return `a ${d.px}px opening was bridged to close the outline`;
  if (warning.code === 'room-outside' && d.name) return `the ${d.name} room falls outside the traced outline`;
  if (warning.code === 'label-outside') return `${d.count} labelled area${d.count === 1 ? '' : 's'} fall outside the traced outline`;
  if (warning.code === 'floors-rejected') return `${d.count} closed outline${d.count === 1 ? ' was' : 's were'} judged not to be buildings`;
  // Said as what changed, not as which pass ran: the pass name means nothing to
  // the person reading it, and the count is the reason to trust the second
  // answer over the first.
  if (warning.code === 'remediated') {
    return `the first outline left ${d.of - d.heldBefore} of ${d.of} known areas outside, `
      + `so it was traced again — this one leaves ${d.of - d.heldAfter}`;
  }
  return warning.message;
};

// Ordered by how wrong the square footage is if the warning is right, not by
// the order the detector happened to push them. The first group means the area
// cannot be trusted at all; the second means it is wrong by a knowable amount;
// the third describes how the outline was reached rather than what it enclosed.
// Anything unlisted sorts last but is still reportable.
const WARNING_RANK = new Map([
  'no-boundary',
  'floor-empty',
  'unsealed',
  'self-intersecting',
  'covers-page',
  'floors-overlap',
  'inner-not-nested',

  'room-outside',
  'label-outside',
  'wall-left-outside',
  'annexation',
  'incomplete-enclosure',
  'brush-mismatch',
  'bridged-opening',
  'thin-structure-excluded',
  'tiny-floor',
  'inner-over-inset',

  'weak-wall-support',
  'heavy-closing',
  'drawn-freehand',
  'no-inner',
  'floors-rejected',
  'remediated',
  'no-alternative',
].map((code, i) => [code, i]));

const UNRANKED = 999;
const severityRank = (severity) => (severity === 'error' ? 0 : 1);
const warningRank = (w) => severityRank(w.severity) * 1000 + (WARNING_RANK.get(w.code) ?? UNRANKED);

// Every code the detector is known to emit, in rank order. Exported so a guard
// test can assert each one either resolves a canvas anchor or is declared
// unanchorable — a warning added later must not become silently unclickable.
export const WARNING_CODES = [...WARNING_RANK.keys()];

// Warnings that describe the whole drawing rather than one floor. The panel
// groups them under their own divider so a three-floor plan does not read as
// three separate problems. Derived from the code, not only read from the tag
// the detector attaches: the `.floorplan` schema types a warning's known fields
// and drops the rest, so a reopened project arrives without `scope`.
export const RESULT_SCOPED_CODES = new Set([
  'label-outside', 'floors-rejected', 'no-alternative', 'no-boundary', 'remediated',
]);

const LABELS = new Map(Object.entries({
  unsealed: 'Outline never closed',
  'weak-wall-support': 'Weak wall support',
  'bridged-opening': 'Opening bridged',
  'heavy-closing': 'Heavy closing',
  annexation: 'Reaches past its walls',
  'wall-left-outside': 'Wall left outside',
  'thin-structure-excluded': 'Thin structure excluded',
  'incomplete-enclosure': 'Incomplete enclosure',
  'floors-rejected': 'Outlines rejected',
  'no-boundary': 'No outline traced',
  'floor-empty': 'Floor has no polygon',
  'self-intersecting': 'Outline crosses itself',
  'covers-page': 'Covers the page',
  'tiny-floor': 'Very small outline',
  'inner-not-nested': 'Interior not nested',
  'inner-over-inset': 'Interior inset far',
  'no-inner': 'No interior envelope',
  'floors-overlap': 'Floors overlap',
  'room-outside': 'Room outside',
  'label-outside': 'Label outside',
  'no-alternative': 'Only one hypothesis',
  'brush-mismatch': 'Does not match your outline',
  'drawn-freehand': 'Freehand section',
  remediated: 'Traced again',
}));

// A short headline for one warning. An unlisted code still gets a readable one
// rather than being hidden, matching how WARNING_RANK treats it.
export const warningLabel = (code) => LABELS.get(code)
  ?? String(code ?? '').replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

// Every warning, worst first, in the shape the panel renders. `index` is the
// position in the source array, not in this one: it is what identifies the
// warning to focus, so re-ranking can never point the highlight at a different
// warning than the one that was clicked.
export const rankedWarnings = (warnings) => (warnings ?? [])
  .map((w, index) => ({
    index,
    code: w.code,
    severity: w.severity ?? 'warn',
    label: warningLabel(w.code),
    detail: detailText(w),
    scope: w.scope ?? (RESULT_SCOPED_CODES.has(w.code) ? 'result' : 'floor'),
  }))
  .sort((a, b) => warningRank(a) - warningRank(b));

// The single most important reason to doubt this trace, or null. Taken from
// the same ranked list the panel expands, so the collapsed line and the list
// cannot disagree about which warning is worst.
export const primaryWarning = (warnings) =>
  rankedWarnings(warnings).find((w) => w.severity !== 'info')?.detail ?? null;

// How the scale a room set is presented. The area is the number the user acts
// on, so every message here says what the disagreement means for the area
// rather than describing the geometry that produced it.
const percentApart = (logDistance) => Math.round((Math.exp(logDistance) - 1) * 100);

// Nothing derived from the sample scatter is reported as a margin of error.
// Measured across the fixtures, the spread of the rooms that set a scale and
// the scale's actual error are uncorrelated: 1.8% scatter against 3.1% error on
// one plan, 37% scatter against 0.6% error on another. What is reported instead
// is what was observed — how many rooms agreed, and how far apart they were.
const roomsPhrase = (count) => `${count} room${count === 1 ? '' : 's'}`;

const autoScaleSummary = (quality) => {
  const rooms = roomsPhrase(quality.roomCount ?? 0);
  const apart = percentApart(quality.disagreement ?? 0);

  if (quality.reason === 'too-few-rooms') {
    return {
      level: 'check',
      short: `Scale from ${rooms}`,
      detail: `Only ${rooms} on this plan could be measured well enough to set the `
        + 'scale, so nothing outvoted them. Areas rest on that — check one room’s '
        + 'outline against its label, or click a dimension to set the scale from a '
        + 'room you trust.',
    };
  }
  if (quality.reason === 'rooms-disagree') {
    return {
      level: 'check',
      short: `Rooms disagree by ~${apart}%`,
      detail: `The ${rooms} used to set the scale imply sizes about ${apart}% apart, `
        + 'which is more than printed dimensions normally vary. The middle of them is '
        + 'in use. Check the outlines, or click a dimension to set the scale from one '
        + 'room.',
    };
  }
  if (quality.reason === 'area-implausible') {
    return {
      level: 'check',
      short: 'Areas look too small for these rooms',
      detail: 'At this scale the traced building comes out smaller than the rooms its '
        + 'own labels describe, so the scale is probably too high and every area too '
        + 'small. Click a dimension on a plainly rectangular room to set the scale '
        + 'from it instead.',
    };
  }
  // auto-consensus: worth stating, never worth worrying about. The area is read
  // long after any toast, and "where did this number come from" stays asked.
  //
  // The visible line is the room count alone. The spread belongs in the detail:
  // rooms that set a good scale can still span 30% (ExampleFloorplan6 does, and
  // lands 0.4% from truth), and "agreeing within 30%" reads as a claim of
  // precision that the number itself contradicts.
  return {
    level: 'note',
    short: `Scale from ${rooms}`,
    detail: `The scale was measured from ${rooms} on this plan rather than one, and is `
      + `the middle of what they imply — individually they span about ${apart}%, which `
      + 'is normal for printed dimensions. Click a dimension to set the scale from a '
      + 'single room instead.',
  };
};

// The verdicts a single room's measurement produces, as opposed to a whole
// scan's. Disjoint from the reasons autoScaleSummary knows.
const ROOM_REASONS = new Set(['room-vs-auto', 'room-vs-project', 'room-internal']);

// A scale the user asserted by drawing a line. Unlike every other source this
// has a clean case worth stating: a hand-set scale that looks identical to an
// OCR-set one is the same class of failure as a doubtful trace that looks green.
const lineScaleSummary = (quality) => {
  const pct = percentApart(quality.disagreement ?? 0);

  if (quality.reason === 'line-vs-rooms') {
    const areaPct = Math.round((Math.exp(2 * (quality.disagreement ?? 0)) - 1) * 100);
    return {
      level: quality.level === 'check' ? 'check' : 'note',
      short: `Scale set by hand, areas ~${areaPct}% different`,
      detail: `The line you drew implies a scale about ${pct}% from the rooms the app `
        + `measured itself, which moves every area by roughly ${areaPct}%. Your line is `
        + 'in use. Clear it to go back to the measured average.',
    };
  }

  if (quality.reason === 'scale-anisotropic') {
    return {
      level: 'note',
      short: `Across and down differ by ~${pct}%`,
      detail: `Your two lines say the drawing is about ${pct}% more stretched across than `
        + 'down. Both are in use, so areas are unaffected — only side lengths follow the '
        + 'direction they run.',
    };
  }

  if (quality.reason === 'short-line') {
    return {
      level: 'note',
      short: 'Scale set by hand from a short line',
      detail: `The line is only ${quality.lengthPx} px long, so a pixel of click error is `
        + `about ${pct}%. Draw it along the longest wall you can identify, or zoom in first.`,
    };
  }

  const from = quality.lineCount === 2
    ? 'two lines you drew, one across and one down'
    : `a ${Number((quality.feet ?? 0).toFixed(2))} ft line you drew`;
  return {
    level: 'note',
    short: 'Scale set by hand',
    detail: `The scale comes from ${from}`
      + (quality.lineCount === 2 ? '.' : ', applied to both directions.'),
  };
};

export const scaleQualitySummary = (quality) => {
  if (!quality) return null;
  // Reason before source: a room the project outvoted leaves the pooled scale
  // in force, so its source is 'auto', but what needs saying is that this room
  // was not used — not where the surviving scale came from.
  if (quality.source === 'auto' && !ROOM_REASONS.has(quality.reason)) {
    return autoScaleSummary(quality);
  }
  // Before the early return below, deliberately: a clean line calibration has
  // no `reason`, so placed after it this branch would render nothing — and
  // that panel line is the only durable statement of where the number came
  // from once the toast has gone.
  if (quality.source === 'line') {
    return lineScaleSummary(quality);
  }
  if (quality.level === 'ok' || !quality.reason) return null;
  const pct = percentApart(quality.disagreement ?? 0);

  // The user picked one room out of a set the app had already measured. Their
  // choice stands, but the area moves with the square of the scale, so a gap
  // that reads as unremarkable between two rooms is not unremarkable in the
  // number they are about to act on — say what it did.
  if (quality.reason === 'room-vs-auto') {
    const areaPct = Math.round((Math.exp(2 * (quality.disagreement ?? 0)) - 1) * 100);
    const rooms = roomsPhrase(quality.roomCount ?? 0);
    return {
      level: quality.level === 'check' ? 'check' : 'note',
      short: `Scale from this room, areas ~${areaPct}% different`,
      detail: `This room implies a scale about ${pct}% from the ${rooms} the app measured `
        + `itself, which moves every area by roughly ${areaPct}%. Your choice is in use. `
        + 'Re-scan to go back to the measured average.',
    };
  }

  if (quality.reason === 'room-vs-project') {
    const rooms = `${quality.roomCount} room${quality.roomCount === 1 ? '' : 's'}`;
    return quality.adopted
      ? {
        level: 'check',
        short: 'This room disagrees with the last one',
        detail: `This room is about ${pct}% out from the ${rooms} measured before it, `
          + 'and the newer measurement is the one now in use. One of the two outlines '
          + 'or labels is wrong — measure a third room to settle it.',
      }
      : {
        level: 'check',
        short: 'Kept the scale from earlier rooms',
        detail: `This room implies a scale about ${pct}% different from the ${rooms} `
          + 'measured before it, so it was not used — areas are unchanged. Check this '
          + 'room’s outline and label.',
      };
  }

  // room-internal
  return quality.level === 'check'
    ? {
      level: 'check',
      short: `Areas may be off by ~${pct}%`,
      detail: `This room’s outline and its label disagree by about ${pct}% about how `
        + 'big the room is. The scale was set from the average of the two, so areas '
        + 'could be off by roughly that much. Check the outline against the label.',
    }
    : {
      level: 'note',
      short: 'Scale averaged from this room',
      detail: `This room’s outline and label are about ${pct}% apart, which is normal `
        + 'for printed dimensions. The scale is the average of the two.',
    };
};

export const qualitySummary = (quality) => {
  const confidence = quality?.confidence ?? null;
  const level = qualityLevel(confidence);
  return {
    level,
    confidence,
    percent: confidence === null ? null : Math.round(confidence * 100),
    reason: primaryWarning(quality?.warnings),
    warnings: quality?.warnings ?? [],
  };
};
