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

const detailText = (warning) => {
  const d = warning.detail;
  if (!d) return warning.message;
  if (warning.code === 'bridged-opening') return `a ${d.px}px opening was bridged to close the outline`;
  if (warning.code === 'room-outside' && d.name) return `the ${d.name} room falls outside the traced outline`;
  if (warning.code === 'label-outside') return `${d.count} labelled area${d.count === 1 ? '' : 's'} fall outside the traced outline`;
  if (warning.code === 'floors-rejected') return `${d.count} closed outline${d.count === 1 ? ' was' : 's were'} judged not to be buildings`;
  return warning.message;
};

// The single most important reason to doubt this trace, or null.
export const primaryWarning = (warnings) => {
  if (!warnings?.length) return null;
  const errors = warnings.filter((w) => w.severity === 'error');
  const pool = errors.length ? errors : warnings.filter((w) => w.severity !== 'info');
  if (!pool.length) return null;
  return detailText(pool[0]);
};

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

export const scaleQualitySummary = (quality) => {
  if (!quality) return null;
  if (quality.source === 'auto') return autoScaleSummary(quality);
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
