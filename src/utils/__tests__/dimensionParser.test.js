import { describe, expect, it } from 'vitest';
import { normalizeOcrText, parseSingleToken, parseDimensionLine, extractDimensionSubstring } from '../DimensionsOCR';

// ---------------------------------------------------------------------------
// normalizeOcrText
// ---------------------------------------------------------------------------

describe('normalizeOcrText', () => {
  it('lowercases all text', () => {
    expect(normalizeOcrText('10X12')).toBe('10x12');
    expect(normalizeOcrText('12 FT x 10 FT')).toBe('12 ft x 10 ft');
  });

  it('converts unicode multiplication signs to x', () => {
    expect(normalizeOcrText('10\u00D712')).toBe('10x12');
    expect(normalizeOcrText('10\u271512')).toBe('10x12');
  });

  it('converts "by" to x', () => {
    expect(normalizeOcrText('10 by 12')).toBe('10 x 12');
    expect(normalizeOcrText('10 BY 12')).toBe('10 x 12');
  });

  it('normalises smart quotes to straight quotes', () => {
    expect(normalizeOcrText('10\u20195\u201D')).toBe("10'5\"");
    expect(normalizeOcrText('10\u20185\u201C')).toBe("10'5\"");
  });

  it('collapses multiple spaces', () => {
    expect(normalizeOcrText('10  x   12')).toBe('10 x 12');
  });

  it('inserts space between digit and unit keyword', () => {
    expect(normalizeOcrText('1.2ft')).toBe('1.2 ft');
    expect(normalizeOcrText('3in')).toBe('3 in');
    expect(normalizeOcrText('12ft x 10ft')).toBe('12 ft x 10 ft');
  });

  it('converts comma near digits to tick mark (blurry apostrophe)', () => {
    expect(normalizeOcrText('10,5')).toBe("10' 5");
    expect(normalizeOcrText('13,4')).toBe("13' 4");
  });

  it('converts backtick near digits to tick mark', () => {
    expect(normalizeOcrText('10`5')).toBe("10'5");
  });
});

// ---------------------------------------------------------------------------
// parseSingleToken
// ---------------------------------------------------------------------------

