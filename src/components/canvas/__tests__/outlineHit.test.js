// @vitest-environment happy-dom
// `canvasUtils` makes a measuring canvas when it is imported.
import { describe, it, expect } from 'vitest';
import { nearestOutlineEdge, eraseCornersUnderStroke } from '../outlineHit';

const square = (x, y, size) => [
  { x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size },
];
const trace = (id, vertices, extra = {}) => ({ id, vertices, visible: true, closed: true, ...extra });

// A house, and a garage against its right-hand wall: x = 100 belongs to both.
const house = trace('house', square(0, 0, 100));
const garage = trace('garage', square(100, 0, 50));

describe('nearestOutlineEdge', () => {
  it('finds the wall of an outline that is not in hand', () => {
    // Just under the garage's bottom wall, well away from the house.
    const hit = nearestOutlineEdge([house, garage], 'house', { x: 130, y: 52 });
    expect(hit).toMatchObject({ traceId: 'garage', edgeIndex: 2 });
    expect(hit.distance).toBeCloseTo(2);
  });

  it('gives a shared wall to the outline in hand, whichever that is', () => {
    const onSharedWall = { x: 100, y: 25 };
    expect(nearestOutlineEdge([house, garage], 'house', onSharedWall).traceId).toBe('house');
    expect(nearestOutlineEdge([house, garage], 'garage', onSharedWall).traceId).toBe('garage');
  });

  it('goes by distance alone: being in hand settles a tie and nothing else', () => {
    // A garage drawn a fraction of a pixel off the house's wall, and a click
    // a hair on the garage's side of the gap.
    const near = trace('near', square(100.4, 0, 50));
    expect(nearestOutlineEdge([house, near], 'house', { x: 100.25, y: 25 }).traceId).toBe('near');
    expect(nearestOutlineEdge([house, near], 'house', { x: 100.15, y: 25 }).traceId).toBe('house');
  });

  it('skips an outline that is hidden or not yet a shape', () => {
    const hidden = trace('hidden', square(100, 0, 50), { visible: false });
    const started = trace('started', [{ x: 130, y: 52 }, { x: 131, y: 52 }]);
    expect(nearestOutlineEdge([house, hidden, started], 'hidden', { x: 130, y: 52 }).traceId).toBe('house');
    expect(nearestOutlineEdge([hidden, started], 'hidden', { x: 130, y: 52 })).toBeNull();
  });
});

describe('eraseCornersUnderStroke', () => {
  const lShape = trace('l', [
    { x: 200, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 50 },
    { x: 250, y: 50 }, { x: 250, y: 100 }, { x: 200, y: 100 },
  ]);

  it('erases from an outline that is not in hand', () => {
    const erased = eraseCornersUnderStroke([house, lShape], 'house', [{ x: 251, y: 51 }], 5);
    expect(erased.traceId).toBe('l');
    expect(erased.vertices).toHaveLength(5);
    expect(erased.vertices).not.toContainEqual({ x: 250, y: 50 });
  });

  it('erases from the outline in hand only where the brush was as near to both', () => {
    const a = trace('a', [...square(0, 0, 100), { x: -10, y: 50 }]);
    const b = trace('b', [...square(100, 0, 50), { x: 160, y: 25 }]);
    // Over the corner the two share at (100, 0).
    const path = [{ x: 99, y: 0 }, { x: 101, y: 0 }];
    expect(eraseCornersUnderStroke([a, b], 'a', path, 4).traceId).toBe('a');
    expect(eraseCornersUnderStroke([a, b], 'b', path, 4).traceId).toBe('b');
    // Nearer to one of b's own corners than to anything of a's: b, in hand or not.
    const overB = [{ x: 150, y: 3 }];
    expect(eraseCornersUnderStroke([a, b], 'a', overB, 60).traceId).toBe('b');
  });

  it('never takes an outline below three corners', () => {
    const five = trace('five', [...square(0, 0, 100), { x: -10, y: 50 }]);
    // A brush wide enough to cover all of it.
    const erased = eraseCornersUnderStroke([five], 'five', [{ x: 50, y: 50 }], 500);
    expect(erased.vertices).toHaveLength(3);
    // A triangle has none to spare, so the stroke touches nothing.
    const triangle = trace('t', [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }]);
    expect(eraseCornersUnderStroke([triangle], 't', [{ x: 0, y: 0 }], 5)).toBeNull();
  });

  it('touches nothing where the brush ran over no corner, or only a hidden outline’s', () => {
    expect(eraseCornersUnderStroke([house, lShape], 'house', [{ x: 500, y: 500 }], 5)).toBeNull();
    const hidden = { ...lShape, visible: false };
    expect(eraseCornersUnderStroke([house, hidden], 'house', [{ x: 251, y: 51 }], 5)).toBeNull();
  });
});
