/**
 * Convert decimal feet to feet and inches
 * @param {number} decimalFeet - Length in decimal feet (e.g., 12.4)
 * @returns {object} - { feet: number, inches: number }
 */
export const decimalToFeetInches = (decimalFeet) => {
  const feet = Math.floor(decimalFeet);
  const inches = Math.round((decimalFeet - feet) * 12);
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
 * Format a length value based on the selected unit system
 * @param {number} decimalFeet - Length in decimal feet
 * @param {string} unit - 'decimal' or 'inches'
 * @returns {string} - Formatted string (e.g., "12.4 ft" or "12' 4\"")
 */
export const formatLength = (decimalFeet, unit = 'decimal') => {
  if (unit === 'inches') {
    const { feet, inches } = decimalToFeetInches(decimalFeet);
    return `${feet}' ${inches}"`;
  }
  return `${decimalFeet.toFixed(1)} ft`;
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
 * @param {string|number} value - Current value (could be user's partial input or stored value)
 * @param {string} unit - 'decimal' or 'inches'
 * @returns {string} - Formatted value for input field
 */
export const formatDimensionInput = (value, unit = 'decimal') => {
  if (!value) return '';
  
  // If it's already a string (user typing), return as-is
  if (typeof value === 'string') {
    return value;
  }
  
  // If it's a number, format based on unit
  const numValue = parseFloat(value);
  if (isNaN(numValue)) return '';
  
  if (unit === 'inches') {
    const { feet, inches } = decimalToFeetInches(numValue);
    return `${feet}' ${inches}"`;
  }
  
  return numValue.toFixed(1);
};
