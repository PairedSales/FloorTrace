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

export const scaleQualitySummary = (quality) => {
  if (!quality || quality.level === 'ok' || !quality.reason) return null;
  const pct = percentApart(quality.disagreement ?? 0);

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