describe('parseSingleToken', () => {
  // Case A – feet + inches with tick marks
  describe('Case A: feet + inches with tick/apostrophe', () => {
    it('parses 4\'5"', () => {
      const r = parseSingleToken("4'5\"");
      expect(r).not.toBeNull();
      expect(r.value).toBeCloseTo(4 + 5 / 12, 5);
      expect(r.format).toBe('inches');
    });

    it('parses 10\'2" with tight spacing', () => {
      const r = parseSingleToken("10'2\"");
      expect(r).not.toBeNull();
      expect(r.value).toBeCloseTo(10 + 2 / 12, 5);
    });

    it('parses 10\' 2" with space before inches', () => {
      const r = parseSingleToken("10' 2\"");
      expect(r).not.toBeNull();
      expect(r.value).toBeCloseTo(10 + 2 / 12, 5);
    });

    it('parses smart-quote variant \u2019', () => {
      const r = parseSingleToken('13\u20194"');
      expect(r).not.toBeNull();
      expect(r.value).toBeCloseTo(13 + 4 / 12, 5);
    });

    it('rejects inches >= 12', () => {
      expect(parseSingleToken("10'13\"")).toBeNull();
    });

    it('parses feet-only tick: 12\'', () => {
      const r = parseSingleToken("12'");
      expect(r).not.toBeNull();
      expect(r.value).toBe(12);
    });
  });

  // Case B – decimal feet
  describe('Case B: decimal feet', () => {
    it('parses 1.2 ft', () => {
      const r = parseSingleToken('1.2 ft');
      expect(r).not.toBeNull();
      expect(r.value).toBeCloseTo(1.2, 5);
      expect(r.format).toBe('decimal');
    });

    it('parses 12.75ft (no space)', () => {
      const r = parseSingleToken('12.75ft');
      expect(r).not.toBeNull();
      expect(r.value).toBeCloseTo(12.75, 5);
    });

    it('parses 1.2\' (decimal with tick)', () => {
      const r = parseSingleToken("1.2'");
      expect(r).not.toBeNull();
      expect(r.value).toBeCloseTo(1.2, 5);
    });

    it('parses 12 ft (integer + keyword)', () => {
      const r = parseSingleToken('12 ft');
      expect(r).not.toBeNull();
      expect(r.value).toBe(12);
      expect(r.format).toBe('decimal');
    });

    it('parses uppercase 12 FT', () => {
      const r = parseSingleToken('12 FT');
      expect(r).not.toBeNull();
      expect(r.value).toBe(12);
    });
  });

  // Case C – explicit ft / in keywords
  describe('Case C: explicit ft/in keywords', () => {
    it('parses "1 ft 3 in"', () => {
      const r = parseSingleToken('1 ft 3 in');
      expect(r).not.toBeNull();
      expect(r.value).toBeCloseTo(1 + 3 / 12, 5);
      expect(r.format).toBe('inches');
    });

    it('parses "2 feet 6 in"', () => {
      const r = parseSingleToken('2 feet 6 in');
      expect(r).not.toBeNull();
      expect(r.value).toBeCloseTo(2 + 6 / 12, 5);
    });

    it('parses "13 ft 4 in"', () => {
      const r = parseSingleToken('13 ft 4 in');
      expect(r).not.toBeNull();
      expect(r.value).toBeCloseTo(13 + 4 / 12, 5);
    });

    it('rejects inches >= 12 in explicit form', () => {
      expect(parseSingleToken('10 ft 13 in')).toBeNull();
    });
  });

  // Case D1 – blurry symbols: space-separated pair
  describe('Case D1: blurry symbols – space-separated pair', () => {
    it('parses "10 2" as 10ft 2in', () => {
      const r = parseSingleToken('10 2');
      expect(r).not.toBeNull();
      expect(r.value).toBeCloseTo(10 + 2 / 12, 5);
      expect(r.format).toBe('inches');
    });

    it('parses "13 4" as 13ft 4in', () => {
      const r = parseSingleToken('13 4');
      expect(r).not.toBeNull();
      expect(r.value).toBeCloseTo(13 + 4 / 12, 5);
    });

    it('rejects "10 13" because 13 is not a valid inches value', () => {
      // 13 >= 12, so should not be treated as ft+in pair
      const r = parseSingleToken('10 13');
      // May still parse as something else (plain ft), just must not be inches pair
      if (r) expect(r.format).not.toBe('inches');
    });
  });

  // Case D2 – noisy OCR: 3-4 digit bare integer
  describe('Case D2: noisy OCR / blurry symbols – bare integers', () => {
    it('parses "102" as 10ft 2in', () => {
      const r = parseSingleToken('102');
      expect(r).not.toBeNull();
      expect(r.value).toBeCloseTo(10 + 2 / 12, 5);
      expect(r.format).toBe('inches');
    });

    it('parses "134" as 13ft 4in', () => {
      const r = parseSingleToken('134');
      expect(r).not.toBeNull();
      expect(r.value).toBeCloseTo(13 + 4 / 12, 5);
    });

    it('parses "1210" as 12ft 10in', () => {
      const r = parseSingleToken('1210');
      expect(r).not.toBeNull();
      expect(r.value).toBeCloseTo(12 + 10 / 12, 5);
    });

    it('falls back to plain feet when last digit is >= 12 (e.g. "139" → 13ft or plain)', () => {
      const r = parseSingleToken('139');
      // 9 < 12 so this is actually valid: 13ft 9in
      expect(r).not.toBeNull();
      expect(r.value).toBeCloseTo(13 + 9 / 12, 5);
    });
  });

  // Plain 1-2 digit integers
  describe('Plain feet: 1-2 digit integers', () => {
    it('parses "12" as 12 ft', () => {
      const r = parseSingleToken('12');
      expect(r).not.toBeNull();
      expect(r.value).toBe(12);
      expect(r.format).toBe('decimal');
    });

    it('parses "10" as 10 ft', () => {
      const r = parseSingleToken('10');
      expect(r).not.toBeNull();
      expect(r.value).toBe(10);
    });
  });

  // Blurry quote: comma as tick mark
  describe('Blurry quotes: comma/backtick misreadings', () => {
    it('parses "10,5" as 10ft 5in (comma misread as tick)', () => {
      const r = parseSingleToken('10,5');
      expect(r).not.toBeNull();
      expect(r.value).toBeCloseTo(10 + 5 / 12, 5);
      expect(r.format).toBe('inches');
    });

    it('parses "13`4" as 13ft 4in (backtick misread as tick)', () => {
      const r = parseSingleToken('13`4');
      expect(r).not.toBeNull();
      expect(r.value).toBeCloseTo(13 + 4 / 12, 5);
      expect(r.format).toBe('inches');
    });
  });
});

