import { describe, expect, it } from 'vitest';
import {
  feetToMeters,
  metersToFeet,
  sqFeetToSqMeters,
  formatLength,
  formatArea,
  formatDimensionInput,
} from '../unitConverter';

// ---------------------------------------------------------------------------
// feetToMeters
// ---------------------------------------------------------------------------

describe('feetToMeters', () => {
  it('converts 1 foot to 0.3048 meters', () => {
    expect(feetToMeters(1)).toBeCloseTo(0.3048, 4);
  });

  it('converts 10 feet to 3.048 meters', () => {
    expect(feetToMeters(10)).toBeCloseTo(3.048, 4);
  });

  it('converts 0 feet to 0 meters', () => {
    expect(feetToMeters(0)).toBe(0);
  });

  it('converts fractional feet', () => {
    expect(feetToMeters(3.5)).toBeCloseTo(1.0668, 4);
  });
});

// ---------------------------------------------------------------------------
// metersToFeet
// ---------------------------------------------------------------------------

describe('metersToFeet', () => {
  it('converts 1 meter to ~3.2808 feet', () => {
    expect(metersToFeet(1)).toBeCloseTo(3.28084, 3);
  });

  it('round-trips through feetToMeters', () => {
    const feet = 12.4;
    expect(metersToFeet(feetToMeters(feet))).toBeCloseTo(feet, 10);
  });

  it('converts 0 meters to 0 feet', () => {
    expect(metersToFeet(0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// sqFeetToSqMeters
// ---------------------------------------------------------------------------

describe('sqFeetToSqMeters', () => {
  it('converts 1 sq ft to ~0.0929 sq m', () => {
    expect(sqFeetToSqMeters(1)).toBeCloseTo(0.0929, 3);
  });

  it('converts 100 sq ft to ~9.29 sq m', () => {
    expect(sqFeetToSqMeters(100)).toBeCloseTo(9.2903, 3);
  });

  it('converts 0 sq ft to 0 sq m', () => {
    expect(sqFeetToSqMeters(0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// formatLength – metric
// ---------------------------------------------------------------------------

describe('formatLength – metric', () => {
  it('formats feet as meters', () => {
    expect(formatLength(10, 'metric')).toBe('3.05 m');
  });

  it('formats small values', () => {
    expect(formatLength(1, 'metric')).toBe('0.30 m');
  });

  it('still formats decimal and inches correctly', () => {
    expect(formatLength(12.4, 'decimal')).toBe('12.4 ft');
    expect(formatLength(12.5, 'inches')).toBe("12'6\"");
  });

  it('normalizes 12 inches into the next foot', () => {
    // 0.999 feet rounds to 12 inches; should display as 1' 0"
    expect(formatLength(0.999, 'inches')).toBe("1'0\"");
  });
});

// ---------------------------------------------------------------------------
// formatArea
// ---------------------------------------------------------------------------

describe('formatArea', () => {
  it('returns ft² for decimal unit', () => {
    const result = formatArea(1234, 'decimal');
    expect(result.value).toBe('1,234');
    expect(result.suffix).toBe('ft²');
  });

  it('returns m² for metric unit', () => {
    const result = formatArea(1000, 'metric');
    expect(result.suffix).toBe('m²');
    // 1000 sq ft ≈ 92.9 sq m → "93"
    expect(result.value).toBe('93');
  });

  it('returns fractional m² for small areas', () => {
    const result = formatArea(5, 'metric');
    expect(result.suffix).toBe('m²');
    // 5 sq ft ≈ 0.4645 sq m
    expect(result.value).toBe('0.46');
  });

  it('returns 0 for zero area', () => {
    const result = formatArea(0, 'decimal');
    expect(result.value).toBe('0');
    expect(result.suffix).toBe('ft²');
  });
});

// ---------------------------------------------------------------------------
// formatDimensionInput – metric
// ---------------------------------------------------------------------------

describe('formatDimensionInput – metric', () => {
  it('formats feet as meters for display', () => {
    // 10 feet = 3.048 m → "3.05"
    expect(formatDimensionInput(10, 'metric')).toBe('3.05');
  });

  it('returns empty string for empty/invalid input', () => {
    expect(formatDimensionInput('', 'metric')).toBe('');
    expect(formatDimensionInput('abc', 'metric')).toBe('');
  });

  it('still works for decimal and inches', () => {
    expect(formatDimensionInput(12.4, 'decimal')).toBe('12.4');
    expect(formatDimensionInput(12.5, 'inches')).toBe("12' 6\"");
  });

  it('normalizes 12 inches into the next foot for display', () => {
    // 5.999 feet rounds to 6' 0", not 5' 12"
    expect(formatDimensionInput(5.999, 'inches')).toBe("6' 0\"");
  });
});
