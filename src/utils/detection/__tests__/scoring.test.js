import { describe, it, expect } from 'vitest';
import { pickCandidate } from '../scoring.js';

const c = (variant, policy, radius, score, bridgedSpan = 0) =>
  ({ variant, policy, radius, score, bridgedSpan });

const permutations = (items) => {
  if (items.length <= 1) return [items];
  const out = [];
  for (let i = 0; i < items.length; i += 1) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([items[i], ...tail]);
  }
  return out;
};

const key = (best) => `${best.variant}/${best.policy}@${best.radius}`;

// The winner used to be a function of the order candidates happened to be
// pushed in: `|a.score - b.score| <= eps` is not transitive, so the comparator
// was not an ordering, and Array#sort's stability decided. Reversing the input
// array alone moved ExampleFloorplan.png's lower floor from the footprint that
// contains its garage to one that traces around it, and the garage room then
// fell outside the clamp and stopped being detected at all.
describe('pickCandidate is a total order', () => {
  // ExampleFloorplan.png, lower floor: the degenerate set from that bug.
  const lowerFloor = [
    c('all', 'weld', 2, 0.9598),
    c('all', 'raw', 2, 0.8544),
    c('structural', 'weld', 2, 0.9704),
  ];
  // ExampleFloorplan.png, upper floor: two ladders 0.0004 apart at equal radius.
  const upperFloor = [
    c('all', 'weld', 2, 0.7587),
    c('all', 'weld', 26, 0.9337),
    c('all', 'raw', 2, 0.8675),
    c('structural', 'weld', 2, 0.7578),
    c('structural', 'weld', 26, 0.9333),
  ];

  for (const [name, set, expected] of [
    ['lower floor', lowerFloor, 'all/weld@2'],
    ['upper floor', upperFloor, 'all/weld@26'],
  ]) {
    it(`picks the same candidate from every permutation of the ${name} set`, () => {
      for (const order of permutations(set)) {
        expect(key(pickCandidate(order).best)).toBe(expected);
      }
    });

    it(`picks the same candidate from the reversed ${name} set`, () => {
      expect(key(pickCandidate([...set].reverse()).best)).toBe(expected);
      expect(key(pickCandidate(set).best)).toBe(expected);
    });

    it(`ranks the ${name} set identically from every permutation`, () => {
      const reference = pickCandidate(set).ranked.map(key);
      for (const order of permutations(set)) {
        expect(pickCandidate(order).ranked.map(key)).toEqual(reference);
      }
    });
  }

  // Within the noise band the base hypothesis wins because `structural`
  // discards drawn linework; outside it, score still decides.
  it('still prefers a structural hypothesis that scores clearly better', () => {
    const set = [c('all', 'weld', 2, 0.80), c('structural', 'weld', 2, 0.95)];
    for (const order of permutations(set)) {
      expect(key(pickCandidate(order).best)).toBe('structural/weld@2');
    }
  });

  it('returns null when nothing scored', () => {
    expect(pickCandidate([null, null])).toBeNull();
  });
});
