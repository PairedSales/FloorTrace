// How a traced boundary's quality is presented. The detector emits a
// confidence and a list of reasons it might be wrong; this decides what the
// user is told and whether the result is offered as a finished answer or as
// something to check.

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
  if (warning.code === 'bridged-opening') return `a ${d.px}px opening was bridged to close the outline`;
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
    return `the walls are about ${d.px}px thick at the size this was traced, which is too thin to follow reliably`;
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
    return 'an enclosed space inside this outline was not subtracted — if it is a courtyard or light well, cut it out';
  }
  if (warning.code === 'void-superseded') {
    return 'the detector found a void where you had already cut one; yours is the one in use';
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
// Anything unlisted sorts last but is still reportable.
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
  // Both describe the sheet, not one outline: what was dropped before any
  // floor existed, and how the page itself was drawn or scanned.
  'outlines-dropped', 'low-resolution', 'plan-skewed',
]);

// Headlines in the reader's words, not the pipeline's. Six of these used to
// name the stage that produced them ("Only one hypothesis", "Floor has no
// polygon"), which tells an appraiser nothing about their measurement.
const LABELS = new Map(Object.entries({
  unsealed: 'Outline never closed',
  'weak-wall-support': 'Parts of this outline are not on a wall',
  'bridged-opening': 'A gap was closed for you',
  'heavy-closing': 'Large gaps were closed',
  annexation: 'Reaches past its walls',
  'wall-left-outside': 'Wall left outside',
  'thin-structure-excluded': 'Thin structure excluded',
  'incomplete-enclosure': 'Incomplete enclosure',
  'floors-rejected': 'Outlines discarded',
  'no-boundary': 'No outline traced',
  'floor-empty': 'One outline came back empty',
  'self-intersecting': 'Outline crosses itself',
  'covers-page': 'Outline covers the whole page',
  'tiny-floor': 'Very small outline',
  'inner-not-nested': 'Interior not nested',
  'inner-over-inset': 'Interior inset far',
  'no-inner': 'No interior outline',
  'floors-overlap': 'Two outlines overlap',
  'room-outside': 'Room outside',
  'label-outside': 'Label outside',
  'no-alternative': 'Nothing to compare against',
  'brush-mismatch': 'Does not match your outline',
  'drawn-freehand': 'Traced from your stroke',
  remediated: 'Traced again',
  'low-resolution': 'This image is too small to trace reliably',
  'plan-skewed': 'The plan is not square to the page',
  'non-gla-not-removed': 'A garage or porch may not have been removed',
  'enclosed-void': 'An enclosed space was not subtracted',
  'outlines-dropped': 'Parts of the drawing were skipped',
  'void-superseded': 'The detector found a void you had already cut',
  'area-excluded': 'Area removed from the total',
  'spanned-walls': 'Part of this outline follows no drawn wall',
}));

// A short headline for one warning. An unlisted code still gets a readable one
// rather than being hidden, matching how WARNING_RANK treats it.
export const warningLabel = (code) => LABELS.get(code)
  ?? String(code ?? '').replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

// What to do about it. Every scale message already ends with an instruction and
// no trace warning did, so the panel described problems it gave no way to act
// on. A code with no entry renders no remedy line rather than a filler one —
// silence is better than "review the outline".
const REMEDIES = new Map(Object.entries({
  unsealed: 'Paint the outline over the exterior walls instead.',
  'weak-wall-support': 'Compare the outline to the plan before you use the area. Drag any corner that sits off the wall.',
  'bridged-opening': 'Check the gap — if it is a wide doorway the outline is right, if it is a missing wall it is not.',
  'heavy-closing': 'Check the outline where it crosses open space, or paint it by hand.',
  annexation: 'The outline reaches past the walls it grew from. Paint it by hand to bound it.',
  'wall-left-outside': 'Some drawn wall sits outside this outline. Paint the outline to include it, or check it is another building.',
  'incomplete-enclosure': 'Paint the outline by hand — the walls did not close on their own.',
  'covers-page': 'The outline reached the edge of the sheet. Crop to the building, or paint the outline by hand.',
  'floors-overlap': 'Two outlines cover the same area and it is counted twice. Delete or hide one.',
  'self-intersecting': 'The outline crosses itself, so the area is wrong. Drag the crossing corners apart.',
  'room-outside': 'Mark the room as inside the building and trace again, or paint the outline to include it.',
  'label-outside': 'If those areas belong to the building, paint the outline to include them.',
  'floors-rejected': 'If one of those was a real building, paint its outline by hand and it will be measured.',
  'outlines-dropped': 'If part of the building is missing, paint its outline by hand.',
  'no-inner': 'No interior face could be measured here, so this outline reports its exterior in both settings.',
  'low-resolution': 'Open a larger copy of the plan if you have one — at this size the area cannot be trusted.',
  'plan-skewed': 'Rotate the plan square to the page and trace again.',
  'non-gla-not-removed': 'If it is a garage or porch, add an outline for it and set its type, or cut it out.',
  'enclosed-void': 'Use Cut out to punch it out of the outline if it is not living area.',
  'tiny-floor': 'Check this is a building and not a legend or a title block. Delete it if not.',
  'brush-mismatch': 'The traced outline does not follow what you painted. Paint it again, more tightly.',
  'no-boundary': 'Paint over the exterior walls and FloorTrace will read them.',
  'floor-empty': 'Paint that outline by hand, or delete it.',
  'spanned-walls': 'The outline was carried across a gap the plan does not draw a wall across. Check that stretch against the plan.',
}));

export const remedyText = (code) => REMEDIES.get(code) ?? null;

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
    remedy: remedyText(w.code),
    // A warning somebody has checked against the plan and accepted. It keeps
    // its row and its anchor — the record is the point — but stops counting.
    acknowledged: w.acknowledged ?? null,
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
  const edited = Boolean(quality?.edited);
  const level = qualityLevel(confidence, edited);
  return {
    level,
    edited,
    confidence,
    percent: confidence === null ? null : Math.round(confidence * 100),
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
 * visited. Those survive, under a heading that says when they were raised.
 */
const RETIRED_BY_EDIT = new Set([
  'self-intersecting', 'unsealed', 'covers-page', 'tiny-floor',
  'floor-empty', 'inner-not-nested', 'inner-over-inset', 'no-boundary',
]);

export const retireOnEdit = (warnings) =>
  (warnings ?? []).filter((w) => !RETIRED_BY_EDIT.has(w.code));
