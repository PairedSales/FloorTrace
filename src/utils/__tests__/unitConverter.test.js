import { describe, expect, it } from 'vitest';
import {
  feetToMeters,
  metersToFeet,
  sqFeetToSqMeters,
  formatLength,
  formatArea,
  formatDimensionInput,
  areaDisplayValue,
  formatAreaValue,
} from '../unitConverter';

// ---------------------------------------------------------------------------
// feetToMeters
// ---------------------------------------------------------------------------

describe('feetToMeters', () => {
  it('converts 1 foot to 0.3048 meters', () => {
    expect(feetToMeters(1)).toBeCloseTo(0.3048, 4);
  });
});

// ---------------------------------------------------------------------------
// metersToFeet
// ---------------------------------------------------------------------------

describe('metersToFeet', () => {
  it('converts 1 meter to ~3.2808 feet', () => {
    expect(metersToFeet(1)).toBeCloseTo(3.28084, 3);
  });
});

// ---------------------------------------------------------------------------
// sqFeetToSqMeters
// ---------------------------------------------------------------------------

describe('sqFeetToSqMeters', () => {
  it('converts 1 sq ft to ~0.0929 sq m', () => {
    expect(sqFeetToSqMeters(1)).toBeCloseTo(0.0929, 3);
  });
});

// ---------------------------------------------------------------------------
// formatLength – metric
// ---------------------------------------------------------------------------

describe('formatLength – metric', () => {
  it('formats feet as meters', () => {
    expect(formatLength(10, 'metric')).toBe('3.05 m');
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
});

// ---------------------------------------------------------------------------
// areaDisplayValue / formatAreaValue
// ---------------------------------------------------------------------------

describe('areaDisplayValue', () => {
  it('is the number formatArea prints, for every area a breakdown can hold', () => {
    for (const sqft of [1, 100.4, 1234.5, 99999.6]) {
      for (const unit of ['decimal', 'metric']) {
        expect(formatAreaValue(areaDisplayValue(sqft, unit), unit).value)
          .toBe(formatArea(sqft, unit).value);
        expect(formatAreaValue(areaDisplayValue(sqft, unit), unit).suffix)
          .toBe(formatArea(sqft, unit).suffix);
      }
    }
  });

  it('prints a zero area the way an uncalibrated plan reads it', () => {
    expect(formatAreaValue(areaDisplayValue(0, 'decimal'), 'decimal').value).toBe('0');
    expect(formatArea(0, 'decimal').value).toBe('0');
  });

  it('keeps two decimals for a sub-square-metre area', () => {
    expect(areaDisplayValue(1, 'metric')).toBeCloseTo(0.09, 2);
    expect(formatAreaValue(0.09, 'metric')).toEqual({ value: '0.09', suffix: 'm²' });
  });
});
