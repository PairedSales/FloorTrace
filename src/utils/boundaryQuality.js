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