// ---------------------------------------------------------------------------
// parseDimensionLine  (full pipeline)
// ---------------------------------------------------------------------------

describe('parseDimensionLine', () => {
  // Standard formats with lowercase x
  it('parses feet-inches × feet-inches: 10\'2" x 13\'4"', () => {
    const r = parseDimensionLine("10'2\" x 13'4\"");
    expect(r).not.toBeNull();
    expect(r.width).toBeCloseTo(10 + 2 / 12, 5);
    expect(r.height).toBeCloseTo(13 + 4 / 12, 5);
    expect(r.format).toBe('inches');
  });

  // Uppercase X separator
  it('parses with uppercase X separator: 10\'2" X 13\'4"', () => {
    const r = parseDimensionLine("10'2\" X 13'4\"");
    expect(r).not.toBeNull();
    expect(r.width).toBeCloseTo(10 + 2 / 12, 5);
    expect(r.height).toBeCloseTo(13 + 4 / 12, 5);
  });

  // Unicode multiplication sign
  it('parses with unicode × separator', () => {
    const r = parseDimensionLine("10'2\" \u00D7 13'4\"");
    expect(r).not.toBeNull();
    expect(r.width).toBeCloseTo(10 + 2 / 12, 5);
    expect(r.height).toBeCloseTo(13 + 4 / 12, 5);
  });

  // Decimal feet
  it('parses decimal feet: 1.2 ft x 2.5 ft', () => {
    const r = parseDimensionLine('1.2 ft x 2.5 ft');
    expect(r).not.toBeNull();
    expect(r.width).toBeCloseTo(1.2, 5);
    expect(r.height).toBeCloseTo(2.5, 5);
    expect(r.format).toBe('decimal');
  });

  it('parses decimal feet without spaces: 1.2ftx2.5ft', () => {
    const r = parseDimensionLine('1.2ftx2.5ft');
    expect(r).not.toBeNull();
    expect(r.width).toBeCloseTo(1.2, 5);
    expect(r.height).toBeCloseTo(2.5, 5);
  });

  // Explicit ft/in
  it('parses explicit ft/in: 1 ft 3 in x 2 ft 6 in', () => {
    const r = parseDimensionLine('1 ft 3 in x 2 ft 6 in');
    expect(r).not.toBeNull();
    expect(r.width).toBeCloseTo(1 + 3 / 12, 5);
    expect(r.height).toBeCloseTo(2 + 6 / 12, 5);
  });

  // Noisy OCR fallback – both symbols blurry (no ' or ")
  it('parses noisy OCR: 102 x 134', () => {
    const r = parseDimensionLine('102 x 134');
    expect(r).not.toBeNull();
    expect(r.width).toBeCloseTo(10 + 2 / 12, 5);
    expect(r.height).toBeCloseTo(13 + 4 / 12, 5);
  });

  // Noisy OCR with uppercase X
  it('parses noisy OCR with uppercase X: 102 X 134', () => {
    const r = parseDimensionLine('102 X 134');
    expect(r).not.toBeNull();
    expect(r.width).toBeCloseTo(10 + 2 / 12, 5);
    expect(r.height).toBeCloseTo(13 + 4 / 12, 5);
  });

  // Blurry symbols: spaces instead of ' and "
  it('parses blurry-symbol pair: "10 2 x 13 4"', () => {
    const r = parseDimensionLine('10 2 x 13 4');
    expect(r).not.toBeNull();
    expect(r.width).toBeCloseTo(10 + 2 / 12, 5);
    expect(r.height).toBeCloseTo(13 + 4 / 12, 5);
  });

  // Plain bare integers (small rooms, no units)
  it('parses bare integer pair: 12 x 10', () => {
    const r = parseDimensionLine('12 x 10');
    expect(r).not.toBeNull();
    expect(r.width).toBe(12);
    expect(r.height).toBe(10);
  });

  // Two ft+in groups with no x (strategy 2)
  it('parses two feet-inches groups without x: 12\'5" 10\'3"', () => {
    const r = parseDimensionLine("12'5\" 10'3\"");
    expect(r).not.toBeNull();
    expect(r.width).toBeCloseTo(12 + 5 / 12, 5);
    expect(r.height).toBeCloseTo(10 + 3 / 12, 5);
  });

  // "by" as separator
  it('parses "by" separator: 10\'2" by 13\'4"', () => {
    const r = parseDimensionLine("10'2\" by 13'4\"");
    expect(r).not.toBeNull();
    expect(r.width).toBeCloseTo(10 + 2 / 12, 5);
    expect(r.height).toBeCloseTo(13 + 4 / 12, 5);
  });

  // Validation: returns null for junk input
  it('returns null for non-dimension text', () => {
    expect(parseDimensionLine('bedroom')).toBeNull();
    expect(parseDimensionLine('')).toBeNull();
  });

  // Blurry quotes: comma/backtick misreading across full dimension lines
  it('parses blurry comma-tick: "10,5 x 13,4"', () => {
    const r = parseDimensionLine('10,5 x 13,4');
    expect(r).not.toBeNull();
    expect(r.width).toBeCloseTo(10 + 5 / 12, 5);
    expect(r.height).toBeCloseTo(13 + 4 / 12, 5);
  });

  it('parses mixed: "10\'2 x 13,4" (one real tick, one comma)', () => {
    const r = parseDimensionLine("10'2 x 13,4");
    expect(r).not.toBeNull();
    expect(r.width).toBeCloseTo(10 + 2 / 12, 5);
    expect(r.height).toBeCloseTo(13 + 4 / 12, 5);
  });
});

