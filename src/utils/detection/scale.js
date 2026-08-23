// Which rooms the project scale is taken from, decided without the user.
//
// The app used to calibrate from whichever single room the user clicked, and
// the user's habit — pick the simplest, most rectangular room — was the whole
// algorithm. Measured across the fixtures, the worst room a user could click
// implies a scale 58-90% wrong; because area goes as scale squared, those are
// 3-4x area errors. Every labelled room is measured instead, and the rooms
// outvote each other.
//
// Deliberately little machinery. Weighting the samples by isotropy, by pixel
// length, or by which walls bounded them was tried and measured: none of it
// moved any fixture by more than 0.8 percentage points, which is smaller than
// the disagreement between a fixture's own truth numbers. Isotropy weighting is
// worse than nothing — ExampleFloorplan6's LIVING ROOM reads 12.9% high on both
// axes and agrees with itself to 0.3%, so weighting by self-agreement promotes
// the one honest sample that is wrong. Only the confidence gate earns its
// place, and it earns it on one fixture (ExampleFloorplan2, 6.3% -> 0.6%).

import { robustScale, ROBUST_KEEP_WINDOW } from './validate.js';
import { roomIsNonGla } from '../dimensions/exteriorLabels.js';

// Below this the detector is telling us it could not confirm the room's walls,
// and a room it could not confirm is not a ruler. The gate works because
// contamination is mostly one-sided: a rectangle that leaked through a doorway
// is *bigger* than the room its label describes, so its px/ft is *higher*, and
// a plain median is not protected by symmetry the way it would be for balanced
// noise. ExampleFloorplan's open-plan KITCHEN reads +107% at confidence 0.70,
// which is why the gate alone is not the last line of defence — see the
// footprint cross-check below.
const SCALE_CONFIDENCE_FLOOR = 0.5;

// Two rooms are a second opinion; three are a majority that can outvote one
// bad rectangle. Fewer than this still produces a scale — the app always
// answers — but says so.
export const MIN_CONSENSUS_ROOMS = 3;

// How far apart the rooms that set the scale may land before they are not
// measuring the same drawing. Set from the fixtures rather than from taste:
// the rooms that survive trimming span 6% on ExampleFloorplan, 8% on
// ExampleFloorplan7, 30% on ExampleFloorplan6 and 37% on ExampleFloorplan2 —
// and all four of those produce a scale within 6% of truth, so anything under
// ~40% is the drawing being normal and warning about it would be crying wolf.
// A genuinely contaminated set is far past this: ExampleFloorplan's rooms
// before trimming span 129%.
export const CONSENSUS_SPREAD_LIMIT = 0.45;

// A building cannot be smaller than the rooms it contains. A leaked rectangle
// drives the scale *up*, which drives the footprint's square footage *down*,
// and that is the direction majority contamination pushes.
const MIN_FOOTPRINT_TO_LABELS = 0.7;

// The other direction is the one nothing else in the app can see. Every failure
// that *inflates* GLA — a garage the carve missed, a flood into the plan next
// to it on the sheet — leaves the rooms agreeing with each other perfectly and
// only the footprint too big, so confidence stays green while the number the
// app exists to produce is wrong.
//
// The bound is loose because it is bounded by *coverage*, not by geometry: OCR
// finds the labels it finds, and the unlabelled half of the house is real area
// the ratio has to allow for. Measured over the fixtures with four or more
// accepted rooms the ratio runs 1.34 / 1.41 / 2.40 / 2.58, so the 2.5 this
// check was first specified at would fire on ExampleFloorplan6 — whose scale is
// right to 0.7%. 3.5 keeps 36% of headroom over the worst honest fixture and
// still catches a footprint that swallowed a second plan, which doubles it.
const MAX_FOOTPRINT_TO_LABELS = 3.5;

// Below this the ratio is measuring coverage rather than the building:
// ExampleFloorplan7 states 5.64 from two labels for a whole house.
const MIN_COVERAGE_ROOMS = 4;

// A room in a house is not three feet across. When the labels themselves read
// that small the plan is dimensioned in metres and being read as feet, which is
// the one failure `areaRatio` is blind to by construction — a uniform unit
// error cancels exactly in a ratio of two areas derived from it. What is left
// is perfect room-to-room consensus, a green verdict, and a GLA 10.8x wrong.
// Warned about, never corrected: the app does not know the plan's units, and
// switching them on a suspicion would be the same wrong answer in reverse.
//
// Two conditions, because either alone cries wolf. The median catches a page
// whose rooms are all small; the widest room is what makes that mean metres
// rather than a page where OCR happened to read the bathroom, the closet and
// the hall — a house has *a* room 12 ft across, and 12 metres is 39 ft.
const MIN_PLAUSIBLE_LABEL_SIDE_FT = 8;
const MIN_PLAUSIBLE_WIDEST_SIDE_FT = 12;
const MIN_UNIT_CHECK_ROOMS = 3;

