/**
 * Dimension text parsing core.
 *
 * Pure functions (no DOM, no OCR engine) that turn raw OCR text into
 * structured room dimensions. Every strategy is ordered from "explicit
 * symbols present" down to "aggressive corrupted-symbol fallback", and each
 * parsed token carries a quality grade so the detection pipeline can score
 * confidence accordingly.
 *
 * Quality grades:
 *   3 = exact     — explicit symbols/units matched (10'2", 1.2 ft, 3.5 m)
 *   2 = inferred  — units assumed (bare "12", spaced pair "10 2")
 *   1 = fallback  — corrupted-symbol reconstruction ("102" → 10'2")
 */

const MIN_FEET = 1;
const MAX_FEET = 250;
// Corrupted-symbol fallbacks reconstruct room labels; rooms beyond this are
// far less likely than a misread, so cap them tighter than MAX_FEET.
const MAX_FALLBACK_FEET = 99;
const METERS_TO_FEET = 3.28084;

const isReasonableFeet = (v) =>
  Number.isFinite(v) && v >= MIN_FEET && v <= MAX_FEET;

// ---------------------------------------------------------------------------
// Text normalisation
// ---------------------------------------------------------------------------

export const normalizeOcrText = (text) => {
  if (!text) return '';
  let s = String(text);

  // Unicode apostrophe/backtick/acute/prime variants -> straight foot tick
  s = s.replace(/[‘’ʼʹ′´`]/g, "'");
  // Unicode double-quote/double-prime/degree variants -> straight inch mark
  s = s.replace(/[“”″˝ʺ°]/g, '"');
  // Two consecutive ticks are an inch mark
  s = s.replace(/''/g, '"');

  // Multiplication signs -> x
  s = s.replace(/[×✕✖⋅⨯]/g, 'x');

  s = s.toLowerCase();

  // "by" separator -> x
  s = s.replace(/\bby\b/g, ' x ');

  // Doubled separator glyphs ("xX", "x x") collapse to one x
  s = s.replace(/x(\s*x)+/g, 'x');

  // Letter/digit confusions inside numbers
  s = s.replace(/(^|\s)s(?=\s*')/g, '$15'); // lone S before a tick is a 5
  s = s.replace(/(^|\s)[jli](?=\d)/g, '$11'); // leading J/l/i on a number is a 1
  s = s.replace(/(\d)[li](\d)/g, '$11$2');
  s = s.replace(/(\d)o(?=\s|'|"|$)/g, '$10');
  s = s.replace(/(^|\s)o(\d)/g, '$10$2');
  s = s.replace(/(\d)s(\d)/g, '$15$2');
  s = s.replace(/(\d)b(\d)/g, '$18$2');
  s = s.replace(/(\d)z(\d)/g, '$12$2');

  // Comma / middle dot / semicolon between digits is a blurred foot tick
  s = s.replace(/(\d)\s*[,·;]\s*(?=\d)/g, "$1' ");
  s = s.replace(/(\d)\s*[,·;]+\s*$/g, "$1'");

  // Pipe / bang / slash between digits: blurred foot tick
  s = s.replace(/(\d)\s*[|!/]\s*(?=\d)/g, "$1' ");
  s = s.replace(/(\d)\s*[|!]\s*$/g, "$1'");

  // Architectural hyphen between feet tick and inches: 12'-5" -> 12' 5"
  s = s.replace(/'\s*-\s*(?=\d)/g, "' ");

  // Space between a digit and a unit keyword and vice versa
  s = s.replace(/(\d)(ft|feet|in|inch|inches|m|meters?)\b/g, '$1 $2');
  s = s.replace(/\b(ft|feet|in|inch|inches|m)(\d)/g, '$1 $2');

  // Collapse whitespace
  s = s.replace(/\s+/g, ' ');

  return s.trim();
};

// ---------------------------------------------------------------------------
// Single token parsing
// ---------------------------------------------------------------------------

const RE_FEET_INCHES = /^(\d{1,3})\s*'\s*(\d{1,2})\s*"?$/;
const RE_FEET_ONLY = /^(\d{1,3})\s*'$/;
const RE_EXPLICIT_FT_IN = /^(\d{1,3})\s*(?:ft|feet)\s+(\d{1,2})\s*(?:in|inch|inches)?$/;
const RE_DECIMAL_FEET = /^(\d{1,3}\.\d+)\s*(ft|feet|')?$/;
const RE_INT_FEET = /^(\d{1,3})\s*(?:ft|feet)$/;
const RE_METERS = /^(\d{1,3}(?:\.\d+)?)\s*(?:m|meter|meters)$/;
const RE_SPACED_PAIR = /^(\d{1,3})\s+(\d{1,2})\s*["']?$/;

/**
 * Parse one side of a dimension pair.
 * @returns {{value:number, format:string, quality:number, explicitUnit:boolean, raw:number}|null}
 */
export const parseSingleToken = (token) => {
  const t = normalizeOcrText(token);
  if (!t) return null;

  // 10'2" / 10' 2 / smart-quote variants (normalised above)
  let m = t.match(RE_FEET_INCHES);
  if (m) {
    const feet = parseInt(m[1], 10);
    const inches = parseInt(m[2], 10);
    if (inches < 12) {
      const value = feet + inches / 12;
      if (isReasonableFeet(value)) {
        return { value, format: 'inches', quality: 3, explicitUnit: true, raw: value };
      }
    }
    return null;
  }

  // 12'
  m = t.match(RE_FEET_ONLY);
  if (m) {
    const value = parseInt(m[1], 10);
    if (isReasonableFeet(value)) {
      return { value, format: 'inches', quality: 3, explicitUnit: true, raw: value };
    }
    return null;
  }

  // 1 ft 3 in / 2 feet 6
  m = t.match(RE_EXPLICIT_FT_IN);
  if (m) {
    const feet = parseInt(m[1], 10);
    const inches = parseInt(m[2], 10);
    if (inches < 12) {
      const value = feet + inches / 12;
      if (isReasonableFeet(value)) {
        return { value, format: 'inches', quality: 3, explicitUnit: true, raw: value };
      }
    }
    return null;
  }

  // 1.2 ft / 12.75ft / 1.2' / bare 10.5
  m = t.match(RE_DECIMAL_FEET);
  if (m) {
    const value = parseFloat(m[1]);
    const explicitUnit = Boolean(m[2]);
    if (isReasonableFeet(value)) {
      return { value, format: 'decimal', quality: explicitUnit ? 3 : 2, explicitUnit, raw: value };
    }
    return null;
  }

  // 12 ft
  m = t.match(RE_INT_FEET);
  if (m) {
    const value = parseInt(m[1], 10);
    if (isReasonableFeet(value)) {
      return { value, format: 'decimal', quality: 3, explicitUnit: true, raw: value };
    }
    return null;
  }

  // 3.5 m
  m = t.match(RE_METERS);
  if (m) {
    const raw = parseFloat(m[1]);
    const value = raw * METERS_TO_FEET;
    if (isReasonableFeet(value)) {
      return { value, format: 'meters', quality: 3, explicitUnit: true, raw };
    }
    return null;
  }

  // 12" 11" — foot tick misread as an inch mark (no real tick present)
  if (!t.includes("'")) {
    m = t.match(/^(\d{1,3})\s*"\s*(\d{1,2})\s*"?$/);
    if (m) {
      const feet = parseInt(m[1], 10);
      const inches = parseInt(m[2], 10);
      if (inches < 12) {
        const value = feet + inches / 12;
        if (isReasonableFeet(value)) {
          return { value, format: 'inches', quality: 2, explicitUnit: true, raw: value };
        }
      }
      return null;
    }
  }

  // "10 2" — both tick marks blurred away
  m = t.match(RE_SPACED_PAIR);
  if (m) {
    const feet = parseInt(m[1], 10);
    const inches = parseInt(m[2], 10);
    if (inches < 12) {
      const value = feet + inches / 12;
      if (isReasonableFeet(value)) {
        return { value, format: 'inches', quality: 2, explicitUnit: false, raw: value };
      }
    }
    return null;
  }

  // Bare integers: "12" (plain feet) or corrupted "102"/"1210".
  // A trailing orphan tick/quote ("135\"" = 13'5" with the real tick lost)
  // is tolerated on the corrupted-symbol fallbacks.
  const bareMatch = t.match(/^(\d{1,4})\s*(["'])?$/);
  if (bareMatch) {
    const digits = bareMatch[1];
    const hadQuote = Boolean(bareMatch[2]);

    if (digits.length <= 2) {
      const value = parseInt(digits, 10);
      if (isReasonableFeet(value)) {
        // With an orphan quote this is feet whose tick was misread
        return hadQuote
          ? { value, format: 'inches', quality: 1, explicitUnit: false, raw: value }
          : { value, format: 'decimal', quality: 2, explicitUnit: false, raw: value };
      }
      return null;
    }

    // 4 digits: feet + 2-digit inches (1210 -> 12'10")
    if (digits.length === 4) {
      const feet = parseInt(digits.slice(0, 2), 10);
      const inches = parseInt(digits.slice(2), 10);
      if (inches < 12 && feet <= MAX_FALLBACK_FEET) {
        const value = feet + inches / 12;
        if (isReasonableFeet(value)) {
          return { value, format: 'inches', quality: 1, explicitUnit: false, raw: value };
        }
      }
    }

    // 3 digits: feet + 1-digit inches (102 -> 10'2"). When that split claims
    // an implausibly large room and 1+2 makes valid inches, the tick sat
    // after the first digit (810 -> 8'10", not 81'0"). bareDigits is kept so
    // pair context can reinterpret as a lost decimal point (105 -> 10.5)
    if (digits.length === 3) {
      let feet = parseInt(digits.slice(0, 2), 10);
      let inches = parseInt(digits.slice(2), 10);
      const altInches = parseInt(digits.slice(1), 10);
      if (feet > 30 && altInches < 12) {
        feet = parseInt(digits[0], 10);
        inches = altInches;
      }
      if (feet <= MAX_FALLBACK_FEET) {
        const value = feet + inches / 12;
        if (isReasonableFeet(value)) {
          return {
            value, format: 'inches', quality: 1, explicitUnit: false, raw: value,
            bareDigits: digits
          };
        }
      }
    }

    // Last resort: whole thing as feet
    const plain = parseInt(digits, 10);
    if (!hadQuote && isReasonableFeet(plain)) {
      return { value: plain, format: 'decimal', quality: 1, explicitUnit: false, raw: plain };
    }
  }

  // Tight hyphen pair: "10-5" / "10-2\"" as 10'5" (tick misread/omitted)
  m = t.match(/^(\d{1,2})\s*-\s*(\d{1,2})\s*["']?$/);
  if (m) {
    const feet = parseInt(m[1], 10);
    const inches = parseInt(m[2], 10);
    if (inches < 12) {
      const value = feet + inches / 12;
      if (isReasonableFeet(value)) {
        return { value, format: 'inches', quality: 1, explicitUnit: false, raw: value };
      }
    }
  }

  return null;
};

// ---------------------------------------------------------------------------
// Garbage-prefix / garbage-suffix stripping
// ---------------------------------------------------------------------------

const isDigit = (c) => c >= '0' && c <= '9';

/** Parse `token`, stripping garbled room-label junk from the left if needed. */
const parseTokenStripLeft = (token) => {
  const direct = parseSingleToken(token);
  if (direct) return { ...direct, stripped: false };

  for (let i = 1; i < token.length; i++) {
    // Only start at the beginning of a digit run
    if (!isDigit(token[i]) || isDigit(token[i - 1])) continue;
    const sub = token.slice(i).trim();
    if (!sub) continue;
    const parsed = parseSingleToken(sub);
    if (parsed) return { ...parsed, stripped: true };
  }
  return null;
};

/** Parse `token`, stripping trailing junk from the right if needed. */
const parseTokenStripRight = (token) => {
  const direct = parseSingleToken(token);
  if (direct) return { ...direct, stripped: false };

  for (let i = token.length - 2; i >= 0; i--) {
    // Only cut at the end of a digit run (keep an optional closing tick/quote)
    if (!isDigit(token[i]) || (i + 1 < token.length && isDigit(token[i + 1]))) continue;
    // A tick/quote right after the digit run belongs to the value
    // ("17'¢…" -> "17'"), so try keeping it before cutting it away too.
    const subs = token[i + 1] === "'" || token[i + 1] === '"'
      ? [token.slice(0, i + 2).trim(), token.slice(0, i + 1).trim()]
      : [token.slice(0, i + 1).trim()];
    for (const sub of subs) {
      if (!sub) continue;
      const parsed = parseSingleToken(sub);
      if (parsed) return { ...parsed, stripped: true };
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// Full dimension-line parsing
// ---------------------------------------------------------------------------

/** Reconcile units across the pair (e.g. "3.5 x 2.8 m" — left side is meters too). */
const buildPair = (lp, rp, textNorm, separatorMissing) => {
  let left = { ...lp };
  let right = { ...rp };

  if (left.format === 'meters' && !right.explicitUnit && right.format === 'decimal') {
    right = { ...right, value: right.raw * METERS_TO_FEET, format: 'meters' };
  } else if (right.format === 'meters' && !left.explicitUnit && left.format === 'decimal') {
    left = { ...left, value: left.raw * METERS_TO_FEET, format: 'meters' };
  }

  // Lost decimal point recovery: when one side carries an explicit fraction,
  // an integer-looking partner probably lost its point to OCR
  // ("105 x 8.3" -> 10.5 x 8.3; "35 m x 2.8 m" -> 3.5 m x 2.8 m).
  const hasFraction = (tk) => Number.isFinite(tk.raw) && Math.abs(tk.raw % 1) > 1e-9;
  const recoverPoint = (tk, other) => {
    if (!hasFraction(other)) return tk;
    if (other.format === 'decimal' && tk.bareDigits && tk.bareDigits.length === 3) {
      const v = parseInt(tk.bareDigits, 10) / 10;
      if (isReasonableFeet(v)) return { ...tk, value: v, raw: v, format: 'decimal' };
    }
    if (other.format === 'meters' && tk.format === 'meters' &&
        !hasFraction(tk) && tk.raw >= 10 && tk.raw <= 99) {
      const meters = tk.raw / 10;
      const v = meters * METERS_TO_FEET;
      if (isReasonableFeet(v)) return { ...tk, value: v, raw: meters };
    }
    return tk;
  };
  left = recoverPoint(left, right);
  right = recoverPoint(right, left);

  // Lost-tick recovery: zoomed re-reads eat thin tick marks, turning 9'6"
  // into "96". A unit-less 2-digit integer paired with a feet-inches partner
  // at an implausible aspect ratio is a collapsed feet-inches token, not a
  // 96-foot room.
  const recoverTicks = (tk, other) => {
    if (tk.explicitUnit || other.format !== 'inches') return tk;
    if (!Number.isInteger(tk.raw) || tk.raw < 13 || tk.raw > 99) return tk;
    const asIs = Math.max(tk.value, other.value) / Math.min(tk.value, other.value);
    if (asIs <= 4) return tk;
    // Re-split from the original digits when we have them; re-splitting the
    // parsed value would silently drop a digit ("130" -> 1'3").
    let v;
    if (tk.bareDigits) {
      const inches = parseInt(tk.bareDigits.slice(1), 10);
      if (inches >= 12) return tk;
      v = parseInt(tk.bareDigits[0], 10) + inches / 12;
    } else {
      v = Math.floor(tk.raw / 10) + (tk.raw % 10) / 12;
    }
    const reRatio = Math.max(v, other.value) / Math.min(v, other.value);
    if (reRatio > 3 || !isReasonableFeet(v)) return tk;
    return { ...tk, value: v, raw: v, format: 'inches', quality: 1 };
  };
  left = recoverTicks(left, right);
  right = recoverTicks(right, left);

  if (!isReasonableFeet(left.value) || !isReasonableFeet(right.value)) return null;

  // Rooms with a >25:1 aspect ratio are almost certainly misparses
  const ratio = Math.max(left.value, right.value) / Math.min(left.value, right.value);
  if (ratio > 25) return null;

  let format = 'decimal';
  if (left.format === 'meters' || right.format === 'meters') format = 'meters';
  if (left.format === 'inches' || right.format === 'inches') format = 'inches';

  const quality = Math.min(left.quality, right.quality);
  const strippedCount = (left.stripped ? 1 : 0) + (right.stripped ? 1 : 0);
  // A bare unit-less integer recovered by junk-stripping is the weakest
  // evidence there is — penalise it hard so lone garbage can't fake a side.
  const weakStripped = [left, right].filter(
    (t) => t.stripped && !t.explicitUnit && t.format === 'decimal'
  ).length;
  // A unit-less side claiming a huge room is usually a collapsed feet-inches
  // read the recoveries above could not fix ("59\" x90" -> 59 x 90); make it
  // lose to any plausible competing read of the same label.
  const oversize = [left, right].filter((t) => !t.explicitUnit && t.value > 35).length;
  const penalty =
    (3 - quality) * 7 + strippedCount * 4 + weakStripped * 8 + oversize * 8 +
    (separatorMissing ? 6 : 0);

  return {
    width: left.value,
    height: right.value,
    text: textNorm,
    format,
    quality,
    penalty,
    score: left.quality + right.quality - strippedCount - (separatorMissing ? 1 : 0)
  };
};

const RE_TWO_FEET_INCHES =
  /(\d{1,3})\s*'\s*(\d{1,2})\s*"?\s+(\d{1,3})\s*'\s*(\d{1,2})\s*"?/;
const RE_TWO_UNIT_DECIMALS =
  /(\d{1,3}(?:\.\d+)?)\s*(ft|feet|m|meters)\s+(\d{1,3}(?:\.\d+)?)\s*(ft|feet|m|meters)\b/;

export const parseDimensionLine = (line) => {
  const norm = normalizeOcrText(line);
  if (!norm || norm.length > 80) return null;

  const digitCount = (norm.match(/\d/g) || []).length;
  if (digitCount < 2 || digitCount > 12) return null;

  // Strategy 1 — split at every separator candidate, keep the best-quality
  // successful split. An 'x' is nearly unambiguous as a separator; a hyphen
  // may instead be a blurred foot tick ("10-5"), so hyphen splits are only
  // considered when no x split parses.
  const trySplits = (separatorChar) => {
    let best = null;
    for (let i = 0; i < norm.length; i++) {
      if (norm[i] !== separatorChar) continue;

      const left = norm.slice(0, i).trim();
      const right = norm.slice(i + 1).trim();
      if (!left || !right) continue;

      const lp = parseTokenStripLeft(left);
      if (!lp) continue;
      const rp = parseTokenStripRight(right);
      if (!rp) continue;

      const pair = buildPair(lp, rp, norm, false);
      if (pair && (!best || pair.score > best.score)) best = pair;
    }
    return best;
  };

  const best = trySplits('x') || trySplits('-');
  if (best) return best;

  // Strategy 2 — two feet-inches groups with no separator: 12'5" 10'3"
  let m = norm.match(RE_TWO_FEET_INCHES);
  if (m) {
    const w = parseInt(m[1], 10) + parseInt(m[2], 10) / 12;
    const h = parseInt(m[3], 10) + parseInt(m[4], 10) / 12;
    if (parseInt(m[2], 10) < 12 && parseInt(m[4], 10) < 12 &&
        isReasonableFeet(w) && isReasonableFeet(h)) {
      return {
        width: w, height: h, text: norm, format: 'inches',
        quality: 3, penalty: 6, score: 5
      };
    }
  }

  // Strategy 3 — two unit-suffixed decimals with no separator: 3.5 m 2.8 m
  m = norm.match(RE_TWO_UNIT_DECIMALS);
  if (m) {
    const isMeters = m[2].startsWith('m') || m[4].startsWith('m');
    let w = parseFloat(m[1]);
    let h = parseFloat(m[3]);
    if (isMeters) {
      w *= METERS_TO_FEET;
      h *= METERS_TO_FEET;
    }
    if (isReasonableFeet(w) && isReasonableFeet(h)) {
      return {
        width: w, height: h, text: norm, format: isMeters ? 'meters' : 'decimal',
        quality: 3, penalty: 6, score: 5
      };
    }
  }

  return null;
};

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------

const formatFeetInches = (value) => {
  let feet = Math.floor(value);
  let inches = Math.round((value - feet) * 12);
  if (inches === 12) {
    feet += 1;
    inches = 0;
  }
  return `${feet}' ${inches}"`;
};

const trimNumber = (value) => {
  const s = value.toFixed(2).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return s || '0';
};

/**
 * Canonical display text for a parsed dimension pair. OCR reads are often
 * legible-but-garbled ("125x164\""); the UI should show the values we
 * actually parsed, not the raw glyph soup.
 */
export const formatDimensionText = (width, height, format) => {
  if (format === 'inches') {
    return `${formatFeetInches(width)} x ${formatFeetInches(height)}`;
  }
  if (format === 'meters') {
    return `${trimNumber(width / METERS_TO_FEET)} m x ${trimNumber(height / METERS_TO_FEET)} m`;
  }
  return `${trimNumber(width)} x ${trimNumber(height)}`;
};

// ---------------------------------------------------------------------------
// Format inference
// ---------------------------------------------------------------------------

export const inferDominantFormat = (dimensions) => {
  if (!dimensions || dimensions.length === 0) return null;

  const counts = { inches: 0, decimal: 0, meters: 0 };
  for (const d of dimensions) {
    if (d && d.format in counts) counts[d.format]++;
  }

  // Priority order breaks ties (inches preferred)
  let bestFormat = null;
  let bestCount = 0;
  for (const format of ['inches', 'decimal', 'meters']) {
    if (counts[format] > bestCount) {
      bestFormat = format;
      bestCount = counts[format];
    }
  }
  return bestFormat;
};
