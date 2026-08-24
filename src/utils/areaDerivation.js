// The arithmetic behind the reported GLA, written out step by step.
//
// An appraisal report has to show its working for the area sketch. The app
// states one square footage and the machinery behind it — a scale fitted
// across rooms, a wall trace, a void subtraction, a rounding rule — is
// invisible, so there is nothing to put in the workfile. This reconstructs the
// chain from state alone: where the scale came from, the rectangles and
// triangles each outline is made of, what came out of it, and what the levels
// add up to.
//
// The pieces are the point. An outline used to show a pixel count and one
// multiply, which is checkable only against itself; `13.7 × 11.8 = 161.7` is
// checkable against the dimension printed on the plan next to that wall, which
// is what a reviewer actually has.
//
// It is the *area* calculation, not a room schedule: the figure of record is
// total GLA, so nothing here breaks a plan down by room.
//
// Pure, and takes a state rather than reading the live store — the same
// relationship `computeAreaByType` has to `selectActiveAreaByType`. Nothing
// here recomputes an area: every figure comes back through `calculateArea` and
// `areaDisplayValue`, which is what makes it impossible for this to print a
// square footage the Area card does not.

import {
  calculateArea, signedArea, holeRings, holeKey, isSubtracted,
  displayedBreakdownTotal,
} from './areaCalculator';
import { decomposeArea, apportionPieces } from './areaDecomposition';
import {
  areaDisplayValue, sqFeetToSqMeters, METERS_TO_FEET, formatLength,
} from './unitConverter';
import { DEFAULT_TRACE_TYPE, normalizeTraceType, traceTypeLabel } from './traceTypes';
import { scaleProvenance } from './scaleProvenance';
import { scaleQualitySummary } from './boundaryQuality';

// Why an outline contributes nothing. Stated rather than omitted: an outline
// missing from the sum with no reason given is the same gap in the working
// that this whole card exists to close.
const skipReason = (trace) => {
  if (!trace?.visible) return 'hidden';
  if (!(trace.vertices?.length >= 3)) return 'open';
  return null;
};

// A four-corner outline square to the page, as the two lengths a reader can
// check against the sketch. Most plans are this or very near it, and a
// dimension pair is the form an appraiser reads a footprint in. Deliberately
// carries no area of its own — the area is one number, computed once, above.
const AXIS_EPS = 0.75;
const rectangleDimensions = (vertices, feetPerPixel) => {
  if (vertices.length !== 4) return null;
  for (let i = 0; i < 4; i += 1) {
    const a = vertices[i];
    const b = vertices[(i + 1) % 4];
    const horizontal = Math.abs(a.y - b.y) <= AXIS_EPS;
    const vertical = Math.abs(a.x - b.x) <= AXIS_EPS;
    if (!horizontal && !vertical) return null;
  }
  const xs = vertices.map((v) => v.x);
  const ys = vertices.map((v) => v.y);
  return {
    width: (Math.max(...xs) - Math.min(...xs)) * feetPerPixel.x,
    height: (Math.max(...ys) - Math.min(...ys)) * feetPerPixel.y,
  };
};

// An area in the unit being printed, before any rounding. `areaDisplayValue`
// converts and rounds in one step, and the working needs the value in between:
// the note that reconciles the rounded levels with the reported figure quotes
// the unrounded sum, and quoting it in square feet under a column of square
// metres is worse than not showing it.
const inDisplayUnits = (sqFt, unit) => (unit === 'metric' ? sqFeetToSqMeters(sqFt) : sqFt);

/* The outline cut into pieces, in the unit the panel prints, rounded so the
   column adds up to the figure at the foot of it.

   One decimal place: it is the precision a floorplan's own side labels carry,
   and the precision the trade's calculation pages print. The products come
   from the *unrounded* lengths — a tenth of a foot on a forty-foot wall is two
   square feet, and the column has to reach the area above it — so a line reads
   `13.7 × 11.8 = 161.7` for lengths of 13.66… and 11.81…, rather than being the
   multiply of the two figures shown. `apportionPieces` then takes the rounding
   of the pieces themselves off the table. */
const PIECE_DECIMALS = 1;

