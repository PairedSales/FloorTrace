/** Conversion factor: 1 foot = 0.3048 meters (exact, by definition) */
const FEET_TO_METERS = 0.3048;
/**
 * The reciprocal, exported because `dimensions/parse.js` needs it too and used
 * to carry its own `3.28084` — a rounded copy of this, differing in the sixth
 * significant figure. A metric plan was parsed with one constant and
 * redisplayed with the other.
 */
export const METERS_TO_FEET = 1 / FEET_TO_METERS;
/** Conversion factor: 1 square foot = 0.092903 square meters */
const SQ_FEET_TO_SQ_METERS = FEET_TO_METERS * FEET_TO_METERS;

/**
 * Convert decimal feet to feet and inches
 * @param {number} decimalFeet - Length in decimal feet (e.g., 12.4)
 * @returns {object} - { feet: number, inches: number }
 */
export const decimalToFeetInches = (decimalFeet) => {
  let feet = Math.floor(decimalFeet);
  let inches = Math.round((decimalFeet - feet) * 12);

  // Normalize values so we never emit 12" (e.g., 0' 12" becomes 1' 0")
  if (inches >= 12) {
    feet += Math.floor(inches / 12);
    inches %= 12;
  }

  return { feet, inches };
};

/**
 * Convert decimal feet to meters
 * @param {number} decimalFeet - Length in decimal feet
 * @returns {number} - Length in meters
 */
export const feetToMeters = (decimalFeet) => {
  return decimalFeet * FEET_TO_METERS;
};

/**
 * Convert meters to decimal feet
 * @param {number} meters - Length in meters
 * @returns {number} - Length in decimal feet
 */
export const metersToFeet = (meters) => {
  return meters / FEET_TO_METERS;
};

/**
 * Convert square feet to square meters
 * @param {number} sqFeet - Area in square feet
 * @returns {number} - Area in square meters
 */
export const sqFeetToSqMeters = (sqFeet) => {
  return sqFeet * SQ_FEET_TO_SQ_METERS;
};

/**
 * Detect the dominant formatting style from a list of OCR dimensions
 * @param {Array} dimensions - Array of detected dimensions
 * @param {string} unit - 'decimal', 'inches', or 'metric'
 * @returns {string|null} - The detected style string, or null
 */
export const getUnitStyleFromDimensions = (dimensions, unit) => {
  if (!dimensions || dimensions.length === 0) return null;
  const mappedFormat = unit === 'metric' ? 'meters' : unit;
  const formatDims = dimensions.filter(d => d.format === mappedFormat);
  if (formatDims.length === 0) return null;

  const styles = {};
  for (const d of formatDims) {
    if (!d.text) continue;
    let style = null;
    if (mappedFormat === 'inches') {
      if (d.text.includes('ft') || d.text.includes('in')) style = 'explicit';
      else if (d.text.includes("' ")) style = 'tick-space';
      else style = 'tick';
    } else if (mappedFormat === 'decimal') {
      if (d.text.includes("'")) style = 'tick';
      else if (d.text.includes('ft') || d.text.includes('feet')) style = 'ft';
      else style = 'bare';
    } else if (mappedFormat === 'meters') {
      if (d.text.includes('meters')) style = 'meters';
      else style = 'm';
    }

    if (style) {
      styles[style] = (styles[style] || 0) + 1;
    }
  }

  if (Object.keys(styles).length === 0) return null;
  return Object.keys(styles).reduce((a, b) => styles[a] > styles[b] ? a : b);
};

/**
 * Format a length value based on the selected unit system
 * @param {number} decimalFeet - Length in decimal feet
 * @param {string} unit - 'decimal', 'inches', or 'metric'
 * @param {string|null} style - Optional specific style template to use
 * @returns {string} - Formatted string (e.g., "12.4 ft", "12'5\"", or "3.8 m")
 */
export const formatLength = (decimalFeet, unit = 'decimal', style = null) => {
  if (unit === 'inches') {
    const { feet, inches } = decimalToFeetInches(decimalFeet);
    if (style === 'explicit') return `${feet} ft ${inches} in`;
    if (style === 'tick-space') return `${feet}' ${inches}"`;
    return `${feet}'${inches}"`; // Default matches e.g. 12'5"
  }
  if (unit === 'metric') {
    const meters = feetToMeters(decimalFeet);
    if (style === 'meters') return `${meters.toFixed(2)} meters`;
    // A length standing in a multiply — `4.18 × 3.60 = 15.0 m²` — carries its
    // unit once, on the product. Metric had no bare style, so the area working
    // either repeated "m" on both factors or reached for its own converter.
    if (style === 'bare') return meters.toFixed(2);
    return `${meters.toFixed(2)} m`;
  }
  
  if (style === 'tick') return `${decimalFeet.toFixed(1)}'`;
  if (style === 'bare') return `${decimalFeet.toFixed(1)}`;
  return `${decimalFeet.toFixed(1)} ft`;
};

