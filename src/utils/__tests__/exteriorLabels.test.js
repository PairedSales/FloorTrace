import { describe, expect, it } from 'vitest';
import { matchExteriorFeature } from '../dimensions/exteriorLabels.js';

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
