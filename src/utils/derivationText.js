// The working as plain text, for pasting into a workfile.
//
// Separate from the card so it is testable without a DOM, and so the two
// cannot drift: both render one `buildAreaDerivation` result and neither does
// any arithmetic of its own. Tab-separated where a figure sits against a
// label, which is what pastes into a report or a spreadsheet as rows — the
// same convention the area breakdown's copy already uses.

import { formatAreaValue, formatAreaTenths, formatLength } from './unitConverter';

const SKIPPED_REASON = {
  hidden: 'hidden, so it is out of every total',
  open: 'fewer than three corners, so it encloses nothing',
};

// `13.7 × 11.8 = 161.7`, or `0.5 × 2.9 × 2.9 = 4.2` for a right triangle,
// which is how the trade writes one.
const pieceLine = (piece, unit) => {
  const sum = piece.kind === 'void'
    ? 'a void, taken off whole'
    : `${piece.half ? '0.5 × ' : ''}${piece.lengths[0]} × ${piece.lengths[1]}`;
  const value = formatAreaTenths(piece.displayed, unit).value;
  return `\t${sum}\t= ${piece.deducted ? '−' : ''}${value}`;
};

// One outline: what it comes to, then the pieces it is made of. The pieces are
// apportioned to add up to the figure on its own header row, so a reviewer who
// adds the column reaches it.
const outlineLines = (outline, unit, title) => {
  const lines = [`${title}\t${formatAreaTenths(outline.subtotal, unit).value} `
    + `${formatAreaTenths(0, unit).suffix}`];
  // Suppressed when the outline came apart into one rectangle: that piece is
  // already this sentence with an area on the end of it.
  if (outline.dimensions && outline.working?.pieces.length !== 1) {
    lines.push(`\toverall ${formatLength(outline.dimensions.width, unit)}`
      + ` × ${formatLength(outline.dimensions.height, unit)}`);
  }
  if (outline.working) {
    for (const piece of outline.working.pieces) lines.push(pieceLine(piece, unit));
    if (outline.working.rotation > 0) {
      lines.push(`\tMeasured along the walls, which run `
        + `${outline.working.rotation.toFixed(0)}° off the page.`);
    }
  } else {
    lines.push('\tThis outline cannot be broken into pieces — it crosses itself, '
      + 'so the area above is the shoelace of the whole ring.');
  }
  for (const hole of outline.holes) {
    if (!hole.subtracted) lines.push('\t! A void outside this outline was not deducted.');
  }
  return lines;
};

export function derivationText(derivation) {
  const { scale, gla, excluded, skipped, grand, unit } = derivation;
  const areaUnit = scale.display.areaUnit;
  const lines = ['HOW THIS AREA WAS CALCULATED', '', 'SCALE', scale.provenance];

  // Named rather than denied: with no scale the app falls back to a foot per
  // pixel and still prints areas, so "the figures are pixels only" was a claim
  // the column beside it contradicted.
  if (!scale.calibrated) {
    lines.push('The figures below therefore assume 1 pixel = 1 foot. '
      + 'They are not a measurement of the building.');
  }
  const { pxPerUnit, lengthUnit } = scale.display;
  lines.push(`Scale in force\t${scale.anisotropic
    ? `${pxPerUnit.x.toFixed(2)} × ${pxPerUnit.y.toFixed(2)} px/${lengthUnit}`
    : `1 ${lengthUnit} = ${pxPerUnit.x.toFixed(2)} px`}`);
  if (scale.note?.level === 'check') lines.push(`! ${scale.note.detail}`);

  if (gla.levels.length) {
    lines.push('', 'LIVING AREA');
    for (const level of gla.levels) {
      lines.push(...outlineLines(level, unit, level.name || 'unnamed outline'));
    }
    if (gla.levels.length > 1) {
      lines.push(`Levels added\t${formatAreaTenths(gla.sumOfSubtotals, unit).value} ${areaUnit}`);
    }
  }

  if (excluded.length) {
    lines.push('', 'NOT LIVING AREA');
    for (const o of excluded) {
      lines.push(...outlineLines(o, unit, `${o.name} · ${o.typeLabel}`));
    }
  }

  if (skipped.length) {
    lines.push('', 'NOT COUNTED');
    for (const o of skipped) lines.push(`${o.name} — ${SKIPPED_REASON[o.skipped]}`);
  }

  lines.push('');
  const headline = gla.measured
    ? formatAreaValue(gla.reported, unit)
    : formatAreaValue(grand.printed, unit);
  lines.push(`${gla.measured ? 'TOTAL LIVING AREA (ROUNDED)' : 'TOTAL (no living-area outline)'}`
    + `\t${headline.value} ${headline.suffix}`);
  if (gla.measured && Math.round(gla.sumOfSubtotals) !== gla.reported) {
    lines.push(`The levels above add to ${formatAreaTenths(gla.sumOfSubtotals, unit).value}. `
      + `The figure reported is the unrounded sum, ${gla.unrounded.toFixed(1)}, rounded once — `
      + `that is the one the Area card states.`);
  }

  return lines.join('\n');
}