const describePieces = (cut, unit) => {
  if (!cut?.exact || !cut.pieces.length) return null;
  const total = Number(inDisplayUnits(cut.squareFeet, unit).toFixed(PIECE_DECIMALS));
  const signed = cut.pieces.map((p) => inDisplayUnits(p.deducted ? -p.area : p.area, unit));
  const shown = apportionPieces(signed, total, PIECE_DECIMALS);
  return {
    // Non-zero when the outline was turned onto its own walls before being cut
    // up, which is what makes a garage drawn at an angle one rectangle whose
    // two lengths are the ones written on the plan.
    rotation: cut.rotation,
    total,
    pieces: cut.pieces.map((piece, i) => ({
      key: `${piece.kind}-${i}`,
      kind: piece.kind,
      deducted: !!piece.deducted,
      // A right triangle is printed as the trade prints it, `0.5 × b × h`,
      // rather than as a halved rectangle the reader has to spot.
      half: piece.kind === 'tri',
      // A void that could not itself be cut up is stated whole, with no
      // lengths — never dropped, which would put its area back into the house.
      lengths: piece.kind === 'void' ? [] : [
        formatLength(piece.width, unit, 'bare'),
        formatLength(piece.height, unit, 'bare'),
      ],
      displayed: Math.abs(shown[i]),
    })),
  };
};

// The scale in the unit the panel is printing. `inches` is feet with a
// different length format, so only metric converts.
//
// Populated even with no scale set: the app falls back to 1 ft per pixel and
// goes on printing areas, so the honest thing is to name that assumption and
// keep the arithmetic repeatable. Suppressing the scale while still printing
// "ft²" left the card saying the figures were pixels next to a column that was
// not pixels — and in metric, not the pixel count either.
//
// There is no square-feet-per-square-pixel factor here any more. It was the
// one number the card invited you to multiply, back when a pixel count was all
// an outline had to show; the working is in feet now, so that multiply appears
// nowhere and a factor stated beside a column of `13.7 × 11.8` is a step in an
// arithmetic nobody is doing.
const displayScale = (feetPerPixel, pxPerFoot, unit) => {
  const metric = unit === 'metric';
  const perUnit = metric ? METERS_TO_FEET : 1;
  const sqFtPerSqPx = feetPerPixel.x * feetPerPixel.y;
  const areaPerPx = metric ? sqFeetToSqMeters(sqFtPerSqPx) : sqFtPerSqPx;
  const perPixel = pxPerFoot ?? {
    x: feetPerPixel.x > 0 ? 1 / feetPerPixel.x : 1,
    y: feetPerPixel.y > 0 ? 1 / feetPerPixel.y : 1,
  };
  return {
    lengthUnit: metric ? 'm' : 'ft',
    areaUnit: metric ? 'm²' : 'ft²',
    // px per foot × feet per metre = px per metre.
    pxPerUnit: { x: perPixel.x * perUnit, y: perPixel.y * perUnit },
    areaPerPx,
  };
};

const describeOutline = (trace, feetPerPixel, unit) => {
  const skipped = skipReason(trace);
  const vertices = trace?.vertices ?? [];
  // The ring's own area, before anything is taken out of it. Absolute, because
  // winding is a convention and this is a quantity.
  const ringPixels = vertices.length >= 3 ? Math.abs(signedArea(vertices)) : 0;

  const list = trace?.holes ?? [];
  const rings = holeRings(list);
  const holes = list.map((hole, i) => {
    const ring = rings[i];
    const pixels = ring?.length >= 3 ? Math.abs(signedArea(ring)) : 0;
    return {
      key: holeKey(hole, i),
      pixels,
      // A void the outline has moved out from under is still the user's
      // assertion and still drawn, but it is not deducted — so it appears in
      // the working with the area it would have removed, not silently.
      subtracted: ring?.length >= 3 && isSubtracted(hole),
    };
  }).filter((h) => h.pixels > 0);

  const deductedPixels = holes.reduce((sum, h) => (h.subtracted ? sum + h.pixels : sum), 0);
  // Through `calculateArea`, not `netPixels * sx * sy`: one multiply written
  // twice is one place for this and the Area card to drift apart.
  const squareFeet = skipped ? 0 : calculateArea(vertices, feetPerPixel, trace?.holes);
  const type = normalizeTraceType(trace?.type);

  return {
    id: trace?.id ?? null,
    name: trace?.name ?? null,
    color: trace?.color ?? null,
    type,
    typeLabel: traceTypeLabel(type),
    counted: !skipped,
    skipped,
    vertexCount: vertices.length,
    ringPixels,
    holes,
    deductedPixels,
    netPixels: Math.max(0, ringPixels - deductedPixels),
    dimensions: skipped ? null : rectangleDimensions(vertices, feetPerPixel),
    // The working itself: the rectangles and triangles this outline is made of.
    // Null when no honest breakdown exists — an outline that crosses itself has
    // an area but no partition, and printing a column that cannot reach it
    // would be worse than printing none.
    working: skipped ? null : describePieces(
      decomposeArea(vertices, feetPerPixel, trace?.holes), unit,
    ),
    squareFeet,
    displayed: areaDisplayValue(squareFeet, unit),
    // The same figure to the tenth, which is the column the pieces add to. The
    // integer above is what the Area card headlines and what the levels are
    // summed as; this is finer only so that the pieces are not made to reach a
    // number they were rounded away from.
    subtotal: Number(inDisplayUnits(squareFeet, unit).toFixed(PIECE_DECIMALS)),
    // Never dropped on the way to the UI, per the rule the rest of the app
    // follows: working that omits the doubt is a wrong answer with its
    // arithmetic shown.
    quality: trace?.quality ?? null,
  };
};

