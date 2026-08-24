// Where the project scale came from, in one sentence.
//
// A leaf module because three surfaces state it and they may not disagree: the
// dock's Scale card, the derivation panel and the workfile exhibit. It used to
// live in `exhibit/model.js` under a comment claiming the Scale card shared it,
// and the Scale card did not — it counted `state.rooms.length` instead, which
// is every room the detector ever confirmed. So after the user picked one room
// by hand the panel read "From 6 measured rooms" while the exhibit read "Taken
// from one room chosen by hand". `quality.roomCount` is what the calibration
// says about itself, and it is the one that is right.
//
// Nothing but `calibration` is read, so the exhibit's lazy graph stays out of
// the entry chunk when the dock imports this.
export const scaleProvenance = (state) => {
  const cal = state?.calibration;
  if (!cal?.calibrated) return 'No scale was set — areas are not to scale.';
  const q = cal.quality;
  if (cal.source === 'line-calibration' || q?.source === 'line') {
    return q?.lineCount === 2
      ? 'Set by hand from two lines of known length.'
      : 'Set by hand from a line of known length.';
  }
  // A room the user picked, which replaces the pooled median with the app's
  // weakest evidence class — worth saying on a document somebody else reads.
  //
  // No source test. `room-vs-auto` is written in one place (`resolveScaleUpdate`
  // in detection/validate.js), and that block sets `adopted` three lines above
  // `source: adopted ? 'manual' : 'auto'` — so the pair this used to require,
  // source 'auto' with this reason, cannot occur. The branch never ran, and the
  // fall-through then reported the *pooled* room count that the user's pick had
  // just overruled: "Measured from 3 rooms on this plan" for a scale taken from
  // one room, on the one correction that can move the area by 78%.
  if (q?.reason === 'room-vs-auto') {
    return 'Taken from one room chosen by hand, overriding the measured average.';
  }
  const n = q?.roomCount ?? 0;
  if (n > 0) return `Measured from ${n} room${n === 1 ? '' : 's'} on this plan.`;
  return 'Measured from the room size entered by hand.';
};
