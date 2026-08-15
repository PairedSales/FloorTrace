import { describe, expect, it } from 'vitest';
import { matchExteriorFeature, roomIsNonGla } from '../dimensions/exteriorLabels.js';

describe('matchExteriorFeature', () => {
  it.each([
    ['GARAGE', 'garage'],
    ["GARAGE 20'7\" x 9'6\"", 'garage'],
    ['2 Car Garage', 'garage'],
    ['ATTACHED GARAGE', 'garage'],
    ['PORCH', 'porch'],
    ['Covered Porch', 'porch'],
    ["PORCH 20'7\" x 5'1\"", 'porch'],
    ['Patio 12\' x 8\'', 'patio'],
    ['SUN DECK', 'sundeck'],
    ['Sundeck', 'sundeck'],
    ['Balcony', 'balcony'],
    ['BALCONIES', 'balconies'],
    ['rear terrace', 'terrace'],
    ['VERANDAH', 'verandah'],
    ['Lanai', 'lanai'],
    ['CARPORT', 'carport'],
    ['breezeway', 'breezeway'],
  ])('matches %s', (text, keyword) => {
    expect(matchExteriorFeature(text)).toBe(keyword);
  });

  it.each([
    'LIVING ROOM',
    'BEDROOM 2 10-0 x 10-4',
    'KITCHEN',
    'GARBAGE',         // no bare keyword inside longer words
    'PORCHESTER ROAD',
    'deckard',
    '',
  ])('does not match %s', (text) => {
    expect(matchExteriorFeature(text)).toBeNull();
  });

  it('tolerates non-string input', () => {
    expect(matchExteriorFeature(null)).toBeNull();
    expect(matchExteriorFeature(undefined)).toBeNull();
    expect(matchExteriorFeature(42)).toBeNull();
  });
});

describe('roomIsNonGla', () => {
  const rect = (left, top, right, bottom) => ({ left, top, right, bottom });
  const bbox = (x, y, width, height) => ({ x, y, width, height });

  it('matches on the room label text with no label boxes at all', () => {
    expect(roomIsNonGla({ labelId: "GARAGE 20'-7\" x 9'-6\"", rect: rect(620, 596, 943, 743) })).toBe(true);
  });

  it('falls back to name when there is no labelId', () => {
    expect(roomIsNonGla({ labelId: null, name: 'Covered Porch', rect: rect(0, 0, 10, 10) }, [])).toBe(true);
  });

  it('matches a name label anywhere inside the room, not just at its centroid', () => {
    // The exact case the centroid test got wrong: the GARAGE name label sits in
    // the top-left corner of a 323x147px rectangle, nowhere near its middle.
    const room = { labelId: '20-7 x 9-6', rect: rect(620, 596, 943, 743) };
    expect(roomIsNonGla(room, [bbox(640, 604, 90, 18)])).toBe(true);
  });

  it('accepts labels as objects or as bare bboxes', () => {
    const room = { labelId: '20-7 x 9-6', rect: rect(620, 596, 943, 743) };
    expect(roomIsNonGla(room, [{ keyword: 'garage', bbox: bbox(640, 604, 90, 18) }])).toBe(true);
  });

  it('leaves a bedroom alone when a porch label merely sits nearby', () => {
    const bedroom = { labelId: "BEDROOM 2 10'-0\" x 10'-4\"", rect: rect(100, 100, 260, 260) };
    // Just outside the bedroom's right edge — adjacent, never overlapping.
    expect(roomIsNonGla(bedroom, [bbox(266, 150, 80, 16)])).toBe(false);
  });

  it('is false for a room with no rect and no keyword', () => {
    expect(roomIsNonGla({ labelId: 'KITCHEN' }, [bbox(0, 0, 500, 500)])).toBe(false);
  });

  it('tolerates missing rooms and malformed labels', () => {
    expect(roomIsNonGla(null, [bbox(0, 0, 10, 10)])).toBe(false);
    expect(roomIsNonGla({ labelId: 'KITCHEN', rect: rect(0, 0, 10, 10) })).toBe(false);
    expect(roomIsNonGla({ labelId: 'KITCHEN', rect: rect(0, 0, 10, 10) }, [null])).toBe(false);
  });
});