/**
 * The working, as data.
 *
 * @param {object} state working state (live store or a plain object)
 * @param {string} unit 'decimal' | 'inches' | 'metric'
 */
export function buildAreaDerivation(state, unit = state?.unit ?? 'decimal') {
  const cal = state?.calibration;
  const calibrated = !!cal?.calibrated;
  const feetPerPixel = cal?.feetPerPixel || { x: 1, y: 1 };
  const pxPerFoot = calibrated && feetPerPixel.x > 0 && feetPerPixel.y > 0
    ? { x: 1 / feetPerPixel.x, y: 1 / feetPerPixel.y }
    : null;

  const outlines = (state?.perimeterTraces ?? [])
    .map((t) => describeOutline(t, feetPerPixel, unit));

  const living = outlines.filter((o) => o.counted && o.type === DEFAULT_TRACE_TYPE);
  const excluded = outlines.filter((o) => o.counted && o.type !== DEFAULT_TRACE_TYPE);
  const skipped = outlines.filter((o) => !o.counted);

  const byType = {};
  let grandSquareFeet = 0;
  for (const o of outlines) {
    if (!o.counted) continue;
    byType[o.type] = (byType[o.type] ?? 0) + o.squareFeet;
    grandSquareFeet += o.squareFeet;
  }

  const glaSquareFeet = living.reduce((sum, o) => sum + o.squareFeet, 0);
  // Each level is rounded and then added, which is how the panel's other
  // breakdowns work — so a reader adding the column by hand reaches the same
  // figure. `reported` is the raw sum rounded once, which is what the Area
  // card headlines; the two agree on one level and can sit a square foot apart
  // on several, so the working says which is which rather than picking.
  // Quantised to display precision. `areaDisplayValue` returns whole units
  // except in metric below 1 m², where two-decimal values sum with ordinary
  // float noise — 0.10 + 0.20 is not 0.3, which fired the reconciling note
  // between two figures that print identically.
  const sumOfLevels = Number(living.reduce((sum, o) => sum + o.displayed, 0).toFixed(2));
  const reported = areaDisplayValue(glaSquareFeet, unit);
  // The column the working actually prints: each level to the tenth, added.
  // Separate from `sumOfLevels`, which adds the whole units the Area card
  // states — they answer different questions and a panel showing the pieces
  // has to add up in the precision the pieces were printed to.
  const sumOfSubtotals = Number(
    living.reduce((sum, o) => sum + o.subtotal, 0).toFixed(PIECE_DECIMALS),
  );

  return {
    unit,
    scale: {
      calibrated,
      feetPerPixel,
      pxPerFoot,
      anisotropic: !!pxPerFoot && Math.abs(pxPerFoot.x - pxPerFoot.y) > 1e-6,
      // One multiply rather than two, because that is the step being shown:
      // a pixel of the drawing is this many square feet of the building.
      sqFtPerSqPx: feetPerPixel.x * feetPerPixel.y,
      // The same two facts in whatever unit the panel is printing. Stated here
      // rather than at the view, because a working that says "1 ft = 15.4 px"
      // over a column of square metres is not a step anybody can repeat — and
      // the factor has to be converted, not just relabelled.
      display: displayScale(feetPerPixel, pxPerFoot, unit),
      source: cal?.source ?? null,
      provenance: scaleProvenance(state),
      note: scaleQualitySummary(cal?.quality),
    },
    gla: {
      levels: living,
      squareFeet: glaSquareFeet,
      // The same quantity in the unit being printed, unrounded — what
      // `reported` is the rounding of.
      unrounded: inDisplayUnits(glaSquareFeet, unit),
      sumOfLevels,
      sumOfSubtotals,
      reported,
      // A plan with no living area is not a GLA of zero. The Area card
      // headlines the grand total there, and so does the working — the test is
      // copied from its `noGla`, not approximated by counting outlines: a GLA
      // outline that encloses nothing is one the Area card already steps past.
      measured: !(glaSquareFeet === 0 && grandSquareFeet > 0),
    },
    excluded,
    skipped,
    grand: {
      squareFeet: grandSquareFeet,
      // The same definition every other printed total in the app uses.
      printed: displayedBreakdownTotal(byType, unit),
    },
  };
}
