/** Conversion factor: 1 foot = 0.3048 meters */
const FEET_TO_METERS = 0.3048;
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
 * Convert feet and inches to decimal feet
 * @param {number} feet - Feet value
 * @param {number} inches - Inches value
 * @returns {number} - Length in decimal feet
 */
export const feetInchesToDecimal = (feet, inches) => {
  return feet + inches / 12;
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
 * Parse user input and convert to decimal feet
 * Supports multiple formats:
 * - Decimal: "12.4", "12.4 ft"
 * - Feet-Inches: "12' 4\"", "12'4\"", "12 4", "12' 4"
 * @param {string} input - User input string
 * @returns {number|null} - Length in decimal feet, or null if invalid
 */
export const parseLength = (input) => {
  if (!input || typeof input !== 'string') return null;
  
  const trimmed = input.trim();
  if (!trimmed) return null;
  
  // Pattern 1: Feet and inches (e.g., 12' 4", 12'4", 12 4)
  const feetInchesPattern = /^(\d+(?:\.\d+)?)\s*['']?\s*(\d+(?:\.\d+)?)\s*[""]?\s*$/;
  const feetInchesMatch = trimmed.match(feetInchesPattern);
  if (feetInchesMatch) {
    const feet = parseFloat(feetInchesMatch[1]);
    const inches = parseFloat(feetInchesMatch[2]);
    if (!isNaN(feet) && !isNaN(inches)) {
      return feetInchesToDecimal(feet, inches);
    }
  }
  
  // Pattern 2: Just feet with apostrophe (e.g., 12')
  const justFeetPattern = /^(\d+(?:\.\d+)?)\s*['']?\s*$/;
  const justFeetMatch = trimmed.match(justFeetPattern);
  if (justFeetMatch) {
    const feet = parseFloat(justFeetMatch[1]);
    if (!isNaN(feet)) {
      return feet;
    }
  }
  
  // Pattern 3: Decimal with optional "ft" or "feet" (e.g., 12.4, 12.4 ft)
  const decimalPattern = /^(\d+(?:\.\d+)?)\s*(?:ft|feet)?\s*$/i;
  const decimalMatch = trimmed.match(decimalPattern);
  if (decimalMatch) {
    const value = parseFloat(decimalMatch[1]);
    if (!isNaN(value)) {
      return value;
    }
  }
  
  return null;
};

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
