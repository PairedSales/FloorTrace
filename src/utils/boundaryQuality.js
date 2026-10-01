// What is said about a trace and about the scale it is measured with.
//
// The detector emits a confidence and a list of reasons an outline might be
// wrong. None of that is narrated to the user any more: the outline is drawn on
// the plan and is checked by eye, and a list of the detector's doubts beside it
// described a picture the user was already looking at. What this file still
// decides about a trace is its level (which the benchmarks and the "keep the
// painting" rule read) and, when a trace produced nothing at all, the one
// reason worth giving — because then there is no picture to look at.
//
// The scale is the other half, and the opposite case: a wrong scale looks
// exactly like a right one, so its doubts are said, in the panel's Scale
// section and on the saved image.

export const QUALITY_GOOD = 0.75;
export const QUALITY_POOR = 0.5;

/**
 * `edited` is a fifth level, not a confidence band. A hand edit invalidates the
 * detector's score for the polygon — it no longer describes the geometry on
 * screen — but it answers none of the warnings about the *drawing*, and the
 * area is usually barely changed and still wrong. The old behaviour nulled the
 * whole quality record, so one corner nudge turned every doubtful surface green
 * at once and made destroying the evidence the fastest way to a clean exhibit.
 *
 * Passing `edited` explicitly keeps `qualityLevel(null)` meaning "failed" for
 * every caller that has always meant that by it.
 */
export const qualityLevel = (confidence, edited = false) => {
  if (edited) return 'edited';
  if (!(confidence > 0)) return 'failed';
  if (confidence >= QUALITY_GOOD) return 'good';
  if (confidence >= QUALITY_POOR) return 'fair';
  return 'poor';
};