// ---------------------------------------------------------------------------
// extractDimensionSubstring
// ---------------------------------------------------------------------------

describe('extractDimensionSubstring', () => {
  it('extracts dimensions from line with room name prefix', () => {
    const norm = normalizeOcrText("BEDROOM 13' 5\" × 12' 11\"");
    const sub = extractDimensionSubstring(norm);
    expect(sub).toContain('13');
    expect(sub).toContain('12');
    const r = parseDimensionLine(sub);
    expect(r).not.toBeNull();
    expect(r.width).toBeCloseTo(13 + 5 / 12, 5);
    expect(r.height).toBeCloseTo(12 + 11 / 12, 5);
  });

  it('extracts kitchen dimensions from prefixed line', () => {
    const norm = normalizeOcrText("KITCHEN 10' 9\" x 7' 11\"");
    const sub = extractDimensionSubstring(norm);
    const r = parseDimensionLine(sub);
    expect(r).not.toBeNull();
    expect(r.width).toBeCloseTo(10 + 9 / 12, 5);
    expect(r.height).toBeCloseTo(7 + 11 / 12, 5);
  });

  it('returns full string when no room name prefix', () => {
    const norm = normalizeOcrText("13' 5\" x 12' 11\"");
    const sub = extractDimensionSubstring(norm);
    // Should be the same or very similar to the input
    const r = parseDimensionLine(sub);
    expect(r).not.toBeNull();
    expect(r.width).toBeCloseTo(13 + 5 / 12, 5);
    expect(r.height).toBeCloseTo(12 + 11 / 12, 5);
  });

  it('handles living room/dining room prefix', () => {
    const norm = normalizeOcrText("LIVING ROOM/DINING ROOM 16' 7\" × 25' 10\"");
    const sub = extractDimensionSubstring(norm);
    const r = parseDimensionLine(sub);
    expect(r).not.toBeNull();
    expect(r.width).toBeCloseTo(16 + 7 / 12, 5);
    expect(r.height).toBeCloseTo(25 + 10 / 12, 5);
  });

  it('handles entry prefix', () => {
    const norm = normalizeOcrText("ENTRY 13' 5\" × 10' 7\"");
    const sub = extractDimensionSubstring(norm);
    const r = parseDimensionLine(sub);
    expect(r).not.toBeNull();
    expect(r.width).toBeCloseTo(13 + 5 / 12, 5);
    expect(r.height).toBeCloseTo(10 + 7 / 12, 5);
  });

  it('returns non-dimension text as-is (no digits)', () => {
    const sub = extractDimensionSubstring('bedroom closet');
    expect(sub).toBe('bedroom closet');
  });
});
