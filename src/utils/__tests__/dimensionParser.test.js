import { describe, expect, it } from 'vitest';
import {
  normalizeOcrText,
  parseSingleToken,
  parseDimensionLine,
  inferDominantFormat,
  extractDimensionLineFromText
} from '../DimensionsOCR';

describe('normalizeOcrText', () => {
  it('normalizes separators and smart quotes', () => {
    expect(normalizeOcrText('10\u00D712')).toBe('10x12');
    expect(normalizeOcrText('13\u20194\u201D x 12\u20190\u201D')).toBe("13'4\" x 12'0\"");
  });

  it('normalizes decimal commas', () => {
    expect(normalizeOcrText('12,5 m x 3,8 m')).toBe('12.5 m x 3.8 m');
  });
});

describe('parseSingleToken', () => {
  it('parses feet inches tokens', () => {
    const token = parseSingleToken("14'2\"");
    expect(token).not.toBeNull();
    expect(token.unit).toBe('ft');
    expect(token.feet).toBe(14);
    expect(token.inches).toBe(2);
  });

  it('parses decimal feet tokens', () => {
    const token = parseSingleToken('12.5 ft');
    expect(token).not.toBeNull();
    expect(token.unit).toBe('ft');
    expect(token.value).toBeCloseTo(12.5, 5);
  });

  it('parses meter tokens', () => {
    const token = parseSingleToken('3.8 m');
    expect(token).not.toBeNull();
    expect(token.unit).toBe('m');
    expect(token.value).toBeCloseTo(3.8, 5);
  });
});

describe('parseDimensionLine', () => {
  it('parses feet/inches pair', () => {
    const r = parseDimensionLine("14'2\" x 12'1\"");
    expect(r).not.toBeNull();
    expect(r.format_type).toBe('feet_inches');
  });

  it('parses decimal feet pair', () => {
    const r = parseDimensionLine('12.5 ft x 10.0 ft');
    expect(r).not.toBeNull();
    expect(r.format_type).toBe('decimal_ft');
    expect(r.width).toBeCloseTo(12.5, 5);
    expect(r.height).toBeCloseTo(10.0, 5);
  });

  it('parses meter pair and converts width/height to feet', () => {
    const r = parseDimensionLine('3.8 m x 2.7 m');
    expect(r).not.toBeNull();
    expect(r.format_type).toBe('meter');
    expect(r.width).toBeCloseTo(12.467, 3);
  });

  it('rejects irrelevant line', () => {
    expect(parseDimensionLine('LIVING ROOM')).toBeNull();
  });
});

describe('extractDimensionLineFromText', () => {
  it('returns dimension-like line from free text', () => {
    expect(extractDimensionLineFromText('KITCHEN\n12.5 ft x 10.0 ft\nNOTES')).toBe('12.5 ft x 10.0 ft');
  });
});

describe('inferDominantFormat', () => {
  it('infers feet-inches mode', () => {
    expect(inferDominantFormat([{ format_type: 'feet_inches' }, { format_type: 'feet_inches' }])).toBe('inches');
  });

  it('infers decimal mode', () => {
    expect(inferDominantFormat([{ format_type: 'decimal_ft' }, { format_type: 'meter' }])).toBe('decimal');
  });
});