/**
 * Format an area value based on the selected unit system
 * @param {number} areaInSqFeet - Area in square feet
 * @param {string} unit - 'decimal', 'inches', or 'metric'
 * @returns {{ value: string, suffix: string }} - Formatted area value and unit suffix
 */
export const formatArea = (areaInSqFeet, unit = 'decimal') => {
  if (unit === 'metric') {
    const sqMeters = sqFeetToSqMeters(areaInSqFeet);
    return {
      value: sqMeters >= 1
        ? Math.round(sqMeters).toLocaleString()
        : sqMeters.toFixed(2),
      suffix: 'm²',
    };
  }
  return {
    value: areaInSqFeet > 0 ? Math.round(areaInSqFeet).toLocaleString() : '0',
    suffix: 'ft²',
  };
};

/**
 * An area as a number at display precision, before it becomes a string.
 *
 * A breakdown has to add up to the total printed beneath it. Each row is
 * rounded on its own, so a total taken from the raw sum and rounded separately
 * need not equal them — 1,241 + 442 + 89 under a Total of 1,771. On a workfile
 * exhibit a reviewer adds up by hand, that reads as an error in the
 * measurement.
 *
 * So a breakdown runs *every* figure through here — rows and total alike — and
 * prints them with `formatAreaValue`. Summing rows that were formatted some
 * other way is the same bug wearing a different hat.
 */
export const areaDisplayValue = (areaInSqFeet, unit = 'decimal') => {
  if (unit === 'metric') {
    const sqMeters = sqFeetToSqMeters(areaInSqFeet);
    return sqMeters >= 1 ? Math.round(sqMeters) : Number(sqMeters.toFixed(2));
  }
  return areaInSqFeet > 0 ? Math.round(areaInSqFeet) : 0;
};

/**
 * Print a value `areaDisplayValue` produced, or a sum of them.
 *
 * Never rounds again — that is what would reintroduce the mismatch — and always
 * groups thousands, including on the fractional branch a sub-1 m² part puts a
 * total onto. `toFixed` there quietly dropped the separator from the one number
 * on the page that most needs it, in a column where every other cell had it.
 *
 * Not identical to `formatArea` on every input, and not meant to be: a bare
 * zero prints "0" rather than metric's "0.00", and an area that rounds up to a
 * whole square metre prints "1" rather than "1.00".
 */
export const formatAreaValue = (value, unit = 'decimal') => ({
  value: Number.isInteger(value)
    ? value.toLocaleString()
    : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  suffix: unit === 'metric' ? 'm²' : 'ft²',
});

/**
 * An area to the tenth, for a column of working that has to add up.
 *
 * The panel that shows how an area was reached prints every piece and every
 * level at this precision — the same one a floorplan's own side labels carry,
 * and the one the trade's calculation pages use. `formatAreaValue` cannot do
 * it: it prints a non-integer to two places, so a level came out as "2,689.80"
 * beside pieces of "161.70", and the pieces are apportioned to the tenth, not
 * the hundredth. Always one place, so a piece that lands on a whole number
 * still lines up under the ones that did not.
 */
export const formatAreaTenths = (value, unit = 'decimal') => ({
  value: value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  suffix: unit === 'metric' ? 'm²' : 'ft²',
});


/**
 * Format dimension value for display in input field
 * @param {string|number} value - Current value (stored value in decimal feet)
 * @param {string} unit - 'decimal', 'inches', or 'metric'
 * @returns {string} - Formatted value for input field
 */
export const formatDimensionInput = (value, unit = 'decimal') => {
  if (!value) return '';
  
  // Parse the value to a number (stored dimensions are always in decimal feet)
  const numValue = parseFloat(value);
  if (isNaN(numValue)) return '';
  
  if (unit === 'inches') {
    const { feet, inches } = decimalToFeetInches(numValue);
    return `${feet}' ${inches}"`;
  }
  
  if (unit === 'metric') {
    const meters = feetToMeters(numValue);
    return meters.toFixed(2);
  }
  
  return numValue.toFixed(1);
};
