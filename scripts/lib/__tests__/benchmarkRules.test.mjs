// The definitions the accuracy scoreboard rests on (docs/accuracy-roadmap.md):
// what the CubiCasa answer key counts as living area, and how an outline is
// judged against an answer key. Pure functions, so they run without the
// dataset, in CI.
import { describe, expect, it } from 'vitest';
import { spaceRoles } from '../cubicasa.mjs';
import { scoreMask } from '../verdict.mjs';

const box = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const space = (type, name, polygon) => ({ type, name, polygon });

describe('the CubiCasa answer key', () => {
  const bedroom = space('Bedroom', 'MH', box(0, 0, 400, 300));

  it('takes an outdoor space typed as a room at its name', () => {
    const roles = spaceRoles([
      bedroom,
      space('UserDefined', 'PATIO/TERASSI', box(0, 310, 400, 500)),
      space('UserDefined', 'NURMI- PIHAA', box(410, 0, 700, 300)),
    ]);
    expect(roles).toEqual(['living', 'nonGla', 'nonGla']);
  });

  it('counts a storage room in the house and not one across the yard', () => {
    const roles = spaceRoles([
      bedroom,
      space('Storage', 'VAR', box(410, 0, 500, 100)),
      space('Storage', 'VAR', box(0, 800, 100, 900)),
    ]);
    expect(roles).toEqual(['living', 'living', 'nonGla']);
  });

  it('never counts a shed, and leaves a room nobody typed undecided', () => {
    const roles = spaceRoles([
      bedroom,
      space('Storage Shed', 'VAJA', box(410, 0, 500, 100)),
      space('Undefined', 'UNDEFINED', box(0, 310, 400, 500)),
    ]);
    expect(roles).toEqual(['living', 'nonGla', 'unknown']);
  });
});

describe('the verdict', () => {
  const W = 100;
  const H = 100;
  const grid = { width: W, height: H, cell: 1 };
  const fill = (mask, x0, y0, x1, y1) => {
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) mask[y * W + x] = 1;
    return mask;
  };
  const house = () => fill(new Uint8Array(W * H), 10, 10, 70, 70);
  const truth = {
    grid,
    footprint: house(),
    nonGla: fill(new Uint8Array(W * H), 10, 70, 70, 80),
    ignore: fill(new Uint8Array(W * H), 70, 10, 90, 30),
  };

  it('calls a matching outline perfect', () => {
    const scored = scoreMask(house(), truth);
    expect(scored.verdict).toBe('perfect');
    expect(scored.iou).toBe(1);
  });

  it('calls one balcony left in near-perfect, and says it is non-GLA', () => {
    const scored = scoreMask(fill(house(), 10, 70, 70, 80), truth);
    expect(scored.verdict).toBe('near');
    expect(scored.regions[0].cause).toBe('nonGla');
  });

  it('calls a mistake bigger than a fifth of the home wrong', () => {
    expect(scoreMask(fill(house(), 10, 70, 70, 95), truth).verdict).toBe('wrong');
  });

  it('does not score space the answer key leaves undecided', () => {
    const scored = scoreMask(fill(house(), 70, 10, 90, 30), truth);
    expect(scored.verdict).toBe('perfect');
    expect(scored.areaErr).toBe(0);
  });
});
