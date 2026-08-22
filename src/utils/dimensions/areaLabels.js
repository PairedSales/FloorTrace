// Area-type labels: the printed words that say which reported subtotal a whole
// outline belongs to ("BASEMENT", "LOWER LEVEL", "2ND FLOOR").
//
// Deliberately a different collection from exteriorLabels.js, and deliberately
// a much shorter vocabulary. An exterior-feature keyword carves its region OUT
// of the footprint it sits in; an area-type keyword types the whole outline it
// sits in. That difference is why "garage" and "porch" are not here and must
// not be added: a garage is a *room* inside a storey, so a GARAGE label inside
// the first floor would retype the entire floor as non-GLA. The words below
// name a *level*, which is the only thing a whole outline can be — nobody
// prints "BASEMENT" on a room of the first floor.

// Below-grade first: "lower level" has to beat the generic storey pattern
// underneath it, which would otherwise read it as another numbered floor.
const AREA_TYPE_PATTERNS = [
  {
    type: 'below-grade',
    re: /\b(basements?|bsmts?|bsmnts?|b'ments?|cellars?|lower\s+(?:level|lvl|floor|flr)|garden\s+level|below[-\s]grade|sub[-\s]?basements?)\b/i,
  },
  // Above-grade living area. Present only so a storey that names itself cannot
  // be outvoted by a stray below-grade mention inside it — a vote for GLA
  // changes nothing on its own, since GLA is already the default.
  {
    type: 'gla',
    re: /\b((?:1st|2nd|3rd|[4-9]th|first|second|third|fourth|main|upper)\s+(?:floor|flr|level|lvl|story|storey)|(?:floor|level)\s*[1-9])\b/i,
  },
];

// "DN TO BSMT", "BASEMENT STAIRS", "LOWER LEVEL ENTRY" — the keyword is a
// pointer to somewhere else on the plan, printed on the storey you are leaving.
const REFERENCE_CONTEXT =
  /\b(stairs?|stairway|stairwell|steps?|access|entr(?:y|ance)|doors?|doorway|hatch|egress|landing|ladder|up|dn|down|to)\b/i;

// A legend or area schedule quotes every level's name in one place, far from
// the outline each one belongs to.
const SUMMARY_CONTEXT =
  /\b(sq\.?\s?(?:ft|f|m)|sqft|square\s+(?:feet|foot|met(?:er|re)s?)|totals?|subtotals?)\b/i;

/**
 * The area type one OCR'd text line asserts, or null if it asserts none.
 * @returns {{type: string, keyword: string}|null}
 */
export const matchAreaLabel = (text) => {
  if (typeof text !== 'string') return null;
  // Tesseract returns typographic quotes freely; the vocabulary is written with
  // the plain one.
  const normalized = text.replace(/[‘’´`]/g, "'").trim();
  if (!normalized) return null;
  if (REFERENCE_CONTEXT.test(normalized) || SUMMARY_CONTEXT.test(normalized)) return null;
  for (const { type, re } of AREA_TYPE_PATTERNS) {
    const match = normalized.match(re);
    if (match) return { type, keyword: match[1].toLowerCase().replace(/\s+/g, ' ') };
  }
  return null;
};
