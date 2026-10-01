import { describe, expect, it } from 'vitest';
import { anchorBounds } from '../planAnchors.js';
import { findSelfIntersection } from '../geometryValidation.js';

describe('anchorBounds', () => {
  it('bounds a multi-run anchor across every run, so the camera frames them all', () => {
    const bounds = anchorBounds({
      runs: [[{ x: 0, y: 0 }, { x: 10, y: 0 }], [{ x: 90, y: 40 }, { x: 100, y: 50 }]],
    });
    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 50 });
  });

  it('bounds a single run given as points', () => {
    expect(anchorBounds({ points: [{ x: 4, y: 9 }, { x: 1, y: 12 }] }))
      .toEqual({ minX: 1, minY: 9, maxX: 4, maxY: 12 });
  });

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
