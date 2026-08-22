import { describe, it, expect } from 'vitest';
import { matchAreaLabel } from '../dimensions/areaLabels.js';
import { TRACE_TYPES } from '../traceTypes.js';

describe('matchAreaLabel', () => {
  it('only ever names a type the taxonomy actually has', () => {
    const ids = new Set(TRACE_TYPES.map((t) => t.id));
    const samples = ['BASEMENT', 'LOWER LEVEL', 'CELLAR', '2ND FLOOR', 'MAIN LEVEL'];
    for (const text of samples) {
      expect(ids.has(matchAreaLabel(text).type)).toBe(true);
    }
  });

  it.each([
    'BASEMENT',
    'Basement',
    "BASEMENT 8'10\" x 17'9\"",
    'BSMT',
    'UNFINISHED BASEMENT',
    'CELLAR',
    'LOWER LEVEL',
    'LOWER LVL',
    'GARDEN LEVEL',
    'BELOW GRADE',
    'BELOW-GRADE',
    'SUB-BASEMENT',
  ])('reads %s as below grade', (text) => {
    expect(matchAreaLabel(text)?.type).toBe('below-grade');
  });

  it.each([
    '1ST FLOOR',
    '2nd Floor',
    'THIRD LEVEL',
    'MAIN FLOOR',
    'UPPER LEVEL',
    'FLOOR 2',
    'LEVEL 1',
  ])('reads %s as living area', (text) => {
    expect(matchAreaLabel(text)?.type).toBe('gla');
  });

  // The whole point of the guard: these are printed on the storey you are
  // leaving, not on the one they name, so acting on them retypes a floor.
  it.each([
    'BASEMENT STAIRS',
    'DN TO BSMT',
    'STAIRS TO BASEMENT',
    'BASEMENT ACCESS',
    'BASEMENT DOOR',
    'LOWER LEVEL ENTRY',
  ])('ignores %s as a pointer, not a label', (text) => {
    expect(matchAreaLabel(text)).toBeNull();
  });

  // A legend quotes every level's name in one place, far from any of them.
  it.each([
    'BASEMENT 800 SQ FT',
    'TOTAL BELOW GRADE AREA',
    'BASEMENT 800 SQFT',
  ])('ignores the schedule row %s', (text) => {
    expect(matchAreaLabel(text)).toBeNull();
  });

  it('ignores room names that are not level names', () => {
    for (const text of ['KITCHEN', 'GARAGE', 'COVERED PORCH', 'BEDROOM 2', 'UTILITY']) {
      expect(matchAreaLabel(text)).toBeNull();
    }
  });

  // Room names, not level names: a GARAGE label sits inside the first floor,
  // so typing the whole outline from it would move a storey out of GLA.
  it('never types an outline from a room-level feature name', () => {
    expect(matchAreaLabel("GARAGE 20'-7\" x 9'-6\"")).toBeNull();
    expect(matchAreaLabel('PATIO')).toBeNull();
  });

  it('reads through typographic quotes', () => {
    expect(matchAreaLabel('B’MENT')?.type).toBe('below-grade');
  });

  it('returns null for junk input', () => {
    expect(matchAreaLabel(null)).toBeNull();
    expect(matchAreaLabel('')).toBeNull();
    expect(matchAreaLabel('   ')).toBeNull();
  });
});