const medianOf = (values) => {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * @param {Array} candidates rooms from detectRoomsFromLabels, each
 *   { labelId, rect, sides, confidence, pixelsPerFoot: {x, y}, labelDims }
 * @param {object} context { footprintAreaPx, nonGlaRegions: [{x,y,width,height}] }
 * @returns {object|null} null when nothing usable was measured — the caller
 *   then leaves the scale alone, which is the flow the user already has.
 */
export const selectProjectScale = (candidates = [], context = {}) => {
  const nonGla = context.nonGlaRegions ?? [];
  const accepted = [];
  const rejected = [];

  for (const room of candidates) {
    if (!room?.rect) continue;
    const ppf = room.pixelsPerFoot;
    const name = room.labelId ?? room.name ?? null;
    if (!(ppf?.x > 0) || !(ppf?.y > 0)) {
      rejected.push({ name, reason: 'no-label-scale', pixelsPerFoot: null });
      continue;
    }
    // A garage or a covered porch is inside the drawing but is not the
    // building the area serves, and its rectangle is the one most likely to
    // have been carved out from under the footprint.
    if (roomIsNonGla(room, nonGla)) {
      rejected.push({ name, reason: 'non-gla', pixelsPerFoot: ppf.x });
      continue;
    }
    if (!(room.confidence >= SCALE_CONFIDENCE_FLOOR)) {
      rejected.push({
        name,
        reason: 'low-confidence',
        pixelsPerFoot: ppf.x,
        confidence: room.confidence ?? null,
      });
      continue;
    }
    accepted.push(room);
  }

  // Per axis, not per room: one room states two lengths and each is an
  // independent read of the same drawing, which is the convention
  // roomScaleSamples already uses.
  const samples = accepted.flatMap((room) => [room.pixelsPerFoot.x, room.pixelsPerFoot.y]);
  const robust = robustScale(samples);
  if (!robust) {
    return {
      pixelsPerFoot: null,
      feetPerPixel: null,
      level: 'check',
      reason: 'no-rooms',
      roomCount: 0,
      spread: 0,
      areaRatio: null,
      acceptedCount: 0,
      contributors: [],
      rejected,
    };
  }

  // Which rooms actually set the scale. robustScale trims to a window around
  // the median and re-medians inside it, so a room outside that window
  // contributed nothing — reporting it as a contributor would overstate the
  // agreement and, worse, let one blowout that cleared the confidence gate
  // (ExampleFloorplan's KITCHEN reads +107% at 0.70) inflate the spread the
  // user is shown from 6% to 129%.
  const inWindow = (v) => Math.abs(Math.log(v / robust.median)) <= ROBUST_KEEP_WINDOW;
  const contributors = [];
  for (const room of accepted) {
    const axes = ['x', 'y'].filter((axis) => inWindow(room.pixelsPerFoot[axis]));
    if (axes.length) contributors.push({ room, axes });
    else {
      rejected.push({
        name: room.labelId ?? room.name ?? null,
        reason: 'outlier',
        pixelsPerFoot: room.pixelsPerFoot.x,
        confidence: room.confidence ?? null,
      });
    }
  }

  const kept = samples.filter(inWindow).sort((a, b) => a - b);
  const spread = kept.length > 1 ? Math.log(kept[kept.length - 1] / kept[0]) : 0;

  // The one check that survives a majority of bad rooms. A 2x scale error moves
  // the footprint's area 4x, so comparing it against what the labels themselves
  // add up to sees the error the confidence gate cannot.
  //
  // Over every label, not just the ones that set the scale: the point is to
  // have a measure of the building that the selection had no hand in. Summing
  // only the contributors makes the check agree with whatever it just chose —
  // three leaked rooms then vouch for the shrunken footprint they caused.
  const labelSqFt = candidates.reduce((sum, room) => (
    room?.labelDims?.width > 0 && room.labelDims?.height > 0 && !roomIsNonGla(room, nonGla)
      ? sum + room.labelDims.width * room.labelDims.height
      : sum
  ), 0);
  const footprintSqFt = context.footprintAreaPx > 0
    ? context.footprintAreaPx / (robust.value * robust.value)
    : 0;
  const areaRatio = footprintSqFt > 0 && labelSqFt > 0 ? footprintSqFt / labelSqFt : null;

  // Every side the accepted labels state, as a population: one long room proves
  // nothing, a page of them is the unit. Counted per *room*, because a room can
  // be accepted on its measured px/ft while stating no dimensions at all — three
  // such rooms with one dimensioned between them is one room's two sides, which
  // is the population the gate below is written to refuse.
  const sides = [];
  let dimensionedRooms = 0;
  for (const room of accepted) {
    const dims = room.labelDims;
    if (!(dims?.width > 0) || !(dims.height > 0)) continue;
    sides.push(dims.width, dims.height);
    dimensionedRooms += 1;
  }
  const medianSideFt = medianOf(sides);
  const widestSideFt = sides.length ? Math.max(...sides) : null;

  let level = 'ok';
  let reason = 'auto-consensus';
  if (
    dimensionedRooms >= MIN_UNIT_CHECK_ROOMS
    && medianSideFt < MIN_PLAUSIBLE_LABEL_SIDE_FT
    && widestSideFt < MIN_PLAUSIBLE_WIDEST_SIDE_FT
  ) {
    // First, because it invalidates every other verdict below it — including
    // the two area checks, which a unit error passes cleanly.
    level = 'check';
    reason = 'labels-look-metric';
  } else if (areaRatio !== null && areaRatio < MIN_FOOTPRINT_TO_LABELS) {
    level = 'check';
    reason = 'area-implausible';
  } else if (
    areaRatio !== null && areaRatio > MAX_FOOTPRINT_TO_LABELS
    && accepted.length >= MIN_COVERAGE_ROOMS
  ) {
    level = 'check';
    reason = 'footprint-implausible';
  } else if (spread > CONSENSUS_SPREAD_LIMIT) {
    level = 'check';
    reason = 'rooms-disagree';
  } else if (contributors.length < MIN_CONSENSUS_ROOMS) {
    level = 'check';
    reason = 'too-few-rooms';
  }

  return {
    pixelsPerFoot: robust.value,
    feetPerPixel: 1 / robust.value,
    level,
    reason,
    roomCount: contributors.length,
    spread,
    // The area cross-check, reported rather than only tested: it is the one
    // number in the app that can see a footprint too big, and a panel that says
    // "the building measures 3.1x what its labelled rooms add up to" is a
    // reviewable claim where a bare confidence is not.
    areaRatio,
    acceptedCount: accepted.length,
    labelSqFt: labelSqFt > 0 ? labelSqFt : null,
    footprintSqFt: footprintSqFt > 0 ? footprintSqFt : null,
    medianSideFt,
    widestSideFt,
    contributors: contributors.map(({ room, axes }) => ({
      name: room.labelId ?? room.name ?? null,
      rect: room.rect,
      sides: room.sides,
      labelDims: room.labelDims ?? null,
      pixelsPerFoot: room.pixelsPerFoot,
      confidence: room.confidence ?? null,
      axes,
    })),
    rejected,
  };
};

/**
 * Which measured room to show as the placed overlay once the scale is set.
 *
 * The scale is a median over several rooms, so no single rectangle *is* it. The
 * one put on screen is the room that agrees with the answer best: both axes
 * inside the keep window first, then closest to the adopted scale. Taking the
 * first or the largest contributor instead would draw the box on a room the
 * median had half-rejected, and the overlay is what the user drags to overrule
 * the consensus — it has to be the app's best rectangle, not an arbitrary one.
 *
 * @param {object} decision the return of selectProjectScale
 * @returns {object|null} one entry of decision.contributors
 */
export const representativeRoom = (decision) => {
  const scale = decision?.pixelsPerFoot;
  if (!(scale > 0)) return null;
  const ranked = (decision.contributors ?? [])
    .filter((c) => c?.rect && c.pixelsPerFoot?.x > 0 && c.pixelsPerFoot?.y > 0)
    .map((c) => {
      // Only the axes that voted: a room kept on one axis is measuring the
      // drawing on that axis alone, and folding in the axis the window threw
      // away would rank it by the number that disqualified it.
      const axes = c.axes?.length ? c.axes : ['x', 'y'];
      const implied = Math.exp(
        axes.reduce((sum, axis) => sum + Math.log(c.pixelsPerFoot[axis]), 0) / axes.length,
      );
      return { room: c, axes: axes.length, distance: Math.abs(Math.log(implied / scale)) };
    })
    .sort((a, b) => (
      b.axes - a.axes
      || a.distance - b.distance
      || (b.room.confidence ?? 0) - (a.room.confidence ?? 0)
    ));
  return ranked[0]?.room ?? null;
};