export const detailText = (warning) => {
  const d = warning.detail;
  if (!d) return warning.message;
  // In words, not pixels: an image-pixel width means nothing to the person
  // reading it, and the Show button points at the gap itself.
  if (warning.code === 'bridged-opening') return 'a gap in the wall was bridged to close the outline';
  // Every missed room, not the first one. These used to be emitted one per
  // room and then de-duplicated by code, so three rooms outside read as one.
  if (warning.code === 'room-outside') {
    const names = (d.names ?? []).filter(Boolean);
    if (d.count > 1) {
      return `${d.count} measured rooms fall outside the traced outline`
        + (names.length ? ` (${names.join(', ')})` : '');
    }
    if (names[0] ?? d.name) return `the ${names[0] ?? d.name} room falls outside the traced outline`;
    return 'a measured room falls outside the traced outline';
  }
  if (warning.code === 'label-outside') return `${d.count} labelled area${d.count === 1 ? '' : 's'} fall outside the traced outline`;
  if (warning.code === 'floors-rejected') return `${d.count} closed outline${d.count === 1 ? ' was' : 's were'} judged not to be buildings, so their area is not counted`;
  if (warning.code === 'outlines-dropped') {
    return `${d.count} part${d.count === 1 ? '' : 's'} of the drawing were skipped before tracing, so any area there is not counted`;
  }
  if (warning.code === 'low-resolution') {
    return 'the walls are drawn too thin at this image size to be followed reliably';
  }
  if (warning.code === 'plan-skewed') {
    return `the drawing sits about ${d.degrees}° off square, and the outline was straightened onto the page's axes`;
  }
  if (warning.code === 'non-gla-not-removed') {
    return d.keyword
      ? `a ${String(d.keyword).toLowerCase()} is labelled on this plan but no area was removed for it`
      : 'an area that looks like a garage or porch was found but not removed';
  }
  if (warning.code === 'enclosed-void') {
    return 'an enclosed space inside this outline was not subtracted';
  }
  if (warning.code === 'void-superseded') {
    return 'FloorTrace found an open area where you had already cut one out; yours is the one in use';
  }
  // No square footage, deliberately. The detector has no scale — nothing under
  // `detection/` knows px per foot — so a figure here would have been a
  // confident "0 sq ft of garage area was removed" printed over a real 20%
  // carve. The share of the footprint is scale-free and is the number that
  // actually answers "how much of my building did it take out".
  if (warning.code === 'area-excluded') {
    const what = d.keyword ? String(d.keyword).toLowerCase() : 'non-living';
    const share = d.shareOfFootprint > 0
      ? ` (about ${Math.round(d.shareOfFootprint * 100)}% of the outline)`
      : '';
    return `a ${what} area was removed from the total${share}`;
  }
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
// Anything unlisted sorts last but is still reportable. It decides which one
// reason is given for a trace that found nothing.
const WARNING_RANK = new Map([
  'no-boundary',
  'floor-empty',
  'unsealed',
  'self-intersecting',
  'covers-page',
  'floors-overlap',
  'inner-not-nested',
  // The plan was read at a resolution the wall strokes do not survive. Ranked
  // with the first group because nothing downstream of it can be trusted:
  // measured on the fixtures, confidence *rises* as the input degrades.
  'low-resolution',

  'room-outside',
  'label-outside',
  'wall-left-outside',
  'annexation',
  'incomplete-enclosure',
  'brush-mismatch',
  'bridged-opening',
  // Area kept that probably should not have been, or removed that should not
  // have been. Each is a knowable number of square feet, which is why they sit
  // in the second group and not with the notes.
  'non-gla-not-removed',
  'enclosed-void',
  'outlines-dropped',
  'void-superseded',
  'plan-skewed',
  // The winning outline was painted across a wall line's full extent rather
  // than following ink — by the module's own description it follows wall that
  // was never drawn, which is a knowable amount of invented area.
  'spanned-walls',
  'thin-structure-excluded',
  'tiny-floor',
  'inner-over-inset',
  // Moved up out of the notes: in interior mode this floor is showing and
  // measuring its exterior polygon under an interior caption, which is a
  // wrong number, not a description of how the outline was reached.
  'no-inner',
  // Area was removed from the total. Rated `warn` at emission, unlike the
  // `info` it used to carry: a discarded outline is a missing wing until
  // somebody has looked at it.
  'floors-rejected',

  'weak-wall-support',
  'heavy-closing',
  'drawn-freehand',
  // What the carve actually took out. Stated, never counted — it is the
  // detector working correctly, and the number it reports is the point.
  'area-excluded',
  'remediated',
  'no-alternative',
].map((code, i) => [code, i]));

const UNRANKED = 999;
const severityRank = (severity) => (severity === 'error' ? 0 : 1);
const warningRank = (w) => severityRank(w.severity ?? 'warn') * 1000 + (WARNING_RANK.get(w.code) ?? UNRANKED);

// Warnings that describe the whole drawing rather than one floor. The pipeline
// tags them (`scope: 'result'`) and fans them onto every floor, so anything
// reading one floor's warnings sees what was found about the sheet it is on.
export const RESULT_SCOPED_CODES = new Set([
  'label-outside', 'floors-rejected', 'no-alternative', 'no-boundary', 'remediated',
  // Both describe the sheet, not one outline: what was dropped before any
  // floor existed, and how the page itself was drawn or scanned.
  'outlines-dropped', 'low-resolution', 'plan-skewed',
]);

// The single most important reason to doubt this trace, or null: the worst
// warning that is not a note about how the outline was reached.
export const primaryWarning = (warnings) => {
  const worst = (warnings ?? [])
    .filter((w) => (w.severity ?? 'warn') !== 'info')
    .sort((a, b) => warningRank(a) - warningRank(b))[0];
  return worst ? detailText(worst) : null;
};

// How the scale a room set is presented. The area is the number the user acts
// on, so every message here says what the disagreement means for the area
// rather than describing the geometry that produced it.
//
// Each summary is `{level, short, detail}` and, where there is something to do
// about it, a `remedy`. They are separate on purpose. `detail` is the finding,
// and it is printed on the saved image for whoever reads the report; `remedy`
// names a control in this app, which means nothing on a page in a workfile.
// Written as one sentence, the image used to tell its reader to "click a
// dimension".
const percentApart = (logDistance) => Math.round((Math.exp(logDistance) - 1) * 100);

// Nothing derived from the sample scatter is reported as a margin of error.
// Measured across the fixtures, the spread of the rooms that set a scale and
// the scale's actual error are uncorrelated: 1.8% scatter against 3.1% error on
// one plan, 37% scatter against 0.6% error on another. What is reported instead
// is what was observed — how many rooms agreed, and how far apart they were.
const roomsPhrase = (count) => `${count} room${count === 1 ? '' : 's'}`;

// The two ways out of a doubtful scale, named as the panel's Scale section
// names them. "Below", because a remedy is only ever read inside that section,
// directly over the buttons it names.
const PICK_A_ROOM = 'choose “Use a different room” below';
const BACK_TO_AUTOMATIC = 'Choose “Go back to the automatic scale” below to return to the measured average.';

const autoScaleSummary = (quality) => {
  const rooms = roomsPhrase(quality.roomCount ?? 0);
  const apart = percentApart(quality.disagreement ?? 0);

  if (quality.reason === 'too-few-rooms') {
    return {
      level: 'check',
      short: `Scale from ${rooms}`,
      detail: `Only ${rooms} on this plan could be measured well enough to set the `
        + 'scale, so nothing outvoted them. Areas rest on that.',
      remedy: `Check the green box against its room, or ${PICK_A_ROOM} and pick a room you trust.`,
    };
  }
  if (quality.reason === 'rooms-disagree') {
    return {
      level: 'check',
      short: `Rooms disagree by ~${apart}%`,
      detail: `The ${rooms} used to set the scale imply sizes about ${apart}% apart, `
        + 'which is more than printed dimensions normally vary. The middle of them is '
        + 'in use.',
      remedy: `Check the outline, or ${PICK_A_ROOM} to set the scale from one room.`,
    };
  }
  if (quality.reason === 'area-implausible') {
    return {
      level: 'check',
      short: 'Areas look too small for these rooms',
      detail: 'At this scale the traced building comes out smaller than the rooms its '
        + 'own labels describe, so the scale is probably too high and every area too '
        + 'small.',
      remedy: `To set the scale from a plainly rectangular room instead, ${PICK_A_ROOM}.`,
    };
  }
  // auto-consensus: worth stating, never worth worrying about. The area is read
  // for as long as the plan is open, and "where did this number come from"
  // stays asked.
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
      + 'is normal for printed dimensions.',
    remedy: `To set the scale from a single room instead, ${PICK_A_ROOM}.`,
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
        + 'in use.',
      remedy: BACK_TO_AUTOMATIC,
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

  // In words, not pixels: the line's length in image pixels means nothing to
  // the person who drew it.
  if (quality.reason === 'short-line') {
    return {
      level: 'note',
      short: 'Scale set by hand from a short line',
      detail: 'The line you drew is short, so a small slip at either end changes the '
        + `scale by about ${pct}%.`,
      remedy: 'Draw it along the longest wall you can identify, or zoom in first.',
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
  // that panel line is the only statement of where the number came from.
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
        + `itself, which moves every area by roughly ${areaPct}%. Your choice is in use.`,
      remedy: BACK_TO_AUTOMATIC,
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
          + 'or labels is wrong.',
        remedy: 'Pick a third room to settle it — choose “Use a different room” below.',
      }
      : {
        level: 'check',
        short: 'Kept the scale from earlier rooms',
        detail: `This room implies a scale about ${pct}% different from the ${rooms} `
          + 'measured before it, so it was not used — areas are unchanged.',
        remedy: 'Check this room’s green box against its printed size.',
      };
  }

  // room-internal
  return quality.level === 'check'
    ? {
      level: 'check',
      short: `Areas may be off by ~${pct}%`,
      detail: `This room’s outline and its label disagree by about ${pct}% about how `
        + 'big the room is. The scale was set from the average of the two, so areas '
        + 'could be off by roughly that much.',
      remedy: 'Check the green box against the room’s printed size.',
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
  const edited = Boolean(quality?.edited);
  const level = qualityLevel(confidence, edited);
  return {
    level,
    edited,
    confidence,
    reason: primaryWarning(quality?.warnings),
    warnings: quality?.warnings ?? [],
  };
};

/**
 * Which warnings a hand edit can answer, and which it cannot.
 *
 * `self-intersecting`, `unsealed`, `covers-page` and `tiny-floor` are
 * properties of the ring the user just moved, so they are re-derived and drop.
 * Everything else — a label outside, a room outside, an opening bridged, a wall
 * left out — is a fact about the *drawing*, and about places the edit never
 * visited. Those stay on the trace's record.
 */
const RETIRED_BY_EDIT = new Set([
  'self-intersecting', 'unsealed', 'covers-page', 'tiny-floor',
  'floor-empty', 'inner-not-nested', 'inner-over-inset', 'no-boundary',
]);

export const retireOnEdit = (warnings) =>
  (warnings ?? []).filter((w) => !RETIRED_BY_EDIT.has(w.code));
