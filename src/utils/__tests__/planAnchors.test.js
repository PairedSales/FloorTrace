import { describe, expect, it } from 'vitest';
import { anchorBounds } from '../planAnchors.js';
import { findSelfIntersection } from '../geometryValidation.js';

describe('anchorBounds', () => {
  it('reports nothing for an empty anchor', () => {
    expect(anchorBounds({ points: [] })).toBeNull();
    expect(anchorBounds({})).toBeNull();
    expect(anchorBounds(null)).toBeNull();
  });

  // The only producer: a refused edit hands over what `findSelfIntersection`
  // found, and the camera has to be able to frame it.
  it('bounds the crossing a refused edit reports', () => {
    const bowTie = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
    const crossing = findSelfIntersection(bowTie, true);
    expect(crossing).toBeTruthy();
    expect(anchorBounds({ kind: 'segment', ...crossing }))
      .toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });
});
