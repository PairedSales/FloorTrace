// Where the project scale came from, in one sentence.
//
// A leaf module because three surfaces state it and they may not disagree: the
// panel's scale step, its calculation and the workfile exhibit. Nothing but
// `calibration` is read, so the exhibit's lazy graph stays out of the entry
// chunk when the panel imports this.
//
// The scale is one room's — the one the green box is on — so what is said is
// who chose it.
export const scaleProvenance = (state) => {
  const cal = state?.calibration;
  if (!cal?.calibrated) return 'No scale was set — areas are not to scale.';
  const q = cal.quality;
  if (cal.source === 'line-calibration' || q?.source === 'line') {
    return q?.lineCount === 2
      ? 'Set by hand from two lines of known length.'
      : 'Set by hand from a line of known length.';
  }
  return q?.source === 'auto'
    ? 'Measured from one room on this plan, chosen by FloorTrace.'
    : 'Measured from one room on this plan, chosen by hand.';
};
